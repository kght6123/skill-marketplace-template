// ワーカーの起動。実装は各リポジトリの worktree を作業ディレクトリにして動かす。
//
// そこで起動しないと、そのリポジトリの CLAUDE.md・.claude/settings.json・
// フック・プロジェクトスキルが効かない（project settings はセッションの
// 主作業ディレクトリからしか読まれない）。
//
// ワーカーは state.json を書かない（ORCH_ROLE=worker で orch が拒否する）。
// 結果はエンベロープで返し、マネージャだけがロック下で state に書く。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { repoConfig, worktreeRoot } from "./config.mjs";
import { loadState, updateState, setStatus, parseKey, STATUSES, processIsAlive } from "./state.mjs";
import { validateResult, missingSteps } from "./review.mjs";
import { post } from "./post.mjs";
import { lintPr } from "./lint.mjs";
import { ghJson, gh, isDryRun } from "./gh.mjs";
import { verifyClaim } from "./lease.mjs";

const START = "<<<ORCH_RESULT>>>";
const END = "<<<END>>>";

// ワーカーが返してよいのは「観測した事実」だけ。状態遷移の判定はマネージャの担当。
const ENVELOPE_FIELDS = ["key", "action", "status", "prs", "pullRequest", "review", "comments", "needs_human", "notes"];

// PRについて報告してよい項目。merged / selfApproved / approvalCommentId などの
// 承認とマージに関わる項目はマネージャ管轄で、ワーカーからは書かせない。
const WORKER_PR_FIELDS = ["number", "order", "headSha", "branch", "base", "title"];

// action ごとに許す遷移先。ここに無い status は受け取らない。
const STATUS_BY_ACTION = {
  implement: ["implementing", "pr-review", "needs-human"],
  "implement-continue": ["implementing", "pr-review", "needs-human"],
  "apply-triage": ["pr-review", "needs-human"],
};

const COMMENT_KINDS = ["memo", "split", "approve", "triage"];

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

// 枠のロックは worktree の**外**（隣）に置く。中に置くとディレクトリが先に
// できてしまい、git worktree add が "already exists" で失敗する。
function lockPathFor(dir) {
  return `${dir}.lock`;
}

// 3つの別概念を混ぜない。
//
//   予約（lease）        … 同じ Issue/action を2本が処理しない（lease.mjs）
//   スタックのブランチ    … PR 1本目 / 2本目 / 3本目 を別ブランチにする（branchFor）
//   worktree の枠        … 同じディレクトリを同時に使わない（slotDir）
//
// 以前はブランチを枠の連番から作っていたので、逐次に implement-continue すると
// 枠1が空いていて同じブランチに戻り、2本目のスタックが作れなかった。

// スタックの何本目かでブランチを決める。枠とは無関係。
export function branchFor(config, key, order) {
  const { number } = parseKey(key);
  return `${config.branchPrefix || "orch/"}${number}/${order}`;
}

// 枠のディレクトリ。ブランチとは無関係。
function slotDir(config, key, slot) {
  const { repo, number } = parseKey(key);
  return path.join(worktreeRoot(config), `${repo}-${number}-slot-${slot}`);
}

// この action で作業するブランチ（＝スタックの何本目か）を state から決める。
// ワーカーの申告ではなく、マネージャが state を見て決める。
export function plannedBranch(config, key, action, state = loadState()) {
  const entry = state.issues[key];
  const prs = entry?.prs || [];
  if (action === "apply-triage") {
    // 指摘対応は新しいスタックを作らない。対象PRのブランチをそのまま使う
    const target = prs.find((p) => p.triageApproved && !p.triageApplied) ||
      [...prs].reverse().find((p) => !p.merged);
    if (!target) throw new Error(`${key} に指摘対応の対象PRがありません`);
    return { branch: target.branch || branchFor(config, key, target.order || 1), order: target.order || 1, base: target.base || null };
  }
  const order = prs.length + 1;
  const previous = prs.length ? prs[prs.length - 1] : null;
  return {
    branch: branchFor(config, key, order),
    order,
    // 2本目以降は前のPRのブランチに積む（stacked）。ここもマネージャが決める
    base: previous ? previous.branch || branchFor(config, key, previous.order || order - 1) : null,
  };
}

function lockOwner(dir) {
  try {
    return JSON.parse(fs.readFileSync(lockPathFor(dir), "utf8"));
  } catch {
    return null; // 旧形式・壊れている・直前に外れた
  }
}

// そのworktreeで今ワーカーが動いているか。
//
// 時間だけで判断すると、正常に長く動いているワーカーのロックを奪える。
// 同じホストなら PID の生死で判断し、時間は分からないときの保険にする。
function isBusy(dir, staleMs) {
  const lock = lockPathFor(dir);
  if (!fs.existsSync(lock)) return false;
  const owner = lockOwner(dir);
  if (owner?.hostname === os.hostname() && owner.pid) {
    return processIsAlive(owner.pid); // 生きていれば何時間でも busy
  }
  try {
    return Date.now() - fs.statSync(lock).mtimeMs < staleMs;
  } catch {
    return false;
  }
}

// 枠を排他的に取る。「空いている」の確認と「予約」を1操作にしないと、
// 2プロセスが同時に同じ枠を空きと判定し、同じ worktree で作業してしまう。
function claimSlot(dir, staleMs) {
  const lock = lockPathFor(dir);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const body = JSON.stringify({
    pid: process.pid,
    hostname: os.hostname(),
    at: new Date().toISOString(),
  });
  try {
    fs.writeFileSync(lock, body, { flag: "wx" }); // 既にあれば EEXIST
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    if (isBusy(dir, staleMs)) return false; // 動いている。次の枠へ
    // 残骸。剥がして取り直す（ここで負けたら次の枠へ進む）
    fs.rmSync(lock, { force: true });
    try {
      fs.writeFileSync(lock, body, { flag: "wx" });
      return true;
    } catch (retryErr) {
      if (retryErr.code === "EEXIST") return false;
      throw retryErr;
    }
  }
}

function repoPathOf(config, key) {
  const { nameWithOwner } = parseKey(key);
  const rc = repoConfig(config, nameWithOwner);
  if (!rc.path) {
    throw new Error(
      `repos の ${nameWithOwner} に path がありません。ローカルのチェックアウト先を orch.config.json に書いてください（AIはcloneしません）`,
    );
  }
  const repoPath = expandHome(rc.path);
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    throw new Error(`${repoPath} が git リポジトリではありません`);
  }
  return repoPath;
}

// 割り当て先を計算するだけ。作らない（--dry-run 用）。
export function planWorktree(config, key, action = "implement") {
  const repoPath = repoPathOf(config, key);
  const staleMs = (config.worker?.timeoutMin || 30) * 60_000;
  const maxSlots = Math.max(1, config.limits?.parallelWorkers || 1);
  const plan = plannedBranch(config, key, action);
  for (let slot = 1; slot <= maxSlots; slot++) {
    const dir = slotDir(config, key, slot);
    if (isBusy(dir, staleMs)) continue;
    return { dir, branch: plan.branch, base: plan.base, order: plan.order, slot, repoPath, exists: fs.existsSync(dir) };
  }
  throw new Error(
    `${key} の worktree が ${maxSlots} 枠すべて使用中です（実行中か、別の場所で checked out）。limits.parallelWorkers を見てください`,
  );
}

// 空いている worktree を確保する。リポジトリのクローンはしない（人間が置いたものを使う）。
// スタックの分岐元が手元に無いことがある（マージ後に消された・別のマシンから
// push された）。無い参照を start point にすると worktree add ごと落ちるので、
// 既定ブランチへ落とす。base が分からないまま黙って main から切らない。
function resolveStart(repoPath, base, config) {
  const git = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  const exists = (ref) => {
    if (!ref) return false;
    try {
      execFileSync("git", ["-C", repoPath, "rev-parse", "--verify", "--quiet", ref], git);
      return true;
    } catch {
      return false;
    }
  };
  if (exists(base)) return { start: base, fellBack: false };
  const fallback = config.defaultBranch || "main";
  if (exists(fallback)) return { start: fallback, fellBack: Boolean(base) };
  return { start: null, fellBack: Boolean(base) };
}

export function ensureWorktree(config, key, { lock = false, action = "implement" } = {}) {
  const repoPath = repoPathOf(config, key);
  const staleMs = (config.worker?.timeoutMin || 30) * 60_000;
  const maxSlots = Math.max(1, config.limits?.parallelWorkers || 1);
  const plan = plannedBranch(config, key, action);
  const branch = plan.branch;

  for (let slot = 1; slot <= maxSlots; slot++) {
    const dir = slotDir(config, key, slot);
    // 先に枠を取る。取れなければ他のワーカーのもの
    if (lock) {
      if (!claimSlot(dir, staleMs)) continue;
    } else if (isBusy(dir, staleMs)) {
      continue;
    }

    const worktreeExists = fs.existsSync(path.join(dir, ".git"));
    if (worktreeExists) {
      // 使い回す枠。前回の残骸が混ざらないように戻してから渡す
      const git = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
      const dirty = execFileSync("git", ["-C", dir, "status", "--porcelain"], git).trim();
      if (dirty) {
        execFileSync("git", ["-C", dir, "reset", "--hard"], git);
        execFileSync("git", ["-C", dir, "clean", "-fd"], git);
      }
      const current = execFileSync("git", ["-C", dir, "branch", "--show-current"], git).trim();
      if (current !== branch) {
        // スタックの次の本数めは、まだブランチが無い。前のPRのブランチから作る
        const known = execFileSync("git", ["-C", dir, "branch", "--list", branch], git).trim();
        const from = resolveStart(dir, plan.base, config);
        const args = known
          ? ["-C", dir, "checkout", branch]
          : ["-C", dir, "checkout", "-b", branch, ...(from.start ? [from.start] : [])];
        try {
          execFileSync("git", args, git);
        } catch (err) {
          if (lock) releaseWorktree(dir);
          throw new Error(`${dir} を ${branch} に切り替えられません: ${String(err.stderr || err.message)}`);
        }
      }
      return { dir, branch, base: plan.base, order: plan.order, slot, repoPath, reused: true, cleaned: Boolean(dirty) };
    }
    {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      const git = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
      const exists = execFileSync("git", ["-C", repoPath, "branch", "--list", branch], git).trim();
      // 2本目以降は前のPRのブランチに積む（stacked）。手元に無ければ既定ブランチから
      const from = resolveStart(repoPath, plan.base, config);
      const args = exists
        ? ["-C", repoPath, "worktree", "add", dir, branch]
        : ["-C", repoPath, "worktree", "add", "-b", branch, dir, ...(from.start ? [from.start] : [])];
      try {
        execFileSync("git", args, git);
      } catch (err) {
        // そのブランチが既に別の worktree で checked out されている＝
        // 同じスタックの同じ位置を2本が実装しようとしている。枠を変えても解決しない。
        if (/already used by worktree|already checked out/.test(String(err.stderr || ""))) {
          if (lock) releaseWorktree(dir);
          throw new Error(
            `${branch} は既に別の worktree で作業中です。同じスタックの同じPRを2本同時に実装しません（orch next --claim で予約を取ってください）`,
          );
        }
        if (lock) releaseWorktree(dir);
        throw err;
      }
    }
    return { dir, branch, base: plan.base, order: plan.order, slot, repoPath, reused: false, cleaned: false };
  }
  throw new Error(
    `${key} の worktree が ${maxSlots} 枠すべて使用中です（実行中か、別の場所で checked out）。limits.parallelWorkers を見てください`,
  );
}

export function releaseWorktree(dir) {
  fs.rmSync(lockPathFor(dir), { force: true });
}

// ワーカーが最後に出力する結果。これ以外は読まない。
// 期待した key / action と突き合わせ、許していない項目や遷移は**拒否する**。
// 黙って捨てるのではなく落とすのは、ワーカーが仕様を誤解したまま進むのを止めるため。
export function parseEnvelope(text, { key, action } = {}) {
  const start = text.lastIndexOf(START);
  if (start < 0) return { ok: false, errors: [`${START} が出力に無い`] };
  const end = text.indexOf(END, start);
  if (end < 0) return { ok: false, errors: [`${END} が出力に無い`] };
  let data;
  try {
    data = JSON.parse(text.slice(start + START.length, end));
  } catch (err) {
    return { ok: false, errors: [`エンベロープがJSONとして読めない: ${err.message}`] };
  }

  const errors = [];
  for (const field of Object.keys(data)) {
    if (!ENVELOPE_FIELDS.includes(field)) errors.push(`知らない項目: ${field}`);
  }
  if (typeof data.key !== "string") errors.push("key が無い");
  if (key && data.key !== key) errors.push(`key が違う（依頼: ${key} / 返答: ${data.key}）`);
  // action も依頼と一致していること。ずれていると、許可される status も
  // triageApplied の扱いも別の action のものになる
  if (action && data.action && data.action !== action) {
    errors.push(`action が違う（依頼: ${action} / 返答: ${data.action}）`);
  }

  // status は action ごとの許可リストに載っているものだけ
  if (data.status) {
    const allowed = STATUS_BY_ACTION[action || data.action] || ["needs-human"];
    if (!STATUSES.includes(data.status)) errors.push(`status が不正: ${data.status}`);
    else if (!allowed.includes(data.status)) {
      errors.push(`${action || data.action} から ${data.status} には遷移できない（許可: ${allowed.join(" / ")}）`);
    }
  }

  for (const [i, pr] of (data.prs || []).entries()) {
    if (typeof pr.number !== "number") errors.push(`prs[${i}].number が数値でない`);
    for (const field of Object.keys(pr)) {
      if (!WORKER_PR_FIELDS.includes(field)) {
        errors.push(`prs[${i}].${field} はワーカーからは書けない（マネージャ管轄）`);
      }
    }
  }

  for (const [i, r] of (data.review || []).entries()) {
    const check = validateResult(r);
    if (!check.ok) errors.push(`review[${i}]: ${check.errors.join(" / ")}`);
  }

  // PR もワーカーは作らない。作ってほしい内容を返し、マネージャが作る
  const wantsPr = data.pullRequest;
  if (wantsPr) {
    for (const field of ["title", "head"]) {
      if (typeof wantsPr[field] !== "string" || !wantsPr[field]) {
        errors.push(`pullRequest.${field} が無い`);
      }
    }
    if (!wantsPr.body && !wantsPr.bodyFile) errors.push("pullRequest に body も bodyFile も無い");
  }

  // ワーカーは投稿できないので、投稿してほしいコメントはここに載せる
  for (const [i, c] of (data.comments || []).entries()) {
    if (!COMMENT_KINDS.includes(c.kind)) errors.push(`comments[${i}].kind が不正: ${c.kind}`);
    if (!c.body && !c.bodyFile) errors.push(`comments[${i}] に body も bodyFile も無い`);
    // 新しく作るPR宛てなら番号は省ける（マネージャが差し替える）
    if (["approve", "triage"].includes(c.kind) && typeof c.pr !== "number" && !wantsPr) {
      errors.push(`comments[${i}] に pr（番号）が無い`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, data };
}

// マネージャ側だけが呼ぶ。ロック下で state に反映する。
// 受け取った値のうち、許可した項目だけを写す（parseEnvelope を通っていても二重に絞る）。
export function applyEnvelope(data, { action, lease = null, advanceStatus = true, verify = true, pendingApply = null } = {}) {
  return updateState((state) => {
    const entry = state.issues[data.key];
    if (!entry) throw new Error(`state に未登録: ${data.key}`);

    // 反映する瞬間にも前提を確かめる。走っている間に人間が止めたかもしれない
    if (verify) {
      const claim = verifyClaim(state, data.key, { leaseId: lease, action });
      if (!claim.ok) throw new Error(`結果を反映できません: ${claim.errors.join(" / ")}`);
    }

    for (const incoming of data.prs || []) {
      const fields = Object.fromEntries(
        Object.entries(incoming).filter(([k]) => WORKER_PR_FIELDS.includes(k)),
      );
      const existing = (entry.prs || []).find((p) => p.number === incoming.number);
      if (existing) {
        Object.assign(existing, fields);
        // head が動いたらセルフレビューの承認は無効。ワーカーの申告ではなく事実で判断する
        if (fields.headSha && existing.approvedSha && fields.headSha !== existing.approvedSha) {
          existing.selfApproved = false;
          existing.approvedSha = null;
        }
      } else {
        entry.prs = [
          ...(entry.prs || []),
          { order: (entry.prs || []).length + 1, merged: false, selfApproved: false, ...fields },
        ];
      }
    }

    for (const result of data.review || []) {
      const pr = (entry.prs || []).find((p) => p.number === (data.prs?.[0]?.number ?? p.number));
      if (!pr) continue;
      pr.review = pr.review || { round: 0, results: {} };
      pr.review.results[result.reviewer] = result;
    }

    // 指摘対応が終わったことは、ワーカーの自己申告ではなく action から決める
    if (action === "apply-triage" && !data.needs_human) {
      for (const incoming of data.prs || []) {
        const pr = (entry.prs || []).find((p) => p.number === incoming.number);
        if (pr) pr.triageApplied = true;
      }
    }

    if (pendingApply) entry.pendingApply = pendingApply;

    // status を進めるのは、投稿すべきコメントを出し終えてから（advanceStatus）。
    // 先に pr-review にすると、承認用コメントの投稿が落ちたときに
    // 「pr-review なのに押すコメントが無い」復旧できない状態が残る。
    if (data.needs_human) setStatus(entry, "needs-human", { workerNotes: data.notes || null });
    else if (advanceStatus && data.status) setStatus(entry, data.status, { workerNotes: data.notes || null });
    else if (data.notes) entry.workerNotes = data.notes;
    return { key: data.key, status: entry.status, prs: entry.prs };
  });
}

// この作業ブランチで何を変えたか。マネージャが自分で git に聞く。
// ワーカーの申告から when.paths を評価すると、対象ファイルを隠して
// security レビューを飛ばせてしまう。
export function changedFiles(dir, base) {
  const git = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  try {
    const out = execFileSync("git", ["-C", dir, "diff", "--name-only", `${base}...HEAD`], git);
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// 起動コマンドを組み立てる。{prompt} があればその位置に差し込み、無ければ末尾に足す。
// ツールごとの流儀の違いは、この2つ（引数の位置と stdin）だけで吸収できる。
export function buildCommand(worker, prompt) {
  const args = worker.args || [];
  const hasPlaceholder = args.some((a) => a.includes("{prompt}"));
  const argv = args.map((a) => a.replace("{prompt}", prompt));
  // モデル指定。ワーカーは安いモデル、マネージャは良いモデルにするのが基本
  if (worker.model) argv.push(worker.modelFlag || "--model", worker.model);
  if (worker.promptVia !== "stdin" && !hasPlaceholder) argv.push(prompt);
  return { command: worker.command, argv, hasPlaceholder };
}

// ワーカーを1件起動する。並行させたいときは、マネージャがこれを複数同時に呼ぶ。
export function runWorker(config, { key, action, promptFile, dryRun = false, lease = null }) {
  if ((config.phase ?? 5) < 4) {
    throw new Error(`phase ${config.phase} では実装を動かしません（実装は phase 4 から）`);
  }
  if (!loadState().issues[key]) throw new Error(`state に未登録: ${key}`);
  const prompt = fs.readFileSync(promptFile, "utf8");
  const worker = config.worker;
  const viaStdin = worker.promptVia === "stdin";

  if (dryRun) {
    // --dry-run は副作用なし。worktree もブランチも作らない。
    const plan = planWorktree(config, key, action);
    const shown = buildCommand(worker, "<prompt>");
    return {
      dryRun: true, key, action,
      cwd: plan.dir, branch: plan.branch, slot: plan.slot, worktreeExists: plan.exists,
      workerCommand: [shown.command, ...shown.argv].join(" "),
      promptVia: viaStdin ? "stdin" : "arg",
    };
  }

  const { dir, branch, base, order, slot } = ensureWorktree(config, key, { lock: true, action });
  const { command, argv } = buildCommand(worker, prompt);

  // ワーカーが本文（PR本文・コメント）を置く場所。1回の起動ごとに作る。
  // ここと worktree の中以外のファイルは、マネージャが本文として読まない。
  const outbox = fs.mkdtempSync(path.join(os.tmpdir(), `orch-outbox-${process.pid}-`));

  // 枠のロックはここでは離さない。エンベロープの bodyFile は worktree の中を指せるので、
  // 読み終わる前に離すと、別のワーカーが同じ枠を取って reset --hard で消せてしまう。
  let res;
  try {
    res = spawnSync(command, argv, {
      cwd: dir,
      encoding: "utf8",
      timeout: (worker.timeoutMin || 30) * 60_000,
      maxBuffer: 64 * 1024 * 1024,
      // stdin は閉じる。開いたままだと EOF を待って止まるCLIがある（codex exec など）
      stdio: viaStdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      input: viaStdin ? prompt : undefined,
      env: {
        ...process.env,
        ORCH_ROLE: "worker",
        ORCH_KEY: key,
        ORCH_ACTION: action,
        ORCH_BRANCH: branch,
        ORCH_OUTBOX: outbox,
      },
    });
  } catch (err) {
    releaseWorktree(dir);
    fs.rmSync(outbox, { recursive: true, force: true });
    throw err;
  }

  // 枠と outbox は、本文を読み終えてから片付ける
  const cleanup = () => {
    fs.rmSync(outbox, { recursive: true, force: true });
    releaseWorktree(dir);
  };

  try {
    if (res.error) throw new Error(`ワーカーを起動できません: ${res.error.message}`);

    // 終了コードが 0 でなければ、エンベロープが揃っていても採用しない。
    // 出力の後で後処理やフックが落ちた可能性があり、部分的な stdout は信用できない。
    if (res.status !== 0) {
      return {
        ok: false, key, action, cwd: dir, slot, exitCode: res.status,
        errors: [`ワーカーが終了コード ${res.status} で終了した`],
        needs_human: true,
        stderr: (res.stderr || "").slice(-2000),
      };
    }

    // ワーカーは信用しない実行主体。key・status・書ける項目をすべて突き合わせる。
    const envelope = parseEnvelope(res.stdout || "", { key, action });
    if (!envelope.ok) {
      return {
        ok: false,
        key,
        action,
        cwd: dir,
        slot,
        exitCode: res.status,
        errors: envelope.errors,
        needs_human: true,
        stderr: (res.stderr || "").slice(-2000),
      };
    }

    return finishEnvelope(envelope.data, {
      action,
      cwd: dir,
      outbox,
      lease,
      expectedBranch: branch,
      base,
      order,
      config,
      extra: { key, action, cwd: dir, branch, slot, exitCode: res.status },
    });
  } finally {
    cleanup();
  }
}

// エンベロープを state・GitHub に反映する。マネージャ側だけが呼ぶ。
//   1. PR を作る（lint を通してから）
//   2. state に反映する
//   3. コメントを投稿する（新しいPR宛ては番号を差し替える）
export function finishEnvelope(data, {
  action, cwd = null, outbox = null, lease = null,
  expectedBranch = null, base = null, order = null, config = null, extra = {},
} = {}) {
  // ワーカーが bodyFile で指せる範囲は、作業した worktree と、
  // マネージャがそのワーカーのために作った受け渡し用ディレクトリ（outbox）だけ。
  // os.tmpdir() 全体を許すと、他プロセスが置いたファイルまで投稿できてしまう。
  const allowedDirs = [cwd, outbox].filter(Boolean).map((d) => assertRealDir(d, "受け渡し先"));

  // 外へ出す前に、開始時の前提がまだ成り立っているかを確かめる。
  // ここで落とせば、止められた件に対してPRやコメントを作らずに済む。
  const claim = verifyClaim(loadState(), data.key, { leaseId: lease, action });
  if (!claim.ok) {
    return {
      ok: false, ...extra, needs_human: true,
      errors: [`結果を反映できません: ${claim.errors.join(" / ")}`],
      envelope: data,
    };
  }

  // 設定された AI レビューを1つでも飛ばしていたらPRを作らない。
  // ワーカーが review を空で返しても通っていた（security を丸ごと飛ばせた）。
  if (config && data.pullRequest) {
    const files = cwd ? changedFiles(cwd, base || config.defaultBranch || "main") : [];
    const missing = missingSteps(config, data.review || [], files);
    if (missing.length) {
      return {
        ok: false, ...extra, needs_human: true,
        errors: [`AIレビューが足りない: ${missing.join(" / ")}（設定された step をすべて回してください）`],
        changedFiles: files,
        envelope: data,
      };
    }
  }

  // 投稿すべきコメントと「最終的にどの status にするつもりだったか」を、
  // 外に何かを作る前に state へ預ける。途中で落ちても、これが残っていれば
  // orch post --pending で、PRを作り直さず同じ遷移をやり直せる。
  // コメントの種類から status を逆算しない（approve だからといって
  // pr-review とは限らない。スタックの途中なら implementing のまま進む）。
  const staged = stageComments(data, { allowedDirs });

  const created = createPullRequest(data, { allowedDirs, expectedBranch, base });
  const withPr = created
    ? {
        ...data,
        prs: [
          ...(data.prs || []),
          {
            number: created.number,
            branch: expectedBranch || data.pullRequest.head,
            ...(created.headSha ? { headSha: created.headSha } : {}),
            ...(order ? { order } : {}),
            ...(base ? { base } : {}),
          },
        ],
      }
    : data;

  // ここでは status を進めない。PR と、やり残しの内容だけを記録する
  const applied = applyEnvelope(withPr, {
    action, lease, advanceStatus: false,
    pendingApply: {
      action,
      leaseId: lease,
      finalStatus: data.needs_human ? "needs-human" : data.status || null,
      comments: staged.map((c) => ({ ...c, pr: c.pr ?? created?.number ?? null })),
    },
  });

  // コメントを投稿し、全部通ってから status を進める
  const flushed = flushPending(data.key);
  if (!flushed.ok) {
    return {
      ok: false, ...extra, createdPr: created, applied, needs_human: true,
      errors: flushed.errors,
      hint: "投稿だけが残っています。orch post --pending --key <key> でやり直せます（PRは作り直しません）",
      envelope: data,
    };
  }

  return {
    ok: true, ...extra,
    createdPr: created, applied: flushed.applied, posted: flushed.posted, envelope: data,
  };
}

// 投稿予定のコメントを本文ごと state に預ける（ファイルは消えるのでテキストで持つ）
function stageComments(data, { allowedDirs = [] } = {}) {
  return (data.comments || []).map((c) => {
    const { file, temp } = bodyToFile(c.body, c.bodyFile, "comment", allowedDirs);
    try {
      return { kind: c.kind, pr: typeof c.pr === "number" ? c.pr : null, body: fs.readFileSync(file, "utf8") };
    } finally {
      if (temp) fs.rmSync(temp, { force: true });
    }
  });
}

// 預けたコメントを投稿し、成功したものから state の控えを消す。
// 全部通ってから、預けておいた最終 status を CAS で適用する。
//
// 投稿している間に人間が 😄 や needs-human を押しているかもしれないので、
// 最後の遷移は必ず検証つきで行う。ここを verify なしにすると、
// 「PR作成直前までは守られるが、投稿中の数秒は上書きできる」穴が残る。
export function flushPending(key) {
  const pending = loadState().issues[key]?.pendingApply;
  if (!pending) return { ok: true, posted: [], applied: null, nothingToDo: true };

  const posted = [];
  const errors = [];
  for (const c of pending.comments || []) {
    const temp = path.join(os.tmpdir(), `orch-pending-${process.pid}-${Date.now()}.md`);
    fs.writeFileSync(temp, c.body);
    try {
      // ここでは status を動かさない。遷移はすべて終わってから1回だけ
      const result = post({ key, kind: c.kind, bodyFile: temp, pr: c.pr, advanceStatus: false });
      posted.push({ kind: c.kind, pr: c.pr ?? null, commentId: result.commentId });
      updateState((state) => {
        const entry = state.issues[key];
        const rest = (entry.pendingApply?.comments || []).filter(
          (x) => !(x.kind === c.kind && x.pr === c.pr),
        );
        entry.pendingApply = { ...entry.pendingApply, comments: rest };
        return true;
      });
    } catch (err) {
      errors.push(`${c.kind}: ${String(err.message || err)}`);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
  if (errors.length) {
    return { ok: false, posted, errors, applied: null };
  }

  // 投稿が全部通った。ここで初めて status を進める（予約と status を再確認して）
  try {
    const applied = updateState((state) => {
      const entry = state.issues[key];
      const plan = entry.pendingApply;
      const claim = verifyClaim(state, key, { leaseId: plan?.leaseId || null, action: plan?.action });
      if (!claim.ok) throw new Error(claim.errors.join(" / "));
      if (plan?.finalStatus) setStatus(entry, plan.finalStatus);
      entry.pendingApply = null;
      return { key, status: entry.status, prs: entry.prs };
    });
    return { ok: true, posted, errors: [], applied };
  } catch (err) {
    // 投稿は済んでいるが、その間に人間が止めた。status は動かさない
    return {
      ok: false, posted, applied: null,
      errors: [`投稿は終わりましたが status を進められません: ${String(err.message || err)}`],
      postedButNotAdvanced: true,
    };
  }
}

// ワーカーが指し示してよいファイルの範囲。
//
// bodyFile はワーカーが決めた文字列なので、そのまま読むと
// /etc/passwd のようなファイルを GitHub のコメントとして投稿させられる。
// 読んでよいのは「ワーカーが作業した worktree の中」と「受け渡し用の outbox の中」だけ。
function assertInsideAllowed(file, allowedDirs, what) {
  const dirs = allowedDirs.filter(Boolean);
  if (!dirs.length) throw new Error(`${what} のファイルを読める場所がありません`);

  // 文字列のパスだけを見ると symlink で抜けられる。
  // ワーカーは worktree の中に自由にファイルを作れるので、
  //   ln -s /etc/passwd ./approve.md
  // とすれば「worktree の中」を指したまま任意のファイルを投稿できてしまう。
  // symlink そのものを拒否し、実体（realpath）でも範囲を確かめる。
  let info;
  try {
    info = fs.lstatSync(file);
  } catch {
    throw new Error(`${what} のファイルがありません: ${file}`);
  }
  if (info.isSymbolicLink()) {
    throw new Error(`${what} のファイルが symlink です: ${file}（実体を置いてください）`);
  }
  if (!info.isFile()) throw new Error(`${what} が通常のファイルではありません: ${file}`);

  const realFile = fs.realpathSync(file);
  const realDirs = dirs.map((d) => {
    try {
      return fs.realpathSync(d);
    } catch {
      return path.resolve(d);
    }
  });
  const ok = realDirs.some((dir) => realFile === dir || realFile.startsWith(dir + path.sep));
  if (!ok) {
    throw new Error(
      `${what} のファイルが許可された場所の外にあります: ${realFile}（許可: ${realDirs.join(" / ")}）`,
    );
  }
  return realFile;
}

// outbox は毎回マネージャが作る。ワーカーが symlink に差し替えていないかを確かめる。
function assertRealDir(dir, what) {
  if (!dir) return null;
  const info = fs.lstatSync(dir);
  if (info.isSymbolicLink()) throw new Error(`${what} が symlink に差し替えられています: ${dir}`);
  if (!info.isDirectory()) throw new Error(`${what} がディレクトリではありません: ${dir}`);
  return fs.realpathSync(dir);
}

// 本文をファイルに落とす（インラインで来た場合）
function bodyToFile(entryBody, entryFile, tag, allowedDirs) {
  if (entryFile) {
    return { file: assertInsideAllowed(entryFile, allowedDirs, tag), temp: null };
  }
  const temp = path.join(os.tmpdir(), `orch-${tag}-${process.pid}-${Date.now()}.md`);
  fs.writeFileSync(temp, entryBody);
  return { file: temp, temp };
}

// PR はマネージャが作る。作る前に PR本文の lint を通す。
// ワーカー側で作らせると、テンプレートの上限をすり抜けられる。
export function createPullRequest(data, { allowedDirs = [], expectedBranch = null, base = null } = {}) {
  const want = data.pullRequest;
  if (!want) return null;
  const { nameWithOwner } = parseKey(data.key);
  // head はマネージャが割り当てたブランチでなければならない。
  // ワーカーの申告をそのまま使うと、別のスタックのブランチからPRを作れる。
  if (expectedBranch && want.head !== expectedBranch) {
    throw new Error(`pullRequest.head が割り当てたブランチと違う（割り当て: ${expectedBranch} / 返答: ${want.head}）`);
  }
  const { file, temp } = bodyToFile(want.body, want.bodyFile, "pr-body", allowedDirs);
  try {
    const checked = lintPr(fs.readFileSync(file, "utf8"), { title: want.title });
    if (!checked.ok) {
      const blocking = checked.findings.filter((f) => f.severity === "block");
      throw new Error(
        `PR本文が lint を通らない: ${blocking.map((f) => `${f.rule} ${f.message}`).join(" / ")}`,
      );
    }
    if (isDryRun()) return { number: 0, dryRun: true };
    const args = [
      "pr", "create", "--repo", nameWithOwner,
      "--head", expectedBranch || want.head, "--title", want.title, "--body-file", file,
    ];
    // base もマネージャが state から決める（2本目以降は前のPRのブランチ）
    const baseBranch = base ?? want.base;
    if (baseBranch) args.push("--base", baseBranch);
    if (want.draft) args.push("--draft");
    const out = gh(args) || "";
    const number = Number((out.trim().match(/\/pull\/(\d+)/) || [])[1]);
    if (!Number.isFinite(number) || number <= 0) {
      throw new Error(`PRの番号を読み取れない: ${out.trim().slice(0, 200)}`);
    }
    // head SHA はここで取る。次の sync を待つと、その間の承認スタンプが
    // 「どのコミットへの承認か」を決められずマージ判定が1周遅れる
    const view = ghJson(["pr", "view", String(number), "--repo", nameWithOwner, "--json", "headRefOid"],
      { allowFail: true });
    return { number, url: out.trim(), headSha: view?.headRefOid || null };
  } finally {
    if (temp) fs.rmSync(temp, { force: true });
  }
}

