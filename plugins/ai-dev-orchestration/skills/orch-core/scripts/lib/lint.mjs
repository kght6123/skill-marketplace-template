// 上限の機械検査。仕様3.1（理解メモ）と6章（PR本文）の数値制限を決定的に判定する。
// AI は違反を自分で見逃せない。severity=block が1件でもあれば作り直し。

function finding(severity, rule, message, line = null) {
  return { severity, rule, message, line };
}

function lineOf(text, needle) {
  const idx = text.indexOf(needle);
  if (idx < 0) return null;
  return text.slice(0, idx).split("\n").length;
}

function fencedBlocks(text, lang) {
  const re = new RegExp("```" + lang + "\\s*\\n([\\s\\S]*?)```", "g");
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function tableRows(text, startIndex) {
  const lines = text.slice(startIndex).split("\n");
  const rows = [];
  let started = false;
  for (const line of lines) {
    if (line.trim().startsWith("|")) {
      started = true;
      rows.push(line);
      continue;
    }
    if (started) break;
  }
  // ヘッダ行と区切り行を除いたデータ行数
  return Math.max(0, rows.length - 2);
}

// mermaid のノード数。定義（A[...]）と辺の両端を数える。
export function mermaidNodeCount(src) {
  const ids = new Set();
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || /^(graph|flowchart|subgraph|end|classDef|class|direction|%%)/.test(line)) continue;
    const defRe = /([A-Za-z][A-Za-z0-9_]*)\s*[[({]/g;
    let m;
    while ((m = defRe.exec(line))) ids.add(m[1]);
    const edgeRe = /(^|\s)([A-Za-z][A-Za-z0-9_]*)\s*(-->|---|-\.->|==>)/g;
    while ((m = edgeRe.exec(line))) ids.add(m[2]);
    const tailRe = /(-->|---|-\.->|==>)\s*\|?[^|]*\|?\s*([A-Za-z][A-Za-z0-9_]*)/g;
    while ((m = tailRe.exec(line))) ids.add(m[2]);
  }
  return ids.size;
}

export function lintMemo(text, limits = {}) {
  const max = { examples: 5, questions: 3, skeleton: 20, why: 3, ...limits };
  const approve = limits.approveEmoji || "🚀";
  const f = [];

  if (!/<!--\s*ai-memo\s+v\d+\s*-->/.test(text)) {
    f.push(finding("block", "marker", "先頭に <!-- ai-memo v1 --> が無い（state 再構築の目印）"));
  }
  if (!/^##\s*理解メモ/m.test(text)) {
    f.push(finding("block", "heading", "「## 理解メモ」の見出しが無い"));
  }

  const yaru = /\*\*やること\*\*:\s*(.*)/.exec(text);
  if (!yaru) {
    f.push(finding("block", "yaru", "**やること** が無い"));
  } else if (yaru[1].trim().length === 0) {
    f.push(finding("block", "yaru", "**やること** が空", lineOf(text, yaru[0])));
  }

  const quoted = text.split("\n").filter((l) => /^\s*>/.test(l)).length;
  if (quoted !== max.why) {
    f.push(
      finding("block", "why", `「なぜ・現状・範囲」は${max.why}行固定（現在 ${quoted} 行）`),
    );
  }

  const exampleIdx = text.search(/\n\|/);
  if (exampleIdx >= 0) {
    const rows = tableRows(text, exampleIdx + 1);
    if (rows > max.examples) {
      f.push(finding("block", "examples", `例は最大${max.examples}行（現在 ${rows} 行）`));
    }
  } else {
    f.push(finding("warn", "examples", "例の表が無い"));
  }

  const checkboxes = (text.match(/^\s*[-*]\s*\[[ x]\]/gm) || []).length;
  if (checkboxes > max.questions) {
    f.push(
      finding("block", "questions", `確認事項は最大${max.questions}つ（現在 ${checkboxes} つ）`),
    );
  }

  const skeletons = fencedBlocks(text, "[a-z]*").filter((b) => /test\(|type |function /.test(b));
  for (const s of skeletons) {
    const lines = s.trim().split("\n").length;
    if (lines > max.skeleton) {
      f.push(finding("block", "skeleton", `スケルトンは${max.skeleton}行以内（現在 ${lines} 行）`));
    }
  }

  const diagrams = fencedBlocks(text, "mermaid");
  if (diagrams.length === 0) {
    f.push(finding("warn", "diagram", "処理フロー図が無い（各PRで使い回す1枚）"));
  } else if (diagrams.length > 1) {
    f.push(finding("block", "diagram", `図はここで1枚だけ（現在 ${diagrams.length} 枚）`));
  }

  if (!text.includes(approve)) {
    f.push(finding("block", "footer", `フッタのスタンプ案内（${approve} 着手OK ／ 後回し）が無い`));
  }

  return summarize(f, { checkboxes, diagrams: diagrams.length });
}

export function lintPr(text, { title } = {}) {
  const f = [];
  const lines = text.split("\n");

  if (lines.length > 60) {
    f.push(finding("block", "length", `本文は60行以内（現在 ${lines.length} 行）`));
  }
  const withoutDetails = text.replace(/<details>[\s\S]*?<\/details>/g, "");
  const bodyLines = withoutDetails.split("\n").filter((l) => l.trim() !== "").length;
  if (bodyLines > 30) {
    f.push(finding("block", "body-length", `折りたたみを除く本体は30行以内（現在 ${bodyLines} 行）`));
  }

  const diagrams = fencedBlocks(text, "mermaid");
  if (diagrams.length !== 2) {
    f.push(finding("block", "diagram-count", `図は2枚（全体のどこか → 変更前後）。現在 ${diagrams.length} 枚`));
  }
  diagrams.forEach((d, i) => {
    const n = mermaidNodeCount(d);
    if (n > 8) f.push(finding("block", "diagram-nodes", `図${i + 1}のノードは8個まで（現在 ${n} 個）`));
  });
  if (diagrams[1] && !/:::/.test(diagrams[1])) {
    f.push(finding("block", "diagram-color", "変更後の図に色付きノード（:::new / :::chg）が1つも無い"));
  }

  const focusIdx = text.indexOf("見てほしい所");
  if (focusIdx < 0) {
    f.push(finding("block", "focus", "「## 見てほしい所」が無い"));
  } else {
    const rest = text.slice(focusIdx).split("\n").slice(1);
    let count = 0;
    for (const l of rest) {
      if (/^\s*[-*]\s+/.test(l)) count++;
      else if (l.trim().startsWith("#")) break;
    }
    if (count > 3) f.push(finding("block", "focus", `見てほしい所は最大3つ（現在 ${count} つ）`));
  }

  if (!/(Part of|Closes)\s+#\d+/.test(text)) {
    f.push(finding("block", "issue-link", "Part of #N か Closes #N が無い"));
  }

  if (title && !/^[a-z]+(\([^)]+\))?:\s+.+\s\[\d+\/\d+\]\s#\d+$/.test(title)) {
    f.push(
      finding("block", "title", "タイトルは type(scope): 変化 [k/n] #Issue番号 の形式"),
    );
  }

  return summarize(f, { diagrams: diagrams.length });
}

function summarize(findings, stats) {
  const blocks = findings.filter((x) => x.severity === "block");
  return {
    ok: blocks.length === 0,
    blocking: blocks.length,
    findings,
    stats,
  };
}
