// コメントの投稿・上書き・折りたたみ。AI が直接 gh でコメントしないための入口。
// 投稿と同時に commentId を state に記録し、status を進める。
import fs from "node:fs";
import { ghJson, ghWrite, isDryRun } from "./gh.mjs";
import { loadState, saveState, setStatus, parseKey } from "./state.mjs";
import { openQuestions } from "./stamps.mjs";

const KINDS = ["memo", "split", "approve", "triage"];

function postComment(nameWithOwner, number, bodyFile) {
  if (isDryRun()) {
    ghWrite(["api", `repos/${nameWithOwner}/issues/${number}/comments`], {
      intent: `${nameWithOwner}#${number} にコメント投稿`,
    });
    return { id: 0, dryRun: true };
  }
  return ghJson([
    "api", `repos/${nameWithOwner}/issues/${number}/comments`,
    "-f", `body=@${bodyFile}`,
  ]);
}

function updateComment(nameWithOwner, commentId, bodyFile) {
  if (isDryRun()) {
    ghWrite(["api", "-X", "PATCH", `repos/${nameWithOwner}/issues/comments/${commentId}`], {
      intent: `コメント ${commentId} を上書き`,
    });
    return { id: commentId, dryRun: true };
  }
  return ghJson([
    "api", "-X", "PATCH", `repos/${nameWithOwner}/issues/comments/${commentId}`,
    "-f", `body=@${bodyFile}`,
  ]);
}

// 旧コメントは消さずに折りたたむ（履歴を残す）
function collapse(nameWithOwner, commentId) {
  const current = ghJson(["api", `repos/${nameWithOwner}/issues/comments/${commentId}`], {
    allowFail: true,
  });
  if (!current) return;
  if (/^<details>/.test(current.body || "")) return;
  const folded = `<details><summary>旧版（差し替え済み）</summary>\n\n${current.body}\n\n</details>`;
  const tmp = `${process.env.TMPDIR || "/tmp"}/orch-collapse-${commentId}.md`;
  fs.writeFileSync(tmp, folded);
  updateComment(nameWithOwner, commentId, tmp);
  fs.unlinkSync(tmp);
}

export function post({ key, kind, bodyFile, pr, update }) {
  if (!KINDS.includes(kind)) throw new Error(`--kind は ${KINDS.join(" / ")} のいずれか`);
  if (!fs.existsSync(bodyFile)) throw new Error(`本文ファイルが無い: ${bodyFile}`);
  const body = fs.readFileSync(bodyFile, "utf8");
  const state = loadState();
  const entry = state.issues[key];
  if (!entry) throw new Error(`state に未登録: ${key}`);
  const { nameWithOwner, number } = parseKey(key);
  const target = pr ? Number(pr) : number;

  let result;
  if (update && entry.commentId) {
    result = updateComment(nameWithOwner, entry.commentId, bodyFile);
  } else {
    if (entry.commentId && ["memo", "split"].includes(kind)) collapse(nameWithOwner, entry.commentId);
    result = postComment(nameWithOwner, target, bodyFile);
  }

  const transition = { key, from: entry.status, to: entry.status };
  if (kind === "memo") {
    entry.commentId = result.id;
    entry.redo = null;
    entry.answersReady = false;
    const to = openQuestions(body).length ? "waiting-answer" : "memo-review";
    setStatus(entry, to);
    transition.to = to;
  } else if (kind === "split") {
    entry.commentId = result.id;
    entry.redo = null;
    setStatus(entry, "split-review");
    transition.to = "split-review";
  } else if (kind === "approve") {
    const target = (entry.prs || []).find((p) => p.number === Number(pr));
    if (!target) throw new Error(`PR #${pr} が state に無い`);
    target.approvalCommentId = result.id;
    target.selfApproved = false;
    target.approvedSha = target.headSha;
    setStatus(entry, "pr-review");
    transition.to = "pr-review";
  } else if (kind === "triage") {
    const target = (entry.prs || []).find((p) => p.number === Number(pr));
    if (!target) throw new Error(`PR #${pr} が state に無い`);
    target.triageCommentId = result.id;
    target.triageApproved = false;
    target.triageApplied = false;
  }

  saveState(state);
  return { commentId: result.id, transition, dryRun: isDryRun() };
}
