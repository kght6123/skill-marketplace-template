// AIレビューの pipeline。仕様5章。
// command / builtin はスクリプトが実行し、skill / subagent は AI が実行して結果を record する。
// 出力形式の検証と、修正するか needs-human にするかの判定はスクリプト側。
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadState, updateState } from "./state.mjs";

const SEVERITIES = ["block", "warn", "info"];

export function validateResult(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["JSONオブジェクトではない"] };
  if (typeof raw.reviewer !== "string") errors.push("reviewer が無い");
  if (!Array.isArray(raw.findings)) errors.push("findings が配列ではない");
  for (const [i, f] of (raw.findings || []).entries()) {
    if (!SEVERITIES.includes(f.severity)) errors.push(`findings[${i}].severity が不正`);
    if (typeof f.message !== "string" || !f.message) errors.push(`findings[${i}].message が空`);
  }
  return { ok: errors.length === 0, errors };
}

function matchesWhen(step, changedFiles) {
  const paths = step.when?.paths;
  if (!paths || !paths.length) return true;
  return paths.some((p) => {
    const re = new RegExp(
      "^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "::").replace(/\*/g, "[^/]*").replace(/::/g, ".*") + "$",
    );
    return changedFiles.some((f) => re.test(f));
  });
}

function prRecord(state, key, prNumber) {
  const entry = state.issues[key];
  if (!entry) throw new Error(`state に未登録: ${key}`);
  const pr = (entry.prs || []).find((p) => p.number === Number(prNumber));
  if (!pr) throw new Error(`PR #${prNumber} が state に無い`);
  pr.review = pr.review || { round: 0, results: {} };
  return { entry, pr };
}

// command 型を実行し、AI が回すべき step を返す
export function run(config, { key, pr: prNumber, changedFiles = [] }) {
  prRecord(loadState(), key, prNumber); // 先に存在確認だけする
  const collected = {};
  const executed = [];
  const pending = [];
  for (const step of config.review.steps || []) {
    if (!matchesWhen(step, changedFiles)) continue;
    if (step.command) {
      try {
        const out = execFileSync("sh", ["-c", step.command], { encoding: "utf8" });
        const parsed = JSON.parse(out);
        const check = validateResult(parsed);
        if (!check.ok) {
          executed.push({ id: step.id, ok: false, errors: check.errors });
          continue;
        }
        collected[step.id] = parsed;
        executed.push({ id: step.id, ok: true, findings: parsed.findings.length });
      } catch (err) {
        executed.push({ id: step.id, ok: false, errors: [String(err.message || err)] });
      }
    } else {
      pending.push({ id: step.id, type: step.skill ? "skill" : step.subagent ? "subagent" : "builtin", ref: step.skill || step.subagent || step.builtin });
    }
  }
  // コマンドの実行が終わってからロックを取る
  return updateState((state) => {
    const { pr } = prRecord(state, key, prNumber);
    pr.review.round += 1;
    Object.assign(pr.review.results, collected);
    // どの step を回すはずだったか、どれが失敗したかを残す。
    // 失敗を「指摘ゼロ」と同じ扱いにしないための材料。
    pr.review.expected = [...executed.map((e) => e.id), ...pending.map((p) => p.id)];
    pr.review.errors = executed.filter((e) => !e.ok).map((e) => ({ id: e.id, errors: e.errors }));
    return { round: pr.review.round, executed, pending, expected: pr.review.expected };
  });
}

// AI が実行した step の結果を受け取る
export function record(config, { key, pr: prNumber, step, resultFile }) {
  const parsed = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  const check = validateResult(parsed);
  if (!check.ok) return { ok: false, errors: check.errors, onError: config.review.onError };
  return updateState((state) => {
    const { pr } = prRecord(state, key, prNumber);
    pr.review.results[step] = parsed;
    return { ok: true, step, findings: parsed.findings.length };
  });
}

// 集計と判定。block が残っていれば修正、maxRounds 超過なら needs-human。
export function status(config, { key, pr: prNumber }) {
  const state = loadState();
  const { pr } = prRecord(state, key, prNumber);
  const results = Object.values(pr.review?.results || {});
  const all = results.flatMap((r) => r.findings.map((f) => ({ ...f, reviewer: r.reviewer })));
  const blocking = all.filter((f) => f.severity === "block");
  const round = pr.review?.round || 0;

  // 実行できなかった step と、結果が返っていない step。
  // レビューが落ちたのに「指摘ゼロ」で通す方が、block を見逃すより危ない。
  const failed = pr.review?.errors || [];
  const expected = pr.review?.expected || [];
  const missing = expected.filter((id) => !(id in (pr.review?.results || {})));
  const incomplete = [...new Set([...failed.map((f) => f.id), ...missing])];

  let decision = "pass";
  if (blocking.length) {
    decision = round >= config.review.maxRounds ? "needs-human" : "fix";
  }
  if (incomplete.length && config.review.onError === "needs-human") {
    // onError: "skip" なら、落ちた step を飛ばして判定を続ける
    decision = "needs-human";
  }
  if (decision === "needs-human") {
    updateState((fresh) => {
      const entry = fresh.issues[key];
      entry.status = "needs-human";
      entry.unresolvedFindings = blocking;
      entry.incompleteReviewers = incomplete;
    });
  }
  return {
    decision,
    incomplete,
    round,
    maxRounds: config.review.maxRounds,
    blocking,
    warn: all.filter((f) => f.severity === "warn"),
    info: all.filter((f) => f.severity === "info"),
    needs_human: decision === "needs-human",
  };
}
