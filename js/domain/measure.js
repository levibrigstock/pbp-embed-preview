/**
 * measure.js — the tape measure.
 *
 * One place that knows how far it is from one point on a building to another.
 * Everything that needs a length — the takeoff, the plan sheets, the 3D scene —
 * asks here instead of re-deriving pitch math on its own. Before this module the
 * same triangle was solved in eight files, which is why the plans could draw a
 * rafter the material list never ordered.
 *
 * ── The rules ────────────────────────────────────────────────────────────────
 *
 * 1. MEASURE ALONG THE ROOF PLANE, NOT ALONG THE GROUND.
 *    Ridge to eave is the hypotenuse: hypot(run, run × pitch/12). The old code
 *    pushed the overhang out on the horizontal run and left the rise alone,
 *    which quietly under-measured the slope.
 *
 * 2. A FRAMED OVERHANG IS ROOF; A METAL OVERHANG IS SHEET.
 *    A framed overhang carries on down the same plane, so it grows the run AND
 *    the rise — the purlins, the sheet, and whichever member carries that roof
 *    all get longer. WHICH member depends on how the structure is framed: on a
 *    trussed building the overhang extends the TRUSS, and it extends a RAFTER
 *    only where the roof is framed with rafters, principally a shed lean-to.
 *    A metal-only overhang is the sheet hanging past the framing as a drip; it
 *    adds its own length ALONG THE SLOPE and touches no framing member at all.
 *
 * 3. ROUND UP TO THE NEXT WHOLE INCH, NEVER DOWN.
 *    A sheet an inch long gets trimmed on site. A sheet an inch short is scrap.
 *
 * 4. HEIGHT IS MEASURED FROM THE FLOOR SOMEBODY STANDS ON.
 *    An entered eave height is the headroom expected above the finished floor
 *    — the top of the slab when there is one, grade when there is not. So a
 *    slab lifts the whole frame instead of eating into the headroom, and every
 *    length taken from the ground comes off frameEaveHeightFt().
 *
 * ── The anchor ───────────────────────────────────────────────────────────────
 *
 * Levi's worked example, which this module reproduces exactly:
 *
 *   50′ wide, 4/12 pitch, 3″ metal-only overhang → roof sheets measure 26′8″.
 *
 *     half run        25′0″
 *     rise            8′4″            (25 × 4/12)
 *     ridge → eave    26′4.23″        hypot(25, 8.3333)
 *     + 3″ drip       26′7.23″        along the slope
 *     ceil to inch    26′8″           ← the cut
 *
 * What this replaced was that same slope with the overhang folded into the
 * horizontal run (26′7.08″) plus a banded "order add" constant of 1.5″, 2″ or
 * 5.5″ chosen by slope length and overhang width. Each band had been fitted to
 * one job, and on this example they stacked up to 26′9″. The bands are gone: the
 * only thing added to a measured slope now is an overhang somebody actually
 * entered.
 */

/** One inch, in feet. */
export const IN = 1 / 12;

/**
 * Metal drips past the eave even when the overhang field reads 0 — production
 * never lets a sheet stop dead on the wall line. An explicit entry wins.
 */
export const METAL_DRIP_MIN_IN = 3;

/** A framed overhang at or above this is real framing, not a drip edge. */
export const FRAMED_OVERHANG_MIN_IN = 6;

// ── inch arithmetic ─────────────────────────────────────────────────

const num = (v, dflt = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

/** Up to the next whole inch. Cut lengths use this — long trims, short scraps. */
export function ceilToInch(ft) {
  return Math.ceil(num(ft) * 12 - 1e-9) / 12;
}

/** Down to the whole inch. For clearances, not cuts. */
export function floorToInch(ft) {
  return Math.floor(num(ft) * 12 + 1e-9) / 12;
}

/** Nearest inch. For reporting a measurement, not for ordering stock. */
export function roundToInch(ft) {
  return Math.round(num(ft) * 12) / 12;
}

/** 26.6667 → `26'8"`. Feet-and-inches for plans, labels and check output. */
export function formatFtIn(ft) {
  const total = Math.round(num(ft) * 12);
  const sign = total < 0 ? '-' : '';
  const t = Math.abs(total);
  return `${sign}${Math.floor(t / 12)}'${t % 12}"`;
}

/**
 * Parse a feet/inches field into decimal feet.
 *
 * Matches what formatFtIn prints (`4'6"`, `12'0"`) and the usual typed forms:
 * `4' 6"`, `4'`, `54"`, fractions (`4' 6 1/2"`, `6 1/2"`), and decimal feet
 * with a tick (`8.5'`). A bare number with no foot mark is INCHES — that is
 * how custom opening offsets are entered on site (type `96` or `96"` for 8').
 * Pass a number and it is treated as feet already (stored offsets, math).
 */
export function parseFtIn(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const s0 = String(raw ?? '').trim();
  if (!s0) return 0;
  const sign = s0.startsWith('-') ? -1 : 1;
  const s = s0.replace(/^[+-]/, '').trim();
  if (!s) return 0;

  // feet + inches + fraction: 3' 7 1/2"
  const fiFrac = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(\d+)\s+(\d+)\s*\/\s*(\d+)\s*"?$/);
  if (fiFrac) {
    const inches =
      parseInt(fiFrac[2], 10) + parseInt(fiFrac[3], 10) / parseInt(fiFrac[4], 10);
    return sign * (parseFloat(fiFrac[1]) + inches / 12);
  }
  // feet + inches: 26' 7" or 26'7" (formatFtIn round-trips here)
  const fi = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)\s*"?$/);
  if (fi) return sign * (parseFloat(fi[1]) + parseFloat(fi[2]) / 12);
  // feet only: 8' or 8.5'
  const ftOnly = s.match(/^(\d+(?:\.\d+)?)\s*'$/);
  if (ftOnly) return sign * parseFloat(ftOnly[1]);
  // inches + fraction, no feet: 7 1/2"
  const inFrac = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)\s*"$/);
  if (inFrac) {
    const inches =
      parseInt(inFrac[1], 10) + parseInt(inFrac[2], 10) / parseInt(inFrac[3], 10);
    return sign * (inches / 12);
  }
  // inches with quote: 54" or 6.5"
  const inOnly = s.match(/^(\d+(?:\.\d+)?)\s*"$/);
  if (inOnly) return sign * (parseFloat(inOnly[1]) / 12);
  // bare number → inches (opening-offset UI convention)
  if (/^\d+(?:\.\d+)?$/.test(s)) return sign * (parseFloat(s) / 12);
  return 0;
}

// ── the height datum ────────────────────────────────────────────────

/**
 * Slab thickness in feet, or 0 when the building has no slab.
 */
export function slabThicknessFt(b) {
  if (b?.hasSlab !== true) return 0;
  return Math.max(0, num(b?.slabThicknessIn)) / 12;
}

/**
 * Eave height measured FROM GRADE — what the frame actually has to stand.
 *
 * The eave height somebody types in is the height they expect to have above
 * the floor they will be standing on. Which surface that is depends on the
 * building: the top of the slab when there is one, and grade when there is
 * not. So a slab does not eat into the headroom — it lifts the whole frame.
 *
 *   12′ entered, no slab    → 12′0″ of post above grade
 *   12′ entered, 4″ slab    → 12′4″ of post above grade, a true 12′ from the
 *                             slab to the bottom of a common truss
 *
 * Building 12′ from grade under a 4″ slab leaves 11′8″ of usable height, which
 * is a different building from the one that was ordered. Everything measured
 * from the ground — post lengths, girt rows, wall sheets, the plan elevations
 * and the 3D model — has to come off this, not off the raw input.
 */
export function frameEaveHeightFt(b) {
  return num(b?.eaveHeight, 12) + slabThicknessFt(b);
}

/**
 * Top of wall above grade: the frame eave height plus any raised truss heel.
 */
export function wallTopAboveGradeFt(b) {
  return frameEaveHeightFt(b) + Math.max(0, num(b?.heelHeightFt));
}

// ── pitch ───────────────────────────────────────────────────────────

/** Rise per 12″ of run. Defaults to 4/12. */
export function pitchPer12(b) {
  const p = num(b?.pitch, 4);
  return p > 0 ? p : 4;
}

/** Feet of roof plane per foot of horizontal run. 4/12 → 1.0541. */
export function slopeFactor(pitchIn12) {
  const p = num(pitchIn12, 4) / 12;
  return Math.hypot(1, p);
}

// ── overhangs ───────────────────────────────────────────────────────

/**
 * Framed overhang at the eave (ft) — truss tail past the wall line.
 * `overhangEaveIn` wins over the legacy shared `overhangIn`.
 */
export function framedEaveOverhangFt(b) {
  const v =
    b?.overhangEaveIn != null && Number.isFinite(Number(b.overhangEaveIn))
      ? Number(b.overhangEaveIn)
      : num(b?.overhangIn);
  return Math.max(0, v) / 12;
}

/** Framed overhang at the gable / rake (ft) — fly rafter past the end wall. */
export function framedGableOverhangFt(b) {
  const v =
    b?.overhangGableIn != null && Number.isFinite(Number(b.overhangGableIn))
      ? Number(b.overhangGableIn)
      : num(b?.overhangIn);
  return Math.max(0, v) / 12;
}

/**
 * Metal-only overhang at the eave (ft), floored at the production drip.
 * This is sheet past framing, measured along the slope.
 */
export function metalEaveOverhangFt(b) {
  if (b?.metalOverhangEaveIn != null && Number.isFinite(Number(b.metalOverhangEaveIn))) {
    const m = Number(b.metalOverhangEaveIn);
    if (m > 0) return m / 12;
  }
  const m = num(b?.metalOverhangIn);
  if (m > 0) return m / 12;
  return METAL_DRIP_MIN_IN / 12;
}

/** Metal-only overhang at the gable / rake (ft). */
export function metalGableOverhangFt(b) {
  if (b?.metalOverhangGableIn != null && Number.isFinite(Number(b.metalOverhangGableIn))) {
    const m = Number(b.metalOverhangGableIn);
    if (m > 0) return m / 12;
  }
  const m = num(b?.metalOverhangIn);
  if (m > 0) return m / 12;
  return METAL_DRIP_MIN_IN / 12;
}

/** True when the eave overhang is framed rather than a bare drip edge. */
export function hasFramedEaveOverhang(b) {
  return framedEaveOverhangFt(b) * 12 >= FRAMED_OVERHANG_MIN_IN - 1e-9;
}

// ── the roof plane ──────────────────────────────────────────────────

/**
 * Horizontal run from the high point down to the wall line, one plane (ft).
 * Gable: half the width. Mono: the whole width.
 */
export function roofWallRunFt(b) {
  const W = num(b?.width);
  return (b?.roofStyle || 'gable') === 'mono' ? W : W / 2;
}

/**
 * Measure one roof plane, ridge (or high wall) down to the drip edge.
 *
 * Every override is optional and exists so leans, wings and cross gables can
 * measure their own plane with the same rule instead of copying the formula:
 *
 * @param {object} b building
 * @param {object} [o]
 * @param {number} [o.runFt]        horizontal run to the wall line, overriding width
 * @param {number} [o.pitch]        rise per 12, overriding the building's
 * @param {number} [o.framedOhFt]   framed overhang past the wall line
 * @param {number} [o.metalOhFt]    metal drip past the framing, along the slope
 * @param {number} [o.riseRunFt]    run the RISE is taken over, when it differs from
 *                                  the run the slope covers (a gable extension
 *                                  rises over the host's half-span)
 * @returns {{
 *   wallRunFt:number, framedOhFt:number, runFt:number, riseFt:number,
 *   slopeFactor:number, structuralSlopeFt:number, metalOhFt:number,
 *   panelSlopeFt:number, panelCutFt:number,
 * }}
 */
export function measureRoofPlane(b, o = {}) {
  const pitch = o.pitch != null ? num(o.pitch, 4) : pitchPer12(b);
  const ratio = pitch / 12;

  const wallRunFt = o.runFt != null ? Math.max(0, num(o.runFt)) : roofWallRunFt(b);
  const framedOhFt =
    o.framedOhFt != null ? Math.max(0, num(o.framedOhFt)) : framedEaveOverhangFt(b);
  const metalOhFt =
    o.metalOhFt != null ? Math.max(0, num(o.metalOhFt)) : metalEaveOverhangFt(b);

  // Rule 2: framed overhang is roof, so it is part of the run the plane covers.
  const runFt = wallRunFt + framedOhFt;
  // The rise normally comes off that same run. A gable extension is the one
  // case where it does not — it rises over the host's half-span while its own
  // plane runs further — so the caller can say so instead of forking the math.
  const riseFt = (o.riseRunFt != null ? Math.max(0, num(o.riseRunFt)) : runFt) * ratio;

  // Rule 1: measure the hypotenuse.
  const structuralSlopeFt = Math.hypot(runFt, riseFt);
  // Rule 2 again: the drip is sheet, added along the plane, framing untouched.
  const panelSlopeFt = structuralSlopeFt + metalOhFt;

  return {
    wallRunFt,
    framedOhFt,
    runFt,
    riseFt,
    slopeFactor: slopeFactor(pitch),
    structuralSlopeFt,
    metalOhFt,
    panelSlopeFt,
    // Rule 3.
    panelCutFt: ceilToInch(panelSlopeFt),
  };
}

/**
 * Roof sheet cut length for the main building (ft).
 * 50′ @ 4/12 with a 3″ metal overhang → 26.6667 (26′8″).
 */
export function roofPanelCutFt(b) {
  return measureRoofPlane(b).panelCutFt;
}

/**
 * Ridge to the outside face of the framing, along the plane (ft).
 * This is the length framing cares about — rafter tails, purlin runs, the line
 * the plans draw — with no sheet drip in it.
 */
export function roofStructuralSlopeFt(b) {
  return measureRoofPlane(b).structuralSlopeFt;
}

// ── walls ───────────────────────────────────────────────────────────

/**
 * The wall measurements the sheets and the plans hang off, geometry only —
 * no stock snapping and no order allowance, which belong to whoever is buying.
 *
 * @returns {{
 *   eaveTopFt:number, peakFt:number, halfWidthFt:number,
 *   rakeRunFt:number, rakeSlopeFt:number, gableRiseFt:number,
 * }}
 */
export function measureWalls(b) {
  const ratio = pitchPer12(b) / 12;
  const half = num(b?.width) / 2;

  // Top of wall above GRADE — where the sheet's square top lands. A raised heel
  // lifts it, and so does a slab, which raises the whole frame rather than
  // eating into the headroom (see frameEaveHeightFt).
  const eaveTopFt = wallTopAboveGradeFt(b);
  // The gable's tallest point, straight up from the centre of the end wall.
  const gableRiseFt = half * ratio;
  const peakFt = eaveTopFt + gableRiseFt;

  // The rake: peak out to the corner of the end wall, plus any fly framing.
  const rakeRunFt = half + framedGableOverhangFt(b);
  const rakeSlopeFt = Math.hypot(rakeRunFt, rakeRunFt * ratio);

  return { eaveTopFt, peakFt, halfWidthFt: half, rakeRunFt, rakeSlopeFt, gableRiseFt };
}

/**
 * Height of a gable wall sheet standing `xFromCornerFt` in from the end-wall
 * corner (ft), measured to the underside of the roof line. Sheets are ordered
 * by their TALL edge, so a 3′ sheet is measured at the edge nearer the peak.
 */
export function gableWallHeightAtFt(b, xFromCornerFt) {
  const { eaveTopFt, halfWidthFt, gableRiseFt } = measureWalls(b);
  const x = Math.min(Math.max(0, num(xFromCornerFt)), num(b?.width));
  // Distance in from whichever corner is nearer — the gable is symmetric.
  const fromNearest = Math.min(x, num(b?.width) - x);
  if (halfWidthFt <= 0) return eaveTopFt;
  return eaveTopFt + gableRiseFt * (fromNearest / halfWidthFt);
}

/** Everything, measured once, for a caller that wants the whole tape. */
export function measureBuilding(b) {
  return {
    roof: measureRoofPlane(b),
    walls: measureWalls(b),
    pitch: pitchPer12(b),
  };
}
