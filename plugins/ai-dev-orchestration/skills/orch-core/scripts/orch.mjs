#!/usr/bin/env node
// orch — AI開発オーケストレーションの決定的な処理をまとめた CLI。
//
// AI はスキルからこの CLI を実行し、--json の出力に従う。
// 判定（状態遷移・WIP・並び順・マージ可否・lint）はすべてここで完結し、AI は再計算しない。
//
//   orch init
//   orch sync [--dry-run] [--rebuild]
//   orch queue [--human]
//   orch next [--mode memo|build] [--minutes N] [--project org/repo] [--human]
//   orch state list|get|set ...
//   orch post --key org/repo#1 --kind memo --body memo.md [--pr 46] [--update]
//   orch lint memo <file> | orch lint pr <file> [--title "feat(x): ... [1/2] #1"]
//   orch review run|record|status --key org/repo#1 --pr 46 [...]
//   orch worker --key org/repo#1 --action implement --prompt task.md [--dry-run]
//   orch apply --file result.json
//   orch merge-train [--dry-run]
//   orch conflict --files a.ts,b.ts
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
import { lintMemo, lintPr } from "./lib/lint.mjs";
import * as review from "./lib/review.mjs";
import { mergeTrain, classifyConflict } from "./lib/merge-train.mjs";
import { runWorker, parseEnvelope, applyEnvelope } from "./lib/worker.mjs";

const { opts, positional } = parseArgs(process.argv.slice(2));
const command = positional[0];
const human = Boolean(opts.human);
setDryRun(opts["dry-run"]);

// ワーカーに実行させないコマンド（state を書くもの）
const MANAGER_ONLY = ["sync", "post", "merge-train", "worker", "apply"];
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
        const work = selectWork(state, config, opts.mode, opts.limit && Number(opts.limit));
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
      const result =
        kind === "pr"
          ? lintPr(text, { title: opts.title })
          : lintMemo(text);
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

    case "worker": {
      requireConfigured(config);
      if (!opts.key || !opts.prompt) return fail("--key と --prompt が要ります");
      const result = runWorker(config, {
        key: opts.key,
        action: opts.action || "implement",
        promptFile: opts.prompt,
        dryRun: Boolean(opts["dry-run"]),
      });
      if (result.needs_human) return needsHuman("ワーカーの結果を適用できない", result);
      return emit({ command: "worker", ...result });
    }

    case "apply": {
      // ワーカーの結果エンベロープを state に反映する（マネージャ専用）
      const file = opts.file || positional[1];
      if (!file || !fs.existsSync(file)) return fail(`エンベロープのファイルがありません: ${file}`);
      const envelope = parseEnvelope(fs.readFileSync(file, "utf8"));
      if (!envelope.ok) return needsHuman("エンベロープが不正", { errors: envelope.errors });
      return emit({ command: "apply", ...applyEnvelope(envelope.data) });
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
