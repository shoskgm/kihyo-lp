/**
 * Kihyo：**壊れた品番を、店舗のSKU一覧に照合する。**
 *
 * 〔上位 `#69`／HQ `#202`〕
 *   **上げるのは「解けない」と分かった時ではない。**
 *   **「解けるかどうかが、あと何を試しても分からない」と分かった時である。**
 *
 * ## 壊れ方を先に見た（**解けないと決めつける前に**）
 *
 * ```
 * 正解        FAX読み取り
 * PP-A4-500   PP A4 500
 * BP-BK-05    BP BK 05
 * EN-N3-W     EN N3 W
 * ```
 *
 * **文字は1つも失われていない。**——**区切りが空白に変わっただけである。**
 * **＝「読めなかった」のではなく「区切りの種類が変わった」。**
 *
 * ## だから、照合できる
 *
 * **Kihyo は Shopify アプリである。**——**店舗のSKU一覧を持っている。**
 * **自由入力を復元する必要は無い。**——**候補の中から選べばよい。**
 *
 * ```
 * **復元する**  →  `PP A4 500` から `-` の位置を当てる  ←  **できない**
 * **照合する**  →  店舗のSKUを同じ形に潰して比べる      ←  **できる**
 * ```
 *
 * **これが「越えられるか」の答えである。**——**問いの立て方のほうが間違っていた。**
 */

/**
 * 照合用に潰す。**区切り文字の種類を消し、大小と全角半角を揃える。**
 *
 * **消すのは区切りだけ。**——英数字は残す。**残さないと別のSKUと衝突する。**
 */
export function canon(s) {
  return String(s ?? "")
    // 全角英数字 → 半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    // **区切りとして扱うもの**：ハイフン各種・アンダースコア・空白・中黒・スラッシュ
    .replace(/[-‐‑‒–—―ー_\s・･/／]+/g, "")
    .trim();
}

/**
 * 店舗のSKU一覧に照合する。
 *
 * @returns {{sku:string|null, 確度:string, 候補:string[]}}
 *   `確度`：`一意` … 候補が1つ ／ `曖昧` … 複数当たった ／ `該当なし`
 *
 * **曖昧を「一番近いもの」で埋めない。**——**SKUを1つ間違えると、違う商品が出荷される。**
 * **金額の誤りは請求書で気づくが、品違いは届くまで分からない。**
 */
export function matchSku(read, catalog) {
  const key = canon(read);
  if (!key) return { sku: null, 確度: "該当なし", 候補: [] };
  const hits = catalog.filter((s) => canon(s) === key);
  if (hits.length === 1) return { sku: hits[0], 確度: "一意", 候補: hits };
  if (hits.length > 1) return { sku: null, 確度: "曖昧", 候補: hits };
  return { sku: null, 確度: "該当なし", 候補: [] };
}

/** 明細ごとに照合し、人手が要る行だけを返す */
export function matchAll(items, catalog) {
  const rows = items.map((it) => ({ ...it, 照合: matchSku(it.品番, catalog) }));
  return {
    rows,
    一意: rows.filter((r) => r.照合.確度 === "一意").length,
    要人手: rows.filter((r) => r.照合.確度 !== "一意"),
  };
}
