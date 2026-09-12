#!/usr/bin/env node
// スクリプトの決定的な判定を固定するテスト。gh は呼ばない。
//   node tests/run-tests.mjs
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, "..", "skills", "orch-core", "scripts");
const orch = path.join(scripts, "orch.mjs");
const fixtures = path.join(scripts, "fixtures");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "orch-test-"));

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     expected ${JSON.stringify(expected)}\n     actual   ${JSON.stringify(actual)}`}`);
}

function run(args, { expectExit = 0, env = {} } = {}) {
  try {
    const out = execFileSync("node", [orch, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ORCH_HOME: home, ...env },
    });
    if (expectExit !== 0) { failed++; console.log(`FAIL 終了コード ${expectExit} を期待したが 0`); }
    return out;
  } catch (err) {
    if (err.status !== expectExit) throw err;
    return err.stdout;
  }
}

function json(args, opts) {
  return JSON.parse(run(args, opts));
}

function resetState(overrides = {}) {
  const state = JSON.parse(fs.readFileSync(path.join(fixtures, "state.sample.json"), "utf8"));
  fs.writeFileSync(path.join(home, "state.json"), JSON.stringify(state, null, 2));
  fs.writeFileSync(
    path.join(home, "orch.config.json"),
    JSON.stringify({ account: "kght6123", repos: ["org/order-api", "org/admin-web"], ...overrides }, null, 2),
  );
}

// --- lint -------------------------------------------------------------
resetState();
check("正常な理解メモは通る", json(["lint", "memo", path.join(fixtures, "memo-ok.md")]).ok, true);

const ng = json(["lint", "memo", path.join(fixtures, "memo-ng.md")], { expectExit: 2 });
check("上限違反のメモは block になる", ng.ok, false);
check("違反した規則", ng.findings.filter((f) => f.severity === "block").map((f) => f.rule).sort(),
  ["examples", "questions", "why"]);

check("正常なPR本文は通る",
  json(["lint", "pr", path.join(fixtures, "pr-ok.md"), "--title", "feat(order-api): 期間指定でCSVを絞り込む [2/3] #123"]).ok,
  true);
check("PRタイトルの形式違反を検出",
  json(["lint", "pr", path.join(fixtures, "pr-ok.md"), "--title", "CSVフィルタ対応"], { expectExit: 2 })
    .findings.map((f) => f.rule),
  ["title"]);

// --- 並び順 -----------------------------------------------------------
resetState();
const next = json(["next"]);
check("人間向けの先頭は指摘の対応確認", next.top.kind, "triage");
check("1件だけ返す", Array.isArray(next.top), false);

// --- WIP上限 ----------------------------------------------------------
resetState({ wip: { selfReview: 1, memoReview: 3, splitReview: 2 } });
run(["state", "set", "org/order-api#125", "--set", '{"blockedBy":[]}']);
check("セルフレビューが満杯なら着手しない", json(["next", "--mode", "build"]).items, []);

resetState({ wip: { selfReview: 3, memoReview: 3, splitReview: 2 } });
run(["state", "set", "org/order-api#125", "--set", '{"blockedBy":[]}']);
check("空きがあれば着手する", json(["next", "--mode", "build"]).items, [
  { key: "org/order-api#125", action: "implement" },
]);

// --- 依存 -------------------------------------------------------------
resetState();
check("依存先が done でなければ着手しない", json(["next", "--mode", "build"]).items, []);
run(["state", "set", "org/order-api#123", "--status", "done"]);
check("依存先が done になれば着手する", json(["next", "--mode", "build"]).items, [
  { key: "org/order-api#125", action: "implement" },
]);

// --- 規模判定 ---------------------------------------------------------
resetState();
check("見積もり未提出なら規模判定から", json(["next", "--mode", "memo"]).items, [
  { key: "org/admin-web#46", action: "sizing" },
]);
run(["state", "set", "org/admin-web#46", "--set", '{"sizing":{"estimatedPrs":12,"examples":2}}']);
check("大なら分割案", json(["next", "--mode", "memo"]).items, [
  { key: "org/admin-web#46", action: "split" },
]);
run(["state", "set", "org/admin-web#46", "--set", '{"depth":3}']);
check("深さ3で大なら自動分割しない", json(["next", "--mode", "memo"]).items, []);
run(["state", "set", "org/admin-web#46", "--set", '{"depth":1,"sizing":{"estimatedPrs":2,"examples":3}}']);
check("小なら理解メモ", json(["next", "--mode", "memo"]).items, [
  { key: "org/admin-web#46", action: "memo" },
]);

// --- 競合の分類 -------------------------------------------------------
resetState({ merge: { method: "merge", conflict: { humanPaths: ["**/auth/**"], regenerate: { "pnpm-lock.yaml": "pnpm install" } } } });
const conflict = json(["conflict", "--files", "pnpm-lock.yaml,src/auth/token.ts"], { expectExit: 3 });
check("重要パスは人間に回す", conflict.human.map((h) => h.file), ["src/auth/token.ts"]);
check("ロックファイルは再生成", conflict.auto.map((a) => a.file), ["pnpm-lock.yaml"]);
check("needs_human を立てる", conflict.needs_human, true);

// --- マネージャとワーカーの境界 ---------------------------------------
resetState();
check("ワーカーは state を書けない",
  json(["state", "set", "org/order-api#123", "--status", "done"], { expectExit: 1, env: { ORCH_ROLE: "worker" } }).ok,
  false);
check("ワーカーでも lint は通る",
  json(["lint", "memo", path.join(fixtures, "memo-ok.md")], { env: { ORCH_ROLE: "worker" } }).ok,
  true);
check("ワーカーは state を読める",
  json(["state", "get", "org/order-api#123"], { env: { ORCH_ROLE: "worker" } }).entry.key,
  "org/order-api#123");

// --- 結果エンベロープ -------------------------------------------------
const envOk = path.join(home, "envelope-ok.txt");
fs.writeFileSync(envOk, [
  "ワーカーの作業ログ",
  "<<<ORCH_RESULT>>>",
  JSON.stringify({
    key: "org/order-api#124", action: "implement", status: "pr-review",
    prs: [{ number: 50, order: 1, headSha: "aaa111" }],
    review: [{ reviewer: "memo-check", findings: [] }],
  }),
  "<<<END>>>",
].join("\n"));
const applied = json(["apply", "--file", envOk]);
check("エンベロープの status が反映される", applied.status, "pr-review");
check("エンベロープの PR が反映される", applied.prs.map((p) => p.number), [50]);

const envNg = path.join(home, "envelope-ng.txt");
fs.writeFileSync(envNg, '<<<ORCH_RESULT>>>{"key":"org/order-api#124","status":"flying"}<<<END>>>');
check("不正な status のエンベロープは止まる",
  json(["apply", "--file", envNg], { expectExit: 3 }).needs_human, true);

// --- worktree ---------------------------------------------------------
const repoPath = path.join(home, "order-api");
fs.mkdirSync(repoPath, { recursive: true });
const git = (...args) => execFileSync("git", ["-C", repoPath, ...args], { stdio: "ignore" });
git("init", "-q", "-b", "main");
fs.writeFileSync(path.join(repoPath, "README.md"), "hi\n");
git("add", "-A");
git("-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", "init");

resetState({ repos: [{ name: "org/order-api", path: repoPath }], worktreeRoot: path.join(home, "wt") });
const promptFile = path.join(home, "task.md");
fs.writeFileSync(promptFile, "implement it\n");
const dry = json(["worker", "--key", "org/order-api#125", "--prompt", promptFile, "--dry-run"]);
check("worktree を作ってその中で起動する", dry.cwd, path.join(home, "wt", "order-api-125"));
check("ブランチは ai/ 接頭辞", dry.branch, "ai/125");

resetState({ repos: ["org/order-api"] });
check("path が無ければ止まる（AIはcloneしない）",
  json(["worker", "--key", "org/order-api#125", "--prompt", promptFile, "--dry-run"], { expectExit: 1 }).ok,
  false);

// --- 並行書き込み -----------------------------------------------------
resetState();
await Promise.all(
  Array.from({ length: 12 }, (_, i) =>
    new Promise((resolve) => {
      const p = spawn("node", [orch, "state", "set", `org/parallel#${i}`, "--status", "sizing"], {
        stdio: "ignore",
        env: { ...process.env, ORCH_HOME: home },
      });
      p.on("close", resolve);
    })),
);
check("並行して書いても更新が消えない",
  JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8")).issues
    ? Object.keys(JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8")).issues)
        .filter((k) => k.startsWith("org/parallel#")).length
    : 0,
  12);

fs.rmSync(home, { recursive: true, force: true });
console.log(failed ? `\n${failed} 件が失敗` : "\nすべて成功");
process.exit(failed ? 1 : 0);
