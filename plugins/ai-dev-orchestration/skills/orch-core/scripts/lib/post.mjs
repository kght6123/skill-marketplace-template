// コメントの投稿・上書き・折りたたみ。AI が直接 gh でコメントしないための入口。
// 投稿と同時に commentId を state に記録し、status を進める。
import fs from "node:fs";
import { ghJson, ghWrite, isDryRun } from "./gh.mjs";
import { loadState, updateState, setStatus, parseKey } from "./state.mjs";
import { openQuestions } from "./stamps.mjs";

const KINDS = ["memo", "split", "approve", "triage"];

// gh の -f/--raw-field は文字列をそのまま渡す。ファイルを読ませるのは -F/--field。
// -f で書くと "@/tmp/memo.md" という文字列が本文として投稿される。
export function commentArgs({ nameWithOwner, number, commentId, bodyFile }) {
  const path = commentId
    ? `repos/${nameWithOwner}/issues/comments/${commentId}`
    : `repos/${nameWithOwner}/issues/${number}/comments`;
  const method = commentId ? ["-X", "PATCH"] : [];
  return ["api", ...method, path, "-F", `body=@${bodyFile}`];
}

function postComment(nameWithOwner, number, bodyFile) {
  if (isDryRun()) {
    ghWrite(["api", `repos/${nameWithOwner}/issues/${number}/comments`], {
      intent: `${nameWithOwner}#${number} にコメント投稿`,
    });
    return { id: 0, dryRun: true };
  }
  return ghJson(commentArgs({ nameWithOwner, number, bodyFile }));
}

function updateComment(nameWithOwner, commentId, bodyFile) {
  if (isDryRun()) {
    ghWrite(["api", "-X", "PATCH", `repos/${nameWithOwner}/issues/comments/${commentId}`], {
      intent: `コメント ${commentId} を上書き`,
    });
    return { id: commentId, dryRun: true };
  }
  return ghJson(commentArgs({ nameWithOwner, commentId, bodyFile }));
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
  const snapshot = loadState().issues[key];
  if (!snapshot) throw new Error(`state に未登録: ${key}`);
  const { nameWithOwner, number } = parseKey(key);
  const target = pr ? Number(pr) : number;

  // 更新するコメントは kind ごとに違う。memo/split は entry、
  // approve/triage は対象PRのもの。ここを取り違えると別のコメントを書き換える。
  const snapshotPr = (snapshot.prs || []).find((p) => p.number === Number(pr));
  const existingId = {
    memo: snapshot.commentId,
    split: snapshot.commentId,
    approve: snapshotPr?.approvalCommentId,
    triage: snapshotPr?.triageCommentId,
  }[kind];

  let result;
  if (update) {
    if (!existingId) throw new Error(`--update の対象コメントが state に無い（kind: ${kind}）`);
    result = updateComment(nameWithOwner, existingId, bodyFile);
  } else {
    if (existingId && ["memo", "split"].includes(kind)) collapse(nameWithOwner, existingId);
    result = postComment(nameWithOwner, target, bodyFile);
  }

  // ここから先が state の更新。ネットワークを終えてからロックを取る。
  return updateState((state) => {
    const entry = state.issues[key];
    if (!entry) throw new Error(`state に未登録: ${key}`);
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

    return { commentId: result.id, transition, dryRun: isDryRun() };
  });
}
