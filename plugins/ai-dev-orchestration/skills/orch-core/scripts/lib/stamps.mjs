// スタンプ（リアクション）の有効判定。仕様3.5の共通ルールをここに閉じ込める。
//
//  - 押したのが設定した自分のアカウントであること（他人の同じスタンプには反応しない）
//  - 承認スタンプの作成日時 > コメントの更新日時（古い承認は無効）
//  - 理解メモは確認事項がすべてチェック済みであること
//
// どのリアクションをどの意味に使うかは orch.config.json の stamps で決める。
// ここではリアクション名（rocket / hooray / …）で扱い、絵文字は表示だけに使う。
import { EMOJI } from "./gh.mjs";

// 自分が押したリアクションだけを { rocket: {createdAt}, ... } にまとめる。
// reactions が null（取得できなかった）なら null を返す。
export function ownStamps(reactions, account) {
  if (!Array.isArray(reactions)) return null;
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

// 1つでも配列でも書ける。["rocket", "+1", "heart"] のように複数を同じ意味に割り当てられる。
function toList(value, fallback) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value) return [value];
  return fallback;
}

export function approveNames(config) {
  return toList(config?.stamps?.approve, ["rocket"]);
}
export function parkNames(config) {
  return toList(config?.stamps?.park, ["laugh"]);
}
export function redoNames(config) {
  return toList(config?.stamps?.redo, ["-1", "confused", "eyes"]);
}

export function emojiFor(name) {
  return EMOJI[name] || name;
}
export function emojisFor(names) {
  return names.map(emojiFor).join("");
}

// 押された承認スタンプのうち、有効なものの名前。無ければ null。
// targetUpdatedAt は押した対象（コメント or Issue本文）の更新日時。
export function matchedApprove(stamps, targetUpdatedAt, config) {
  for (const name of approveNames(config)) {
    const stamp = stamps[name];
    if (!stamp) continue;
    if (!targetUpdatedAt || new Date(stamp.createdAt) > new Date(targetUpdatedAt)) return name;
  }
  return null;
}

export function approveIsValid(stamps, targetUpdatedAt, config) {
  return matchedApprove(stamps, targetUpdatedAt, config) !== null;
}

// 押された後回しスタンプの名前。無ければ null。
export function matchedPark(stamps, config) {
  return parkNames(config).find((n) => stamps[n]) || null;
}

export function isParked(stamps, config) {
  return matchedPark(stamps, config) !== null;
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
