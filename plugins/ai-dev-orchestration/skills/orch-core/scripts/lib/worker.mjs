// ワーカーの起動。実装は各リポジトリの worktree を作業ディレクトリにして動かす。
//
// そこで起動しないと、そのリポジトリの CLAUDE.md・.claude/settings.json・
// フック・プロジェクトスキルが効かない（project settings はセッションの
// 主作業ディレクトリからしか読まれない）。
//
// ワーカーは state.json を書かない（ORCH_ROLE=worker で orch が拒否する）。
// 結果はエンベロープで返し、マネージャだけがロック下で state に書く。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { repoConfig, worktreeRoot } from "./config.mjs";
import { loadState, updateState, setStatus, parseKey, STATUSES } from "./state.mjs";
import { validateResult } from "./review.mjs";

const START = "<<<ORCH_RESULT>>>";
const END = "<<<END>>>";

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

// worktree を用意する。リポジトリのクローンはしない（人間が置いたものを使う）。
export function ensureWorktree(config, key) {
  const { nameWithOwner, repo, number } = parseKey(key);
  const rc = repoConfig(config, nameWithOwner);
  if (!rc.path) {
    throw new Error(
      `repos の ${nameWithOwner} に path がありません。ローカルのチェックアウト先を orch.config.json に書いてください（AIはcloneしません）`,
    );
  }
  const repoPath = expandHome(rc.path);
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    throw new Error(`${repoPath} が git リポジトリではありません`);
  }
  const branch = `ai/${number}`;
  const dir = path.join(worktreeRoot(config), `${repo}-${number}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const git = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
    const exists = execFileSync("git", ["-C", repoPath, "branch", "--list", branch], git).trim();
    const args = exists
      ? ["-C", repoPath, "worktree", "add", dir, branch]
      : ["-C", repoPath, "worktree", "add", "-b", branch, dir];
    execFileSync("git", args, git);
  }
  return { dir, branch, repoPath };
}

// ワーカーが最後に出力する結果。これ以外は読まない。
export function parseEnvelope(text) {
  const start = text.lastIndexOf(START);
  if (start < 0) return { ok: false, errors: [`${START} が出力に無い`] };
  const end = text.indexOf(END, start);
  if (end < 0) return { ok: false, errors: [`${END} が出力に無い`] };
  let data;
  try {
    data = JSON.parse(text.slice(start + START.length, end));
  } catch (err) {
    return { ok: false, errors: [`エンベロープがJSONとして読めない: ${err.message}`] };
  }
  const errors = [];
  if (typeof data.key !== "string") errors.push("key が無い");
  if (data.status && !STATUSES.includes(data.status)) errors.push(`status が不正: ${data.status}`);
  for (const [i, pr] of (data.prs || []).entries()) {
    if (typeof pr.number !== "number") errors.push(`prs[${i}].number が数値でない`);
  }
  for (const [i, r] of (data.review || []).entries()) {
    const check = validateResult(r);
    if (!check.ok) errors.push(`review[${i}]: ${check.errors.join(" / ")}`);
  }
  // ワーカーは投稿できないので、投稿してほしいコメントはここに載せる
  for (const [i, c] of (data.comments || []).entries()) {
    if (!["memo", "split", "approve", "triage"].includes(c.kind)) {
      errors.push(`comments[${i}].kind が不正: ${c.kind}`);
    }
    if (!c.body && !c.bodyFile) errors.push(`comments[${i}] に body も bodyFile も無い`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, data };
}

// マネージャ側だけが呼ぶ。ロック下で state に反映する。
export function applyEnvelope(data) {
  return updateState((state) => {
    const entry = state.issues[data.key];
    if (!entry) throw new Error(`state に未登録: ${data.key}`);
    for (const incoming of data.prs || []) {
      const existing = (entry.prs || []).find((p) => p.number === incoming.number);
      if (existing) Object.assign(existing, incoming);
      else entry.prs = [...(entry.prs || []), { order: (entry.prs || []).length + 1, merged: false, ...incoming }];
    }
    for (const result of data.review || []) {
      const pr = (entry.prs || []).find((p) => p.number === (data.prs?.[0]?.number ?? p.number));
      if (!pr) continue;
      pr.review = pr.review || { round: 0, results: {} };
      pr.review.results[result.reviewer] = result;
    }
    if (data.needs_human) setStatus(entry, "needs-human", { workerNotes: data.notes || null });
    else if (data.status) setStatus(entry, data.status, { workerNotes: data.notes || null });
    return { key: data.key, status: entry.status, prs: entry.prs };
  });
}

// ワーカーを1件起動する。並行させたいときは、マネージャがこれを複数同時に呼ぶ。
export function runWorker(config, { key, action, promptFile, dryRun = false }) {
  if (!loadState().issues[key]) throw new Error(`state に未登録: ${key}`);
  const { dir, branch } = ensureWorktree(config, key);
  const prompt = fs.readFileSync(promptFile, "utf8");
  const { command, args, timeoutMin } = config.worker;

  if (dryRun) {
    return { dryRun: true, key, action, cwd: dir, branch, workerCommand: [command, ...args].join(" ") };
  }

  const res = spawnSync(command, [...args, prompt], {
    cwd: dir,
    encoding: "utf8",
    timeout: (timeoutMin || 30) * 60_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ORCH_ROLE: "worker", ORCH_KEY: key, ORCH_ACTION: action },
  });
  if (res.error) throw new Error(`ワーカーを起動できません: ${res.error.message}`);

  const envelope = parseEnvelope(res.stdout || "");
  if (!envelope.ok) {
    return {
      ok: false,
      key,
      action,
      cwd: dir,
      exitCode: res.status,
      errors: envelope.errors,
      needs_human: true,
      stderr: (res.stderr || "").slice(-2000),
    };
  }
  const applied = applyEnvelope(envelope.data);
  return { ok: true, key, action, cwd: dir, branch, exitCode: res.status, applied, envelope: envelope.data };
}
