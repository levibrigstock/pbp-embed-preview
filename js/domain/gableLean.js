/**
 * Where a gable lean-to's ridge sits, and where it meets the main roof.
 *
 * This lived inside js/render/scene.js, where the only way to exercise it was
 * to launch a browser and measure pixels. Extracting it costs nothing and lets
 * scripts/gable-lean-check.mjs say what the numbers actually are.
 *
 * Two rules live here on purpose.
 *
 *   'pinned'  — what ships today. The ridge is placed at a fixed distance up
 *               the MAIN roof (3.5' in from the eave tip) and the wing's eave
 *               is back-derived as peak minus rise, floored at the eave
 *               height. The wing's own pitch and eave height never reach the
 *               peak, so the drawn pitch is whatever the main building
 *               implies: a 24' wing at 8/12 off a 13' eave draws a 2.4' rise
 *               instead of 8'.
 *
 *   'wingCapped' — the wing's own ridge height, but the intrusion onto the
 *               main roof held to the distance 'pinned' used. Correct pitch
 *               and eave, trim that stays where it belongs.
 *
 *   'wing'    — the ridge is the wing's own eave plus its own rise, and where
 *               it lands on the main roof follows from that. Correct pitch,
 *               but it also moves ontoRoof from a fixed 3.5' to a true plane
 *               intersection, which on a tall wing runs most of the way up the
 *               main roof and drags the valley flashes and rake trim with it.
 *               Shipped once, reverted in fd397be.
 *
 * Keeping both means the difference can be measured and rendered instead of
 * argued about. 'pinned' is the default; nothing changes unless a caller asks.
 *
 * Heights are in feet, matching the renderer's world units (FT = 1).
 */

/** Small offsets the renderer uses to keep metal off the structure it covers. */
export const GABLE_LEAN_EPS = {
  /** Lean eave metal sits just above the wall top. */
  eaveLift: 0.02,
  /** Main roof metal surface above the main eave. */
  roofTop: 0.02,
  /** Lean roof sits ON the main roof metal, not under it. */
  onRoofLift: 0.22,
  /** Ridge peak a touch above the outer peak so the cap reads. */
  peakLift: 0.06,
};

/** How far up the main roof the 'pinned' rule puts the ridge. */
export const PINNED_ONTO_ROOF_FT = 3.25;

/**
 * Number() that falls back on NaN, not just null/undefined.
 *
 * `Number(x) ?? d` looks like a default but never fires for a missing field:
 * Number(undefined) is NaN, and ?? passes NaN straight through. That poisoned
 * every downstream value — a building with no metalOverhangIn produced NaN for
 * the whole calculation. It never showed in the app because createProject
 * always sets the field.
 */
function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * @param {object} b    main building { width, length, eaveHeight, pitch, metalOverhangIn, overhangIn }
 * @param {object} lt   lean-to { wall, length, pitch, eaveHeight }
 * @param {object} opts { rule, mainEaveY, leanEaveY, roofRiseFt }
 * @returns {{
 *   rule:string, eaveY:number, outerPeakY:number, peakY:number, ontoRoof:number,
 *   riseFt:number, drawnRiseFt:number, mainSlope:number, roofTop:number,
 *   halfSpan:number, mainRidgeY:number, aboveMainEave:boolean, overMainRidge:boolean
 * }}
 */
export function gableLeanGeometry(b, lt, opts = {}) {
  const E = GABLE_LEAN_EPS;
  const rule =
    opts.rule === 'wing' || opts.rule === 'wingCapped' ? opts.rule : 'pinned';

  const leanLen = Math.max(0, num(lt?.length, 0));
  const halfW = leanLen / 2 || 1;
  const leanPitch = num(lt?.pitch, 3);
  /** What the wing's pitch and width ask for. */
  const riseFt = halfW * (leanPitch / 12);

  const mainEaveY = num(opts.mainEaveY, num(b?.eaveHeight, 12));
  const leanEaveY = num(opts.leanEaveY, num(lt?.eaveHeight, 10));

  const mainOhFt = (num(b?.metalOverhangIn, 3) + num(b?.overhangIn, 0)) / 12;
  const mainRise = num(
    opts.roofRiseFt,
    (num(b?.width, 40) / 2) * (num(b?.pitch, 4) / 12),
  );

  const onSideWall = lt?.wall === 'left' || lt?.wall === 'right';
  const halfSpan =
    (onSideWall ? num(b?.width, 40) / 2 : num(b?.length, 40) / 2) + mainOhFt;
  const mainSlope = mainRise / Math.max(halfSpan, 1);
  const roofTop = mainEaveY + E.roofTop;

  let eaveY;
  let outerPeakY;
  let peakY;
  let ontoRoof;

  if (rule === 'wing' || rule === 'wingCapped') {
    eaveY = leanEaveY + E.eaveLift;
    outerPeakY = eaveY + riseFt;
    peakY = outerPeakY + E.peakLift;
    // Where that ridge actually crosses the main roof plane. At or below the
    // main eave it dies into the WALL instead, so it stays at the eave line.
    const aboveRoof = peakY - roofTop - E.onRoofLift;
    const trueOnto =
      aboveRoof > 0
        ? Math.min(aboveRoof / Math.max(mainSlope, 0.01), halfSpan - 0.5)
        : Math.max(mainOhFt, 0.15);
    // The true intersection is geometrically right and visually wrong: on a
    // 40' building a tall wing lands ~20' up the main roof, and the valley
    // flashes, rake trim and plane extents all follow it out there. That is
    // what fd397be looked like. 'wingCapped' keeps the honest ridge height
    // but holds the intrusion at the tidy distance the old code used, so the
    // valley is a little steeper than true and the trim stays put.
    ontoRoof =
      rule === 'wingCapped'
        ? Math.min(trueOnto, Math.max(mainOhFt + PINNED_ONTO_ROOF_FT, 3.5))
        : trueOnto;
  } else {
    ontoRoof = Math.max(mainOhFt + PINNED_ONTO_ROOF_FT, 3.5);
    peakY = roofTop + ontoRoof * mainSlope + E.onRoofLift;
    outerPeakY = peakY - E.peakLift;
    eaveY = Math.max(leanEaveY + E.eaveLift, outerPeakY - riseFt);
  }

  return {
    rule,
    eaveY,
    outerPeakY,
    peakY,
    ontoRoof,
    riseFt,
    /** What actually gets drawn, which under 'pinned' need not equal riseFt. */
    drawnRiseFt: outerPeakY - eaveY,
    mainSlope,
    roofTop,
    halfSpan,
    mainRidgeY: mainEaveY + mainRise,
    aboveMainEave: peakY - roofTop - E.onRoofLift > 0,
    overMainRidge: outerPeakY > mainEaveY + mainRise,
  };
}

/**
 * Where a gable wing's roof actually meets the main structure.
 *
 * Both surfaces are planes, and each varies in only ONE direction, which is
 * what makes this solvable in closed form rather than by clipping meshes:
 *
 *   main roof, by inward distance d from the eave tip : y = roofTop + mainSlope*d
 *   wing roof, by along-wall offset s from its ridge  : y = ridgeY  - k*|s|
 *
 * Setting them equal gives d as a linear function of |s| — so the valley is a
 * STRAIGHT line in plan, deepest at the wing ridge and running back out to the
 * eave tip. Where the wing has dropped below the main eave there is no valley
 * at all: that part of the wing dies into the WALL instead, and the boundary
 * between the two is exactly |s| = sEdge.
 *
 * Returned in the wing's own frame. The renderer maps (s, d) onto world axes
 * with its along-wall and outward unit vectors; keeping this frame-free is
 * what lets it be tested without a browser.
 *
 * @param {object} p
 * @param {number} p.ridgeY     wing ridge height (ft)
 * @param {number} p.eaveY      wing eave height (ft), level the whole way out
 * @param {number} p.halfWidth  half the wing's width along the wall (ft)
 * @param {number} p.roofTop    main roof surface height at its eave tip (ft)
 * @param {number} p.mainSlope  main roof rise per foot inward
 * @param {number} p.halfSpan   eave tip to main ridge (ft)
 * @returns {{
 *   kind:'wall'|'mixed'|'roof', sEdge:number, ridgeD:number, wallRun:number,
 *   valley:Array<{s:number,d:number,y:number}>, overMainRidge:boolean,
 *   kWing:number
 * }}
 */
export function gableLeanValley(p = {}) {
  const ridgeY = num(p.ridgeY, 0);
  const eaveY = num(p.eaveY, 0);
  const halfWidth = Math.max(num(p.halfWidth, 1), 0.01);
  const roofTop = num(p.roofTop, 0);
  const mainSlope = Math.max(num(p.mainSlope, 0.01), 0.001);
  const halfSpan = Math.max(num(p.halfSpan, 1), 0.01);

  // Fall of the wing roof per foot along the wall.
  const kWing = Math.max(0, (ridgeY - eaveY) / halfWidth);
  const above = ridgeY - roofTop;

  /** Inward distance at which the wing surface at offset s meets the main roof. */
  const dAt = (s) => (ridgeY - kWing * Math.abs(s) - roofTop) / mainSlope;

  // Nothing of the wing reaches the main eave: it is a wall tie-in end to end.
  if (above <= 0) {
    return {
      kind: 'wall',
      sEdge: 0,
      sRidge: 0,
      ridgeD: 0,
      wallRun: 2 * halfWidth,
      overRidgeRun: 0,
      valley: [],
      overMainRidge: false,
      kWing,
    };
  }

  // A level wing roof (no fall) is above the eave everywhere or nowhere.
  const sEdge = kWing > 1e-9 ? Math.min(halfWidth, above / kWing) : halfWidth;

  // Near its own ridge a tall wing can be higher than the MAIN ridge, and
  // there it has no valley on this slope at all — it has crossed over the top
  // and would meet the far side. Clamping the inward distance to halfSpan
  // there looked fine and was wrong: it bent the line and put points off the
  // wing surface. Report that band instead of pretending it is a valley.
  const sRidge =
    kWing > 1e-9
      ? Math.max(0, Math.min(sEdge, (above - mainSlope * halfSpan) / kWing))
      : 0;

  const sLo = sRidge;
  const sHi = sEdge;

  // Straight in plan, so three points on one side describe it completely; the
  // midpoint is carried so a caller can assert straightness rather than trust
  // this comment. The other side mirrors.
  const at = (s) => {
    const d = (ridgeY - kWing * Math.abs(s) - roofTop) / mainSlope;
    return { s, d, y: roofTop + mainSlope * d };
  };
  const valley = sHi - sLo > 1e-9 ? [at(sLo), at((sLo + sHi) / 2), at(sHi)] : [];

  const full = sEdge >= halfWidth - 1e-9 && sRidge <= 1e-9;
  return {
    kind: full ? 'roof' : 'mixed',
    /** |s| where the valley comes back out to the main eave tip (d = 0). */
    sEdge,
    /** |s| inside which the wing is above the MAIN ridge — no valley there. */
    sRidge,
    ridgeD: at(sLo).d,
    /** Along-wall length that dies into the wall rather than the roof. */
    wallRun: Math.max(0, 2 * (halfWidth - sEdge)),
    /** Along-wall length that clears the main ridge entirely. */
    overRidgeRun: 2 * sRidge,
    valley,
    overMainRidge: sRidge > 1e-9,
    kWing,
  };
}
