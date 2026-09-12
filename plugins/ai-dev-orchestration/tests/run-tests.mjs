#!/usr/bin/env node
// スクリプトの決定的な判定を固定するテスト。gh は呼ばない。
//   node tests/run-tests.mjs
import { execFileSync } from "node:child_process";
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

function run(args, { expectExit = 0 } = {}) {
  try {
    const out = execFileSync("node", [orch, ...args], {
      encoding: "utf8",
      env: { ...process.env, ORCH_HOME: home },
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

fs.rmSync(home, { recursive: true, force: true });
console.log(failed ? `\n${failed} 件が失敗` : "\nすべて成功");
process.exit(failed ? 1 : 0);
