// gh CLI の薄いラッパ。GitHub へのアクセスはすべてここを通す。
import { execFileSync } from "node:child_process";

export class GhError extends Error {}

let dryRun = false;
const dryRunLog = [];

export function setDryRun(value) {
  dryRun = Boolean(value);
}
export function isDryRun() {
  return dryRun;
}
export function dryRunIntents() {
  return dryRunLog;
}

function run(args, { allowFail = false } = {}) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    if (allowFail) return null;
    const detail = (err.stderr || err.message || "").toString().trim();
    throw new GhError(`gh ${args.join(" ")} が失敗: ${detail}`);
  }
}

export function gh(args, opts) {
  return run(args, opts);
}

export function ghJson(args, opts) {
  const out = run(args, opts);
  if (out === null) return null;
  return JSON.parse(out);
}

// 書き込み系。--dry-run のときは実行せず意図だけ記録する。
export function ghWrite(args, { intent } = {}) {
  if (dryRun) {
    dryRunLog.push({ intent: intent || args.join(" "), args });
    return { dryRun: true };
  }
  return run(args);
}

// リアクション（スタンプ）の取得。Issue本文・コメントの両方に使う。
// kind: "issue" | "comment"
export function fetchReactions(nameWithOwner, kind, id) {
  const p = kind === "issue" ? `issues/${id}` : `issues/comments/${id}`;
  const out = ghJson(
    ["api", `repos/${nameWithOwner}/${p}/reactions`, "--paginate"],
    { allowFail: true },
  );
  return out || [];
}

export const REACTION_TO_STAMP = {
  rocket: "🚀",
  eyes: "👀",
  "-1": "👎",
  laugh: "😄",
  heart: "❤️",
};
