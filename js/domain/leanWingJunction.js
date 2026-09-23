/**
 * Where a shed lean (wrap or single-wall) meets a wing on the same host.
 *
 * Both occupy outward space off a shared host wall. When their plan footprints
 * overlap — or merely abut (touch at a shared along-station with zero overlap)
 * — the lean ties into the wing's near face rather than leaving a free end
 * butting the wing with no flash. Overlap also clips the lean so it does not
 * poke through the wing box.
 *
 * On an eave-wall wing the near face is an eave sidewall: the lean free-end
 * dies under the wing eave. When the lean surface sits above the wing eave
 * (common abutting wrap), we extend the lean into the wing and report a
 * valley polyline where the lean plane meets the wing roof slope. Otherwise
 * a sidewall / apron flash seals the face. `extendIntoWingFt` is the plan
 * kiss past the face (at least metal OH / ~0.25′, or out to the valley).
 *
 * Frame-free plan maths so scripts can assert without a browser. Renderer and
 * takeoff map the returned segments with the same host-frame (x,z) convention
 * as wrapLean.js / ell.js (front z=0, left x=0).
 */

import { ellPlacement } from './ell.js?v=20260923frameView1';
import {
  isWrapLean,
  resolveWrapLean,
  wrapFootprint,
  wrapOccupiedSpanOnWall,
  wallOutward,
} from './wrapLean.js?v=20260923frameView1';

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Local attach height — same rule as types.leanToAttachHeight, no types import. */
function leanToAttachHeight(b, lean) {
  const outer = num(lean?.eaveHeight, 10);
  const pitch = num(lean?.pitch, 3) / 12;
  const depth = Math.max(0.5, num(lean?.depth, 12));
  const fromPitch = outer + depth * pitch;
  const mainEave = num(b?.eaveHeight, fromPitch);
  return Math.max(outer, Math.min(mainEave, fromPitch));
}

function wallLen(b, wall) {
  return wall === 'front' || wall === 'back'
    ? num(b?.width, 0)
    : num(b?.length, 0);
}

/**
 * Wing AABB in the host's plan frame, plus along-wall span.
 */
export function wingPlanRect(host, wing, att = {}) {
  const pl = ellPlacement(host, wing, {
    wall: att.wall ?? wing?.attachWall,
    offset: att.offset ?? wing?.attachOffset,
  });
  const W = num(host?.width, 0);
  const L = num(host?.length, 0);
  let xmin;
  let xmax;
  let zmin;
  let zmax;
  if (pl.wall === 'left') {
    xmin = -pl.outFt;
    xmax = 0;
    zmin = pl.alongStart;
    zmax = pl.alongEnd;
  } else if (pl.wall === 'right') {
    xmin = W;
    xmax = W + pl.outFt;
    zmin = pl.alongStart;
    zmax = pl.alongEnd;
  } else if (pl.wall === 'front') {
    xmin = pl.alongStart;
    xmax = pl.alongEnd;
    zmin = -pl.outFt;
    zmax = 0;
  } else {
    xmin = pl.alongStart;
    xmax = pl.alongEnd;
    zmin = L;
    zmax = L + pl.outFt;
  }
  return {
    wall: pl.wall,
    alongStart: pl.alongStart,
    alongEnd: pl.alongEnd,
    alongFt: pl.alongFt,
    outFt: pl.outFt,
    xmin,
    xmax,
    zmin,
    zmax,
    wingId: wing?.id || null,
    eaveHeight: num(wing?.eaveHeight, 12),
    pitch: num(wing?.pitch, 4),
    ridgeY:
      num(wing?.eaveHeight, 12) +
      (num(wing?.width, 0) / 2) * (num(wing?.pitch, 4) / 12),
  };
}

/** Rect from a stamped `_ellSpans` entry (no full wing object needed). */
export function wingPlanRectFromSpan(host, span) {
  if (!span || !span.wall) return null;
  const fake = {
    id: span.wingId,
    width: num(span.width, span.lengthFt || 0),
    length: num(span.outFt, span.length || 0),
    eaveHeight: num(span.eaveHeight, 12),
    pitch: num(span.pitch, 4),
    attachWall: span.wall,
    attachOffset: num(span.start, 0),
  };
  return wingPlanRect(host, fake);
}

export function pointInRect(rect, x, z, eps = 0.05) {
  if (!rect) return false;
  return (
    x >= rect.xmin - eps &&
    x <= rect.xmax + eps &&
    z >= rect.zmin - eps &&
    z <= rect.zmax + eps
  );
}

/** Lean occupied [start,end] along a host wall (wrap or single). */
export function leanSpanOnWall(host, lean, wall) {
  if (isWrapLean(lean)) return wrapOccupiedSpanOnWall(host, lean, wall);
  if ((lean?.wall || '') !== wall) return null;
  const max = wallLen(host, wall);
  const offset = Math.max(0, num(lean?.offset, 0));
  const length =
    num(lean?.length, 0) > 0
      ? Math.min(num(lean.length, 0), Math.max(0, max - offset))
      : Math.max(0, max - offset);
  if (!(length > 0.05)) return null;
  return { start: offset, end: offset + length };
}

function leanDepth(lean) {
  return Math.max(0.5, num(lean?.depth, 12));
}

function leanHeights(host, lean) {
  const eaveH = num(lean?.eaveHeight, 10);
  const attachH = leanToAttachHeight(host, lean);
  const depth = leanDepth(lean);
  const pitch = num(lean?.pitch, 3) / 12;
  const rise = Math.max(attachH - eaveH, depth * pitch);
  return { eaveH, attachH, depth, rise, pitch };
}

/** Shed lean surface height at outward distance u from the host wall. */
export function leanYAtOut(host, lean, u) {
  const { eaveH, attachH, depth } = leanHeights(host, lean);
  const t = depth > 1e-6 ? Math.min(1, Math.max(0, u / depth)) : 0;
  return attachH + (eaveH - attachH) * t;
}


/**
 * Along-wall unit into the wing from the junction face.
 * approach "low" = lean hits wing.alongStart → into wing is +along.
 */
function alongIntoWing(wall, approach) {
  const sign = approach === 'high' ? -1 : 1;
  if (wall === 'left' || wall === 'right') {
    return { x: 0, z: sign };
  }
  return { x: sign, z: 0 };
}

/**
 * Where a shed lean plane meets a wing roof slope past an eave face.
 *
 * Wing roof rises from the eave face into the wing at wingPitch/12. Lean Y is
 * constant along the face (varies only with outward u). Valley inset from the
 * face: s(u) = max(0, (leanY(u) - wingEaveY) / kWing), capped at half-span.
 *
 * @returns {{
 *   extendIntoWingFt:number,
 *   valleyPoints:Array<{x:number,z:number,y:number,u:number,s:number}>,
 *   kind:'valley'|'sidewallFlash',
 *   faceKind:'eaveSidewall'|'gableEnd',
 *   valleyRunFt:number,
 * }}
 */
export function leanWingValleySolve(host, lean, wingRect, faceAlong, approach, outClip) {
  const wingEaveY = num(wingRect?.eaveHeight, 12);
  const kWing = num(wingRect?.pitch, 4) / 12;
  const halfSpan = Math.max(0.5, num(wingRect?.alongFt, 0) / 2);
  const into = alongIntoWing(wingRect.wall, approach);
  // Always kiss past the face so pans tuck under the wing eave OH (~3").
  const KISS_FT = 0.5;

  const us = [];
  const n = 5;
  for (let i = 0; i <= n; i++) us.push((outClip * i) / n);

  const valleyPoints = [];
  let maxS = 0;
  for (const u of us) {
    const yLean = leanYAtOut(host, lean, u);
    let s = 0;
    if (kWing > 1e-6 && yLean > wingEaveY + 0.02) {
      s = Math.min(halfSpan - 0.05, (yLean - wingEaveY) / kWing);
      s = Math.max(0, s);
    }
    maxS = Math.max(maxS, s);
    // Extend at least the kiss; where valley sits past the face, go to valley.
    const reach = Math.max(KISS_FT, s);
    const pt = wallPoint(host, wingRect.wall, faceAlong, u);
    valleyPoints.push({
      x: pt.x + into.x * reach,
      z: pt.z + into.z * reach,
      y: yLean,
      u,
      s: reach,
      valleyS: s,
    });
  }

  const extendIntoWingFt = Math.max(KISS_FT, maxS);
  // True valley when lean clears the wing eave enough to run onto the slope.
  const clears = maxS > 0.3;
  const kind = clears ? 'valley' : 'sidewallFlash';

  let valleyRunFt = 0;
  for (let i = 1; i < valleyPoints.length; i++) {
    const a = valleyPoints[i - 1];
    const b = valleyPoints[i];
    valleyRunFt += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }

  return {
    extendIntoWingFt,
    valleyPoints,
    kind,
    faceKind: 'eaveSidewall',
    valleyRunFt,
    kissFt: KISS_FT,
    into,
  };
}

/**
 * Push wrap roof free-end corners past the wing face for a junction.
 * Returns a shallow footprint clone with roofQuad / freeEnd / outerL updated
 * for the affected wrap leg. Structural length / takeoff area stay on the
 * unextended footprint — this is a visual/geometry seal only.
 */
export function extendWrapFootprintIntoWing(host, footprint, junctions) {
  const fp = footprint;
  if (!fp || !junctions?.length) {
    return { footprint: fp, extended: false };
  }
  let next = null;
  for (const j of junctions) {
    if (!(j.extendIntoWingFt > 0.05) || !j.valleyPoints?.length) continue;
    const leg = j.wrapLeg;
    if (leg !== 'A' && leg !== 'B') continue;
    if (!next) {
      next = {
        ...fp,
        roofQuadA: { ...fp.roofQuadA },
        roofQuadB: { ...fp.roofQuadB },
        outerL: { ...fp.outerL },
        attachA: { ...fp.attachA, start: { ...fp.attachA.start }, end: { ...fp.attachA.end } },
        attachB: { ...fp.attachB, start: { ...fp.attachB.start }, end: { ...fp.attachB.end } },
      };
    }
    // Host-end of free edge ≈ valleyPoints[0] (u=0); outer ≈ last (u=outClip).
    const hostPt = j.valleyPoints[0];
    const outerPt = j.valleyPoints[j.valleyPoints.length - 1];
    // Only push the free-edge (roofQuad i2/o2 + outer fascia end). Leave
    // attach*.end on the host wall so ledgers do not crawl onto the wing.
    if (leg === 'A') {
      next.freeEndA = { x: outerPt.x, z: outerPt.z };
      next.roofQuadA = {
        ...next.roofQuadA,
        i2: { x: hostPt.x, z: hostPt.z },
        o2: { x: outerPt.x, z: outerPt.z },
      };
      next.outerL = {
        ...next.outerL,
        freeEndA: { x: outerPt.x, z: outerPt.z },
      };
      next.outerA = { start: next.outerL.outerCorner, end: next.outerL.freeEndA };
    } else {
      next.freeEndB = { x: outerPt.x, z: outerPt.z };
      next.roofQuadB = {
        ...next.roofQuadB,
        i2: { x: hostPt.x, z: hostPt.z },
        o2: { x: outerPt.x, z: outerPt.z },
      };
      next.outerL = {
        ...next.outerL,
        freeEndB: { x: outerPt.x, z: outerPt.z },
      };
      next.outerB = { start: next.outerL.outerCorner, end: next.outerL.freeEndB };
    }
  }
  if (!next) return { footprint: fp, extended: false };
  return { footprint: next, extended: true };
}


/**
 * World-ish plan point on a host wall at along-station s, then stepped out by u.
 */
function wallPoint(host, wall, along, outFt) {
  const W = num(host?.width, 0);
  const L = num(host?.length, 0);
  const out = wallOutward(wall);
  let x = 0;
  let z = 0;
  if (wall === 'left') {
    x = 0;
    z = along;
  } else if (wall === 'right') {
    x = W;
    z = along;
  } else if (wall === 'front') {
    x = along;
    z = 0;
  } else {
    x = along;
    z = L;
  }
  return {
    x: x + out.x * outFt,
    z: z + out.z * outFt,
  };
}

/**
 * Collect wing rects available for a host: prefer live wing objects, else
 * stamped `_ellSpans` (enriched by stampEllSpans).
 */
export function hostWingRects(host, buildings = []) {
  const list = Array.isArray(buildings) ? buildings.filter(Boolean) : [];
  const fromLive = list
    .filter((w) => w.attachedTo === host?.id)
    .map((w) => wingPlanRect(host, w));
  if (fromLive.length) return fromLive;
  const spans = Array.isArray(host?._ellSpans) ? host._ellSpans : [];
  return spans.map((s) => wingPlanRectFromSpan(host, s)).filter(Boolean);
}

/**
 * One lean ↔ one wing on a shared host wall.
 *
 * @returns {null|{
 *   kind:'sidewallFlash'|'valley',
 *   leanId:string, wingId:string|null,
 *   hostWall:string,
 *   wrapLeg:'A'|'B'|null,
 *   approach:'low'|'high',
 *   faceAlong:number,
 *   outClip:number,
 *   leanSpan:{start:number,end:number},
 *   wingSpan:{start:number,end:number},
 *   overlap:{start:number,end:number},
 *   junctionA:{x:number,z:number},
 *   junctionB:{x:number,z:number},
 *   yHost:number, yOuter:number,
 *   planLf:number, slopeLf:number, junctionRunFt:number,
 *   buriedPlanSqFt:number,
 *   visibleAlongEnd:number|null,
 *   suppressFreeEnd:boolean,
 *   wingEaveY:number,
 * }}
 */
export function junctionForLeanAndWing(host, lean, wingRect) {
  if (!host || !lean || !wingRect) return null;
  const wall = wingRect.wall;
  const leanSpan = leanSpanOnWall(host, lean, wall);
  if (!leanSpan) return null;

  /** Touching (zero-overlap) still counts as a junction — ~2–3" of float. */
  const ABUT_EPS = 0.2;

  const overlapStart = Math.max(leanSpan.start, wingRect.alongStart);
  const overlapEnd = Math.min(leanSpan.end, wingRect.alongEnd);
  const overlapLf = overlapEnd - overlapStart;
  const abutAtWingStart =
    Math.abs(leanSpan.end - wingRect.alongStart) <= ABUT_EPS;
  const abutAtWingEnd =
    Math.abs(leanSpan.start - wingRect.alongEnd) <= ABUT_EPS;
  const isAbutting = !(overlapLf > 0.05) && (abutAtWingStart || abutAtWingEnd);
  if (!(overlapLf > 0.05) && !isAbutting) return null;

  const depth = leanDepth(lean);
  const outClip = Math.min(depth, Math.max(0, wingRect.outFt));
  if (!(outClip > 0.05)) return null;

  let approach;
  let faceAlong;
  if (isAbutting) {
    // Shared station is the wing near-face the lean already ends on.
    if (abutAtWingStart) {
      approach = 'low';
      faceAlong = wingRect.alongStart;
    } else {
      approach = 'high';
      faceAlong = wingRect.alongEnd;
    }
  } else {
    // Which wing end-face does the lean hit first, coming from outside the wing?
    const hangsLow = leanSpan.start < wingRect.alongStart - 0.05;
    const hangsHigh = leanSpan.end > wingRect.alongEnd + 0.05;
    if (hangsLow) {
      approach = 'low';
      faceAlong = wingRect.alongStart;
    } else if (hangsHigh) {
      approach = 'high';
      faceAlong = wingRect.alongEnd;
    } else {
      // Lean fully inside the wing along-span — still flash the near face toward
      // the wrap corner when we can infer one; else the low wing face.
      if (isWrapLean(lean)) {
        const fromCorner = wrapOccupiedSpanOnWall(host, lean, wall);
        const cornerIsLow =
          fromCorner && Math.abs(fromCorner.start - leanSpan.start) < 0.05;
        approach = cornerIsLow ? 'low' : 'high';
        faceAlong = cornerIsLow ? wingRect.alongStart : wingRect.alongEnd;
      } else {
        approach = 'low';
        faceAlong = wingRect.alongStart;
      }
    }
  }

  // Visible lean along this wall stops at the face (from the approach side).
  // Abutting: lean already ends at the face — keep full wrap leg (no forced clip).
  let visibleAlongEnd = null;
  if (isWrapLean(lean)) {
    const fromCorner = wrapOccupiedSpanOnWall(host, lean, wall);
    if (fromCorner) {
      const legLen = fromCorner.end - fromCorner.start;
      if (isAbutting) {
        visibleAlongEnd = Math.max(0, legLen);
      } else {
        const cornerAt = fromCorner.start;
        const dist = Math.abs(faceAlong - cornerAt);
        visibleAlongEnd = Math.max(0, Math.min(legLen, dist));
      }
    }
  }

  const junctionA = wallPoint(host, wall, faceAlong, 0);
  const junctionB = wallPoint(host, wall, faceAlong, outClip);
  const yHost = leanYAtOut(host, lean, 0);
  const yOuter = leanYAtOut(host, lean, outClip);
  const planLf = outClip;
  const slopeLf = Math.hypot(planLf, Math.abs(yHost - yOuter));

  const wingEaveY = num(wingRect.eaveHeight, 12);

  let wrapLeg = null;
  if (isWrapLean(lean)) {
    const r = resolveWrapLean(host, lean);
    if (wall === r.wallA) wrapLeg = 'A';
    else if (wall === r.wallB) wrapLeg = 'B';
  }

  // Abutting has zero plan overlap; still flash along the face out by lean depth.
  const buriedPlanSqFt = isAbutting ? 0 : overlapLf * outClip;
  const overlap = isAbutting
    ? { start: faceAlong, end: faceAlong }
    : { start: overlapStart, end: overlapEnd };

  // Free-end detailing (end triangle / free-end post) sits at leanSpan.end for
  // the approach-from-low case when that end is inside the wing. Abutting
  // always ties into the wing face, so suppress the free-end triangle.
  let suppressFreeEnd;
  if (isAbutting) {
    suppressFreeEnd = true;
  } else {
    const freeEndAlong = approach === 'low' ? leanSpan.end : leanSpan.start;
    suppressFreeEnd =
      freeEndAlong >= wingRect.alongStart - 0.05 &&
      freeEndAlong <= wingRect.alongEnd + 0.05;
  }

  // Valley / apron solve: extend lean past the eave face into the wing when
  // the lean surface clears the wing eave (Terri abutting wrap case).
  const valley = leanWingValleySolve(
    host,
    lean,
    wingRect,
    faceAlong,
    approach,
    outClip,
  );
  const kind = valley.kind;
  // Bill the 3D valley run when we have one; else the face slope length.
  const junctionRunFt =
    kind === 'valley' && valley.valleyRunFt > 0.05
      ? valley.valleyRunFt
      : slopeLf;

  // Outer reach of the extended free-end (for no-gap asserts).
  const leanReachAlong =
    faceAlong +
    (approach === 'high' ? -1 : 1) * (valley.extendIntoWingFt || 0);

  return {
    kind,
    leanId: lean.id || null,
    wingId: wingRect.wingId,
    hostWall: wall,
    wrapLeg,
    approach,
    faceAlong,
    outClip,
    leanSpan: { ...leanSpan },
    wingSpan: { start: wingRect.alongStart, end: wingRect.alongEnd },
    overlap,
    junctionA,
    junctionB,
    yHost,
    yOuter,
    planLf,
    slopeLf,
    /** Billable flash / valley run (3D). */
    junctionRunFt,
    buriedPlanSqFt,
    visibleAlongEnd,
    suppressFreeEnd,
    wingEaveY,
    wingRect,
    abutting: !!isAbutting,
    extendIntoWingFt: valley.extendIntoWingFt,
    valleyPoints: valley.valleyPoints,
    faceKind: valley.faceKind,
    leanReachAlong,
    kissFt: valley.kissFt,
  };
}

/**
 * All junctions for one lean against the host's wings.
 */
export function leanWingJunctions(host, lean, buildings = []) {
  const rects = hostWingRects(host, buildings);
  const out = [];
  for (const rect of rects) {
    const j = junctionForLeanAndWing(host, lean, rect);
    if (j) out.push(j);
  }
  return out;
}

/**
 * True when a plan point sits inside any junction's wing footprint.
 */
export function pointInsideLeanWingJunction(junctions, x, z) {
  for (const j of junctions || []) {
    if (pointInRect(j.wingRect, x, z)) return true;
  }
  return false;
}

/**
 * Clip a wrap footprint's leg lengths so roof / outer L stop at wing faces.
 * Does not mutate the lean — returns a shallow footprint override.
 */

/**
 * Render-time wall cutouts on a wing so a lean can valley into the wing eave
 * without brown wall metal occluding the junction.
 *
 * For an eave-wall wing the near face is one eave (local left/right). The lean
 * covers `outClip` feet inward from the host; we open that strip full eave
 * height so valley flash and extended lean pans read as a real connection.
 *
 * @returns {Array<{wall:string, offset:number, width:number, height:number, sillHeight:number, type:string, id:string}>}
 */
export function wingEaveCutoutsForLeanJunctions(host, wing, junctions) {
  if (!host || !wing || !junctions?.length) return [];
  const out = [];
  for (const j of junctions) {
    if (j.wingId && wing.id && j.wingId !== wing.id) continue;
    if (!(j.outClip > 0.05)) continue;
    // Only eave-face junctions need the wall opened (gable-end is already a headwall).
    if (j.faceKind && j.faceKind !== 'eaveSidewall') continue;
    const wall = j.hostWall;
    // Map host attach wall → wing local eave that faces the lean.
    // Left host → wing local "right" (lx=width → world alongStart). See ellPlacement.
    // Right host → wing local "left".
    let wingWall = null;
    if (wall === 'left') wingWall = 'right';
    else if (wall === 'right') wingWall = 'left';
    else if (wall === 'front') wingWall = 'back';
    else if (wall === 'back') wingWall = 'front';
    if (!wingWall) continue;

    const outFt = Math.max(j.wingRect?.outFt || 0, j.outClip);
    // Wall runs along wing length (outward). Offset from wing front (outer
    // gable, local z=0) toward the host.
    const width = Math.min(j.outClip, outFt);
    const offset = Math.max(0, outFt - width);
    const height = Math.max(
      num(wing?.eaveHeight, 10),
      num(j.yHost, 10),
      num(j.wingEaveY, 10),
    );
    out.push({
      wall: wingWall,
      offset,
      width,
      height: height + 0.5,
      sillHeight: 0,
      type: 'opening',
      id: `leanWingCut_${j.leanId || 'lt'}_${wing.id || 'w'}`,
      host: 'main',
      _leanWingCut: true,
    });
  }
  return out;
}

export function clippedWrapFootprint(host, lean, junctions) {
  const fp = wrapFootprint(host, lean);
  if (!junctions?.length) return { footprint: fp, junctions: [], clipped: false };

  let lengthA = fp.lengthA;
  let lengthB = fp.lengthB;
  let clipped = false;
  for (const j of junctions) {
    if (j.wrapLeg === 'A' && j.visibleAlongEnd != null && j.visibleAlongEnd < lengthA - 0.05) {
      lengthA = Math.max(0.5, j.visibleAlongEnd);
      clipped = true;
    }
    if (j.wrapLeg === 'B' && j.visibleAlongEnd != null && j.visibleAlongEnd < lengthB - 0.05) {
      lengthB = Math.max(0.5, j.visibleAlongEnd);
      clipped = true;
    }
  }
  if (!clipped) return { footprint: fp, junctions, clipped: false };

  // Recompute footprint with truncated lengths (lean clone).
  const clippedLean = {
    ...lean,
    lengthA,
    lengthB,
    length: undefined,
  };
  return {
    footprint: wrapFootprint(host, clippedLean),
    junctions,
    clipped: true,
    lengthA,
    lengthB,
  };
}

/**
 * Materials / takeoff adjustments for lean↔wing junctions.
 */
export function leanWingTakeoffAdjust(host, lean, junctions) {
  const list = Array.isArray(junctions) ? junctions : [];
  if (!list.length) {
    return {
      buriedPlanSqFt: 0,
      junctionRunFt: 0,
      sidewallFlashLf: 0,
      valleyLf: 0,
      suppressPostCount: 0,
    };
  }
  let buriedPlanSqFt = 0;
  let sidewallFlashLf = 0;
  let valleyLf = 0;
  for (const j of list) {
    buriedPlanSqFt += j.buriedPlanSqFt || 0;
    if (j.kind === 'valley') valleyLf += j.junctionRunFt || 0;
    else sidewallFlashLf += j.junctionRunFt || 0;
  }
  return {
    buriedPlanSqFt,
    junctionRunFt: sidewallFlashLf + valleyLf,
    sidewallFlashLf,
    valleyLf,
  };
}

/**
 * Filter outer lean posts that fall inside a wing box.
 */
export function filterPostsOutsideWings(posts, junctions) {
  if (!junctions?.length) return posts || [];
  return (posts || []).filter(
    (p) => !pointInsideLeanWingJunction(junctions, p.x, p.z),
  );
}
