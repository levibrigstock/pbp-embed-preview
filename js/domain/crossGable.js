/**
 * A cross gable over an entry: a small gable whose ridge runs out perpendicular
 * to the main ridge, cutting into the main roof with two valleys.
 *
 * It is NOT an ell, and the difference is the whole reason this is its own
 * module. An ell is a building — footprint, posts to grade, slab, its own
 * walls, its own line on the takeoff as a building. A cross gable has none of
 * that. It is a roof feature: two small roof planes, a gable face above the
 * entry, and the valleys where it dies into the roof it sits on. Modelling it
 * as a tiny building would bill posts, girts and a slab nobody pours.
 *
 * The junction maths is the same plane-meets-plane solve the gable lean-to and
 * the ell already use, so gableLeanValley is reused a third time rather than
 * rewritten. What is new here is everything that is not the valley: where the
 * ridge sits, how much roof the feature itself needs, the triangle you see from
 * the front, and how much MAIN roof it covers and therefore replaces.
 *
 * `projection` is how far it sticks out past the wall:
 *   0  — it sits entirely on the roof (a dormer over a flush entry)
 *   >0 — it oversails the wall, and the outer corners want posts, not walls,
 *        because an entry gable covers a porch rather than enclosing a room.
 *
 * Lengths are feet. Frame-free, like ell.js: positions come back as offsets
 * along the wall and outward from it, so scripts/cross-gable-check.mjs can
 * assert the numbers without a browser.
 */

import { gableLeanValley } from './gableLean.js?v=20260916k';

/** Walls a cross gable can sit on. Only eave walls make a valley. */
export const CROSS_GABLE_WALLS = ['left', 'right', 'front', 'back'];

/**
 * Number() that falls back on NaN, not just null/undefined.
 *
 * `Number(x) ?? d` never fires for a missing field — Number(undefined) is NaN
 * and ?? passes NaN straight through. Same trap as gableLean.js and ell.js.
 */
function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Length of the wall a cross gable sits on. */
export function crossGableWallLength(host, wall) {
  return wall === 'front' || wall === 'back'
    ? num(host?.width, 0)
    : num(host?.length, 0);
}

/**
 * The full cross gable.
 *
 * @param {object} host main building { width, length, eaveHeight, pitch, roofStyle }
 * @param {object} cg   { wall, offset, width, projection, pitch, eaveHeight }
 * @returns {{
 *   supported:boolean, reason:string, warnings:string[],
 *   wall:string, alongStart:number, alongEnd:number, alongCentre:number,
 *   widthFt:number, projectionFt:number, eaveY:number, ridgeY:number,
 *   riseFt:number, kGable:number, hostEaveY:number, hostSlope:number,
 *   hostRidgeY:number, valley:object|null, valleyRunFt:number,
 *   ridgeIntoRoofFt:number, roofAreaSqFt:number, faceAreaSqFt:number,
 *   coveredRoofSqFt:number
 * }}
 */
export function crossGableGeometry(host, cg = {}) {
  const warnings = [];
  const wall = CROSS_GABLE_WALLS.includes(cg.wall) ? cg.wall : 'left';
  const onEave = wall === 'left' || wall === 'right';

  const hostW = Math.max(num(host?.width, 0), 0.01);
  const hostEaveY = num(host?.eaveHeight, 12);
  const hostSlope = num(host?.pitch, 4) / 12;
  const hostHalfSpan = hostW / 2;
  const hostRidgeY = hostEaveY + hostHalfSpan * hostSlope;

  const wallLen = crossGableWallLength(host, wall);
  const widthRaw = Math.max(num(cg.width, 8), 0.01);
  const widthFt = Math.min(widthRaw, Math.max(0.01, wallLen));
  if (widthFt < widthRaw - 1e-9) {
    warnings.push('width trimmed to fit the wall');
  }
  const maxStart = Math.max(0, wallLen - widthFt);
  const alongStart = Math.min(Math.max(0, num(cg.offset, 0)), maxStart);
  if (Math.abs(alongStart - num(cg.offset, 0)) > 1e-9) {
    warnings.push('offset pulled back so the gable stays on the wall');
  }

  const projectionFt = Math.max(0, num(cg.projection, 0));
  const kGable = Math.max(0, num(cg.pitch, num(host?.pitch, 4)) / 12);
  // Its eave continues the main eave line unless asked otherwise. Below that
  // line it would be a lean-to, not a cross gable.
  const eaveY = Math.max(hostEaveY, num(cg.eaveHeight, hostEaveY));
  const halfWidth = widthFt / 2;
  const riseFt = halfWidth * kGable;
  const ridgeY = eaveY + riseFt;

  const base = {
    warnings,
    wall,
    onEave,
    wallLen,
    alongStart,
    alongEnd: alongStart + widthFt,
    alongCentre: alongStart + halfWidth,
    widthFt,
    projectionFt,
    eaveY,
    ridgeY,
    riseFt,
    kGable,
    hostEaveY,
    hostSlope,
    hostRidgeY,
  };

  // A gable END has no sloping surface running away from it — the wall there
  // is a vertical triangle. A gable projecting off it dies into that wall as a
  // headwall, which is a different junction and not solved here.
  if (!onEave) {
    return {
      ...base,
      supported: false,
      reason: 'a cross gable on a gable end is a headwall, not a valley — not solved',
      valley: null,
      valleyRunFt: 0,
      ridgeIntoRoofFt: 0,
      roofAreaSqFt: 0,
      faceAreaSqFt: 0,
      coveredRoofSqFt: 0,
    };
  }
  if ((host?.roofStyle || 'gable') !== 'gable') {
    return {
      ...base,
      supported: false,
      reason: 'host roof is not a gable — junction not solved',
      valley: null,
      valleyRunFt: 0,
      ridgeIntoRoofFt: 0,
      roofAreaSqFt: 0,
      faceAreaSqFt: 0,
      coveredRoofSqFt: 0,
    };
  }
  if (!(kGable > 1e-9)) {
    return {
      ...base,
      supported: false,
      reason: 'a cross gable needs a pitch to make a ridge',
      valley: null,
      valleyRunFt: 0,
      ridgeIntoRoofFt: 0,
      roofAreaSqFt: 0,
      faceAreaSqFt: 0,
      coveredRoofSqFt: 0,
    };
  }

  const valley = gableLeanValley({
    ridgeY,
    eaveY,
    halfWidth,
    roofTop: hostEaveY,
    mainSlope: Math.max(hostSlope, 0.001),
    halfSpan: hostHalfSpan,
  });

  // Over the main ridge there is no single slope to die into: the gable breaks
  // out through the far side and the feature carries on past the peak. The near
  // slope's numbers alone would under-report it, so this is declined rather
  // than half-answered.
  if (ridgeY > hostRidgeY + 0.01) {
    warnings.push(
      'its ridge is above the main ridge — it would break out through the far slope',
    );
    return {
      ...base,
      supported: false,
      reason: 'cross gable ridge is above the main ridge — not solved',
      valley,
      valleyRunFt: 0,
      ridgeIntoRoofFt: 0,
      roofAreaSqFt: 0,
      faceAreaSqFt: 0,
      coveredRoofSqFt: 0,
    };
  }

  /** Inward reach of the valley at |s| off the ridge. */
  const dAt = (s) =>
    (ridgeY - kGable * Math.abs(s) - hostEaveY) / Math.max(hostSlope, 0.001);
  const dRidge = dAt(0);
  const dEdge = dAt(halfWidth);

  // ∫ d(s) ds over one half is a plain trapezoid, and by this point that is
  // EXACT rather than an approximation, because both ways d could bend have
  // already been ruled out above:
  //
  //   d(0) = (ridgeY - hostEaveY)/hostSlope <= hostHalfSpan, since a ridge over
  //          the main ridge is declined — so it never caps at the top;
  //   d(halfWidth) = (eaveY - hostEaveY)/hostSlope >= 0, since the eave is held
  //          at or above the main eave — so it never bottoms out at zero.
  //
  // d is therefore linear across the whole range and the mean of its ends is
  // the mean. A first version carried the capped piecewise form as well; with
  // over-ridge declined the cap can never fire, so no test could reach that
  // branch and it came out rather than ship untested.
  const dIntegral = (halfWidth * (dRidge + dEdge)) / 2;

  // One slope in plan: from the outer edge at -projection in to the valley.
  const planPerSlope = projectionFt * halfWidth + dIntegral;
  // Its own roof slopes along the wall, so the true surface is the plan area
  // stretched by its own pitch.
  const roofAreaSqFt = 2 * planPerSlope * Math.hypot(1, kGable);

  // The main roof it sits over, and so replaces: the part between the wall line
  // and the valley. Stretched by the MAIN pitch, not its own.
  const coveredRoofSqFt = 2 * dIntegral * Math.hypot(1, hostSlope);

  // The triangle you see from the front, above the eave line.
  const faceAreaSqFt = (widthFt * riseFt) / 2;

  const pts = valley.valley || [];
  const first = pts[0];
  const last = pts[pts.length - 1];
  const valleyRunFt =
    pts.length >= 2
      ? 2 * Math.hypot(last.s - first.s, last.d - first.d, last.y - first.y)
      : 0;

  return {
    ...base,
    supported: true,
    reason: '',
    valley,
    valleyRunFt,
    /** How far the ridge reaches in over the main roof. */
    ridgeIntoRoofFt: dRidge,
    roofAreaSqFt,
    faceAreaSqFt,
    coveredRoofSqFt,
  };
}
