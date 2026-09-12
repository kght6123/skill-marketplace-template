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
import { post } from "./post.mjs";

const START = "<<<ORCH_RESULT>>>";
const END = "<<<END>>>";

// ワーカーが返してよいのは「観測した事実」だけ。状態遷移の判定はマネージャの担当。
const ENVELOPE_FIELDS = ["key", "action", "status", "prs", "review", "comments", "needs_human", "notes"];

// PRについて報告してよい項目。merged / selfApproved / approvalCommentId などの
// 承認とマージに関わる項目はマネージャ管轄で、ワーカーからは書かせない。
const WORKER_PR_FIELDS = ["number", "order", "headSha", "branch", "base", "title"];

// action ごとに許す遷移先。ここに無い status は受け取らない。
const STATUS_BY_ACTION = {
  implement: ["implementing", "pr-review", "needs-human"],
  "implement-continue": ["implementing", "pr-review", "needs-human"],
  "apply-triage": ["pr-review", "needs-human"],
};

const COMMENT_KINDS = ["memo", "split", "approve", "triage"];

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

// 枠のロックは worktree の**外**（隣）に置く。中に置くとディレクトリが先に
// できてしまい、git worktree add が "already exists" で失敗する。
function lockPathFor(dir) {
  return `${dir}.lock`;
}

// 同じIssueに複数のワーカーが来たら、worktree を連番で分ける。
// slot 1: <repo>-<番号> / orch/<番号>
// slot 2: <repo>-<番号>-2 / orch/<番号>-2 ...
function slotPaths(config, key, slot) {
  const { repo, number } = parseKey(key);
  const suffix = slot === 1 ? "" : `-${slot}`;
  return {
    dir: path.join(worktreeRoot(config), `${repo}-${number}${suffix}`),
    branch: `${config.branchPrefix || "orch/"}${number}${suffix}`,
  };
}

// そのworktreeで今ワーカーが動いているか。落ちたプロセスのロックは時間で無効にする。
function isBusy(dir, staleMs) {
  const lock = lockPathFor(dir);
  if (!fs.existsSync(lock)) return false;
  try {
    return Date.now() - fs.statSync(lock).mtimeMs < staleMs;
  } catch {
    return false;
  }
}

// 枠を排他的に取る。「空いている」の確認と「予約」を1操作にしないと、
// 2プロセスが同時に同じ枠を空きと判定し、同じ worktree で作業してしまう。
function claimSlot(dir, staleMs) {
  const lock = lockPathFor(dir);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const body = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  try {
    fs.writeFileSync(lock, body, { flag: "wx" }); // 既にあれば EEXIST
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    if (isBusy(dir, staleMs)) return false; // 動いている。次の枠へ
    // 残骸。剥がして取り直す（ここで負けたら次の枠へ進む）
    fs.rmSync(lock, { force: true });
    try {
      fs.writeFileSync(lock, body, { flag: "wx" });
      return true;
    } catch (retryErr) {
      if (retryErr.code === "EEXIST") return false;
      throw retryErr;
    }
  }
}

function repoPathOf(config, key) {
  const { nameWithOwner } = parseKey(key);
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
  return repoPath;
}

// 割り当て先を計算するだけ。作らない（--dry-run 用）。
export function planWorktree(config, key) {
  const repoPath = repoPathOf(config, key);
  const staleMs = (config.worker?.timeoutMin || 30) * 60_000;
  const maxSlots = Math.max(1, config.limits?.parallelWorkers || 1);
  for (let slot = 1; slot <= maxSlots; slot++) {
    const { dir, branch } = slotPaths(config, key, slot);
    if (isBusy(dir, staleMs)) continue;
    return { dir, branch, slot, repoPath, exists: fs.existsSync(dir) };
  }
  throw new Error(
    `${key} の worktree が ${maxSlots} 枠すべて使用中です（実行中か、別の場所で checked out）。limits.parallelWorkers を見てください`,
  );
}

// 空いている worktree を確保する。リポジトリのクローンはしない（人間が置いたものを使う）。
export function ensureWorktree(config, key, { lock = false } = {}) {
  const repoPath = repoPathOf(config, key);
  const staleMs = (config.worker?.timeoutMin || 30) * 60_000;
  const maxSlots = Math.max(1, config.limits?.parallelWorkers || 1);

  for (let slot = 1; slot <= maxSlots; slot++) {
    const { dir, branch } = slotPaths(config, key, slot);
    // 先に枠を取る。取れなければ他のワーカーのもの
    if (lock) {
      if (!claimSlot(dir, staleMs)) continue;
    } else if (isBusy(dir, staleMs)) {
      continue;
    }

    const worktreeExists = fs.existsSync(path.join(dir, ".git"));
    if (!worktreeExists) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      const git = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
      const exists = execFileSync("git", ["-C", repoPath, "branch", "--list", branch], git).trim();
      const args = exists
        ? ["-C", repoPath, "worktree", "add", dir, branch]
        : ["-C", repoPath, "worktree", "add", "-b", branch, dir];
      try {
        execFileSync("git", args, git);
      } catch (err) {
        // そのブランチが別の場所で既に checked out なら、次の連番を試す
        if (/already used by worktree|already checked out/.test(String(err.stderr || ""))) {
          if (lock) releaseWorktree(dir);
          continue;
        }
        if (lock) releaseWorktree(dir);
        throw err;
      }
    }
    return { dir, branch, slot, repoPath };
  }
  throw new Error(
    `${key} の worktree が ${maxSlots} 枠すべて使用中です（実行中か、別の場所で checked out）。limits.parallelWorkers を見てください`,
  );
}

export function releaseWorktree(dir) {
  fs.rmSync(lockPathFor(dir), { force: true });
}

// ワーカーが最後に出力する結果。これ以外は読まない。
// 期待した key / action と突き合わせ、許していない項目や遷移は**拒否する**。
// 黙って捨てるのではなく落とすのは、ワーカーが仕様を誤解したまま進むのを止めるため。
export function parseEnvelope(text, { key, action } = {}) {
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
  for (const field of Object.keys(data)) {
    if (!ENVELOPE_FIELDS.includes(field)) errors.push(`知らない項目: ${field}`);
  }
  if (typeof data.key !== "string") errors.push("key が無い");
  if (key && data.key !== key) errors.push(`key が違う（依頼: ${key} / 返答: ${data.key}）`);

  // status は action ごとの許可リストに載っているものだけ
  if (data.status) {
    const allowed = STATUS_BY_ACTION[action || data.action] || ["needs-human"];
    if (!STATUSES.includes(data.status)) errors.push(`status が不正: ${data.status}`);
    else if (!allowed.includes(data.status)) {
      errors.push(`${action || data.action} から ${data.status} には遷移できない（許可: ${allowed.join(" / ")}）`);
    }
  }

  for (const [i, pr] of (data.prs || []).entries()) {
    if (typeof pr.number !== "number") errors.push(`prs[${i}].number が数値でない`);
    for (const field of Object.keys(pr)) {
      if (!WORKER_PR_FIELDS.includes(field)) {
        errors.push(`prs[${i}].${field} はワーカーからは書けない（マネージャ管轄）`);
      }
    }
  }

  for (const [i, r] of (data.review || []).entries()) {
    const check = validateResult(r);
    if (!check.ok) errors.push(`review[${i}]: ${check.errors.join(" / ")}`);
  }

  // ワーカーは投稿できないので、投稿してほしいコメントはここに載せる
  for (const [i, c] of (data.comments || []).entries()) {
    if (!COMMENT_KINDS.includes(c.kind)) errors.push(`comments[${i}].kind が不正: ${c.kind}`);
    if (!c.body && !c.bodyFile) errors.push(`comments[${i}] に body も bodyFile も無い`);
    if (["approve", "triage"].includes(c.kind) && typeof c.pr !== "number") {
      errors.push(`comments[${i}] に pr（番号）が無い`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, data };
}

// マネージャ側だけが呼ぶ。ロック下で state に反映する。
// 受け取った値のうち、許可した項目だけを写す（parseEnvelope を通っていても二重に絞る）。
export function applyEnvelope(data, { action } = {}) {
  return updateState((state) => {
    const entry = state.issues[data.key];
    if (!entry) throw new Error(`state に未登録: ${data.key}`);

    for (const incoming of data.prs || []) {
      const fields = Object.fromEntries(
        Object.entries(incoming).filter(([k]) => WORKER_PR_FIELDS.includes(k)),
      );
      const existing = (entry.prs || []).find((p) => p.number === incoming.number);
      if (existing) {
        Object.assign(existing, fields);
        // head が動いたらセルフレビューの承認は無効。ワーカーの申告ではなく事実で判断する
        if (fields.headSha && existing.approvedSha && fields.headSha !== existing.approvedSha) {
          existing.selfApproved = false;
          existing.approvedSha = null;
        }
      } else {
        entry.prs = [
          ...(entry.prs || []),
          { order: (entry.prs || []).length + 1, merged: false, selfApproved: false, ...fields },
        ];
      }
    }

    for (const result of data.review || []) {
      const pr = (entry.prs || []).find((p) => p.number === (data.prs?.[0]?.number ?? p.number));
      if (!pr) continue;
      pr.review = pr.review || { round: 0, results: {} };
      pr.review.results[result.reviewer] = result;
    }

    // 指摘対応が終わったことは、ワーカーの自己申告ではなく action から決める
    if (action === "apply-triage" && !data.needs_human) {
      for (const incoming of data.prs || []) {
        const pr = (entry.prs || []).find((p) => p.number === incoming.number);
        if (pr) pr.triageApplied = true;
      }
    }

    if (data.needs_human) setStatus(entry, "needs-human", { workerNotes: data.notes || null });
    else if (data.status) setStatus(entry, data.status, { workerNotes: data.notes || null });
    return { key: data.key, status: entry.status, prs: entry.prs };
  });
}

// 起動コマンドを組み立てる。{prompt} があればその位置に差し込み、無ければ末尾に足す。
// ツールごとの流儀の違いは、この2つ（引数の位置と stdin）だけで吸収できる。
export function buildCommand(worker, prompt) {
  const args = worker.args || [];
  const hasPlaceholder = args.some((a) => a.includes("{prompt}"));
  const argv = args.map((a) => a.replace("{prompt}", prompt));
  // モデル指定。ワーカーは安いモデル、マネージャは良いモデルにするのが基本
  if (worker.model) argv.push(worker.modelFlag || "--model", worker.model);
  if (worker.promptVia !== "stdin" && !hasPlaceholder) argv.push(prompt);
  return { command: worker.command, argv, hasPlaceholder };
}

// ワーカーを1件起動する。並行させたいときは、マネージャがこれを複数同時に呼ぶ。
export function runWorker(config, { key, action, promptFile, dryRun = false }) {
  if ((config.phase ?? 5) < 4) {
    throw new Error(`phase ${config.phase} では実装を動かしません（実装は phase 4 から）`);
  }
  if (!loadState().issues[key]) throw new Error(`state に未登録: ${key}`);
  const prompt = fs.readFileSync(promptFile, "utf8");
  const worker = config.worker;
  const viaStdin = worker.promptVia === "stdin";

  if (dryRun) {
    // --dry-run は副作用なし。worktree もブランチも作らない。
    const plan = planWorktree(config, key);
    const shown = buildCommand(worker, "<prompt>");
    return {
      dryRun: true, key, action,
      cwd: plan.dir, branch: plan.branch, slot: plan.slot, worktreeExists: plan.exists,
      workerCommand: [shown.command, ...shown.argv].join(" "),
      promptVia: viaStdin ? "stdin" : "arg",
    };
  }

  const { dir, branch, slot } = ensureWorktree(config, key, { lock: true });
  const { command, argv } = buildCommand(worker, prompt);

  let res;
  try {
    res = spawnSync(command, argv, {
      cwd: dir,
      encoding: "utf8",
      timeout: (worker.timeoutMin || 30) * 60_000,
      maxBuffer: 64 * 1024 * 1024,
      // stdin は閉じる。開いたままだと EOF を待って止まるCLIがある（codex exec など）
      stdio: viaStdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      input: viaStdin ? prompt : undefined,
      env: { ...process.env, ORCH_ROLE: "worker", ORCH_KEY: key, ORCH_ACTION: action },
    });
  } finally {
    releaseWorktree(dir); // 連番の枠を空ける
  }
  if (res.error) throw new Error(`ワーカーを起動できません: ${res.error.message}`);

  // ワーカーは信用しない実行主体。key・status・書ける項目をすべて突き合わせる。
  const envelope = parseEnvelope(res.stdout || "", { key, action });
  if (!envelope.ok) {
    return {
      ok: false,
      key,
      action,
      cwd: dir,
      slot,
      exitCode: res.status,
      errors: envelope.errors,
      needs_human: true,
      stderr: (res.stderr || "").slice(-2000),
    };
  }
  const applied = applyEnvelope(envelope.data, { action });
  // ワーカーは投稿できない。返ってきた本文はマネージャが投稿する。
  const posted = postEnvelopeComments(envelope.data);
  return {
    ok: true, key, action, cwd: dir, branch, slot,
    exitCode: res.status, applied, posted, envelope: envelope.data,
  };
}

// エンベロープの comments を投稿し、commentId を state に記録する
export function postEnvelopeComments(data) {
  const posted = [];
  for (const c of data.comments || []) {
    let bodyFile = c.bodyFile;
    let temp = null;
    if (!bodyFile) {
      temp = path.join(os.tmpdir(), `orch-comment-${process.pid}-${posted.length}.md`);
      fs.writeFileSync(temp, c.body);
      bodyFile = temp;
    }
    try {
      const result = post({ key: data.key, kind: c.kind, bodyFile, pr: c.pr });
      posted.push({ kind: c.kind, pr: c.pr ?? null, commentId: result.commentId });
    } finally {
      if (temp) fs.rmSync(temp, { force: true });
    }
  }
  return posted;
}
