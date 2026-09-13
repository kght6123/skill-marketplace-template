// 論理タスクの予約（lease）。
//
// worktree のロックは「同じディレクトリに2本入らない」ためのもので、
// 「同じ Issue を2本のマネージャが実装しない」ためのものではない。
// マネージャを2つ動かすと、どちらの orch next も同じ ready な Issue を選べてしまい、
// 同じ実装・同じPR・同じコメントが二重に作られ、WIP 上限も超える。
//
// そこで「選ぶ」と「予約する」を1つのロックの中でやる。lease を取れた側だけが処理する。
import os from "node:os";
import crypto from "node:crypto";
import { updateState, loadState, processIsAlive } from "./state.mjs";

// 既定の有効期限。ワーカーのタイムアウトより長めに取る（途中で他人に奪われないため）
function ttlMs(config) {
  const workerMin = config?.worker?.timeoutMin || 30;
  return (config?.limits?.leaseTtlMin || workerMin * 2) * 60_000;
}

// その lease がまだ生きているか。
//
// 判定は期限が主。予約を取るのは短命な `orch next --claim` で、実際に処理するのは
// その後の別プロセスなので、取った側の PID の生死で見ると取った瞬間に無効になる。
//
// PID は「期限を延ばす」方向にだけ使う。同じホストで持ち主がまだ動いていれば、
// 期限を過ぎていても奪わない（正常に長く動いているワーカーの横取りを防ぐ）。
export function leaseIsLive(lease) {
  if (!lease) return false;
  if (new Date(lease.expiresAt).getTime() > Date.now()) return true;
  return lease.hostname === os.hostname() && Boolean(lease.pid) && processIsAlive(lease.pid);
}

export function liveLeases(state) {
  return Object.values(state.issues)
    .filter((e) => leaseIsLive(e.lease))
    .map((e) => ({ key: e.key, ...e.lease }));
}

function makeLease(action, config) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    action,
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs(config)).toISOString(),
  };
}

// 選択と予約を1トランザクションにする。select は (state) => items を返す関数。
// ロックの中で最新の state を読み直してから選ぶので、
// 2つのマネージャが同時に走っても、同じ件を両方が取ることはない。
export function claimWork(config, select) {
  return updateState((state) => {
    const items = select(state);
    const claimed = [];
    for (const item of items) {
      const entry = state.issues[item.key];
      if (!entry || leaseIsLive(entry.lease)) continue; // 直前に他が取った
      entry.lease = makeLease(item.action, config);
      claimed.push({ ...item, leaseId: entry.lease.id });
    }
    return { items: claimed, leases: liveLeases(state) };
  });
}

// 予約を返す。id を渡した場合は、自分が取ったものだけを外す。
export function releaseLease(key, id = null) {
  return updateState((state) => {
    const entry = state.issues[key];
    if (!entry) throw new Error(`state に未登録: ${key}`);
    const current = entry.lease;
    if (!current) return { key, released: false, reason: "予約が無い" };
    if (id && current.id !== id) {
      return { key, released: false, reason: `別の予約が入っている（${current.id}）` };
    }
    entry.lease = null;
    return { key, released: true, leaseId: current.id };
  });
}

// 期限切れ・持ち主が死んだ予約を掃除する
export function reapLeases() {
  return updateState((state) => {
    const reaped = [];
    for (const entry of Object.values(state.issues)) {
      if (entry.lease && !leaseIsLive(entry.lease)) {
        reaped.push({ key: entry.key, leaseId: entry.lease.id, action: entry.lease.action });
        entry.lease = null;
      }
    }
    return { reaped };
  });
}

// ワーカーが終わった「後」に、開始時の前提がまだ成り立っているかを確かめる。
//
// 開始時に予約を取っても、走っている間に人間が 😄 や needs-human にできる。
// 再確認せずに反映すると、古いワーカーの結果が人間の停止操作を上書きしてしまう。
// 外部への副作用（PR作成・コメント投稿）より前に必ず通す。
const START_STATUS = {
  implement: ["ready"],
  "implement-continue": ["implementing", "ready"],
  "apply-triage": ["pr-review", "implementing"],
};

export function verifyClaim(state, key, { leaseId = null, action = null } = {}) {
  const entry = state.issues[key];
  if (!entry) return { ok: false, errors: [`state に未登録: ${key}`] };
  const errors = [];

  if (leaseId) {
    const current = entry.lease;
    if (!current) errors.push("予約が外れている（他のマネージャが処理したか、期限切れ）");
    else if (current.id !== leaseId) errors.push(`別の予約が入っている（${current.id}）`);
    else if (!leaseIsLive(current)) errors.push("予約の期限が切れている");
    else if (action && current.action !== action) {
      errors.push(`予約の action が違う（予約: ${current.action} / 実行: ${action}）`);
    }
  }

  // 人間が止めた（parked / needs-human）なら、走り終えた結果でも反映しない
  const allowed = action ? START_STATUS[action] : null;
  if (allowed && !allowed.includes(entry.status)) {
    errors.push(`status が ${entry.status} に変わっている（${action} の開始条件: ${allowed.join(" / ")}）`);
  }

  return errors.length ? { ok: false, errors, status: entry.status } : { ok: true, status: entry.status };
}

export function leaseStatus() {
  const state = loadState();
  return { leases: liveLeases(state) };
}
