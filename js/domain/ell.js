/**
 * Two full-height gable masses joined into an ell.
 *
 * A lean-to hangs off a wall and borrows the host's structure. An ell does
 * not: it is a building in its own right — its own posts, trusses and walls —
 * that happens to butt another one and share a roof junction. That junction is
 * the whole problem, and it is the same plane-meets-plane solve the gable
 * lean-to already does, so gableLeanValley is reused rather than reimplemented.
 *
 * Two attachments, and they are not variations of each other:
 *
 *   EAVE wall (left/right)  — the wing's ridge runs out perpendicular to the
 *     host wall and its two roof planes cut into the host's sloping roof. Two
 *     valleys. This is the barndominium ell, and the case that needed solving.
 *
 *   GABLE wall (front/back) — the wing's ridge runs the same way as the host's
 *     and its roof dies into the host's vertical gable END WALL. A headwall,
 *     not a valley, unless the wing is tall enough to poke out through the
 *     host's roof — which this module reports as unsupported rather than
 *     guessing at, because a wrong answer there draws a roof through a roof.
 *
 * Lengths are feet. Frame-free: plan positions come back as (along, out)
 * offsets from the attachment wall, and the caller maps them onto world axes
 * with its own unit vectors. That is what lets scripts/ell-check.mjs assert
 * the numbers without launching a browser.
 */

import { gableLeanValley } from './gableLean.js?v=20260916k';

/** Host walls an ell can attach to, and which way the wing's ridge runs. */
export const ELL_WALLS = ['left', 'right', 'front', 'back'];

/**
 * Number() that falls back on NaN, not just null/undefined.
 *
 * Same trap as gableLean.js: `Number(x) ?? d` never fires for a missing field,
 * because Number(undefined) is NaN and ?? passes NaN straight through.
 */
function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Ridge height of a plain gable mass. */
function ridgeHeightOf(b) {
  const w = Math.max(num(b?.width, 0), 0);
  return num(b?.eaveHeight, 12) + (w / 2) * (num(b?.pitch, 4) / 12);
}

/** Length of the host wall an ell attaches to. */
export function ellHostWallLength(host, wall) {
  return wall === 'front' || wall === 'back'
    ? num(host?.width, 0)
    : num(host?.length, 0);
}

/**
 * Where the wing sits, in the host's own plan frame.
 *
 * `along` runs down the attachment wall from its origin corner; `out` runs
 * away from the host. Both are host-frame feet, so a renderer only needs the
 * wall's two unit vectors to place the result and never has to re-derive which
 * way is which.
 *
 * On an eave wall the wing turns 90° (its ridge runs out from the host); on a
 * gable wall it keeps the host's orientation (its ridge continues the host's).
 *
 * @param {object} host  { width, length }
 * @param {object} wing  { width, length } — width spans the wing's own ridge
 * @param {object} att   { wall, offset } — offset = wing's near edge along the wall
 */
export function ellPlacement(host, wing, att = {}) {
  const wall = ELL_WALLS.includes(att.wall) ? att.wall : 'left';
  const onEave = wall === 'left' || wall === 'right';
  const wallLen = ellHostWallLength(host, wall);

  // The wing's width spans its own ridge and its length runs along it, and on
  // BOTH attachments the ridge ends up perpendicular to the wall it meets --
  // out from an eave wall, and continuing the host's ridge off a gable wall.
  // So width always lies along the wall and length always projects. (This read
  // the other way round on the gable branch at first, which put a 32' wing on
  // a 40' wall and called it a fit.)
  const alongFt = num(wing?.width, 0);
  const outFt = num(wing?.length, 0);

  const raw = num(att.offset, 0);
  const maxStart = Math.max(0, wallLen - alongFt);
  const alongStart = Math.min(Math.max(0, raw), maxStart);

  // Local origin of the wing, in the HOST's plan frame, paired with the
  // rotation below. A building's group is placed at its origin CORNER and then
  // turned about that corner, so the corner moves with the rotation and the
  // two have to be derived together. The rotation is chosen so the wing's own
  // front gable (its local z = 0 end) always faces AWAY from the host -- that
  // is the end a garage door goes in.
  let rotationDeg;
  let originX;
  let originZ;
  if (wall === 'left') {
    rotationDeg = 90;   // local +x -> world -z, local +z -> world +x
    originX = -outFt;
    originZ = alongStart + alongFt;
  } else if (wall === 'right') {
    rotationDeg = -90;  // local +x -> world +z, local +z -> world -x
    originX = num(host?.width, 0) + outFt;
    originZ = alongStart;
  } else if (wall === 'front') {
    rotationDeg = 0;
    originX = alongStart;
    originZ = -outFt;
  } else {
    rotationDeg = 180;  // local +x -> world -x, local +z -> world -z
    originX = alongStart + alongFt;
    originZ = num(host?.length, 0) + outFt;
  }

  return {
    wall,
    onEave,
    wallLen,
    /** Wing footprint along the attachment wall. */
    alongStart,
    alongEnd: alongStart + alongFt,
    alongFt,
    /** How far the wing projects away from the host. */
    outFt,
    /** Along-wall position of the wing's ridge. */
    alongCentre: alongStart + alongFt / 2,
    /** Wing origin corner in the host's plan frame; pairs with rotationDeg. */
    originX,
    originZ,
    rotationDeg,
    /** True when the requested offset had to be pulled back onto the wall. */
    clamped: Math.abs(alongStart - raw) > 1e-9,
  };
}

/**
 * How much of the host wall the wing buries, and so must not be sheeted or
 * billed.
 *
 * The run is simply the wing's footprint along the wall. The AREA is not
 * run × height, because above the wing's eave the wing roof falls away from
 * its ridge and uncovers a triangle of host wall at each end:
 *
 *   covered(s) = min(wingRidgeY - k|s|, hostWallTop)
 *
 * which is flat-topped out to |s| = sFlat and a straight fall beyond it. Both
 * pieces integrate exactly, so this is closed form rather than sampled.
 */
function buriedHostWall(p) {
  const halfWidth = Math.max(num(p.halfWidth, 0), 0);
  const wallTop = Math.max(num(p.hostWallTop, 0), 0);
  const ridgeY = num(p.wingRidgeY, 0);
  const k = Math.max(0, num(p.kWing, 0));

  if (halfWidth <= 0 || wallTop <= 0) return { runFt: 0, areaSqFt: 0 };

  // |s| at which the wing roof drops to the host wall top. A level wing roof
  // (k = 0) is above it everywhere or nowhere.
  const sFlat =
    k > 1e-9
      ? Math.min(halfWidth, Math.max(0, (ridgeY - wallTop) / k))
      : ridgeY >= wallTop
        ? halfWidth
        : 0;

  // Flat-topped part, then the falling part out to the wing's edge.
  const flat = wallTop * sFlat;
  const fallLo = ridgeY - k * sFlat;
  const fallHi = Math.max(0, ridgeY - k * halfWidth);
  const fall = ((fallLo + fallHi) / 2) * (halfWidth - sFlat);

  return {
    runFt: 2 * halfWidth,
    areaSqFt: Math.max(0, 2 * (flat + fall)),
    /** |s| inside which the wing covers the host wall to its full height. */
    sFlat,
  };
}

/**
 * The full ell junction.
 *
 * @param {object} host main building
 * @param {object} wing the ell, a building in its own right
 * @param {object} att  { wall, offset }
 * @returns {{
 *   supported:boolean, reason:string, kind:'eaveValley'|'gableHeadwall',
 *   placement:object, host:object, wing:object,
 *   valley:object|null, ridgeRelation:'under'|'flush'|'over',
 *   buriedWallRunFt:number, buriedWallAreaSqFt:number,
 *   valleyRunFt:number, warnings:string[]
 * }}
 */
export function ellGeometry(host, wing, att = {}) {
  const placement = ellPlacement(host, wing, att);
  const warnings = [];
  if (placement.clamped) {
    warnings.push('offset pulled back so the wing stays on the host wall');
  }
  // Both surfaces here are read as gable roofs — the host as two planes either
  // side of a centre ridge, the wing the same. A mono roof is one plane with
  // its high side at x = 0, so the same numbers would describe a roof that is
  // not there. Placement is still sound (the masses butt regardless), so only
  // the junction is withheld.
  const notGable =
    (host?.roofStyle || 'gable') !== 'gable'
      ? 'host'
      : (wing?.roofStyle || 'gable') !== 'gable'
        ? 'wing'
        : '';

  const hostEaveY = num(host?.eaveHeight, 12);
  const hostHalfSpan = Math.max(num(host?.width, 0) / 2, 0.01);
  const hostSlope = num(host?.pitch, 4) / 12;
  const hostRidgeY = ridgeHeightOf(host);

  const wingEaveY = num(wing?.eaveHeight, 12);
  const wingHalfWidth = Math.max(num(wing?.width, 0) / 2, 0.01);
  const wingSlope = num(wing?.pitch, 4) / 12;
  const wingRidgeY = ridgeHeightOf(wing);

  const ridgeRelation =
    wingRidgeY > hostRidgeY + 0.01
      ? 'over'
      : wingRidgeY < hostRidgeY - 0.01
        ? 'under'
        : 'flush';

  const common = {
    placement,
    host: {
      eaveY: hostEaveY,
      ridgeY: hostRidgeY,
      slope: hostSlope,
      halfSpan: hostHalfSpan,
    },
    wing: {
      eaveY: wingEaveY,
      ridgeY: wingRidgeY,
      slope: wingSlope,
      halfWidth: wingHalfWidth,
      projectionFt: placement.outFt,
    },
    ridgeRelation,
    warnings,
  };

  if (placement.onEave) {
    // Wing roof planes cut into the host's sloping roof. d is measured inward
    // from the host WALL line (not the eave tip): the host's overhang across
    // the wing opening is trim for the renderer to resolve, and measuring from
    // the wall keeps every number here readable as "so far in from the host".
    const valley = gableLeanValley({
      ridgeY: wingRidgeY,
      eaveY: wingEaveY,
      halfWidth: wingHalfWidth,
      roofTop: hostEaveY,
      mainSlope: Math.max(hostSlope, 0.001),
      halfSpan: hostHalfSpan,
    });

    const buried = buriedHostWall({
      halfWidth: wingHalfWidth,
      hostWallTop: hostEaveY,
      wingRidgeY,
      kWing: valley.kWing,
    });

    if (valley.overMainRidge) {
      warnings.push(
        'wing ridge clears the host ridge — the wing roof crosses the host',
      );
    }
    if (wingEaveY > hostRidgeY) {
      warnings.push('wing eave is above the host ridge — no roof junction');
    }

    // Each valley leg from the ridge end out to where it meets the host eave,
    // and there are two of them, one per wing slope. Measured in THREE
    // dimensions: a valley falls as it runs, so a plan length would under-order
    // the trim somebody has to buy.
    const legs = valley.valley.length ? 2 : 0;
    const first = valley.valley[0];
    const last = valley.valley[valley.valley.length - 1];
    const valleyRunFt = legs
      ? legs *
        Math.hypot(last.s - first.s, last.d - first.d, last.y - first.y)
      : 0;

    return {
      ...common,
      supported: !notGable,
      reason: notGable ? `${notGable} roof is not a gable — junction not solved` : '',
      kind: 'eaveValley',
      valley,
      buriedWallRunFt: buried.runFt,
      buriedWallAreaSqFt: buried.areaSqFt,
      valleyRunFt,
    };
  }

  // Gable wall: the wing dies into a vertical triangle, so the junction is a
  // headwall the height of the host wall under it — provided the wing stays
  // beneath the host's roof line. Once it pokes out through, the junction
  // becomes a valley on the HOST's slopes and this module does not solve it;
  // say so rather than return a number that would draw roof through roof.
  const hostWallTopAt = (x) => {
    const w = Math.max(num(host?.width, 0), 0.01);
    const inX = Math.min(Math.max(x, 0), w);
    return hostEaveY + hostSlope * Math.min(inX, w - inX);
  };
  const ridgeX = placement.alongCentre;
  const hostTopAtRidge = hostWallTopAt(ridgeX);
  const pokesThrough = wingRidgeY > hostTopAtRidge + 0.01;

  const buried = buriedHostWall({
    halfWidth: placement.alongFt / 2,
    hostWallTop: hostTopAtRidge,
    wingRidgeY,
    kWing: wingSlope,
  });

  return {
    ...common,
    supported: !pokesThrough && !notGable,
    reason: notGable
      ? `${notGable} roof is not a gable — junction not solved`
      : pokesThrough
        ? 'wing ridge rises through the host roof on a gable wall — junction not solved'
        : '',
    kind: 'gableHeadwall',
    valley: null,
    buriedWallRunFt: placement.alongFt,
    buriedWallAreaSqFt: buried.areaSqFt,
    /** Headwall flashing follows the wing's two slopes, not a valley. */
    valleyRunFt: 0,
    hostWallTopAtWingRidge: hostTopAtRidge,
  };
}

/**
 * Snap every attached wing onto its host, in place.
 *
 * An ell's siteX / siteZ / rotationDeg are DERIVED, never hand-set: they fall
 * out of which wall it is attached to and where along it. Resolving them before
 * each rebuild is what stops the two masses drifting apart the moment someone
 * edits the host — nudge the host or change its width and the wing follows.
 *
 * Hosts resolve before their wings, so a wing off a wing works. A cycle (or a
 * dangling host id) leaves those buildings exactly as they are rather than
 * looping, because a job that somehow saved one should still open.
 *
 * @param {object[]} buildings the project's buildings, mutated in place
 * @returns {{resolved:string[], unresolved:string[]}}
 */
export function resolveEllPlacements(buildings = []) {
  const list = Array.isArray(buildings) ? buildings.filter(Boolean) : [];
  const byId = new Map(list.map((b) => [b.id, b]));
  const done = new Set(list.filter((b) => !b.attachedTo).map((b) => b.id));
  const resolved = [];

  // Hosts first. Each pass places every wing whose host is already placed; when
  // a pass places nothing, whatever is left is a cycle or points at a host that
  // is not in this project.
  let moved = true;
  while (moved) {
    moved = false;
    for (const wing of list) {
      if (done.has(wing.id) || !wing.attachedTo) continue;
      const host = byId.get(wing.attachedTo);
      if (!host || !done.has(host.id)) continue;

      const pl = ellPlacement(host, wing, {
        wall: wing.attachWall,
        offset: wing.attachOffset,
      });
      // The origin comes back in the HOST's plan frame, so carry it out through
      // the host's own placement before it means anything on site.
      const t = ((num(host.rotationDeg, 0) % 360) * Math.PI) / 180;
      const c = Math.cos(t);
      const s = Math.sin(t);
      wing.siteX = num(host.siteX, 0) + (pl.originX * c + pl.originZ * s);
      wing.siteZ = num(host.siteZ, 0) + (-pl.originX * s + pl.originZ * c);
      wing.rotationDeg = num(host.rotationDeg, 0) + pl.rotationDeg;

      done.add(wing.id);
      resolved.push(wing.id);
      moved = true;
    }
  }

  stampEllSpans(list);

  return {
    resolved,
    unresolved: list.filter((b) => !done.has(b.id)).map((b) => b.id),
  };
}

/**
 * Record on each host which stretches of which walls its wings stand in front
 * of, as `_ellSpans`.
 *
 * A host has no reference to its wings — the link points the other way — and
 * the two places that need this most, generateGirts and eaveTrimPieces, are
 * handed a building and nothing else. Threading the whole project through
 * eight call sites to answer "is there a wing here" is a bigger change than
 * the question deserves, so the answer is written where those functions
 * already look: on the building, beside leanTos.
 *
 * Derived, never authoritative. It is rewritten from scratch on every call and
 * cleared on hosts that have no wings, so it cannot outlive the wing that
 * produced it.
 *
 * @param {object[]} buildings mutated in place
 */
export function stampEllSpans(buildings = []) {
  const list = Array.isArray(buildings) ? buildings.filter(Boolean) : [];
  const spans = new Map();
  for (const wing of list) {
    if (!wing.attachedTo) continue;
    const host = list.find((b) => b.id === wing.attachedTo);
    if (!host) continue;
    const pl = ellPlacement(host, wing, {
      wall: wing.attachWall,
      offset: wing.attachOffset,
    });
    if (!(pl.alongFt > 0.1)) continue;
    if (!spans.has(host.id)) spans.set(host.id, []);
    spans.get(host.id).push({
      wall: pl.wall,
      start: pl.alongStart,
      end: pl.alongEnd,
      lengthFt: pl.alongFt,
      wingId: wing.id,
    });
  }
  for (const b of list) b._ellSpans = spans.get(b.id) || [];
  return spans;
}

/** Total run of this building's wall buried behind wings, in feet. */
export function ellBuriedRunOnWall(b, wall) {
  const spans = (b && Array.isArray(b._ellSpans) ? b._ellSpans : []).filter(
    (s) => s.wall === wall,
  );
  if (!spans.length) return 0;
  // Merge overlaps before summing, or two wings sharing a stretch would
  // subtract it twice and leave the wall short.
  const sorted = spans
    .map((s) => ({ start: s.start, end: s.end }))
    .sort((a, c) => a.start - c.start);
  let total = 0;
  let cur = null;
  for (const s of sorted) {
    if (!cur || s.start > cur.end + 1e-9) {
      if (cur) total += cur.end - cur.start;
      cur = { ...s };
    } else {
      cur.end = Math.max(cur.end, s.end);
    }
  }
  if (cur) total += cur.end - cur.start;
  return Math.max(0, total);
}

/**
 * Every ell butted to this building, each with its solved junction.
 *
 * The takeoff needs this as much as the renderer does: a wall with a wing in
 * front of it is not sheeted, so it must not be billed either, and the valley
 * that replaces it is metal somebody has to buy.
 */
export function ellsAttachedTo(host, buildings = []) {
  if (!host || !host.id) return [];
  const list = Array.isArray(buildings) ? buildings.filter(Boolean) : [];
  return list
    .filter((w) => w.attachedTo === host.id)
    .map((wing) => ({
      wing,
      junction: ellGeometry(host, wing, {
        wall: wing.attachWall,
        offset: wing.attachOffset,
      }),
    }));
}

/** This building's own attachment when it IS a wing; null when it stands alone. */
export function ellOf(wing, buildings = []) {
  if (!wing || !wing.attachedTo) return null;
  const list = Array.isArray(buildings) ? buildings.filter(Boolean) : [];
  const host = list.find((b) => b.id === wing.attachedTo);
  if (!host) return null;
  return {
    host,
    junction: ellGeometry(host, wing, {
      wall: wing.attachWall,
      offset: wing.attachOffset,
    }),
  };
}
