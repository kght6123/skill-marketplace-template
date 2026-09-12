// スタンプ（リアクション）の有効判定。仕様3.5の共通ルールをここに閉じ込める。
//
//  - 押したのが設定した自分のアカウントであること（他人の同じスタンプには反応しない）
//  - 🚀の作成日時 > コメントの更新日時（古い🚀は無効）
//  - 理解メモは確認事項がすべてチェック済みであること
import { REACTION_TO_STAMP } from "./gh.mjs";

// 自分が押したスタンプだけを { "🚀": {createdAt}, ... } にまとめる
export function ownStamps(reactions, account) {
  const out = {};
  for (const r of reactions || []) {
    const login = r.user?.login;
    if (account && login !== account) continue;
    const stamp = REACTION_TO_STAMP[r.content];
    if (!stamp) continue;
    const createdAt = r.created_at;
    if (!out[stamp] || out[stamp].createdAt < createdAt) out[stamp] = { createdAt, login };
  }
  return out;
}

// 🚀 が有効か。targetUpdatedAt はスタンプを押した対象（コメント or Issue本文）の更新日時。
export function rocketIsValid(stamps, targetUpdatedAt) {
  const rocket = stamps["🚀"];
  if (!rocket) return false;
  if (!targetUpdatedAt) return true;
  return new Date(rocket.createdAt) > new Date(targetUpdatedAt);
}

// 作り直しを求めるスタンプ（仕様3.1のフッタ）
export const REDO_STAMPS = ["👎", "😄", "❤️"];

export function redoStamp(stamps) {
  return REDO_STAMPS.find((s) => stamps[s]) || null;
}

// 確認事項がすべてチェック済みか。未チェックが1つでもあれば false。
export function allQuestionsAnswered(body) {
  return !/^\s*[-*]\s*\[ \]/m.test(body || "");
}

// 未チェックの確認事項を返す
export function openQuestions(body) {
  return (body || "")
    .split("\n")
    .filter((l) => /^\s*[-*]\s*\[ \]/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s*\[ \]\s*/, "").trim());
}
