// state.json の読み書き。AI は必ずこのモジュール経由（orch state ...）で触る。
import fs from "node:fs";
import path from "node:path";
import { ORCH_HOME } from "./config.mjs";

export const STATE_PATH = path.join(ORCH_HOME, "state.json");

// 仕様2章の status 一覧。candidate は「本文に🚀がまだ無いIssue」で、
// next-task の並び順7「本文スタンプ候補」を出すために追加したもの。
export const STATUSES = [
  "candidate",
  "sizing",
  "split-review",
  "split-done",
  "waiting-answer",
  "memo-review",
  "ready",
  "implementing",
  "pr-review",
  "needs-human",
  "parked",
  "done",
];

// 人間待ちの status。ここが行列になる。
export const HUMAN_WAITING = ["split-review", "memo-review", "pr-review", "needs-human"];

export function emptyState() {
  return { version: 1, updatedAt: null, lastSync: null, issues: {} };
}

export function loadState() {
  if (!fs.existsSync(STATE_PATH)) return emptyState();
  const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  return { ...emptyState(), ...parsed };
}

const LOCK_PATH = `${STATE_PATH}.lock`;
const LOCK_STALE_MS = 60_000;

function holderIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0); // シグナルは送らず、存在だけ確かめる
    return true;
  } catch (err) {
    return err.code === "EPERM"; // 他ユーザーのプロセス = 生きている
  }
}

// 書き込みの排他。ワーカーを並行させても更新が消えないようにする。
//
// ロックの中でネットワークを叩かないこと。保持が長引くと stale 判定に
// 引っかかり、生きているロックを別プロセスに消される。
export function withLock(fn, { timeoutMs = 10_000 } = {}) {
  fs.mkdirSync(ORCH_HOME, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  // 中身を書いてから link する。open(wx) → write の順だと、
  // 書き込み前の空ファイルを別プロセスが「持ち主不明＝死んでいる」と読み、
  // 生きているロックを奪ってしまう（二重取得 → 更新が消える）。
  const staging = `${LOCK_PATH}.${process.pid}`;
  fs.writeFileSync(staging, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));

  try {
    for (;;) {
      try {
        fs.linkSync(staging, LOCK_PATH); // 存在すれば EEXIST。中身は最初から完全
        break;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
        let raw = null;
        let age = 0;
        try {
          raw = fs.readFileSync(LOCK_PATH, "utf8");
          age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
        } catch (readErr) {
          if (readErr.code === "ENOENT") continue; // 直前に外れた。取り直す
          throw readErr;
        }
        let pid = null;
        try {
          pid = JSON.parse(raw).pid;
        } catch {
          pid = null; // 旧形式や壊れたロック。持ち主は不明
        }
        // 持ち主が確かに死んでいれば即座に剥がす。
        // 不明なときは奪わず、経過時間だけで判断する。
        const dead = pid !== null && !holderIsAlive(pid);
        if (dead || age > LOCK_STALE_MS) {
          fs.rmSync(LOCK_PATH, { force: true });
          continue;
        }
        if (Date.now() > deadline) {
          throw new Error(`state.json のロックを取得できません（保持: pid ${pid ?? "不明"}）`);
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  } finally {
    fs.rmSync(staging, { force: true });
  }

  try {
    return fn();
  } finally {
    fs.rmSync(LOCK_PATH, { force: true });
  }
}

export function saveState(state) {
  fs.mkdirSync(ORCH_HOME, { recursive: true });
  state.updatedAt = new Date().toISOString();
  const tmp = `${STATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, STATE_PATH); // 書き込み中に CLI が読んでも壊れないように
  return state;
}

// 読み込み → 変更 → 保存 を排他して行う。state を変える処理は必ずこれを使う。
export function updateState(fn) {
  return withLock(() => {
    const state = loadState();
    const result = fn(state);
    saveState(state);
    return result;
  });
}

// "org/repo#123" を分解する
export function parseKey(key) {
  const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(key);
  if (!m) throw new Error(`不正なキー: ${key}（org/repo#123 の形式）`);
  return { owner: m[1], repo: m[2], nameWithOwner: `${m[1]}/${m[2]}`, number: Number(m[3]) };
}

export function newEntry(key, overrides = {}) {
  return {
    key,
    depth: 1,
    parent: null,
    status: "candidate",
    commentId: null,
    approvedBy: null,
    blockedBy: [],
    prs: [],
    title: null,
    milestoneDue: null,
    enteredStatusAt: new Date().toISOString(),
    ...overrides,
  };
}

export function setStatus(entry, status, extra = {}) {
  if (!STATUSES.includes(status)) throw new Error(`未知の status: ${status}`);
  if (entry.status !== status) entry.enteredStatusAt = new Date().toISOString();
  entry.status = status;
  Object.assign(entry, extra);
  return entry;
}

export function listEntries(state, filter = {}) {
  return Object.values(state.issues).filter((e) => {
    if (filter.status && e.status !== filter.status) return false;
    if (filter.statuses && !filter.statuses.includes(e.status)) return false;
    if (filter.repo && !e.key.startsWith(`${filter.repo}#`)) return false;
    return true;
  });
}

// entry をブロックしている件数（並び順の第一キー）
export function blockingCount(state, key) {
  return Object.values(state.issues).filter((e) => (e.blockedBy || []).includes(key)).length;
}
