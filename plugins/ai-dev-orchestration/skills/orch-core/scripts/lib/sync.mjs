// GitHub の差分取得 → スタンプ読み取り → 状態遷移。AI は一切判断しない。
// 仕様3.5: 状態の一覧取得は検索せず、state.json が持つコメントIDのリアクションを直接見る。
//          新規Issueと回答だけ「前回実行以降の更新」で差分取得する。
import { ghJson, fetchReactions } from "./gh.mjs";
import { loadState, saveState, newEntry, setStatus, parseKey } from "./state.mjs";
import { ownStamps, rocketIsValid, redoStamp, allQuestionsAnswered } from "./stamps.mjs";
import { sizeOf } from "./next.mjs";

const MARKERS = {
  memo: /<!--\s*ai-memo\s+v\d+/,
  split: /<!--\s*ai-split\s+v\d+/,
  approve: /<!--\s*ai-approve\s+v\d+/,
  triage: /<!--\s*ai-triage\s+v\d+/,
};

function comment(nameWithOwner, id) {
  return ghJson(["api", `repos/${nameWithOwner}/issues/comments/${id}`], { allowFail: true });
}

function since(state) {
  if (!state.lastSync) return null;
  return state.lastSync.slice(0, 10);
}

// 前回実行以降に更新された Issue を取り込む（未登録なら candidate として登録）
function ingestIssues(state, config, transitions) {
  for (const repo of config.repos) {
    const search = since(state) ? ["--search", `updated:>=${since(state)}`] : [];
    const issues = ghJson(
      [
        "issue", "list", "--repo", repo, "--state", "open", "--limit", "100",
        "--json", "number,title,updatedAt,milestone",
        ...search,
      ],
      { allowFail: true },
    );
    for (const issue of issues || []) {
      const key = `${repo}#${issue.number}`;
      const entry = state.issues[key] || newEntry(key);
      entry.title = issue.title;
      entry.milestoneDue = issue.milestone?.dueOn ? issue.milestone.dueOn.slice(0, 10) : null;
      if (!state.issues[key]) {
        state.issues[key] = entry;
        transitions.push({ key, from: null, to: entry.status, reason: "新規取り込み" });
      }
    }
  }
}

// Issue本文のスタンプ。🚀が起点、👀で後回し。
function applyBodyStamps(entry, config, transitions) {
  if (!["candidate", "parked"].includes(entry.status)) return;
  const { nameWithOwner, number } = parseKey(entry.key);
  const issue = ghJson(
    ["issue", "view", String(number), "--repo", nameWithOwner, "--json", "updatedAt,body"],
    { allowFail: true },
  );
  const stamps = ownStamps(fetchReactions(nameWithOwner, "issue", number), config.account);
  if (stamps["👀"]) {
    if (entry.status !== "parked") {
      transitions.push({ key: entry.key, from: entry.status, to: "parked", reason: "👀" });
      setStatus(entry, "parked");
    }
    return;
  }
  if (rocketIsValid(stamps, issue?.updatedAt)) {
    transitions.push({ key: entry.key, from: entry.status, to: "sizing", reason: "本文に🚀" });
    setStatus(entry, "sizing", { approvedBy: "body" });
  }
}

// AI が投稿したコメントのスタンプ。ここが状態遷移の本体。
function applyCommentStamps(entry, config, transitions) {
  const { nameWithOwner } = parseKey(entry.key);
  if (entry.commentId) {
    const c = comment(nameWithOwner, entry.commentId);
    const stamps = ownStamps(
      fetchReactions(nameWithOwner, "comment", entry.commentId),
      config.account,
    );
    const redo = redoStamp(stamps);

    if (stamps["👀"] && entry.status !== "parked") {
      transitions.push({ key: entry.key, from: entry.status, to: "parked", reason: "👀" });
      setStatus(entry, "parked");
      return;
    }
    if (redo) {
      entry.redo = redo; // 作り直しは next の workAction が拾う
    }
    if (entry.status === "memo-review" && !redo) {
      // 🚀は「コメント更新より後」かつ「確認事項がすべてチェック済み」のときだけ有効
      if (rocketIsValid(stamps, c?.updated_at) && allQuestionsAnswered(c?.body || "")) {
        transitions.push({ key: entry.key, from: entry.status, to: "ready", reason: "メモに🚀" });
        setStatus(entry, "ready", { redo: null });
      }
    }
    if (entry.status === "waiting-answer" && allQuestionsAnswered(c?.body || "")) {
      entry.answersReady = true; // 回答反映モードの対象になる
    }
    if (entry.status === "split-review" && !redo) {
      if (rocketIsValid(stamps, c?.updated_at)) {
        transitions.push({ key: entry.key, from: entry.status, to: "split-done", reason: "分割案に🚀" });
        setStatus(entry, "split-done", { redo: null, childrenCreated: false });
      }
    }
  }

  // 規模判定の結果から「大・深さ超過」を拾う
  if (entry.status === "sizing" && entry.sizing) {
    if (sizeOf(entry, config) === "large" && entry.depth >= config.sizing.maxDepth) {
      transitions.push({
        key: entry.key, from: entry.status, to: "needs-human",
        reason: `深さ${entry.depth}で「大」。自動分割しない`,
      });
      setStatus(entry, "needs-human");
    }
  }

  // PR に紐づくスタンプ
  for (const pr of entry.prs || []) {
    if (pr.approvalCommentId) {
      const stamps = ownStamps(
        fetchReactions(nameWithOwner, "comment", pr.approvalCommentId),
        config.account,
      );
      const c = comment(nameWithOwner, pr.approvalCommentId);
      if (rocketIsValid(stamps, c?.updated_at)) pr.selfApproved = true;
    }
    if (pr.triageCommentId) {
      const stamps = ownStamps(
        fetchReactions(nameWithOwner, "comment", pr.triageCommentId),
        config.account,
      );
      const c = comment(nameWithOwner, pr.triageCommentId);
      if (rocketIsValid(stamps, c?.updated_at)) pr.triageApproved = true;
    }
  }
}

// PR の状態を取り込む（マージ済み・head SHA の変化）
function refreshPrs(entry, transitions) {
  const { nameWithOwner } = parseKey(entry.key);
  for (const pr of entry.prs || []) {
    const view = ghJson(
      ["pr", "view", String(pr.number), "--repo", nameWithOwner,
       "--json", "state,headRefOid,reviewDecision,mergeable"],
      { allowFail: true },
    );
    if (!view) continue;
    if (view.headRefOid && pr.headSha && view.headRefOid !== pr.headSha) {
      // 修正依頼への対応でプッシュされた → 承認は無効
      pr.selfApproved = false;
      pr.approvedSha = null;
    }
    pr.headSha = view.headRefOid || pr.headSha;
    pr.reviewDecision = view.reviewDecision;
    pr.mergeable = view.mergeable;
    pr.merged = view.state === "MERGED";
    if (view.mergeable === "CONFLICTING") pr.conflict = pr.conflict || "unknown";
  }
  const prs = entry.prs || [];
  if (prs.length && prs.every((p) => p.merged) && entry.status === "pr-review") {
    transitions.push({ key: entry.key, from: entry.status, to: "done", reason: "全PRがマージ済み" });
    setStatus(entry, "done");
  }
}

// 親Issue: 全 Sub Issue が done になったら done
function closeParents(state, transitions) {
  for (const entry of Object.values(state.issues)) {
    if (entry.status !== "split-done") continue;
    const children = Object.values(state.issues).filter((e) => e.parent === entry.key);
    if (children.length && children.every((c) => c.status === "done")) {
      transitions.push({ key: entry.key, from: entry.status, to: "done", reason: "全Sub Issue完了" });
      setStatus(entry, "done");
    }
  }
}

export function sync(config, { dryRun = false } = {}) {
  const state = loadState();
  const transitions = [];
  ingestIssues(state, config, transitions);
  for (const entry of Object.values(state.issues)) {
    if (["done", "parked"].includes(entry.status)) continue;
    applyBodyStamps(entry, config, transitions);
    applyCommentStamps(entry, config, transitions);
    refreshPrs(entry, transitions);
  }
  closeParents(state, transitions);
  state.lastSync = new Date().toISOString();
  if (!dryRun) saveState(state);
  return { transitions, tracked: Object.keys(state.issues).length, dryRun };
}

// state.json を失ったときの再構築。コメントの目印から辿る。
export function rebuild(config, { dryRun = false } = {}) {
  const state = loadState();
  const found = [];
  for (const repo of config.repos) {
    const issues = ghJson(
      ["issue", "list", "--repo", repo, "--state", "all", "--limit", "200", "--json", "number,title"],
      { allowFail: true },
    );
    for (const issue of issues || []) {
      const comments = ghJson(
        ["api", `repos/${repo}/issues/${issue.number}/comments`, "--paginate"],
        { allowFail: true },
      );
      for (const c of comments || []) {
        for (const [kind, re] of Object.entries(MARKERS)) {
          if (!re.test(c.body || "")) continue;
          const key = `${repo}#${issue.number}`;
          const entry = state.issues[key] || newEntry(key, { title: issue.title });
          if (kind === "memo") entry.commentId = c.id;
          if (kind === "split") entry.commentId = c.id;
          state.issues[key] = entry;
          found.push({ key, kind, commentId: c.id });
        }
      }
    }
  }
  if (!dryRun) saveState(state);
  return { found, dryRun };
}
