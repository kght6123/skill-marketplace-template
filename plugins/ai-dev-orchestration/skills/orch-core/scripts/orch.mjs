#!/usr/bin/env node
// orch — AI開発オーケストレーションの決定的な処理をまとめた CLI。
//
// AI はスキルからこの CLI を実行し、--json の出力に従う。
// 判定（状態遷移・WIP・並び順・マージ可否・lint）はすべてここで完結し、AI は再計算しない。
//
//   orch init
//   orch profile [--human]                  今のプロファイル（モデルの組み合わせ）
//   orch phase [--human]                    今の段（どこまで自動でやるか）
//   orch stamps [--human]                   どのリアクションをどの意味に使うか
//   orch sync [--dry-run] [--rebuild]
//   orch queue [--human]
//   orch next [--mode memo|build] [--claim] [--minutes N] [--project org/repo] [--human]
//   orch lease list|release --key org/repo#1 [--id <leaseId>] | orch lease reap
//   orch assign --key org/repo#1 --pr 46 [--plan] | orch assign list
//   orch state list|get|set ...
//   orch post --key org/repo#1 --kind memo --body memo.md [--pr 46] [--update]
//   orch post --pending --key org/repo#1            投稿だけ残っているものをやり直す
//   orch lint memo|split <file> | orch lint pr <file> [--title "feat(x): ... [1/2] #1"]
//   orch review run|record|status --key org/repo#1 --pr 46 [...]
//   orch worker --key org/repo#1 --action implement --prompt task.md [--lease ID] [--dry-run]
//   orch apply --file worker-output.txt [--key K] [--action A] [--cwd worktree] [--outbox dir]
//   orch apply --file result.json
//   orch merge-train [--dry-run]
//   orch conflict --files a.ts,b.ts
//
// すべてのコマンドで --profile <名前> が使える（ORCH_PROFILE より優先）。
//
// マネージャとワーカーの境界: ORCH_ROLE=worker のセッションでは、state を書く
// コマンドをこの CLI 自身が拒否する。ワーカーは結果をエンベロープで返し、
// state に書くのはマネージャだけ。
import fs from "node:fs";
import { loadConfig, ORCH_HOME, DEFAULT_CONFIG, configPath, role } from "./lib/config.mjs";
import { emit, fail, needsHuman, parseArgs, EXIT_OK, EXIT_ERROR, EXIT_LINT } from "./lib/out.mjs";
import { loadState, saveState, updateState, newEntry, setStatus, listEntries, STATE_PATH } from "./lib/state.mjs";
import { setDryRun, dryRunIntents } from "./lib/gh.mjs";
import { queueReport, renderQueue } from "./lib/queue.mjs";
import { humanQueue, selectWork, HUMAN_KINDS } from "./lib/next.mjs";
import { sync, rebuild } from "./lib/sync.mjs";
import { post } from "./lib/post.mjs";
import { lintMemo, lintPr, lintSplit } from "./lib/lint.mjs";
import * as review from "./lib/review.mjs";
import { mergeTrain, classifyConflict } from "./lib/merge-train.mjs";
import { runWorker, parseEnvelope, finishEnvelope, flushPendingComments } from "./lib/worker.mjs";
import { claimWork, releaseLease, reapLeases, leaseStatus } from "./lib/lease.mjs";
import { assignReviewer, needsReviewer, pickReviewer } from "./lib/assign.mjs";
import { emojiFor, approveNames, parkNames, redoNames } from "./lib/stamps.mjs";

const { opts, positional } = parseArgs(process.argv.slice(2));
const command = positional[0];
const human = Boolean(opts.human);
// --profile は環境変数より優先。設定を読む前に反映する
if (typeof opts.profile === "string") process.env.ORCH_PROFILE = opts.profile;
setDryRun(opts["dry-run"]);

// ワーカーに実行させないコマンド（state を書くもの）
const MANAGER_ONLY = ["sync", "post", "merge-train", "worker", "apply", "lease", "assign"];
const MANAGER_ONLY_SUB = { state: ["set"], review: ["run", "record", "status"] };

function requireManager() {
  if (role() !== "worker") return;
  const sub = positional[1];
  const denied =
    MANAGER_ONLY.includes(command) || (MANAGER_ONLY_SUB[command] || []).includes(sub);
  if (denied) {
    throw new Error(
      `${[command, sub].filter(Boolean).join(" ")} はマネージャ専用です。ワーカーは結果をエンベロープ（<<<ORCH_RESULT>>> … <<<END>>>）で返してください`,
    );
  }
}

function requireConfigured(config) {
  if (!config._exists) {
    throw new Error(`設定がありません。orch init を実行してください（${configPath()}）`);
  }
  if (!config.account) throw new Error("orch.config.json の account（自分のGitHubアカウント）が未設定");
  if (!config.repos.length) throw new Error("orch.config.json の repos が空");
}

function cmdInit() {
  fs.mkdirSync(ORCH_HOME, { recursive: true });
  const file = configPath();
  const created = [];
  if (!fs.existsSync(file)) {
    const skeleton = { ...DEFAULT_CONFIG };
    delete skeleton._path;
    fs.writeFileSync(file, JSON.stringify(skeleton, null, 2) + "\n");
    created.push(file);
  }
  if (!fs.existsSync(STATE_PATH)) {
    saveState(loadState());
    created.push(STATE_PATH);
  }
  return emit({
    command: "init",
    orchHome: ORCH_HOME,
    created,
    next: created.length
      ? "orch.config.json の account と repos を埋めてください"
      : "すでに初期化済みです",
  });
}

async function main() {
  const config = await loadConfig();
  requireManager();

  switch (command) {
    case "init":
      return cmdInit();

    case "sync": {
      requireConfigured(config);
      const result = opts.rebuild
        ? rebuild(config, { dryRun: Boolean(opts["dry-run"]) })
        : sync(config, { dryRun: Boolean(opts["dry-run"]) });
      return emit({ command: "sync", ...result, intents: dryRunIntents() });
    }

    case "queue": {
      const report = queueReport(loadState(), config);
      return emit({ command: "queue", ...report }, { human, render: (b) => renderQueue(b) });
    }

    case "next": {
      const state = loadState();
      if (opts.mode) {
        const limit = opts.limit && Number(opts.limit);
        // --claim は「選ぶ」と「予約する」をロックの中で一度にやる。
        // マネージャを並行させるなら必ずこちらを使う（--claim 無しは下見用）。
        if (opts.claim) {
          reapLeases(); // 期限切れ・持ち主が死んだ予約を先に掃除する
          const claimed = claimWork(config, (fresh) =>
            selectWork(fresh, config, opts.mode, limit).items);
          return emit({ command: "next", mode: opts.mode, claimed: true, ...claimed });
        }
        const work = selectWork(state, config, opts.mode, limit);
        return emit({ command: "next", mode: opts.mode, ...work });
      }
      const { items, top } = humanQueue(state, config, {
        minutes: opts.minutes,
        project: opts.project,
      });
      const counts = {};
      for (const k of HUMAN_KINDS) counts[k.kind] = items.filter((i) => i.kind === k.kind).length;
      return emit(
        { command: "next", top, counts, total: items.length },
        { human, render: renderNext.bind(null, config) },
      );
    }

    case "assign": {
      // レビュアーの割り当て。誰が空いているかを AI に考えさせない
      requireConfigured(config);
      if (positional[1] === "list") {
        return emit({ command: "assign list", items: needsReviewer(loadState()) });
      }
      if (!opts.key || !opts.pr) return fail("--key と --pr が要ります");
      if (opts.plan) {
        return emit({ command: "assign plan", ...pickReviewer(loadState(), config, opts.key, opts.pr) });
      }
      const assigned = assignReviewer(config, { key: opts.key, pr: opts.pr });
      if (!assigned.ok) {
        // 全員が上限なら、それは異常ではなく「待ち」。人間の行列を守っている
        return emit({ command: "assign", ...assigned });
      }
      return emit({ command: "assign", ...assigned });
    }

    case "lease": {
      // 論理タスクの予約。worktree のロックとは別物（同じ Issue の二重実行を防ぐ）
      const sub = positional[1] || "list";
      if (sub === "list") return emit({ command: "lease list", ...leaseStatus() });
      if (sub === "reap") return emit({ command: "lease reap", ...reapLeases() });
      if (sub === "release") {
        const key = opts.key || positional[2];
        if (!key) return fail("キーを指定してください（org/repo#123）");
        return emit({
          command: "lease release",
          ...releaseLease(key, typeof opts.id === "string" ? opts.id : null),
        });
      }
      return fail("lease のサブコマンドは list / release / reap");
    }

    case "state": {
      const sub = positional[1];
      const state = loadState();
      if (sub === "list") {
        const entries = listEntries(state, { status: opts.status, repo: opts.repo });
        return emit({ command: "state list", count: entries.length, entries });
      }
      if (sub === "get") {
        const entry = state.issues[positional[2]];
        if (!entry) return fail(`state に未登録: ${positional[2]}`);
        return emit({ command: "state get", entry });
      }
      if (sub === "set") {
        const key = positional[2];
        if (!key) return fail("キーを指定してください（org/repo#123）");
        const entry = updateState((fresh) => {
          const target = fresh.issues[key] || newEntry(key);
          fresh.issues[key] = target;
          if (opts.set) Object.assign(target, JSON.parse(opts.set));
          if (opts.status) setStatus(target, opts.status);
          return target;
        });
        return emit({ command: "state set", entry });
      }
      return fail("state の後に list / get / set を指定してください");
    }

    case "post": {
      requireConfigured(config);
      // 投稿だけが残っている件のやり直し。PRは作り直さない。
      // 通れば status も進む（承認用コメントが無いまま pr-review にしない）
      if (opts.pending) {
        if (!opts.key) return fail("--key が要ります");
        const flushed = flushPendingComments(opts.key);
        if (!flushed.ok) return needsHuman("投稿をやり直せない", flushed);
        const entry = updateState((fresh) => {
          const target = fresh.issues[opts.key];
          if (!target) throw new Error(`state に未登録: ${opts.key}`);
          if (target.status === "implementing" && (target.prs || []).length) {
            setStatus(target, "pr-review");
          }
          return target;
        });
        return emit({ command: "post --pending", ...flushed, status: entry.status });
      }
      const result = post({
        key: opts.key,
        kind: opts.kind,
        bodyFile: opts.body,
        pr: opts.pr,
        update: Boolean(opts.update),
      });
      return emit({ command: "post", ...result, intents: dryRunIntents() });
    }

    case "lint": {
      const kind = positional[1];
      const file = positional[2];
      if (!file || !fs.existsSync(file)) return fail(`ファイルがありません: ${file}`);
      const text = fs.readFileSync(file, "utf8");
      const LINTERS = { memo: lintMemo, split: lintSplit, pr: lintPr };
      if (!LINTERS[kind]) return fail(`--kind は memo / split / pr のいずれか（受け取った値: ${kind}）`);
      const approveEmojis = approveNames(config).map(emojiFor);
      const result =
        kind === "pr"
          ? lintPr(text, { title: opts.title })
          : LINTERS[kind](text, { approveEmojis });
      const code = emit({ command: `lint ${kind}`, file, ...result }, { human, render: renderLint });
      // lint 違反は「作り直し」であって停止ではないので、専用の終了コード 2 を返す
      return result.ok ? code : EXIT_LINT;
    }

    case "review": {
      const sub = positional[1];
      if (sub === "run") {
        const changed = opts.files ? String(opts.files).split(",") : [];
        return emit({ command: "review run", ...review.run(config, { key: opts.key, pr: opts.pr, changedFiles: changed }) });
      }
      if (sub === "record") {
        const result = review.record(config, {
          key: opts.key, pr: opts.pr, step: opts.step, resultFile: opts.result,
        });
        if (!result.ok && config.review.onError === "needs-human") {
          return needsHuman("レビュー結果のJSONが不正", result);
        }
        return emit({ command: "review record", ...result });
      }
      if (sub === "status") {
        const result = review.status(config, { key: opts.key, pr: opts.pr });
        if (result.needs_human) return needsHuman("未解決の block が残っている", result);
        return emit({ command: "review status", ...result });
      }
      return fail("review の後に run / record / status を指定してください");
    }

    case "stamps": {
      // どのリアクションをどの意味に使っているか。フッタの文面はこれに合わせる。
      const asList = (names) => names.map((n) => ({ name: n, emoji: emojiFor(n) }));
      const approve = asList(approveNames(config));
      const park = asList(parkNames(config));
      const redo = asList(redoNames(config));
      const join = (list) => list.map((x) => x.emoji).join("");
      return emit(
        {
          command: "stamps",
          approve,
          park,
          redo,
          footer: `${join(approve)} 着手OK ／ ${join(park)} 後回し`,
        },
        {
          human,
          render: (b) => {
            const line = (list) => list.map((x) => `${x.emoji} (${x.name})`).join("  ");
            return [
              ` 承認・着手OK  ${line(b.approve)}`,
              ` 後回し        ${line(b.park)}`,
              ` 作り直し      ${line(b.redo)}`,
              "",
              ` フッタの文面: ${b.footer}`,
            ].join("\n");
          },
        },
      );
    }

    case "phase": {
      // 今どの段か。人に確認せず、この値に従う。
      const PHASES = [
        { n: 1, label: "理解メモを手で試す", enforced: false },
        { n: 2, label: "状態の自動遷移（sync）", enforced: false },
        { n: 3, label: "next の1画面", enforced: false },
        { n: 4, label: "実装（worker / next --mode build）", enforced: true },
        { n: 5, label: "マージ（merge-train）", enforced: true },
      ];
      const current = config.phase ?? 5;
      return emit(
        {
          command: "phase",
          phase: current,
          canImplement: current >= 4,
          canMerge: current >= 5,
          phases: PHASES,
        },
        {
          human,
          render: (b) =>
            [
              ` 段: ${b.phase}`,
              "",
              ...b.phases.map(
                (x) =>
                  `   ${x.n === b.phase ? "▶" : " "} ${x.n} ${x.label}` +
                  (x.enforced ? (b.phase >= x.n ? "  有効" : "  停止中") : ""),
              ),
              "",
              " 変えるには orch.config.json の phase を書き換える",
            ].join("\n"),
        },
      );
    }

    case "profile": {
      // 今どのプロファイルで動いているか。マネージャの起動コマンドも出す。
      const list = Object.entries(config.profiles || {}).map(([name, p]) => ({
        name,
        managerModel: p.manager?.model ?? null,
        workerModel: p.worker?.model ?? null,
        parallelWorkers: p.limits?.parallelWorkers ?? null,
      }));
      return emit(
        {
          command: "profile",
          active: config._profile,
          managerModel: config.manager?.model || "default",
          workerModel: config.worker?.model || null,
          parallelWorkers: config.limits?.parallelWorkers,
          startManager: `claude --model ${config.manager?.model || "default"}`,
          profiles: list,
        },
        {
          human,
          render: (b) =>
            [
              ` プロファイル: ${b.active || "（未指定）"}`,
              ` マネージャ: ${b.managerModel}   ワーカー: ${b.workerModel || "（未指定）"}   並行: ${b.parallelWorkers}`,
              "",
              ` マネージャの起動: ${b.startManager}`,
              "",
              ...b.profiles.map(
                (p) =>
                  `   ${p.name.padEnd(8)} マネージャ ${String(p.managerModel).padEnd(7)} ワーカー ${String(p.workerModel).padEnd(7)}` +
                  (p.parallelWorkers ? ` 並行 ${p.parallelWorkers}` : ""),
              ),
            ].join("\n"),
        },
      );
    }

    case "worker": {
      requireConfigured(config);
      if (!opts.key || !opts.prompt) return fail("--key と --prompt が要ります");
      const lease = typeof opts.lease === "string" ? opts.lease : null;
      let result;
      try {
        result = runWorker(config, {
          key: opts.key,
          action: opts.action || "implement",
          promptFile: opts.prompt,
          dryRun: Boolean(opts["dry-run"]),
          lease, // 反映の直前にも、この予約が生きているかを確かめる
        });
      } finally {
        // 予約は成否にかかわらず返す。返し忘れると、その Issue が誰にも選べなくなる
        if (lease && !opts["dry-run"]) releaseLease(opts.key, lease);
      }
      if (result.needs_human) return needsHuman("ワーカーの結果を適用できない", result);
      return emit({ command: "worker", ...result, leaseReleased: lease });
    }

    case "apply": {
      // ワーカーの結果エンベロープを state に反映する（マネージャ専用）
      const file = opts.file || positional[1];
      if (!file || !fs.existsSync(file)) return fail(`エンベロープのファイルがありません: ${file}`);
      const envelope = parseEnvelope(fs.readFileSync(file, "utf8"), {
        key: typeof opts.key === "string" ? opts.key : undefined,
        action: typeof opts.action === "string" ? opts.action : undefined,
      });
      if (!envelope.ok) return needsHuman("エンベロープが不正", { errors: envelope.errors });
      const action = opts.action || envelope.data.action;
      // bodyFile を読んでよい場所。手で回す場合は作業した worktree を --cwd で渡す
      const done = finishEnvelope(envelope.data, {
        action,
        cwd: typeof opts.cwd === "string" ? opts.cwd : null,
        outbox: typeof opts.outbox === "string" ? opts.outbox : null,
        lease: typeof opts.lease === "string" ? opts.lease : null,
      });
      if (!done.ok) return needsHuman("エンベロープを反映できない", done);
      return emit({
        command: "apply",
        ...done.applied,
        createdPr: done.createdPr,
        posted: done.posted,
      });
    }

    case "merge-train": {
      requireConfigured(config);
      const result = mergeTrain(config, { dryRun: Boolean(opts["dry-run"]) });
      return emit({ command: "merge-train", ...result, intents: dryRunIntents() });
    }

    case "conflict": {
      const files = String(opts.files || "").split(",").filter(Boolean);
      const result = classifyConflict(config, files);
      if (result.needs_human) return needsHuman("判断が必要な競合", result);
      return emit({ command: "conflict", ...result });
    }

    default:
      process.stdout.write(fs.readFileSync(new URL("./USAGE.txt", import.meta.url), "utf8"));
      return command ? EXIT_ERROR : EXIT_OK;
  }
}

function renderNext(config, body) {
  if (!body.top) return "やることはありません。AIの作業は順調です。";
  const t = body.top;
  const def = HUMAN_KINDS.find((k) => k.kind === t.kind);
  const counts = Object.entries(body.counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join("  ");
  return [
    ` ${t.repo}`,
    "",
    ` ▶ [${def.label}] ${t.key} ${t.title || ""}`,
    `   目安${def.estMin}分`,
    "",
    `   ${counts}`,
  ].join("\n");
}

function renderLint(body) {
  if (body.ok && !body.findings.length) return "lint: 問題なし";
  return body.findings
    .map((f) => `  [${f.severity}] ${f.rule}: ${f.message}`)
    .concat(body.ok ? ["lint: block なし"] : [`lint: block ${body.blocking} 件 → 作り直し`])
    .join("\n");
}

try {
  process.exitCode = (await main()) ?? EXIT_OK;
} catch (err) {
  process.exitCode = fail(String(err?.message || err));
}
