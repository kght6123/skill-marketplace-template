// 並び順の決定と、次に処理する1件の選択。仕様4.3。
// AI はここが返した1件だけを処理する。順番を自分で決め直さない。
import { blockingCount, listEntries } from "./state.mjs";
import { queueReport } from "./queue.mjs";

// 人間向けの並び順（他人を待たせているもの → 完了に近いもの）
export const HUMAN_KINDS = [
  { kind: "triage", label: "指摘の対応確認", estMin: 5 },
  { kind: "conflict", label: "判断が必要な競合", estMin: 15 },
  { kind: "self-review", label: "セルフレビュー", estMin: 10 },
  { kind: "split", label: "分割案", estMin: 5 },
  { kind: "memo", label: "理解メモ", estMin: 5 },
  { kind: "needs-human", label: "止まっている件", estMin: 15 },
  { kind: "candidate", label: "本文スタンプ候補", estMin: 3 },
  { kind: "audit", label: "事後確認", estMin: 5 },
];

function humanKindOf(entry) {
  if ((entry.prs || []).some((p) => p.triageCommentId && !p.triageApproved)) return "triage";
  if ((entry.prs || []).some((p) => p.conflict === "human")) return "conflict";
  if (entry.status === "pr-review" && (entry.prs || []).some((p) => !p.selfApproved)) {
    return "self-review";
  }
  if (entry.status === "split-review") return "split";
  if (entry.status === "memo-review") return "memo";
  if (entry.status === "needs-human") return "needs-human";
  if (entry.status === "candidate") return "candidate";
  if ((entry.prs || []).some((p) => p.auditPending)) return "audit";
  return null;
}

// 同種内: ブロックしている件数 → Milestoneの期限 → 待ち時間
function compareWithinKind(state) {
  return (a, b) => {
    const blockDiff = blockingCount(state, b.key) - blockingCount(state, a.key);
    if (blockDiff !== 0) return blockDiff;
    const dueA = a.milestoneDue || "9999-12-31";
    const dueB = b.milestoneDue || "9999-12-31";
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    return (a.enteredStatusAt || "") < (b.enteredStatusAt || "") ? -1 : 1;
  };
}

export function humanQueue(state, config, { minutes, project } = {}) {
  const items = [];
  for (const entry of Object.values(state.issues)) {
    const kind = humanKindOf(entry);
    if (!kind) continue;
    const def = HUMAN_KINDS.find((k) => k.kind === kind);
    items.push({ ...entry, kind, estMin: def.estMin, repo: entry.key.split("#")[0] });
  }
  const order = HUMAN_KINDS.map((k) => k.kind);
  items.sort((a, b) => {
    const kindDiff = order.indexOf(a.kind) - order.indexOf(b.kind);
    if (kindDiff !== 0) return kindDiff;
    return compareWithinKind(state)(a, b);
  });

  let picked = items;
  // マルチタスク回避: 一度選んだプロジェクトを優先する（割り込み種別は例外）
  if (project && config.nextTask.focus?.sameProjectFirst) {
    const interrupt = config.nextTask.interrupt || [];
    const same = picked.filter((i) => i.repo === project || interrupt.includes(i.kind));
    if (same.length) picked = same;
  }
  // 空き時間内に終わる1件
  if (minutes) picked = picked.filter((i) => i.estMin <= Number(minutes));
  return { items, top: picked[0] || null };
}

// 規模判定の大小はスクリプトが決める。AI は見積もり値を返すだけ。
export function sizeOf(entry, config) {
  if (!entry.sizing) return null;
  const { estimatedPrs = 0, examples = 0 } = entry.sizing;
  return estimatedPrs > config.sizing.maxPrs || examples > config.sizing.maxExamples
    ? "large"
    : "small";
}

// AI が次に生成すべきもの。null なら AI の出番ではない。
export function workAction(entry, config) {
  switch (entry.status) {
    case "sizing":
      if (!entry.sizing) return "sizing";
      return sizeOf(entry, config) === "large"
        ? entry.depth < config.sizing.maxDepth
          ? "split"
          : null
        : "memo";
    case "waiting-answer":
      return entry.answersReady ? "memo-update" : null;
    case "memo-review":
      return entry.redo ? "memo-redo" : null;
    case "split-review":
      return entry.redo ? "split-redo" : null;
    case "split-done":
      return entry.childrenCreated ? null : "create-children";
    case "ready":
      return "implement";
    case "implementing":
      return "implement-continue";
    case "pr-review":
      if ((entry.prs || []).some((p) => p.triageApproved && !p.triageApplied)) {
        return "apply-triage";
      }
      return null;
    default:
      return null;
  }
}

const MEMO_ACTIONS = ["sizing", "split", "memo", "memo-update", "memo-redo", "split-redo", "create-children"];
const BUILD_ACTIONS = ["implement", "implement-continue", "apply-triage"];

// mode: "memo"（tick）/ "build"（build）
export function selectWork(state, config, mode, limit) {
  const report = queueReport(state, config);
  // 段が届いていなければ、実装は選ばない（人に聞かずに設定で決める）
  if (mode === "build" && (config.phase ?? 5) < 4) {
    return { queue: report, items: [], blocked: "phase", phase: config.phase };
  }
  const allowed = mode === "build" ? BUILD_ACTIONS : MEMO_ACTIONS;
  const max = limit || (mode === "build" ? config.limits.implementPerBuild : config.limits.memoPerTick);

  const candidates = [];
  for (const entry of Object.values(state.issues)) {
    const action = workAction(entry, config);
    if (!action || !allowed.includes(action)) continue;

    // 行列が満杯なら、人間待ちを増やす処理は止める
    const blockedReason = postBlockedReason(action, report);
    if (blockedReason) continue;

    // 依存先がすべて done でなければ着手しない
    if (action === "implement") {
      const unmet = (entry.blockedBy || []).filter(
        (k) => state.issues[k]?.status !== "done",
      );
      if (unmet.length) continue;
    }
    candidates.push({ key: entry.key, action, entry });
  }
  candidates.sort((a, b) => compareWithinKind(state)(a.entry, b.entry));
  return { queue: report, items: candidates.slice(0, max).map(({ key, action }) => ({ key, action })) };
}

function postBlockedReason(action, report) {
  if (["memo", "memo-update", "memo-redo"].includes(action) && !report.canPostMemo) {
    return "memoReview が満杯";
  }
  if (["split", "split-redo"].includes(action) && !report.canPostSplit) {
    return "splitReview が満杯";
  }
  if (["implement", "implement-continue"].includes(action) && !report.canImplement) {
    return "selfReview が満杯";
  }
  return null;
}
