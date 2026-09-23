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
 * Lengths are not invented here either — anything that is a distance on the
 * building comes from measure.js, which measures it. This module decides what
 * stock that distance is bought in.
 */

import { ellBuriedRunOnWall } from './ell.js?v=20260923frameView1';
import { measureRoofPlane, frameEaveHeightFt } from './measure.js?v=20260923openOff1';

// ── Metal / panel order ─────────────────────────────────────────────

/** Panel coverage width (ft) — standard rib panel. */
export const PANEL_COVERAGE_FT = 3;

/**
 * Split wall-panel solids into ~coverageFt strips along U (last remnant OK).
 * Used by 3D scene + 2D Edit so wallPanelPartId matches individual ~3' sheets.
 *
 * @param {Array<{u0:number,u1:number,v0:number,v1:number}>} panels
 * @param {number} [coverageFt=PANEL_COVERAGE_FT]
 * @returns {Array<{u0:number,u1:number,v0:number,v1:number}>}
 */
export function slicePanelsByCoverage(panels, coverageFt = PANEL_COVERAGE_FT) {
  const cov = Math.max(0.01, Number(coverageFt) || PANEL_COVERAGE_FT);
  const out = [];
  for (const p of panels || []) {
    const u0 = Number(p.u0) || 0;
    const u1 = Number(p.u1) || 0;
    const v0 = Number(p.v0) || 0;
    const v1 = Number(p.v1) || 0;
    if (u1 - u0 < 0.04 || v1 - v0 < 0.04) continue;
    let u = u0;
    while (u < u1 - 1e-9) {
      const next = Math.min(u1, u + cov);
      if (next - u > 0.04) out.push({ u0: u, u1: next, v0, v1 });
      u = next;
    }
  }
  return out;
}

/**
 * Minimum metal projection past eave for ORDER length (inches).
 * Even when the UI “metal only overhang” is 0, production still drips past the wall.
 * Explicit metalOverhangIn > 0 overrides (e.g. 6″).
 */
export const PANEL_METAL_DRIP_MIN_IN = 3;

/*
 * The roof order-add constants that used to live here (1.5″ / 2″ / 5.5″, banded
 * by slope length and overhang width) are gone. Each had been fitted to one
 * job's order list, and together they over-measured a sheet by an inch or two
 * on sizes none of those jobs covered. A roof sheet is now measured end to end
 * by measure.js and rounded up to the next inch — see roofPanelCutLengthFt.
 */

/** Gable wall stock above roof-line (inches). PBP matrix: +1′2″ → 18′2″ steps on 30×12. */
export const GABLE_STOCK_ABOVE_RAKE_IN = 14;

/** Legacy name — peak-snap tuck uses related extras; bury is pad-aware below. */
export const EAVE_WALL_STOCK_ABOVE_EAVE_IN = 8;

/**
 * Eave wall sheet allowance beyond the eave height (inches).
 *
 * Levi's rule: an eave sheet with no framed overhang gets 12″ added. That one
 * figure covers both ends of the sheet — the truss heel above the eave line,
 * and the few inches below grade that carry it down to the rat guard — so a
 * 12′ eave wall orders a 13′ sheet.
 *
 * It does not change with a slab. The sheet drops past the slab edge to the
 * rat guard either way; what a slab changes is the frame height it hangs on
 * (see frameEaveHeightFt), which makes the sheet longer, not shorter.
 */
export const WALL_PANEL_BELOW_FLOOR_IN = 12;

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
 *   30×40×12 → 35@20′, 40×40×12 → 40@20′, 60×60×10 → 48@20′ (PBP matrix).
 *
 * Length alone does NOT force full package — PBP matrix 60×60×10 is still small-shop
 * despite L ≥ 50′ (was wrongly 60 girts + fly rafters).
 *
 * Tall / lean jobs (eave ≥ 14′ or lean): eave girt row + per-wall pack + fascia
 * package → Levi 55×80×14 + lean ~130@20′.
 */
/**
 * Always PBP matrix-matched package selection from building geometry.
 * (Internal test override: b.orderPackageMode = 'small'|'full' — not exposed in UI.)
 *
 * PBP shop rules we follow automatically:
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
 * Always matches PBP matrix sizing rules when orderPackageMode is auto (default).
 */
export function useFullGirtPackage(b) {
  const mode = orderPackageMode(b);
  if (mode === 'full') return true;
  if (mode === 'small') return false;
  // --- PBP matrix auto ---
  const H = Number(b?.eaveHeight) || 0;
  // Enclosed lean or tall eave → full per-wall package (Levi-style)
  return hasEnclosedLean(b) || H >= 14;
}

/**
 * Compact tall plain: W≤30′, L≤40′, eave≥14′, no enclosed lean.
 * Girt packing stays continuous LF (~44–45@20′ on 30×40×16) while trim /
 * opening lumber still use the full package (eave ≥ 14′). Larger tall shops
 * and enclosed-lean jobs pack per-wall.
 */
export function isCompactTallPlainShop(b) {
  if (hasEnclosedLean(b)) return false;
  const W = Number(b?.width) || 0;
  const L = Number(b?.length) || 0;
  const H = Number(b?.eaveHeight) || 0;
  return H >= 14 && W > 0 && W <= 30 && L > 0 && L <= 40;
}

/**
 * Girt pack mode:
 *   continuous — small-shop OR compact tall plain (shared LF / 20′ stock)
 *   per-wall   — full package on larger / lean jobs (waste + opening breaks)
 */
export function girtPackMode(b) {
  if (!useFullGirtPackage(b) || isCompactTallPlainShop(b)) return 'continuous';
  return 'per-wall';
}

/**
 * Whether mid-gable posts with required ~18.1–18.5′ demote 20′→18′ stock.
 *
 * Explicit `b.midGablePostPolicy`:
 *   keep20 / 20 → false (order covering 20′ — Frank PBP matrix 35×50)
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
 * so odd-width barns (35′) match PBP matrix 4@20′ — demotion alone only covers the
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
  // Kept as a thin alias so nothing importing the old name breaks; the rule it
  // used to hold is gone. See gableEaveGirtRow for what actually decides this.
  return gableEaveGirtRow(b);
}

/**
 * Does the GABLE END need a girt at sidewall height?
 *
 * Nothing needs a girt at the eave line on an eave wall: the 2-ply truss bearer
 * sits there and is the top girt. On a gable end there is no bearer, and the
 * truss's BOTTOM CHORD normally does that job — it lands at sidewall height and
 * takes the fasteners for the metal.
 *
 * That only holds while the bottom chord IS at sidewall height. A scissor truss
 * slopes its bottom chord up toward the ridge, and a parallel-chord truss slopes
 * it with the top chord, so on those the chord leaves the wall line and a real
 * girt has to go in. Common and attic trusses keep a flat bottom chord at the
 * eave and need nothing.
 *
 * This replaces a heuristic that gave the row to any building 80' or longer,
 * calibrated to one PBP shop order (Harr 40x80). Length has nothing to do with
 * where a truss chord sits.
 */
export function gableEaveGirtRow(b) {
  const t = b?.trussType || 'common';
  return t === 'scissor' || t === 'parallelChord';
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
 * Along-slope run for pitch ≥ 6 (PBP matrix Harr 40×80×12 6/12 → 13/side).
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
 * Levi 80′ lists need these; plain 60×60 PBP matrix does not (was inflating 12′ count).
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
 * 60×60 PBP matrix: ceil(34/4)=9 → with staggered upgrade yields 27@12′.
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
 *     (e.g. 50′ → run 46′) stock leftover stations on 12′ boards (Frank PBP matrix).
 * @returns {{ 16?: number, 12?: number }}
 */
/** Purlin stock we carry. */
export const PURLIN_STOCK_FT = [12, 14, 16, 20];

/**
 * Purlins cut to the TRUSS BAYS, with the seams staggered row to row.
 *
 * A purlin splices over a truss, so a piece can only span a whole number of
 * bays. The greedy packer this replaces took 16' boards first and never looked
 * at the spacing: at 5' o.c. a 16' board ends 1' past the third truss, so every
 * seam landed in mid-air. It looked efficient on the order and could not be
 * built as written.
 *
 * Whole bays also change WHICH board you buy. Three bays at 5' is 15', so that
 * piece is a 16' board, not a 20' — which is exactly the case Levi described.
 *
 * Stagger: consecutive rows must not seam on the same truss. Row r starts with a
 * short piece of (maxBays - r % maxBays) bays and then runs full-length pieces,
 * so each row's joints sit one bay along from its neighbour's.
 *
 * @param {number} runLenFt  length of the run
 * @param {number} bayFt     truss spacing
 * @param {number} rowIndex  which purlin row, for the stagger offset
 */
export function packPurlinRunByBays(runLenFt, bayFt, rowIndex = 0) {
  const run = Math.max(0, Number(runLenFt) || 0);
  const bay = Math.max(0.5, Number(bayFt) || 5);
  if (run < 0.01) return {};

  const maxStock = PURLIN_STOCK_FT[PURLIN_STOCK_FT.length - 1];
  /** Smallest stock covering n bays, or null when none reaches. */
  const stockFor = (n) => {
    const need = n * bay;
    for (const L of PURLIN_STOCK_FT) if (L >= need - 1e-9) return L;
    return null;
  };
  const maxBays = Math.max(1, Math.floor(maxStock / bay + 1e-9));
  if (!stockFor(1)) {
    // A single bay outruns our longest board. Order one board per bay and let
    // the shortfall read as waste rather than pack a joint in mid-air.
    return { [maxStock]: Math.max(1, Math.round(run / bay)) };
  }

  const total = Math.max(1, Math.round(run / bay));

  // Cheapest way to cover n bays, pieces of 1..maxBays, each on the smallest
  // stock that covers it. Greedy "longest first" is not optimal: at 5' bays,
  // 13 bays greedily is 4+4+4+1 (20+20+20+12 = 72') where 4+4+3+2 is 68'.
  const best = new Array(total + 1).fill(Infinity);
  const pick = new Array(total + 1).fill(0);
  best[0] = 0;
  for (let n = 1; n <= total; n += 1) {
    for (let k = 1; k <= Math.min(maxBays, n); k += 1) {
      const L = stockFor(k);
      if (!L) continue;
      const cost = best[n - k] + L;
      if (cost < best[n] - 1e-9) {
        best[n] = cost;
        pick[n] = k;
      }
    }
  }

  const counts = {};
  const add = (n) => {
    const L = stockFor(n);
    if (L) counts[L] = (counts[L] || 0) + 1;
  };

  // Stagger: step the first joint one bay along per row so neighbouring rows
  // never break on the same truss. The rest of the row is then packed
  // optimally, so the stagger costs one short piece and nothing more.
  let rest = total;
  const offset = maxBays > 1 ? rowIndex % maxBays : 0;
  if (offset > 0 && total > maxBays) {
    const first = maxBays - offset;
    add(first);
    rest = total - first;
  }
  while (rest > 0) {
    const k = pick[rest] || Math.min(maxBays, rest);
    add(k);
    rest -= k;
  }
  return counts;
}

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
 *   35×50 → 48@16 + 46@12  (Frank PBP matrix — double-12 stub + mid stubs)
 *   60×60 → 118@16 + 27@12  (PBP matrix)
 *   Levi main (before lean) → 128@16 + 43@12
 *
 * @returns {{ 16: number, 12: number }}
 */
export function packMainPurlinBoards(mainRows, buildingLengthFt, b = null) {
  const rows = Math.max(0, Number(mainRows) || 0);
  const L = Number(buildingLengthFt) || 0;
  const run = purlinMainRunLengthFt(L);
  if (rows <= 0 || run < 0.1) return {};

  // Cut to the TRUSS BAYS, staggered row to row.
  //
  // What this replaces was greedy on 16' boards and blind to truss spacing, then
  // patched with three corrections that each came off one PBP matrix: a stagger
  // "upgrade" promoting some 12s to 16s, a double-stub upgrade, and a whole
  // special case for steep shops whose length divides by 16 (Harr 80' -> 130@16).
  // At 5' o.c. a 16' board ends a foot past the third truss, so every seam it
  // ordered landed in mid-air — efficient on the order, unbuildable as written.
  //
  // Now each row is partitioned into whole bays and each piece takes the
  // smallest stock that covers it, so three bays at 5' buys a 16' board and four
  // buys a 20'. Rows step their first joint along by a bay so neighbours never
  // seam on the same truss.
  const bay = Math.max(0.5, Number(b?.trussSpacing) || 5);
  const counts = {};
  for (let r = 0; r < rows; r += 1) {
    const one = packPurlinRunByBays(run, bay, r);
    for (const [len, qty] of Object.entries(one)) {
      const n = Number(qty) || 0;
      if (n > 0) counts[Number(len)] = (counts[Number(len)] || 0) + n;
    }
  }
  return counts;
}

// ── Truss block / fly ───────────────────────────────────────────────

/** Truss block sets: ~1 per 40′ of length. */
/**
 * Truss block sets (12′ 2×6). Main: ceil(L/40).
 * A gable-style lean carries its own mini-ridge/truss and needs one extra set
 * (PBP matrix 60′+gable-lean → 3). Shed leans hang off the main purlins and add none
 * (PBP matrix Levi 80′+shed-lean → 2, not 3).
 * @param {number} buildingLengthFt
 * @param {object} [b]
 */
export function trussBlockQty(buildingLengthFt, b = null) {
  // Two 16" blocks per truss, gable ends excluded — they bear on the end wall
  // and take no blocking. Ordered as 2x6 @ 12', which yields nine 16" blocks a
  // board.
  //
  // Was ceil(length / 40) boards, plus one per gable extension: a rule keyed to
  // building length that ignored truss spacing entirely, so a 2' o.c. job and
  // an 8' o.c. job of the same length blocked identically when one has four
  // times the trusses.
  const L = Number(buildingLengthFt) || 0;
  const sp = Math.max(1, Number(b?.trussSpacing) || 5);
  const total = Math.floor(L / sp + 1e-9) + 1;
  const gableTrusses = (b?.roofStyle || 'gable') === 'gable' && total >= 2 ? 2 : 0;
  const interior = Math.max(0, total - gableTrusses);
  const BLOCKS_PER_TRUSS = 2;
  const BLOCKS_PER_BOARD = 9; // 12' board / 16" block
  return Math.max(1, Math.ceil((interior * BLOCKS_PER_TRUSS) / BLOCKS_PER_BOARD));
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
  if (b?.metalOverhangEaveIn != null && Number.isFinite(Number(b.metalOverhangEaveIn))) {
    const m = Number(b.metalOverhangEaveIn);
    if (m > 0) return m;
  }
  const m = Number(b?.metalOverhangIn);
  if (Number.isFinite(m) && m > 0) return m;
  return PANEL_METAL_DRIP_MIN_IN;
}

/** Frame + metal OH in feet for roof panel slope. */
export function panelTotalOverhangFt(b) {
  // Eave (slope) OH drives roof panel run.
  const frameIn =
    b?.overhangEaveIn != null && Number.isFinite(Number(b.overhangEaveIn))
      ? Number(b.overhangEaveIn)
      : Number(b?.overhangIn) || 0;
  const metalIn =
    b?.metalOverhangEaveIn != null && Number.isFinite(Number(b.metalOverhangEaveIn))
      ? Number(b.metalOverhangEaveIn)
      : panelMetalOverhangIn(b);
  return (Math.max(0, frameIn) + Math.max(0, metalIn)) / 12;
}

/**
 * One-side roof panel slope length (ft), drip edge included — what the sheet
 * actually covers before it is rounded to a cut.
 *
 * Delegates to measure.js, which measures ridge-to-eave along the plane and
 * adds a metal-only overhang along that same plane. This used to fold the
 * overhang into the horizontal run instead, which under-measured the slope.
 */
export function roofPanelSlopeLengthFt(b) {
  return measureRoofPlane(b).panelSlopeFt;
}

/**
 * Ridge to the outside face of the framing along the plane (ft) — no drip.
 * Framing lengths and the plan sheets want this one.
 */
export function roofStructuralSlopeFt(b) {
  return measureRoofPlane(b).structuralSlopeFt;
}

/**
 * @deprecated There is no order-add any more.
 *
 * This returned 1.5″, 2″ or 5.5″ chosen by slope length and overhang width,
 * and each of those three numbers had been fitted to a single job. Stacked on
 * a slope that already carried the overhang, they put Levi's worked 50′ 4/12
 * example at 26′9″ when the tape says 26′8″. A sheet is now measured, not
 * measured-then-padded: whatever overhang somebody entered is the only thing
 * added, and the result rounds up to the next inch.
 *
 * Still exported, returning 0, so any caller that has not been migrated fails
 * loudly on review rather than quietly re-padding.
 */
export function roofPanelOrderAddInches() {
  return 0;
}

/** Nearest inch. */
export function roundToNearestInch(ft) {
  return Math.round(Number(ft) * 12) / 12;
}

/**
 * Roof sheet cut length (ft). 50′ @ 4/12 with 3″ of metal → 26′8″.
 * Rounds UP: a long sheet gets trimmed on site, a short one is scrap.
 */
export function roofPanelCutLengthFt(b) {
  return measureRoofPlane(b).panelCutFt;
}

/**
 * Geometric gable peak height above grade (eave + half-width × pitch).
 */
export function gableGeometricPeakFt(b) {
  const eave = frameEaveHeightFt(b);
  const half = (Number(b?.width) || 30) / 2;
  const pitch = (Number(b?.pitch) || 4) / 12;
  return eave + half * pitch;
}

/**
 * Peak wall-panel stock height (ft) after production snap.
 * Base: geo peak + 14″. When that lands on ~18′6″ (e.g. 32′×12′ 4/12),
 * PBP matrix snaps peak stock to 20′ (yard Job Review: 2@20′ + 19′6″ ladder).
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
 * peak-snap → 6″. Otherwise match roof-line drop per 3′ bay:
 * coverage × pitch (4/12 → 12″, 6/12 → 18″). PBP matrix Harr uses 18″ steps.
 */
export function gablePanelLadderInches(b) {
  const geo = gableGeometricPeakFt(b);
  const minPeak = roundToNearestInch(geo + GABLE_STOCK_ABOVE_RAKE_IN / 12);
  if (minPeak >= 18.5 - 1e-9 && minPeak < 19 - 1e-9) return 6;
  const pitch = Number(b?.pitch) || 4;
  return Math.max(6, Math.round(PANEL_COVERAGE_FT * pitch));
}

/**
 * Inches of wall sheet past finished floor.
 *
 * A SLAB DOES NOT SHORTEN THIS. The sheet drops past the edge of the slab and
 * carries on down to the rat guard, which sits at the same elevation whether
 * the building has a slab or bare ground — so a 12′ eave wall orders the same
 * length on a 4″ pad as it does without one. This used to subtract the slab
 * thickness (a 6″ pad turned a 10″ bury into 4″), which shortened the sheet on
 * every slab job and left open exactly the gap the rat guard is there to close.
 *
 * The one case that genuinely differs is a wood-frame overhang of 6″ or more,
 * which sits about 2″ below the floor rather than the full bury. That is not a
 * leftover from calibration: Levi's own sheet worked that case out at 12′1″ on
 * a 12′ eave and he keeps the 12′2″ this produces.
 */
export function wallPanelBelowFloorIn(b, host = null) {
  // Eave wall sheet = frame eave height + heel + this (eaveWallPanelHeightFt).
  //
  // The 12″ is Levi's rule for a sheet with NO framed overhang: truss heel plus
  // the bury down to the rat guard, so a 12′ eave wall orders 13′. A building
  // that HAS a framed overhang is not that case and keeps what it had —
  //
  //   framed overhang, gable : 2″. Levi's own sheet made this 12′1″ on a 12′
  //                            eave and he keeps the 12′2″ this gives.
  //   framed overhang, mono  : 10″. Tim Williams 16×40×16 5/12 with a 12″
  //                            overhang ships a 23′11″ high-side wall, which
  //                            is a real order rather than a calibration.
  //   no framed overhang     : 12″.
  //
  // A slab does not appear here at all. It lifts the frame instead (see
  // frameEaveHeightFt), which lengthens the sheet rather than shortening it.
  const isMono = (b?.roofStyle || 'gable') === 'mono';
  if (hasWoodOverhangStandardEave(b)) return isMono ? 10 : 2;
  return WALL_PANEL_BELOW_FLOOR_IN;
}

/**
 * @deprecated Always 0 — a slab no longer shortens a wall sheet.
 *
 * This returned the slab thickness, and every caller subtracted it from the
 * ordered height. Kept, returning 0, so an unmigrated caller is visible on
 * review rather than silently re-shortening a sheet.
 */
export function wallPanelSlabShortenIn() {
  return 0;
}

export function eaveWallPanelHeightFt(b) {
  // From GRADE — a slab lifts the frame, so the sheet grows with it.
  const eave = frameEaveHeightFt(b);
  // An explicitly raised heel lifts the top-of-wall plane on top of the
  // standard allowance below, which already covers an ordinary truss heel.
  const heel = Math.max(0, Number(b?.heelHeightFt) || 0);
  // 12″ with no framed overhang — truss heel plus the bury down to the rat
  // guard — so a 12′ eave wall orders 13′. A framed overhang of 6″ or more
  // sits about 2″ below the floor instead; that is Levi's rule, not a leftover
  // (his own sheet worked it out at 12′1″ and he keeps the 12′2″ here).
  const below = wallPanelBelowFloorIn(b);
  const ladder = gablePanelLadderInches(b);
  const peakTuck = ladder === 6 ? 12 : 0;
  return eave + heel + (below + peakTuck) / 12;
}

// ── Trim packing (10' pieces unless noted) ──────────────────────────

/** Trim stock piece length (ft). */
export const TRIM_STOCK_FT = 10;

/**
 * Eave trim stock (ft). The sticks are 10'2", not 10'.
 *
 * Levi's worked case: an 80' building takes 8 sticks a side — 8 x 10'2" is
 * 81'4", so 1'4" over the run. Ordering it as 10' stock buys a stick that does
 * not exist and lands two short of what the wall needs.
 */
export const EAVE_TRIM_STOCK_FT = 10 + 2 / 12;

/**
 * Extra starter/lap pieces on long buildings (ridge / eave runs).
 * L ≥ 60′ → +2 (Levi 80′: ridge 10, eave edge 18).
 * L < 60′ → +1 (30×40: ridge 5, eave edge 9).
 */
export function trimRunExtraPieces(buildingLengthFt, b = null) {
  const L = Number(buildingLengthFt) || 0;
  if (L < 60) {
    // Wood-OH mid shops: PBP matrix adds an extra lap (Frank 50′ → ridge 7 / eave 12).
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
 * Main: ceil(L/10)+extra. Each gable lean: +1 (PBP matrix 60′+lean → 9).
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
        // Plain gable lean: +1 stock (PBP matrix 60′+lean → 9)
        n += 1;
      }
    }
  }
  return n;
}

/**
 * True when a lean's roof comes straight off the main roof line.
 *
 * A shed lean on an eave wall at the main's own pitch is not a separate roof —
 * the main plane simply carries on down past the wall and the eave ends up at
 * the LEAN's outer edge. There is no eave on the main wall under it, so it gets
 * no eave trim: you do not double it up.
 *
 * A broken-pitch lean is the other case. The main roof still stops at its own
 * eave and the lean starts below it, so both eaves are real and both get trim.
 *
 * Deliberately NOT the same test as engine.js's eaveShedLeanForContinuousFold,
 * which additionally drops short partial leans out of the continuous fold. That
 * is a decision about how roof SHEETS are ordered; a 10' lean at matching pitch
 * still continues the roof plane, and there is still no eave under it.
 */
export function leanContinuesMainRoofLine(b, lt) {
  if (!lt) return false;
  if ((lt.roofStyle || 'shed') === 'gable') return false;
  const kind = lt.kind || 'leanto';
  if (kind === 'gable-extension' || kind === 'wrap' || kind === 'wrap-lean') return false;
  if (lt.wall !== 'left' && lt.wall !== 'right') return false;
  if ((Number(lt.depth) || 0) <= 0.1) return false;
  const main = Number(b?.pitch) || 4;
  const p = Number(lt.pitch);
  const leanPitch = Number.isFinite(p) && p > 0 ? p : main;
  return Math.abs(leanPitch - main) < 0.01;
}

/** Length of a lean along the wall it sits on (ft). */
export function leanRunAlongWallFt(b, lt) {
  if (!lt) return 0;
  const wall = lt.wall || 'right';
  const wallLen =
    wall === 'left' || wall === 'right' ? Number(b?.length) || 0 : Number(b?.width) || 0;
  const offset = Number(lt.offset) || 0;
  const len =
    Number(lt.length) > 0
      ? Math.min(Number(lt.length) || 0, Math.max(0, wallLen - offset))
      : Math.max(0, wallLen - offset);
  return Math.max(0, len);
}

/**
 * Every run of eave on the building, in feet.
 *
 * Two down the main building — each ordered on its own, since an offcut from
 * one wall cannot be carried round to the other — less whatever a wing is
 * butted against, plus one down each shed lean's length.
 *
 * It is a list rather than a total because different trims come on different
 * sticks: eave trim is 10'2", the single-angle fascia that follows the same
 * line is 10'. Packing a shared total at one stock length gets the other wrong,
 * which is exactly what happened when the fascia count was borrowed from the
 * eave trim count.
 *
 * @returns {number[]}
 */
export function eaveRunsFt(b, buildingLengthFt = null) {
  const L = Number(buildingLengthFt != null ? buildingLengthFt : b?.length) || 0;
  const runs = [];

  // A lean whose roof comes straight off the main roof line leaves no eave on
  // the wall beneath it — the eave is at the lean's outer edge instead. Only
  // the stretch it actually covers comes off, so a 50' lean on an 80' wall
  // still leaves 30' of main eave to trim.
  const continuedOnWall = (w) =>
    (b?.leanTos || []).reduce(
      (t, lt) =>
        lt && lt.wall === w && leanContinuesMainRoofLine(b, lt)
          ? t + leanRunAlongWallFt(b, lt)
          : t,
      0,
    );

  for (const w of ['left', 'right']) {
    const gone = Math.min(ellBuriedRunOnWall(b, w) + continuedOnWall(w), L);
    const run = Math.max(0, L - gone);
    if (run > 0.01) runs.push(run);
  }

  for (const lt of b?.leanTos || []) {
    if (!lt || (Number(lt.depth) || 0) <= 0.1) continue;
    if ((lt.roofStyle || 'shed') === 'gable') continue;
    const leanLen = leanRunAlongWallFt(b, lt);
    if (leanLen > 0.01) runs.push(leanLen);
  }
  return runs;
}

/** Sticks to cover each run separately, at the given stock length. */
export function packRunsAtStock(runs, stockFt) {
  const stock = Number(stockFt) || 10;
  return (runs || []).reduce(
    (t, r) => t + (r > 0.01 ? Math.ceil(r / stock - 1e-9) : 0),
    0,
  );
}

/**
 * Eave edge pieces for both main eaves + lean outer eaves.
 * Main: ceil(2L/10)+extra. A gable lean adds an outer eave run that returns to
 * the main roof at two valleys → +1 stock piece (PBP matrix 60′+gable-lean → 15).
 * Shed leans drain onto the main eave line and add no separate eave-edge stock
 * (PBP matrix Levi 80′+shed-lean → 18, not 19).
 * @param {number} buildingLengthFt
 * @param {object} [b] optional building for lean extras
 */
export function eaveTrimPieces(buildingLengthFt, b = null) {
  const L = Number(buildingLengthFt) || 0;
  const stock = EAVE_TRIM_STOCK_FT;
  const sticks = (runFt) => (runFt > 0.01 ? Math.ceil(runFt / stock - 1e-9) : 0);

  // Each eave run packed on its own, at the real 10'2" stick. An 80' building
  // takes 8 a side, 16 in all, and the 1'4" of lap falls out of the stock
  // length rather than being added as a spare piece.
  //
  // What this replaced pooled both eaves into one run (ceil(2L / 10)) and added
  // a calibrated +1 or +2 on top, which put that 80' building at 18.
  let n = packRunsAtStock(eaveRunsFt(b, L), stock);

  if (b) {
    // A plain gable lean turns an eave return at its outer corner.
    const plainGableLeans = (b.leanTos || []).filter(
      (lt) =>
        lt &&
        (lt.roofStyle || 'shed') === 'gable' &&
        (lt.kind || 'leanto') !== 'gable-extension' &&
        (Number(lt.depth) || 0) > 0.1,
    ).length;
    if (plainGableLeans > 0) n += 1;
    // A gable-extension wing carries two eaves down its depth.
    for (const lt of b.leanTos || []) {
      if (!lt || (lt.kind || 'leanto') !== 'gable-extension') continue;
      const depth = Number(lt.depth) || 0;
      if (!(depth > 0.1)) continue;
      n += 2 * sticks(depth);
    }
  }
  return n;
}

/**
 * Valley trim pieces where gable lean meets main roof (two valleys per gable lean).
 * PBP matrix: 2 @ 10′ @ ~154°.
 */
export function valleyTrimPieces(b) {
  return gableLeanCount(b) * 2;
}

/**
 * Full production package (trim fascia/TOW + framing sub-fascia/fly):
 * Plain small shops (30×40 PBP matrix lists) omit these; large / tall / lean jobs include them.
 * Same gate as full girt package.
 */
export function includeFullTrimPackage(b) {
  return useFullGirtPackage(b);
}

/**
 * Framing extras: eave/gable sub-fascia, gable fly (lookout) rafters, rake ends.
 *
 * Two independent reasons to need these, and for a long time only the first was
 * checked — so a framed overhang bought soffit, fascia and longer roof panels
 * with no lumber under them to fasten any of it to, while a tall square-eave
 * shop was billed lookouts it had no overhang for.
 *
 *   1. The full production package (large / tall / enclosed-lean jobs). Kept
 *      because it is how these jobs are really ordered: the Levi 55x80x14
 *      PBP matrix carries overhangIn 0 with a 6" METAL rake and its real order
 *      still included 24 lookouts, 2 rake ends and eave sub-fascia. A
 *      metal-only overhang still needs a ladder to carry it.
 *
 *   2. A framed overhang, which is the part that was missing. >= 6" of
 *      structural overhang is carried by lookouts off the end truss, not by
 *      ordering a deeper truss, so the lumber has to appear on the list.
 *
 * Either is sufficient; neither is necessary. Widening rather than replacing
 * is deliberate — keying this on overhang alone would have stripped 30 pieces
 * of framing out of the Levi order.
 */
export function includeFullFramingExtras(b) {
  return useFullGirtPackage(b) || hasWoodOverhangStandardEave(b);
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

  // An enclosed lean has two outer corners of its own, where an end wall meets
  // the outer wall. On a lean running the full host wall those land on the main
  // corners relocated above and dedupe away. On a shorter one they stand out in
  // the middle of the wall, and nothing listed them — so they were getting no
  // corner trim in the render and no line on the takeoff.
  const key = (x, z) => `${Math.round(x * 100)}:${Math.round(z * 100)}`;
  const seen = new Set(sites.map((s) => key(s.x, s.z)));
  for (const lt of b?.leanTos || []) {
    if (!lt || (Number(lt.depth) || 0) <= 0.1) continue;
    if (lt.enclosed === false || lt.enclosure === 'open') continue;
    const wall = lt.wall || 'left';
    const depth = Number(lt.depth) || 0;
    const start = Math.max(0, Number(lt.offset) || 0);
    const span = leanSpanAlongHost(b, lt);
    if (span <= 0.1) continue;
    const ends = [start, start + span];
    for (let i = 0; i < ends.length; i += 1) {
      const along = ends[i];
      const awayFromStart = i === 0 ? -1 : 1;
      let x;
      let z;
      let ox;
      let oz;
      if (wall === 'left' || wall === 'right') {
        x = wall === 'left' ? -depth : W + depth;
        z = along;
        ox = wall === 'left' ? -1 : 1;
        oz = awayFromStart;
      } else {
        z = wall === 'front' ? -depth : L + depth;
        x = along;
        oz = wall === 'front' ? -1 : 1;
        ox = awayFromStart;
      }
      const k = key(x, z);
      if (seen.has(k)) continue;
      seen.add(k);
      sites.push({
        x,
        z,
        ox,
        oz,
        eaveH: Number(lt.eaveHeight) || 10,
        walls: c0Walls(wall),
        source: 'lean',
        // Both faces here belong to the lean and are sheeted whatever the main
        // building's walls do, so this corner is never gated by openWalls.
        enclosedCorner: true,
      });
    }
  }
  return sites;
}

/** Placeholder wall pair for a lean's own corner (never gates it — see above). */
function c0Walls(wall) {
  return wall === 'front' || wall === 'back' ? [wall, 'left'] : ['front', wall];
}

/**
 * Corner trim: the eave sidewall sheet plus a foot, one piece per corner.
 *
 * Levi's rule. The corner runs the full height of the wall sheet it sits
 * against, and the extra foot is what laps past at top and bottom.
 *
 * What this replaced was a ladder of bands — over 16' eave order a mix of 20'
 * and 16', over 12' a mix of 16' and 12', otherwise eave + 2' — fitted to old
 * order lists. It had no idea how long the wall sheet on that corner actually
 * was, so on a 16' eave it ordered 16' and 12' pieces for a sheet standing 17'.
 *
 * @returns {{ lengthFt: number, qty: number }[]}
 */
export function mainCornerTrimPack(b) {
  const sites = buildingCornerTrimSites(b);
  const lengthFt = roundToNearestInch(eaveWallPanelHeightFt(b) + 1);

  if (!sites.length) {
    const open = new Set(Array.isArray(b?.openWalls) ? b.openWalls : []);
    const corners = [
      ['front', 'left'],
      ['front', 'right'],
      ['back', 'left'],
      ['back', 'right'],
    ].filter(([g, e]) => !(open.has(g) && open.has(e))).length;
    return corners > 0 ? [{ lengthFt, qty: corners }] : [];
  }

  // A corner that a lean wraps stands only to the LEAN's eave, so it takes the
  // lean's wall sheet plus the same foot rather than the main building's.
  const byLen = new Map();
  for (const site of sites) {
    const siteEave = Number(site.eaveH);
    const len =
      Number.isFinite(siteEave) && Math.abs(siteEave - (Number(b?.eaveHeight) || 12)) > 0.01
        ? roundToNearestInch(siteEave + wallPanelBelowFloorIn(b) / 12 + 1)
        : lengthFt;
    byLen.set(len, (byLen.get(len) || 0) + 1);
  }
  return [...byLen.entries()]
    .sort((a, c) => c[0] - a[0])
    .map(([len, qty]) => ({ lengthFt: len, qty }));
}

/**
 * Longest gable edge piece Levi will run (ft). 16'6".
 */
export const GABLE_EDGE_MAX_PIECE_FT = 16.5;

/**
 * One rake's worth of gable edge trim (ft): the building's standard roof sheet
 * plus a foot.
 *
 * The rake and the roof sheet lie on the same plane and run the same way —
 * ridge down to eave — so they are the same length, and Levi orders the trim a
 * foot longer than the sheet.
 */
export function gableEdgeRunFt(b) {
  return roofPanelCutLengthFt(b) + 1;
}

/**
 * Cut one rake into the FEWEST pieces, none longer than 16'6".
 *
 * Fewest pieces means fewest seams, which is what Levi asked for. The run is
 * then split evenly between them rather than taking full-length sticks and
 * leaving a short tail: two 13'10" pieces beat a 16'6" and an 11'2", because a
 * seam in the middle of a rake looks deliberate and a stub near the eave does
 * not.
 *
 * @returns {{ lengthFt: number, qty: number }[]}
 */
export function packGableEdgeRun(runFt) {
  const run = Number(runFt) || 0;
  if (!(run > 0.01)) return [];
  const pieces = Math.max(1, Math.ceil(run / GABLE_EDGE_MAX_PIECE_FT - 1e-9));
  const each = roundUpToInch(run / pieces);
  return [{ lengthFt: each, qty: pieces }];
}

/** Up to the next whole inch. */
function roundUpToInch(ft) {
  return Math.ceil((Number(ft) || 0) * 12 - 1e-9) / 12;
}


/**
 * True when a plain small-shop still needs FJ / SANG eave trim without the
 * full girt/eave-row package. Wood overhang ≥ 6″ (Frank 1′ OH → FJ19/SANG21);
 * square-eave small shops (Harr OH 0) stay without FJ/SANG.
 */

/**
 * True when wood frame overhang qualifies for standard-eave PBP matrix packaging
 * (FJ/SANG, trim lap +1, closure +1, skirt door nest −1). Matches
 * includeStandardEaveTrim (≥ 6″).
 */
export function hasWoodOverhangStandardEave(b) {
  const eave =
    b?.overhangEaveIn != null && Number.isFinite(Number(b.overhangEaveIn))
      ? Number(b.overhangEaveIn)
      : Number(b?.overhangIn) || 0;
  return eave >= 6;
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
 * ceil(2×(L+W)/10)+2 → Frank 35×50 → 19 (PBP matrix).
 */
export function topOfWallPiecesStandardEave(b) {
  const L = Number(b?.length) || 0;
  const W = Number(b?.width) || 0;
  return Math.max(1, Math.ceil((2 * (L + W)) / TRIM_STOCK_FT - 1e-9) + 2);
}

/**
 * SANG / eave-fascia count for standard-eave small shops.
 * ceil(2×(L+W)/10)+4 → Frank 35×50 → 21 (PBP matrix).
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
  const eaveNail = gableEaveGirtRow(b);
  const pack = girtPackMode(b);
  return {
    orderPackageMode: mode,
    girtPackage: full
      ? pack === 'continuous'
        ? 'full trim; compact continuous girts'
        : 'full (eave row + per-wall pack)'
      : 'small-shop (no eave row + continuous LF)',
    /** Gable ends only, and only for scissor / parallel-chord trusses. */
    girtGableEaveRow: eaveNail,
    girtIncludeEave: eaveNail,
    girtPackMode: pack,
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

/** Multi-line policy text for Rules / policy UI. */
export function formatPolicySummary(b) {
  const p = describePolicyForBuilding(b);
  const lines = [
    `PBP matrix package: ${p.girtPackage}`,
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
