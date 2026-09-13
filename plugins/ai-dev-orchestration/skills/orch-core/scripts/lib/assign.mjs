// レビュアーの割り当て。仕様「レビュアー」節の3行をスクリプトで決定的に行う。
//
//   assign: one       … 依頼中件数が最少の人。同数なら設定の並び順
//   同じスタック       … 2本目以降も同じ人（文脈を知っている方が速い）
//   全員が上限         … 依頼を保留し、next に「レビュアー待ち」として出す
//
// AI に「誰が空いていそうか」を考えさせない。ここが揺れると、
// 特定の人に偏って人間側の行列が伸びる。
import { loadState, updateState, parseKey } from "./state.mjs";
import { reviewersFor } from "./config.mjs";
import { gh, isDryRun } from "./gh.mjs";

// 今その人に何件レビューを依頼しているか（マージ済みは数えない）
export function openCounts(state, users) {
  const counts = Object.fromEntries(users.map((u) => [u, 0]));
  for (const entry of Object.values(state.issues)) {
    for (const pr of entry.prs || []) {
      if (pr.merged || !pr.reviewer) continue;
      if (pr.reviewer in counts) counts[pr.reviewer] += 1;
    }
  }
  return counts;
}

// 誰に割り当てるかを決める。実際に依頼は送らない（判定だけを分けてテストしやすくする）。
export function pickReviewer(state, config, key, prNumber) {
  const entry = state.issues[key];
  if (!entry) return { ok: false, reason: `state に未登録: ${key}` };
  const pr = (entry.prs || []).find((p) => p.number === Number(prNumber));
  if (!pr) return { ok: false, reason: `PR #${prNumber} が state に無い` };
  if (pr.reviewer) return { ok: true, reviewer: pr.reviewer, already: true };

  const { repo } = parseKey(key);
  const settings = reviewersFor(config, repo);
  const users = settings.users || [];
  if (!users.length) return { ok: false, reason: "reviewers.users が空（設定されていない）" };

  // 同じスタックの先行PRに割り当て済みの人がいれば、その人を引き継ぐ
  const inherited = (entry.prs || [])
    .filter((p) => p.reviewer && p.order < (pr.order ?? Infinity))
    .sort((a, b) => (b.order || 0) - (a.order || 0))[0]?.reviewer;
  if (inherited && users.includes(inherited)) {
    return { ok: true, reviewer: inherited, inherited: true };
  }

  const counts = openCounts(state, users);
  const limit = settings.maxOpenPerReviewer ?? 3;
  const available = users.filter((u) => counts[u] < limit);
  if (!available.length) {
    return { ok: false, waiting: true, reason: "全員が上限に達している（レビュアー待ち）", counts, limit };
  }
  // 最少件数。同数なら設定の並び順（users の先頭が勝つ）
  const reviewer = available.reduce((best, u) => (counts[u] < counts[best] ? u : best), available[0]);
  return { ok: true, reviewer, counts, limit };
}

// 選んで、GitHub にレビュー依頼を出し、state に記録する。
export function assignReviewer(config, { key, pr: prNumber }) {
  const decision = pickReviewer(loadState(), config, key, prNumber);
  if (!decision.ok || decision.already) return decision;

  const { nameWithOwner } = parseKey(key);
  if (!isDryRun()) {
    gh(["pr", "edit", String(prNumber), "--repo", nameWithOwner, "--add-reviewer", decision.reviewer]);
  }
  return updateState((state) => {
    const pr = (state.issues[key]?.prs || []).find((p) => p.number === Number(prNumber));
    if (!pr) throw new Error(`PR #${prNumber} が state に無い`);
    pr.reviewer = decision.reviewer;
    pr.reviewRequestedAt = new Date().toISOString();
    return { ok: true, key, pr: Number(prNumber), ...decision, dryRun: isDryRun() };
  });
}

// セルフレビューが済んでレビュアー未割り当てのPR。sync が「次にやること」として返す。
export function needsReviewer(state) {
  const out = [];
  for (const entry of Object.values(state.issues)) {
    if (entry.status !== "pr-review") continue;
    for (const pr of entry.prs || []) {
      if (pr.merged || pr.reviewer || !pr.selfApproved) continue;
      out.push({ key: entry.key, pr: pr.number });
    }
  }
  return out;
}
