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
import { ownStamps, matchedApprove, matchedPark, redoStamp, emojiFor, allQuestionsAnswered } from "./stamps.mjs";
import { sizeOf } from "./next.mjs";
import { needsReviewer } from "./assign.mjs";

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

// Issue の一覧。1ページ100件で、返ってきた件数が上限と同じなら次のページも取る。
// 失敗したら null を返す（0件と区別する）。
function listIssues(repo, search, pageSize = 100, maxPages = 20) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const got = ghJson(
      [
        "issue", "list", "--repo", repo, "--state", "open",
        "--limit", String(pageSize * (page + 1)),
        "--json", "number,title,updatedAt,milestone",
        ...search,
      ],
      { allowFail: true },
    );
    if (!got) return null; // 取得できなかった。0件と混ぜない
    all.length = 0;
    all.push(...got);
    if (got.length < pageSize * (page + 1)) break; // まだ上限に届いていない
  }
  return all;
}

export function collectFacts(config, snapshot) {
  const listed = {};
  for (const repo of repoNames(config)) {
    const search = since(snapshot) ? ["--search", `updated:>=${since(snapshot)}`] : [];
    // 取得失敗と「0件」を区別する。潰すと、その日の新規 Issue を取りこぼしたまま
    // lastSync だけ進み、次回の検索範囲から外れる
    listed[repo] = listIssues(repo, search);
  }

  // 既知のIssueと、今回一覧に出てきたIssueの両方を見る
  const keys = new Set(Object.keys(snapshot.issues));
  for (const [repo, issues] of Object.entries(listed)) {
    for (const issue of issues || []) keys.add(`${repo}#${issue.number}`);
  }

  const entries = {};
  for (const key of keys) {
    const known = snapshot.issues[key];
    if (known?.status === "done") continue;
    const { nameWithOwner, number } = parseKey(key);
    const f = { prs: {} };

    // 本文のスタンプは done 以外のすべてで見る。後回しはどの状態からでも押せる
    f.issue = ghJson(
      ["issue", "view", String(number), "--repo", nameWithOwner, "--json", "updatedAt,body"],
      { allowFail: true },
    );
    f.issueReactions = fetchReactions(nameWithOwner, "issue", number);
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

// 取得できた事実かどうか。片方だけ落ちた状態で承認を有効扱いしない。
function issueKnown(f) {
  return Boolean(f.issue?.updatedAt && f.issueReactions !== null && f.issueReactions !== undefined);
}
function commentKnown(f) {
  return Boolean(f.comment?.updated_at && f.commentReactions !== null && f.commentReactions !== undefined);
}

// PR の承認用・対応案コメントに押されたスタンプをまとめる。
// どのコメントに押されても「後回し」の意味は同じなので、1つにして扱う。
function prCommentStamps(entry, config, f) {
  const all = {};
  let sawAny = false;
  for (const pr of entry.prs || []) {
    if (pr.merged) continue;
    for (const side of ["approval", "triage"]) {
      const got = f.prs?.[pr.number]?.[side];
      if (!got?.comment?.updated_at || !got.reactions) continue;
      const stamps = ownStamps(got.reactions, config.account);
      if (!stamps) continue;
      sawAny = true;
      for (const [name, value] of Object.entries(stamps)) all[name] = value;
    }
  }
  return sawAny ? all : null;
}

// PR のコメントのスタンプをすべて確認できたか（取れないものがあれば判断しない）
function prCommentsKnown(entry, f) {
  for (const pr of entry.prs || []) {
    if (pr.merged) continue;
    for (const [side, id] of [["approval", pr.approvalCommentId], ["triage", pr.triageCommentId]]) {
      if (!id) continue;
      const got = f.prs?.[pr.number]?.[side];
      if (!got?.comment?.updated_at || !got.reactions) return false;
    }
  }
  return true;
}

// 後回しは一時停止レイヤー。元の状態を覚えておき、外れたらそこへ戻す。
function applyPark(entry, config, f, transitions, degraded) {
  const bodyStamps = issueKnown(f) ? ownStamps(f.issueReactions, config.account) : null;
  const commentStamps = commentKnown(f) ? ownStamps(f.commentReactions, config.account) : null;
  // PR の承認用コメント・対応案コメントに押された後回しも見る。
  // 承認用コメントのフッタには「😄 後回し」と書いてあるので、
  // ここを見ないと案内した操作が効かない
  const prStamps = prCommentStamps(entry, config, f);
  const parkedBy =
    (bodyStamps && matchedPark(bodyStamps, config) && "body") ||
    (commentStamps && matchedPark(commentStamps, config) && "comment") ||
    (prStamps && matchedPark(prStamps, config) && "pr-comment") ||
    null;

  if (parkedBy) {
    if (entry.status !== "parked") {
      const stamps =
        parkedBy === "body" ? bodyStamps : parkedBy === "comment" ? commentStamps : prStamps;
      transitions.push({
        key: entry.key, from: entry.status, to: "parked",
        reason: `${emojiFor(matchedPark(stamps, config))}（${parkedBy}）`,
      });
      setStatus(entry, "parked", { parkedFrom: entry.status, parkedBy });
    }
    return "parked";
  }

  if (entry.status !== "parked") return "active";

  // 外れたと言えるのは、押せるすべての面を確認できたときだけ
  const known =
    issueKnown(f) && (!entry.commentId || commentKnown(f)) && prCommentsKnown(entry, f);
  if (!known) {
    degraded.push({ key: entry.key, reason: "後回しスタンプの有無を確認できない" });
    return "parked";
  }
  const back = entry.parkedFrom && entry.parkedFrom !== "parked" ? entry.parkedFrom : "candidate";
  transitions.push({ key: entry.key, from: "parked", to: back, reason: "後回しが外れた" });
  setStatus(entry, back, { parkedFrom: null, parkedBy: null });
  return "active";
}

// Issue本文の承認スタンプ。着手の起点。
function applyBodyStamps(entry, config, f, transitions, degraded) {
  if (entry.status !== "candidate") return;
  if (!issueKnown(f)) {
    degraded.push({ key: entry.key, reason: "Issue本文かリアクションを取得できない" });
    return;
  }
  const stamps = ownStamps(f.issueReactions, config.account);
  const matched = matchedApprove(stamps, f.issue.updatedAt, config);
  if (matched) {
    transitions.push({
      key: entry.key, from: entry.status, to: "sizing", reason: `本文に${emojiFor(matched)}`,
    });
    setStatus(entry, "sizing", { approvedBy: "body" });
  }
}

// AI が投稿したコメントのスタンプ。ここが状態遷移の本体。
function applyCommentStamps(entry, config, f, transitions, degraded) {
  if (entry.commentId) {
    if (!commentKnown(f)) {
      // 本文か更新日時が取れていない。古い承認を有効扱いしない
      degraded.push({ key: entry.key, reason: "コメント本文か更新日時を取得できない" });
    } else {
      const c = f.comment;
      const stamps = ownStamps(f.commentReactions, config.account);
      const redo = redoStamp(stamps, config);
      if (redo) entry.redo = redo; // 作り直しは next の workAction が拾う

      if (entry.status === "memo-review" && !redo) {
        const ok = matchedApprove(stamps, c.updated_at, config);
        if (ok && allQuestionsAnswered(c.body || "")) {
          transitions.push({ key: entry.key, from: entry.status, to: "ready", reason: `メモに${emojiFor(ok)}` });
          setStatus(entry, "ready", { redo: null });
        }
      }
      if (entry.status === "waiting-answer" && allQuestionsAnswered(c.body || "")) {
        entry.answersReady = true;
      }
      if (entry.status === "split-review" && !redo) {
        const ok = matchedApprove(stamps, c.updated_at, config);
        if (ok) {
          transitions.push({ key: entry.key, from: entry.status, to: "split-done", reason: `分割案に${emojiFor(ok)}` });
          setStatus(entry, "split-done", { redo: null, childrenCreated: false });
        }
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
    // 承認は、コメントの更新日時が取れているときだけ有効。
    //
    // さらに「そのコメントが対象にしていた SHA」が今の head と同じでなければ通さない。
    // 承認を state の現在の headSha に後付けで結び付けると、
    //   H1 への 🚀 → H2 を push → sync#1 で無効化（headSha は H2 になる）
    //   → sync#2 で同じ古い 🚀 が H2 の承認として復活
    // という経路で、誰もレビューしていないコミットがマージ条件を満たしてしまう。
    if (pf.approval?.comment?.updated_at && pf.approval.reactions) {
      const stamps = ownStamps(pf.approval.reactions, config.account);
      if (matchedApprove(stamps, pf.approval.comment.updated_at, config)) {
        const currentHead = pf.view?.headRefOid || null;
        if (!currentHead) {
          degraded.push({ key: entry.key, reason: `PR #${pr.number} の現在の head を取得できない` });
        } else if (pr.approvalTargetSha && pr.approvalTargetSha === currentHead) {
          pr.selfApproved = true;
          pr.approvedSha = currentHead;
        } else {
          // 古いコミットへの承認。復活させない
          pr.selfApproved = false;
          pr.approvedSha = null;
          degraded.push({
            key: entry.key,
            reason: `PR #${pr.number} の承認は ${pr.approvalTargetSha || "不明"} 宛てで、現在の head (${currentHead}) ではない`,
          });
        }
      }
    } else if (pf.approval) {
      degraded.push({ key: entry.key, reason: `PR #${pr.number} の承認用コメントを取得できない` });
    }
    if (pf.triage?.comment?.updated_at && pf.triage.reactions) {
      const stamps = ownStamps(pf.triage.reactions, config.account);
      if (matchedApprove(stamps, pf.triage.comment.updated_at, config)) pr.triageApproved = true;
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
  const degraded = [];

  for (const [repo, issues] of Object.entries(facts.listed)) {
    for (const issue of issues || []) { // null は取得失敗。下で lastSync を止める
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
    if (applyPark(entry, config, f, transitions, degraded) === "parked") continue;
    applyBodyStamps(entry, config, f, transitions, degraded);
    applyCommentStamps(entry, config, f, transitions, degraded);
    refreshPrs(entry, f, transitions);
  }

  closeParents(state, transitions);

  // 一覧を取れなかったリポジトリがあるなら、検索の起点（lastSync）を進めない。
  // 進めると、そのとき一覧に出なかった Issue が次回の検索範囲から外れて消える。
  const failedRepos = Object.entries(facts.listed || {})
    .filter(([, issues]) => issues === null)
    .map(([repo]) => repo);
  if (failedRepos.length) {
    for (const repo of failedRepos) {
      degraded.push({ key: repo, reason: "Issue一覧を取得できない（lastSync を進めない）" });
    }
  } else {
    state.lastSync = facts.collectedAt;
  }
  // セルフレビューが済んでレビュアーが未割り当てのPR。マネージャが orch assign を実行する
  return {
    transitions, degraded,
    needsReviewer: needsReviewer(state),
    tracked: Object.keys(state.issues).length,
  };
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
