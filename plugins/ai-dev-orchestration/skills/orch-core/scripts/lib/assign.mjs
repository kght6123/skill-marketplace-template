// レビュアーの割り当て。仕様「レビュアー」節をスクリプトで決定的に行う。
//
//   assign: one       … 依頼中件数が最少の人。同数なら設定の並び順
//   assign: all       … 設定のユーザー全員（上限に余裕がある人だけ）
//   同じスタック       … 2本目以降も同じ人（文脈を知っている方が速い）
//   上限に達していれば … 依頼を保留する（引き継ぎでも上限は超えない）
//   away              … 選ばない
//
// AI に「誰が空いていそうか」を考えさせない。ここが揺れると、
// 特定の人に偏って人間側の行列が伸びる。
import os from "node:os";
import crypto from "node:crypto";
import { loadState, updateState, parseKey, processIsAlive } from "./state.mjs";
import { reviewersFor } from "./config.mjs";
import { gh, isDryRun } from "./gh.mjs";

// 予約は期限付きにする。GitHub に依頼を送る途中でプロセスが落ちると、
// 期限が無ければ reviewerPending が残り続けて誰にも割り当てられなくなる。
const RESERVE_TTL_MS = 5 * 60_000;

function reservationIsLive(res) {
  if (!res || !res.reviewers?.length) return false;
  if (res.hostname === os.hostname() && res.pid && processIsAlive(res.pid)) return true;
  return new Date(res.expiresAt || 0).getTime() > Date.now();
}

// その人に今いくつ依頼しているか（マージ済みは数えない）。
// 予約中（reviewerPending）も数える。2つのマネージャが同時に割り当てたとき、
// 両方が「空いている」と判断して上限を超えるのを防ぐ。
export function openCounts(state, users) {
  const counts = Object.fromEntries(users.map((u) => [u, 0]));
  for (const entry of Object.values(state.issues)) {
    for (const pr of entry.prs || []) {
      if (pr.merged) continue;
      const pending = reservationIsLive(pr.reviewerPending) ? pr.reviewerPending.reviewers : [];
      for (const who of [...(pr.reviewers || []), ...pending]) {
        if (who in counts) counts[who] += 1;
      }
    }
  }
  return counts;
}

function settingsFor(config, key) {
  // reviewers.repos のキーは org/repo 形式。短いリポジトリ名で引くと
  // リポジトリ別の設定が黙って無視される
  const { nameWithOwner } = parseKey(key);
  return reviewersFor(config, nameWithOwner);
}

// 誰に割り当てるかを決める。依頼は送らない（判定だけを分けてテストしやすくする）。
export function pickReviewers(state, config, key, prNumber) {
  const entry = state.issues[key];
  if (!entry) return { ok: false, reason: `state に未登録: ${key}` };
  const pr = (entry.prs || []).find((p) => p.number === Number(prNumber));
  if (!pr) return { ok: false, reason: `PR #${prNumber} が state に無い` };
  if ((pr.reviewers || []).length) {
    return { ok: true, reviewers: pr.reviewers, already: true };
  }

  const settings = settingsFor(config, key);
  const users = settings.users || [];
  if (!users.length) return { ok: false, reason: "reviewers.users が空（設定されていない）" };

  const counts = openCounts(state, users);
  const limit = settings.maxOpenPerReviewer ?? 3;
  const hasRoom = (u) => counts[u] < limit;

  // 同じスタックの先行PRに割り当て済みの人を引き継ぐ。
  // ただし上限は超えない。引き継ぎを理由に超えると「人間の処理量を上限にする」が崩れる
  const inherited = (entry.prs || [])
    .filter((p) => (p.reviewers || []).length && p.order < (pr.order ?? Infinity))
    .sort((a, b) => (b.order || 0) - (a.order || 0))[0]?.reviewers;
  if (inherited) {
    const keep = inherited.filter((u) => users.includes(u) && hasRoom(u));
    if (keep.length === inherited.filter((u) => users.includes(u)).length && keep.length) {
      return { ok: true, reviewers: keep, inherited: true, counts, limit };
    }
    return {
      ok: false, waiting: true, inherited: true, counts, limit,
      reason: `引き継ぎ先（${inherited.join(", ")}）が上限に達している`,
    };
  }

  const available = users.filter(hasRoom);
  if (!available.length) {
    return { ok: false, waiting: true, counts, limit, reason: "全員が上限に達している（レビュアー待ち）" };
  }

  if ((settings.assign || "one") === "all") {
    // 全員に依頼する設定。上限に余裕がある人だけに送る
    return { ok: true, reviewers: available, assign: "all", counts, limit };
  }
  // 最少件数。同数なら設定の並び順（users の先頭が勝つ）
  const one = available.reduce((best, u) => (counts[u] < counts[best] ? u : best), available[0]);
  return { ok: true, reviewers: [one], assign: "one", counts, limit };
}

// 選んで、GitHub にレビュー依頼を出し、state に記録する。
//
// 「決める」と「記録する」の間に GitHub を挟むので、先に state で枠を予約してから送る。
// 予約せずに送ると、2つのマネージャが同時に同じPRへ依頼を出し、
// GitHub 上は2人に依頼済みなのに state は最後の1人しか覚えていない状態になる。
export function assignReviewers(config, { key, pr: prNumber }) {
  const reserved = updateState((state) => {
    const decision = pickReviewers(state, config, key, prNumber);
    if (!decision.ok || decision.already) return decision;
    const pr = (state.issues[key]?.prs || []).find((p) => p.number === Number(prNumber));
    if (reservationIsLive(pr.reviewerPending)) {
      return { ok: false, reason: "別のマネージャが割り当て中", pending: pr.reviewerPending };
    }
    // 枠を押さえる。期限と持ち主を書いておき、落ちても回収できるようにする
    pr.reviewerPending = {
      id: crypto.randomUUID(),
      reviewers: decision.reviewers,
      pid: process.pid,
      hostname: os.hostname(),
      expiresAt: new Date(Date.now() + RESERVE_TTL_MS).toISOString(),
    };
    return { ...decision, reservationId: pr.reviewerPending.id };
  });
  if (!reserved.ok || reserved.already) return reserved;

  const { nameWithOwner } = parseKey(key);
  try {
    if (!isDryRun()) {
      gh(["pr", "edit", String(prNumber), "--repo", nameWithOwner,
        "--add-reviewer", reserved.reviewers.join(",")]);
    }
  } catch (err) {
    // 送れなかったら予約を戻す。戻さないと誰にも割り当てられなくなる
    updateState((state) => {
      const pr = (state.issues[key]?.prs || []).find((p) => p.number === Number(prNumber));
      if (pr?.reviewerPending?.id === reserved.reservationId) pr.reviewerPending = null;
      return true;
    });
    throw err;
  }

  return updateState((state) => {
    const pr = (state.issues[key]?.prs || []).find((p) => p.number === Number(prNumber));
    if (!pr) throw new Error(`PR #${prNumber} が state に無い`);
    pr.reviewers = reserved.reviewers;
    pr.reviewerPending = null;
    pr.reviewRequestedAt = new Date().toISOString();
    return { ok: true, key, pr: Number(prNumber), ...reserved, dryRun: isDryRun() };
  });
}

// 落ちて残った予約を回収する。期限が切れていて、持ち主も生きていないものだけ。
export function reapReservations() {
  return updateState((state) => {
    const reaped = [];
    for (const entry of Object.values(state.issues)) {
      for (const pr of entry.prs || []) {
        if (pr.reviewerPending && !reservationIsLive(pr.reviewerPending)) {
          reaped.push({ key: entry.key, pr: pr.number, reviewers: pr.reviewerPending.reviewers });
          pr.reviewerPending = null;
        }
      }
    }
    return { reaped };
  });
}

// セルフレビューが済んでレビュアー未割り当てのPR。sync が「次にやること」として返す。
export function needsReviewer(state) {
  const out = [];
  for (const entry of Object.values(state.issues)) {
    if (entry.status !== "pr-review") continue;
    for (const pr of entry.prs || []) {
      if (pr.merged || (pr.reviewers || []).length || !pr.selfApproved) continue;
      if (reservationIsLive(pr.reviewerPending)) continue; // 割り当て中
      out.push({ key: entry.key, pr: pr.number });
    }
  }
  return out;
}
