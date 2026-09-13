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

// 無効化できない組み込みレビュアー（仕様5章）。設定から外れていても必須にする。
export const MANDATORY_STEPS = ["memo-check"];

// この変更で回すべき step の id。マネージャが設定から自分で計算する。
// ワーカーの申告（返ってきた review の中身）から逆算しない。
export function requiredSteps(config, changedFiles = []) {
  const ids = (config.review?.steps || [])
    .filter((step) => matchesWhen(step, changedFiles))
    .map((step) => step.id);
  for (const id of MANDATORY_STEPS) {
    if (!ids.includes(id)) ids.push(id);
  }
  return [...new Set(ids)];
}

// ワーカーが返した review が、必要な step をすべて含んでいるか。
// 足りなければPRを作らない。security を丸ごと飛ばしてマージまで行けてしまうため。
export function missingSteps(config, results = [], changedFiles = []) {
  const got = new Set(results.map((r) => r.reviewer));
  return requiredSteps(config, changedFiles).filter((id) => !got.has(id));
}

// レビューの合否を1か所で決める。ワーカー経路（finishEnvelope）と
// マネージャ経路（review status）で同じ判定を使う。
//
//   step が揃っているか / block の指摘が残っていないか
//
// 揃っているかだけを見ると、「memo-check が block と言っているコード」でも
// PR作成からマージまで進めてしまう。
export function reviewVerdict(config, results = [], changedFiles = []) {
  const missing = missingSteps(config, results, changedFiles);
  const blocking = results
    .flatMap((r) => (r.findings || []).map((f) => ({ ...f, reviewer: r.reviewer })))
    .filter((f) => f.severity === "block");
  return {
    ok: missing.length === 0 && blocking.length === 0,
    missing,
    blocking,
  };
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
        if (parsed.reviewer !== step.id) {
          executed.push({
            id: step.id, ok: false,
            errors: [`step ${step.id} の出力の reviewer が ${parsed.reviewer} になっている`],
          });
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
    // 今回まわす step の古い結果は捨てる。残したままだと、前の round の結果が
    // あるせいで「今回まだ実行していない reviewer」を実行済みと数えてしまう
    const thisRound = [...executed.map((e) => e.id), ...pending.map((x) => x.id)];
    for (const id of thisRound) delete pr.review.results[id];
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
  // step と結果の reviewer が食い違っていたら受け取らない。
  // 受け取ると、別のレビュアーの結果で security を「完了」にできてしまう
  if (parsed.reviewer !== step) {
    return {
      ok: false,
      errors: [`--step ${step} に ${parsed.reviewer} の結果は記録できません（名前を合わせてください）`],
      onError: config.review.onError,
    };
  }
  const known = (config.review?.steps || []).some((s) => s.id === step);
  if (!known) {
    return { ok: false, errors: [`設定に無い step です: ${step}`], onError: config.review.onError };
  }
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
