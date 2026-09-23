/**
 * gableWallPanels.js — vertical wall metal on a gable end, panel by panel.
 *
 * A gable end is sheeted with vertical panels, and every one of them is a
 * different length because the roof line slopes across the wall above it. This
 * works out each panel's length from the geometry of the roof rather than from
 * a stepped table of lengths, so it holds at any width, any pitch, any eave
 * height and any panel coverage — including the widths that do not divide
 * evenly by the panel and the ridges that land in the middle of one.
 *
 * ── The rules ────────────────────────────────────────────────────────────────
 *
 * 1. GEOMETRY IS THE SOURCE OF TRUTH. The roof line over the wall is
 *
 *      roofHeight(x) = eave + (pitch / 12) × (halfSpan − |x − halfSpan|)
 *
 *    with x measured horizontally from one outside corner of the gable wall.
 *    It peaks at the ridge and falls away symmetrically to both corners.
 *
 * 2. EVERY PANEL IS MEASURED ON ITS OWN, AT ITS TALLEST POINT. A panel has to
 *    reach the roof line everywhere it covers, so what matters is the HIGHEST
 *    roof elevation anywhere across its width — not its centre, not its edge.
 *    Because the roof line rises monotonically toward the ridge from either
 *    side, that point is simply the point in the panel's span nearest the
 *    ridge: a panel left of the ridge is measured at its right edge, one right
 *    of the ridge at its left edge, and the panel the ridge falls inside is
 *    measured at the ridge itself.
 *
 * 3. THE ALLOWANCE GOES ON AFTER THE GEOMETRY. The cut allowance covers the
 *    rake cut and the bury below the wall line, so it is added to the measured
 *    height, never baked into it.
 *
 * 4. ROUND UP, NEVER DOWN, to the configured increment. 17′1″ and 17′5″ both
 *    order 17′6″; 17′6″ orders 17′6″; 17′7″ orders 18′0″. A panel an increment
 *    long gets cut on site. A panel short of the roof line is scrap.
 *
 * Everything inside is INCHES. Feet-and-inches arithmetic is where this kind of
 * calculation goes wrong, so feet come in at the edge and go out at the edge,
 * and nothing in between ever sees a fraction of a foot.
 *
 * ── Worked example ───────────────────────────────────────────────────────────
 *
 *   30′ wide, 12′ eave, 4/12, 36″ panels, 18″ allowance, rounded to 6″
 *
 *     halfSpan   15′        gable rise 5′        ridge 17′
 *     10 panels per gable, 20 over two ends
 *     tallest panel  17′ + 1′6″ = 18′6″
 *
 *     14′6″ × 4 · 15′6″ × 4 · 16′6″ × 4 · 17′6″ × 4 · 18′6″ × 4
 *
 * This module only calculates. Nothing here is wired into the takeoff yet.
 */

/** Panel coverage, allowance and rounding as PBP ships them. All inches. */
export const GABLE_WALL_PANEL_DEFAULTS = {
  /** Net coverage of one panel across the wall. */
  panelCoverageIn: 36,
  /** Cut and bury allowance added to the measured roof height. */
  gableSheetAllowanceIn: 18,
  /** Order lengths round UP to a multiple of this. */
  sheetLengthRoundingIn: 6,
  /** Identical gable ends on the building. */
  numberOfGableEnds: 2,
};

const EPS = 1e-6;

const num = (v, dflt = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

/** Up to the next multiple of `incrementIn`. Never down, and never short. */
export function roundUpToIncrementIn(valueIn, incrementIn) {
  const inc = num(incrementIn);
  const v = num(valueIn);
  if (!(inc > 0)) return v;
  return Math.ceil(v / inc - EPS) * inc;
}

/** Inches → `18'6"`. Order lists and debug output read in feet and inches. */
export function formatInches(totalIn) {
  const t = Math.round(num(totalIn));
  const sign = t < 0 ? '-' : '';
  const a = Math.abs(t);
  return `${sign}${Math.floor(a / 12)}'${a % 12}"`;
}

/**
 * Height of the roof line above the wall's base, at `xIn` from one corner.
 *
 * Peaks at the ridge and falls away symmetrically; outside the wall it keeps
 * falling, so callers that pass an x off the wall get a sensible extrapolation
 * rather than a NaN.
 *
 * @param {number} xIn horizontal position from one outside corner, inches
 * @param {{buildingWidthIn:number, eaveHeightIn:number, roofPitchRise:number}} g
 * @returns {number} inches above the base of the wall
 */
export function roofHeightAtIn(xIn, g) {
  const width = num(g?.buildingWidthIn);
  const eave = num(g?.eaveHeightIn);
  const ratio = num(g?.roofPitchRise, 4) / 12;
  const halfSpan = width / 2;
  return eave + ratio * (halfSpan - Math.abs(num(xIn) - halfSpan));
}

/**
 * Where the panel spanning [startIn, endIn] reaches its tallest.
 *
 * The roof line climbs toward the ridge from both sides, so the tallest point
 * over any interval is the point in it closest to the ridge — which is the
 * ridge itself when the ridge falls inside the panel. That one clamp covers all
 * three cases the layout can produce, so none of them needs special handling.
 */
export function highestPointXIn(startIn, endIn, buildingWidthIn) {
  const ridgeX = num(buildingWidthIn) / 2;
  return Math.min(Math.max(ridgeX, num(startIn)), num(endIn));
}

/**
 * Lay the panels out across the wall.
 *
 * Panels run full coverage from one corner; whatever is left at the far corner
 * is a partial panel, which still has to be ordered at a full panel's length.
 * A width that divides evenly simply produces no partial.
 */
export function gablePanelSpansIn(buildingWidthIn, panelCoverageIn) {
  const width = num(buildingWidthIn);
  const cov = num(panelCoverageIn);
  if (!(width > 0) || !(cov > 0)) return [];
  const spans = [];
  for (let start = 0; start < width - EPS; start += cov) {
    spans.push({ startIn: start, endIn: Math.min(start + cov, width) });
  }
  return spans;
}

/**
 * Gable-end wall metal for a building.
 *
 * @param {object} input
 * @param {number} input.buildingWidthFt
 * @param {number} input.eaveHeightFt
 * @param {number} input.roofPitchRise      rise per 12 — 4 for 4/12, 6 for 6/12
 * @param {number} [input.panelCoverageIn=36]
 * @param {number} [input.gableSheetAllowanceIn=18]
 * @param {number} [input.sheetLengthRoundingIn=6]
 * @param {number} [input.numberOfGableEnds=2]
 *
 * @returns {{
 *   inputs: object,
 *   geometry: {buildingWidthIn:number, eaveHeightIn:number, halfSpanIn:number,
 *              gableRiseIn:number, ridgeHeightIn:number, ridgeXIn:number},
 *   panels: Array<{panelNumber:number, panelStartXIn:number, panelEndXIn:number,
 *                  coveredWidthIn:number, isPartial:boolean, ridgeInsidePanel:boolean,
 *                  highestPointXIn:number, geometricRoofHeightIn:number,
 *                  allowanceIn:number, rawRequiredLengthIn:number,
 *                  orderedLengthIn:number, orderedLength:string}>,
 *   panelsPerGable: number,
 *   totalPanels: number,
 *   order: Array<{lengthIn:number, length:string, qtyPerGable:number, qty:number}>,
 *   longestPanelIn: number, longestPanel: string,
 * }}
 */
export function gableWallPanels(input = {}) {
  const cfg = {
    panelCoverageIn: num(
      input.panelCoverageIn,
      GABLE_WALL_PANEL_DEFAULTS.panelCoverageIn,
    ),
    gableSheetAllowanceIn: num(
      input.gableSheetAllowanceIn,
      GABLE_WALL_PANEL_DEFAULTS.gableSheetAllowanceIn,
    ),
    sheetLengthRoundingIn: num(
      input.sheetLengthRoundingIn,
      GABLE_WALL_PANEL_DEFAULTS.sheetLengthRoundingIn,
    ),
    numberOfGableEnds: num(
      input.numberOfGableEnds,
      GABLE_WALL_PANEL_DEFAULTS.numberOfGableEnds,
    ),
  };

  // Feet in at the edge; inches everywhere after this line.
  const buildingWidthIn = num(input.buildingWidthFt) * 12;
  const eaveHeightIn = num(input.eaveHeightFt) * 12;
  const roofPitchRise = num(input.roofPitchRise, 4);

  const halfSpanIn = buildingWidthIn / 2;
  const gableRiseIn = halfSpanIn * (roofPitchRise / 12);
  const geometry = {
    buildingWidthIn,
    eaveHeightIn,
    halfSpanIn,
    gableRiseIn,
    ridgeHeightIn: eaveHeightIn + gableRiseIn,
    ridgeXIn: halfSpanIn,
  };
  const g = { buildingWidthIn, eaveHeightIn, roofPitchRise };

  const panels = gablePanelSpansIn(buildingWidthIn, cfg.panelCoverageIn).map(
    ({ startIn, endIn }, i) => {
      const highX = highestPointXIn(startIn, endIn, buildingWidthIn);
      const geometricRoofHeightIn = roofHeightAtIn(highX, g);
      const rawRequiredLengthIn = geometricRoofHeightIn + cfg.gableSheetAllowanceIn;
      const orderedLengthIn = roundUpToIncrementIn(
        rawRequiredLengthIn,
        cfg.sheetLengthRoundingIn,
      );
      return {
        panelNumber: i + 1,
        panelStartXIn: startIn,
        panelEndXIn: endIn,
        coveredWidthIn: endIn - startIn,
        isPartial: endIn - startIn < cfg.panelCoverageIn - EPS,
        // The ridge is strictly inside when it is not on either seam.
        ridgeInsidePanel:
          halfSpanIn > startIn + EPS && halfSpanIn < endIn - EPS,
        highestPointXIn: highX,
        geometricRoofHeightIn,
        allowanceIn: cfg.gableSheetAllowanceIn,
        rawRequiredLengthIn,
        orderedLengthIn,
        orderedLength: formatInches(orderedLengthIn),
      };
    },
  );

  // One gable end is calculated, then multiplied — the ends are identical, and
  // working it twice would only invite them to drift apart.
  const byLength = new Map();
  for (const p of panels) {
    const key = Math.round(p.orderedLengthIn * 1000) / 1000;
    byLength.set(key, (byLength.get(key) || 0) + 1);
  }
  const ends = Math.max(0, Math.round(cfg.numberOfGableEnds));
  const order = [...byLength.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([lengthIn, qtyPerGable]) => ({
      lengthIn,
      length: formatInches(lengthIn),
      qtyPerGable,
      qty: qtyPerGable * ends,
    }));

  const longestPanelIn = panels.reduce((m, p) => Math.max(m, p.orderedLengthIn), 0);

  return {
    inputs: {
      buildingWidthFt: num(input.buildingWidthFt),
      eaveHeightFt: num(input.eaveHeightFt),
      roofPitchRise,
      ...cfg,
    },
    geometry,
    panels,
    panelsPerGable: panels.length,
    totalPanels: panels.length * ends,
    order,
    longestPanelIn,
    longestPanel: formatInches(longestPanelIn),
  };
}

/**
 * The per-panel working, as a table. For verifying a job by hand — every column
 * the calculation used, so a wrong answer can be traced to the step that made
 * it rather than re-derived from the result.
 */
export function describeGableWallPanels(result) {
  const lines = [
    '  #   start     end    highest    roof   +allow      raw    order',
  ];
  for (const p of result.panels) {
    lines.push(
      [
        String(p.panelNumber).padStart(3),
        formatInches(p.panelStartXIn).padStart(8),
        formatInches(p.panelEndXIn).padStart(8),
        formatInches(p.highestPointXIn).padStart(9),
        formatInches(p.geometricRoofHeightIn).padStart(8),
        `${p.allowanceIn}"`.padStart(7),
        formatInches(p.rawRequiredLengthIn).padStart(9),
        p.orderedLength.padStart(8),
      ].join(''),
    );
  }
  lines.push('');
  for (const o of result.order) {
    lines.push(`  ${o.length} × ${o.qty}   (${o.qtyPerGable} per gable)`);
  }
  return lines.join('\n');
}
