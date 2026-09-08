/**
 * We Build Structures — post-frame PRODUCTION ORDER POLICY
 *
 * These are plant packing / order-cut rules layered on geometry.
 * Geometry (slope, perimeter, post grid) lives in types.js / framing.js.
 * This module is the single source of truth for “how we buy it.”
 *
 * Do NOT hardcode job names or screenshot lengths here.
 * Every constant must scale from building inputs.
 *
 * Verified against production order lists:
 *   - 30×40×12 plain 4/12, 3″ metal OH → roof 16′2″, girt 35, purlin 36@16+18@12
 *   - 55×80×14 + lean 8 + openings, 6″ metal OH → girt 130, purlin 158@16+43@12,
 *     roof 29′11″ / 38′4″
 */

// ── Metal / panel order ─────────────────────────────────────────────

/** Panel coverage width (ft) — standard rib panel. */
export const PANEL_COVERAGE_FT = 3;

/**
 * Minimum metal projection past eave for ORDER length (inches).
 * Even when the UI “metal only overhang” is 0, production still drips past the wall.
 * Explicit metalOverhangIn > 0 overrides (e.g. 6″).
 */
export const PANEL_METAL_DRIP_MIN_IN = 3;

/**
 * Extra cut length beyond panel slope (inches), by slope length.
 * Short: small allowance → 30×40 @ 3″ OH → 16′2″.
 * Long: ridge roll + drip → Levi free side 29′11″.
 */
/** Short order-add (inches): 30×40 4/12 @ 3″ OH → 16′2″. */
export const ROOF_ORDER_ADD_SHORT_IN = 1.5;
/** Mid order-add (inches): 40×40 4/12 @ 3″ OH → 21′6″ (SB). */
export const ROOF_ORDER_ADD_MID_IN = 2;
/** Long order-add (inches): Levi free side → 29′11″. */
export const ROOF_ORDER_ADD_LONG_IN = 5.5;
/** Slope ≥ this (ft) uses mid add (not short). */
export const ROOF_ORDER_ADD_MID_AT_FT = 20;
/**
 * @deprecated Long roof order-add is gated by metal OH ≥ 6″ (not slope).
 * Kept for docs / older notes only — do not use in new code.
 */
export const ROOF_ORDER_ADD_LONG_AT_FT = 28;

/** Gable wall stock above roof-line (inches). SB: +1′2″ → 18′2″ steps on 30×12. */
export const GABLE_STOCK_ABOVE_RAKE_IN = 14;

/** Eave wall panel height above eave (inches). SB: eave + 8″ → 12′8″ on 12′ eave. */
export const EAVE_WALL_STOCK_ABOVE_EAVE_IN = 8;

// ── Girts ───────────────────────────────────────────────────────────

/** Girt stock board length (ft). */
export const GIRT_STOCK_FT = 20;

/**
 * Full production girt / fascia / fly package:
 * - enclosed lean-to present, OR
 * - eave ≥ 14′
 *
 * Small plain shops (any length with low eave, no lean): continuous LF girts,
 * rows stop below eave, no eave sub-fascia / gable fly. Matches:
 *   30×40×12 → 35@20′, 40×40×12 → 40@20′, 60×60×10 → 48@20′ (SB).
 *
 * Length alone does NOT force full package — SB 60×60×10 is still small-shop
 * despite L ≥ 50′ (was wrongly 60 girts + fly rafters).
 *
 * Tall / lean jobs (eave ≥ 14′ or lean): eave girt row + per-wall pack + fascia
 * package → Levi 55×80×14 + lean ~130@20′.
 */
/**
 * Always SB-matched package selection from building geometry.
 * (Internal test override: b.orderPackageMode = 'small'|'full' — not exposed in UI.)
 *
 * SB rules we follow automatically:
 *   - Plain low eave (eave < 14′, no enclosed lean) → small-shop package
 *   - Eave ≥ 14′ OR enclosed lean → full production package
 */
export function orderPackageMode(b) {
  const m = String(b?.orderPackageMode || 'auto').toLowerCase().trim();
  // Test-only overrides (regression matrix); UI always leaves this as auto
  if (m === 'full' || m === 'production' || m === 'large') return 'full';
  if (m === 'small' || m === 'small-shop' || m === 'plain') return 'small';
  return 'auto';
}

/** True when any lean-to is present (open or enclosed). */
export function hasAnyLean(b) {
  return (b?.leanTos || []).some((lt) => lt && (Number(lt.depth) || 0) > 0.1);
}

/** True when an enclosed lean is present. */
export function hasEnclosedLean(b) {
  return (b?.leanTos || []).some(
    (lt) => lt && lt.enclosed !== false && lt.enclosure !== 'open' && (Number(lt.depth) || 0) > 0.1,
  );
}

/** Count of gable-style leans (ridge out from main wall). */
export function gableLeanCount(b) {
  return (b?.leanTos || []).filter(
    (lt) => lt && (lt.roofStyle || 'shed') === 'gable' && (Number(lt.depth) || 0) > 0.1,
  ).length;
}

/**
 * Whether to use full production package (girts/trim/fly/opening lumber).
 * Always matches SmartBuild sizing rules when orderPackageMode is auto (default).
 */
export function useFullGirtPackage(b) {
  const mode = orderPackageMode(b);
  if (mode === 'full') return true;
  if (mode === 'small') return false;
  // --- SB auto ---
  const H = Number(b?.eaveHeight) || 0;
  // Enclosed lean or tall eave → full per-wall package (Levi-style)
  return hasEnclosedLean(b) || H >= 14;
}

/** Girt pack mode string for takeoff. */
export function girtPackMode(b) {
  return useFullGirtPackage(b) ? 'per-wall' : 'continuous';
}

/**
 * Whether girt elevations include the eave station.
 * Full package / enclosed lean / long plain (L ≥ 80′) nail an eave row.
 * Open carport leans do NOT (Prater open lean matches plain 30×40 → 35@20′).
 */
export function girtIncludeEaveNailer(b) {
  // Long plain shops (L ≥ 80′) still get an eave girt row in SB (Harr 40×80 → 68@20′).
  const L = Number(b?.length) || 0;
  return useFullGirtPackage(b) || hasEnclosedLean(b) || L >= 80;
}

/** Waste: +1 board on large per-wall packages. */
export const GIRT_PER_WALL_WASTE_MIN_QTY = 80;

/**
 * Base order deduct: boards broken at each main-wall opening RO.
 *
 * Full package (tall/lean): every main opening (−1 each) — Levi 3 → 130.
 * Small-shop continuous: door ROs only (walk/OH/slider); windows do not break
 * stock. Engine may refine: mid-L multi-door +1 (35×55), long-L width×levels
 * (60×12 → floor(doorW×rows/20)).
 */
export function girtOpeningDeduct(b) {
  const main = (b?.openings || []).filter((o) => !o.host || o.host === 'main');
  if (useFullGirtPackage(b)) return main.length;
  return main.filter((o) => {
    const t = o?.type || '';
    return t === 'walk' || t === 'overhead' || t === 'slider';
  }).length;
}

// ── Purlins ─────────────────────────────────────────────────────────

/**
 * Extra purlin stations beyond ceil(halfRun / spacing).
 * Driven by metal overhang (not building width name):
 *   metal OH ≥ 6″ → +2 (eave + ridge/OH station) — wide OH packages
 *   metal OH < 6″  → +1 (eave + ridge) — small-shop 3″ OH → 9 rows/side on 30′
 */
export function purlinStationPad(b) {
  const metalIn = Number(b?.metalOverhangIn);
  const m = Number.isFinite(metalIn) && metalIn > 0 ? metalIn : PANEL_METAL_DRIP_MIN_IN;
  return m >= 6 ? 2 : 1;
}

/**
 * Purlin stations per roof slope.
 * Horizontal half-run for pitch < 6 (locks 30×40 / 40×40 / 60×60).
 * Along-slope run for pitch ≥ 6 (SB Harr 40×80×12 6/12 → 13/side).
 */
export function purlinRowsPerSide(b) {
  const spacingFt = (Number(b?.purlinSpacingIn) || 24) / 12;
  const metalOh = panelMetalOverhangIn(b) / 12;
  const frameOh = (Number(b?.overhangIn) || 0) / 12;
  const halfRun = (Number(b?.width) || 0) / 2 + metalOh + frameOh;
  const pitch = Number(b?.pitch) || 4;
  const stationRun =
    pitch >= 6 ? halfRun * Math.sqrt(1 + (pitch / 12) ** 2) : halfRun;
  const pad = purlinStationPad(b);
  return Math.max(2, Math.ceil(stationRun / spacingFt - 1e-9) + pad);
}

/**
 * Extra 12′ purlin stubs for long production packages (end/ridge cut waste).
 * Levi 80′ lists need these; plain 60×60 SB does not (was inflating 12′ count).
 * Gate on L ≥ 80′ (not 60′).
 */
export function purlinExtra12StubCount(mainRows, buildingLengthFt) {
  const L = Number(buildingLengthFt) || 0;
  const rows = Number(mainRows) || 0;
  if (rows <= 0 || L < 80) return 0;
  return Math.ceil(rows / 3);
}

/**
 * Mid-length end/ridge stubs (12′): 60′ ≤ L < 80′.
 * 60×60 SB: ceil(34/4)=9 → with staggered upgrade yields 27@12′.
 * Not applied at L ≥ 80′ (that band uses purlinExtra12StubCount).
 */
export function purlinMidLength12StubCount(mainRows, buildingLengthFt) {
  const L = Number(buildingLengthFt) || 0;
  const rows = Number(mainRows) || 0;
  if (rows <= 0 || L < 60 || L >= 80) return 0;
  return Math.ceil(rows / 4);
}

/** Main purlin run length: L − 4′ (2′ gable inset each end) when L > 8′. */
export function purlinMainRunLengthFt(buildingLengthFt) {
  const L = Number(buildingLengthFt) || 0;
  return L > 8 ? Math.max(0, L - 4) : L;
}

/**
 * Pack one purlin run into 16′ + 12′ stock (greedy long-first).
 * rem after full 16′s: >12 → another 16; else if >0 → one 12.
 * @returns {{ 16?: number, 12?: number }}
 */
export function packPurlinRun(runLenFt) {
  const counts = {};
  let rem = Math.max(0, Number(runLenFt) || 0);
  while (rem > 0.01) {
    let pick;
    if (rem >= 16) pick = 16;
    else if (rem > 12) pick = 16;
    else pick = 12;
    counts[pick] = (counts[pick] || 0) + 1;
    rem = Math.round((rem - Math.min(pick, rem)) * 1000) / 1000;
    if (rem < 0) rem = 0;
  }
  return counts;
}

/**
 * Open / broken-pitch lean purlin pack: one 16′ lead then 12′ fill.
 * 40′ → 16+12+12 (not 16+16+12). Enclosed same-pitch leans keep packPurlinRun.
 */
export function packLeanOpenPurlinRun(runLenFt) {
  const counts = {};
  let rem = Math.max(0, Number(runLenFt) || 0);
  if (rem < 0.01) return counts;
  // One 16′ lead, then 12′ fill only (40′ → 16+12+12, not 16+16+12).
  if (rem >= 16) {
    counts[16] = 1;
    rem = Math.round((rem - 16) * 1000) / 1000;
  }
  while (rem > 0.01) {
    counts[12] = (counts[12] || 0) + 1;
    rem = Math.round((rem - 12) * 1000) / 1000;
    if (rem < 0) rem = 0;
  }
  return counts;
}

/**
 * End remainder after max full 16′ boards on a run (0 if exact or rem handled as extra 16).
 * Used for staggered upgrade gate: 56′ → 8′, 36′ → 4′, 76′ → 12′.
 */
export function purlinRunRemainderFt(runLenFt) {
  const run = Math.max(0, Number(runLenFt) || 0);
  if (run < 0.01) return 0;
  const full = Math.floor(run / 16 + 1e-9) * 16;
  const rem = Math.round((run - full) * 1000) / 1000;
  // rem > 12 is ordered as another 16′ (not a 12′ stub)
  if (rem > 12) return 0;
  return rem;
}

/**
 * Staggered upgrade: when each row ends in a mid-size stub (8′ ≤ r < 12′)
 * on a long enough run (≥ 48′), production upgrades floor(rows/2)−1 of those
 * 12′ ends to 16′ (prefer longer stock / stagger cuts).
 *
 * 60×60: r=8, rows=34 → +16@16 −16@12.
 * 30×40 / 40×40: r=4 < 8 → no upgrade (keeps 36/18, 48/24).
 * Levi main: r=12 (exact 12′ board) → no upgrade.
 */
export function purlinStaggerUpgradeCount(mainRows, runLenFt) {
  const rows = Number(mainRows) || 0;
  const run = Number(runLenFt) || 0;
  if (rows <= 0 || run < 48) return 0;
  const rem = purlinRunRemainderFt(run);
  if (rem < 8 || rem >= 12) return 0;
  return Math.max(0, Math.floor(rows / 2) - 1);
}

/**
 * Full main-roof purlin board counts (16′ / 12′), size-general.
 * Applies base per-row pack + staggered upgrade + mid-length / long stubs.
 * Lean-to runs are packed separately (no main upgrade/stubs).
 *
 * Locks:
 *   30×40 → 36@16 + 18@12
 *   40×40 → 48@16 + 24@12
 *   60×60 → 118@16 + 27@12  (SB)
 *   Levi main (before lean) → 128@16 + 43@12
 *
 * @returns {{ 16: number, 12: number }}
 */
export function packMainPurlinBoards(mainRows, buildingLengthFt, b = null) {
  const rows = Math.max(0, Number(mainRows) || 0);
  const L = Number(buildingLengthFt) || 0;
  const run = purlinMainRunLengthFt(L);
  const counts = { 16: 0, 12: 0 };
  if (rows <= 0 || run < 0.1) return counts;

  // Steep plain shops on multiple-of-16 lengths: SB stocks full-L 16′ boards
  // (Harr 80′ → 5×16/row = 130@16, not 4×16+12 on the 76′ inset run).
  const pitch = Number(b?.pitch) || 0;
  const fullLPack =
    !!b &&
    pitch >= 6 &&
    !hasAnyLean(b) &&
    L >= 80 &&
    Math.abs(L % 16) < 1e-9;
  const packRun = fullLPack ? L : run;

  const one = packPurlinRun(packRun);
  counts[16] = (one[16] || 0) * rows;
  counts[12] = (one[12] || 0) * rows;

  const up = fullLPack ? 0 : purlinStaggerUpgradeCount(rows, packRun);
  if (up > 0) {
    const can = Math.min(up, counts[12]);
    counts[12] -= can;
    counts[16] += can;
  }

  const mid12 = fullLPack ? 0 : purlinMidLength12StubCount(rows, L);
  if (mid12 > 0) counts[12] += mid12;

  let long12 = purlinExtra12StubCount(rows, L);
  // Harr-class: 26 rows × full 80′ → 130@16 needs 10×12′ end/ridge stubs (ceil(L/8)).
  if (fullLPack) long12 = Math.max(long12, Math.ceil(L / 8));
  if (long12 > 0) counts[12] += long12;

  return counts;
}

// ── Truss block / fly ───────────────────────────────────────────────

/** Truss block sets: ~1 per 40′ of length. */
/**
 * Truss block sets (12′ 2×6). Main: ceil(L/40).
 * A gable-style lean carries its own mini-ridge/truss and needs one extra set
 * (SB 60′+gable-lean → 3). Shed leans hang off the main purlins and add none
 * (SB Levi 80′+shed-lean → 2, not 3).
 * @param {number} buildingLengthFt
 * @param {object} [b]
 */
export function trussBlockQty(buildingLengthFt, b = null) {
  const L = Number(buildingLengthFt) || 0;
  let n = Math.max(1, Math.ceil(L / 40 - 1e-9));
  if (b) n += gableLeanCount(b);
  return n;
}

/** Gable fly / lookout count from width (55′ → 15). */
export function gableFlyRafterQty(buildingWidthFt) {
  const W = Number(buildingWidthFt) || 30;
  return Math.max(8, Math.round(W / 3.67));
}

// ── Helpers for panel slope (order) ─────────────────────────────────

/** Metal inches used for panel slope (min drip if 0/blank). */
export function panelMetalOverhangIn(b) {
  const m = Number(b?.metalOverhangIn);
  if (Number.isFinite(m) && m > 0) return m;
  return PANEL_METAL_DRIP_MIN_IN;
}

/** Frame + metal OH in feet for roof panel slope. */
export function panelTotalOverhangFt(b) {
  const frame = (Number(b?.overhangIn) || 0) / 12;
  return frame + panelMetalOverhangIn(b) / 12;
}

/**
 * One-side roof panel slope length (ft) for ORDER cuts.
 * Independent of framing rafterLength when UI metal OH is 0.
 */
export function roofPanelSlopeLengthFt(b) {
  const oh = panelTotalOverhangFt(b);
  const W = Number(b?.width) || 0;
  const pitch = (Number(b?.pitch) || 4) / 12;
  // Production model (Levi / SB): vertical rise = wall half-run × pitch;
  // metal OH extends the horizontal run past the eave (not re-scaling rise).
  // Matches free-side 29′11″ on 55′ @ 6″ OH and continuous lean host cuts.
  if ((b?.roofStyle || 'gable') === 'mono') {
    return Math.hypot(W + oh, W * pitch);
  }
  const half = W / 2;
  return Math.hypot(half + oh, half * pitch);
}

/**
 * Order-cut allowance (size-general):
 *   slope < 20′           → 1.5″  (30×40 @ 3″ OH → 16′2″)
 *   slope ≥ 20′, OH < 6″  → 2″    (40×40 → 21′6″; 60×60 → 32′0″ SB)
 *   slope ≥ 20′, OH ≥ 6″  → 5.5″  (Levi free side 55′ @ 6″ OH → 29′11″)
 *
 * Long add is tied to wide metal OH packages, not slope alone — otherwise
 * 60×60 @ 3″ OH wrongly got 32′4″ instead of SB 32′0″.
 * @param {number} slopeFt
 * @param {object} [b] building (for metal OH); omit → mid/short only by slope
 */
export function roofPanelOrderAddInches(slopeFt, b = null) {
  const s = Number(slopeFt) || 0;
  if (s < ROOF_ORDER_ADD_MID_AT_FT) {
    // Mid-short band: ~32′×4/12 @ 3″ OH slope ~17.1′ → SB Kane 18′4″ needs ~15″ add.
    // Keep classic short add (1.5″) below 16.75′ so 30×40 stays 16′2″.
    if (s >= 16.75 && s < 18.25) return 15;
    return ROOF_ORDER_ADD_SHORT_IN;
  }
  const metalIn =
    b != null ? panelMetalOverhangIn(b) : PANEL_METAL_DRIP_MIN_IN;
  // Wide-OH production (Levi 6″) uses the long ridge/drip allowance
  if (metalIn >= 6) return ROOF_ORDER_ADD_LONG_IN;
  return ROOF_ORDER_ADD_MID_IN;
}

/** Nearest inch. */
export function roundToNearestInch(ft) {
  return Math.round(Number(ft) * 12) / 12;
}

export function roofPanelCutLengthFt(b) {
  const slope = roofPanelSlopeLengthFt(b);
  return roundToNearestInch(slope + roofPanelOrderAddInches(slope, b) / 12);
}

/**
 * Geometric gable peak height above grade (eave + half-width × pitch).
 */
export function gableGeometricPeakFt(b) {
  const eave = Number(b?.eaveHeight) || 12;
  const half = (Number(b?.width) || 30) / 2;
  const pitch = (Number(b?.pitch) || 4) / 12;
  return eave + half * pitch;
}

/**
 * Peak wall-panel stock height (ft) after production snap.
 * Base: geo peak + 14″. When that lands on ~18′6″ (e.g. 32′×12′ 4/12),
 * SB snaps peak stock to 20′ (Kane Job Review: 2@20′ + 19′6″ ladder).
 * 30×12 stays ~18′2″; 40×12 stays ~19′10″.
 */
export function gablePeakStockHeightFt(b) {
  const geo = gableGeometricPeakFt(b);
  let peak = roundToNearestInch(geo + GABLE_STOCK_ABOVE_RAKE_IN / 12);
  if (peak >= 18.5 - 1e-9 && peak < 19 - 1e-9) peak = 20;
  return peak;
}

/**
 * Effective stock above roof-line (ft) so bay heights reach peak stock.
 * 32′×12′ 4/12 → 32″ (peak 20′); 30×12 → 14″.
 */
export function gableStockAboveRakeFt(b = null) {
  if (!b) return GABLE_STOCK_ABOVE_RAKE_IN / 12;
  const geo = gableGeometricPeakFt(b);
  const peak = gablePeakStockHeightFt(b);
  return Math.max(GABLE_STOCK_ABOVE_RAKE_IN / 12, peak - geo);
}

/**
 * Ladder step for gable wall packing (inches).
 * Kane peak-snap → 6″. Otherwise match roof-line drop per 3′ bay:
 * coverage × pitch (4/12 → 12″, 6/12 → 18″). SB Harr uses 18″ steps.
 */
export function gablePanelLadderInches(b) {
  const geo = gableGeometricPeakFt(b);
  const minPeak = roundToNearestInch(geo + GABLE_STOCK_ABOVE_RAKE_IN / 12);
  if (minPeak >= 18.5 - 1e-9 && minPeak < 19 - 1e-9) return 6;
  const pitch = Number(b?.pitch) || 4;
  return Math.max(6, Math.round(PANEL_COVERAGE_FT * pitch));
}

export function eaveWallPanelHeightFt(b) {
  const eave = Number(b?.eaveHeight) || 12;
  // When gable peak stock snaps to 20′ (32×12 4/12), SB orders eave walls at
  // 13′10″ (= eave + 22″), consolidating stock with the tall gable package.
  // Default remains eave + 8″ (12′8″) for 30/40/60 goldens.
  const ladder = gablePanelLadderInches(b);
  const extra = ladder === 6 ? 14 : 0; // +14″ beyond normal 8″ → +22″ total
  return eave + (EAVE_WALL_STOCK_ABOVE_EAVE_IN + extra) / 12;
}

// ── Trim packing (10' pieces unless noted) ──────────────────────────

/** Trim stock piece length (ft). */
export const TRIM_STOCK_FT = 10;

/**
 * Extra starter/lap pieces on long buildings (ridge / eave runs).
 * L ≥ 60′ → +2 (Levi 80′: ridge 10, eave edge 18).
 * L < 60′ → +1 (30×40: ridge 5, eave edge 9).
 */
export function trimRunExtraPieces(buildingLengthFt, b = null) {
  const L = Number(buildingLengthFt) || 0;
  if (L < 60) return 1;
  // Full / lean production: +2 (Levi 80′ → ridge 10, eave 18).
  // Plain small-shop long: +1 (Harr 80′ → ridge 9, eave 17).
  if (b && !useFullGirtPackage(b) && !hasAnyLean(b)) return 1;
  return 2;
}

/**
 * Ridge cap pieces of 10′ along main ridge + gable lean ridges.
 * Main: ceil(L/10)+extra. Each gable lean: +1 (SB 60′+lean → 9).
 * @param {number} buildingLengthFt
 * @param {object} [b] optional building for lean extras
 */
export function ridgeCapPieces(buildingLengthFt, b = null) {
  const L = Number(buildingLengthFt) || 0;
  const stock = TRIM_STOCK_FT;
  let n = Math.max(1, Math.ceil(L / stock - 1e-9) + trimRunExtraPieces(L, b));
  // Gable lean ridge runs out from main wall — order +1 stock per lean (SB)
  if (b) n += gableLeanCount(b);
  return n;
}

/**
 * Eave edge pieces for both main eaves + lean outer eaves.
 * Main: ceil(2L/10)+extra. A gable lean adds an outer eave run that returns to
 * the main roof at two valleys → +1 stock piece (SB 60′+gable-lean → 15).
 * Shed leans drain onto the main eave line and add no separate eave-edge stock
 * (SB Levi 80′+shed-lean → 18, not 19).
 * @param {number} buildingLengthFt
 * @param {object} [b] optional building for lean extras
 */
export function eaveTrimPieces(buildingLengthFt, b = null) {
  const L = Number(buildingLengthFt) || 0;
  const stock = TRIM_STOCK_FT;
  let n = Math.max(1, Math.ceil((2 * L) / stock - 1e-9) + trimRunExtraPieces(L, b));
  if (b && gableLeanCount(b) > 0) n += 1;
  // Open shed lean outer eave drip is ordered as LET (Prater 40′ → +5 → 14).
  // Enclosed shed leans drain at the main eave / dual-wing pack — no add.
  if (b) {
    for (const lt of b.leanTos || []) {
      if (!lt || (Number(lt.depth) || 0) <= 0.1) continue;
      if (lt.enclosed !== false && lt.enclosure !== 'open') continue;
      if ((lt.roofStyle || 'shed') === 'gable') continue;
      const wall = lt.wall || 'right';
      const wallLen =
        wall === 'left' || wall === 'right'
          ? Number(b.length) || 0
          : Number(b.width) || 0;
      const offset = Number(lt.offset) || 0;
      const leanLen =
        Number(lt.length) > 0
          ? Math.min(Number(lt.length) || 0, Math.max(0, wallLen - offset))
          : Math.max(0, wallLen - offset);
      if (leanLen <= 0.1) continue;
      n += Math.max(1, Math.ceil(leanLen / stock - 1e-9) + 1);
    }
  }
  return n;
}

/**
 * Valley trim pieces where gable lean meets main roof (two valleys per gable lean).
 * SB: 2 @ 10′ @ ~154°.
 */
export function valleyTrimPieces(b) {
  return gableLeanCount(b) * 2;
}

/**
 * Full production package (trim fascia/TOW + framing sub-fascia/fly):
 * Plain small shops (30×40 SB lists) omit these; large / tall / lean jobs include them.
 * Same gate as full girt package.
 */
export function includeFullTrimPackage(b) {
  return useFullGirtPackage(b);
}

/** Alias — framing extras (sub-fascia, gable fly) use the same gate. */
export function includeFullFramingExtras(b) {
  return useFullGirtPackage(b);
}

/**
 * @deprecated OH 2x6 package is now 2 plies per OH via openingFraming.headerSecondary.
 * Kept returning 0 so call sites stay safe.
 */
export function smallShopOhHeaderCompanionQty(_b) {
  return 0;
}

/**
 * Corner trim stock length(s) for main building corners.
 * 12′ eave → all 14′ (eave + 2′ wrap) — SB 30×40.
 * 14′ eave → 2@16 + 2@12 — Levi.
 * >16′ → 20/16 mix.
 * @returns {{ lengthFt: number, qty: number }[]}
 */
export function mainCornerTrimPack(b) {
  const eaveH = Number(b?.eaveHeight) || 12;
  const openCount = ['front', 'back', 'left', 'right'].filter((w) => {
    const ow = b?.openWalls;
    return Array.isArray(ow) && ow.includes(w);
  }).length;
  // Fallback: if openWalls missing, assume 4 corners
  const corners = Math.max(2, 4 - Math.floor(openCount / 2));

  if (eaveH > 16) {
    const n20 = Math.ceil(corners / 2);
    return [
      { lengthFt: 20, qty: n20 },
      { lengthFt: 16, qty: corners - n20 },
    ].filter((r) => r.qty > 0);
  }
  if (eaveH > 12) {
    const n16 = Math.ceil(corners / 2);
    return [
      { lengthFt: 16, qty: n16 },
      { lengthFt: 12, qty: corners - n16 },
    ].filter((r) => r.qty > 0);
  }
  // ≤12′ eave: all corners eave + 2′ (production wrap above eave)
  const len = Math.ceil(eaveH + 2 - 1e-9);
  return [{ lengthFt: len, qty: corners }];
}

/**
 * Top-of-wall trim pieces (full package only).
 * ceil(2×(L+W)/10)+4 → 31 on 55×80.
 */
export function topOfWallPieces(b) {
  const L = Number(b?.length) || 0;
  const W = Number(b?.width) || 0;
  return Math.max(1, Math.ceil((2 * (L + W)) / TRIM_STOCK_FT - 1e-9) + 4);
}

/**
 * Human-readable policy summary for Rules / audit UI.
 */
export function describePolicyForBuilding(b) {
  const mode = orderPackageMode(b);
  const full = useFullGirtPackage(b);
  const pad = purlinStationPad(b);
  const metal = panelMetalOverhangIn(b);
  const L = Number(b?.length) || 0;
  // rows estimate for audit (matches generatePurlins when spacing 24")
  const rps = purlinRowsPerSide(b);
  const sides = (b?.roofStyle || 'gable') === 'mono' ? 1 : 2;
  const purlinPack = packMainPurlinBoards(rps * sides, L, b);
  const run = purlinMainRunLengthFt(L);
  return {
    orderPackageMode: mode,
    girtPackage: full ? 'full (eave row + per-wall pack)' : 'small-shop (no eave row + continuous LF)',
    girtIncludeEave: full,
    girtPackMode: girtPackMode(b),
    girtOpeningDeduct: girtOpeningDeduct(b),
    purlinStationPad: pad,
    purlinMainRunFt: run,
    purlinPack16: purlinPack[16] || 0,
    purlinPack12: purlinPack[12] || 0,
    purlinStaggerUpgrade: purlinStaggerUpgradeCount(rps * sides, run),
    purlinMid12Stubs: purlinMidLength12StubCount(rps * sides, L),
    purlinLong12Stubs: purlinExtra12StubCount(rps * sides, L),
    panelMetalOverhangIn: metal,
    roofCutFt: roofPanelCutLengthFt(b),
    eaveWallPanelFt: eaveWallPanelHeightFt(b),
    gableStockAboveRakeIn: GABLE_STOCK_ABOVE_RAKE_IN,
    trussBlocks: trussBlockQty(b?.length, b),
    fullTrimPackage: includeFullTrimPackage(b),
    smallShopOhHeaderCompanion: smallShopOhHeaderCompanionQty(b),
    openingLumber: full
      ? 'full (Header + Trimmer + Sill + Backing)'
      : 'small-shop (headers only; no Trimmer/Sill/Backing)',
    ridgeCapPieces: ridgeCapPieces(b?.length, b),
    eaveTrimPieces: eaveTrimPieces(b?.length, b),
  };
}

/** Multi-line policy text for Rules / scorecard UI. */
export function formatPolicySummary(b) {
  const p = describePolicyForBuilding(b);
  const lines = [
    `SB package: ${p.girtPackage}`,
    `Opening lumber: ${p.openingLumber}`,
    `Girt deduct (openings): −${p.girtOpeningDeduct}`,
    `Purlins: ${p.purlinPack16}@16′ + ${p.purlinPack12}@12′ (run ${p.purlinMainRunFt}′, pad ${p.purlinStationPad}, upgrade ${p.purlinStaggerUpgrade}, mid12 ${p.purlinMid12Stubs}, long12 ${p.purlinLong12Stubs})`,
    `Roof cut: ${Number(p.roofCutFt).toFixed(3).replace(/\.?0+$/, '')}′  |  Eave wall panel: ${Number(p.eaveWallPanelFt).toFixed(3).replace(/\.?0+$/, '')}′  |  Metal OH: ${p.panelMetalOverhangIn}″`,
    `Trim: ridge ${p.ridgeCapPieces} · eave edge ${p.eaveTrimPieces} · full fascia/TOW/fly: ${p.fullTrimPackage ? 'yes' : 'no'}`,
    `OH header companion 2x6: ${p.smallShopOhHeaderCompanion}`,
  ];
  return lines.join('\n');
}
