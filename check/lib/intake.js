/**
 * **Kihyo 本体：発注書を受け取って、Shopify の下書き注文にする形まで持っていく。**
 *
 * 〔上位 `#69`／HQ `#202`〕
 *   ```
 *   **調べた  ≠  動くものが在る**
 *   ```
 *
 * **本日まで、4工程はバラバラの部品だった。**——**1つも互いを import していなかった。**
 * **測定は全部通っているのに、「1通入れたら注文が出てくる」ものが無い。**——**これがその状態である。**
 *
 * ## 何をするか（**1行**）
 *
 * > **発注書（PDF／画像／メール本文）を1つ渡すと、`起票できる／人手が要る` を判定して返す。**
 *
 * ## 判定を3つに分ける（**「読めた」で終わらせない**）
 *
 * | `ready`   | **そのまま下書き注文にできる。**——検算が通り、SKUが全件一意 |
 * | `review`  | **人手が1箇所要る。**——どこが要るかを名指しする |
 * | `reject`  | **起票しない。**——検算が落ちた／明細が0件 |
 *
 * **`review` を `ready` に混ぜない。**——**混ぜると、人手が要ることに誰も気づかないまま注文が出る。**
 *
 * ## 実装の姿勢
 *
 * **判定に使うのは、4工程で実測したものだけである。**——**新しい仮定を足さない。**
 *
 *   工程1  PDF から明細を取る（重なりを潰す）
 *   工程3  画像から読む → **検算は金額しか見ない**
 *   工程4  メール本文 → **引用の過去注文は検算では落ちない**
 *   SKU    区切りを潰して照合 → **曖昧は埋めない**
 */
import { extractOrder } from "./mail-extract.js";
import { matchAll } from "./sku-match.js";

/**
 * **検算。**——工程1・3で効いたもの。
 * **金額しか見ない。**——**品番・税区分はこの外にある**（工程3・工程4で実測済み）。
 */
export function verify(order) {
  const ng = [];
  const items = order.明細 ?? [];
  if (!items.length) ng.push("明細が0件");

  for (const [i, r] of items.entries()) {
    if (r.数量 == null || r.単価 == null || r.金額 == null) { ng.push(`明細${i + 1}: 数量/単価/金額のいずれかが読めていない`); continue; }
    if (r.数量 * r.単価 !== r.金額) ng.push(`明細${i + 1}: 単価×数量（${r.数量 * r.単価}）が金額（${r.金額}）と合わない`);
  }
  const sum = items.reduce((s, r) => s + (r.金額 ?? 0), 0);
  if (order.小計 != null && sum !== order.小計) ng.push(`明細合計（${sum}）が小計（${order.小計}）と合わない`);
  if (order.合計 != null && order.小計 == null && sum !== order.合計) ng.push(`明細合計（${sum}）が合計（${order.合計}）と合わない`);
  return { ok: ng.length === 0, 落ちた理由: ng };
}

/**
 * 1通ぶんを判定する。
 *
 * @param source `{kind:"mail", body}` ／ `{kind:"parsed", order}`（PDF・画像から取った結果を渡す）
 * @param catalog 店舗のSKU一覧
 */
export function intake(source, catalog = []) {
  // ── 1. 取り出す ────────────────────────────────────────────────
  let order, 注記 = [];
  if (source.kind === "mail") {
    order = extractOrder(source.body);
    const d = order.$落とした行 ?? {};
    if (d.quote) 注記.push(`引用 ${d.quote}行を落とした（**過去の注文を起票しないため**）`);
    if (d.signature) 注記.push(`署名以降 ${d.signature}行を落とした`);
  } else {
    order = source.order;
  }

  // ── 2. 検算（**金額だけ**）──────────────────────────────────────
  const v = verify(order);
  if (!v.ok) return { 判定: "reject", 理由: v.落ちた理由, 注記, order };

  // ── 3. SKU照合（**曖昧は埋めない**）──────────────────────────────
  const m = matchAll(order.明細 ?? [], catalog);
  const 要人手 = [];
  for (const r of m.要人手) {
    要人手.push(r.照合.確度 === "曖昧"
      ? `品番「${r.品番}」は候補が複数（${r.照合.候補.join(" / ")}）——**どれかを選ぶ必要がある**`
      : `品番「${r.品番}」が店舗のSKUに無い`);
  }

  // ── 4. 税区分（**工程3で「標準モードでは測れない」と実測した箇所**）────
  //
  // **`null` と「欄が無い」を混ぜない。**（2026-08-15・本体を繋いだときに自分で踏んだ）
  //   `軽減: null`      → **読もうとして読めなかった**（凡例が潰れたFAX）  ← **人手が要る**
  //   キーが無い        → **その帳票に税区分の概念が無い**（税抜のみのメール本文）  ← **人手は要らない**
  //
  // **初版は両方を「判定できない」にしていた。**——**メール本文が常に `review` になっていた。**
  // **`review` が増えると、本当に人手が要る行が埋もれる。**
  const 税不明 = (order.明細 ?? []).filter((r) => "軽減" in r && r.軽減 === null);
  if (税不明.length) 要人手.push(`${税不明.length}件の軽減税率が判定できない——**凡例が読めていない**（標準モードのFAXで起きる）`);

  return {
    判定: 要人手.length ? "review" : "ready",
    要人手,
    注記,
    order: { ...order, 明細: m.rows.map((r) => ({ ...r, SKU: r.照合.sku })) },
  };
}
