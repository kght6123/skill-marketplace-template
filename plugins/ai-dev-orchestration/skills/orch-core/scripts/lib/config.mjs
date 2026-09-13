// 設定の読み込み。$ORCH_HOME/orch.config.json が既定。
// js-yaml が解決できる環境なら orch.config.yaml も読む（任意）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ORCH_HOME =
  process.env.ORCH_HOME || path.join(os.homedir(), ".orch");

export const DEFAULT_CONFIG = {
  // 自分のアカウント。スタンプの押し主判定に使う（他人の同じスタンプには反応しない）
  account: null,

  // 使うプロファイル。ORCH_PROFILE か --profile が優先。
  // 名前はマネージャのモデル。プランで自動判別はできないので、明示的に選ぶ。
  profile: null,
  profiles: {
    sonnet: { manager: { model: "sonnet" }, worker: { model: "sonnet" } },
    opus: { manager: { model: "opus" }, worker: { model: "sonnet" } },
    fable: { manager: { model: "fable" }, worker: { model: "opus" } },
  },

  // マネージャのモデル。設定では変えられないので、起動時の指定に使う目安
  manager: { model: "default" },

  // どのリアクションをどの意味に使うか。GitHub で普段使っている絵文字と
  // ぶつかるなら、ここを変える。使えるのは GitHub の8種類:
  //   rocket / hooray / eyes / +1 / -1 / laugh / confused / heart
  // それぞれ1つでも配列でも書ける。同じ意味に複数のリアクションを割り当ててよい。
  stamps: {
    approve: ["rocket", "+1", "heart"], // 承認・着手OK
    park: ["laugh"],                    // 後回し（parked）
    redo: ["-1", "confused", "eyes"],   // 作り直し
  },

  // 段階的に導入するための段。AIはこれを人に確認しない。設定に従うだけ。
  //   1 理解メモを手で試す / 2 状態の自動遷移 / 3 next の1画面
  //   4 実装（orch worker・next --mode build）/ 5 マージ（orch merge-train）
  // スクリプトが実際に止めるのは 4 と 5。1〜3 は運用の目安。
  phase: 5,
  // 監視対象リポジトリ。"org/repo" か { name, path } で書く。
  // path はローカルのチェックアウト。ワーカーを起動するのに要る（AIはcloneしない）。
  repos: [],
  // worktree を作る場所
  worktreeRoot: null,
  // AIが作るブランチの接頭辞。force push を許すのはこの接頭辞だけ
  branchPrefix: "orch/",
  // ワーカーの起動コマンド
  // ワーカーの起動コマンド。Claude Code 以外でも、
  // 「プロンプトを渡して標準出力を読む」CLIならそのまま使える。
  //   args に {prompt} があればその位置に差し込む。無ければ末尾に足す
  //   promptVia: "arg"（既定）/ "stdin"
  //   model を入れると modelFlag（既定 --model）と一緒に渡す
  worker: {
    command: "claude",
    args: ["-p"],
    promptVia: "arg",
    model: null,
    modelFlag: "--model",
    timeoutMin: 30,
  },
  wip: { selfReview: 3, memoReview: 3, splitReview: 2 },
  sizing: { maxPrs: 10, maxExamples: 5, maxDepth: 3 },
  nextTask: {
    focus: { sameProjectFirst: true, timeboxMin: 45 },
    interrupt: ["triage"],
    audit: { at: "17:00" },
    priority: ["blocking", "milestoneDue", "age"],
  },
  review: {
    maxRounds: 2,
    onError: "needs-human",
    // memo-check は無効化できない組み込みレビュアー（仕様5章）
    steps: [{ id: "memo-check", builtin: "memo-consistency" }],
  },
  // 1本目のスタックの分岐元。変更ファイルの算出にも使う
  defaultBranch: "main",
  merge: {
    method: "merge",
    conflict: { humanPaths: ["**/auth/**", "**/migrations/**"], regenerate: {} },
  },
  reviewers: { default: { users: [], assign: "one", maxOpenPerReviewer: 3 }, repos: {}, away: [] },
  limits: { memoPerTick: 3, implementPerBuild: 1, maxStackedPrs: 10, parallelWorkers: 12 },
};

function deepMerge(base, override) {
  if (Array.isArray(override)) return override;
  if (override === null || typeof override !== "object") return override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in base && base[k] && typeof base[k] === "object" ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function configPath() {
  const json = path.join(ORCH_HOME, "orch.config.json");
  const yaml = path.join(ORCH_HOME, "orch.config.yaml");
  if (fs.existsSync(json)) return json;
  if (fs.existsSync(yaml)) return yaml;
  return json;
}

export async function loadConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG, _path: file, _exists: false };
  const raw = fs.readFileSync(file, "utf8");
  let parsed;
  if (file.endsWith(".yaml") || file.endsWith(".yml")) {
    const yaml = await import("js-yaml").catch(() => null);
    if (!yaml) {
      throw new Error(
        `${file} を読むには js-yaml が必要です。orch.config.json に変換してください`,
      );
    }
    parsed = yaml.default.load(raw);
  } else {
    parsed = JSON.parse(raw);
  }
  const merged = deepMerge(DEFAULT_CONFIG, parsed || {});
  const name = process.env.ORCH_PROFILE || merged.profile || null;
  if (name && !merged.profiles?.[name]) {
    throw new Error(
      `profiles に "${name}" がありません（${Object.keys(merged.profiles || {}).join(" / ") || "未定義"}）`,
    );
  }
  const final = name ? deepMerge(merged, merged.profiles[name]) : merged;
  return { ...final, _profile: name, _path: file, _exists: true };
}

// repos は "org/repo" でも { name, path } でも書ける。内部では後者に揃える。
export function normalizeRepos(config) {
  return (config.repos || []).map((r) =>
    typeof r === "string" ? { name: r, path: null } : { name: r.name, path: r.path || null },
  );
}

export function repoNames(config) {
  return normalizeRepos(config).map((r) => r.name);
}

export function repoConfig(config, name) {
  return normalizeRepos(config).find((r) => r.name === name) || { name, path: null };
}

// worktree の置き場。既定は $ORCH_HOME/worktrees。
export function worktreeRoot(config) {
  const raw = config.worktreeRoot || path.join(ORCH_HOME, "worktrees");
  return raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
}

// マネージャかワーカーか。ワーカーは state を書けない（orch.mjs が拒否する）。
export function role() {
  return process.env.ORCH_ROLE === "worker" ? "worker" : "manager";
}

// リポジトリごとのレビュアー設定を解決する
export function reviewersFor(config, repo) {
  const base = config.reviewers.default;
  const override = config.reviewers.repos?.[repo] || {};
  const merged = { ...base, ...override };
  merged.users = (merged.users || []).filter((u) => !(config.reviewers.away || []).includes(u));
  return merged;
}
