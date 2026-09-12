#!/usr/bin/env node
// テスト用の偽 gh。シナリオJSONに従って応答する。
//
// 目的は「境界が嘘をついたとき」の確認。GitHub が落ちた、権限が無い、
// 未解決スレッドが取れない、といった状況を再現する。
//
//   FAKE_GH_SCENARIO … シナリオJSONのパス
//   FAKE_GH_ARGS     … 受け取った引数を1行1回追記する
//   FAKE_GH_BODY     … -F body=@file で実際に渡った本文を書き出す
import fs from "node:fs";

const args = process.argv.slice(2);
const scenario = JSON.parse(fs.readFileSync(process.env.FAKE_GH_SCENARIO, "utf8"));

if (process.env.FAKE_GH_ARGS) {
  fs.appendFileSync(process.env.FAKE_GH_ARGS, JSON.stringify(args) + "\n");
}

// body=@path が -F で渡ればファイルの中身、-f なら文字列のまま。
// ここで両者の違いがそのまま出る。
const bodyIdx = args.findIndex((a) => a.startsWith("body=@"));
if (bodyIdx >= 0 && process.env.FAKE_GH_BODY) {
  const flag = args[bodyIdx - 1];
  const raw = args[bodyIdx].slice("body=".length);
  const value = flag === "-F" ? fs.readFileSync(raw.slice(1), "utf8") : raw;
  fs.writeFileSync(process.env.FAKE_GH_BODY, value);
}
const fileIdx = args.indexOf("--body-file");
if (fileIdx >= 0 && process.env.FAKE_GH_BODY) {
  fs.writeFileSync(process.env.FAKE_GH_BODY, fs.readFileSync(args[fileIdx + 1], "utf8"));
}

function out(value) {
  process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
  process.exit(0);
}
function boom(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (scenario.delayMs) {
  const until = Date.now() + scenario.delayMs;
  while (Date.now() < until) {} // 遅いGitHubの再現
}

const joined = args.join(" ");

if (args[0] === "issue" && args[1] === "list") out(scenario.issueList ?? []);
if (args[0] === "issue" && args[1] === "view") out(scenario.issueView ?? {});
if (args[0] === "pr" && args[1] === "view") out(scenario.prView ?? {});
if (args[0] === "pr" && args[1] === "merge") out("merged\n");
if (args[0] === "pr" && args[1] === "create") {
  if (scenario.prCreateFails) boom("HTTP 422");
  const number = scenario.createdPr ?? 90;
  out(`https://github.com/org/order-api/pull/${number}\n`);
}

if (args[0] === "api" && joined.includes("graphql")) {
  if (scenario.graphql === "fail") boom("GraphQL: Something went wrong");
  out(scenario.graphql ?? { data: {} });
}
if (args[0] === "api" && /issues\/\d+\/reactions/.test(joined)) {
  if (scenario.issueReactionsFail) boom("HTTP 502");
  out(scenario.issueReactions ?? []);
}
if (args[0] === "api" && /issues\/comments\/\d+\/reactions/.test(joined)) {
  out(scenario.commentReactions ?? []);
}
if (args[0] === "api" && /issues\/comments\/\d+$/.test(joined.split(" ").pop() || "")) {
  // コメント本文だけ落ちる状況（リアクションは取れる）を作れるようにする
  if (scenario.commentFails) boom("HTTP 502");
  out(scenario.comment ?? { id: 1, body: "", updated_at: "2026-09-12T00:00:00Z" });
}
if (args[0] === "api" && /issues\/\d+\/comments/.test(joined)) out(scenario.postedComment ?? { id: 555 });
if (args[0] === "api" && /issues\/comments\/\d+/.test(joined)) {
  if (scenario.commentFails) boom("HTTP 502");
  out(scenario.comment ?? { id: 1, body: "", updated_at: "2026-09-12T00:00:00Z" });
}

out({});
