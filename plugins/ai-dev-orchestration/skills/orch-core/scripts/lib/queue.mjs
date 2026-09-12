// 行列の件数と WIP 上限。投稿を伴う処理の前に必ずこれを見る。
// 「AIが作るほど人間の行列が伸びる」のを止めるのはここ。
import { listEntries } from "./state.mjs";

export const QUEUES = {
  memoReview: { statuses: ["memo-review"], label: "メモ承認待ち" },
  splitReview: { statuses: ["split-review"], label: "分割案承認待ち" },
  selfReview: { statuses: ["pr-review"], label: "セルフ／レビュアー待ち" },
};

export function queueReport(state, config) {
  const queues = {};
  for (const [name, def] of Object.entries(QUEUES)) {
    const count = listEntries(state, { statuses: def.statuses }).length;
    const limit = config.wip[name];
    queues[name] = {
      label: def.label,
      count,
      limit,
      full: count >= limit,
      room: Math.max(0, limit - count),
    };
  }
  const needsHuman = listEntries(state, { status: "needs-human" }).length;
  return {
    queues,
    needsHuman,
    // 新規に人間待ちを増やしてよいか
    canPostMemo: !queues.memoReview.full,
    canPostSplit: !queues.splitReview.full,
    canImplement: !queues.selfReview.full,
  };
}

export function renderQueue(report) {
  const lines = Object.entries(report.queues).map(
    ([, q]) => `  ${q.label.padEnd(18)} ${q.count}/${q.limit}${q.full ? "  ⚠ 満杯" : ""}`,
  );
  lines.push(`  needs-human        ${report.needsHuman}`);
  return lines.join("\n");
}
