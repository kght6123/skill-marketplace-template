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

// 3. parked は後回しスタンプが外れれば復帰する
resetState();
run(["state", "set", "org/order-api#124", "--status", "parked"]);
run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactions: [{ content: "rocket", created_at: "2026-09-12T01:00:00Z", user: { login: "kght6123" } }],
}) });
check("後回しが外れて承認があれば parked から戻る",
  json(["state", "get", "org/order-api#124"]).entry.status, "sizing");

// 後回しが残っていれば parked のまま
resetState();
run(["state", "set", "org/order-api#124", "--status", "parked"]);
run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactions: [
    { content: "laugh", created_at: "2026-09-12T01:00:00Z", user: { login: "kght6123" } },
    { content: "rocket", created_at: "2026-09-12T02:00:00Z", user: { login: "kght6123" } },
  ],
}) });
check("後回しが残っていれば parked のまま",
  json(["state", "get", "org/order-api#124"]).entry.status, "parked");

// 割り当てを変えれば、そのリアクションで parked になる
resetState({ stamps: { approve: "rocket", park: "eyes", redo: ["-1"] } }); // 割り当ては自由に変えられる
run(["state", "set", "org/order-api#124", "--status", "memo-review"]);
run(["sync"], { env: withGh({
  issueList: [],
  comment: { id: 2345678902, body: "## 理解メモ", updated_at: "2026-09-12T00:00:00Z" },
  commentReactions: [{ content: "eyes", created_at: "2026-09-12T01:00:00Z", user: { login: "kght6123" } }],
}) });
check("割り当てを変えたスタンプで parked になる",
  json(["state", "get", "org/order-api#124"]).entry.status, "parked");

// 既定では、コメントの 👀 は作り直し（後回しではない）
resetState();
run(["state", "set", "org/order-api#124", "--status", "memo-review"]);
run(["sync"], { env: withGh({
  issueList: [],
  comment: { id: 2345678902, body: "## 理解メモ", updated_at: "2026-09-12T00:00:00Z" },
  commentReactions: [{ content: "eyes", created_at: "2026-09-12T01:00:00Z", user: { login: "kght6123" } }],
}) });
check("コメントの 👀 は作り直しになる（parked にはしない）",
  json(["state", "get", "org/order-api#124"]).entry.status, "memo-review");

// 👍 でも ❤️ でも着手できる
for (const [name, emoji] of [["+1", "👍"], ["heart", "❤️"]]) {
  resetState();
  run(["state", "set", "org/order-api#124", "--status", "candidate"]);
  run(["sync"], { env: withGh({
    issueList: [],
    issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
    issueReactions: [{ content: name, created_at: "2026-09-12T01:00:00Z", user: { login: "kght6123" } }],
  }) });
  check(`${emoji} でも着手できる`, json(["state", "get", "org/order-api#124"]).entry.status, "sizing");
}

// Issue本文で意味を持つのは承認と後回しだけ。作り直しスタンプは無視する
resetState();
run(["state", "set", "org/order-api#124", "--status", "candidate"]);
run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactions: [{ content: "eyes", created_at: "2026-09-12T01:00:00Z", user: { login: "kght6123" } }],
}) });
check("Issue本文の 👀 は状態を変えない",
  json(["state", "get", "org/order-api#124"]).entry.status, "candidate");

const stampInfo = json(["stamps"]);
check("承認は3つ受け付ける", stampInfo.approve.map((a) => a.emoji), ["🚀", "👍", "❤️"]);
check("後回しの割り当てを出す", stampInfo.park.map((p) => p.emoji), ["😄"]);
check("作り直しは 👎😕👀", stampInfo.redo.map((r) => r.emoji), ["👎", "😕", "👀"]);
check("フッタの文面を出す", stampInfo.footer, "🚀👍❤️ 着手OK ／ 😄 後回し");

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

// --- ワーカーは事実だけを返す ----------------------------------------
function workerCli(name, envelope) {
  const file = path.join(home, `${name}.sh`);
  fs.writeFileSync(file, ["#!/bin/sh", "cat <<JSON", "<<<ORCH_RESULT>>>", envelope, "<<<END>>>", "JSON"].join("\n"));
  fs.chmodSync(file, 0o755);
  return file;
}
function withWorker(cli, extra = {}) {
  return {
    repos: [{ name: "org/order-api", path: repoPath }],
    worktreeRoot: path.join(home, "wt-guard"),
    branchPrefix: "guard/",
    worker: { command: cli, args: [] },
    ...extra,
  };
}

for (const [label, envelope, expect] of [
  ["merged を返す", '{ "key": "org/order-api#125", "action": "implement", "prs": [{ "number": 60, "merged": true }] }', "prs[0].merged"],
  ["selfApproved を返す", '{ "key": "org/order-api#125", "action": "implement", "prs": [{ "number": 60, "selfApproved": true }] }', "prs[0].selfApproved"],
  ["approvalCommentId を返す", '{ "key": "org/order-api#125", "action": "implement", "prs": [{ "number": 60, "approvalCommentId": 9 }] }', "prs[0].approvalCommentId"],
  ["done に飛ぶ", '{ "key": "org/order-api#125", "action": "implement", "status": "done" }', "done には遷移できない"],
  ["知らない項目を足す", '{ "key": "org/order-api#125", "action": "implement", "mergeNow": true }', "知らない項目: mergeNow"],
]) {
  resetState(withWorker(workerCli(`w-${expect.replace(/\W/g, "")}`, envelope)));
  const rejected = json(["worker", "--key", "org/order-api#125", "--prompt", promptFile], { expectExit: 3 });
  check(`ワーカーが ${label} → 拒否`, rejected.errors.some((e) => e.includes(expect)), true);
}

// 許された範囲なら通り、指摘対応の完了はマネージャが決める
resetState(withWorker(workerCli("w-ok",
  '{ "key": "org/order-api#125", "action": "implement", "status": "pr-review",\n' +
  '  "prs": [{ "number": 60, "headSha": "aaa", "branch": "guard/125" }] }')));
const okRun = json(["worker", "--key", "org/order-api#125", "--action", "implement", "--prompt", promptFile]);
check("観測した事実は反映される", okRun.applied.prs.map((p) => p.number), [60]);
check("承認は勝手に立たない", okRun.applied.prs[0].selfApproved, false);

// --- 承認用コメントはマネージャが投稿する ------------------------------
resetState(withWorker(workerCli("w-comment",
  '{ "key": "org/order-api#125", "action": "implement", "status": "pr-review",\n' +
  '  "prs": [{ "number": 61, "headSha": "bbb" }],\n' +
  '  "comments": [{ "kind": "approve", "pr": 61, "body": "<!-- ai-approve v1 -->\\nレビュー対象" }] }')));
const withComment = json(["worker", "--key", "org/order-api#125", "--action", "implement", "--prompt", promptFile],
  { env: withGh({ postedComment: { id: 777 } }) });
check("エンベロープのコメントを投稿する", withComment.posted[0].commentId, 777);
check("approvalCommentId を state に記録する",
  json(["state", "get", "org/order-api#125"]).entry.prs[0].approvalCommentId, 777);

// --- セルフレビュー未承認ではマージしない ------------------------------
resetState();
const greenThreads = { data: { repository: { pullRequest: { reviewThreads: {
  nodes: [], pageInfo: { hasNextPage: false, endCursor: null },
} } } } };
const greenView = {
  state: "OPEN", headRefOid: "abc123", reviewDecision: "APPROVED", mergeable: "MERGEABLE",
  statusCheckRollup: [{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }],
  latestReviews: [{ state: "APPROVED", commit: { oid: "abc123" } }],
};
run(["state", "set", "org/order-api#123", "--set", JSON.stringify({
  status: "pr-review",
  prs: [{ number: 46, order: 1, headSha: "abc123", merged: false, selfApproved: false }],
})]);
const noSelf = json(["merge-train", "--dry-run"], { env: withGh({ prView: greenView, graphql: greenThreads }) });
check("セルフレビュー未承認ならマージしない",
  noSelf.results[0].reasons.some((r) => r.includes("セルフレビューが未承認")), true);

run(["state", "set", "org/order-api#123", "--set", JSON.stringify({
  prs: [{ number: 46, order: 1, headSha: "abc123", merged: false, selfApproved: true, approvedSha: "old" }],
})]);
const staleSelf = json(["merge-train", "--dry-run"], { env: withGh({ prView: greenView, graphql: greenThreads }) });
check("承認が古い head のものならマージしない",
  staleSelf.results[0].reasons.some((r) => r.includes("現在の head ではない")), true);

run(["state", "set", "org/order-api#123", "--set", JSON.stringify({
  prs: [{ number: 46, order: 1, headSha: "abc123", merged: false, selfApproved: true, approvedSha: "abc123" }],
})]);
const green = json(["merge-train", "--dry-run"], { env: withGh({ prView: greenView, graphql: greenThreads }) });
check("すべて揃えばマージ対象になる", green.results[0].wouldMerge, true);

// --- 片側だけ落ちたときに承認を有効扱いしない --------------------------
resetState();
run(["state", "set", "org/order-api#124", "--status", "memo-review"]);
run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactions: [],
  commentFails: true, // 本文と更新日時が取れない
  commentReactions: [{ content: "rocket", created_at: "2026-09-12T01:00:00Z", user: { login: "kght6123" } }],
}) });
check("コメント本文が取れなければ承認を進めない",
  json(["state", "get", "org/order-api#124"]).entry.status, "memo-review");

// 取れるようになれば進む
run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactions: [],
  comment: { id: 2345678902, body: "## 理解メモ", updated_at: "2026-09-12T00:00:00Z" },
  commentReactions: [{ content: "rocket", created_at: "2026-09-12T01:00:00Z", user: { login: "kght6123" } }],
}) });
check("取得できたら承認が通る", json(["state", "get", "org/order-api#124"]).entry.status, "ready");

// --- parked は元の状態へ戻る ------------------------------------------
resetState();
run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactions: [],
  comment: { id: 2345678901, body: "承認用", updated_at: "2026-09-12T00:00:00Z" },
  commentReactions: [{ content: "laugh", created_at: "2026-09-12T01:00:00Z", user: { login: "kght6123" } }],
}) });
const parkedEntry = json(["state", "get", "org/order-api#123"]).entry;
check("pr-review からでも後回しにできる", parkedEntry.status, "parked");
check("元の状態を覚えている", parkedEntry.parkedFrom, "pr-review");

run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactions: [],
  comment: { id: 2345678901, body: "承認用", updated_at: "2026-09-12T00:00:00Z" },
  commentReactions: [],
}) });
check("後回しを外すと元の状態に戻る（sizing に巻き戻らない）",
  json(["state", "get", "org/order-api#123"]).entry.status, "pr-review");

// リアクションが取れないときは、外れたと判断しない
run(["state", "set", "org/order-api#123", "--status", "parked", "--set", '{"parkedFrom":"pr-review"}']);
run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactionsFail: true,
  comment: { id: 2345678901, body: "承認用", updated_at: "2026-09-12T00:00:00Z" },
  commentReactions: [],
}) });
check("確認できないうちは parked のまま",
  json(["state", "get", "org/order-api#123"]).entry.status, "parked");

// --- レビューコマンドが落ちたら pass にしない --------------------------
resetState({ review: { maxRounds: 2, onError: "needs-human", steps: [{ id: "lint", command: "exit 1" }] } });
run(["state", "set", "org/order-api#123", "--set", JSON.stringify({
  status: "pr-review", prs: [{ number: 46, order: 1, headSha: "abc", merged: false }],
})]);
run(["review", "run", "--key", "org/order-api#123", "--pr", "46"]);
const crashed = json(["review", "status", "--key", "org/order-api#123", "--pr", "46"], { expectExit: 3 });
check("レビューが落ちたら pass にしない", crashed.decision, "needs-human");
check("落ちた reviewer を挙げる", crashed.incomplete, ["lint"]);

// onError: skip なら飛ばして続ける
resetState({ review: { maxRounds: 2, onError: "skip", steps: [{ id: "lint", command: "exit 1" }] } });
run(["state", "set", "org/order-api#123", "--set", JSON.stringify({
  status: "pr-review", prs: [{ number: 46, order: 1, headSha: "abc", merged: false }],
})]);
run(["review", "run", "--key", "org/order-api#123", "--pr", "46"]);
check("onError: skip なら続行する",
  json(["review", "status", "--key", "org/order-api#123", "--pr", "46"]).decision, "pass");

// --- 同時に始めた2ワーカーが同じ worktree に入らない --------------------
const barrierCli = path.join(home, "barrier-cli.sh");
fs.writeFileSync(barrierCli, [
  "#!/bin/sh",
  "sleep 1",
  "cat <<JSON",
  "<<<ORCH_RESULT>>>",
  '{ "key": "$ORCH_KEY", "action": "$ORCH_ACTION", "notes": "$(pwd)" }',
  "<<<END>>>",
  "JSON",
].join("\n"));
fs.chmodSync(barrierCli, 0o755);
resetState({
  repos: [{ name: "org/order-api", path: repoPath }], worktreeRoot: path.join(home, "wt-barrier"),
  branchPrefix: "barrier/",
  worker: { command: barrierCli, args: [], timeoutMin: 30 },
});
const together = await Promise.all([0, 0].map(() =>
  new Promise((resolve) => {
    const proc = spawn("node", [orch, "worker", "--key", "org/order-api#125", "--prompt", promptFile], {
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, ORCH_HOME: home },
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("close", () => resolve(JSON.parse(out)));
  })));
check("同時に始めても同じ worktree に入らない",
  new Set(together.map((r) => r.cwd)).size, 2);


// --- ワーカーが 0 以外で終わったら、エンベロープがあっても採用しない --------
// 出力の後でフックや後処理が落ちた可能性がある。部分的な stdout は信用できない。
const dyingCli = path.join(home, "dying.sh");
fs.writeFileSync(dyingCli, [
  "#!/bin/sh",
  "cat <<JSON",
  "<<<ORCH_RESULT>>>",
  '{ "key": "org/order-api#125", "action": "implement", "status": "pr-review",',
  '  "prs": [{ "number": 70, "headSha": "ccc" }] }',
  "<<<END>>>",
  "JSON",
  "exit 1",
].join("\n"));
fs.chmodSync(dyingCli, 0o755);
resetState(withWorker(dyingCli, { branchPrefix: "dying/", worktreeRoot: path.join(home, "wt-dying") }));
const beforeDying = fs.readFileSync(path.join(home, "state.json"), "utf8");
const dying = json(["worker", "--key", "org/order-api#125", "--prompt", promptFile], { expectExit: 3 });
check("終了コードが 0 でなければエンベロープを採用しない", dying.needs_human, true);
check("終了コードを理由に挙げる", dying.exitCode, 1);
check("state は変わらない", fs.readFileSync(path.join(home, "state.json"), "utf8"), beforeDying);

// --- コメントAPIだけ落ちたら、回答が揃ったと判断しない --------------------
resetState();
run(["state", "set", "org/order-api#124", "--status", "waiting-answer"]);
run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactions: [],
  commentFails: true,        // 本文だけ取れない
  commentReactions: [],      // リアクションは取れる
}) });
const stillWaiting = json(["state", "get", "org/order-api#124"]).entry;
check("コメント本文が取れなければ answersReady にしない", stillWaiting.answersReady ?? false, false);
check("waiting-answer のまま", stillWaiting.status, "waiting-answer");

// 取れるようになり、確認事項が全部チェック済みなら回答ありになる
run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactions: [],
  comment: { id: 2345678902, body: "## 確認事項\n- [x] A\n- [x] B", updated_at: "2026-09-12T00:00:00Z" },
  commentReactions: [],
}) });
check("取れたら answersReady が立つ",
  json(["state", "get", "org/order-api#124"]).entry.answersReady, true);

// --- post --dry-run は state を変えない ----------------------------------
resetState();
const beforePost = fs.readFileSync(path.join(home, "state.json"), "utf8");
const wouldPost = json(
  ["post", "--key", "org/order-api#124", "--kind", "memo", "--body", path.join(fixtures, "memo-ok.md"), "--dry-run"],
  { env: withGh({ postedComment: { id: 999 } }) },
);
check("dry-run は投稿内容を返すだけ", wouldPost.dryRun, true);
check("どこへ投稿するかは出す", wouldPost.wouldPost.kind, "memo");
check("dry-run では state を書かない",
  fs.readFileSync(path.join(home, "state.json"), "utf8"), beforePost);

// --- 生きているワーカーの枠は、時間が経っても奪わない --------------------
// タイムアウトだけで判断すると、長く走っているワーカーの worktree を横取りする。
resetState({
  repos: [{ name: "org/order-api", path: repoPath }],
  worktreeRoot: path.join(home, "wt-alive"),
  branchPrefix: "alive/",
  worker: { command: "claude", args: ["-p"], timeoutMin: 1 }, // 1分で stale 扱いになる設定
});
const aliveDir = path.join(home, "wt-alive", "order-api-125");
fs.mkdirSync(path.join(home, "wt-alive"), { recursive: true });
fs.writeFileSync(`${aliveDir}.lock`, JSON.stringify({
  pid: process.pid, hostname: os.hostname(), at: "2000-01-01T00:00:00Z",
}));
fs.utimesSync(`${aliveDir}.lock`, new Date(0), new Date(0)); // mtime は大昔
const avoided = json(["worker", "--key", "org/order-api#125", "--prompt", promptFile, "--dry-run"]);
check("持ち主のプロセスが生きていれば枠を奪わない", avoided.slot, 2);

// 持ち主が死んでいれば、古いロックは剥がして再利用する
fs.writeFileSync(`${aliveDir}.lock`, JSON.stringify({
  pid: 2147483646, hostname: os.hostname(), at: "2000-01-01T00:00:00Z",
}));
check("持ち主が死んでいれば枠を再利用する",
  json(["worker", "--key", "org/order-api#125", "--prompt", promptFile, "--dry-run"]).slot, 1);

// --- レビューの出力がJSONでなければ pass にしない ------------------------
resetState({ review: { maxRounds: 2, onError: "needs-human", steps: [{ id: "lint", command: "echo not-json" }] } });
run(["state", "set", "org/order-api#123", "--set", JSON.stringify({
  status: "pr-review", prs: [{ number: 46, order: 1, headSha: "abc", merged: false }],
})]);
const badJson = json(["review", "run", "--key", "org/order-api#123", "--pr", "46"]);
check("JSONとして読めない出力は失敗扱い", badJson.executed[0].ok, false);
check("JSONでないレビューは pass にしない",
  json(["review", "status", "--key", "org/order-api#123", "--pr", "46"], { expectExit: 3 }).decision,
  "needs-human");

// --- 使い回す worktree は前回の残骸を消してから渡す ----------------------
const reuseCli = path.join(home, "reuse.sh");
const dirtyOut = path.join(home, "reuse-dirty.txt");
fs.writeFileSync(reuseCli, [
  "#!/bin/sh",
  `git status --porcelain > ${dirtyOut}`,
  "cat <<JSON",
  "<<<ORCH_RESULT>>>",
  '{ "key": "$ORCH_KEY", "action": "$ORCH_ACTION" }',
  "<<<END>>>",
  "JSON",
].join("\n"));
fs.chmodSync(reuseCli, 0o755);
resetState(withWorker(reuseCli, { branchPrefix: "reuse/", worktreeRoot: path.join(home, "wt-reuse") }));
run(["worker", "--key", "org/order-api#125", "--prompt", promptFile]);
const reuseDir = path.join(home, "wt-reuse", "order-api-125");
fs.writeFileSync(path.join(reuseDir, "README.md"), "前のワーカーの書きかけ\n");
fs.writeFileSync(path.join(reuseDir, "junk.tmp"), "残骸\n");
const reused = json(["worker", "--key", "org/order-api#125", "--prompt", promptFile]);
check("使い回す worktree は綺麗な状態で渡される", fs.readFileSync(dirtyOut, "utf8").trim(), "");
check("残骸のファイルは消える", fs.existsSync(path.join(reuseDir, "junk.tmp")), false);
check("書きかけは戻る", fs.readFileSync(path.join(reuseDir, "README.md"), "utf8"), "hi\n");

// --- 通しで1周（規模判定 → メモ → 承認 → 実装 → PR作成 → 承認用コメント） ---
const e2eBody = path.join(home, "e2e-body.txt");
const e2eCli = path.join(home, "e2e.sh");
const prBody = path.join(home, "e2e-pr.md");
fs.copyFileSync(path.join(fixtures, "pr-ok.md"), prBody);
const approveBody = path.join(home, "e2e-approve.md");
fs.writeFileSync(approveBody, "<!-- ai-approve v1 sha=eee555 -->\nレビュー対象\n");
fs.writeFileSync(e2eCli, [
  "#!/bin/sh",
  "cat <<JSON",
  "<<<ORCH_RESULT>>>",
  '{ "key": "$ORCH_KEY", "action": "$ORCH_ACTION", "status": "pr-review",',
  `  "pullRequest": { "title": "feat(order-api): 期間指定でCSVを絞り込む [2/3] #123",`,
  `                   "head": "e2e/125", "bodyFile": "${prBody}" },`,
  `  "comments": [{ "kind": "approve", "bodyFile": "${approveBody}" }] }`,
  "<<<END>>>",
  "JSON",
].join("\n"));
fs.chmodSync(e2eCli, 0o755);
resetState(withWorker(e2eCli, { branchPrefix: "e2e/", worktreeRoot: path.join(home, "wt-e2e") }));

// 1. 規模判定 → 小なのでメモへ
check("規模判定から始まる",
  json(["next", "--mode", "memo"]).items.find((i) => i.key === "org/admin-web#46").action, "sizing");
run(["state", "set", "org/admin-web#46", "--set", '{"sizing":{"estimatedPrs":2,"examples":3}}']);
check("小なら理解メモを作る",
  json(["next", "--mode", "memo"]).items.find((i) => i.key === "org/admin-web#46").action, "memo");

// 2. メモを投稿 → memo-review
// 確認事項に未チェックが残っていると waiting-answer で止まるので、回答済みのメモにする
const e2eMemo = path.join(home, "e2e-memo.md");
fs.writeFileSync(e2eMemo,
  fs.readFileSync(path.join(fixtures, "memo-ok.md"), "utf8").replace(/^(\s*[-*]\s*)\[ \]/gm, "$1[x]"));
run(["post", "--key", "org/admin-web#46", "--kind", "memo", "--body", e2eMemo],
  { env: withGh({ postedComment: { id: 4242 } }) });
check("投稿でメモ確認待ちになる",
  json(["state", "get", "org/admin-web#46"]).entry.status, "memo-review");

// 3. 人間が 🚀 を押す → ready
run(["sync"], { env: withGh({
  issueList: [],
  issueView: { updatedAt: "2026-09-12T00:00:00Z", body: "本文" },
  issueReactions: [],
  comment: { id: 4242, body: "## 理解メモ", updated_at: "2026-09-12T00:00:00Z" },
  commentReactions: [{ content: "rocket", created_at: "2026-09-12T05:00:00Z", user: { login: "kght6123" } }],
}) });
check("🚀 で着手可能になる", json(["state", "get", "org/admin-web#46"]).entry.status, "ready");

// 4. build が実装として拾う
// 他の行列を空けて、承認されたメモが実装として選ばれることを見る
run(["state", "set", "org/order-api#125", "--status", "done"]);
for (const key of ["org/order-api#123", "org/order-api#124"]) {
  run(["state", "set", key, "--status", "done"]);
}
const e2eBuild = json(["next", "--mode", "build"]);
check("承認済みのメモが実装対象になる",
  e2eBuild.items.find((i) => i.key === "org/admin-web#46")?.action ?? JSON.stringify(e2eBuild),
  "implement");

// 5. ワーカーを回す → マネージャがPRを作り、承認用コメントを投稿する
resetState(withWorker(e2eCli, { branchPrefix: "e2e/", worktreeRoot: path.join(home, "wt-e2e") }));
run(["state", "set", "org/order-api#125", "--set", '{"blockedBy":[]}']);
const e2e = json(["worker", "--key", "org/order-api#125", "--action", "implement", "--prompt", promptFile],
  { env: withGh({ createdPr: 91, postedComment: { id: 8888 } }, { FAKE_GH_BODY: e2eBody }) });
check("PR はマネージャが作る", e2e.createdPr.number, 91);
check("作ったPRを state に記録する", e2e.applied.prs.map((p) => p.number), [91]);
check("承認用コメントは作ったPR番号に付く", e2e.posted[0].pr, 91);
check("approvalCommentId を記録する",
  json(["state", "get", "org/order-api#125"]).entry.prs[0].approvalCommentId, 8888);
check("投稿された本文は承認用コメントの中身",
  fs.readFileSync(e2eBody, "utf8").includes("ai-approve"), true);
check("セルフレビュー済みにはしない",
  json(["state", "get", "org/order-api#125"]).entry.prs[0].selfApproved, false);

// PR本文が lint を通らなければ、PRを作らずに止まる
const badPr = path.join(home, "e2e-bad-pr.md");
fs.writeFileSync(badPr, "見出しの無い本文\n");
const badCli = path.join(home, "e2e-bad.sh");
fs.writeFileSync(badCli, [
  "#!/bin/sh",
  "cat <<JSON",
  "<<<ORCH_RESULT>>>",
  '{ "key": "$ORCH_KEY", "action": "$ORCH_ACTION", "status": "pr-review",',
  `  "pullRequest": { "title": "feat(order-api): 期間指定でCSVを絞り込む [2/3] #123",`,
  `                   "head": "bad/125", "bodyFile": "${badPr}" } }`,
  "<<<END>>>",
  "JSON",
].join("\n"));
fs.chmodSync(badCli, 0o755);
resetState(withWorker(badCli, { branchPrefix: "bad/", worktreeRoot: path.join(home, "wt-bad") }));
const badPrRun = run(["worker", "--key", "org/order-api#125", "--action", "implement", "--prompt", promptFile],
  { expectExit: 1, env: withGh({ createdPr: 92 }) });
check("PR本文が lint を通らなければ作らない", /lint/.test(badPrRun), true);
check("PRを作らなければ state にも入らない",
  json(["state", "get", "org/order-api#125"]).entry.prs.length, 0);

fs.rmSync(home, { recursive: true, force: true });
console.log(failed ? `\n${failed} 件が失敗` : "\nすべて成功");
process.exit(failed ? 1 : 0);
