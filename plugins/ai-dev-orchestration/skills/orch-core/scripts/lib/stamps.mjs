// スタンプ（リアクション）の有効判定。仕様3.5の共通ルールをここに閉じ込める。
//
//  - 押したのが設定した自分のアカウントであること（他人の同じスタンプには反応しない）
//  - 承認スタンプの作成日時 > コメントの更新日時（古い承認は無効）
//  - 理解メモは確認事項がすべてチェック済みであること
//
// どのリアクションをどの意味に使うかは orch.config.json の stamps で決める。
// ここではリアクション名（rocket / hooray / …）で扱い、絵文字は表示だけに使う。
import { EMOJI } from "./gh.mjs";

// 自分が押したリアクションだけを { rocket: {createdAt}, ... } にまとめる
export function ownStamps(reactions, account) {
  const out = {};
  for (const r of reactions || []) {
    const login = r.user?.login;
    if (account && login !== account) continue;
    const name = r.content;
    if (!EMOJI[name]) continue;
    const createdAt = r.created_at;
    if (!out[name] || out[name].createdAt < createdAt) out[name] = { createdAt, login };
  }
  return out;
}

export function approveName(config) {
  return config?.stamps?.approve || "rocket";
}
export function parkName(config) {
  return config?.stamps?.park || "laugh";
}
export function redoNames(config) {
  return config?.stamps?.redo || ["-1", "confused", "eyes"];
}

export function emojiFor(name) {
  return EMOJI[name] || name;
}

// 承認スタンプが有効か。targetUpdatedAt は押した対象（コメント or Issue本文）の更新日時。
export function approveIsValid(stamps, targetUpdatedAt, config) {
  const stamp = stamps[approveName(config)];
  if (!stamp) return false;
  if (!targetUpdatedAt) return true;
  return new Date(stamp.createdAt) > new Date(targetUpdatedAt);
}

export function isParked(stamps, config) {
  return Boolean(stamps[parkName(config)]);
}

// 作り直しを求めるスタンプ。押されていれば絵文字を返す。
export function redoStamp(stamps, config) {
  const name = redoNames(config).find((n) => stamps[n]);
  return name ? emojiFor(name) : null;
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
