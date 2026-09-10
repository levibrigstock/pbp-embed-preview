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
/** Mid order-add (inches): 40×40 4/12 @ 3″ OH → 21′6″ (benchmark). */
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

/** Gable wall stock above roof-line (inches). benchmark: +1′2″ → 18′2″ steps on 30×12. */
export const GABLE_STOCK_ABOVE_RAKE_IN = 14;

/** Legacy name — peak-snap tuck uses related extras; bury is pad-aware below. */
export const EAVE_WALL_STOCK_ABOVE_EAVE_IN = 8;

/**
 * Wall sheet past finished floor / into grade when there is NO slab (inches).
 * With slab: bury = 10 − slabThickness (6″ pad → 4″).
 */
export const WALL_PANEL_BELOW_FLOOR_IN = 10;

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
 *   30×40×12 → 35@20′, 40×40×12 → 40@20′, 60×60×10 → 48@20′ (benchmark).
 *
 * Length alone does NOT force full package — benchmark 60×60×10 is still small-shop
 * despite L ≥ 50′ (was wrongly 60 girts + fly rafters).
 *
 * Tall / lean jobs (eave ≥ 14′ or lean): eave girt row + per-wall pack + fascia
 * package → Levi 55×80×14 + lean ~130@20′.
 */
/**
 * Always benchmark-matched package selection from building geometry.
 * (Internal test override: b.orderPackageMode = 'small'|'full' — not exposed in UI.)
 *
 * benchmark rules we follow automatically:
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

/**
 * Partial enclosed shed lean (span < host wall). Full-length leans (Levi) and
 * gable-extension wings (Jim) return false. Gates mixed 16′/18′/20′ girt packing
 * so Doug-style cut lists emit shorter stock without touching Frank/Mark/Harr.
 */
export function hasPartialEnclosedShedLean(b) {
  for (const lt of b?.leanTos || []) {
    if (!lt || (Number(lt.depth) || 0) <= 0.1) continue;
    if (lt.enclosed === false || lt.enclosure === 'open') continue;
    if ((lt.roofStyle || 'shed') === 'gable') continue;
    if ((lt.kind || 'leanto') === 'gable-extension') continue;
    const wall = lt.wall || 'left';
    const wallLen =
      wall === 'left' || wall === 'right'
        ? Number(b?.length) || 0
        : Number(b?.width) || 0;
    const offset = Number(lt.offset) || 0;
    const leanLen =
      Number(lt.length) > 0
        ? Math.min(Number(lt.length) || 0, Math.max(0, wallLen - offset))
        : 0; // length≤0 ⇒ full-wall cover
    if (leanLen > 0.1 && leanLen < wallLen - 0.1) return true;
  }
  return false;
}

/** Count of gable-style leans (ridge out from main wall). */
export function gableLeanCount(b) {
  return (b?.leanTos || []).filter(
    (lt) => lt && (lt.roofStyle || 'shed') === 'gable' && (Number(lt.depth) || 0) > 0.1,
  ).length;
}

/**
 * Whether to use full production package (girts/trim/fly/opening lumber).
 * Always matches Benchmark sizing rules when orderPackageMode is auto (default).
 */
export function useFullGirtPackage(b) {
  const mode = orderPackageMode(b);
  if (mode === 'full') return true;
  if (mode === 'small') return false;
  // --- benchmark auto ---
  const H = Number(b?.eaveHeight) || 0;
  // Enclosed lean or tall eave → full per-wall package (Levi-style)
  return hasEnclosedLean(b) || H >= 14;
}

/** Girt pack mode string for takeoff. */
export function girtPackMode(b) {
  return useFullGirtPackage(b) ? 'per-wall' : 'continuous';
}

/**
 * Whether mid-gable posts with required ~18.1–18.5′ demote 20′→18′ stock.
 *
 * Explicit `b.midGablePostPolicy`:
 *   keep20 / 20 → false (order covering 20′ — Frank benchmark 35×50)
 *   demote18 / 18 → true
 *   auto (default) → package + width/lean rule below
 *
 * Auto:
 *   full girt package → false (keep covering 20′ stock)
 *   W ≥ 50 → false (wide barns keep 20′)
 *   W ∈ [35, 50) → true (30×40 / 40×40 / 35×55 goldens)
 *   W < 35 → true iff no lean (plain narrow; Prater open lean keeps 20′)
 */
export function useMidGable18Demotion(b) {
  const raw = String(b?.midGablePostPolicy || 'auto').toLowerCase().trim();
  if (raw === 'keep20' || raw === '20') return false;
  if (raw === 'demote18' || raw === '18') return true;
  // --- auto ---
  if (useFullGirtPackage(b)) return false;
  const W = Number(b?.width) || 0;
  if (W >= 50) return false;
  if (W >= 35 && W < 50) return true;
  if (W > 0 && W < 35) return !hasAnyLean(b);
  return false;
}

/**
 * Explicit keep20 policy (not auto-wide / auto-full).
 * Lifts mid-gable posts that landed on 18′ (req ~16.1–18.5′) to covering 20′
 * so odd-width barns (35′) match benchmark 4@20′ — demotion alone only covers the
 * 18.1–18.5′ band (2 of 4 stations when W is not a multiple of spacing).
 */
export function isExplicitMidGableKeep20(b) {
  const raw = String(b?.midGablePostPolicy || 'auto').toLowerCase().trim();
  return raw === 'keep20' || raw === '20';
}


/**
 * Whether girt elevations include the eave station.
 * Full package / enclosed lean / long plain (L ≥ 80′) nail an eave row.
 * Open carport leans do NOT (Prater open lean matches plain 30×40 → 35@20′).
 */
export function girtIncludeEaveNailer(b) {
  // Long plain shops (L ≥ 80′) still get an eave girt row in benchmark (Harr 40×80 → 68@20′).
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
 * Along-slope run for pitch ≥ 6 (benchmark Harr 40×80×12 6/12 → 13/side).
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
 * Levi 80′ lists need these; plain 60×60 benchmark does not (was inflating 12′ count).
 * Gate on L ≥ 80′ (not 60′).
 */
export function purlinExtra12StubCount(mainRows, buildingLengthFt) {
  const L = Number(buildingLengthFt) || 0;
  const rows = Number(mainRows) || 0;
  if (rows <= 0 || L < 80) return 0;
  return Math.ceil(rows / 3);
}

/**
 * Mid-length end/ridge stubs (12′): 50′ ≤ L < 80′.
 * Frank 50′: ceil(22/4)=6 with double-stub pack → 48@16+46@12.
 * 60×60 benchmark: ceil(34/4)=9 → with staggered upgrade yields 27@12′.
 * Not applied at L ≥ 80′ (that band uses purlinExtra12StubCount).
 */
export function purlinMidLength12StubCount(mainRows, buildingLengthFt) {
  const L = Number(buildingLengthFt) || 0;
  const rows = Number(mainRows) || 0;
  if (rows <= 0 || L >= 80) return 0;
  if (L >= 60) return Math.ceil(rows / 4);
  // 50 ≤ L < 60: only when double-12 stub pack (run rem in (12,16)) — Frank 50′.
  // Skip L=55 rem~3 (35×55 regression keeps 20@12).
  if (L >= 50) {
    const run = purlinMainRunLengthFt(L);
    const rem = purlinRunRemainderFt(run);
    if (rem > 12 && rem < 16) return Math.ceil(rows / 4);
  }
  return 0;
}

/** Main purlin run length: L − 4′ (2′ gable inset each end) when L > 8′. */
export function purlinMainRunLengthFt(buildingLengthFt) {
  const L = Number(buildingLengthFt) || 0;
  return L > 8 ? Math.max(0, L - 4) : L;
}

/**
 * Pack one purlin run into 16′ + 12′ stock (greedy long-first).
 * rem after full 16′s:
 *   0 < rem ≤ 12 → one 12′ stub
 *   12 < rem < 16 → two 12′ stubs (not one 16′) so mid-length shops
 *     (e.g. 50′ → run 46′) stock leftover stations on 12′ boards (Frank benchmark).
 * @returns {{ 16?: number, 12?: number }}
 */
export function packPurlinRun(runLenFt) {
  const counts = {};
  let rem = Math.max(0, Number(runLenFt) || 0);
  while (rem > 0.01) {
    if (rem >= 16) {
      counts[16] = (counts[16] || 0) + 1;
      rem = Math.round((rem - 16) * 1000) / 1000;
      continue;
    }
    if (rem > 12) {
      // Leftover between 12′ and 16′: prefer stub pack (2×12) over overshoot 16′.
      counts[12] = (counts[12] || 0) + 2;
      rem = 0;
      break;
    }
    counts[12] = (counts[12] || 0) + 1;
    rem = Math.round((rem - Math.min(12, rem)) * 1000) / 1000;
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
 * End remainder after max full 16′ boards on a run.
 * Used for staggered upgrade gate: 56′ → 8′, 36′ → 4′, 76′ → 12′.
 * rem in (12, 16) uses double-12 stub pack (see packPurlinRun) — return that
 * rem so purlinDoubleStubUpgradeCount can upgrade some 12→16.
 */
export function purlinRunRemainderFt(runLenFt) {
  const run = Math.max(0, Number(runLenFt) || 0);
  if (run < 0.01) return 0;
  const full = Math.floor(run / 16 + 1e-9) * 16;
  const rem = Math.round((run - full) * 1000) / 1000;
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
  // Classic stagger: mid stub 8′ ≤ r < 12′ (60×60 rem 8).
  if (rem < 8 || rem >= 12) return 0;
  return Math.max(0, Math.floor(rows / 2) - 1);
}

/**
 * When pack ends in 2×12 stubs (rem in (12, 16)), upgrade ~rows/5.5 of those
 * extra 12′ boards to 16′ (Frank 22 rows → +4@16 −4@12 → toward 48/46 with mid stubs).
 */
export function purlinDoubleStubUpgradeCount(mainRows, runLenFt) {
  const rows = Number(mainRows) || 0;
  const run = Number(runLenFt) || 0;
  if (rows <= 0 || run < 40) return 0;
  const rem = purlinRunRemainderFt(run);
  if (rem <= 12 || rem >= 16) return 0;
  return Math.max(0, Math.round(rows / 5.5));
}

/**
 * Full main-roof purlin board counts (16′ / 12′), size-general.
 * Applies base per-row pack + staggered upgrade + mid-length / long stubs.
 * Lean-to runs are packed separately (no main upgrade/stubs).
 *
 * Locks:
 *   30×40 → 36@16 + 18@12
 *   40×40 → 48@16 + 24@12
 *   35×50 → 48@16 + 46@12  (Frank benchmark — double-12 stub + mid stubs)
 *   60×60 → 118@16 + 27@12  (benchmark)
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

  // Steep plain shops on multiple-of-16 lengths: benchmark stocks full-L 16′ boards
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

  const up2 = fullLPack ? 0 : purlinDoubleStubUpgradeCount(rows, packRun);
  if (up2 > 0) {
    const can = Math.min(up2, counts[12]);
    counts[12] -= can;
    counts[16] += can;
  }

  const mid12 = fullLPack ? 0 : purlinMidLength12StubCount(rows, L);
  if (mid12 > 0) counts[12] += mid12;

  let long12 = purlinExtra12StubCount(rows, L);
  // Harr-class: 26 rows × full 80′ → 130@16 needs 10×12′ end/ridge stubs (ceil(L/8)).
  if (fullLPack) long12 = Math.max(long12, Math.ceil(L / 8));
  if (long12 > 0) counts[12] += long12;

  // Partial enclosed shed lean: benchmark mixes heavier 12′ on the main (Doug 47@16+73@12).
  // Reverse stagger-heavy 16′ pack and add mid stubs — Mark/Levi full-length leans skip.
  if (!fullLPack && hasPartialEnclosedShedLean(b)) {
    const demote = Math.min(counts[16] || 0, Math.round(rows * 1.1));
    if (demote > 0) {
      counts[16] -= demote;
      counts[12] = (counts[12] || 0) + demote;
    }
    const extra = Math.max(0, Math.ceil(rows / 2) - mid12);
    if (extra > 0) counts[12] = (counts[12] || 0) + extra;
  }

  return counts;
}

// ── Truss block / fly ───────────────────────────────────────────────

/** Truss block sets: ~1 per 40′ of length. */
/**
 * Truss block sets (12′ 2×6). Main: ceil(L/40).
 * A gable-style lean carries its own mini-ridge/truss and needs one extra set
 * (benchmark 60′+gable-lean → 3). Shed leans hang off the main purlins and add none
 * (benchmark Levi 80′+shed-lean → 2, not 3).
 * @param {number} buildingLengthFt
 * @param {object} [b]
 */
export function trussBlockQty(buildingLengthFt, b = null) {
  const L = Number(buildingLengthFt) || 0;
  let n = Math.max(1, Math.ceil(L / 40 - 1e-9));
  if (b) n += gableLeanCount(b);
  return n;
}

/**
 * Gable fly / lookout piece count.
 * Stations across building width at `rafterSpacing` o.c. (default 5′),
 * ends inclusive: floor(W/sp)+1 per gable end × 2 ends.
 * Pass a building object or (widthFt, spacingFt).
 */
export function gableFlyRafterQty(buildingWidthFtOrBuilding, spacingFt) {
  let W;
  let sp;
  if (buildingWidthFtOrBuilding && typeof buildingWidthFtOrBuilding === 'object') {
    const b = buildingWidthFtOrBuilding;
    W = Number(b.width) || 30;
    sp = Number(spacingFt != null ? spacingFt : b.rafterSpacing) || 5;
  } else {
    W = Number(buildingWidthFtOrBuilding) || 30;
    sp = Number(spacingFt) || 5;
  }
  sp = Math.max(1, sp);
  const perEnd = Math.max(2, Math.floor(W / sp) + 1);
  return perEnd * 2;
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
  // Production model (Levi / benchmark): vertical rise = wall half-run × pitch;
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
 *   slope ≥ 20′, OH < 6″  → 2″    (40×40 → 21′6″; 60×60 → 32′0″ benchmark)
 *   slope ≥ 20′, OH ≥ 6″  → 5.5″  (Levi free side 55′ @ 6″ OH → 29′11″)
 *
 * Long add is tied to wide metal OH packages, not slope alone — otherwise
 * 60×60 @ 3″ OH wrongly got 32′4″ instead of benchmark 32′0″.
 * @param {number} slopeFt
 * @param {object} [b] building (for metal OH); omit → mid/short only by slope
 */
export function roofPanelOrderAddInches(slopeFt, b = null) {
  const s = Number(slopeFt) || 0;
  if (s < ROOF_ORDER_ADD_MID_AT_FT) {
    // Mid-short band: ~32′×4/12 @ 3″ OH slope ~17.1′ → benchmark Kane 18′4″ needs ~15″ add.
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
 * benchmark snaps peak stock to 20′ (Kane Job Review: 2@20′ + 19′6″ ladder).
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
 * coverage × pitch (4/12 → 12″, 6/12 → 18″). benchmark Harr uses 18″ steps.
 */
export function gablePanelLadderInches(b) {
  const geo = gableGeometricPeakFt(b);
  const minPeak = roundToNearestInch(geo + GABLE_STOCK_ABOVE_RAKE_IN / 12);
  if (minPeak >= 18.5 - 1e-9 && minPeak < 19 - 1e-9) return 6;
  const pitch = Number(b?.pitch) || 4;
  return Math.max(6, Math.round(PANEL_COVERAGE_FT * pitch));
}

/**
 * Resolve slab on/thickness from main building or a lean host.
 */
function slabSpec(b, host = null) {
  if (host) {
    return {
      hasSlab: host.hasSlab === true,
      thicknessIn: Math.max(
        0,
        Number(host.slabThicknessIn) || Number(b?.slabThicknessIn) || 0,
      ),
    };
  }
  return {
    hasSlab: b?.hasSlab === true,
    thicknessIn: Math.max(0, Number(b?.slabThicknessIn) || 0),
  };
}

/**
 * Inches of wall sheet past finished floor.
 * No slab → 10″. With slab → max(0, 10 − thickness). 6″ pad → 4″.
 */
export function wallPanelBelowFloorIn(b, host = null) {
  const base = WALL_PANEL_BELOW_FLOOR_IN;
  const { hasSlab, thicknessIn } = slabSpec(b, host);
  if (hasSlab) return Math.max(0, base - thicknessIn);
  return base;
}

/** Inches shorter vs no-slab order (usually = slab thickness when pad on). */
export function wallPanelSlabShortenIn(b, host = null) {
  return Math.max(0, WALL_PANEL_BELOW_FLOOR_IN - wallPanelBelowFloorIn(b, host));
}

export function eaveWallPanelHeightFt(b) {
  const eave = Number(b?.eaveHeight) || 12;
  // Pad-aware bury: 10″ no slab, 10″ − slab thk with pad (6″ → 4″).
  // Peak-snap (32×12): +12″ tuck so no-slab ≈ eave+22″; with 6″ pad ≈ eave+16″.
  const below = wallPanelBelowFloorIn(b);
  const ladder = gablePanelLadderInches(b);
  const peakTuck = ladder === 6 ? 12 : 0;
  return eave + (below + peakTuck) / 12;
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
  if (L < 60) {
    // Wood-OH mid shops: benchmark adds an extra lap (Frank 50′ → ridge 7 / eave 12).
    // Square-eave plains (30×40 / 40×40 overhangIn 0) stay +1.
    const woodOh = Number(b?.overhangIn) || 0;
    if (b && woodOh >= 6 && L >= 50) return 2;
    return 1;
  }
  // Full / lean production: +2 (Levi 80′ → ridge 10, eave 18).
  // Plain small-shop long: +1 (Harr 80′ → ridge 9, eave 17).
  if (b && !useFullGirtPackage(b) && !hasAnyLean(b)) return 1;
  return 2;
}

/**
 * Ridge cap pieces of 10′ along main ridge + gable lean ridges.
 * Main: ceil(L/10)+extra. Each gable lean: +1 (benchmark 60′+lean → 9).
 * @param {number} buildingLengthFt
 * @param {object} [b] optional building for lean extras
 */
export function ridgeCapPieces(buildingLengthFt, b = null) {
  const L = Number(buildingLengthFt) || 0;
  const stock = TRIM_STOCK_FT;
  let n = Math.max(1, Math.ceil(L / stock - 1e-9) + trimRunExtraPieces(L, b));
  // Gable lean / gable-extension ridges
  if (b) {
    for (const lt of b.leanTos || []) {
      if (!lt || (lt.roofStyle || 'shed') !== 'gable') continue;
      const depth = Number(lt.depth) || 0;
      if (!(depth > 0.1)) continue;
      if ((lt.kind || 'leanto') === 'gable-extension') {
        // Wing ridge runs along depth (Jim 43′ → ceil(43/10)+1)
        n += Math.max(1, Math.ceil(depth / stock - 1e-9) + 1);
      } else {
        // Plain gable lean: +1 stock (benchmark 60′+lean → 9)
        n += 1;
      }
    }
  }
  return n;
}

/**
 * Eave edge pieces for both main eaves + lean outer eaves.
 * Main: ceil(2L/10)+extra. A gable lean adds an outer eave run that returns to
 * the main roof at two valleys → +1 stock piece (benchmark 60′+gable-lean → 15).
 * Shed leans drain onto the main eave line and add no separate eave-edge stock
 * (benchmark Levi 80′+shed-lean → 18, not 19).
 * @param {number} buildingLengthFt
 * @param {object} [b] optional building for lean extras
 */
export function eaveTrimPieces(buildingLengthFt, b = null) {
  const L = Number(buildingLengthFt) || 0;
  const stock = TRIM_STOCK_FT;
  let n = Math.max(1, Math.ceil((2 * L) / stock - 1e-9) + trimRunExtraPieces(L, b));
  // Plain gable leans (not gable-extension): +1 outer eave return (benchmark 60′+lean → 15)
  if (b) {
    const plainGableLeans = (b.leanTos || []).filter(
      (lt) =>
        lt &&
        (lt.roofStyle || 'shed') === 'gable' &&
        (lt.kind || 'leanto') !== 'gable-extension' &&
        (Number(lt.depth) || 0) > 0.1,
    ).length;
    if (plainGableLeans > 0) n += 1;
    // Gable-extension: two eaves along wing depth (Jim 2×43′ → +9 → EaveEdge 19)
    for (const lt of b.leanTos || []) {
      if (!lt || (lt.kind || 'leanto') !== 'gable-extension') continue;
      const depth = Number(lt.depth) || 0;
      if (!(depth > 0.1)) continue;
      n += Math.max(1, Math.ceil((2 * depth) / stock - 1e-9));
    }
  }
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
 * benchmark: 2 @ 10′ @ ~154°.
 */
export function valleyTrimPieces(b) {
  return gableLeanCount(b) * 2;
}

/**
 * Full production package (trim fascia/TOW + framing sub-fascia/fly):
 * Plain small shops (30×40 benchmark lists) omit these; large / tall / lean jobs include them.
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

/** Host-wall length for a lean (ft). */
function leanHostWallLengthFt(b, wall) {
  const w = wall || 'left';
  if (w === 'front' || w === 'back') return Number(b?.width) || 0;
  return Number(b?.length) || 0;
}

/** Effective lean span along its host wall (ft). */
function leanSpanAlongHost(b, lt) {
  const wallLen = leanHostWallLengthFt(b, lt?.wall);
  const offset = Math.max(0, Number(lt?.offset) || 0);
  if (Number(lt?.length) > 0) {
    return Math.min(Number(lt.length), Math.max(0, wallLen - offset));
  }
  return Math.max(0, wallLen - offset);
}

/**
 * Enclosed lean that absorbs a main building corner — corner trim moves to the
 * lean's outer edge. `corner` = { eave: left|right, gable: front|back }.
 */
export function enclosedLeanCoveringCorner(b, corner) {
  for (const lt of b?.leanTos || []) {
    if (!lt || (Number(lt.depth) || 0) <= 0.1) continue;
    if (lt.enclosed === false || lt.enclosure === 'open') continue;
    const wall = lt.wall || 'left';
    const wallLen = leanHostWallLengthFt(b, wall);
    const start = Math.max(0, Number(lt.offset) || 0);
    const end = start + leanSpanAlongHost(b, lt);
    if (wall === 'left' || wall === 'right') {
      if (wall !== corner.eave) continue;
      const along = corner.gable === 'front' ? 0 : wallLen;
      if (along >= start - 0.2 && along <= end + 0.2) return lt;
    } else if (wall === 'front' || wall === 'back') {
      if (wall !== corner.gable) continue;
      const along = corner.eave === 'left' ? 0 : wallLen;
      if (along >= start - 0.2 && along <= end + 0.2) return lt;
    }
  }
  return null;
}

/** True when an enclosed lean covers this main wall (host face under lean roof). */
export function mainWallHasEnclosedLean(b, wall) {
  return (b?.leanTos || []).some(
    (lt) =>
      lt &&
      lt.wall === wall &&
      (Number(lt.depth) || 0) > 0.1 &&
      lt.enclosed !== false &&
      lt.enclosure !== 'open',
  );
}

/**
 * Plan-view sites for vertical corner trim.
 * Enclosed lean: corners on that wall relocate to the lean OUTER edge and use
 * the lean outer eave height for stock length (aligns metal/trim with lean).
 *
 * @returns {{ x:number, z:number, ox:number, oz:number, eaveH:number, walls:string[], source:'main'|'lean' }[]}
 */
export function buildingCornerTrimSites(b) {
  const W = Number(b?.width) || 0;
  const L = Number(b?.length) || 0;
  const mainE = Number(b?.eaveHeight) || 12;
  const open = new Set(Array.isArray(b?.openWalls) ? b.openWalls : []);

  const mainCorners = [
    { x: 0, z: 0, ox: -1, oz: -1, eave: 'left', gable: 'front', walls: ['front', 'left'] },
    { x: W, z: 0, ox: 1, oz: -1, eave: 'right', gable: 'front', walls: ['front', 'right'] },
    { x: 0, z: L, ox: -1, oz: 1, eave: 'left', gable: 'back', walls: ['back', 'left'] },
    { x: W, z: L, ox: 1, oz: 1, eave: 'right', gable: 'back', walls: ['back', 'right'] },
  ];

  const sites = [];
  for (const c of mainCorners) {
    if (open.has(c.eave) && open.has(c.gable)) continue;
    const lean = enclosedLeanCoveringCorner(b, c);
    if (lean) {
      const depth = Number(lean.depth) || 0;
      const leanEave = Number(lean.eaveHeight) || 10;
      let x = c.x;
      let z = c.z;
      // Project main corner out to lean outer face
      if (lean.wall === 'left') x = -depth;
      else if (lean.wall === 'right') x = W + depth;
      else if (lean.wall === 'front') z = -depth;
      else if (lean.wall === 'back') z = L + depth;
      // Keep the gable/eave end this corner belongs to (clamped to lean span)
      if (lean.wall === 'left' || lean.wall === 'right') {
        z = c.gable === 'front' ? 0 : L;
        const start = Math.max(0, Number(lean.offset) || 0);
        const end = start + leanSpanAlongHost(b, lean);
        z = Math.max(start, Math.min(end, z));
      } else {
        x = c.eave === 'left' ? 0 : W;
        const start = Math.max(0, Number(lean.offset) || 0);
        const end = start + leanSpanAlongHost(b, lean);
        x = Math.max(start, Math.min(end, x));
      }
      sites.push({
        x,
        z,
        ox: c.ox,
        oz: c.oz,
        eaveH: leanEave,
        walls: c.walls,
        source: 'lean',
      });
    } else {
      sites.push({
        x: c.x,
        z: c.z,
        ox: c.ox,
        oz: c.oz,
        eaveH: mainE,
        walls: c.walls,
        source: 'main',
      });
    }
  }
  return sites;
}

/**
 * Corner trim stock length(s).
 * Enclosed lean: absorbed main corners move to lean outer edge and size from
 * lean outer eave (e.g. 10′ lean → 12′ = eave + 2′ wrap), not main eave.
 *
 * ≤12′ eave → eave+2′; 12–16′ → 16/12 mix; >16′ → 20/16 mix.
 * @returns {{ lengthFt: number, qty: number }[]}
 */
export function mainCornerTrimPack(b) {
  const sites = buildingCornerTrimSites(b);
  if (!sites.length) {
    const eaveH = Number(b?.eaveHeight) || 12;
    const openCount = ['front', 'back', 'left', 'right'].filter((w) => {
      const ow = b?.openWalls;
      return Array.isArray(ow) && ow.includes(w);
    }).length;
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
    return [{ lengthFt: Math.ceil(eaveH + 2 - 1e-9), qty: corners }];
  }

  const byLen = new Map();
  const tall = [];
  for (const s of sites) {
    const h = Number(s.eaveH) || 12;
    if (h > 16) {
      byLen.set(20, (byLen.get(20) || 0) + 1);
    } else if (h > 12) {
      tall.push(h);
    } else {
      const len = Math.ceil(h + 2 - 1e-9);
      byLen.set(len, (byLen.get(len) || 0) + 1);
    }
  }
  if (tall.length) {
    const n16 = Math.ceil(tall.length / 2);
    byLen.set(16, (byLen.get(16) || 0) + n16);
    byLen.set(12, (byLen.get(12) || 0) + (tall.length - n16));
  }
  return [...byLen.entries()]
    .map(([lengthFt, qty]) => ({ lengthFt, qty }))
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.lengthFt - a.lengthFt);
}

/**
 * True when a plain small-shop still needs FJ / SANG eave trim without the
 * full girt/eave-row package. Wood overhang ≥ 6″ (Frank 1′ OH → FJ19/SANG21);
 * square-eave small shops (Harr OH 0) stay without FJ/SANG.
 */

/**
 * True when wood frame overhang qualifies for standard-eave benchmark packaging
 * (FJ/SANG, trim lap +1, closure +1, skirt door nest −1). Matches
 * includeStandardEaveTrim (≥ 6″).
 */
export function hasWoodOverhangStandardEave(b) {
  return (Number(b?.overhangIn) || 0) >= 6;
}

export function includeStandardEaveTrim(b) {
  if (includeFullTrimPackage(b)) return false;
  // Dual enclosed eave wings omit FJ/SANG — gated in engine via hasDualFullEnclosedEaveLeans.
  return hasWoodOverhangStandardEave(b);
}

/**
 * Top-of-wall trim pieces (full package).
 * ceil(2×(L+W)/10)+4 → 31 on 55×80.
 */
export function topOfWallPieces(b) {
  const L = Number(b?.length) || 0;
  const W = Number(b?.width) || 0;
  let peri = 2 * (L + W);
  // Gable-extension wing outer faces (outer width + two depth sides)
  for (const lt of b?.leanTos || []) {
    if (!lt || (lt.kind || 'leanto') !== 'gable-extension') continue;
    const wallLen =
      lt.wall === 'left' || lt.wall === 'right'
        ? Number(b?.length) || 0
        : Number(b?.width) || 0;
    const offset = Number(lt.offset) || 0;
    const length =
      Number(lt.length) > 0
        ? Math.min(Number(lt.length) || 0, Math.max(0, wallLen - offset))
        : Math.max(0, wallLen - offset);
    const depth = Number(lt.depth) || 0;
    if (length > 0.1 && depth > 0.1) peri += length + 2 * depth;
  }
  let qty = Math.max(1, Math.ceil(peri / TRIM_STOCK_FT - 1e-9) + 4);
  // Partial enclosed shed lean: +ceil(leanLen/10) FJ for lean eave run (Doug 22→24).
  if (hasPartialEnclosedShedLean(b)) {
    let leanLen = 0;
    for (const lt of b?.leanTos || []) {
      if (!lt || (Number(lt.depth) || 0) <= 0.1) continue;
      if (lt.enclosed === false || lt.enclosure === 'open') continue;
      if ((lt.roofStyle || 'shed') === 'gable') continue;
      if ((lt.kind || 'leanto') === 'gable-extension') continue;
      leanLen = Math.max(leanLen, Number(lt.length) || 0);
    }
    if (leanLen > 0.1) qty += Math.max(1, Math.ceil(leanLen / TRIM_STOCK_FT - 1e-9));
  }
  return qty;
}

/**
 * FJ count for standard-eave small shops (wood OH, no full package).
 * ceil(2×(L+W)/10)+2 → Frank 35×50 → 19 (benchmark).
 */
export function topOfWallPiecesStandardEave(b) {
  const L = Number(b?.length) || 0;
  const W = Number(b?.width) || 0;
  return Math.max(1, Math.ceil((2 * (L + W)) / TRIM_STOCK_FT - 1e-9) + 2);
}

/**
 * SANG / eave-fascia count for standard-eave small shops.
 * ceil(2×(L+W)/10)+4 → Frank 35×50 → 21 (benchmark).
 */
export function eaveFasciaPiecesStandardEave(b) {
  return topOfWallPieces(b);
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
    midGablePostPolicy: String(b?.midGablePostPolicy || 'auto').toLowerCase().trim() || 'auto',
    midGable18Demotion: useMidGable18Demotion(b),
  };
}

/** Multi-line policy text for Rules / scorecard UI. */
export function formatPolicySummary(b) {
  const p = describePolicyForBuilding(b);
  const lines = [
    `Benchmark package: ${p.girtPackage}`,
    `Opening lumber: ${p.openingLumber}`,
    `Girt deduct (openings): −${p.girtOpeningDeduct}`,
    `Purlins: ${p.purlinPack16}@16′ + ${p.purlinPack12}@12′ (run ${p.purlinMainRunFt}′, pad ${p.purlinStationPad}, upgrade ${p.purlinStaggerUpgrade}, mid12 ${p.purlinMid12Stubs}, long12 ${p.purlinLong12Stubs})`,
    `Roof cut: ${Number(p.roofCutFt).toFixed(3).replace(/\.?0+$/, '')}′  |  Eave wall panel: ${Number(p.eaveWallPanelFt).toFixed(3).replace(/\.?0+$/, '')}′  |  Metal OH: ${p.panelMetalOverhangIn}″`,
    `Trim: ridge ${p.ridgeCapPieces} · eave edge ${p.eaveTrimPieces} · full fascia/TOW/fly: ${p.fullTrimPackage ? 'yes' : 'no'}`,
    `OH header companion 2x6: ${p.smallShopOhHeaderCompanion}`,
    `Mid-gable post stock: ${p.midGable18Demotion ? 'demote 20→18′' : 'keep 20′'} (policy ${p.midGablePostPolicy})`,
  ];
  return lines.join('\n');
}
