// 出力と終了コードの共通化。
// AI は --json の出力だけを読む。人向けの整形は --human のときだけ出す。
//
// 終了コード
//   0 : 正常
//   1 : エラー（設定不足・gh 失敗など）
//   2 : lint 違反（作り直し。停止ではない）
//   3 : needs_human（人間の判断が必要。AI はここで止まる）

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_LINT = 2;
export const EXIT_NEEDS_HUMAN = 3;

export function emit(payload, { human, render } = {}) {
  const body = { ok: true, needs_human: false, ...payload };
  if (human && typeof render === "function") {
    process.stdout.write(render(body).replace(/\n*$/, "\n"));
  } else {
    process.stdout.write(JSON.stringify(body, null, 2) + "\n");
  }
  return body.needs_human ? EXIT_NEEDS_HUMAN : EXIT_OK;
}

export function fail(message, extra = {}) {
  process.stdout.write(
    JSON.stringify({ ok: false, needs_human: false, error: message, ...extra }, null, 2) + "\n",
  );
  return EXIT_ERROR;
}

export function needsHuman(reason, extra = {}) {
  process.stdout.write(
    JSON.stringify({ ok: true, needs_human: true, reason, ...extra }, null, 2) + "\n",
  );
  return EXIT_NEEDS_HUMAN;
}

// 素朴な引数パーサ。--key value / --flag / 位置引数。
export function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i++;
    }
  }
  return { opts, positional };
}
