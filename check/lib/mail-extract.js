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
    // **全角の数字（１２０・１，２００）も数として読む。**——Excel の表で実際に出る形（2026-10-03）
    const m = String(s).normalize("NFKC").replace(/,/g, "").match(/-?\d+/);
    return m ? Number(m[0]) : null;
};
/** 単位を取り出す。`40箱` → 箱 */
const toUnit = (s) => {
    const m = String(s).normalize("NFKC").replace(/[,\d\s]/g, "").match(/^[^0-9]{1,3}/);
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

/** 表の見出し。**項目を並べる書き方（上）と同じ語だけを見る**——語を増やさない */
const TABLE_HEAD = [
    ["品番", /^品番$/],
    ["商品名", /^(商品名|品名|品目)$/],
    ["数量", /^数量$/],
    ["単位", /^単位$/],
    ["単価", /^(単価|発注単価)$/],
    ["金額", /^(金額|発注金額)$/],
];
/** `単価（円）` `数量(単位)` → 単価 / 数量。括弧の中と空白を落とす */
const headKey = (s) => {
    const n = String(s).replace(/[（(［\[][^）)］\]]*[）)］\]]/g, "").replace(/[\s　]/g, "");
    const hit = TABLE_HEAD.find(([, re]) => re.test(n));
    return hit ? hit[0] : null;
};
/** 見出しの行か。**数量と、品番か商品名のどちらかが在ること**——在れば列の対応を返す */
const tableHead = (cells) => {
    const col = {};
    for (const [i, c] of cells.entries()) { const k = headKey(c); if (k && !(k in col)) col[k] = i; }
    return "数量" in col && ("品番" in col || "商品名" in col) ? col : null;
};

/**
 * **タブ区切りの表から明細を切り出す。**（2026-10-03・Excel から貼った注文）
 *
 * **見出しの行が無い表は読まない。**——**列の意味を、並び順から推測しない。**
 * 〔`品番 数量 単価 金額` の順は相手次第で、数量と単価を取り違えても検算（単価×数量）は通る〕
 *
 * **小計・合計・消費税の行は明細にしない。**——小計と合計は、検算に使うので返す。
 */
const quotes = (s) => (s.match(/"/g) ?? []).length;
/**
 * **Excel は、セルの中に改行が在ると、そのセルを引用符で包んで写す。**——行に割る前に、包みの中の改行をつなぐ。
 * 〔つながないと1件が2行に割れ、後ろの行の列がずれる＝数量の列に品名の続きが入る〕
 *
 * **始まりは「セルの先頭が引用符」のときだけ。**——インチの記号（`3/4"`）で後ろの行を飲み込まない。
 * **閉じないまま終わったら、つながずに元の行へ戻す。**
 */
const tableLines = (text) => {
    const out = [];
    let held = null;
    for (const line of text.split(/\r?\n/)) {
        if (held) {
            held.push(line);
            if (quotes(held.join("")) % 2 === 0) { out.push(held.join(" ")); held = null; }
            continue;
        }
        if (line.includes("\t") && /(^|\t)"/.test(line) && quotes(line) % 2 === 1) { held = [line]; continue; }
        out.push(line);
    }
    if (held) out.push(...held);
    return out;
};
/** 包みの引用符を外す。`"ボルト ""特注"""` → `ボルト "特注"` */
const unquote = (c) => (/^"[\s\S]*"$/.test(c) ? c.slice(1, -1).replace(/""/g, '"') : c);

/**
 * **空白や罫線で列をそろえた表を、セルに割る。**（2026-10-04・タブの無い表）
 *
 * 区切りは **半角の空白2つ以上／全角の空白／縦の罫線**。——**空白1つでは割らない**（品名の中の空白と見分けられない）。
 * 罫線だけの行（`|---|---|` `+----+`）は、行ごと捨てる（`null`）。
 */
const splitAligned = (line) => {
    const cells = line.trim().split(/\s*[|｜│┃]\s*|[ ]{2,}|　+/);
    while (cells.length && cells[0] === "") cells.shift();
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    return cells.length && cells.every((c) => /^[-=─━┄┈+:┼╋]*$/.test(c)) ? null : cells;
};

export function extractTable(text) {
    const items = [], totals = {};
    // **そろえた表（タブ無し）は、見出しと列の数が合う行だけを明細にする。**
    //   列の数が合わない行は、**黙って飛ばさず「読めていない明細」として残す**——飛ばすと1品 抜けた注文が検算を通る。
    //   空行で表は終わる（そのあとの文を明細にしない）。小計・合計だけは、空行のあとでも拾う。
    let col = null, tabbed = true, width = 0, closed = false;
    for (const line of tableLines(text)) {
        const tab = line.includes("\t");
        if (!tab && col && !tabbed && !line.trim()) { closed = true; continue; }
        const split = tab ? line.split("\t") : splitAligned(line);
        if (!split || (!tab && split.length < 2)) continue;
        const cells = split.map((c) => unquote(c.trim()).trim());
        const head = tableHead(cells);
        if (head) { col = head; tabbed = tab; width = cells.length; closed = false; continue; }
        if (!col || tab !== tabbed) continue;
        const label = cells.find((c) => c) ?? "";
        const total = label.replace(/[\s　]/g, "").match(/^(小計|合計|消費税|税)/);
        if (total) {
            const nums = cells.filter((c) => c !== label).map(toNum).filter((v) => v != null);
            if (nums.length && (total[1] === "小計" || total[1] === "合計")) totals[total[1]] = nums[nums.length - 1];
            continue;
        }
        if (closed) continue;
        if (!tabbed && cells.length !== width) {
            // 数字の無い行は、表のあとの文である（「以上です。　よろしく…」）——そこで表を終える
            if (!/\d/.test(line.normalize("NFKC"))) { closed = true; continue; }
            items.push({ 商品名: cells.join(" "), 数量: null, 単価: null, 金額: null });
            continue;
        }
        const at = (k) => (k in col ? cells[col[k]] ?? "" : "");
        if (!at("品番") && !at("商品名")) continue;
        const item = {};
        if (at("商品名")) item.商品名 = at("商品名");
        if (at("品番")) item.品番 = at("品番");
        item.数量 = toNum(at("数量"));
        const u = at("単位") || toUnit(at("数量"));
        if (u) item.単位 = u;
        item.単価 = toNum(at("単価"));
        item.金額 = toNum(at("金額"));
        items.push(item);
    }
    return { items, totals };
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
    const 明細 = extractItems(text);
    if (明細.length) return { ...extractSender(signature), ...extractHeader(text), 明細, $落とした行: dropped };
    // **項目を並べる書き方で1件も取れなかったときだけ、表を見る。**——2つの読み方を1通の中で混ぜない
    const { items, totals } = extractTable(text);
    return { ...extractSender(signature), ...totals, ...extractHeader(text), 明細: items, $落とした行: dropped };
}
