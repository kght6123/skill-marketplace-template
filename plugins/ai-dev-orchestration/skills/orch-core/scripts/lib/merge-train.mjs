// マージ条件の判定とマージ実行。仕様7章。
// AI はこのコマンドを起動するだけで、マージ可否を自分で判断しない。
import { ghJson, ghWrite, isDryRun } from "./gh.mjs";
import { loadState, updateState, parseKey } from "./state.mjs";

const OK_CHECK = ["SUCCESS", "NEUTRAL", "SKIPPED", "EXPECTED"];

function unresolvedThreads(nameWithOwner, number) {
  const [owner, repo] = nameWithOwner.split("/");
  const query = `query($owner:String!,$repo:String!,$number:Int!){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$number){ reviewThreads(first:100){ nodes{ isResolved isOutdated } } }
    }}`;
  const out = ghJson(
    ["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `repo=${repo}`, "-F", `number=${number}`],
    { allowFail: true },
  );
  const nodes = out?.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
  return nodes.filter((n) => !n.isResolved && !n.isOutdated).length;
}

// マージ条件をすべて評価する。1つでも欠ければマージしない。
export function evaluate(entry, pr) {
  const { nameWithOwner } = parseKey(entry.key);
  const view = ghJson(
    ["pr", "view", String(pr.number), "--repo", nameWithOwner,
     "--json", "state,headRefOid,reviewDecision,mergeable,statusCheckRollup,latestReviews,baseRefName"],
    { allowFail: true },
  );
  if (!view) return { mergeable: false, reasons: ["PRを取得できない"] };
  if (view.state === "MERGED") return { mergeable: false, merged: true, reasons: ["マージ済み"] };

  const reasons = [];
  if (view.reviewDecision !== "APPROVED") reasons.push(`reviewDecision が ${view.reviewDecision || "未設定"}`);
  if (view.mergeable !== "MERGEABLE") reasons.push(`mergeable が ${view.mergeable}`);

  // そのレビューが現在の head SHA に対するものか
  const approvedAtHead = (view.latestReviews || []).some(
    (r) => r.state === "APPROVED" && r.commit?.oid === view.headRefOid,
  );
  if (!approvedAtHead) reasons.push("承認が現在の head SHA に対するものではない");

  const checks = view.statusCheckRollup || [];
  const failing = checks.filter(
    (c) => !OK_CHECK.includes(c.conclusion || c.state || "") && (c.status === "COMPLETED" || c.state),
  );
  if (failing.length) reasons.push(`CI が未成功: ${failing.map((c) => c.name || c.context).join(", ")}`);
  if (checks.some((c) => c.status && c.status !== "COMPLETED")) reasons.push("CI が実行中");

  const open = unresolvedThreads(nameWithOwner, pr.number);
  if (open > 0) reasons.push(`未解決のレビュースレッドが ${open} 件`);
  if (pr.triageCommentId && !pr.triageApplied) reasons.push("指摘の対応確認が未完了");

  // スタック内の前のPRがすべてマージ済みか
  const earlier = (entry.prs || []).filter((p) => p.order < pr.order && !p.merged);
  if (earlier.length) reasons.push(`前のPRが未マージ: ${earlier.map((p) => `#${p.number}`).join(", ")}`);

  return { mergeable: reasons.length === 0, reasons, headSha: view.headRefOid };
}

export function mergeTrain(config, { dryRun = false } = {}) {
  if ((config.phase ?? 5) < 5) {
    return { results: [], blocked: "phase", phase: config.phase, dryRun };
  }
  const state = loadState();
  const results = [];
  for (const entry of Object.values(state.issues)) {
    const prs = [...(entry.prs || [])].sort((a, b) => a.order - b.order);
    for (const pr of prs) {
      if (pr.merged) continue;
      const verdict = evaluate(entry, pr);
      if (!verdict.mergeable) {
        results.push({ key: entry.key, pr: pr.number, merged: false, reasons: verdict.reasons });
        break; // スタックは順番どおり。前が止まれば後ろも待機
      }
      const { nameWithOwner } = parseKey(entry.key);
      if (dryRun) {
        results.push({ key: entry.key, pr: pr.number, merged: false, wouldMerge: true });
        break;
      }
      // マージ方式はマージコミット。head ブランチを消すと次のPRの base が自動で main に切り替わる
      ghWrite(
        ["pr", "merge", String(pr.number), "--repo", nameWithOwner, `--${config.merge.method}`, "--delete-branch"],
        { intent: `${entry.key} の PR #${pr.number} をマージ` },
      );
      // マージのたびに短くロックを取って記録する
      updateState((fresh) => {
        const target = (fresh.issues[entry.key].prs || []).find((p) => p.number === pr.number);
        if (target) target.merged = true;
      });
      pr.merged = true;
      results.push({ key: entry.key, pr: pr.number, merged: true });
    }
  }
  return { results, dryRun: dryRun || isDryRun() };
}

// 競合の分類。自動解決してよいものと人間に確認するものを分ける（仕様7章の表）。
export function classifyConflict(config, files) {
  const humanPaths = config.merge.conflict.humanPaths || [];
  const regenerate = config.merge.conflict.regenerate || {};
  const auto = [];
  const human = [];
  for (const file of files) {
    if (regenerate[file]) {
      auto.push({ file, how: `再生成: ${regenerate[file]}` });
      continue;
    }
    const isHuman = humanPaths.some((p) => {
      const re = new RegExp(
        "^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "::").replace(/\*/g, "[^/]*").replace(/::/g, ".*") + "$",
      );
      return re.test(file);
    });
    if (isHuman) human.push({ file, why: "重要パス" });
    else auto.push({ file, how: "AIが解決を試みる（判断が要るなら human へ）" });
  }
  return { auto, human, needs_human: human.length > 0 };
}
