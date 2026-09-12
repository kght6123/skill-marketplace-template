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

// 残り1枠に複数投入できないこと（満杯かどうかの真偽値だけで選ぶと破れる）
resetState({ wip: { memoReview: 3, splitReview: 2, selfReview: 3 } });
for (const key of ["org/order-api#123", "org/order-api#124"]) {
  run(["state", "set", key, "--status", "memo-review"]);
}
for (const key of ["org/admin-web#46", "org/admin-web#47", "org/order-api#125"]) {
  run(["state", "set", key, "--status", "sizing",
    "--set", '{"sizing":{"estimatedPrs":2,"examples":2},"blockedBy":[]}']);
}
const room1 = json(["next", "--mode", "memo"]);
check("残り1枠なら1件しか選ばない", room1.items.length, 1);
check("消費するのは行列を増やす action だけ", room1.items[0].action, "memo");

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

// --- 段（phase による停止）-------------------------------------------
resetState({ phase: 1 });
check("phase 1 では実装を選ばない", json(["next", "--mode", "build"]).blocked, "phase");
check("phase 1 では merge-train が何もしない", json(["merge-train"]).blocked, "phase");
check("phase の一覧を出す", [json(["phase"]).phase, json(["phase"]).canImplement], [1, false]);
resetState({ phase: 4 });
check("phase 4 で実装が有効になる", json(["phase"]).canImplement, true);
check("phase 4 ではマージはまだ止まる", json(["merge-train"]).blocked, "phase");
resetState({ phase: 5 });
check("phase 5 でマージが有効になる", json(["phase"]).canMerge, true);
resetState();
check("既定は全部有効", json(["phase"]).phase, 5);

// --- プロファイル（モデルの組み合わせ）--------------------------------
resetState({ profile: "sonnet" });
const sonnet = json(["profile"]);
check("設定の profile が効く", [sonnet.active, sonnet.managerModel, sonnet.workerModel],
  ["sonnet", "sonnet", "sonnet"]);
check("マネージャの起動コマンドを出す", sonnet.startManager, "claude --model sonnet");
const opus = json(["profile", "--profile", "opus"]);
check("--profile が設定より優先される", [opus.active, opus.managerModel, opus.workerModel],
  ["opus", "opus", "sonnet"]);
const fable = json(["profile", "--profile", "fable"]);
check("fable はワーカーが opus", [fable.managerModel, fable.workerModel], ["fable", "opus"]);
check("ORCH_PROFILE でも切り替わる",
  json(["profile"], { env: { ORCH_PROFILE: "opus" } }).managerModel, "opus");
check("知らないプロファイルは止まる",
  json(["profile", "--profile", "team"], { expectExit: 1 }).ok, false);

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
check("ブランチは orch/ 接頭辞", dry.branch, "orch/125");
check("最初は slot 1", dry.slot, 1);

// --- ワーカーCLIの差し替え（Claude Code 限定にしない）----------------
const presets = {
  "claude -p <prompt>": { command: "claude", args: ["-p"] },
  "codex exec <prompt>": { command: "codex", args: ["exec"] },
  "copilot -p <prompt> --allow-all-tools": {
    command: "copilot", args: ["-p", "{prompt}", "--allow-all-tools"],
  },
};
for (const [expected, worker] of Object.entries(presets)) {
  resetState({ repos: [{ name: "org/order-api", path: repoPath }], worktreeRoot: path.join(home, "wt"), worker });
  check(`起動コマンドを組み立てる: ${expected}`,
    json(["worker", "--key", "org/order-api#125", "--prompt", promptFile, "--dry-run"]).workerCommand,
    expected);
}
resetState({
  repos: [{ name: "org/order-api", path: repoPath }], worktreeRoot: path.join(home, "wt"),
  worker: { command: "claude", args: ["-p"], promptVia: "stdin" },
});
check("stdin でプロンプトを渡す設定",
  json(["worker", "--key", "org/order-api#125", "--prompt", promptFile, "--dry-run"]).promptVia, "stdin");

resetState({
  repos: [{ name: "org/order-api", path: repoPath }], worktreeRoot: path.join(home, "wt"),
  worker: { command: "claude", args: ["-p"], model: "claude-sonnet-5" },
});
check("ワーカーのモデルを渡せる",
  json(["worker", "--key", "org/order-api#125", "--prompt", promptFile, "--dry-run"]).workerCommand,
  "claude -p --model claude-sonnet-5 <prompt>");

resetState({
  repos: [{ name: "org/order-api", path: repoPath }], worktreeRoot: path.join(home, "wt"),
  branchPrefix: "custom/",
  worker: { command: "claude", args: ["-p"] },
});
check("ブランチ接頭辞を変えられる",
  json(["worker", "--key", "org/order-api#125", "--prompt", promptFile, "--dry-run"]).branch, "custom/125");

// Claude Code ではない架空のCLIで、起動から state 反映まで通す
const fakeCli = path.join(home, "fake-cli.sh");
fs.writeFileSync(fakeCli, [
  "#!/bin/sh",
  'echo "cwd: $(pwd)"',
  "cat <<JSON",
  "<<<ORCH_RESULT>>>",
  '{ "key": "$ORCH_KEY", "action": "$ORCH_ACTION", "status": "pr-review",',
  '  "prs": [{ "number": 99, "order": 1, "headSha": "fake123" }], "notes": "fake" }',
  "<<<END>>>",
  "JSON",
].join("\n"));
fs.chmodSync(fakeCli, 0o755);
resetState({
  repos: [{ name: "org/order-api", path: repoPath }], worktreeRoot: path.join(home, "wt"),
  worker: { command: fakeCli, args: [] },
});
const ran = json(["worker", "--key", "org/order-api#125", "--action", "implement", "--prompt", promptFile]);
check("Claude Code 以外のCLIでも1周する", ran.ok, true);
check("ワーカーの結果が state に入る", ran.applied.prs.map((p) => p.number), [99]);
check("ワーカーは worktree で動いている", ran.cwd, path.join(home, "wt", "order-api-125"));

// 同じIssueに2本来たら worktree を連番で分ける
const slowCli = path.join(home, "slow-cli.sh");
fs.writeFileSync(slowCli, [
  "#!/bin/sh",
  "sleep 2",
  "cat <<JSON",
  "<<<ORCH_RESULT>>>",
  '{ "key": "$ORCH_KEY", "action": "$ORCH_ACTION", "notes": "$(pwd)" }',
  "<<<END>>>",
  "JSON",
].join("\n"));
fs.chmodSync(slowCli, 0o755);
resetState({
  repos: [{ name: "org/order-api", path: repoPath }], worktreeRoot: path.join(home, "wt-slots"),
  branchPrefix: "slots/",
  worker: { command: slowCli, args: [], timeoutMin: 30 },
});
const both = await Promise.all([0, 300].map((delay) =>
  new Promise((resolve) => {
    setTimeout(() => {
      const p = spawn("node", [orch, "worker", "--key", "org/order-api#125", "--prompt", promptFile], {
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, ORCH_HOME: home },
      });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("close", () => resolve(JSON.parse(out)));
    }, delay);
  })));
check("同時に来たら worktree の連番が分かれる", both.map((r) => r.slot).sort(), [1, 2]);
check("ブランチも連番で分かれる", both.map((r) => r.branch).sort(), ["slots/125", "slots/125-2"]);
const after = json(["worker", "--key", "org/order-api#125", "--prompt", promptFile, "--dry-run"]);
check("終わった枠は再利用される", after.slot, 1);

// --dry-run は副作用なし
resetState({
  repos: [{ name: "org/order-api", path: repoPath }], worktreeRoot: path.join(home, "wt-dry"),
  branchPrefix: "dry/", // 前のテストが作ったブランチと混ざらないように
  worker: { command: "claude", args: ["-p"] },
});
const dryPlan = json(["worker", "--key", "org/order-api#125", "--prompt", promptFile, "--dry-run"]);
check("dry-run は worktree を作らない", fs.existsSync(dryPlan.cwd), false);
check("dry-run はブランチも作らない",
  execFileSync("git", ["-C", repoPath, "branch", "--list", dryPlan.branch], { encoding: "utf8" }).trim(),
  "");

// ワーカーが別の key を返しても、その state は触らせない
const liarCli = path.join(home, "liar-cli.sh");
fs.writeFileSync(liarCli, [
  "#!/bin/sh",
  "cat <<JSON",
  "<<<ORCH_RESULT>>>",
  '{ "key": "org/order-api#123", "action": "implement", "status": "done" }',
  "<<<END>>>",
  "JSON",
].join("\n"));
fs.chmodSync(liarCli, 0o755);
resetState({
  repos: [{ name: "org/order-api", path: repoPath }], worktreeRoot: path.join(home, "wt-liar"),
  worker: { command: liarCli, args: [] },
});
const liar = json(["worker", "--key", "org/order-api#125", "--prompt", promptFile], { expectExit: 3 });
check("依頼と違う key のエンベロープは拒否する", liar.needs_human, true);
check("別Issueの state は変わらない",
  json(["state", "get", "org/order-api#123"]).entry.status, "pr-review");

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

// --- 境界が嘘をついたとき ---------------------------------------------
// ここから先は偽の gh を PATH に置いて、GitHub 側の異常を再現する。
const ghDir = path.join(home, "bin");
fs.mkdirSync(ghDir, { recursive: true });
fs.writeFileSync(
  path.join(ghDir, "gh"),
  `#!/bin/sh\nexec node ${path.join(here, "fake-gh.mjs")} "$@"\n`,
);
fs.chmodSync(path.join(ghDir, "gh"), 0o755);

const scenarioFile = path.join(home, "scenario.json");
function withGh(scenario, extra = {}) {
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario));
  return {
    PATH: `${ghDir}:${process.env.PATH}`,
    FAKE_GH_SCENARIO: scenarioFile,
    ...extra,
  };
}

// 1. 投稿の本文が「ファイルの中身」になっているか（-f だと "@/tmp/..." が飛ぶ）
resetState();
const bodyOut = path.join(home, "posted-body.txt");
const argsOut = path.join(home, "gh-args.txt");
run(["state", "set", "org/order-api#124", "--set", '{"commentId":null}']);
run(["post", "--key", "org/order-api#124", "--kind", "memo", "--body", path.join(fixtures, "memo-ok.md")],
  { env: withGh({ postedComment: { id: 555 } }, { FAKE_GH_BODY: bodyOut, FAKE_GH_ARGS: argsOut }) });
check("投稿の本文がファイルの中身になる",
  fs.readFileSync(bodyOut, "utf8").includes("## 理解メモ"), true);
check("gh には -F で渡す（-f だとパス文字列が投稿される）",
  fs.readFileSync(argsOut, "utf8").includes('"-F"'), true);
check("投稿した commentId を state に記録する",
  json(["state", "get", "org/order-api#124"]).entry.commentId, 555);

// 2. 未解決スレッドを取れないときはマージしない
resetState();
run(["state", "set", "org/order-api#123", "--set", JSON.stringify({
  status: "pr-review",
  prs: [{ number: 46, order: 1, headSha: "abc123", merged: false }],
})]);
const mergeableView = {
  state: "OPEN", headRefOid: "abc123", reviewDecision: "APPROVED", mergeable: "MERGEABLE",
  statusCheckRollup: [{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }],
  latestReviews: [{ state: "APPROVED", commit: { oid: "abc123" } }],
};
const ghDown = json(["merge-train"], { env: withGh({ prView: mergeableView, graphql: "fail" }) });
check("スレッドを取得できなければマージしない", ghDown.results[0].merged, false);
check("理由に取得失敗を挙げる",
  ghDown.results[0].reasons.some((r) => r.includes("取得できない")), true);

// outdated でも未解決なら数える
const outdated = json(["merge-train"], { env: withGh({
  prView: mergeableView,
  graphql: { data: { repository: { pullRequest: { reviewThreads: {
    nodes: [{ isResolved: false }], pageInfo: { hasNextPage: false, endCursor: null },
  } } } } },
}) });
check("未解決スレッドが残っていればマージしない",
  outdated.results[0].reasons.some((r) => r.includes("未解決")), true);

// 3. parked は 👀 が外れれば復帰する
resetState();
run(["state", "set", "org/order-api#124", "--status", "parked"]);
run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactions: [{ content: "rocket", created_at: "2026-09-12T01:00:00Z", user: { login: "kght6123" } }],
}) });
check("👀 が外れて🚀があれば parked から戻る",
  json(["state", "get", "org/order-api#124"]).entry.status, "sizing");

// 👀 が残っていれば parked のまま
resetState();
run(["state", "set", "org/order-api#124", "--status", "parked"]);
run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactions: [
    { content: "eyes", created_at: "2026-09-12T01:00:00Z", user: { login: "kght6123" } },
    { content: "rocket", created_at: "2026-09-12T02:00:00Z", user: { login: "kght6123" } },
  ],
}) });
check("👀 が残っていれば parked のまま",
  json(["state", "get", "org/order-api#124"]).entry.status, "parked");

// 4. sync はロックを持ったままGitHubを待たない
resetState();
const slowSync = spawn("node", [orch, "sync"], {
  stdio: "ignore",
  env: { ...process.env, ORCH_HOME: home, ...withGh({ issueList: [], delayMs: 1500 }) },
});
await new Promise((r) => setTimeout(r, 300));
const startedAt = Date.now();
run(["state", "set", "org/lockcheck#1", "--status", "sizing"]);
const waited = Date.now() - startedAt;
await new Promise((r) => slowSync.on("close", r));
check("sync 中でも他プロセスが state を書ける（ロックを長く持たない）", waited < 1000, true);

fs.rmSync(home, { recursive: true, force: true });
console.log(failed ? `\n${failed} 件が失敗` : "\nすべて成功");
process.exit(failed ? 1 : 0);
