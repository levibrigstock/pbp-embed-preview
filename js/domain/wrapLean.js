/**
 * Wrap-around lean-to geometry (open porch v1).
 *
 * One attachment object wrapping a 90° main-building corner: two host walls,
 * square depth out from each, hip ridge from building corner → outer corner
 * post, continuous outer eave L. Enclosed wrap walls are TODO.
 *
 * Plan coords match the rest of the app: x ∈ [0, width], z ∈ [0, length],
 * front z=0, left x=0.
 */

function wallLength(b, wall) {
  return wall === 'front' || wall === 'back'
    ? Number(b?.width) || 0
    : Number(b?.length) || 0;
}

export const WRAP_CORNERS = ['FL', 'FR', 'BL', 'BR'];

/** Corner → two adjacent walls [wallA, wallB]. A is the "gable-ish" or listed first. */
export const WRAP_CORNER_WALLS = {
  FL: ['front', 'left'],
  FR: ['front', 'right'],
  BL: ['back', 'left'],
  BR: ['back', 'right'],
};

export function isWrapLean(lean) {
  if (!lean) return false;
  const k = lean.kind || 'leanto';
  return k === 'wrap' || k === 'wrap-lean';
}

export function normalizeWrapCorner(corner) {
  const c = String(corner || 'FL').toUpperCase();
  return WRAP_CORNERS.includes(c) ? c : 'FL';
}

/**
 * Resolve corner + lengths. lengthA/lengthB of 0 = full host wall from the corner.
 */
export function resolveWrapLean(b, lean) {
  const corner = normalizeWrapCorner(lean?.corner);
  const [wallA, wallB] = WRAP_CORNER_WALLS[corner];
  const depth = Math.max(2, Number(lean?.depth) || 12);
  const maxA = wallLength(b, wallA);
  const maxB = wallLength(b, wallB);
  const rawA = Number(lean?.lengthA);
  const rawB = Number(lean?.lengthB);
  // Fall back to legacy length/offset if wrap fields missing
  const lengthA =
    Number.isFinite(rawA) && rawA > 0
      ? Math.min(rawA, maxA)
      : Number(lean?.length) > 0 && lean?.wall === wallA
        ? Math.min(Number(lean.length), maxA)
        : maxA;
  const lengthB =
    Number.isFinite(rawB) && rawB > 0
      ? Math.min(rawB, maxB)
      : Number(lean?.length) > 0 && lean?.wall === wallB
        ? Math.min(Number(lean.length), maxB)
        : maxB;
  return {
    corner,
    wallA,
    wallB,
    depth,
    lengthA: Math.max(0.5, lengthA),
    lengthB: Math.max(0.5, lengthB),
    maxA,
    maxB,
  };
}

/** Building corner point in plan (ft). */
export function wrapBuildingCornerXZ(b, corner) {
  const c = normalizeWrapCorner(corner);
  const W = Number(b?.width) || 0;
  const L = Number(b?.length) || 0;
  if (c === 'FL') return { x: 0, z: 0 };
  if (c === 'FR') return { x: W, z: 0 };
  if (c === 'BL') return { x: 0, z: L };
  return { x: W, z: L }; // BR
}

/**
 * Outward unit (+depth direction) for a host wall.
 */
export function wallOutward(wall) {
  if (wall === 'left') return { x: -1, z: 0 };
  if (wall === 'right') return { x: 1, z: 0 };
  if (wall === 'front') return { x: 0, z: -1 };
  return { x: 0, z: 1 }; // back
}

/**
 * Along-wall unit from the wrap corner toward the far end of that wall span.
 * For FL/front: +x; FL/left: +z; etc.
 */
export function wrapAlongFromCorner(corner, wall) {
  const c = normalizeWrapCorner(corner);
  if (wall === 'front') {
    // From left corner toward right, or from right toward left
    return c === 'FR' || c === 'BR' ? { x: -1, z: 0 } : { x: 1, z: 0 };
  }
  if (wall === 'back') {
    return c === 'FR' || c === 'BR' ? { x: -1, z: 0 } : { x: 1, z: 0 };
  }
  if (wall === 'left') {
    return c === 'BL' || c === 'BR' ? { x: 0, z: -1 } : { x: 0, z: 1 };
  }
  // right
  return c === 'BL' || c === 'BR' ? { x: 0, z: -1 } : { x: 0, z: 1 };
}

/**
 * Full wrap footprint + hip + outer L.
 *
 * @returns {{
 *   corner, wallA, wallB, depth, lengthA, lengthB,
 *   buildingCorner: {x,z},
 *   outerCorner: {x,z},
 *   attachA: { start, end }, attachB: { start, end },
 *   outerA: { start, end }, outerB: { start, end },
 *   // outer L polyline: freeEndA → outerCorner → freeEndB
 *   outerL: { freeEndA, outerCorner, freeEndB, runA, runB, totalLf },
 *   footprintAreaSqFt,
 *   hipPlanLf,
 * }}
 */
export function wrapFootprint(b, lean) {
  const r = resolveWrapLean(b, lean);
  const { corner, wallA, wallB, depth, lengthA, lengthB } = r;
  const bc = wrapBuildingCornerXZ(b, corner);
  const outA = wallOutward(wallA);
  const outB = wallOutward(wallB);
  const alongA = wrapAlongFromCorner(corner, wallA);
  const alongB = wrapAlongFromCorner(corner, wallB);

  const outerCorner = {
    x: bc.x + outA.x * depth + outB.x * depth,
    z: bc.z + outA.z * depth + outB.z * depth,
  };

  // Attach spans on host walls (from corner along each wall)
  const attachA = {
    start: { x: bc.x, z: bc.z },
    end: {
      x: bc.x + alongA.x * lengthA,
      z: bc.z + alongA.z * lengthA,
    },
  };
  const attachB = {
    start: { x: bc.x, z: bc.z },
    end: {
      x: bc.x + alongB.x * lengthB,
      z: bc.z + alongB.z * lengthB,
    },
  };

  // Outer eave of each leg: includes the depth past the other wall (to outer corner)
  // freeEnd = attach end projected out by depth; outer corner shared.
  const freeEndA = {
    x: attachA.end.x + outA.x * depth,
    z: attachA.end.z + outA.z * depth,
  };
  const freeEndB = {
    x: attachB.end.x + outB.x * depth,
    z: attachB.end.z + outB.z * depth,
  };

  // Outer run A: freeEndA → outerCorner (length = lengthA + depth)
  // Outer run B: outerCorner → freeEndB (length = lengthB + depth)
  const runA = lengthA + depth;
  const runB = lengthB + depth;

  // Roof plane quads (see module header): each includes the D×D corner to the hip.
  // Leg A outer edge: freeEndA → outerCorner
  // Leg A attach: attachA.start → attachA.end
  // For mesh we also need the "near" outer at wallA depth from corner along outA only:
  // nearOuterA = bc + outA*depth  (mid-edge of corner square on wallA side)
  const nearOuterA = {
    x: bc.x + outA.x * depth,
    z: bc.z + outA.z * depth,
  };
  const nearOuterB = {
    x: bc.x + outB.x * depth,
    z: bc.z + outB.z * depth,
  };

  const outerA = { start: outerCorner, end: freeEndA }; // from corner out along leg A eave
  const outerB = { start: outerCorner, end: freeEndB };

  // Plan footprint = two wall strips + corner square
  const footprintAreaSqFt = lengthA * depth + lengthB * depth + depth * depth;
  const hipPlanLf = depth * Math.SQRT2;

  return {
    ...r,
    buildingCorner: bc,
    outerCorner,
    attachA,
    attachB,
    nearOuterA,
    nearOuterB,
    freeEndA,
    freeEndB,
    outerA,
    outerB,
    outerL: {
      freeEndA,
      outerCorner,
      freeEndB,
      runA,
      runB,
      totalLf: runA + runB,
    },
    footprintAreaSqFt,
    hipPlanLf,
    // Convenience for roof quads: attach + outer corners of each leg plane
    roofQuadA: {
      // planar shed on wallA: attach start/end, freeEndA, outerCorner
      i1: attachA.start,
      i2: attachA.end,
      o2: freeEndA,
      o1: outerCorner,
    },
    roofQuadB: {
      i1: attachB.start,
      i2: attachB.end,
      o2: freeEndB,
      o1: outerCorner,
    },
  };
}

/**
 * Hip segment 3D: building corner at attach height → outer corner at eave.
 */
export function wrapHipSegment(b, lean, heights = {}) {
  const fp = wrapFootprint(b, lean);
  const attachH =
    heights.attachH != null
      ? Number(heights.attachH)
      : Number(lean?.eaveHeight) || 10;
  const eaveH =
    heights.eaveH != null ? Number(heights.eaveH) : Number(lean?.eaveHeight) || 10;
  // Caller usually passes true attach (higher) vs outer eave
  return {
    a: { x: fp.buildingCorner.x, y: attachH, z: fp.buildingCorner.z },
    b: { x: fp.outerCorner.x, y: eaveH, z: fp.outerCorner.z },
    planLf: fp.hipPlanLf,
    slopeLf: Math.hypot(fp.hipPlanLf, Math.abs(attachH - eaveH)),
  };
}

/**
 * Post stations along the outer L polyline (freeEndA → outerCorner → freeEndB).
 * Shared outer corner once. Returns [{x,z, alongLf, face:'outerA'|'corner'|'outerB'}]
 */
export function wrapOuterPostStations(b, lean, spacingFt) {
  const fp = wrapFootprint(b, lean);
  const sp = Math.max(1, Number(spacingFt) || Number(lean?.postSpacing) || 10);
  const { freeEndA, outerCorner, freeEndB, runA, runB } = fp.outerL;

  const lerp = (a, c, t) => ({
    x: a.x + (c.x - a.x) * t,
    z: a.z + (c.z - a.z) * t,
  });

  const stationsOnRun = (len) => {
    const out = [0];
    for (let u = sp; u < len - 0.05; u += sp) out.push(Math.round(u * 1000) / 1000);
    const end = Math.round(len * 1000) / 1000;
    if (out[out.length - 1] < end - 0.05) out.push(end);
    return out;
  };

  const posts = [];
  const seen = new Set();
  const key = (p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`;

  // Run A: freeEndA → outerCorner (include both ends; corner tagged once)
  for (const u of stationsOnRun(runA)) {
    const t = runA > 0.01 ? u / runA : 0;
    const p = lerp(freeEndA, outerCorner, t);
    const atCorner = u >= runA - 0.05;
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    posts.push({
      x: p.x,
      z: p.z,
      alongLf: u,
      face: atCorner ? 'corner' : 'outerA',
      run: 'A',
    });
  }
  // Run B: outerCorner → freeEndB (skip start if already added as corner)
  for (const u of stationsOnRun(runB)) {
    const t = runB > 0.01 ? u / runB : 0;
    const p = lerp(outerCorner, freeEndB, t);
    const atCorner = u <= 0.05;
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    posts.push({
      x: p.x,
      z: p.z,
      alongLf: runA + u,
      face: atCorner ? 'corner' : 'outerB',
      run: 'B',
    });
  }

  return { posts, footprint: fp, cornerCount: posts.filter((p) => p.face === 'corner').length };
}

/**
 * Roof plan helpers for each leg (mesh + area).
 * Leg plan area includes half the corner square via (length+depth)*depth - shared handled at sum.
 */
export function wrapRoofPlanes(b, lean) {
  const fp = wrapFootprint(b, lean);
  const pitch = (Number(lean?.pitch) || 3) / 12;
  const rise = fp.depth * pitch;
  const rafter = Math.hypot(fp.depth, rise);
  return {
    footprint: fp,
    rise,
    rafter,
    legA: {
      wall: fp.wallA,
      alongFt: fp.lengthA + fp.depth,
      depth: fp.depth,
      planArea: (fp.lengthA + fp.depth) * fp.depth,
      quad: fp.roofQuadA,
    },
    legB: {
      wall: fp.wallB,
      alongFt: fp.lengthB + fp.depth,
      depth: fp.depth,
      planArea: (fp.lengthB + fp.depth) * fp.depth,
      quad: fp.roofQuadB,
    },
    /** Union plan area (corner once). */
    planAreaSqFt: fp.footprintAreaSqFt,
    /** Sloped roof SF ≈ plan × (rafter/depth). */
    roofSqFt: fp.footprintAreaSqFt * (rafter / Math.max(fp.depth, 0.01)),
    hipPlanLf: fp.hipPlanLf,
  };
}

/**
 * Occupied [start,end) along a host wall for a wrap lean (from the corner).
 * Returns null if this wrap does not touch `wall`.
 */
export function wrapOccupiedSpanOnWall(b, lean, wall) {
  if (!isWrapLean(lean)) return null;
  const r = resolveWrapLean(b, lean);
  if (wall !== r.wallA && wall !== r.wallB) return null;
  const len = wall === r.wallA ? r.lengthA : r.lengthB;
  const max = wallLength(b, wall);
  // Span starts at the corner end of this wall
  const c = r.corner;
  let start = 0;
  if (wall === 'front' || wall === 'back') {
    // FR/BR corner is at x=width → span goes toward decreasing x
    if (c === 'FR' || c === 'BR') start = Math.max(0, max - len);
    else start = 0;
  } else {
    // BL/BR corner is at z=length
    if (c === 'BL' || c === 'BR') start = Math.max(0, max - len);
    else start = 0;
  }
  return { start, end: Math.min(max, start + len) };
}

/**
 * Plan UV corners for a wrap roof leg, in _addLeanRoofPlane c0..c3 order:
 *   c0=i1 (attach.start/bc), c1=o1 (outerCorner), c2=o2 (freeEnd), c3=i2 (attach.end)
 *
 * U = outward from host wall / depth (0 at attach → 1 at outer eave).
 * V = (v + depth) / (length + depth) so outerCorner V=0 and freeEnd V=1.
 * Ribs / panel texture then run straight up the slope (// wallOutward), not along the hip.
 *
 * @param {'A'|'B'} leg
 * @returns {[[number, number], [number, number], [number, number], [number, number]]}
 */
export function wrapRoofUvCorners(fp, leg = 'A') {
  const depth = Math.max(Number(fp?.depth) || 0, 0.01);
  const len = Math.max(
    Number(leg === 'B' ? fp?.lengthB : fp?.lengthA) || 0,
    0.01,
  );
  const span = len + depth;
  const vAt = (v) => (v + depth) / span;
  // (u,v) plan: bc (0,0), attach.end (0,len), freeEnd (depth,len), outerCorner (depth,-depth)
  return [
    [0, vAt(0)], // i1 building corner
    [1, vAt(-depth)], // o1 outerCorner → V=0
    [1, vAt(len)], // o2 freeEnd → V=1
    [0, vAt(len)], // i2 attach.end → V=1
  ];
}

/**
 * Slope-aligned raised-rib stations for a wrap roof leg.
 * Spaced along the outer eave (v from -depth to length); each rib runs
 * wallOutward from the inner boundary (attach when v≥0, hip when v<0) to the outer eave.
 *
 * @param {'A'|'B'} leg
 * @returns {{ inner: {x:number,z:number}, outer: {x:number,z:number} }[]}
 */
export function wrapRoofSlopeRibStations(fp, leg = 'A', spacing = 0.75) {
  const depth = Math.max(Number(fp?.depth) || 0, 0.01);
  const len = Math.max(
    Number(leg === 'B' ? fp?.lengthB : fp?.lengthA) || 0,
    0.01,
  );
  const wall = leg === 'B' ? fp.wallB : fp.wallA;
  const out = wallOutward(wall);
  const along = wrapAlongFromCorner(fp.corner, wall);
  const bc = fp.buildingCorner;
  const v0 = -depth;
  const v1 = len;
  const span = v1 - v0;
  const count = Math.max(2, Math.round(span / Math.max(spacing, 0.25)));
  const stations = [];
  for (let i = 0; i <= count; i++) {
    const v = v0 + (span * i) / count;
    const outer = {
      x: bc.x + out.x * depth + along.x * v,
      z: bc.z + out.z * depth + along.z * v,
    };
    let inner;
    if (v >= -1e-9) {
      inner = { x: bc.x + along.x * v, z: bc.z + along.z * v };
    } else {
      // On hip: plan (u,v) with u = -v
      const u = -v;
      inner = {
        x: bc.x + out.x * u + along.x * v,
        z: bc.z + out.z * u + along.z * v,
      };
    }
    // Skip degenerate tip at outerCorner (v=-depth ⇒ inner==outer)
    if (Math.hypot(outer.x - inner.x, outer.z - inner.z) < 0.05) continue;
    stations.push({ inner, outer });
  }
  return stations;
}
