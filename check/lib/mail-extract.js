/**
 * Kihyo 工程4：**メール本文から発注を取り出す。**
 *
 * 〔設計 `implementation-plan.md` 4.3 ＋ 着手前調査で足した難しさ4つ〕
 *
 * ── 工程1・3との違い
 *
 *   工程1（PDF）    **座標がある。**y でまとめ、x で割る
 *   工程3（画像）    **画素だけ。**モデルに読ませる
 *   **工程4（本文）** **座標も画素も無い。**——**あるのは行と、行の順序だけ**
 *
 * **だから、この工程で効くのは「切り出し」である。**——読み取りではない。
 *
 * ── **いちばん危ないもの：返信引用の過去注文**
 *
 * **引用された過去の注文は、それ自体が整合している。**
 * ——**単価×数量＝金額も合う。合計も合う。**
 * **つまり工程1・3で効いた「検算」は、ここでは落とせない。**
 *
 * ```
 * 検算が通った  ≠  起票してよい
 * ```
 *
 * **二重発注は、金額の誤りより高くつく。**——**相手に送る前に止まらない。**
 */

/** 引用行か（`>` で始まる。全角 `＞` も見る） */
const isQuote = (line) => /^\s*[>＞]/.test(line);

/** 署名の始まりか（`--` / `-- ` / 全角ダッシュの区切り） */
const isSignatureStart = (line) => /^\s*(--\s*$|—{2,}\s*$|ー{2,}\s*$)/.test(line);

/**
 * **引用と署名を落として、注文が書かれている範囲だけを残す。**
 *
 * **これが工程4の中心である。**——**読む前に、読む場所を決める。**
 */
export function stripQuotedAndSignature(body) {
    const lines = String(body).split(/\r?\n/);
    const kept = [];
    let dropped = { quote: 0, signature: 0 };
    let cut = -1;
    for (const [i, line] of lines.entries()) {
        if (isQuote(line)) { dropped.quote++; continue; }
        // **署名以降は全部落とす。**——署名の下に注文が書かれることは無い
        if (isSignatureStart(line)) { cut = i; break; }
        kept.push(line);
    }
    // **打ち切った先も数える。**（2026-08-15・本体を繋いだときに出た）
    // 旧: 署名で `break` した時点で数えるのをやめていた。**署名が引用より前にあると `quote:0` と出る。**
    // ——**引用は落ちているのに「引用を落とした」と報告できない。**
    // **結果は正しいが、数え方が実態と違う。**——**注記が出ないので、二重発注を防いだことが見えない。**
    let signature = [];
    if (cut >= 0) {
        const rest = lines.slice(cut);
        dropped.signature = rest.filter((l) => !isQuote(l)).length;
        dropped.quote += rest.filter(isQuote).length;
        // **落とすのと、捨てるのは違う。**（2026-08-18）
        // 旧: 署名の本文をその場で捨てていた。——**そこにしか書かれていないものが在った。**
        // 検体の `正解` は 発注元・担当者 を持っているのに、**実装も試験も一度も触れていなかった。**
        //
        // ```
        // **注文の範囲から外す  ≠  読まなくてよい**
        // ```
        signature = rest.filter((l) => !isQuote(l));
    }
    return { text: kept.join("\n"), dropped, signature };
}

/** `・キー：値` の行を拾う（全角コロンも半角も） */
const FIELD = /^\s*[・･\-*]?\s*([^：:]{1,20})\s*[：:]\s*(.+?)\s*$/;

/** 数字を取り出す。`2,400円` `40箱` `120本` → 2400 / 40 / 120 */
const toNum = (s) => {
    const m = String(s).replace(/[,，]/g, "").match(/-?\d+/);
    return m ? Number(m[0]) : null;
};
/** 単位を取り出す。`40箱` → 箱 */
const toUnit = (s) => {
    const m = String(s).replace(/[,，\d\s]/g, "").match(/^[^0-9]{1,3}/);
    return m ? m[0] : null;
};

/**
 * 明細を切り出す。
 *
 * **列の対応が無いので、「商品名で始まり、次の商品名までが1件」とする。**
 * ——**空行を区切りにしない。**空行の入れ方は相手次第であり、
 * **「商品名が2回出たら2件」のほうが、相手の書き方に依存しない。**
 */
export function extractItems(text) {
    const items = [];
    let cur = null;
    for (const line of text.split(/\r?\n/)) {
        const m = line.match(FIELD);
        if (!m) continue;
        const key = m[1].trim(), val = m[2].trim();
        if (/^(商品名|品名|品目)$/.test(key)) {
            if (cur) items.push(cur);
            cur = { 商品名: val };
            continue;
        }
        if (!cur) continue;
        if (/^品番$/.test(key)) cur.品番 = val;
        else if (/^数量$/.test(key)) { cur.数量 = toNum(val); const u = toUnit(val); if (u) cur.単位 = u; }
        else if (/^(単価|発注単価)$/.test(key)) cur.単価 = toNum(val);
        else if (/^(金額|発注金額)$/.test(key)) cur.金額 = toNum(val);
    }
    if (cur) items.push(cur);
    return items;
}

/** 明細の外にある項目（合計・納期・納入場所） */
export function extractHeader(text) {
    const out = {};
    for (const line of text.split(/\r?\n/)) {
        const m = line.match(FIELD);
        if (!m) continue;
        const key = m[1].trim(), val = m[2].trim();
        if (/^合計$/.test(key)) out.合計 = toNum(val);
        else if (/^(希望納期|納期)$/.test(key)) out.希望納期 = normDate(val);
        else if (/^納入場所$/.test(key)) out.納入場所 = val;
    }
    return out;
}

/** `2026年8月28日` → `2026-08-28` */
function normDate(s) {
    const m = String(s).match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
    const i = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
    return i ? i[0] : String(s);
}

/**
 * **署名から「誰からの注文か」を取る。**——**取れないときは埋めない。**
 *
 * **卸の注文書で、社名と担当者は署名にしか無いことが多い。**——この検体もそうである。
 * **規則は1つだけにする**：**法人格の語で切る**（株式会社／有限会社／合同会社／合資会社／合名会社）。
 *
 *     うちのまる工業株式会社 田中一郎   →   発注元 ／ 担当者
 *
 * **当たらなければ何も返さない。**——**「1行目を社名とみなす」ことをしない。**
 * 〔TEL・URL・住所が1行目に来る署名は珍しくない。**推測で埋めると、注文書に誤った取引先が載る**〕
 */
export function extractSender(signature = []) {
    const 法人 = "株式会社|有限会社|合同会社|合資会社|合名会社";
    const 後置 = new RegExp("^(.{1,30}?(?:" + 法人 + "))\\s*(.*)$");
    const 前置 = new RegExp("^((?:" + 法人 + ")\\S{1,30})\\s*(.*)$");
    for (const raw of signature) {
        const line = String(raw).replace(/^[-—－\s]+$/, "").trim();
        if (!line) continue;
        const m = line.match(前置) || line.match(後置);
        if (!m) continue;
        const 担当者 = m[2].trim();
        return { 発注元: m[1].trim(), ...(担当者 ? { 担当者 } : {}) };
    }
    return {};
}

/** 本文1通から、起票すべき発注を1件取り出す */
export function extractOrder(body) {
    const { text, dropped, signature } = stripQuotedAndSignature(body);
    return { ...extractSender(signature), ...extractHeader(text), 明細: extractItems(text), $落とした行: dropped };
}
