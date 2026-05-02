#!/usr/bin/env node
/**
 * extract-i18n.mjs — Loop 44 Scope C
 *
 * Loop 43 で src/lib/messages.ts に入れた JSDoc アノテーション
 * (@i18n-namespace / @i18n-prefix / @i18n-key) を正規表現で parse し、
 * src/i18n/extracted-ja.json として i18n 辞書を吐く CLI 雛形。
 *
 * - Node 18+ 純正 ESM、devDependencies 追加なし。
 * - 入力: kintai/src/lib/messages.ts (固定)
 * - 出力: kintai/src/i18n/extracted-ja.json (整形 JSON、UTF-8、末尾改行)
 * - 終了コード: 0 = 成功 / 1 = 入力欠落 or parse 失敗
 *
 * 抽出ルール (設計書 Scope C-1 準拠):
 *   - @i18n-namespace common -> ルートを { "common": { ... } }
 *   - @i18n-prefix <name>    -> 直下の <name> オブジェクトを namespace 配下に展開
 *   - 文字列リテラル          -> そのまま値
 *   - ネスト 1 段オブジェクト -> 配下の文字列リテラルを再帰収集
 *   - 関数値 + @i18n-key 注釈 -> i18next 互換テンプレート ({{param}})
 *     * 三項 (target ? `${target}を保存しました` : '保存しました')
 *       -> メインケースを採用し、else 側は _meta["<prefix>.<key>.fallback"] へ退避
 *
 * 本格 i18next 移行 (Loop 45+) の入力ファイル生成が目的。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INPUT = resolve(ROOT, 'src/lib/messages.ts');
const OUTPUT = resolve(ROOT, 'src/i18n/extracted-ja.json');

function fail(msg) {
  console.error(`[extract-i18n] ${msg}`);
  process.exit(1);
}

if (!existsSync(INPUT)) fail(`input not found: ${INPUT}`);
const source = readFileSync(INPUT, 'utf8');

// --------------------------------------------------------------------------
// 1. namespace
// --------------------------------------------------------------------------
const nsMatch = source.match(/@i18n-namespace\s+(\S+)/);
if (!nsMatch) fail('missing @i18n-namespace annotation');
const NAMESPACE = nsMatch[1];

// --------------------------------------------------------------------------
// 2. 波括弧マッチで { ... } のスライスを取り出す共通ユーティリティ
//    文字列・テンプレートリテラル中の括弧は無視する。
// --------------------------------------------------------------------------
function sliceBlock(src, openIdx) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTpl = false;
  let inBlockComment = false;
  let inLineComment = false;

  for (let i = openIdx; i < src.length; i += 1) {
    const c = src[i];
    const prev = src[i - 1];
    const next = src[i + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i += 1; }
      continue;
    }
    if (inSingle) {
      if (c === "'" && prev !== '\\') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '"' && prev !== '\\') inDouble = false;
      continue;
    }
    if (inTpl) {
      if (c === '`' && prev !== '\\') inTpl = false;
      continue;
    }

    if (c === '/' && next === '/') { inLineComment = true; i += 1; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i += 1; continue; }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === '`') { inTpl = true; continue; }

    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return { text: src.slice(openIdx, i + 1), endIdx: i };
    }
  }
  throw new Error('unbalanced braces');
}

// --------------------------------------------------------------------------
// 3. 各 prefix ブロックの開始位置を取得
// --------------------------------------------------------------------------
const prefixRe = /@i18n-prefix\s+(\w+)\s*\*\/\s*\n\s*\1\s*:\s*\{/g;
const prefixHits = [];
let pm;
while ((pm = prefixRe.exec(source)) !== null) {
  // 末尾の `{` の位置 = pm.index + pm[0].length - 1
  const openIdx = source.indexOf('{', pm.index + pm[0].length - 1);
  prefixHits.push({ name: pm[1], openIdx });
}
if (prefixHits.length === 0) fail('no @i18n-prefix block found');

// --------------------------------------------------------------------------
// 4. ブロック内 entry をパース
//    アプローチ: ブロック内を「子オブジェクト範囲」と「それ以外」に区切り、
//    トップレベルの key を順次拾う。
// --------------------------------------------------------------------------
function unescapeString(raw) {
  return raw.replace(/\\(['"\\nrt])/g, (_, c) => {
    switch (c) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      default: return c;
    }
  });
}

function tplToI18next(tplBody) {
  return tplBody.replace(/\$\{(\w+)\}/g, '{{$1}}');
}

function literalToValue(expr) {
  const t = expr.trim().replace(/[,;]\s*$/, '');
  if (t.startsWith('`') && t.endsWith('`')) return tplToI18next(t.slice(1, -1));
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return unescapeString(t.slice(1, -1));
  }
  return `__UNPARSED__:${t}`;
}

/**
 * トップレベル ternary `cond ? cons : alt` を切り出す。
 * 文字列・テンプレ内の `?` / `:` を無視。
 */
function splitTernary(expr) {
  let depth = 0;
  let inS = false, inD = false, inT = false;
  let qIdx = -1;
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    const prev = expr[i - 1];
    if (inS) { if (c === "'" && prev !== '\\') inS = false; continue; }
    if (inD) { if (c === '"' && prev !== '\\') inD = false; continue; }
    if (inT) { if (c === '`' && prev !== '\\') inT = false; continue; }
    if (c === "'") { inS = true; continue; }
    if (c === '"') { inD = true; continue; }
    if (c === '`') { inT = true; continue; }
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === '?' && depth === 0) { qIdx = i; break; }
  }
  if (qIdx === -1) return null;

  depth = 0; inS = false; inD = false; inT = false;
  for (let i = qIdx + 1; i < expr.length; i += 1) {
    const c = expr[i];
    const prev = expr[i - 1];
    if (inS) { if (c === "'" && prev !== '\\') inS = false; continue; }
    if (inD) { if (c === '"' && prev !== '\\') inD = false; continue; }
    if (inT) { if (c === '`' && prev !== '\\') inT = false; continue; }
    if (c === "'") { inS = true; continue; }
    if (c === '"') { inD = true; continue; }
    if (c === '`') { inT = true; continue; }
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ':' && depth === 0) {
      return { cons: expr.slice(qIdx + 1, i).trim(), alt: expr.slice(i + 1).trim() };
    }
  }
  return null;
}

function extractFnMain(body) {
  const trimmed = body.trim();
  const ternary = splitTernary(trimmed);
  if (ternary) {
    return { main: literalToValue(ternary.cons), fallback: literalToValue(ternary.alt) };
  }
  return { main: literalToValue(trimmed), fallback: null };
}

/**
 * blockText: 波括弧含む `{ ... }` 全体。
 * 戻り値: { entries: { key: value | nestedObj }, fallbacks: [{ keyPath, value }] }
 *
 * アルゴリズム:
 *   a) 内側 (波括弧の中) を走査。トップレベルでのみキーを拾う。
 *   b) `key: { ... }` のネスト object に当たったら sliceBlock で子を取り、
 *      子の中の文字列キー/値を再帰収集。子の範囲はメインスキャンからスキップ。
 *   c) JSDoc の @i18n-key 注釈つき `key: (args) => <body>,` の関数形は
 *      JSDoc のあるものだけを抽出。本体は extractFnMain で値化。
 *   d) `key: '値',` / `key: "値",` の単純文字列はそのまま採用。
 */
function parseBlock(blockText) {
  // 内側だけ
  const innerStart = blockText.indexOf('{') + 1;
  const innerEnd = blockText.lastIndexOf('}');
  const inner = blockText.slice(innerStart, innerEnd);

  const entries = {};
  const fallbacks = []; // {keyPath, value}

  // トップレベルだけ走査するため、深さ追跡しつつインデックスを進める
  let i = 0;
  let pendingI18nKey = null; // 直前 JSDoc から拾った @i18n-key

  function skipWhitespaceAndCommas() {
    while (i < inner.length && /[\s,]/.test(inner[i])) i += 1;
  }

  function tryReadJSDoc() {
    if (inner[i] === '/' && inner[i + 1] === '*' && inner[i + 2] === '*') {
      const end = inner.indexOf('*/', i + 3);
      if (end === -1) { i = inner.length; return; }
      const body = inner.slice(i, end + 2);
      const km = body.match(/@i18n-key\s+([\w.]+)/);
      pendingI18nKey = km ? km[1] : pendingI18nKey;
      i = end + 2;
      return true;
    }
    if (inner[i] === '/' && inner[i + 1] === '/') {
      const nl = inner.indexOf('\n', i);
      i = nl === -1 ? inner.length : nl + 1;
      return true;
    }
    return false;
  }

  function readIdent() {
    const m = /^([A-Za-z_][\w]*)/.exec(inner.slice(i));
    if (!m) return null;
    i += m[1].length;
    return m[1];
  }

  function readStringLiteral() {
    const c = inner[i];
    if (c !== "'" && c !== '"') return null;
    const quote = c;
    let j = i + 1;
    while (j < inner.length) {
      if (inner[j] === '\\') { j += 2; continue; }
      if (inner[j] === quote) {
        const raw = inner.slice(i + 1, j);
        i = j + 1;
        return unescapeString(raw);
      }
      j += 1;
    }
    return null;
  }

  function readObjectValue() {
    // `{ ... }` を 1 段だけ取り、内部の string entry を flat に拾う
    if (inner[i] !== '{') return null;
    const sliced = sliceBlock(inner, i);
    const childInner = sliced.text.slice(1, -1);
    const child = {};
    // 子 inner を簡易再走査 (ネスト 2 段目以降は messages.ts に存在しないので簡略)
    const childRe = /(^|\n|,|\{)\s*([A-Za-z_][\w]*)\s*:\s*(['"])((?:\\.|(?!\3).)*)\3/g;
    let m;
    while ((m = childRe.exec(childInner)) !== null) {
      child[m[2]] = unescapeString(m[4]);
    }
    i = sliced.endIdx + 1;
    return child;
  }

  function readArrowOrFunctionValue() {
    // `(args)... => <body>,` を `,` または ブロック末尾までの本文として取得
    // i は `(` を指しているはず。
    if (inner[i] !== '(') return null;
    // `(args)` を波括弧スキップで超える
    let depth = 0;
    let j = i;
    let inS = false, inD = false, inT = false;
    while (j < inner.length) {
      const c = inner[j];
      const prev = inner[j - 1];
      if (inS) { if (c === "'" && prev !== '\\') inS = false; j += 1; continue; }
      if (inD) { if (c === '"' && prev !== '\\') inD = false; j += 1; continue; }
      if (inT) { if (c === '`' && prev !== '\\') inT = false; j += 1; continue; }
      if (c === "'") { inS = true; j += 1; continue; }
      if (c === '"') { inD = true; j += 1; continue; }
      if (c === '`') { inT = true; j += 1; continue; }
      if (c === '(') depth += 1;
      else if (c === ')') { depth -= 1; if (depth === 0) { j += 1; break; } }
      j += 1;
    }
    // 戻り値型注釈 `: string` をスキップ
    while (j < inner.length && inner[j] !== '=') j += 1;
    if (inner[j] !== '=' || inner[j + 1] !== '>') return null;
    j += 2;
    // body は次のトップレベル `,` まで
    let depth2 = 0;
    let inS2 = false, inD2 = false, inT2 = false;
    let bodyStart = j;
    let k = j;
    while (k < inner.length) {
      const c = inner[k];
      const prev = inner[k - 1];
      if (inS2) { if (c === "'" && prev !== '\\') inS2 = false; k += 1; continue; }
      if (inD2) { if (c === '"' && prev !== '\\') inD2 = false; k += 1; continue; }
      if (inT2) { if (c === '`' && prev !== '\\') inT2 = false; k += 1; continue; }
      if (c === "'") { inS2 = true; k += 1; continue; }
      if (c === '"') { inD2 = true; k += 1; continue; }
      if (c === '`') { inT2 = true; k += 1; continue; }
      if (c === '(' || c === '{' || c === '[') depth2 += 1;
      else if (c === ')' || c === '}' || c === ']') depth2 -= 1;
      else if (c === ',' && depth2 === 0) break;
      k += 1;
    }
    const body = inner.slice(bodyStart, k);
    i = k;
    return { body };
  }

  // メインループ
  while (i < inner.length) {
    skipWhitespaceAndCommas();
    if (i >= inner.length) break;
    if (tryReadJSDoc()) continue;

    const ident = readIdent();
    if (!ident) { i += 1; continue; }

    // `:` を期待
    while (i < inner.length && /\s/.test(inner[i])) i += 1;
    if (inner[i] !== ':') {
      // 想定外、スキップ
      pendingI18nKey = null;
      continue;
    }
    i += 1;
    while (i < inner.length && /\s/.test(inner[i])) i += 1;

    const c = inner[i];
    if (c === "'" || c === '"') {
      const v = readStringLiteral();
      if (v !== null) entries[ident] = v;
      pendingI18nKey = null;
      continue;
    }

    if (c === '{') {
      const obj = readObjectValue();
      if (obj !== null) entries[ident] = obj;
      pendingI18nKey = null;
      continue;
    }

    if (c === '(') {
      const fn = readArrowOrFunctionValue();
      if (fn) {
        const { main, fallback } = extractFnMain(fn.body);
        // pendingI18nKey が無い関数値は採用しない (設計書ルール)
        if (pendingI18nKey) {
          const localKey = pendingI18nKey.split('.').pop() || ident;
          entries[localKey] = main;
          if (fallback !== null) {
            fallbacks.push({ keyPath: `${pendingI18nKey}.fallback`, value: fallback });
          }
        }
      }
      pendingI18nKey = null;
      continue;
    }

    // 想定外の値、トップレベル `,` か `}` まで読み飛ばす
    let depth = 0;
    while (i < inner.length) {
      const cc = inner[i];
      if (cc === '(' || cc === '{' || cc === '[') depth += 1;
      else if (cc === ')' || cc === '}' || cc === ']') depth -= 1;
      else if (cc === ',' && depth === 0) break;
      i += 1;
    }
    pendingI18nKey = null;
  }

  return { entries, fallbacks };
}

// --------------------------------------------------------------------------
// 5. 全 prefix ブロックを処理
// --------------------------------------------------------------------------
const out = { [NAMESPACE]: {} };
const meta = {};

for (const { name, openIdx } of prefixHits) {
  let block;
  try {
    block = sliceBlock(source, openIdx);
  } catch (e) {
    fail(`failed to slice block "${name}": ${e.message}`);
  }
  const { entries, fallbacks } = parseBlock(block.text);
  out[NAMESPACE][name] = entries;
  for (const fb of fallbacks) {
    meta[fb.keyPath] = fb.value;
  }
}

meta._generatedBy = 'scripts/extract-i18n.mjs';
meta._sourcePath = 'src/lib/messages.ts';
meta._namespace = NAMESPACE;
out[NAMESPACE]._meta = meta;

// --------------------------------------------------------------------------
// 6. 出力
// --------------------------------------------------------------------------
const outDir = dirname(OUTPUT);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const json = `${JSON.stringify(out, null, 2)}\n`;
writeFileSync(OUTPUT, json, 'utf8');

// --------------------------------------------------------------------------
// 7. サマリ
// --------------------------------------------------------------------------
const flatCount = (() => {
  let n = 0;
  const walk = (obj) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k === '_meta') continue;
      if (v && typeof v === 'object') walk(v);
      else n += 1;
    }
  };
  walk(out[NAMESPACE]);
  return n;
})();

console.log(`[extract-i18n] OK: ${OUTPUT}`);
console.log(
  `[extract-i18n] namespace="${NAMESPACE}", prefixes=${prefixHits.length}, ` +
  `leaf-keys=${flatCount}, fallbacks=${Object.keys(meta).filter((k) => k.endsWith('.fallback')).length}`,
);
