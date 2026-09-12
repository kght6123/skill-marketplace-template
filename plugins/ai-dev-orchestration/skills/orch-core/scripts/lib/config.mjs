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
  // 監視対象リポジトリ。"org/repo" か { name, path } で書く。
  // path はローカルのチェックアウト。ワーカーを起動するのに要る（AIはcloneしない）。
  repos: [],
  // worktree を作る場所
  worktreeRoot: null,
  // ワーカーの起動コマンド
  // ワーカーの起動コマンド。Claude Code 以外でも、
  // 「プロンプトを渡して標準出力を読む」CLIならそのまま使える。
  //   args に {prompt} があればその位置に差し込む。無ければ末尾に足す
  //   promptVia: "arg"（既定）/ "stdin"
  worker: { command: "claude", args: ["-p"], promptVia: "arg", timeoutMin: 30 },
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
    steps: [{ id: "memo-check", builtin: "memo-consistency" }],
  },
  merge: {
    method: "merge",
    conflict: { humanPaths: ["**/auth/**", "**/migrations/**"], regenerate: {} },
  },
  reviewers: { default: { users: [], assign: "one", maxOpenPerReviewer: 3 }, repos: {}, away: [] },
  limits: { memoPerTick: 3, implementPerBuild: 1, maxStackedPrs: 10, parallelWorkers: 2 },
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
  return { ...deepMerge(DEFAULT_CONFIG, parsed || {}), _path: file, _exists: true };
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
