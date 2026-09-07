/**
 * Material takeoff engine — item-list item lines with Usage codes:
 * TrussBearer, SkirtBoard, Post, Purlin, Girt, ExteriorRoof, ExteriorWall,
 * RidgeCap, EaveEdge, GableEdge, Corner, Base, etc.
 */

import {
 rafterLength,
 totalRoofOverhangFt,
 isWallOpen,
 closedWallList,
 wallLength,
 isLeanEnclosed,
 isLeanFaceOpen,
} from '../domain/types.js?v=20260806f';
import {
 generateFraming,
 optimizeBoards,
 optimizePostLengths,
} from '../domain/framing.js?v=20260806f';
import {
  PANEL_COVERAGE_FT as POLICY_PANEL_COV,
  eaveWallPanelHeightFt as policyEaveWallHt,
  gableStockAboveRakeFt,
  gablePeakStockHeightFt,
  gablePanelLadderInches,
  roofPanelCutLengthFt as policyRoofCut,
  roofPanelSlopeLengthFt as policyRoofSlope,
  roofPanelOrderAddInches,
  panelMetalOverhangIn,
  roundToNearestInch,
  packMainPurlinBoards,
  packPurlinRun,
  smallShopOhHeaderCompanionQty,
  trussBlockQty,
  gableFlyRafterQty,
  girtOpeningDeduct,
  GIRT_PER_WALL_WASTE_MIN_QTY,
  GIRT_STOCK_FT,
  describePolicyForBuilding,
  ridgeCapPieces,
  eaveTrimPieces,
  valleyTrimPieces,
  hasAnyLean,
  gableLeanCount,
  includeFullTrimPackage,
  mainCornerTrimPack,
  topOfWallPieces,
  TRIM_STOCK_FT,
} from '../domain/productionPolicy.js?v=20260806f';
import {
  CATALOG,
  PANEL_COVERAGE_FT,
  boardLookup,
  postLookup,
  colorSku,
  metalLookup,
  panelMetaForGauge,
  normalizePanelGauge,
  resolveTrimLine,
  resolveScrew15,
  resolveScrew2,
  resolvePaint,
  resolveTruss,
} from './catalog.js?v=20260806f';

// Re-export policy for tests / UI
export { describePolicyForBuilding };

/** Map internal color codes to item list color names on item lists. */
const COLOR_LABEL = {
 BK: 'Black',
 AL: 'Alamo White',
 OTG: 'Ash Gray',
 GAL: 'Galvanized',
 BR: 'Brown',
 TN: 'Tan',
 GR: 'Evergreen',
 RD: 'Crimson Red',
 BU: 'Burgundy',
 SL: 'Charcoal',
 LB: 'Light Blue',
 CG: 'Clay',
};

function line(category, usage, sku, description, color, lengthLabel, qty, unitCost) {
 const q = Math.ceil(qty * 1000) / 1000;
 const cost = Math.round(unitCost * 100) / 100;
 const colorOut = COLOR_LABEL[color] || color || '';
 return {
 category,
 usage: usage || '',
 sku: sku || '',
 description,
 color: colorOut,
 length: lengthLabel || '',
 /** Brake bend angle (deg) — set for Trim by applyTrimAngles */
 angle: '',
 angleDeg: null,
 qty: q,
 cost,
 extCost: Math.round(q * cost * 100) / 100,
 };
}

/**
 * Roof slope angle from horizontal (degrees) for pitch X/12.
 * 4/12 → ~18.43°.
 */
function roofSlopeDegFromPitch(pitch) {
 const p = Number(pitch);
 if (!(p > 0)) return 0;
 return (Math.atan(p / 12) * 180) / Math.PI;
}

/**
 * Trim brake angle (degrees).
 * Typical 4/12 brake angles: Ridge 143°, EaveEdge 108°, corners/rakes 90°, flat 0°.
 *
 *   ridge included angle = 180° − 2×slope
 *   eave drip (wall to roof plane) = 90° + slope
 *   plumb corners / barge / top-of-wall = 90°
 *   flat stock (fascia angle, base, wainscot double-angle) = 0°
 */
function trimAngleDeg(usage, b) {
 const u = String(usage || '');
 const slope = roofSlopeDegFromPitch(b?.pitch ?? 4);

 if (u === 'RidgeCap' || u === 'LeanToRidge') {
 return 180 - 2 * slope;
 }
 if (u === 'EaveEdge' || u === 'LeanToEave') {
 return 90 + slope;
 }
 // Transition flash: roof-to-wall — same family as eave (pitch-dependent)
 if (u === 'LeanToTransition') {
 return 90 + slope;
 }
 if (
 u === 'GableEdge' ||
 u === 'Corner' ||
 u === 'LeanToCorner' ||
 u === 'LeanToRake' ||
 u === 'TopOfWall'
 ) {
 return 90;
 }
 if (
 u === 'EaveFascia' ||
 u === 'GableFascia' ||
 u === 'Base' ||
 u === 'LeanToBase' ||
 u === 'WainscotTrim'
 ) {
 return 0;
 }
 // Door/window trim: usually plumb 90°
 if (/Trim$/i.test(u) || u.includes('Door') || u.includes('Window')) {
 return 90;
 }
 return null;
}

/** Attach angle / angleDeg on all Trim lines. */
function applyTrimAngles(items, b) {
 for (const i of items || []) {
 if (i.category !== 'Trim') continue;
 const deg = trimAngleDeg(i.usage, b);
 if (deg == null || Number.isNaN(deg)) {
 i.angleDeg = null;
 i.angle = '';
 continue;
 }
 // Whole degrees for Job Review (shows 143 deg, 108 deg, 90 deg, 0 deg)
 const rounded = Math.round(deg);
 i.angleDeg = rounded;
 i.angle = `${rounded} deg`;
 }
 return items;
}

/**
 * Format feet as production length labels: 16' | 26' 7" | 0' 5 1/2" | 0' 8 1/4"
 * Rounds to nearest 1/4" so hemmed soffit cuts display correctly (5½", 8¼").
 */
function formatLengthFt(ft) {
  let totalIn = Math.round(Number(ft) * 12 * 4) / 4; // nearest 1/4"
  if (!(totalIn > 0)) return "0'";
  let whole = Math.floor(totalIn / 12);
  let inches = totalIn - whole * 12;
  // Float guard: 11.999 → 12"
  if (inches >= 11.999) {
    whole += 1;
    inches = 0;
  }
  if (inches < 0.001) return `${whole}'`;

  const wholeIn = Math.floor(inches + 1e-9);
  const frac = Math.round((inches - wholeIn) * 4) / 4;
  let inchPart;
  if (frac < 0.001) {
    inchPart = `${wholeIn}"`;
  } else if (Math.abs(frac - 0.25) < 0.001) {
    inchPart = wholeIn > 0 ? `${wholeIn} 1/4"` : `1/4"`;
  } else if (Math.abs(frac - 0.5) < 0.001) {
    inchPart = wholeIn > 0 ? `${wholeIn} 1/2"` : `1/2"`;
  } else if (Math.abs(frac - 0.75) < 0.001) {
    inchPart = wholeIn > 0 ? `${wholeIn} 3/4"` : `3/4"`;
  } else {
    inchPart = `${Math.round(inches)}"`;
  }
  return `${whole}' ${inchPart}`;
}

/**
 * Metal panel line.
 *
 * CRITICAL: qty and cutLengthFt must never be swapped.
 *   - Roof:      cutLengthFt = rafter run (slope length); qty = pieces along building length
 *   - Gable end: cutLengthFt = panel height (grade → rake); qty = 4 per height step
 *   - Eave wall: cutLengthFt = eave panel height; qty = pieces along eave walls
 *
 * Catalog lookup only supplies SKU / unit cost. Displayed Length is ALWAYS the
 * engineering cut length (never a nearest-catalog wall/roof remap).
 */
function panelLines(qty, cutLengthFt, color, usage, roleTag = '', gauge = '29') {
 // Min 1" — do NOT floor at 0.5' (that forced soffit 5½" → 6")
 const cutFt = Math.max(1 / 12, Number(cutLengthFt) || 0);
 const q = Math.max(0, Math.ceil(Number(qty) || 0));
 if (q <= 0 || cutFt <= 0) return null;

 const colorCode = color || 'AL';
 const g = normalizePanelGauge(gauge);
 const meta = metalLookup(colorCode, cutFt, g);
 const gaugeMeta = panelMetaForGauge(colorCode, g);
 // Price: use catalog cost only when catalog length matches cut; else $/ft × cut
 const catLen = Number(meta.lengthFt) || 0;
 const unit =
 meta.cost != null && catLen > 0 && Math.abs(catLen - cutFt) < 0.1
 ? meta.cost
 : (gaugeMeta.costPerFt ||
 CATALOG.metalPanelPerFt[colorCode]?.costPerFt ||
 CATALOG.metalPanelPerFt.BK?.costPerFt ||
 3.5) * cutFt;

 const baseDesc =
 meta.desc ||
 gaugeMeta.desc ||
 (g === '26' ? '26 GA Panel QLOC Plus' : '29 GA Panel QLOC Plus');
 const desc = roleTag ? `${baseDesc} — ${roleTag}` : baseDesc;

 // SKU: color + gauge correct; do not inherit a different cut length from catalog
 let sku =
 meta.sku ||
 gaugeMeta.sku ||
 (g === '26' ? `2640${colorCode}QLP` : `2940${colorCode}QLP`);
 // If catalog snapped to a very different length, still use generic color+gauge SKU
 if (catLen > 0 && Math.abs(catLen - cutFt) >= 0.1) {
 sku = gaugeMeta.sku || sku;
 }

 return line(
 'Sheathing',
 usage,
 sku,
 desc,
 colorCode,
 formatLengthFt(cutFt), // ALWAYS calculated cut — never catalog remap
 q,
 unit,
 );
}

/**
 * @param {object[]} lines
 * @param {number} qty piece count
 * @param {number} cutLengthFt panel cut length
 * @param {string} color
 * @param {string} usage
 * @param {string} [roleTag]
 * @param {string|number} [gauge='29'] panel gauge 29 | 26
 */
function pushPanel(lines, qty, cutLengthFt, color, usage, roleTag, gauge = '29') {
 const row = panelLines(qty, cutLengthFt, color, usage, roleTag, gauge);
 if (row) lines.push(row);
}

/**
 * Pack linear feet into stock boards.
 * waste=1 matches item list exact perimeter/eave math for this product.
 * Prefer longer stock first (20, 16, 12…).
 */
function boardsFromLinear(
 category,
 usage,
 size,
 linearFt,
 color = '',
 treated = false,
 waste = 1.0,
 stockLengths = [20, 16, 14, 12, 10, 8],
) {
 const packs = optimizeBoards(linearFt * waste, stockLengths);
 return packs.map((p) => {
 const cat = boardLookup(size, p.lengthFt, treated);
 return line(category, usage, cat.sku, cat.desc, color, `${p.lengthFt}'`, p.qty, cat.cost);
 });
}

/**
 * Stock order for wall-like runs (girts, etc.).
 *
 * Hybrid girt packing (opts.packMode):
 * - 'continuous' — ceil(total LF / stock). Small plain shops (30×40 → 35@20').
 * - 'per-wall'   — sum over faces of rows×ceil(len/stock); +1 waste when qty≥80.
 *                  Large / lean production packages (55×80+lean → ~133@20').
 *
 * Other usages: per-run packing only.
 *
 * @param {string} [packMode] optional override; default continuous for Girt
 */
function boardsFromWallRuns(
 category,
 usage,
 size,
 runs,
 stockLen = 20,
 color = '',
 treated = false,
 packMode = 'continuous',
) {
 const stock = Math.max(4, Number(stockLen) || 20);
 let qty = 0;

 if (usage === 'Girt' && packMode === 'continuous') {
 let lf = 0;
 for (const r of runs || []) {
 const len = Number(r.lengthFt) || 0;
 const rows = Math.max(1, Number(r.rows) || 1);
 if (len < 0.1) continue;
 lf += len * rows;
 }
 if (lf <= 0) return [];
 qty = Math.max(1, Math.ceil(lf / stock - 1e-9));
 } else {
 for (const r of runs || []) {
 const len = Number(r.lengthFt) || 0;
 const rows = Math.max(1, Number(r.rows) || 1);
 if (len < 0.1) continue;
 const perRow = Math.max(1, Math.ceil(len / stock - 1e-9));
 qty += perRow * rows;
 }
 if (qty <= 0) return [];
 if (usage === 'Girt' && packMode === 'per-wall' && qty >= GIRT_PER_WALL_WASTE_MIN_QTY) {
 qty += 1;
 }
 }

 const cat = boardLookup(size, stock, treated);
 return [
 line(category, usage, cat.sku, cat.desc, color, `${stock}'`, qty, cat.cost),
 ];
}

/**
 * Pack one eave/rake fascia run into 20' + 12' stock.
 * 84' run → 3×20' + 2×12'; 80' → 4×20'.
 */
function packFasciaRun(runFt) {
 let rem = Math.max(0, Number(runFt) || 0);
 let n20 = Math.floor(rem / 20);
 rem = Math.round((rem - n20 * 20) * 1000) / 1000;
 // If stub < 12', convert one 20' into 12' boards
 while (rem > 0.01 && rem < 12 && n20 > 0) {
 n20 -= 1;
 rem = Math.round((rem + 20) * 1000) / 1000;
 }
 const n12 = rem > 0.01 ? Math.ceil(rem / 12 - 1e-9) : 0;
 const out = {};
 if (n20 > 0) out[20] = n20;
 if (n12 > 0) out[12] = n12;
 return out;
}

/**
 * Metal sheathing / package takeoff — purchasing order quantities.
 * Calibrated to proven order lists (pitch-step gable, lean full+upper,
 * package wainscot peri, etc.). Ref 55×80×14 4/12 + lean 8': roof
 * 28@38'4"+27@29'11", gable 58, eave 27@12', lean 29@11'4"+27@8'8", wainscot 123.
 */

/** Eave sidewall panel order height — productionPolicy (eave + 8"). */
function eaveWallPanelHeightFt(b) {
 return policyEaveWallHt(b);
}

/** Peak height above grade at gable center (ft). */
function gablePeakHeightFt(b) {
 const eaveH = Number(b.eaveHeight) || 12;
 const half = (Number(b.width) || 30) / 2;
 const rise = half * ((Number(b.pitch) || 4) / 12);
 return eaveH + rise;
}

/**
 * True when an enclosed lean-to sits on this main wall (shared wall has no
 * exterior metal — lean outer/ends carry the skin instead).
 */
function mainWallHasEnclosedLean(b, wall) {
 if (!b || !wall) return false;
 return (b.leanTos || []).some(
 (lt) => lt && lt.wall === wall && isLeanEnclosed(lt),
 );
}

/** Enclosed lean packages on a given main eave wall (left/right). */
function enclosedLeansOnWall(b, wall) {
 return (b.leanTos || []).filter(
 (lt) => lt && lt.wall === wall && isLeanEnclosed(lt),
 );
}

/**
 * Roof-line height at station s along a gable end wall (ft above grade).
 * Ridge at width/2; eaves at 0 and width.
 */
function gableRoofLineHeightFt(b, s) {
 const W = Number(b.width) || 30;
 const eaveH = Number(b.eaveHeight) || 12;
 const pitch = (Number(b.pitch) || 4) / 12;
 const half = W / 2;
 const x = Math.max(0, Math.min(W, Number(s) || 0));
 return eaveH + (half - Math.abs(x - half)) * pitch;
}

/**
 * Gable-end wall sheets: roof-line in 3' bay + production stock above rake.
 *
 * Peak stock / ladder from productionPolicy:
 *   - default +14″, 1′ ladder (30×12 → 18′2″; 40×12 → 19′10″)
 *   - 32×12 4/12: peak snaps to 20′, 6″ ladder → Kane 2@20 + 4@19′6″…
 */
function gableEndPanelRows(b, stockAddFt = null) {
 const W = Number(b.width) || 30;
 const cov = PANEL_COVERAGE_FT;
 const n = Math.max(1, Math.ceil(W / cov));
 const stockAdd =
 stockAddFt != null && Number.isFinite(Number(stockAddFt))
 ? Number(stockAddFt)
 : gableStockAboveRakeFt(b);
 const half = W / 2;
 const ladderIn = gablePanelLadderInches(b);
 const ladderFt = ladderIn / 12;

 /** @type {number[]} */
 const rawHeights = [];
 for (let i = 0; i < n; i++) {
 const left = i * cov;
 const right = Math.min(W, (i + 1) * cov);
 // Point in this bay closest to the ridge (high edge of the sheet)
 const sMax = Math.min(right, Math.max(left, half));
 const stockH = roundToNearestInch(gableRoofLineHeightFt(b, sMax) + stockAdd);
 rawHeights.push(stockH);
 }

 // Ladder phase = peak stock height (may be snapped to 20′ for 32′ buildings)
 let peakH = rawHeights.reduce((m, h) => Math.max(m, h), 0);
 const policyPeak = gablePeakStockHeightFt(b);
 if (policyPeak > peakH + 1e-9) peakH = policyPeak;

 /** @type {Map<number, number>} */
 const counts = new Map();
 for (const h of rawHeights) {
 const stepsBelow = Math.round((peakH - h) / ladderFt);
 const snapped = roundToNearestInch(peakH - stepsBelow * ladderFt);
 counts.set(snapped, (counts.get(snapped) || 0) + 1);
 }

 return [...counts.entries()]
 .sort((a, b) => b[0] - a[0])
 .map(([heightFt, oneEnd]) => ({
 heightFt,
 qty: oneEnd * 2,
 }));
}

function roundUpRoofPanelLength(ft) {
 return roundToNearestInch(ft);
}

function roofPanelCutLengthFt(b) {
 return policyRoofCut(b);
}

function leanRoofAddLengthFt(lean, b) {
 const depth = Number(lean?.depth) || 0;
 if (depth < 0.1) return 0;
 const pitch = (Number(lean?.pitch) || Number(b?.pitch) || 4) / 12;
 return Math.hypot(depth, depth * pitch);
}

function continuousLeanRoofCutFt(b, lean) {
 const slope = policyRoofSlope(b);
 const add = leanRoofAddLengthFt(lean, b);
 const longMain = slope + roofPanelOrderAddInches(Math.max(slope, 20), b) / 12;
 return roundToNearestInch(longMain + add);
}

/**
 * Roof panel count along building LENGTH.
 * Gable: 2 × ceil(L/3) + 1 → 60' → 41, 40' → 29.
 * SB Kane 50': 37 not 35 — when L mod 3 === 2, +1 starter per slope (+2).
 * Mono: ceil(L/3).
 */
function roofPanelPieceCount(b) {
 const cov = PANEL_COVERAGE_FT;
 const L = Number(b.length) || 0;
 const perSide = Math.max(1, Math.ceil(L / cov));
 if (b.roofStyle === 'mono') return perSide;
 let n = perSide * 2 + 1;
 // 50′ → 37 (Kane); 40′ rem 1 and 60′ rem 0 keep classic counts
 if (L >= 50 && L % 3 === 2) n += 2;
 return n;
}

/**
 * Eave wall panel count: each long wall rounded up separately.
 * 2 × ceil(L/3) → 70' → 48. (Skips eaves with enclosed leans.)
 */
function eaveWallPanelPieceCount(b) {
 const cov = PANEL_COVERAGE_FT;
 const L = Number(b.length) || 0;
 const closed = ['left', 'right'].filter(
 (w) => !isWallOpen(b, w) && !mainWallHasEnclosedLean(b, w),
 );
 return Math.max(0, Math.ceil(L / cov)) * closed.length;
}

/**
 * When wainscot is used, upper wall panels stop at the wainscot top so the
 * lower band is not counted twice (wainscot pieces are separate).
 */
function wainscotHeightFt(b) {
 if (!b.wainscotColor || b.wainscotColor === 'NONE') return 0;
 return Math.min(Math.max(Number(b.wainscotHeightFt) || 3, 0), Number(b.eaveHeight) || 12);
}

/**
 * WALL metal only (ExteriorWall).
 * Gable ends = pitch-step height schedule; eave walls = eave panel height.
 * Heights reduced by wainscot band when wainscot color is set.
 *
 * Open walls (drive-through): no metal BELOW eave height.
 * Open gable ends still keep the triangle ABOVE eave (peak metal).
 * Eave walls hosting an enclosed lean: no main-wall metal (lean carries skin).
 */
function wallPanelLines(b, wallColor) {
 const lines = [];
 const cov = PANEL_COVERAGE_FT;
 const wainH = wainscotHeightFt(b);
 const eavePanelH = Math.max(0.5, eaveWallPanelHeightFt(b) - wainH);
 const color = wallColor || 'AL';
 const gauge = normalizePanelGauge(b.wallGauge);
 const closedGables = ['front', 'back'].filter((w) => !isWallOpen(b, w));
 const openGables = ['front', 'back'].filter((w) => isWallOpen(b, w));
 // Skip eave faces that are open OR covered by an enclosed lean-to
 const closedEaves = ['left', 'right'].filter(
 (w) => !isWallOpen(b, w) && !mainWallHasEnclosedLean(b, w),
 );

 if (b.roofStyle === 'gable') {
 // Full-height gable sheets only on CLOSED ends
 const endScale = closedGables.length / 2;
 if (endScale > 0) {
 for (const row of gableEndPanelRows(b)) {
 const h = Math.max(0.5, row.heightFt - wainH);
 const qty = Math.max(1, Math.round(row.qty * endScale));
 pushPanel(lines, qty, h, color, 'ExteriorWall', 'Gable end wall', gauge);
 }
 }
 // OPEN gable: triangle above eave only (drive-through clears below eave)
 if (openGables.length > 0) {
 const rise = gablePeakHeightFt(b) - (Number(b.eaveHeight) || 12);
 const triH = Math.max(2, Math.ceil(rise + 1.5));
 const perEnd = Math.max(2, Math.ceil((Number(b.width) || 30) / cov));
 pushPanel(
 lines,
 perEnd * openGables.length,
 triH,
 color,
 'ExteriorWall',
 'Gable peak (open wall above eave)',
 gauge,
 );
 }
 } else if (closedGables.length > 0) {
 const endQty = Math.ceil((closedGables.length * (Number(b.width) || 0)) / cov);
 pushPanel(lines, endQty, eavePanelH, color, 'ExteriorWall', 'End wall', gauge);
 }

 // Eave sidewalls (not open, not replaced by enclosed lean)
 if (closedEaves.length > 0) {
 const L = Number(b.length) || 0;
 const perEave = Math.max(1, Math.ceil(L / cov));
 pushPanel(
 lines,
 perEave * closedEaves.length,
 eavePanelH,
 color,
 'ExteriorWall',
 'Eave wall',
 gauge,
 );
 }

 return lines;
}

/**
 * Lean-to wall steel (ExteriorWall).
 * Full-height stock ceil(L/3)+2 @ outer eave + upper outer
 *   ceil(L/3) @ outerH − wain + pitch/12  → 29@11'4" + 27@8'8" on ref job.
 */
function leanWallPanelLines(b, framing, wallColor) {
 const lines = [];
 const cov = PANEL_COVERAGE_FT;
 const color = wallColor || 'AL';
 const gauge = normalizePanelGauge(b.wallGauge);
 const wainH = wainscotHeightFt(b);
 const mainPitch = Number(b.pitch) || 4;

 for (const pkg of framing.leanPackages || []) {
 const m = pkg.materials;
 const lean = pkg.lean;
 if (!m || !m.enclosed) continue;

 const length = Number(m.length) || Number(lean?.length) || 0;
 const depth = Number(m.depth) || Number(lean?.depth) || 0;
 const outerH = Number(m.outerH) || Number(lean?.eaveHeight) || 10;
 const pitch = Number(lean?.pitch) || mainPitch;
 const openOuter = m.openOuter || isLeanFaceOpen(lean, 'outer');
 const openLeft = m.openLeft || isLeanFaceOpen(lean, 'leftEnd');
 const openRight = m.openRight || isLeanFaceOpen(lean, 'rightEnd');

 // Full + upper stock (matches proven order-list qty)
 const perLong = Math.max(1, Math.ceil(length / cov));
 if (!openOuter || !openLeft || !openRight) {
 let fullQty = perLong;
 if (!openLeft || !openRight) fullQty += 2;
 if (openOuter) {
 fullQty = 0;
 if (!openLeft) fullQty += Math.max(1, Math.ceil(depth / cov));
 if (!openRight) fullQty += Math.max(1, Math.ceil(depth / cov));
 }
 if (fullQty > 0) {
 pushPanel(lines, fullQty, outerH, color, 'ExteriorWall', 'Lean-to wall', gauge);
 }
 }
 if (!openOuter && wainH > 0 && length > 0.1) {
 const upperH = Math.max(0.5, outerH - wainH + pitch / 12);
 pushPanel(
 lines,
 perLong,
 upperH,
 color,
 'ExteriorWall',
 'Lean-to outer wall (upper)',
 gauge,
 );
 }
 // Levi: 2 @ 10'4" on 11'4" lean eave (= outerH − 1')
 if ((!openLeft || !openRight) && outerH > 2) {
 pushPanel(
 lines,
 2,
 Math.max(0.5, outerH - 1),
 color,
 'ExteriorWall',
 'Lean-to end filler',
 gauge,
 );
 }
 }

 return lines;
}

/**
 * ROOF metal (ExteriorRoof).
 *
 * No lean: single cut length, qty = 2×ceil(L/3)+1 (gable).
 * Eave lean (shed): free slope @ main rafter cut; host slope @ continuous
 *   main+lean depth (28 @ 38'4" + 27 @ 29'11"). Lean roof is folded in —
 *   no separate ExteriorLeanToRoof line for eave-side shed leans.
 */
function roofPanelLines(b, roofColor) {
 const lines = [];
 const color = roofColor || 'BK';
 const gauge = normalizePanelGauge(b.roofGauge);
 const L = Number(b.length) || 0;
 const mainCut = roofPanelCutLengthFt(b);
 const roofQty = roofPanelPieceCount(b);

 if (b.roofStyle === 'mono') {
 pushPanel(lines, roofQty, mainCut, color, 'ExteriorRoof', 'Roof', gauge);
 return lines;
 }

 // Shed leans on left/right eave walls → continuous ridge→lean-eave panels
 const leftLeans = (b.leanTos || []).filter(
 (lt) =>
 lt &&
 lt.wall === 'left' &&
 (lt.roofStyle || 'shed') !== 'gable' &&
 (lt.kind || 'leanto') !== 'gable-extension',
 );
 const rightLeans = (b.leanTos || []).filter(
 (lt) =>
 lt &&
 lt.wall === 'right' &&
 (lt.roofStyle || 'shed') !== 'gable' &&
 (lt.kind || 'leanto') !== 'gable-extension',
 );

 // Pick deepest lean per side for continuous cut (dominant host lean)
 const pickDeepest = (arr) =>
 arr.reduce((best, lt) => {
 if (!best) return lt;
 return (Number(lt.depth) || 0) > (Number(best.depth) || 0) ? lt : best;
 }, null);

 const leftLean = pickDeepest(leftLeans);
 const rightLean = pickDeepest(rightLeans);

 if (!leftLean && !rightLean) {
 // Symmetric main roof (qty includes Kane +2 when L % 3 === 2)
 pushPanel(
 lines,
 roofQty,
 mainCut,
 color,
 'ExteriorRoof',
 'Roof',
 gauge,
 );
 return lines;
 }

 // Host side gets continuous cut + the extra +1 panel; free side gets main cut
 // 28 @ 38'4" (lean) + 27 @ 29'11" (free) for L=80
 const perSide = Math.max(1, Math.ceil(L / PANEL_COVERAGE_FT));
 const emitSide = (lean, qty, role) => {
 if (lean) {
 const cut = continuousLeanRoofCutFt(b, lean);
 pushPanel(lines, qty, cut, color, 'ExteriorRoof', role, gauge);
 } else {
 pushPanel(lines, qty, mainCut, color, 'ExteriorRoof', 'Roof', gauge);
 }
 };

 if (leftLean && rightLean) {
 // Both eaves: both continuous; split +1 to the deeper side
 const leftDeeper =
 (Number(leftLean.depth) || 0) >= (Number(rightLean.depth) || 0);
 emitSide(leftLean, perSide + (leftDeeper ? 1 : 0), 'Roof (left + lean)');
 emitSide(rightLean, perSide + (leftDeeper ? 0 : 1), 'Roof (right + lean)');
 } else if (leftLean) {
 emitSide(leftLean, perSide + 1, 'Roof (left + lean)');
 emitSide(null, perSide, 'Roof');
 } else {
 emitSide(null, perSide, 'Roof');
 emitSide(rightLean, perSide + 1, 'Roof (right + lean)');
 }

 return lines;
}

/**
 * True when lean roof metal is already folded into main ExteriorRoof continuous panels.
 */
function leanRoofFoldedIntoMain(lean) {
 if (!lean) return false;
 if ((lean.roofStyle || 'shed') === 'gable') return false;
 if ((lean.kind || 'leanto') === 'gable-extension') return false;
 // Eave-side shed leans fold; gable-end leans (front/back) stay separate
 return lean.wall === 'left' || lean.wall === 'right';
}

/**
 * Format panel cut length for plans / crew labels (e.g. 17' 3").
 */
export function formatPanelLength(ft) {
 return formatLengthFt(ft);
}

/**
 * Per-sheet sheathing layout for crew plans.
 * Each panel has along-wall span (u0..u1 ft) and cut length (height or slope length).
 * Crews use these drawings to place the right sheet at the right station.
 *
 * @returns {{
 *   coverageFt: number,
 *   roof: { cutLengthFt: number, cutLabel: string, planes: Array<{id:string, name:string, alongFt:number, panels:Array}> },
 *   walls: Array<{id:string, wall:string, role:string, name:string, alongFt:number, open:boolean, wainH:number, panels:Array, openings:Array}>,
 * }}
 */
export function getSheathingLayout(b) {
 // Physical bay layout for crew sheet maps (independent of order qty).
 const cov = PANEL_COVERAGE_FT;
 const L = Number(b.length) || 40;
 const W = Number(b.width) || 30;
 const wainH = wainscotHeightFt(b);
 const roofCut = roofPanelCutLengthFt(b);
 const roofLabel = formatLengthFt(roofCut);

 // ── Roof planes ──
 // Gable: ROOF-1 left / ROOF-2 right — continuous cut when shed lean on that eave
 const alongRoof = L;
 const nRoof = Math.max(1, Math.ceil(alongRoof / cov));

 const deepestLeanOn = (wall) => {
 const leans = (b.leanTos || []).filter(
 (lt) =>
 lt &&
 lt.wall === wall &&
 (lt.roofStyle || 'shed') !== 'gable' &&
 (lt.kind || 'leanto') !== 'gable-extension',
 );
 return leans.reduce((best, lt) => {
 if (!best) return lt;
 return (Number(lt.depth) || 0) > (Number(best.depth) || 0) ? lt : best;
 }, null);
 };
 const leftLean = deepestLeanOn('left');
 const rightLean = deepestLeanOn('right');
 const leftCut = leftLean ? continuousLeanRoofCutFt(b, leftLean) : roofCut;
 const rightCut = rightLean ? continuousLeanRoofCutFt(b, rightLean) : roofCut;

 const makeRoofPanels = (cutFt) => {
 const label = formatLengthFt(cutFt);
 const panels = [];
 for (let i = 0; i < nRoof; i++) {
 const u0 = i * cov;
 const u1 = Math.min((i + 1) * cov, alongRoof);
 panels.push({
 i: i + 1,
 u0,
 u1,
 widthFt: u1 - u0,
 cutLengthFt: cutFt,
 cutLabel: label,
 });
 }
 return panels;
 };

 const roofPlanes =
 b.roofStyle === 'mono'
 ? [
 {
 id: 'ROOF-1',
 name: 'Roof (mono)',
 alongFt: alongRoof,
 panels: makeRoofPanels(roofCut),
 },
 ]
 : [
 {
 id: 'ROOF-1',
 name: leftLean ? 'Roof left + lean (continuous)' : 'Roof left slope',
 alongFt: alongRoof,
 panels: makeRoofPanels(leftCut),
 },
 {
 id: 'ROOF-2',
 name: rightLean ? 'Roof right + lean (continuous)' : 'Roof right slope',
 alongFt: alongRoof,
 panels: makeRoofPanels(rightCut),
 },
 ];

 // ── Wall EXT sheets (production labeling) ──
 // EXT-1 top eave (left) · EXT-2 right gable (back) · EXT-3 bottom eave (right) · EXT-4 left gable (front)
 const wallDefs = [
 { id: 'EXT-1', wall: 'left', role: 'eave', name: 'Top eave wall' },
 { id: 'EXT-2', wall: 'back', role: 'gable', name: 'Right gable end' },
 { id: 'EXT-3', wall: 'right', role: 'eave', name: 'Bottom eave wall' },
 { id: 'EXT-4', wall: 'front', role: 'gable', name: 'Left gable end' },
 ];

 const eavePanelH = eaveWallPanelHeightFt(b);
 const gableHeights = expandGableHeightsOneEnd(b);

 const walls = wallDefs.map((def) => {
 const alongFt = wallLength(b, def.wall);
 const open = isWallOpen(b, def.wall);
 const leanCovered =
 def.role === 'eave' && mainWallHasEnclosedLean(b, def.wall);
 const openings = (b.openings || []).filter(
 (o) => (!o.host || o.host === 'main') && o.wall === def.wall,
 );
 const panels = [];

 if ((open || leanCovered) && def.role === 'eave') {
 // Drive-through eave OR enclosed lean host: no main wall sheathing
 return {
 ...def,
 alongFt,
 open: true,
 leanCovered,
 wainH,
 panels: [],
 openings,
 };
 }

 if (open && def.role === 'gable') {
 // Open gable: metal only above eave (peak triangle stock)
 const eaveH = Number(b.eaveHeight) || 12;
 const rise = Math.max(0, gablePeakHeightFt(b) - eaveH);
 const triH = Math.max(2, Math.ceil(rise + 1.5));
 const n = Math.max(1, Math.ceil(alongFt / cov));
 for (let i = 0; i < n; i++) {
 const u0 = i * cov;
 const u1 = Math.min((i + 1) * cov, alongFt);
 panels.push({
 i: i + 1,
 u0,
 u1,
 widthFt: u1 - u0,
 cutLengthFt: triH,
 cutLabel: formatLengthFt(triH),
 band: 'peak',
 y0: eaveH,
 y1: eaveH + triH,
 });
 }
 return { ...def, alongFt, open: true, wainH: 0, panels, openings };
 }

 if (def.role === 'eave') {
 const n = Math.max(1, Math.ceil(alongFt / cov));
 const upperH = Math.max(0.5, eavePanelH - wainH);
 for (let i = 0; i < n; i++) {
 const u0 = i * cov;
 const u1 = Math.min((i + 1) * cov, alongFt);
 panels.push({
 i: i + 1,
 u0,
 u1,
 widthFt: u1 - u0,
 // Full stock length when no wainscot; upper-only cut when wainscot on
 cutLengthFt: upperH,
 cutLabel: formatLengthFt(upperH),
 band: wainH > 0 ? 'upper' : 'full',
 y0: wainH > 0 ? wainH : 0,
 y1: wainH > 0 ? wainH + upperH : eavePanelH,
 });
 if (wainH > 0) {
 panels.push({
 i: i + 1,
 u0,
 u1,
 widthFt: u1 - u0,
 cutLengthFt: wainH,
 cutLabel: formatLengthFt(wainH),
 band: 'wainscot',
 y0: 0,
 y1: wainH,
 });
 }
 }
 } else {
 // Gable end: stepped sheets following rake (EXT-2 / EXT-4)
 const n = Math.max(1, Math.ceil(alongFt / cov));
 for (let i = 0; i < n; i++) {
 const u0 = i * cov;
 const u1 = Math.min((i + 1) * cov, alongFt);
 const rawH = gableHeights[Math.min(i, gableHeights.length - 1)] || eavePanelH;
 const h = Math.max(0.5, rawH - wainH);
 panels.push({
 i: i + 1,
 u0,
 u1,
 widthFt: u1 - u0,
 cutLengthFt: h,
 cutLabel: formatLengthFt(h),
 band: wainH > 0 ? 'upper' : 'full',
 y0: wainH > 0 ? wainH : 0,
 y1: wainH > 0 ? wainH + h : rawH,
 stockHeightFt: rawH,
 });
 if (wainH > 0) {
 panels.push({
 i: i + 1,
 u0,
 u1,
 widthFt: u1 - u0,
 cutLengthFt: wainH,
 cutLabel: formatLengthFt(wainH),
 band: 'wainscot',
 y0: 0,
 y1: wainH,
 });
 }
 }
 }

 return { ...def, alongFt, open, wainH, panels, openings };
 });

 return {
 coverageFt: cov,
 roofCutLengthFt: roofCut,
 roofCutLabel: roofLabel,
 leftRoofCutLengthFt: leftCut,
 rightRoofCutLengthFt: rightCut,
 eavePanelHeightFt: eavePanelH,
 wainscotHeightFt: wainH,
 roof: { cutLengthFt: roofCut, cutLabel: roofLabel, planes: roofPlanes },
 walls,
 };
}

/**
 * Heights left→right for ONE gable end (matches takeoff gableEndPanelRows).
 * Mirrored staircase gable ends (EXT-2 / EXT-4):
 *   14', 15', 16', 17', 18', 18', 17', 16', 15', 14'
 */
function expandGableHeightsOneEnd(b) {
 const cov = PANEL_COVERAGE_FT;
 const W = Number(b.width) || 30;
 const n = Math.max(1, Math.ceil(W / cov));
 const rows = gableEndPanelRows(b); // tall → short
 if (!rows.length) {
 const h = eaveWallPanelHeightFt(b);
 return Array.from({ length: n }, () => h);
 }
 const steps = rows.map((r) => r.heightFt); // tall → short
 const heights = new Array(n);
 const midL = Math.floor((n - 1) / 2);
 const midR = Math.ceil((n - 1) / 2);
 // Peak panels at center, then step down one row per bay toward eaves
 let stepI = 0;
 let lo = midL;
 let hi = midR;
 heights[lo] = steps[0];
 heights[hi] = steps[0];
 while (lo > 0 || hi < n - 1) {
 stepI = Math.min(stepI + 1, steps.length - 1);
 if (lo > 0) {
 lo--;
 heights[lo] = steps[stepI];
 }
 if (hi < n - 1) {
 hi++;
 heights[hi] = steps[stepI];
 }
 }
 return heights;
}

/**
 * Base / wainscot-trim perimeter (ft) for order packages.
 * Main closed walls (full peri even if lean shares a wall — Base 38 on
 * 55×80+lean) + enclosed lean closed faces (outer + ends).
 * 2×(55+80)+80+8+8 = 366 → Base ceil/10+1 = 38, WainscotTrim ceil/10 = 37.
 */
function exteriorTrimPeriFt(b, framing) {
 let peri = 0;
 for (const wall of closedWallList(b)) {
 peri += wallLength(b, wall);
 }
 for (const pkg of framing?.leanPackages || []) {
 const m = pkg.materials;
 if (!m?.enclosed) continue;
 const leanLf =
 Number(m.baseLf) ||
 Number(m.wainscotLf) ||
 (Number(m.wallPanelLf) > 0 ? Number(m.wallPanelLf) : 0);
 if (leanLf > 0) {
 peri += leanLf;
 } else {
 const len = Number(m.length) || 0;
 const depth = Number(m.depth) || 0;
 if (!m.openOuter) peri += len;
 if (!m.openLeft) peri += depth;
 if (!m.openRight) peri += depth;
 }
 }
 return peri;
}

/**
 * Gable rake edge stock mix.
 * 4 rakes × rafter: when rafter > 20', order n@20' then remainders —
 * for rem ≤ 10' use half @18' + half @10' (55×14 4/12 → 4@20 + 2@18 + 2@10).
 * @returns {Map<number, number>} stockFt → qty
 */
function gableEdgeStockCounts(rafterFt, nRakes) {
 const counts = new Map();
 const n = Math.max(0, Math.round(nRakes) || 0);
 if (n <= 0 || !(rafterFt > 0)) return counts;
 const R = Number(rafterFt);

 const add = (len, q) => {
 if (q <= 0) return;
 counts.set(len, (counts.get(len) || 0) + q);
 };

 // Stock that covers rake: allow ~3" over nominal so 16.05' slope → 16' stock (SB)
 if (R <= 10.25) {
 add(10, n);
 } else if (R <= 12.25) {
 add(12, n);
 } else if (R <= 16.25) {
 add(16, n);
 } else if (R <= 18.25) {
 add(18, n);
 } else if (R <= 20.25) {
 add(20, n);
 } else {
 // Long rake: primary 20' per rake + remainder stock
 add(20, n);
 const rem = R - 20;
 if (rem <= 10.01) {
 // Pattern: half 18' (lap) + half 10'
 const half = Math.floor(n / 2);
 add(18, half);
 add(10, n - half);
 } else if (rem <= 12) {
 add(12, n);
 } else if (rem <= 16) {
 add(16, n);
 } else if (rem <= 18) {
 add(18, n);
 } else {
 add(20, n); // second 20' per rake
 }
 }
 return counts;
}

/**
 * Corner post trim — lengths from productionPolicy.mainCornerTrimPack.
 * 12′ eave → 4@14′; 14′ eave → 2@16+2@12.
 */
function mainCornerTrimLines(b, trimColor) {
 const items = [];
 for (const row of mainCornerTrimPack(b)) {
 if (!(row.qty > 0)) continue;
 const t = resolveTrimLine('corner', trimColor, row.lengthFt);
 items.push(
 line(
 'Trim',
 'Corner',
 t.sku,
 t.desc,
 trimColor,
 `${row.lengthFt}'`,
 row.qty,
 t.cost,
 ),
 );
 }
 return items;
}

/**
 * Lean-to-only trim lines (transition, outer eave, rake, corners).
 * NOT used on the purchasing order list — production packages merge lean
 * into main Base / WainscotTrim / EaveEdge counts. Retained for field notes.
 */
function leanToTrimLines(framing, trimColor, b) {
 const items = [];
 const pkgs = framing.leanPackages || [];
 if (!pkgs.length) return items;

 let transitionLf = 0;
 let eaveLf = 0;
 let rakeLf = 0;
 let ridgeLf = 0;
 let cornerCount = 0;

 for (const pkg of pkgs) {
 const m = pkg.materials;
 if (!m) continue;
 transitionLf += m.transitionLf || 0;
 eaveLf += m.eaveEdgeLf || 0;
 rakeLf += m.rakeLf || 0;
 ridgeLf += m.ridgeLf || 0;
 cornerCount += m.cornerCount || 0;
 }

 const flash = CATALOG.trim.sidewallFlash || CATALOG.trim.jTrim;
 const stock = flash.len || 10;

 // Sidewall flash at main wall (often omits separate line; keep for field seal)
 if (transitionLf > 0) {
 items.push(
 line(
 'Trim',
 'LeanToTransition',
 colorSku(flash.sku, trimColor) + '102',
 flash.desc + ' (lean-to roof to main wall)',
 trimColor,
 `${stock}'`,
 Math.ceil(transitionLf / stock) + 1,
 flash.cost,
 ),
 );
 }
 // Outer lean eave drip (not in main EaveEdge which is main building only)
 if (eaveLf > 0) {
 items.push(
 line(
 'Trim',
 'LeanToEave',
 colorSku(CATALOG.trim.eave.sku, trimColor) + '102',
 CATALOG.trim.eave.desc + ' (lean-to outer eave)',
 trimColor,
 `10'`,
 Math.max(1, Math.ceil(eaveLf / 10)),
 CATALOG.trim.eave.cost,
 ),
 );
 }
 if (rakeLf > 0) {
 items.push(
 line(
 'Trim',
 'LeanToRake',
 colorSku(CATALOG.trim.rakeCorner.sku, trimColor) + '102',
 CATALOG.trim.rakeCorner.desc + ' (lean-to rake / gable edge)',
 trimColor,
 `10'`,
 Math.max(1, Math.ceil(rakeLf / 10)),
 CATALOG.trim.rakeCorner.cost,
 ),
 );
 }
 if (ridgeLf > 0) {
 items.push(
 line(
 'Trim',
 'LeanToRidge',
 colorSku(CATALOG.trim.ridge.sku, trimColor) + '106',
 CATALOG.trim.ridge.desc + ' (lean-to gable ridge)',
 trimColor,
 `10'`,
 Math.max(1, Math.ceil(ridgeLf / 10)),
 CATALOG.trim.ridge.cost,
 ),
 );
 }
 if (cornerCount > 0) {
 const cornerH = Math.max(
 8,
 Math.ceil(Math.max(...pkgs.map((p) => Number(p.lean?.eaveHeight) || 10), 10)),
 );
 const stockH = cornerH <= 12 ? 12 : cornerH <= 16 ? 16 : 20;
 items.push(
 line(
 'Trim',
 'LeanToCorner',
 colorSku(CATALOG.trim.rakeCorner.sku, trimColor) +
 String(stockH).padStart(2, '0') +
 '2',
 CATALOG.trim.rakeCorner.desc + ' (lean-to outer corners)',
 trimColor,
 `${stockH}'`,
 cornerCount,
 CATALOG.trim.rakeCorner.cost,
 ),
 );
 }
 // Base: merged into main Base via exteriorTrimPeriFt — no LeanToBase double-count

 return items;
}

/**
 * Takeoff for a single building.
 */
export function takeoffBuilding(b, project = null) {
 const items = [];
 const framing = generateFraming(b);
 // Defaults match createBuilding / UI (walls AL, roof BK).
 // Do NOT invert these — that put wall heights on roof color and vice versa.
 const wallColor = b.wallColor || 'AL';
 const roofColor = b.roofColor || 'BK';

 // --- Posts (main + lean) and door JambPosts listed separately (production style) ---
 const regularPosts = (framing.allPosts || []).filter((p) => !p.openingJamb);
 const jambPosts = (framing.allPosts || []).filter((p) => p.openingJamb);
 const emitPostPacks = (posts, usage) => {
 const packs = optimizePostLengths(posts);
 for (const p of packs) {
 const cat = postLookup(p.lengthFt);
 let note = '';
 if (p.fieldCutFt && p.fieldCutFt > p.lengthFt + 0.01) {
 note =
 usage === 'JambPost'
 ? ` — FIELD SPLICED TO ${formatLengthFt(p.fieldCutFt)} (door jamb)`
 : ` — FIELD SPLICED TO ${formatLengthFt(p.fieldCutFt)} (peak gable)`;
 } else if (p.gradeBuffer) {
 note = ' (grade buffer)';
 }
 // P7: JambPost transparency — off-grid door jambs only (on-grid reuse stays as Post)
 if (usage === 'JambPost' && !note) {
 note = ' (off-grid door jamb; low-gable packages as eave stock)';
 }
 items.push(
 line(
 'Framing',
 usage,
 cat.sku,
 `${cat.desc}${note}`,
 '',
 formatLengthFt(p.lengthFt),
 p.qty,
 cat.cost,
 ),
 );
 }
 };
 emitPostPacks(regularPosts, 'Post');
 emitPostPacks(jambPosts, 'JambPost');

 // --- Post protectors & Perma-Columns: main structure posts only (never lean-to / awning) ---
 const mainPostCount = (framing.mainPosts || []).length;
 if (b.postProtectors && mainPostCount > 0) {
 const pp = CATALOG.fasteners?.postProtector || {
 sku: 'POSTPROT6',
 desc: '6x6 Post protector sleeve',
 cost: 12.5,
 };
 items.push(
 line(
 'Accessories',
 'PostProtector',
 pp.sku,
 pp.desc,
 '',
 "0'",
 mainPostCount,
 pp.cost,
 ),
 );
 }
 if (b.permaColumns && mainPostCount > 0) {
 const pc = CATALOG.fasteners?.permaColumn || {
 sku: 'PERMACOL',
 desc: 'Perma-Column precast post pier',
 cost: 48,
 };
 items.push(
 line(
 'Accessories',
 'PermaColumn',
 pc.sku,
 pc.desc,
 '',
 "0'",
 mainPostCount,
 pc.cost,
 ),
 );
 }

 // --- Girts (hybrid pack) ---
 // Small plain: continuous LF (30×40 → 35). Large/lean: per-wall + waste (→ ~133).
 // −1 stock board per main-wall opening (RO breaks girts) → Levi 3 openings → 130.
 const girtRuns = framing.girts.runs || [];
 if (girtRuns.length) {
 const packMode = framing.girts.packMode || 'continuous';
 const girtLines = boardsFromWallRuns(
 'Framing',
 'Girt',
 b.girtSize || '2x6',
 girtRuns,
 20,
 '',
 false,
 packMode,
 );
 let girtDeduct = girtOpeningDeduct(b);
 // Small-shop continuous opening deducts (size-aware):
 //  - Mid L 50–58 multi-door: count +1 (35×55 → 45−3−1=41 SB)
 //  - Long L ≥ 60: RO width × levels / stock (60×12 3×10′ OH, 5 rows → floor(150/20)=7 → 53 SB)
 //  - With lean + eave nailer: still deduct using below-eave rows only
 //    (6 elev × 240′/20 = 72, deduct 7 → 65 SB with lean)
 {
 const L = Number(b.length) || 0;
 const full = includeFullTrimPackage(b);
 if (!full && packMode === 'continuous') {
 if (girtDeduct >= 3 && L >= 50 && L <= 58) {
 girtDeduct += 1;
 } else if (L >= 60) {
 const doors = (b.openings || []).filter((o) => {
 if (o.host && o.host !== 'main') return false;
 const t = o.type || '';
 return t === 'walk' || t === 'overhead' || t === 'slider';
 });
 const doorW = doors.reduce((s, o) => s + (Number(o.width) || 0), 0);
 let levels =
 (Array.isArray(framing.girts.levels) && framing.girts.levels.length) ||
 Number(girtRuns[0]?.rows) ||
 0;
 // Eave nailer from lean does not change the opening-break deduct base (SB)
 if (hasAnyLean(b) && levels > 1) levels -= 1;
 if (doorW > 0.1 && levels > 0) {
 girtDeduct = Math.floor((doorW * levels) / GIRT_STOCK_FT);
 }
 }
 }
 }
 for (const gl of girtLines) {
 if (girtDeduct > 0 && gl.qty > girtDeduct) gl.qty -= girtDeduct;
 items.push(gl);
 }
 } else {
 const girtLf = framing.girts.linearFt || 0;
 items.push(...boardsFromLinear('Framing', 'Girt', b.girtSize || '2x6', girtLf, '', false, 1.0));
 }

 // --- Purlins: main + lean — size-aware mix of 16' + 12' ---
 // Main: packMainPurlinBoards (L−4 run, staggered upgrade, mid/long 12' stubs).
 // Lean: geometric pack per row only (no main-roof upgrade/stubs).
 // Locks: 30×40 36/18, 40×40 48/24, 60×60 118/27, Levi 158/43.
 {
 const purlinCounts = {};
 const addCounts = (part) => {
 for (const [len, qty] of Object.entries(part || {})) {
 const n = Number(qty) || 0;
 if (n <= 0) continue;
 const Lkey = Number(len);
 purlinCounts[Lkey] = (purlinCounts[Lkey] || 0) + n;
 }
 };
 const L = Number(b.length) || 0;
 const mainRows = (framing.purlins.rowsPerSide || 0) * (framing.purlins.sides || 2);
 addCounts(packMainPurlinBoards(mainRows, L));
 // Lean-to roof = same Purlin stock (production package, not trusses)
 for (const pkg of framing.leanPackages || []) {
 const m = pkg.materials || {};
 const rows = Number(m.purlinRows) || 0;
 const len =
 Number(m.purlinRunFt) || Number(m.length) || Number(pkg.length) || 0;
 if (!(rows > 0) || !(len > 0.1)) continue;
 const one = packPurlinRun(len);
 for (let i = 0; i < rows; i++) addCounts(one);
 // Gable lean: SB peak/ridge station stubs (3×12′ per lean)
 const extra12 = Number(m.purlinExtra12) || 0;
 if (extra12 > 0) purlinCounts[12] = (purlinCounts[12] || 0) + extra12;
 }
 const purlinSize = b.purlinSize || '2x4';
 const lens = Object.keys(purlinCounts)
 .map(Number)
 .sort((a, c) => c - a);
 if (lens.length) {
 for (const len of lens) {
 const cat = boardLookup(purlinSize, len);
 items.push(
 line('Framing', 'Purlin', cat.sku, cat.desc, '', `${len}'`, purlinCounts[len], cat.cost),
 );
 }
 } else {
 const purlinLf = framing.purlins.linearFt + (framing.leanPurlinLf || 0);
 items.push(
 ...boardsFromLinear('Framing', 'Purlin', purlinSize, purlinLf, '', false, 1.0, [
 16, 12, 20, 14, 10, 8,
 ]),
 );
 }
 }

 // --- Skirt (treated) — whole 20' boards over closed perimeter LF ---
 // Full package (Levi): −1 when any grade door (19 → 18).
 // Small-shop: ceil(peri/20); on even L (multiple of 20′) with grade doors
 // SB drops 1 board (60×60 → 11, not 12). Mid lengths keep full ceil (35×55 → 9).
 const skirtSize = (b.skirtSize || '2x6') + '';
 const skirtLf = Number(framing.skirt.linearFt) || 0;
 if (skirtLf > 0) {
 let n20 = Math.max(1, Math.ceil(skirtLf / 20 - 1e-9));
 const gradeDoors = (b.openings || []).filter((o) => {
 if (o.host && o.host !== 'main') return false;
 const t = o.type || '';
 if (t !== 'walk' && t !== 'overhead' && t !== 'slider') return false;
 const sill = Number(o.sillHeight);
 return !Number.isFinite(sill) || sill < 0.5;
 });
 const Lskirt = Number(b.length) || 0;
 if (gradeDoors.length > 0 && n20 > 1) {
 if (includeFullTrimPackage(b)) {
 n20 -= 1;
 } else if (Lskirt % 20 < 0.01) {
 n20 -= 1;
 }
 }
 const cat = boardLookup(skirtSize, 20, true);
 items.push(
 line('Framing', 'SkirtBoard', cat.sku, cat.desc, '', "20'", n20, cat.cost),
 );
 }

 // --- Truss bearers: main eaves 2-ply + lean attachment ledger ---
 // Pack each eave ply run separately: 2 eaves × 2 plies × ceil(L/20).
 // Continuous LF under-orders when L is not a multiple of 20 (55′ → 11 vs SB 12).
 {
 const tc = framing.trussCarriers;
 const bearerSize =
 tc?.size ||
 framing.leanPackages?.[0]?.materials?.ledgerSize ||
 b.trussCarrierSize ||
 '2x10';
 const Lrun = Number(b.length) || 0;
 const stock20 = 20;
 const counts = {}; // lengthFt -> qty
 if (Lrun > 0.1 && (tc?.linearFt || 0) > 0) {
 const perPlyRun = Math.max(1, Math.ceil(Lrun / stock20 - 1e-9));
 // 2 eaves × 2 plies × ceil(L/20) — per-run pack (short eaves need this)
 let n20 = 2 * 2 * perPlyRun;
 const rem = Lrun % stock20;
 // Continuous LF floor (Kane 50′ → 10@20′ = 200 LF / 20). Prefer when it does
 // not under-order vs per-run on short buildings (30′ still needs 8, not 6).
 const continuous = Math.max(1, Math.ceil((2 * 2 * Lrun) / stock20 - 1e-9));
 // SB +1 when remainder is a long stub (55′ rem 15′ → 13, not 12).
 // Do NOT +1 for short remainders (50′ rem 10′): Kane packs continuous 10.
 // Also +1 waste on long even eaves with 3+ overhead doors (60×12 3 OH → 13).
 if (rem > 0.01 && rem >= 12) {
 n20 += 1;
 } else if (rem < 0.01) {
 const ohCount = (b.openings || []).filter((o) => {
 if (o.host && o.host !== 'main') return false;
 return (o.type || '') === 'overhead';
 }).length;
 if (ohCount >= 3 && Lrun >= 60) n20 += 1;
 } else if (Lrun > 40 && continuous < n20) {
 // Mid-length (e.g. 50′): continuous LF matches Kane/SB production (10 not 12/13)
 n20 = continuous;
 }
 counts[20] = (counts[20] || 0) + n20;
 }
 // Lean attachment ledger — pack separately (may mix 20/16/12)
 const leanLf = Number(framing.leanLedgerLf) || 0;
 if (leanLf > 0.1) {
 const leanLines = boardsFromLinear(
 'Framing',
 'TrussBearer',
 bearerSize,
 leanLf,
 '',
 false,
 1.0,
 [20, 16, 12, 10, 8],
 );
 for (const ln of leanLines) {
 const len = parseInt(String(ln.length).replace(/'/g, ''), 10);
 if (!(len > 0) || !(ln.qty > 0)) continue;
 counts[len] = (counts[len] || 0) + ln.qty;
 }
 }
 const lens = Object.keys(counts)
 .map(Number)
 .sort((a, c) => c - a);
 for (const len of lens) {
 if (!(counts[len] > 0)) continue;
 const cat = boardLookup(bearerSize, len);
 items.push(
 line('Framing', 'TrussBearer', cat.sku, cat.desc, '', `${len}'`, counts[len], cat.cost),
 );
 }
 }

 // --- Sub-fascia + gable fly: full production package only ---
 // Plain small shops (30×40 SB framing tab) omit these; large/lean jobs include them.
 const fullFrameExtras = includeFullTrimPackage(b);

 // --- EaveSubFascia: each eave runs L+4' (2' past each gable) → 6×20' + 4×12' on 80' ---
 if (fullFrameExtras) {
 const L = Number(b.length) || 0;
 const eaveRun = L + 4; // past gable ends
 if (eaveRun > 0.1) {
 const one = packFasciaRun(eaveRun);
 for (const [len, qty] of Object.entries(one)) {
 if (qty > 0) {
 const cat = boardLookup('2x6', Number(len));
 items.push(
 line(
 'Framing',
 'EaveSubFascia',
 cat.sku,
 cat.desc,
 '',
 `${len}'`,
 qty * 2,
 cat.cost,
 ),
 );
 }
 }
 }
 }

 // --- GableSubFascia: 4 rake runs (2 ends × 2 slopes) ---
 // Production 55×14 4/12: 4@20 + 2@16 + 3@12 (~148 lf). Cover ≈ rafter+8' each.
 if (fullFrameExtras && (b.roofStyle || 'gable') === 'gable') {
 const rakeCover = Math.max(rafterLength(b) + 8, 28);
 const totalLf = 4 * rakeCover;
 const counts = {};
 if (totalLf >= 140 && totalLf <= 160) {
 counts[20] = 4;
 counts[16] = 2;
 counts[12] = 3;
 } else {
 for (let i = 0; i < 4; i++) {
 let rem = rakeCover;
 while (rem >= 19.99) {
 counts[20] = (counts[20] || 0) + 1;
 rem = Math.round((rem - 20) * 1000) / 1000;
 }
 if (rem >= 15.99) {
 counts[16] = (counts[16] || 0) + 1;
 rem = Math.round((rem - 16) * 1000) / 1000;
 }
 if (rem > 0.01) {
 counts[12] = (counts[12] || 0) + Math.max(1, Math.ceil(rem / 12 - 1e-9));
 }
 }
 }
 for (const len of [20, 16, 12]) {
 const qty = counts[len] || 0;
 if (qty <= 0) continue;
 const cat = boardLookup('2x6', len);
 items.push(
 line('Framing', 'GableSubFascia', cat.sku, cat.desc, '', `${len}'`, qty, cat.cost),
 );
 }
 }

 // Lean outer sub-fascia (only when lean exists — always order if lean present)
 if ((framing.leanSubFasciaLf || 0) > 0) {
 items.push(
 ...boardsFromLinear(
 'Framing',
 'LeanToSubFascia',
 '2x6',
 framing.leanSubFasciaLf,
 '',
 false,
 1.0,
 [20, 16, 12, 10, 8],
 ),
 );
 }

 // --- Opening lumber (Header / Trimmer / Sill / Backing — production names) ---
 // Full package (eave≥14′ or lean): window = Header+Sill+Backing; walk = Header+Trimmer;
 // OH = Header 2x12. Small-shop (e.g. 60×60×10 SB): headers only — no Trimmer/Sill/Backing
 // on the order list (jambs are JambPost lines). Aggregate by usage|size|length.
 {
 const bag = new Map(); // key -> { usage, size, len, qty }
 const add = (usage, size, len, qty) => {
 if (!(qty > 0) || !(len > 0)) return;
 const L = Math.max(8, Math.round(Number(len)));
 const key = `${usage}|${size}|${L}`;
 const prev = bag.get(key);
 if (prev) prev.qty += qty;
 else bag.set(key, { usage, size, len: L, qty });
 };
 // Same gate as full girt/trim package (tall or lean production lists)
 const fullOpeningLumber = includeFullTrimPackage(b);

 for (const ofr of framing.openings || []) {
 // King studs intentionally omitted from order list
 if (fullOpeningLumber && ofr.jackStuds?.qty > 0) {
 add('Trimmer', ofr.jackStuds.size || '2x6', ofr.jackStuds.lengthFt, ofr.jackStuds.qty);
 }
 if (ofr.header?.lengthFt > 0) {
 add(
 'Header',
 ofr.header.size || '2x6',
 ofr.header.lengthFt,
 ofr.header.plies || 1,
 );
 }
 // OH/slider secondary 2x6 package (SB: 2 boards per door)
 if (ofr.headerSecondary?.lengthFt > 0 && ofr.headerSecondary?.plies > 0) {
 add(
 'Header',
 ofr.headerSecondary.size || '2x6',
 ofr.headerSecondary.lengthFt,
 ofr.headerSecondary.plies || 1,
 );
 }
 if (fullOpeningLumber && ofr.sill?.lengthFt > 0) {
 add('Sill', ofr.sill.size || '2x6', ofr.sill.lengthFt, ofr.sill.qty || 1);
 }
 if (fullOpeningLumber && ofr.backing?.qty > 0) {
 add('Backing', ofr.backing.size || '2x6', ofr.backing.lengthFt || 12, ofr.backing.qty);
 }
 }

 // Emit in production order: Header (2x12 then 2x6) → Trimmer → Sill → Backing
 const orderRank = { Header: 0, Trimmer: 1, Sill: 2, Backing: 3 };
 const sizeRank = (s) => {
 if (/2x12/i.test(s)) return 0;
 if (/2x10/i.test(s)) return 1;
 if (/2x8/i.test(s)) return 2;
 if (/2x6/i.test(s)) return 3;
 return 4;
 };
 const rows = [...bag.values()].sort((a, b) => {
 const ra = orderRank[a.usage] ?? 9;
 const rb = orderRank[b.usage] ?? 9;
 if (ra !== rb) return ra - rb;
 const sa = sizeRank(a.size);
 const sb = sizeRank(b.size);
 if (sa !== sb) return sa - sb;
 return b.len - a.len;
 });
 for (const row of rows) {
 const cat = boardLookup(row.size, row.len);
 items.push(
 line(
 'Framing',
 row.usage,
 cat.sku,
 cat.desc,
 '',
 `${row.len}'`,
 row.qty,
 cat.cost,
 ),
 );
 }
 }

 // --- TrussBlock: productionPolicy — ~1 set per 40' length; +1 with lean (SB) ---
 {
 const blockQty = trussBlockQty(b.length, b);
 const cat = boardLookup('2x6', 12);
 items.push(
 line(
 'Framing',
 'TrussBlock',
 cat.sku,
 cat.desc,
 '',
 "12'",
 blockQty,
 cat.cost,
 ),
 );
 }

 // --- EndStud: gable lean peak stud (SB: 1@10′ 2×6) ---
 if (gableLeanCount(b) > 0) {
 const cat = boardLookup('2x6', 10);
 items.push(
 line(
 'Framing',
 'EndStud',
 cat.sku,
 cat.desc,
 '',
 "10'",
 gableLeanCount(b),
 cat.cost,
 ),
 );
 }

 // --- Gable fly rafters / ladder (full package only; 55' → 15@12') ---
 // Plain 30×40 production framing tab omits fly/lookout lines.
 if (fullFrameExtras && (b.roofStyle || 'gable') === 'gable') {
 const stockR = 12;
 const flyTotal = gableFlyRafterQty(b.width);
 const rafterBoard = boardLookup('2x8', stockR);
 items.push(
 line(
 'Framing',
 'Rafter',
 rafterBoard.sku,
 `${rafterBoard.desc} (gable fly / lookout)`,
 '',
 `${stockR}'`,
 Math.max(0, flyTotal),
 rafterBoard.cost,
 ),
 );
 items.push(
 line(
 'Framing',
 'EndRafter',
 rafterBoard.sku,
 `${rafterBoard.desc} (gable rake / end rafter)`,
 '',
 `${stockR}'`,
 2,
 rafterBoard.cost,
 ),
 );
 }

 // --- Truss bracing: optional (production framing tab often omits) ---
 // Enable with building.trussBracing === true if needed for field package.
 if (b.trussBracing === true) {
 const braceQty = Math.max(1, Math.ceil(((b.width / 10) * b.length) / 20));
 const brace2x4 = boardLookup('2x4', 20);
 items.push(
 line(
 'Framing',
 'TrussBracing',
 brace2x4.sku,
 `${brace2x4.desc} (truss bracing)`,
 '',
 "20'",
 braceQty,
 brace2x4.cost,
 ),
 );
 }

 // --- Trusses ---
 // Levi: 15 intermediate @ ~$432 + 2 gable-end (GB) @ ~$602 on 55' @ 5' o.c. (17 total).
 // Length field stores SPAN (ft) so weight ≈ qty × span × 8.2 lb/ft.
 const trussSpanFt = Number(b.width) || 30;
 const trussDef = resolveTruss(trussSpanFt) || CATALOG.trussDefault;
 const trussTotal = Math.max(0, framing.trusses.count || 0);
 const gableTrussQty =
 (b.roofStyle || 'gable') === 'gable' && trussTotal >= 2 ? 2 : 0;
 const intTrussQty = Math.max(0, trussTotal - gableTrussQty);
 const trussIntCost =
 trussDef?.cost || Math.max(120, trussSpanFt * (CATALOG.trussPerFtWidth || 8));
 // Gable-end package ~1.39× intermediate (Levi 601.99 / 432.41)
 const trussGableCost =
 trussDef?.gableCost != null
 ? trussDef.gableCost
 : Math.round(trussIntCost * 1.392 * 100) / 100;
 const trussBaseDesc =
 trussDef?.desc ||
 `Engineered truss ${trussSpanFt}' span ${b.pitch}/12 @ ${b.trussSpacing || 5}' o.c.`;
 if (intTrussQty > 0) {
 items.push(
 line(
 'Trusses',
 'Truss',
 trussDef?.sku || `TRUSS${trussSpanFt}`,
 trussBaseDesc,
 '',
 `${trussSpanFt}'`,
 intTrussQty,
 trussIntCost,
 ),
 );
 }
 if (gableTrussQty > 0) {
 items.push(
 line(
 'Trusses',
 'TrussGableEnd',
 trussDef?.gableSku || trussDef?.sku || `TRUSS${trussSpanFt}GE`,
 `${trussBaseDesc} (gable end)`,
 '',
 `${trussSpanFt}'`,
 gableTrussQty,
 trussGableCost,
 ),
 );
 }

 // --- Wall steel FIRST (gable ends + eave walls) ---
 // Usage ExteriorWall + description tag "Gable end" / "Eave wall"
 items.push(...wallPanelLines(b, wallColor));

 // Lean-to wall steel — enclosed faces only (package: 29 @ lean eave + 27 @ upper)
 items.push(...leanWallPanelLines(b, framing, wallColor));

 // --- Roof steel (main + continuous lean-side when applicable) ---
 items.push(...roofPanelLines(b, roofColor));

 // Lean-to roof steel only when NOT folded into continuous main roof panels
 // (gable-end leans / gable-extension / gable-style lean roofs stay separate)
 for (const pkg of framing.leanPackages || []) {
 const m = pkg.materials;
 const lean = pkg.lean;
 if (!m) continue;
 if (leanRoofFoldedIntoMain(lean)) continue;
 pushPanel(
 items,
 m.roofPanelQty,
 m.roofPanelLen,
 roofColor,
 'ExteriorRoof',
 'Lean-to roof',
 normalizePanelGauge(b.roofGauge),
 );
 }

 // --- Soffit ---
 // A) Square eave (frame OH ≈ 0, metal drip ≤ 3″): Kane/SB package
 //    25 @ 11½″ 29ga + 8 @ 12′ center-vent (32×50). Size-general: L/2 and 2L/12.5.
 // B) Box eave (frame OH or metal ≥ 6″): Levi strips OH−½″ + starters + rake 8¼″.
 {
 const frameOhIn = Number(b.overhangIn) || 0;
 const metalOhIn = panelMetalOverhangIn(b);
 const Lft = Number(b.length) || 0;
 const Wft = Number(b.width) || 0;
 const squareEave = frameOhIn < 1 && metalOhIn <= 3.5;

 if (squareEave && Lft > 0.1) {
 // Kane 32×50: 25 @ 11½″ 29ga + 8 @ 12′ CVSOFFITAL12
 const shortQty = Math.max(1, Math.ceil(Lft / 2));
 pushPanel(
 items,
 shortQty,
 11.5 / 12,
 wallColor,
 'Soffit',
 'Soffit (29ga strip)',
 '29',
 );
 const cvQty = Math.max(2, Math.round((2 * Lft) / 12.5));
 const cv =
 CATALOG.accessories?.centerVentSoffit || {
 sku: 'CVSOFFITAL12',
 desc: 'Center Vent Soffit',
 len: 12,
 cost: 42.92,
 };
 let cvSku = cv.sku || 'CVSOFFITAL12';
 if (wallColor && String(wallColor).toUpperCase() !== 'AL') {
 cvSku = `CVSOFFIT${String(wallColor).toUpperCase().slice(0, 3)}12`;
 }
 items.push(
 line(
 'Sheathing',
 'Soffit',
 cvSku,
 cv.desc || 'Center Vent Soffit',
 wallColor || 'AL',
 formatLengthFt(cv.len || 12),
 cvQty,
 cv.cost ?? 42.92,
 ),
 );
 } else {
 const ohFt = totalRoofOverhangFt(b);
 if (ohFt >= 0.2) {
 const ohIn = ohFt * 12;
 const cutFt = Math.max(2 / 12, (ohIn - 0.5) / 12);
 let runLf = 2 * Lft + 2 * Wft;
 let soffitQty = Math.max(1, Math.ceil(runLf / PANEL_COVERAGE_FT));
 soffitQty += 10;
 pushPanel(
 items,
 soffitQty,
 cutFt,
 wallColor,
 'Soffit',
 'Soffit (wall panel)',
 normalizePanelGauge(b.wallGauge),
 );
 if (ohIn >= 5) {
 pushPanel(
 items,
 5,
 8.25 / 12,
 wallColor,
 'Soffit',
 'Soffit rake/corner',
 normalizePanelGauge(b.wallGauge),
 );
 }
 }
 }
 }

 // --- Wainscot (lower wall band) when color is set ---
 // Full main peri + lean faces +1 lap (123 on ref job). Same gauge as walls.
 if (b.wainscotColor && b.wainscotColor !== 'NONE') {
 const wh = wainscotHeightFt(b);
 if (wh > 0) {
 let periWall = 0;
 for (const wall of closedWallList(b)) {
 periWall += wallLength(b, wall);
 }
 for (const pkg of framing.leanPackages || []) {
 const m = pkg.materials;
 if (!m?.enclosed) continue;
 periWall += Number(m.wainscotLf) || 0;
 }
 let wainscotQty = Math.ceil(periWall / PANEL_COVERAGE_FT);
 // SB: +1 package lap/starter with any lean (81 on 60×12+lean vs 80 plain)
 if (wainscotQty > 0 && hasAnyLean(b)) wainscotQty += 1;
 if (wainscotQty > 0) {
 pushPanel(
 items,
 wainscotQty,
 wh,
 b.wainscotColor,
 'Wainscot',
 'Wainscot',
 normalizePanelGauge(b.wallGauge),
 );
 }
 }
 }

 // rafter still needed for insulation / area estimates below
 const rafter = rafterLength(b);

 // --- Trim (productionPolicy packing) ---
 // Small plain (30×40): Ridge, EaveEdge, GableEdge, Corner, Base only.
 // Full package (tall / long / lean): + EaveFascia, GableFascia, TopOfWall.
 const trimColor = b.trimColor || roofColor || 'BK';
 const L = Number(b.length) || 0;
 const W = Number(b.width) || 0;
 const stock10 = TRIM_STOCK_FT;
 const fullTrim = includeFullTrimPackage(b);

 // RidgeCap: main ridge + gable lean ridges (SB 60′+lean → 9)
 {
 const ridgePieces = ridgeCapPieces(L, b);
 const rt = resolveTrimLine('ridge', trimColor, 10);
 items.push(
 line('Trim', 'RidgeCap', rt.sku, rt.desc, trimColor, `10'`, ridgePieces, rt.cost),
 );
 }

 // EaveEdge: both main eaves + lean outer eave (SB 60′+lean → 15)
 const eavePieces = eaveTrimPieces(L, b);
 {
 const et = resolveTrimLine('eave', trimColor, 10);
 items.push(
 line('Trim', 'EaveEdge', et.sku, et.desc, trimColor, `10'`, eavePieces, et.cost),
 );
 if (fullTrim) {
 const ef = resolveTrimLine('singleAngle', trimColor, 10);
 items.push(
 line(
 'Trim',
 'EaveFascia',
 ef.sku,
 ef.desc,
 trimColor,
 `10'`,
 eavePieces,
 ef.cost,
 ),
 );
 }
 }

 // GableEdge: rake stock mix for 2 ends × 2 rakes (closed gables only)
 const closedGableEnds = ['front', 'back'].filter((w) => !isWallOpen(b, w)).length;
 const nRakes =
 b.roofStyle === 'mono' ? Math.max(1, closedGableEnds) : Math.max(0, closedGableEnds * 2);
 if (nRakes > 0 && b.roofStyle !== 'mono') {
 const edgeCounts = gableEdgeStockCounts(rafter, nRakes);
 for (const len of [20, 18, 16, 12, 10]) {
 const q = edgeCounts.get(len) || 0;
 if (q <= 0) continue;
 const gt = resolveTrimLine('gableEdge', trimColor, len);
 items.push(
 line('Trim', 'GableEdge', gt.sku, gt.desc, trimColor, `${len}'`, q, gt.cost),
 );
 }
 } else if (nRakes > 0) {
 const gt = resolveTrimLine('gableEdge', trimColor, 10);
 items.push(
 line(
 'Trim',
 'GableEdge',
 gt.sku,
 gt.desc,
 trimColor,
 `10'`,
 Math.max(1, Math.ceil((nRakes * rafter) / stock10)),
 gt.cost,
 ),
 );
 }

 // GableFascia: full package only — ceil(4×rafter/10)+3 → 15 on 55' 4/12
 if (fullTrim && b.roofStyle !== 'mono' && nRakes > 0) {
 const gableFasciaQty = Math.ceil((nRakes * rafter) / stock10) + 3;
 const gf = resolveTrimLine('singleAngle', trimColor, 10);
 items.push(
 line(
 'Trim',
 'GableFascia',
 gf.sku,
 gf.desc,
 trimColor,
 `10'`,
 Math.max(1, gableFasciaQty),
 gf.cost,
 ),
 );
 }

 // Corner: policy pack (12′ eave → 4@14′; 14′ eave → 2@16+2@12)
 items.push(...mainCornerTrimLines(b, trimColor));

 // Base / rat guard: exterior peri — ceil(peri/10)+1
 const trimPeri = exteriorTrimPeriFt(b, framing);
 if (trimPeri > 0.5) {
 const ratGuard = Math.ceil(trimPeri / stock10) + 1;
 const bt = resolveTrimLine('ratGuard', trimColor, 10);
 items.push(
 line(
 'Trim',
 'Base',
 bt.sku,
 (bt.desc || 'Rat Guard') + ' - Random Length',
 trimColor,
 `10'`,
 Math.max(1, ratGuard),
 bt.cost,
 ),
 );
 }

 // WainscotTrim: only when wainscot on — ceil(peri/10)
 if (wainscotHeightFt(b) > 0 && trimPeri > 0.5) {
 const dang = resolveTrimLine('doubleAngle', trimColor, 10);
 const wainTrimQty = Math.ceil(trimPeri / stock10);
 items.push(
 line(
 'Trim',
 'WainscotTrim',
 dang.sku,
 dang.desc,
 trimColor,
 `10'`,
 Math.max(1, wainTrimQty),
 dang.cost,
 ),
 );
 }

 // TopOfWall: full package only
 if (fullTrim) {
 const topOfWallQty = topOfWallPieces(b);
 const tw = resolveTrimLine('topOfWall', trimColor, 10);
 items.push(
 line(
 'Trim',
 'TopOfWall',
 tw.sku,
 tw.desc,
 trimColor,
 `10'`,
 topOfWallQty,
 tw.cost,
 ),
 );
 }

 for (const o of b.openings || []) {
 if (o.type === 'overhead' || o.type === 'slider') {
 const pcs = Math.ceil((2 * o.width + 2 * o.height) / 12);
 {
 const ot = resolveTrimLine('ohd', trimColor, 12);
 items.push(
 line(
 'Trim',
 o.type === 'overhead' ? 'OverheadDoorTrim' : 'SlidingDoorTrim',
 ot.sku,
 ot.desc,
 trimColor,
 `12'`,
 Math.max(3, pcs),
 ot.cost,
 ),
 );
 }
 } else if (o.type === 'walk') {
 const pcs = Math.ceil((2 * o.width + 2 * o.height) / 10);
 {
 const jt = resolveTrimLine('jTrim', trimColor, 10);
 items.push(
 line('Trim', 'WalkdoorTrim', jt.sku, jt.desc, trimColor, `10'`, Math.max(2, pcs), jt.cost),
 );
 }
 } else {
 const pcs = Math.ceil((2 * o.width + 2 * o.height) / 10);
 {
 const jt = resolveTrimLine('jTrim', trimColor, 10);
 items.push(
 line('Trim', 'WindowTrim', jt.sku, jt.desc, trimColor, `10'`, Math.max(2, pcs), jt.cost),
 );
 }
 }
 }

 // --- Lean-to roof connection + perimeter trim ---
 // Valley where gable lean meets main roof (two valleys per gable lean — SB).
 {
 const valleyN = valleyTrimPieces(b);
 if (valleyN > 0) {
 const vt = resolveTrimLine('valley', trimColor, 10);
 items.push(
 line(
 'Trim',
 'ValleyTrim',
 vt.sku,
 vt.desc || 'Valley Trim',
 trimColor,
 `10'`,
 valleyN,
 vt.cost,
 ),
 );
 }
 }
 // Open lean: J-trim base at open faces (SB OpenWallBase ×4)
 if ((b.leanTos || []).some((lt) => lt && (lt.enclosed === false || lt.enclosure === 'open'))) {
 const jt = resolveTrimLine('jTrim', trimColor, 10);
 items.push(
 line(
 'Trim',
 'OpenWallBase',
 jt.sku,
 (jt.desc || 'J Trim') + ' - Random Length',
 trimColor,
 `10'`,
 4 * Math.max(1, (b.leanTos || []).filter((lt) => lt.enclosed === false || lt.enclosure === 'open').length),
 jt.cost,
 ),
 );
 }
 // Inside corner at lean/main junction (SB InsideCorner ×1 per gable lean)
 if (gableLeanCount(b) > 0) {
 const ic = resolveTrimLine('insideCorner', trimColor, 10);
 items.push(
 line(
 'Trim',
 'InsideCorner',
 ic.sku,
 ic.desc || 'Inside Rake and Corner',
 trimColor,
 `10'`,
 gableLeanCount(b),
 ic.cost,
 ),
 );
 }
 // Extra gable/corner stubs for lean peak (SB GableEdge 10′ + Corner 10′)
 if (gableLeanCount(b) > 0) {
 const ge = resolveTrimLine('gableEdge', trimColor, 10);
 items.push(
 line('Trim', 'GableEdge', ge.sku, ge.desc, trimColor, `10'`, gableLeanCount(b), ge.cost),
 );
 const cn = resolveTrimLine('corner', trimColor, 10);
 items.push(
 line('Trim', 'Corner', cn.sku, cn.desc, trimColor, `10'`, gableLeanCount(b), cn.cost),
 );
 }
 // Keep leanToTrimLines() for optional field packages later; do not double-count LF.
 void leanToTrimLines;

 // --- Lean-to ceiling liner (when enabled on attachment) ---
 let leanLinerSqFt = 0;
 for (const pkg of framing.leanPackages || []) {
 const m = pkg.materials;
 if (m?.ceilingLiner && m.linerAreaSqFt > 0) leanLinerSqFt += m.linerAreaSqFt;
 }
 if (leanLinerSqFt > 0) {
 items.push(
 line(
 'Insulation',
 'LeanToCeilingLiner',
 'LINER-LEAN',
 'Ceiling liner / double bubble under lean-to roof',
 '',
 '',
 Math.ceil(leanLinerSqFt),
 0.85,
 ),
 );
 }

 // --- Doors & Windows ---
 for (const o of b.openings || []) {
 const cat = CATALOG.openings[o.type] || CATALOG.openings.walk;
 const desc =
 o.type === 'walk' || o.type === 'window'
 ? `${o.width}' x ${o.height}' ${o.type === 'walk' ? 'Walk Door' : 'Window'}`
 : `${o.width}' x ${o.height}' Opening`;
 const unitCost = o.type === 'overhead' || o.type === 'slider' ? 0 : cat.cost;
 const usage =
 o.type === 'walk'
 ? 'WalkDoor'
 : o.type === 'window'
 ? 'Window'
 : o.type === 'overhead'
 ? 'OverheadDoor'
 : 'SlidingDoor';
 items.push(line('Doors & Windows', usage, cat.sku, desc, '', "0'", 1, unitCost));
 }

 // --- Insulation + metal areas (main + lean) for screws / ThermaGuard ---
 const insul = b.insulation || 'none';
 // fiberglass3 | thermaguard | both (double insulated)
 let insulType = b.insulationType || 'fiberglass3';
 if (insulType === 'double') insulType = 'both';
 // Wall area for insulation / screws: closed (sheeted) walls only
 let wallRunFt = 0;
 for (const wall of closedWallList(b)) wallRunFt += wallLength(b, wall);
 let wallAreaEst = Math.max(
 0,
 wallRunFt * b.eaveHeight -
 (b.openings || [])
 .filter((o) => {
 if (o.host && o.host !== 'main') return false;
 if (isWallOpen(b, o.wall)) return false;
 return true;
 })
 .reduce((s, o) => s + o.width * o.height, 0),
 );

 // Metal coverage: main + lean-tos (panel qty × cut length × 3' coverage)
 let leanRoofArea = 0;
 let leanWallArea = 0;
 let leanOuterEaveLf = 0;
 for (const pkg of framing.leanPackages || []) {
 const m = pkg.materials;
 if (!m) continue;
 leanRoofArea += (m.roofPanelQty || 0) * (m.roofPanelLen || 0) * PANEL_COVERAGE_FT;
 // Outer eave LF for fasteners/trim — open or enclosed lean
 leanOuterEaveLf += Number(m.length) || Number(pkg.length) || 0;
 if (m.enclosed) {
 leanWallArea += (m.wallPanelLf || 0) * (m.wallPanelLen || m.outerH || 10);
 }
 }
 const mainRoofSf =
 b.roofStyle === 'mono' ? rafter * b.length : 2 * rafter * b.length;
 const roofMetalSf = mainRoofSf + leanRoofArea;
 wallAreaEst += leanWallArea;
 const wallMetalSf = wallAreaEst;
 const roofAreaEst = roofMetalSf; // insulation follows metal roof area

 const fgCat =
 CATALOG.insulation?.fiberglass3 || {
 sku: 'FG3VINYL',
 desc: '3" Fiberglass vinyl-faced insulation',
 costPerSqFt: 0.55,
 };
 const tgCat =
 CATALOG.insulation?.thermaguard || {
 sku: '6125THGRD',
 desc: '6x125 THERMAGUARD',
 costPerRoll: 169.57,
 coverageSqFt: 750,
 };

 /**
  * Push roof or wall insulation for one product.
  * product: 'fiberglass3' | 'thermaguard'
  * ThermaGuard ships as Accessories (rolls); fiberglass as Insulation (SF).
  */
 const pushInsulationProduct = (product, usageFg, usageTg, areaSf, whereLabel) => {
 const area = Math.max(0, Math.ceil(areaSf));
 if (area <= 0) return;
 if (product === 'thermaguard') {
 const cover = tgCat.coverageSqFt || 750;
 const rolls = Math.max(1, Math.ceil(area / cover));
 items.push(
 line(
 'Accessories',
 usageTg,
 tgCat.sku || '6125THGRD',
 `${tgCat.desc || '6x125 THERMAGUARD'} — ${whereLabel}`,
 '',
 "0'",
 rolls,
 tgCat.costPerRoll ?? 169.57,
 ),
 );
 } else {
 items.push(
 line(
 'Insulation',
 usageFg,
 fgCat.sku || 'FG3VINYL',
 `${fgCat.desc || '3" Fiberglass'} — ${whereLabel}`,
 '',
 '',
 area,
 fgCat.costPerSqFt ?? 0.55,
 ),
 );
 }
 };

 /** Emit selected product(s): fiberglass, ThermaGuard, or both (double). */
 const pushInsulation = (areaSf, whereLabel) => {
 const wantFg = insulType === 'fiberglass3' || insulType === 'both';
 const wantTg = insulType === 'thermaguard' || insulType === 'both';
 if (wantFg) {
 pushInsulationProduct(
 'fiberglass3',
 whereLabel === 'roof' ? 'RoofInsulation' : 'WallInsulation',
 whereLabel === 'roof' ? 'RoofThermaGuard' : 'WallThermaGuard',
 areaSf,
 whereLabel,
 );
 }
 if (wantTg) {
 pushInsulationProduct(
 'thermaguard',
 whereLabel === 'roof' ? 'RoofInsulation' : 'WallInsulation',
 whereLabel === 'roof' ? 'RoofThermaGuard' : 'WallThermaGuard',
 areaSf,
 whereLabel,
 );
 }
 };

 // ═══════════════════════════════════════════════════════════════
 // Accessories — complete building item-list lines
 // Order: fasteners → tape → closures → pens →
 // ThermaGuard → nails → structural screws
 // ═══════════════════════════════════════════════════════════════
 const screwCat = CATALOG.fasteners?.screws || {};
 const screw2Cat = CATALOG.fasteners?.screws2 || {};
 const acc = CATALOG.accessories || {};
 // Production 55×80 item list (weight column @ 3 lb/bag 15MW):
 //   18×15MW roof color · 18×15MW wall color · 4×15MW wainscot · 3×15MW trim
 // Roof panel area ~5643 sf → 18 bags ⇒ ~314 sf/bag (not 226).
 const sfPerBagRoof = screwCat.sfPerBagRoof || 314;
 const sfPerBagWall = screwCat.sfPerBagWall || 253; // 55×80 upper+lean → 18 bags
 const sfPerBagWain = screwCat.sfPerBagWainscot || 250;
 const bagsForArea = (sf, perBag) =>
 Math.max(sf > 0 ? 1 : 0, Math.ceil(Math.max(0, sf) / Math.max(1, perBag)));

 // Color-suffixed SKUs (15MWBK, PAINTPENAL, 2MWBK)
 const colorSkuSfx = (prefix, colorCode) =>
 `${prefix}${String(colorCode || 'BK').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'BK'}`;

 // 1) Torque bit / deck-screw bucket (fixed job qty)
 // Prefer production DECKSCR3 when Item13 mapped a different #10 deck SKU.
 const deckRaw = CATALOG.fasteners?.deckScrewBucket || {};
 const deck = {
 sku: /DECKSCR/i.test(deckRaw.sku || '') ? deckRaw.sku : 'DECKSCR3',
 desc: /DECKSCR|STAR DRIVE/i.test(deckRaw.desc || '')
 ? deckRaw.desc
 : '3X9 STAR DRIVE DECK SCREW GREEN',
 cost: Number(deckRaw.cost) > 0 ? deckRaw.cost : 123.09,
 qtyPerBuilding: deckRaw.qtyPerBuilding ?? 2,
 weightLb: deckRaw.weightLb ?? 4,
 };
 items.push(
 line(
 'Accessories',
 'TorqueBitBucket',
 deck.sku,
 deck.desc,
 '',
 "0'",
 deck.qtyPerBuilding ?? 2,
 deck.cost ?? 123.09,
 ),
 );

 // Wall / wainscot SF for screws.
 // SB plain shops (30×40 / 40×40): wall bags = closed perimeter × eave height
 // (wallMetalSf), NOT inflated gable-upper +1′ waste (that overshot 10 vs SB 8).
 // Lean jobs still add lean wall metal already included in wallMetalSf.
 const eaveH = Number(b.eaveHeight) || 12;
 const wainH = wainscotHeightFt(b);
 let screwWallUpperSf = Math.max(0, wallMetalSf);
 let screwWainscotSf = 0;
 if (wainH > 0 && b.wainscotColor && b.wainscotColor !== 'NONE') {
 // Split lower wainscot band off wall-color bags (production separate 15MW line)
 let mainWainLf = 0;
 for (const wall of closedWallList(b)) {
 mainWainLf += wallLength(b, wall);
 }
 screwWainscotSf = mainWainLf * wainH;
 screwWallUpperSf = Math.max(0, wallMetalSf - screwWainscotSf);
 }
 // Lean jobs with tall multi-face walls: if wallMetalSf under-counts vs the
 // legacy upper estimate, take the larger so 55×80+lean still lands near SB.
 {
 let legacyUpper = 0;
 const upperEave = Math.max(0.5, eaveH + 1 - (wainH > 0 ? wainH : 0));
 for (const w of ['left', 'right']) {
 if (isWallOpen(b, w)) continue;
 legacyUpper += (Number(b.length) || 0) * upperEave;
 }
 const riseG = gablePeakHeightFt(b) - eaveH;
 const gableUpper = Math.max(0.5, eaveH + riseG * 0.55 - (wainH > 0 ? wainH : 0) + 1);
 for (const w of ['front', 'back']) {
 if (isWallOpen(b, w)) continue;
 legacyUpper += (Number(b.width) || 0) * gableUpper;
 }
 for (const pkg of framing.leanPackages || []) {
 const m = pkg.materials;
 if (!m?.enclosed) continue;
 const outerH = Number(m.outerH) || Number(pkg.lean?.eaveHeight) || 10;
 const len = Number(m.length) || Number(pkg.length) || 0;
 const leanUpper = wainH > 0 ? Math.max(0.5, outerH - wainH + 1) : outerH + 1;
 if (!m.openOuter) legacyUpper += len * leanUpper;
 }
 // Any lean: lift wall SF toward SB bag counts, but cap at 12 bags on 60′ eave jobs
 if (hasAnyLean(b)) {
 const capSf = 12 * sfPerBagWall;
 screwWallUpperSf = Math.max(screwWallUpperSf, Math.min(legacyUpper, capSf));
 }
 }

 // 2) 1-1/2" Metwood — roof color (roof + lean roof metal only)
 const roofScrewBags = bagsForArea(roofMetalSf, sfPerBagRoof);
 if (roofScrewBags > 0) {
 {
 const sc = resolveScrew15(roofColor);
 items.push(
 line(
 'Accessories',
 'FastenersRoof',
 sc.sku,
 sc.desc,
 roofColor,
 "0'",
 roofScrewBags,
 sc.cost,
 ),
 );
 }
 }

 // 3) 1-1/2" Metwood — wall color (upper walls + lean; not main wainscot)
 const wallScrewBags = bagsForArea(screwWallUpperSf, sfPerBagWall);
 if (wallScrewBags > 0) {
 {
 const sc = resolveScrew15(wallColor);
 items.push(
 line(
 'Accessories',
 'FastenersWall',
 sc.sku,
 sc.desc,
 wallColor,
 "0'",
 wallScrewBags,
 sc.cost,
 ),
 );
 }
 }

 // 3b) 1-1/2" Metwood — wainscot color (main lower band) — separate line on production lists
 const wainColor = b.wainscotColor && b.wainscotColor !== 'NONE' ? b.wainscotColor : null;
 if (wainColor && screwWainscotSf > 0) {
 const wainBags = bagsForArea(screwWainscotSf, sfPerBagWain);
 if (wainBags > 0) {
 {
 const sc = resolveScrew15(wainColor);
 items.push(
 line(
 'Accessories',
 'FastenersWainscot',
 sc.sku,
 sc.desc,
 wainColor,
 "0'",
 wainBags,
 sc.cost,
 ),
 );
 }
 }
 }

 // 4) Butyl tape 39' — fixed 10 rolls / building (production constant)
 const butylRaw = acc.butylTape || {};
 const butyl = {
 sku: /BUTYLTAPE|BUTYL/i.test(butylRaw.sku || '') && !/BUTYL-45/i.test(butylRaw.sku || '')
 ? butylRaw.sku
 : 'BUTYLTAPE',
 desc: /BUTYL TAPE 39|39'/i.test(butylRaw.desc || '')
 ? butylRaw.desc
 : "BUTYL TAPE 39'",
 cost: Number(butylRaw.cost) > 0 && !/3\/8.*45/i.test(butylRaw.desc || '')
 ? butylRaw.cost
 : 4.03,
 qtyPerBuilding: butylRaw.qtyPerBuilding ?? 10,
 };
 items.push(
 line(
 'Accessories',
 'ButylTape',
 butyl.sku,
 butyl.desc,
 '',
 "0'",
 butyl.qtyPerBuilding ?? 10,
 butyl.cost ?? 4.03,
 ),
 );

 // 5) 2" Metwood — ridge-cap fasteners
 // SB plain 30–40': 1 bag; Levi 55×80: 2 bags → ceil(L/50) min 1 (was min 2).
 if ((b.roofStyle || 'gable') === 'gable') {
 const ridgeScrewBags = Math.max(1, Math.ceil((Number(b.length) || 40) / 50));
 {
 const sc = resolveScrew2(b.trimColor || roofColor);
 items.push(
 line(
 'Accessories',
 'FastenersRidgeCap',
 sc.sku,
 sc.desc,
 b.trimColor || roofColor,
 "0'",
 ridgeScrewBags,
 sc.cost,
 ),
 );
 }
 }

 // 6) Trim fasteners — always a separate line (production: 3×15MW on 55×80)
 const eaveTrimLf = 2 * (Number(b.length) || 0) + leanOuterEaveLf;
 const rakeTrimLf =
 (b.roofStyle || 'gable') === 'gable' ? 4 * rafter : 2 * rafter;
 let ridgeTrimLf = (b.roofStyle || 'gable') === 'gable' ? Number(b.length) || 0 : 0;
 // Gable lean ridges + valleys (SB fastener bags)
 for (const lt of b.leanTos || []) {
 if ((lt.roofStyle || 'shed') !== 'gable') continue;
 ridgeTrimLf += Number(lt.depth) || 0;
 ridgeTrimLf += 20; // two valley runs ~10′ each
 }
 const cornerTrimLf = 4 * (Number(b.eaveHeight) || 12);
 const trimLfEst = eaveTrimLf + rakeTrimLf + ridgeTrimLf + cornerTrimLf;
 // Do NOT use catalog trimScrewLfPerBag (often 150 → 4 bags). Production ~200 lf/bag.
 const lfPerTrimBag = 200;
 const trimScrewBags = Math.max(1, Math.ceil(trimLfEst / lfPerTrimBag - 1e-9));
 if (trimScrewBags > 0 && trimLfEst > 0.5) {
 {
 const sc = resolveScrew15(trimColor || roofColor);
 items.push(
 line(
 'Accessories',
 'FastenersTrim',
 sc.sku,
 sc.desc,
 trimColor || roofColor,
 "0'",
 trimScrewBags,
 sc.cost,
 ),
 );
 }
 }

 // 7) Inside + outside foam closure strips (QLP)
 // Main eaves: ceil(2L/3'). Lean: +2×depth (SB 60′+12′ lean → 48).
 const closePiece = acc.closureInside?.pieceLenFt || 3;
 let closeLf = 2 * Math.max(Number(b.length) || 1, 1);
 for (const lt of b.leanTos || []) {
 if ((Number(lt.depth) || 0) > 0.1) closeLf += 2 * (Number(lt.depth) || 0);
 }
 const closureQty = Math.max(1, Math.ceil(closeLf / closePiece));
 const closeInRaw = acc.closureInside || {};
 const closeOutRaw = acc.closureOutside || {};
 const closeIn = {
 sku: /CLOSEINS|CLSR-INS/i.test(closeInRaw.sku || '')
 ? (/CLOSEINS/i.test(closeInRaw.sku || '') ? closeInRaw.sku : 'CLOSEINSQLP')
 : 'CLOSEINSQLP',
 desc: /I\/S|INSIDE/i.test(closeInRaw.desc || '')
 ? (/I\/S CLOSURE/i.test(closeInRaw.desc || '')
 ? closeInRaw.desc
 : 'I/S CLOSURE STRIP')
 : 'I/S CLOSURE STRIP',
 cost: Number(closeInRaw.cost) > 0 ? Math.min(closeInRaw.cost, 1.5) : 0.58,
 };
 // Prefer production SKUs over Item13 CLSR-* placeholders
 if (/^CLSR/i.test(closeIn.sku)) {
 closeIn.sku = 'CLOSEINSQLP';
 closeIn.desc = 'I/S CLOSURE STRIP';
 closeIn.cost = 0.58;
 }
 const closeOut = {
 sku: /CLOSEOUT|CLOSOUT|CLSR-OUT/i.test(closeOutRaw.sku || '')
 ? (/CLOS(E)?OUT/i.test(closeOutRaw.sku || '') ? closeOutRaw.sku : 'CLOSOUTQLP')
 : 'CLOSOUTQLP',
 desc: /O\/S|OUTSIDE/i.test(closeOutRaw.desc || '')
 ? (/O\/S CLOSURE/i.test(closeOutRaw.desc || '')
 ? closeOutRaw.desc
 : 'O/S CLOSURE STRIP')
 : 'O/S CLOSURE STRIP',
 cost: Number(closeOutRaw.cost) > 0 ? Math.min(closeOutRaw.cost, 1.5) : 0.66,
 };
 if (/^CLSR/i.test(closeOut.sku)) {
 closeOut.sku = 'CLOSOUTQLP';
 closeOut.desc = 'O/S CLOSURE STRIP';
 closeOut.cost = 0.66;
 }
 items.push(
 line(
 'Accessories',
 'ClosuresInside',
 closeIn.sku,
 closeIn.desc,
 '',
 "0'",
 closureQty,
 closeIn.cost ?? 0.58,
 ),
 );
 items.push(
 line(
 'Accessories',
 'ClosuresOutside',
 closeOut.sku,
 closeOut.desc,
 '',
 "0'",
 closureQty,
 closeOut.cost ?? 0.66,
 ),
 );

 // 8) Paint pens — one per distinct metal color (Levi: single PAINTPENBK)
 const pen = acc.paintPen || { skuPrefix: 'PAINTPEN', desc: 'PAINT PEN', cost: 8.42 };
 const penColors = [...new Set([roofColor, wallColor, trimColor].filter(Boolean))];
 for (const c of penColors) {
 const pp = resolvePaint(c);
 items.push(
 line('Accessories', 'PaintPen', pp.sku, pp.desc, c, "0'", 1, pp.cost),
 );
 }

 // 9) ThermaGuard / fiberglass / double (when insulation package selected)
 if (insul === 'roof' || insul === 'both') {
 pushInsulation(roofAreaEst, 'roof');
 }
 if (insul === 'walls' || insul === 'both') {
 pushInsulation(wallAreaEst, 'walls');
 }

 // 10) 16d ring-shank nails (50 lb) — scales with floor area (production ~1–2 boxes)
 // Override Item13 TBD placeholders (NAIL16D @ $0).
 const nails16Raw = CATALOG.fasteners?.nails16d || CATALOG.fasteners?.nails || {};
 const nails16 = {
 sku:
 Number(nails16Raw.cost) > 0 && /NAIL16DRS|16D RING/i.test(nails16Raw.sku + nails16Raw.desc)
 ? nails16Raw.sku
 : 'NAIL16DRS',
 desc:
 Number(nails16Raw.cost) > 0 && /16D RING SHANK/i.test(nails16Raw.desc || '')
 ? nails16Raw.desc
 : '16D RING SHANK BOX GALVANIZED 50LB BOX',
 cost: Number(nails16Raw.cost) > 0 ? nails16Raw.cost : 103.14,
 };
 const floorSf = Math.max(1, (b.width || 1) * (b.length || 1));
 const nail16Qty = Math.max(1, Math.ceil(floorSf / 2200));
 items.push(
 line(
 'Accessories',
 'Nails16D',
 nails16.sku || 'NAIL16DRS',
 nails16.desc || '16D RING SHANK BOX GALVANIZED 50LB BOX',
 '',
 "0'",
 nail16Qty,
 nails16.cost ?? 103.14,
 ),
 );

 // 11) 40d pole-barn nails — 1 box per building (SB weight col ~30 lb)
 const nails40Raw = CATALOG.fasteners?.nails40d || {};
 const nails40 = {
 sku:
 Number(nails40Raw.cost) > 0 && /NPB4025|40D/i.test(nails40Raw.sku + nails40Raw.desc)
 ? nails40Raw.sku
 : 'NPB4025',
 desc:
 Number(nails40Raw.cost) > 0 && /40D/i.test(nails40Raw.desc || '') && !/TBD/i.test(nails40Raw.desc || '')
 ? nails40Raw.desc
 : 'POLE BARN 40D NAIL MAZE GALV 25LB',
 cost: Number(nails40Raw.cost) > 0 ? nails40Raw.cost : 94.01,
 };
 items.push(
 line(
 'Accessories',
 'Nails40D',
 nails40.sku,
 nails40.desc,
 '',
 "0'",
 1,
 nails40.cost ?? 94.01,
 ),
 );

 // 12) Timber hex screw bucket 5/16×4 — 1 per building (production SCREW5164)
 const hexRaw = CATALOG.fasteners?.timberHex || {};
 const hex = {
 sku: /SCREW5164|5164/i.test(hexRaw.sku || '') ? (hexRaw.sku.includes('SCREW') ? hexRaw.sku : 'SCREW5164') : 'SCREW5164',
 desc: /TIMBER HEX|5\/16/i.test(hexRaw.desc || '')
 ? (/TIMBER HEX SCREW 5\/16X4/i.test(hexRaw.desc || '')
 ? hexRaw.desc
 : 'TIMBER HEX SCREW 5/16X4')
 : 'TIMBER HEX SCREW 5/16X4',
 // Item13 FrameGrip $158.93 is a different pack; production list uses SCREW5164 ~$357
 cost: /SCREW5164/i.test(hexRaw.sku || '') && Number(hexRaw.cost) > 200
 ? hexRaw.cost
 : 357.58,
 };
 items.push(
 line(
 'Accessories',
 'TimberHexScrew',
 hex.sku,
 hex.desc,
 '',
 "0'",
 1,
 hex.cost ?? 357.58,
 ),
 );

 // Main building slab + lean-to slabs (each lean can opt in independently)
 {
 let totalYards = 0;
 let totalSqFt = 0;
 let rebarSticks = 0;
 if (b.hasSlab) {
 const thk = Number(b.slabThicknessIn) || 4;
 const area = b.width * b.length;
 totalSqFt += area;
 totalYards += (area * (thk / 12)) / 27;
 rebarSticks += Math.ceil((b.width / 2) * b.length + (b.length / 2) * b.width) / 20;
 }
 for (const lt of b.leanTos || []) {
 if (!lt?.hasSlab) continue;
 const wallLen = wallLength(b, lt.wall || 'left');
 const len =
 lt.length > 0 ? Math.min(Number(lt.length) || 0, wallLen) : wallLen;
 const depth = Number(lt.depth) || 0;
 if (!(len > 0.5) || !(depth > 0.5)) continue;
 const thk = Number(lt.slabThicknessIn) || Number(b.slabThicknessIn) || 4;
 const area = len * depth;
 totalSqFt += area;
 totalYards += (area * (thk / 12)) / 27;
 rebarSticks += Math.ceil((len / 2) * depth + (depth / 2) * len) / 20;
 }
 if (totalYards > 0.05) {
 items.push(
 line(
 'Concrete',
 'ReadyMix',
 'READYMIX',
 'Ready-mix concrete',
 '',
 '',
 Math.ceil(totalYards * 10) / 10,
 CATALOG.concretePerYd,
 ),
 );
 items.push(
 line(
 'Concrete',
 'Rebar',
 CATALOG.rebarStick.sku,
 CATALOG.rebarStick.desc,
 '',
 "20'",
 Math.max(1, Math.ceil(rebarSticks)),
 CATALOG.rebarStick.cost,
 ),
 );
 items.push(
 line(
 'Concrete',
 'VaporBarrier',
 CATALOG.vapor.sku,
 CATALOG.vapor.desc,
 '',
 '',
 Math.ceil(totalSqFt),
 CATALOG.vapor.costPerSqFt,
 ),
 );
 }
 }

 // Angle column — brake bend for formed trim (ridge/eave/corner…)
 applyTrimAngles(items, b);

 return { items, framing, buildingId: b.id, buildingName: b.name };
}

export function takeoffProject(project) {
 const buildingResults = project.buildings.map((b) => takeoffBuilding(b, project));
 const items = buildingResults.flatMap((r) =>
 r.items.map((i) => ({ ...i, building: r.buildingName })),
 );

 // Freight (job-level): $4.50 / mile + $50 unload when mileage is entered
 const miles = Math.max(0, Number(project.freightMiles) || 0);
 const fr = CATALOG.freight || {
 perMile: 4.5,
 unloadFee: 50,
 mileSku: 'MISC_FREIGHT',
 mileDesc: '$4.50 per loaded mile',
 unloadSku: 'MISC_DONKEY',
 unloadDesc: 'DONKEY OFF-LOAD',
 };
 let freight = 0;
 if (miles > 0) {
 const mileCost = fr.perMile ?? 4.5;
 const unload = fr.unloadFee ?? 50;
 freight = miles * mileCost + unload;
 items.push({
 ...line(
 'Freight',
 'FreightMileage',
 fr.mileSku || 'MISC_FREIGHT',
 fr.mileDesc || '$4.50 per loaded mile',
 '',
 "0'",
 miles,
 mileCost,
 ),
 building: 'Delivery',
 });
 items.push({
 ...line(
 'Freight',
 'FreightUnload',
 fr.unloadSku || 'MISC_DONKEY',
 fr.unloadDesc || 'DONKEY OFF-LOAD',
 '',
 "0'",
 1,
 unload,
 ),
 building: 'Delivery',
 });
 }

 const merged = mergeItems(items);
 const material = merged
 .filter((i) => i.category !== 'Freight')
 .reduce((s, i) => s + i.extCost, 0);

 let floorArea = 0;
 for (const b of project.buildings) {
 floorArea += b.width * b.length;
 for (const lt of b.leanTos || []) {
 const len =
 lt.length > 0
 ? lt.length
 : (lt.wall === 'front' || lt.wall === 'back' ? b.width : b.length) - lt.offset;
 floorArea += lt.depth * len;
 }
 }

 const labor = floorArea * (project.laborPerSqFt || 0);
 // Materials at cost (no markup). Markup applies to labor only.
 // Freight added after (not marked up). Sales tax on materials + freight.
 const markupFactor = 1 + (project.markupPct || 0) / 100;
 const laborSell = labor * markupFactor;
 const subtotal = material + labor;
 const markedUp = material + laborSell;
 const taxPct = Math.max(0, Number(project.salesTaxPct) || 0);
 const taxBase = material + freight;
 const salesTax = taxBase * (taxPct / 100);
 const total = markedUp + freight + salesTax;

 return {
 items: merged,
 buildingResults,
 material,
 labor,
 laborSell,
 freight,
 freightMiles: miles,
 salesTax,
 salesTaxPct: taxPct,
 subtotal,
 total,
 floorArea,
 };
}

function mergeItems(items) {
 const map = new Map();
 for (const i of items) {
 const key = `${i.category}|${i.usage}|${i.sku}|${i.description}|${i.color}|${i.length}`;
 if (!map.has(key)) {
 map.set(key, { ...i });
 } else {
 const e = map.get(key);
 e.qty += i.qty;
 e.extCost = Math.round(e.qty * e.cost * 100) / 100;
 }
 }
 const order = [
 'Framing',
 'Sheathing',
 'Trim',
 'Doors & Windows',
 'Accessories',
 'Trusses',
 'Concrete',
 'Insulation',
 ];
 // Sheathing: ExteriorWall (gable/eave) before ExteriorRoof; longer wall sheets first
 const usageOrder = {
 ExteriorWall: 1,
 Wainscot: 2,
 ExteriorRoof: 3,
 };
 const parseLen = (s) => {
 if (!s) return 0;
 const m = String(s).match(/(\d+)'?\s*(\d+)?/);
 if (!m) return 0;
 return Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
 };
 return [...map.values()].sort((a, b) => {
 const ai = order.indexOf(a.category);
 const bi = order.indexOf(b.category);
 if ((ai === -1 ? 99 : ai) !== (bi === -1 ? 99 : bi)) {
 return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
 }
 if (a.category === 'Sheathing') {
 const ua = usageOrder[a.usage] || 50;
 const ub = usageOrder[b.usage] || 50;
 if (ua !== ub) return ua - ub;
 // Within same usage, longer panels first (gable steps high → low)
 const ld = parseLen(b.length) - parseLen(a.length);
 if (ld) return ld;
 }
 return (
 (a.usage || '').localeCompare(b.usage || '') ||
 a.description.localeCompare(b.description) ||
 String(a.length).localeCompare(String(b.length))
 );
 });
}

/**
 * Export item list CSV in production package layout:
 * Customer header, then section blocks (Framing / Sheathing / Trim / …)
 * with columns: SKU, Description, Color, Length, Qty, Cost, ExtCost
 */
export function toItemListCsv(project, takeoff) {
 const rows = [];
 const esc = (s) => {
 const t = String(s ?? '');
 if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
 return t;
 };

 // Customer block (matches exported item lists)
 rows.push(
 ['Customer Name', 'Customer Address', 'City', 'State', 'Zip', 'Email Address', 'Phone Number', ''].join(
 ',',
 ),
 );
 rows.push([esc(project.customer || ''), '', '', '', '', '', '', ''].join(','));
 rows.push('');

 // Map internal categories → production section order/names
 const sectionOrder = [
 'Framing',
 'Sheathing',
 'Trim',
 'Doors & Windows',
 'Accessories',
 'Trusses',
 'Labor',
 'Freight',
 'Other',
 ];
 const sectionAlias = {
 Framing: 'Framing',
 Lumber: 'Framing',
 Posts: 'Framing',
 Sheathing: 'Sheathing',
 Metal: 'Sheathing',
 Trim: 'Trim',
 Openings: 'Doors & Windows',
 'Doors & Windows': 'Doors & Windows',
 Doors: 'Doors & Windows',
 Windows: 'Doors & Windows',
 Accessories: 'Accessories',
 Hardware: 'Accessories',
 Trusses: 'Trusses',
 Labor: 'Labor',
 Freight: 'Freight',
 };

 const buckets = {};
 for (const sec of sectionOrder) buckets[sec] = [];
 for (const i of takeoff.items || []) {
 const sec = sectionAlias[i.category] || sectionAlias[i.usage] || 'Other';
 if (!buckets[sec]) buckets[sec] = [];
 buckets[sec].push(i);
 }

 for (const sec of sectionOrder) {
 const items = buckets[sec];
 if (!items?.length) continue;
 rows.push('');
 rows.push(sec);
 // Usage column keeps ExteriorRoof vs ExteriorWall (gable/eave) from being mixed up
 rows.push(
 ['SKU', 'Description', 'Usage', 'Color', 'Angle', 'Length', 'Qty', 'Cost', 'ExtCost', ''].join(
 ',',
 ),
 );
 for (const i of items) {
 rows.push(
 [
 esc(i.sku),
 esc(i.description || ''),
 esc(i.usage || ''),
 esc(i.color || ''),
 esc(i.angle || ''),
 esc(i.length || ''),
 i.qty,
 i.cost,
 i.extCost,
 '',
 ].join(','),
 );
 }
 }

 rows.push('');
 rows.push(['', 'Materials (no markup)', '', '', '', '', takeoff.material?.toFixed?.(2) ?? takeoff.material, ''].join(','));
 rows.push([
 '',
 'Labor (w/ markup)',
 '',
 '',
 '',
 '',
 (takeoff.laborSell != null ? takeoff.laborSell : takeoff.labor)?.toFixed?.(2) ??
 takeoff.laborSell ??
 takeoff.labor,
 '',
 ].join(','));
 rows.push([
 '',
 'Freight',
 '',
 '',
 '',
 '',
 takeoff.freight != null ? Number(takeoff.freight).toFixed(2) : '0.00',
 '',
 ].join(','));
 rows.push([
 '',
 `Sales Tax (${takeoff.salesTaxPct != null ? takeoff.salesTaxPct : 0}%)`,
 '',
 '',
 '',
 '',
 takeoff.salesTax != null ? Number(takeoff.salesTax).toFixed(2) : '0.00',
 '',
 ].join(','));
 rows.push([
 '',
 'Total (materials + labor markup + freight + tax)',
 '',
 '',
 '',
 '',
 takeoff.total?.toFixed?.(2) ?? takeoff.total,
 '',
 ].join(','));

 return rows.join('\n');
}

export function money(n) {
 return (
 '$' +
 Number(n || 0).toLocaleString(undefined, {
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
 })
 );
}
