/**
 * Reference-job scorecard — compare live takeoff counts/lengths to calibrated
 * production lists. Price is ignored; qty + length + usage matter.
 *
 * Levi 55×80×14 4/12 + left lean 8×80 enclosed, wainscot 3′, OH 6″, embed 3′,
 * plus production openings: OH 10×10, walk 3×6'8", window 4×3 (front).
 * Targets from production Job Review + order CSV (unique post count).
 */

import {
  createProject,
  createBuilding,
  createLeanTo,
  createOpening,
} from '../domain/types.js?v=20260806f';
import { takeoffProject } from './engine.js?v=20260806f';

/** @typedef {{ usage: string, length: string, qty: number, note?: string }} ExpectedLine */

/**
 * Parse length labels to feet (supports 0' 5 1/2", 26' 7", 16').
 * @param {string|number} raw
 */
export function parseLengthFeet(raw) {
  const s = String(raw || '').trim();
  if (!s || s === "0'" || s === '0') return 0;
  const fiFrac = s.match(/(\d+)\s*'\s*(\d+)\s+(\d+)\s*\/\s*(\d+)\s*"?/);
  if (fiFrac) {
    return (
      parseInt(fiFrac[1], 10) +
      (parseInt(fiFrac[2], 10) + parseInt(fiFrac[3], 10) / parseInt(fiFrac[4], 10)) / 12
    );
  }
  const fi = s.match(/(\d+)\s*'\s*(\d+)\s*"?/);
  if (fi) return parseInt(fi[1], 10) + parseInt(fi[2], 10) / 12;
  const ftOnly = s.match(/^(\d+(?:\.\d+)?)\s*'$/);
  if (ftOnly) return parseFloat(ftOnly[1]);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Round length to nearest 1/4" for stable keys. */
export function lengthKey(raw) {
  const ft = parseLengthFeet(raw);
  const q = Math.round(ft * 12 * 4) / 4 / 12;
  return Math.round(q * 10000) / 10000;
}

/**
 * Normalize usage for comparison (Soffit ≡ ExteriorSoffit).
 * @param {string} u
 */
export function normUsage(u) {
  const s = String(u || '').trim();
  if (s === 'ExteriorSoffit' || s === 'Soffit') return 'Soffit';
  return s;
}

/**
 * Build the Levi reference project (colors match production: OTG walls, BK roof/trim/wain).
 * Includes calibrated openings (OH + walk + window) used for production takeoff compare.
 */
export function buildLeviReferenceProject() {
  const b = createBuilding({
    name: 'Main',
    width: 55,
    length: 80,
    eaveHeight: 14,
    pitch: 4,
    roofStyle: 'gable',
    postSpacing: 10,
    postDepthFt: 3,
    trussSpacing: 5,
    girtSpacingIn: 24,
    purlinSpacingIn: 24,
    overhangIn: 0,
    metalOverhangIn: 6, // 6" OH → soffit 5½"
    wallColor: 'OTG',
    roofColor: 'BK',
    trimColor: 'BK',
    wainscotColor: 'BK',
    wainscotHeightFt: 3,
    trussCarrierSize: '2x10',
    leanTos: [
      createLeanTo({
        name: 'Left lean',
        wall: 'left',
        depth: 8,
        length: 0, // full wall
        offset: 0,
        pitch: 4,
        eaveHeight: 14 - (8 * 4) / 12, // 11'4" exact (not 11.3)
        enclosed: true,
        postSpacing: 10,
        metalOverhangIn: 3,
        _mainEaveHeight: 14,
        _mainPitch: 4,
      }),
    ],
    openings: [
      // Front wall — all jambs off 10' grid → 4 JambPost (1@22 + 3@24)
      createOpening({
        type: 'overhead',
        wall: 'front',
        offset: 12,
        width: 10,
        height: 10,
        sillHeight: 0,
      }),
      createOpening({
        type: 'walk',
        wall: 'front',
        offset: 28,
        width: 3,
        height: 6.67,
        sillHeight: 0,
      }),
      createOpening({
        type: 'window',
        wall: 'front',
        offset: 40,
        width: 4,
        height: 3,
        sillHeight: 3,
      }),
    ],
  });

  return createProject({
    customer: 'Levi Reference',
    project: '55x80x14 + lean 8 + openings — scorecard',
    location: 'Calibration',
    laborPerSqFt: 0,
    freightMiles: 0,
    buildings: [b],
    activeBuildingId: b.id,
  });
}

/**
 * Expected qty by usage + length (production unique order list + openings).
 * Shell + OH 10×10 @12', walk 3×6.67 @28', window 4×3 @40' (front).
 * @type {ExpectedLine[]}
 */
export const LEVI_EXPECTED = [
  // ── Framing ──
  { usage: 'Post', length: "24'", qty: 4, note: 'peaks + mid-gable; off-grid jambs are JambPost' },
  { usage: 'Post', length: "22'", qty: 2 },
  { usage: 'Post', length: "20'", qty: 2 },
  { usage: 'Post', length: "18'", qty: 20 },
  { usage: 'Post', length: "16'", qty: 9 },
  { usage: 'JambPost', length: "24'", qty: 3, note: 'off-grid door jambs' },
  { usage: 'JambPost', length: "22'", qty: 1 },
  { usage: 'Header', length: "12'", qty: 5, note: '1×2x12 OH + 4×2x6 walk/window' },
  { usage: 'Trimmer', length: "12'", qty: 2 },
  { usage: 'Sill', length: "12'", qty: 1 },
  { usage: 'Backing', length: "12'", qty: 4 },
  { usage: 'TrussBearer', length: "20'", qty: 24 },
  { usage: 'SkirtBoard', length: "20'", qty: 18, note: '19 base − 1 grade door' },
  // Hybrid production pack (per-wall + eave row + waste) − 1 per main opening
  { usage: 'Girt', length: "20'", qty: 130, note: '133 base − 1/opening ×3 (large+lean package)' },
  // Size-aware purlins: wide building pad + long-building stubs + lean
  { usage: 'Purlin', length: "16'", qty: 158 },
  { usage: 'Purlin', length: "12'", qty: 43 },
  { usage: 'EaveSubFascia', length: "20'", qty: 6 },
  { usage: 'EaveSubFascia', length: "12'", qty: 4 },
  { usage: 'GableSubFascia', length: "20'", qty: 4 },
  { usage: 'GableSubFascia', length: "16'", qty: 2 },
  { usage: 'GableSubFascia', length: "12'", qty: 3 },
  { usage: 'Rafter', length: "12'", qty: 15, note: 'gable fly / lookout only (lean = Purlin)' },
  { usage: 'EndRafter', length: "12'", qty: 2 },
  { usage: 'TrussBlock', length: "12'", qty: 2 },

  // ── Sheathing ──
  { usage: 'ExteriorRoof', length: "38' 4\"", qty: 28 },
  { usage: 'ExteriorRoof', length: "29' 11\"", qty: 27 },
  { usage: 'Wainscot', length: "3'", qty: 123 },
  { usage: 'Soffit', length: "0' 5 1/2\"", qty: 100 },
  { usage: 'Soffit', length: "0' 8 1/4\"", qty: 5 },
  // Wall cuts — gable: roof-line + 14" stock, snapped to 1′ ladder through peak
  // (same size-general rule as 40×40 SB). Heights below already −3′ wainscot.
  { usage: 'ExteriorWall', length: "21' 4\"", qty: 4 },
  { usage: 'ExteriorWall', length: "20' 4\"", qty: 4 },
  { usage: 'ExteriorWall', length: "19' 4\"", qty: 4 },
  { usage: 'ExteriorWall', length: "18' 4\"", qty: 4 },
  { usage: 'ExteriorWall', length: "17' 4\"", qty: 4 },
  { usage: 'ExteriorWall', length: "16' 4\"", qty: 4 },
  { usage: 'ExteriorWall', length: "15' 4\"", qty: 4 },
  { usage: 'ExteriorWall', length: "14' 4\"", qty: 4 },
  { usage: 'ExteriorWall', length: "13' 4\"", qty: 4 },
  { usage: 'ExteriorWall', length: "12' 4\"", qty: 2 },
  { usage: 'ExteriorWall', length: "11' 8\"", qty: 27, note: 'eave upper: eave+8" − 3\' wain' },
  { usage: 'ExteriorWall', length: "11' 4\"", qty: 29 },
  { usage: 'ExteriorWall', length: "10' 4\"", qty: 2 },
  { usage: 'ExteriorWall', length: "8' 8\"", qty: 27 },

  // ── Trim (main package only) ──
  { usage: 'RidgeCap', length: "10'", qty: 10 },
  { usage: 'EaveEdge', length: "10'", qty: 18 },
  { usage: 'EaveFascia', length: "10'", qty: 18 },
  { usage: 'GableFascia', length: "10'", qty: 15 },
  { usage: 'GableEdge', length: "20'", qty: 4 },
  { usage: 'GableEdge', length: "18'", qty: 2 },
  { usage: 'GableEdge', length: "10'", qty: 2 },
  { usage: 'Corner', length: "16'", qty: 2 },
  { usage: 'Corner', length: "12'", qty: 2 },
  { usage: 'Base', length: "10'", qty: 38 },
  { usage: 'WainscotTrim', length: "10'", qty: 37 },
  { usage: 'TopOfWall', length: "10'", qty: 31 },

  // ── Accessories (15MW split) ──
  { usage: 'FastenersRoof', length: "0'", qty: 18 },
  { usage: 'FastenersWall', length: "0'", qty: 18 },
  { usage: 'FastenersWainscot', length: "0'", qty: 4 },
  { usage: 'FastenersTrim', length: "0'", qty: 3 },
  { usage: 'FastenersRidgeCap', length: "0'", qty: 2 },
  { usage: 'ButylTape', length: "0'", qty: 10 },
  { usage: 'ClosuresInside', length: "0'", qty: 54 },
  { usage: 'ClosuresOutside', length: "0'", qty: 54 },
  { usage: 'TorqueBitBucket', length: "0'", qty: 2 },
  { usage: 'Nails16D', length: "0'", qty: 2 },
  { usage: 'Nails40D', length: "0'", qty: 1 },
  { usage: 'TimberHexScrew', length: "0'", qty: 1 },
];

/**
 * Aggregate takeoff items: key = usage|lengthKey → qty
 * @param {object[]} items
 */
export function aggregateTakeoff(items) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const i of items || []) {
    const u = normUsage(i.usage);
    const lk = lengthKey(i.length);
    const key = `${u}|${lk}`;
    map.set(key, (map.get(key) || 0) + (Number(i.qty) || 0));
  }
  return map;
}

/**
 * @param {ExpectedLine[]} expected
 * @param {object[]} items takeoff lines
 * @param {{ tolerance?: number }} [opts]
 */
export function compareExpected(expected, items, opts = {}) {
  const tol = opts.tolerance ?? 0;
  const got = aggregateTakeoff(items);
  const rows = [];
  let pass = 0;
  let fail = 0;

  for (const exp of expected) {
    const u = normUsage(exp.usage);
    const lk = lengthKey(exp.length);
    const key = `${u}|${lk}`;
    const actual = got.get(key) || 0;
    const ok = Math.abs(actual - exp.qty) <= tol;
    if (ok) pass += 1;
    else fail += 1;
    rows.push({
      usage: exp.usage,
      length: exp.length,
      expected: exp.qty,
      actual,
      delta: actual - exp.qty,
      ok,
      note: exp.note || '',
    });
  }

  return {
    pass,
    fail,
    total: expected.length,
    pct: expected.length ? Math.round((pass / expected.length) * 1000) / 10 : 0,
    rows,
  };
}

/**
 * Run full Levi scorecard against engine takeoff.
 * @returns {{ project: object, takeoff: object, report: object }}
 */
export function runLeviScorecard() {
  const project = buildLeviReferenceProject();
  const takeoff = takeoffProject(project);
  const report = compareExpected(LEVI_EXPECTED, takeoff.items || []);
  return { project, takeoff, report };
}

/**
 * Human-readable report text.
 * @param {ReturnType<typeof compareExpected>} report
 */
export function formatScorecardReport(report) {
  const lines = [
    `PoleBarn Pro scorecard — Levi 55×80×14 + lean + openings`,
    `Result: ${report.pass}/${report.total} pass (${report.pct}%)`,
    ``,
  ];
  if (report.fail === 0) {
    lines.push('All calibrated lines match.');
  } else {
    lines.push('FAILURES (usage | length | expected | actual | Δ):');
    for (const r of report.rows.filter((x) => !x.ok)) {
      lines.push(
        `  ${r.usage.padEnd(18)} ${String(r.length).padEnd(12)} exp=${r.expected}  got=${r.actual}  Δ=${r.delta > 0 ? '+' : ''}${r.delta}${r.note ? '  // ' + r.note : ''}`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * P8 — Parse a pasted SmartBuild / order-list framing table into expected lines.
 *
 * Accepts flexible rows, e.g.:
 *   Header  2  12'
 *   Purlin  118  16'
 *   Girt 45 Each 20'
 *   Post	14	14'
 * Tab/CSV/space separated. First token = usage, last number-like with ' = length,
 * another integer = qty.
 *
 * @param {string} text
 * @returns {ExpectedLine[]}
 */
export function parseSbOrderPaste(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  /** @type {ExpectedLine[]} */
  const out = [];
  for (const raw of lines) {
    // skip header rows
    if (/^usage\b/i.test(raw) || /^sku\b/i.test(raw) || /^material\b/i.test(raw)) continue;
    const parts = raw.split(/[\t,;]+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    // also try single-space split if few parts
    const toks = parts.length >= 3 ? parts : raw.split(/\s+/).filter(Boolean);
    if (toks.length < 2) continue;

    let usage = toks[0].replace(/[^A-Za-z]/g, '');
    if (!usage) continue;
    // normalize common SB names
    const usageMap = {
      skirtboard: 'SkirtBoard',
      skirt: 'SkirtBoard',
      trussbearer: 'TrussBearer',
      trussblock: 'TrussBlock',
      jambpost: 'JambPost',
      post: 'Post',
      girt: 'Girt',
      purlin: 'Purlin',
      header: 'Header',
      trimmer: 'Trimmer',
      sill: 'Sill',
      backing: 'Backing',
      rafter: 'Rafter',
      endrafter: 'EndRafter',
    };
    usage = usageMap[usage.toLowerCase()] || usage;

    let qty = null;
    let length = null;
    for (const t of toks.slice(1)) {
      const lenM = t.match(/^(\d+(?:\.\d+)?)\s*'?$/);
      const qtyM = t.match(/^(\d+)$/);
      if (/'/.test(t) || /ft/i.test(t)) {
        const n = parseFloat(t);
        if (Number.isFinite(n)) length = `${Math.round(n)}'`;
      } else if (qtyM && qty == null) {
        qty = parseInt(qtyM[1], 10);
      } else if (lenM && length == null && parseFloat(t) >= 8) {
        // bare number that looks like a stock length
        length = `${Math.round(parseFloat(t))}'`;
      }
    }
    // Heuristic: if we have two ints, smaller is often qty when both present
    const ints = toks.slice(1).map((t) => parseInt(t, 10)).filter((n) => Number.isFinite(n));
    if (qty == null && ints.length >= 1) qty = ints[0];
    if (length == null && ints.length >= 2) {
      const L = ints.find((n) => n >= 8 && n <= 40 && n !== qty);
      if (L != null) length = `${L}'`;
    }
    if (!(qty > 0)) continue;
    if (!length) length = "0'";
    out.push({ usage, length, qty, note: 'from paste' });
  }
  return out;
}

/**
 * Compare pasted SB order lines against live takeoff items.
 * @param {string} pasteText
 * @param {object[]} items
 */
export function comparePasteToItems(pasteText, items) {
  const expected = parseSbOrderPaste(pasteText);
  if (!expected.length) {
    return {
      pass: 0,
      fail: 0,
      total: 0,
      pct: 0,
      rows: [],
      error: 'No parseable lines. Paste rows like: Purlin  118  16\'',
    };
  }
  return compareExpected(expected, items, { tolerance: 0 });
}

/**
 * @param {ReturnType<typeof compareExpected>} report
 * @param {string} [title]
 */
export function formatPasteCompareReport(report, title = 'SB paste compare') {
  if (report.error) return `${title}\n${report.error}`;
  const lines = [
    title,
    `Result: ${report.pass}/${report.total} match (${report.pct}%)`,
    '',
  ];
  for (const r of report.rows) {
    const mark = r.ok ? '✓' : '✗';
    lines.push(
      `${mark} ${r.usage.padEnd(14)} ${String(r.length).padEnd(8)} SB=${r.expected}  PBP=${r.actual}  Δ=${r.delta > 0 ? '+' : ''}${r.delta}`,
    );
  }
  return lines.join('\n');
}
