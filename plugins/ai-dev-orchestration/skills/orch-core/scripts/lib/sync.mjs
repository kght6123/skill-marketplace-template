// GitHub の差分取得 → スタンプ読み取り → 状態遷移。AI は一切判断しない。
// 仕様3.5: 状態の一覧取得は検索せず、state.json が持つコメントIDのリアクションを直接見る。
//          新規Issueと回答だけ「前回実行以降の更新」で差分取得する。
//
// 2段構え。**ネットワークはロックの外で行う。**
//   1. collectFacts … GitHub から事実を集める（ロックなし・時間がかかる）
//   2. applyFacts   … 集めた事実で状態を進める（ロックあり・一瞬）
// ロックを持ったまま GitHub を叩くと、遅い日に stale 判定へ引っかかり、
// 別プロセスに生きたロックを消される。そこからロストアップデートが起きる。
import { ghJson, fetchReactions } from "./gh.mjs";
import { repoNames } from "./config.mjs";
import { loadState, updateState, newEntry, setStatus, parseKey } from "./state.mjs";
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

function since(snapshot) {
  return snapshot.lastSync ? snapshot.lastSync.slice(0, 10) : null;
}

// ---------------------------------------------------------------- 1. 収集

export function collectFacts(config, snapshot) {
  const listed = {};
  for (const repo of repoNames(config)) {
    const search = since(snapshot) ? ["--search", `updated:>=${since(snapshot)}`] : [];
    listed[repo] =
      ghJson(
        [
          "issue", "list", "--repo", repo, "--state", "open", "--limit", "100",
          "--json", "number,title,updatedAt,milestone",
          ...search,
        ],
        { allowFail: true },
      ) || [];
  }

  // 既知のIssueと、今回一覧に出てきたIssueの両方を見る
  const keys = new Set(Object.keys(snapshot.issues));
  for (const [repo, issues] of Object.entries(listed)) {
    for (const issue of issues) keys.add(`${repo}#${issue.number}`);
  }

  const entries = {};
  for (const key of keys) {
    const known = snapshot.issues[key];
    if (known?.status === "done") continue;
    const { nameWithOwner, number } = parseKey(key);
    const status = known?.status || "candidate";
    const f = { prs: {} };

    // 本文のスタンプは candidate と parked のときだけ見る（起点と復帰）
    if (["candidate", "parked"].includes(status)) {
      f.issue = ghJson(
        ["issue", "view", String(number), "--repo", nameWithOwner, "--json", "updatedAt,body"],
        { allowFail: true },
      );
      f.issueReactions = fetchReactions(nameWithOwner, "issue", number);
    }
    if (known?.commentId) {
      f.comment = comment(nameWithOwner, known.commentId);
      f.commentReactions = fetchReactions(nameWithOwner, "comment", known.commentId);
    }
    for (const pr of known?.prs || []) {
      f.prs[pr.number] = {
        view: ghJson(
          ["pr", "view", String(pr.number), "--repo", nameWithOwner,
           "--json", "state,headRefOid,reviewDecision,mergeable"],
          { allowFail: true },
        ),
        approval: pr.approvalCommentId
          ? {
              comment: comment(nameWithOwner, pr.approvalCommentId),
              reactions: fetchReactions(nameWithOwner, "comment", pr.approvalCommentId),
            }
          : null,
        triage: pr.triageCommentId
          ? {
              comment: comment(nameWithOwner, pr.triageCommentId),
              reactions: fetchReactions(nameWithOwner, "comment", pr.triageCommentId),
            }
          : null,
      };
    }
    entries[key] = f;
  }
  return { listed, entries, collectedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------- 2. 適用

// Issue本文のスタンプ。🚀が起点、👀で後回し。parked からの復帰もここ。
function applyBodyStamps(entry, config, f, transitions) {
  if (!["candidate", "parked"].includes(entry.status)) return;
  const stamps = ownStamps(f.issueReactions, config.account);
  if (stamps["👀"]) {
    if (entry.status !== "parked") {
      transitions.push({ key: entry.key, from: entry.status, to: "parked", reason: "👀" });
      setStatus(entry, "parked");
    }
    return;
  }
  if (rocketIsValid(stamps, f.issue?.updatedAt)) {
    // 👀 が外れて🚀が有効なら、parked からでも動き出す
    transitions.push({
      key: entry.key, from: entry.status, to: "sizing",
      reason: entry.status === "parked" ? "👀が外れて🚀" : "本文に🚀",
    });
    setStatus(entry, "sizing", { approvedBy: "body" });
  }
}

// AI が投稿したコメントのスタンプ。ここが状態遷移の本体。
function applyCommentStamps(entry, config, f, transitions) {
  if (f.comment || f.commentReactions) {
    const c = f.comment;
    const stamps = ownStamps(f.commentReactions, config.account);
    const redo = redoStamp(stamps);

    if (stamps["👀"] && entry.status !== "parked") {
      transitions.push({ key: entry.key, from: entry.status, to: "parked", reason: "👀" });
      setStatus(entry, "parked");
      return;
    }
    if (redo) entry.redo = redo; // 作り直しは next の workAction が拾う

    if (entry.status === "memo-review" && !redo) {
      // 🚀は「コメント更新より後」かつ「確認事項がすべてチェック済み」のときだけ有効
      if (rocketIsValid(stamps, c?.updated_at) && allQuestionsAnswered(c?.body || "")) {
        transitions.push({ key: entry.key, from: entry.status, to: "ready", reason: "メモに🚀" });
        setStatus(entry, "ready", { redo: null });
      }
    }
    if (entry.status === "waiting-answer" && allQuestionsAnswered(c?.body || "")) {
      entry.answersReady = true;
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

  for (const pr of entry.prs || []) {
    const pf = f.prs?.[pr.number];
    if (!pf) continue;
    if (pf.approval) {
      const stamps = ownStamps(pf.approval.reactions, config.account);
      if (rocketIsValid(stamps, pf.approval.comment?.updated_at)) pr.selfApproved = true;
    }
    if (pf.triage) {
      const stamps = ownStamps(pf.triage.reactions, config.account);
      if (rocketIsValid(stamps, pf.triage.comment?.updated_at)) pr.triageApproved = true;
    }
  }
}

// PR の状態を取り込む（マージ済み・head SHA の変化）
function refreshPrs(entry, f, transitions) {
  for (const pr of entry.prs || []) {
    const view = f.prs?.[pr.number]?.view;
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

export function applyFacts(state, config, facts) {
  const transitions = [];

  for (const [repo, issues] of Object.entries(facts.listed)) {
    for (const issue of issues) {
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

  for (const [key, f] of Object.entries(facts.entries)) {
    const entry = state.issues[key];
    if (!entry || entry.status === "done") continue;
    applyBodyStamps(entry, config, f, transitions);
    // 👀 が付いたままなら、ここで終わり。外れていれば上で sizing に戻っている
    if (entry.status === "parked") continue;
    applyCommentStamps(entry, config, f, transitions);
    refreshPrs(entry, f, transitions);
  }

  closeParents(state, transitions);
  state.lastSync = facts.collectedAt;
  return { transitions, tracked: Object.keys(state.issues).length };
}

export function sync(config, { dryRun = false } = {}) {
  const facts = collectFacts(config, loadState()); // ← ロックなし
  if (dryRun) return { ...applyFacts(loadState(), config, facts), dryRun: true };
  return { ...updateState((state) => applyFacts(state, config, facts)), dryRun: false };
}

// state.json を失ったときの再構築。コメントの目印から辿る。
export function rebuild(config, { dryRun = false } = {}) {
  const found = [];
  for (const repo of repoNames(config)) {
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
          found.push({ key: `${repo}#${issue.number}`, title: issue.title, kind, commentId: c.id });
        }
      }
    }
  }
  if (dryRun) return { found, dryRun: true };
  updateState((state) => {
    for (const hit of found) {
      const entry = state.issues[hit.key] || newEntry(hit.key, { title: hit.title });
      if (["memo", "split"].includes(hit.kind)) entry.commentId = hit.commentId;
      state.issues[hit.key] = entry;
    }
  });
  return { found, dryRun: false };
}
