/**
 * Generates post-frame framing members from a building definition.
 * Coordinates: local building space, origin at front-left corner on grade.
 * +X = width (left→right), +Z = length (front→back), +Y = up.
 * All values in feet.
 */

import {
 wallLength,
 roofRise,
 rafterLength,
 isLeanEnclosed,
 leanToRafterLength,
 leanToRoofRise,
 leanToAttachHeight,
 leanToOverhangFt,
 leanToRoofAreaSqFt,
 isWallOpen,
 openWallList,
 closedWallList,
 isLeanFaceOpen,
 leanOpenFaceList,
 roundFtToNearestInch,
} from './types.js?v=20260806f';
import {
 useFullGirtPackage,
 girtPackMode,
 girtIncludeEaveNailer,
 purlinStationPad,
 purlinRowsPerSide,
 panelMetalOverhangIn,
 hasAnyLean,
} from './productionPolicy.js?v=20260806f';

/**
 * Place posts on a wall line, including both ends.
 * @returns {{x:number,z:number,wall:string}[]}
 */
function postsAlongLine(start, end, spacing, wall) {
 const dx = end.x - start.x;
 const dz = end.z - start.z;
 const len = Math.hypot(dx, dz);
 if (len < 0.01) return [{ x: start.x, z: start.z, wall }];
 const n = Math.max(1, Math.round(len / spacing));
 const actual = len / n;
 const posts = [];
 for (let i = 0; i <= n; i++) {
 const t = i / n;
 posts.push({
 x: start.x + dx * t,
 z: start.z + dz * t,
 wall,
 spacingUsed: actual,
 });
 }
 return posts;
}

function keyXZ(x, z, tol = 0.05) {
 return `${(Math.round(x / tol) * tol).toFixed(2)},${(Math.round(z / tol) * tol).toFixed(2)}`;
}

/**
 * Height above grade to top of post (roof / wall line) at a perimeter location.
 *
 * Gable: eave walls (left/right) stay at eave height. Gable ends (front/back)
 * rise with pitch toward the ridge (center of width).
 *
 * Mono: low eave = eaveHeight, high eave = eaveHeight + full rise; front/back
 * interpolate across width (high at left x=0, low at right x=width).
 *
 * @returns {{ heightAboveGrade: number, role: 'eave'|'gable'|'peak'|'corner'|'mono-high'|'mono-low'|'mono-rake' }}
 */
export function postHeightAboveGrade(b, x, z, walls = []) {
 const W = b.width;
 const eave = b.eaveHeight;
 const rise = roofRise(b);
 const wallSet = walls instanceof Set ? walls : new Set(walls);
 const onFront = wallSet.has('front');
 const onBack = wallSet.has('back');
 const onLeft = wallSet.has('left');
 const onRight = wallSet.has('right');
 const onGableEnd = onFront || onBack;
 const onEaveWall = onLeft || onRight;
 const isCorner = onGableEnd && onEaveWall;

 if (b.roofStyle === 'mono') {
 // High at left (x=0), low at right (x=W)
 const t = W > 0 ? Math.min(1, Math.max(0, x / W)) : 0;
 const h = eave + rise * (1 - t);
 let role = 'mono-rake';
 if (onLeft && !onGableEnd) role = 'mono-high';
 else if (onRight && !onGableEnd) role = 'mono-low';
 else if (isCorner) role = 'corner';
 return { heightAboveGrade: h, role, riseContribution: h - eave };
 }

 // Gable (default)
 // Eave-only posts (side walls, not corners): constant eave height
 if (onEaveWall && !onGableEnd) {
 return { heightAboveGrade: eave, role: 'eave', riseContribution: 0 };
 }

 // Gable-end posts (front/back, including corners): follow roof pitch across width
 const halfW = W / 2;
 const distFromPeak = Math.abs(x - halfW);
 const riseHere =
 halfW < 0.01 ? 0 : rise * Math.max(0, 1 - distFromPeak / halfW);
 const h = eave + riseHere;

 let role = 'gable';
 if (isCorner || riseHere < 0.05) role = isCorner ? 'corner' : 'eave';
 else if (distFromPeak < 0.05) role = 'peak';

 return { heightAboveGrade: h, role, riseContribution: riseHere };
}

/**
 * Along-wall coordinate (ft) for a post on a given wall, or null if not on that wall.
 * Matches opening.offset convention (0 at start of wall: front-left → along each face).
 */
export function postAlongWall(p, wall, b, tol = 0.15) {
 const W = Number(b.width) || 0;
 const L = Number(b.length) || 0;
 if (wall === 'front' && Math.abs(Number(p.z) - 0) <= tol) return Number(p.x);
 if (wall === 'back' && Math.abs(Number(p.z) - L) <= tol) return Number(p.x);
 if (wall === 'left' && Math.abs(Number(p.x) - 0) <= tol) return Number(p.z);
 if (wall === 'right' && Math.abs(Number(p.x) - W) <= tol) return Number(p.z);
 return null;
}

/** World XZ for a position measured along a main wall from its start (offset 0). */
export function wallOffsetToXZ(b, wall, offsetAlong) {
 const W = Number(b.width) || 0;
 const L = Number(b.length) || 0;
 const wl = wall === 'front' || wall === 'back' ? W : L;
 const u = Math.max(0, Math.min(wl, Number(offsetAlong) || 0));
 if (wall === 'front') return { x: u, z: 0 };
 if (wall === 'back') return { x: u, z: L };
 if (wall === 'left') return { x: 0, z: u };
 return { x: W, z: u }; // right
}

/** Round along-wall station for stable Set keys (ft). */
function roundStation(u) {
 return Math.round(Number(u) * 1000) / 1000;
}

/**
 * Regular post stations along a wall at true `spacing` o.c.
 * e.g. 55' wall @ 10' → 0, 10, 20, 30, 40, 50, 55 (ends always included).
 */
function gridStations(wallLen, spacing) {
 const len = Math.max(0, Number(wallLen) || 0);
 const sp = Math.max(1, Number(spacing) || 10);
 if (len < 0.01) return [0];
 const out = [0];
 for (let u = sp; u < len - 0.05; u += sp) {
 out.push(roundStation(u));
 }
 const end = roundStation(len);
 if (out[out.length - 1] < end - 0.05) out.push(end);
 return out;
}

/** Door types that need 6x6 posts at both jambs (king posts). */
export function isDoorOpening(o) {
 const t = o?.type || '';
 return t === 'walk' || t === 'overhead' || t === 'slider';
}

/** Window openings: 2x6 king/jack stud package — not 6x6 jamb posts. */
export function isWindowOpening(o) {
 return (o?.type || '') === 'window';
}

/**
 * Main-wall openings only (not lean-to hosts).
 */
function mainWallOpenings(b, wall) {
 return (b.openings || []).filter((o) => {
 if (o.host && o.host !== 'main') return false;
 return (o.wall || 'front') === wall;
 });
}

/** Openings hosted on a lean face (default outer). */
function leanFaceOpenings(b, lean, face = 'outer') {
 const id = lean?.id;
 if (!id) return [];
 return (b.openings || []).filter((o) => {
 if (o.host !== id) return false;
 const f = o.face || 'outer';
 return f === face;
 });
}

/**
 * True if a post station falls inside an opening RO (blocks the clear opening).
 */
export function postBlocksOpening(alongWallFt, opening, eps = 0.08) {
 const u0 = Number(opening.offset);
 const u1 = u0 + Number(opening.width);
 if (!Number.isFinite(u0) || !Number.isFinite(u1)) return false;
 return alongWallFt > u0 + eps && alongWallFt < u1 - eps;
}

/**
 * True if along-wall station lands on the regular post grid (or a corner).
 * A door jamb that falls on a grid post reuses that post — no extra JambPost.
 */
export function isOnPostGrid(alongWallFt, wallLen, spacing, eps = 0.08) {
 const u = Number(alongWallFt);
 const L = Number(wallLen) || 0;
 const s = Number(spacing) || 10;
 if (!Number.isFinite(u)) return false;
 if (u <= eps || u >= L - eps) return true; // corners
 if (!(s > 0)) return false;
 const n = Math.round(u / s);
 const g = n * s;
 return Math.abs(g - u) <= eps && g >= -eps && g <= L + eps;
}

/**
 * Apply openings to one wall's post stations.
 *
 * DOORS (walk / OH / slider):
 *  - Clear any post whose center is inside the RO
 *  - Ensure a 6x6 at each jamb
 *  - If a grid post was inside the RO, "move" it to the nearer jamb (counts as that side)
 *  - JambPost (openingJamb) only when the jamb is OFF the post grid — if the jamb
 *    lands on an existing post, that post is the jamb (no extra JambPost line)
 *
 * WINDOWS:
 *  - Do NOT add 6x6 jamb posts (framed with 2x6 header/sill/backing in takeoff)
 *  - If a post lands in the window RO, move it to the nearer jamb only (one side);
 *    the other side stays stud-framed
 */
function stationsWithOpeningAdjustments(wallLen, spacing, openingsOnWall, opts = {}) {
 const jambEps = 0.08;
 const stations = new Set(gridStations(wallLen, spacing));
 /** Off-grid door jambs only — listed as JambPost on the order list */
 const jambSet = new Set();
 /** Only eave walls: drop grid posts just outside RO near off-grid jambs (SB 35×55). */
 const joinNearJambs = opts.eaveWall === true;

 const clamp = (u) => roundStation(Math.max(0, Math.min(wallLen, u)));

 /** Ensure a post at jamb; tag JambPost only if not already a grid station.
 * Near-grid jambs (≤1″) snap to the grid so float offsets don't invent JambPosts.
 */
 const ensureJamb = (jRaw) => {
 let j = jRaw;
 const s = Number(spacing) || 10;
 if (s > 0 && j > jambEps && j < wallLen - jambEps) {
 const g = Math.round(j / s) * s;
 if (Math.abs(g - j) <= 1 / 12) j = clamp(g);
 }
 stations.add(j);
 if (!isOnPostGrid(j, wallLen, spacing, jambEps)) {
 jambSet.add(roundStation(j));
 }
 };

 for (const o of openingsOnWall || []) {
 const u0 = Number(o.offset);
 const width = Number(o.width);
 if (!Number.isFinite(u0) || !Number.isFinite(width) || width < 0.5) continue;
 const u1 = u0 + width;
 const j0 = clamp(u0);
 const j1 = clamp(u1);

 // Posts currently blocking this RO
 const blocking = [...stations].filter((u) => u > u0 + jambEps && u < u1 - jambEps);

 if (isDoorOpening(o)) {
 // Remove blockers (may be relocated to a jamb)
 for (const u of blocking) stations.delete(u);

 // Prefer relocating a blocked post to the nearer jamb, then ensure both jambs
 if (blocking.length === 1) {
 const u = blocking[0];
 const toLeft = u - u0 <= u1 - u;
 ensureJamb(toLeft ? j0 : j1);
 ensureJamb(toLeft ? j1 : j0);
 } else if (blocking.length >= 2) {
 // Blockers cleared; posts at both jambs (grid reuse or extra JambPost)
 ensureJamb(j0);
 ensureJamb(j1);
 } else {
 // No blocker — still need posts both sides (grid post counts if jamb hits it)
 ensureJamb(j0);
 ensureJamb(j1);
 }
 } else if (isWindowOpening(o)) {
 // Windows: clear RO; if a post was in the way, slide it to the nearer jamb only
 for (const u of blocking) {
 stations.delete(u);
 const toLeft = u - u0 <= u1 - u;
 stations.add(toLeft ? j0 : j1);
 // not marked as door jamb — just a relocated main post
 }
 // Do NOT force 6x6 at both jambs for windows
 }
 }

 // Stub-bay elimination on eave walls (layout-general):
 // When an off-grid OH/slider jamb sits within half a design bay of a line post,
 // the jamb carries that bay — drop the non-corner grid post. Scales with spacing
 // (10′ → 5.05′). Never drop a station that is itself a door jamb (on- or off-grid)
 // so neighboring doors keep their posts. Walk doors do not strip the grid.
 // Gable ends skip this pass (mixed heights; 60×10 / Levi goldens).
 if (joinNearJambs) {
 const JOIN_FT = Number(spacing) * 0.5 + 0.05;
 /** Every door jamb on this wall (grid or not) — protected from join. */
 const doorJambPos = new Set();
 for (const o of openingsOnWall || []) {
 if (!isDoorOpening(o)) continue;
 const u0 = Number(o.offset);
 const width = Number(o.width);
 if (!Number.isFinite(u0) || !Number.isFinite(width)) continue;
 doorJambPos.add(roundStation(clamp(u0)));
 doorJambPos.add(roundStation(clamp(u0 + width)));
 }
 for (const o of openingsOnWall || []) {
 if (!isDoorOpening(o)) continue;
 const u0 = Number(o.offset);
 const width = Number(o.width);
 if (!Number.isFinite(u0) || !Number.isFinite(width)) continue;
 // Wide doors only (OH/slider); walk doors must not strip eave grid (60×60 walks).
 if (width < 8) continue;
 const j0 = clamp(u0);
 const j1 = clamp(u0 + width);
 for (const j of [j0, j1]) {
 if (!jambSet.has(roundStation(j))) continue;
 for (const u of [...stations]) {
 if (jambSet.has(roundStation(u))) continue;
 if (doorJambPos.has(roundStation(u))) continue; // keep neighbor door jambs
 if (u <= 0.05 || u >= wallLen - 0.05) continue;
 const d = Math.abs(u - j);
 if (d > 0.08 && d <= JOIN_FT && isOnPostGrid(u, wallLen, spacing)) {
 stations.delete(u);
 }
 }
 }
 }

 // Long eave (L ≥ 60′), 3+ independent wide doors: half-bay join can clear
 // every intermediate line post so the door wall is 100% JambPost. SB still
 // lists one slid column as Post (60×12 equal-space 3×10′ → 10@16 + 5 Jamb,
 // not 9+6). Mid-length eaves (35×55 L=55) keep full JambPost pairs (6@16).
 // Only when jambs == 2×doors (no shared jambs) and no regular intermediate remains.
 {
 const wideDoors = (openingsOnWall || []).filter((o) => {
 if (!isDoorOpening(o)) return false;
 return (Number(o.width) || 0) >= 8;
 });
 const inter = [...stations].filter((u) => u > 0.05 && u < wallLen - 0.05);
 const regInter = inter.filter((u) => !jambSet.has(roundStation(u)));
 const jambInter = inter
 .filter((u) => jambSet.has(roundStation(u)))
 .sort((a, b) => a - b);
 if (
 wallLen >= 60 - 0.01 &&
 wideDoors.length >= 3 &&
 regInter.length === 0 &&
 jambInter.length >= 6 &&
 jambInter.length === wideDoors.length * 2
 ) {
 let promote = null;
 for (const j of jambInter) {
 const g = Math.round(j / (Number(spacing) || 10)) * (Number(spacing) || 10);
 const d = Math.abs(g - j);
 if (d > 0.08 && d <= JOIN_FT) {
 promote = roundStation(j);
 break;
 }
 }
 if (promote != null) jambSet.delete(promote);
 }
 }
 }

 return {
 stations: [...stations].sort((a, b) => a - b),
 jambSet,
 };
}

/**
 * Main building posts: perimeter at postSpacing, corners shared once.
 *
 * Door openings get a 6x6 at each jamb. If the jamb lands on the regular post
 * grid, that existing post is the jamb (order list: Post). Off-grid jambs are
 * ordered as JambPost. Interior posts in the RO are cleared/relocated.
 * Windows: no extra 6x6 jambs — only clear/relocate a post in the RO.
 *
 * Lengths: eave posts use eave height; gable-end posts grow with pitch toward peak.
 */
export function generateMainPosts(b) {
 const s = Number(b.postSpacing) || 10;
 const W = Number(b.width) || 0;
 const L = Number(b.length) || 0;
 const map = new Map();

 const wallSpecs = [
 { wall: 'front', len: W },
 { wall: 'back', len: W },
 { wall: 'left', len: L },
 { wall: 'right', len: L },
 ];

 for (const { wall, len } of wallSpecs) {
 const wallOpen = isWallOpen(b, wall);
 // Lean on this wall still needs intermediate posts for attachment
 const leanOnWall = (b.leanTos || []).some((lt) => lt.wall === wall);
 // Open drive-through wall: corners only (unless lean needs structure)
 let stations;
 let jambSet = new Set();
 if (wallOpen && !leanOnWall) {
 stations = [0, len];
 } else {
 const adj = stationsWithOpeningAdjustments(
 len,
 s,
 mainWallOpenings(b, wall),
 { eaveWall: wall === 'left' || wall === 'right' },
 );
 stations = adj.stations;
 jambSet = adj.jambSet;
 }
 // Dual enclosed eave wings: drop low gable stub posts beyond a wide OH
 // toward the corner (Mark EXT-2/4 → 2@22+2@24, no far 18′ grid).
 // Also ensure the high near-peak pair at spacing / len−spacing (12′ & 28′
 // on a 40′ gable) so both sides of a centered OH land @22′.
 if (
 hasDualFullEnclosedEaveLeans(b) &&
 (wall === 'front' || wall === 'back')
 ) {
 const JOIN = s * 0.5 + 0.05;
 const wide = mainWallOpenings(b, wall).filter(
 (o) => isDoorOpening(o) && (Number(o.width) || 0) >= 8,
 );
 if (wide.length) {
 stations = stations.filter((u) => {
 if (u <= 0.05 || u >= len - 0.05) return true;
 if (jambSet.has(roundStation(u))) return true;
 for (const o of wide) {
 const j0 = Number(o.offset) || 0;
 const j1 = j0 + (Number(o.width) || 0);
 // Outside the RO toward a corner, in a stub bay.
 if (u < j0 - 0.05) {
 if (u - 0 <= JOIN) return false;
 }
 if (u > j1 + 0.05) {
 if (len - u <= JOIN) return false;
 }
 }
 return true;
 });
 // Near-peak high posts (SB A×2 @22′): first grid in from each corner.
 for (const uKeep of [s, len - s]) {
 if (uKeep <= 0.05 || uKeep >= len - 0.05) continue;
 // Skip if inside an RO
 let blocked = false;
 for (const o of wide) {
 const j0 = Number(o.offset) || 0;
 const j1 = j0 + (Number(o.width) || 0);
 if (uKeep > j0 + 0.05 && uKeep < j1 - 0.05) {
 blocked = true;
 break;
 }
 }
 if (blocked) continue;
 if (!stations.some((u) => Math.abs(u - uKeep) <= 0.08)) {
 stations.push(uKeep);
 }
 }
 stations.sort((a, c) => a - c);
 }
 }
 for (const u of stations) {
 const pos = wallOffsetToXZ(b, wall, u);
 const k = keyXZ(pos.x, pos.z);
 const isJamb = jambSet.has(roundStation(u));
 if (!map.has(k)) {
 map.set(k, {
 x: pos.x,
 z: pos.z,
 walls: new Set([wall]),
 kind: 'main',
 openingJamb: isJamb,
 /** Along-wall station (ft) on primary wall — for JambPost audit notes */
 alongFt: u,
 primaryWall: wall,
 });
 } else {
 const e = map.get(k);
 e.walls.add(wall);
 if (isJamb) {
 e.openingJamb = true;
 e.alongFt = u;
 e.primaryWall = wall;
 }
 }
 }
 }

 // Safety: no post may remain inside any main-wall RO
 for (const o of b.openings || []) {
 if (o.host && o.host !== 'main') continue;
 const wall = o.wall || 'front';
 const wallLen = wall === 'front' || wall === 'back' ? W : L;
 for (const [k, p] of [...map.entries()]) {
 const u = postAlongWall(p, wall, b);
 if (u == null) continue;
 if (postBlocksOpening(u, o)) map.delete(k);
 }
 // Doors only: re-ensure both jamb posts after safety strip.
 // openingJamb only when jamb is OFF the post grid (on-grid = regular Post).
 if (isDoorOpening(o)) {
 for (const uRaw of [Number(o.offset), Number(o.offset) + Number(o.width)]) {
 if (!Number.isFinite(uRaw)) continue;
 const u = Math.max(0, Math.min(wallLen, uRaw));
 const pos = wallOffsetToXZ(b, wall, u);
 const k = keyXZ(pos.x, pos.z);
 const extraJamb = !isOnPostGrid(u, wallLen, s);
 if (!map.has(k)) {
 map.set(k, {
 x: pos.x,
 z: pos.z,
 walls: new Set([wall]),
 kind: 'main',
 // Off-grid only — on-grid re-add is still a regular Post (not JambPost).
 openingJamb: extraJamb,
 alongFt: u,
 primaryWall: wall,
 });
 } else {
 const e = map.get(k);
 e.walls.add(wall);
 // Do not force openingJamb false → true. stationsWithOpeningAdjustments may
 // intentionally leave a slid column as Post on long multi-OH eaves (SB 10@16+5 Jamb).
 if (extraJamb && e.openingJamb) {
 e.alongFt = u;
 e.primaryWall = wall;
 }
 // on-grid or promoted slid column: leave as regular Post
 }
 }
 }
 }

 const embedFt = b.postDepthFt ?? 3; // Levi PDF: post hole 3' (types default 3)
 const posts = [...map.values()].map((p) => {
 const walls = [...p.walls];
 const { heightAboveGrade, role, riseContribution } = postHeightAboveGrade(
 b,
 p.x,
 p.z,
 p.walls,
 );
 const isJamb = !!p.openingJamb;
 // Walk/window jamb on eave walls only: SB step-down vs wall posts
 // (Prater left walk 14′ vs eave 16′). Do not step gable-end jambs (Levi).
 let walkJamb = false;
 const eaveWall = p.primaryWall === 'left' || p.primaryWall === 'right';
 if (isJamb && eaveWall && p.alongFt != null && p.primaryWall) {
 const wall = p.primaryWall;
 const u = Number(p.alongFt);
 for (const o of b.openings || []) {
 if (o.host && o.host !== 'main') continue;
 if ((o.wall || 'front') !== wall) continue;
 if (o.type !== 'walk' && o.type !== 'window') continue;
 const left = Number(o.offset) || 0;
 const right = left + (Number(o.width) || 0);
 if (Math.abs(u - left) < 0.15 || Math.abs(u - right) < 0.15) {
 walkJamb = true;
 break;
 }
 }
 }
 // Dual enclosed eave wings: shared main eaves/corners order at lean
 // outer height (Mark EXT-6/9 → 16′ not main-eave 18′).
 let orderHeight = heightAboveGrade;
 if (
 hasDualFullEnclosedEaveLeans(b) &&
 (role === 'eave' || role === 'corner')
 ) {
 const eaveWall = [...p.walls].find((w) => w === 'left' || w === 'right');
 const lt = (b.leanTos || []).find((x) => x && x.wall === eaveWall);
 const leanOuter = Number(lt?.eaveHeight);
 if (leanOuter > 0.1) orderHeight = leanOuter;
 }
 const pick = pickPostStockLength(orderHeight, embedFt, POST_STOCK_LENGTHS, {
 isOpeningJamb: isJamb,
 building: b,
 });
 let stockFt = pick.stockFt;
 let requiredFt = pick.requiredFt;
 let orderH = orderHeight;
 if (walkJamb) {
 const eavePick = pickPostStockLength(Number(b.eaveHeight) || 0, embedFt, POST_STOCK_LENGTHS, {
 building: b,
 });
 // Only step down on 12′+ eave packages (Prater 16→14). 10′ eave wall
 // jambs stay on eave stock (60×60 → 4@14 JambPost).
 if ((eavePick.stockFt || 0) >= 16) {
 stockFt = Math.max(10, eavePick.stockFt - 2);
 orderH = Math.max(7, stockFt - embedFt - 0.5);
 requiredFt = orderH + embedFt;
 }
 }
 const orderMeta = isJamb
 ? jambOrderHeightFt(b, heightAboveGrade, true, embedFt)
 : { heightFt: orderH, eaveClamped: false };
 return {
 x: p.x,
 z: p.z,
 walls,
 kind: 'main',
 role,
 openingJamb: isJamb,
 alongFt: p.alongFt != null ? p.alongFt : null,
 primaryWall: p.primaryWall || walls[0] || null,
 riseContribution,
 heightAboveGrade: walkJamb ? orderH : heightAboveGrade,
 /** Height used for stock pick (jambs may clamp low-rise to eave) */
 orderHeightAboveGrade: orderMeta.heightFt,
 embedFt,
 requiredFt,
 totalLengthFt: stockFt,
 stockFt,
 gradeBufferApplied: pick.gradeBufferApplied,
 fieldCutFt: pick.fieldCutFt || null,
 };
 });

 return posts;
}

/**
 * Snap a distance along a wall to the nearest post grid (main post spacing).
 */
function snapToGrid(value, spacing, max) {
 if (!spacing || spacing <= 0) return value;
 const snapped = Math.round(value / spacing) * spacing;
 return Math.max(0, Math.min(max, snapped));
}

/**
 * Lean-to geometry + posts + material quantities.
 * - Outer eave posts are new posts (lean-to kind).
 * - Main-wall posts along the attachment span are marked sharedWithLeanTo (not double-counted).
 * - Optional snapToPosts aligns lean ends to main post grid.
 * - Enclosed: girts on outer + both ends. Open: posts + roof framing only.
 * - Roof always: purlins, outer sub-fascia, attachment ledger, transition flash length.
 */
export function generateLeanToPosts(b, lean, mainPosts = []) {
 const wallLen = wallLength(b, lean.wall);
 // Lean post grid is independent of main: default 10' o.c. (editable per lean)
 const s = Number(lean.postSpacing) > 0 ? Number(lean.postSpacing) : 10;
 let offset = lean.offset || 0;
 let length = lean.length > 0 ? Math.min(lean.length, wallLen - offset) : wallLen - offset;

 // Only when explicitly enabled — default is free (custom) lengths
 if (lean.snapToPosts === true) {
 const end = offset + length;
 offset = snapToGrid(offset, b.postSpacing, wallLen);
 const endSnap = snapToGrid(end, b.postSpacing, wallLen);
 length = Math.max(b.postSpacing, endSnap - offset);
 if (offset + length > wallLen) length = wallLen - offset;
 }

 const depth = lean.depth;
 const embedFt = b.postDepthFt ?? 3; // Levi PDF: post hole 3' (types default 3)
 const posts = [];
 const enclosed = isLeanEnclosed(lean);

 let outerStart, outerEnd, innerStart, innerEnd;
 if (lean.wall === 'left') {
 innerStart = { x: 0, z: offset };
 innerEnd = { x: 0, z: offset + length };
 outerStart = { x: -depth, z: offset };
 outerEnd = { x: -depth, z: offset + length };
 } else if (lean.wall === 'right') {
 innerStart = { x: b.width, z: offset };
 innerEnd = { x: b.width, z: offset + length };
 outerStart = { x: b.width + depth, z: offset };
 outerEnd = { x: b.width + depth, z: offset + length };
 } else if (lean.wall === 'front') {
 innerStart = { x: offset, z: 0 };
 innerEnd = { x: offset + length, z: 0 };
 outerStart = { x: offset, z: -depth };
 outerEnd = { x: offset + length, z: -depth };
 } else {
 innerStart = { x: offset, z: b.length };
 innerEnd = { x: offset + length, z: b.length };
 outerStart = { x: offset, z: b.length + depth };
 outerEnd = { x: offset + length, z: b.length + depth };
 }

 // Outer eave posts — true postSpacing o.c. (default 10'), same grid as main.
 // Open / carport leans keep intermediate posts to carry the roof.
 // e.g. 14' lean @ 10' → stations 0, 10, 14 (not just corners).
 // Dual enclosed eave wings: outer posts order at MAIN eave stock (Mark EXT-1/3
 // → 18′), apply OH jamb packing, and add one short 14′ post per wide door.
 const dualEave = hasDualFullEnclosedEaveLeans(b);
 {
 const outerOpens = leanFaceOpenings(b, lean, 'outer');
 const adj =
 outerOpens.length > 0
 ? stationsWithOpeningAdjustments(length, s, outerOpens, {
 eaveWall: true,
 })
 : { stations: gridStations(length, s), jambSet: new Set() };
 const stations = adj.stations;
 const jambSet = adj.jambSet;
 const dx = outerEnd.x - outerStart.x;
 const dz = outerEnd.z - outerStart.z;
 // Dual wings: SB nails lean outers at main eave package length.
 const outerOrderH = dualEave
 ? Number(b.eaveHeight) || Number(lean.eaveHeight) || 12
 : Number(lean.eaveHeight) || 10;
 for (const u of stations) {
 const t = length > 0.01 ? u / length : 0;
 const px = outerStart.x + dx * t;
 const pz = outerStart.z + dz * t;
 const isJamb = jambSet.has(roundStation(u));
 const pick = pickPostStockLength(outerOrderH, embedFt, POST_STOCK_LENGTHS, {
 isOpeningJamb: isJamb,
 building: b,
 });
 posts.push({
 x: px,
 z: pz,
 walls: [lean.wall],
 kind: 'leanto',
 leanToId: lean.id,
 face: 'outer',
 shared: false,
 openingJamb: isJamb,
 alongFt: u,
 heightAboveGrade: outerOrderH,
 embedFt,
 requiredFt: pick.requiredFt,
 totalLengthFt: pick.stockFt,
 stockFt: pick.stockFt,
 gradeBufferApplied: pick.gradeBufferApplied,
 fieldCutFt: pick.fieldCutFt || null,
 });
 }
 // SB EXT-1: one short 14′ post per wide OH on multi-door lean outers
 // (cut ~4′4″ above header / pier — stock still 14′).
 if (dualEave) {
 const wideDoors = outerOpens.filter(
 (o) => isDoorOpening(o) && (Number(o.width) || 0) >= 8,
 );
 if (wideDoors.length >= 3) {
 for (const o of wideDoors) {
 const u =
 (Number(o.offset) || 0) + (Number(o.width) || 0) / 2;
 const t = length > 0.01 ? u / length : 0;
 const px = outerStart.x + dx * t;
 const pz = outerStart.z + dz * t;
 // Door-height order → 14′ stock (req 13′ @ 3′ embed).
 const shortH = Math.min(10, Number(o.height) || 10);
 const pick = pickPostStockLength(shortH, embedFt);
 posts.push({
 x: px,
 z: pz,
 walls: [lean.wall],
 kind: 'leanto',
 leanToId: lean.id,
 face: 'outer',
 shared: false,
 openingJamb: false,
 shortPost: true,
 alongFt: u,
 heightAboveGrade: shortH,
 embedFt,
 requiredFt: pick.requiredFt,
 totalLengthFt: pick.stockFt,
 stockFt: pick.stockFt,
 gradeBufferApplied: pick.gradeBufferApplied,
 fieldCutFt: pick.fieldCutFt || null,
 });
 }
 }
 }
 }

 // End-line posts (outer → main): enclosed leans only.
 // Open / carport leans: outer eave grid only — no mid-posts toward the main wall
 // (those read as the two posts “closer to the building”).
 // Dual enclosed eave wings: lean ends sit in the extended gable plane — no
 // separate end-line posts (Mark EXT-6/9 are main eaves @16′, not lean ends).
 {
 const attachH = leanToAttachHeight(b, lean);
 if (enclosed && !dualEave) {
 const endSpecs = [
 { face: 'leftEnd', a: outerStart, b: innerStart },
 { face: 'rightEnd', a: outerEnd, b: innerEnd },
 ];
 for (const { face, a, b: bpt } of endSpecs) {
 if (isLeanFaceOpen(lean, face)) continue;
 // Intermediate stations along depth (exclude corners)
 const depthStations = gridStations(depth, s).slice(1, -1);
 let endPosts = depthStations.map((u) => {
 const t = depth > 0.01 ? u / depth : 0;
 return {
 x: a.x + (bpt.x - a.x) * t,
 z: a.z + (bpt.z - a.z) * t,
 wall: lean.wall,
 };
 });
 let sideH;
 if (endPosts.length > 0) {
 sideH = (lean.eaveHeight + attachH) / 2;
 } else if (depth > 0.5) {
 // Shallow enclosed lean: mid-end post at attach height (production +2)
 endPosts = [
 {
 x: (a.x + bpt.x) / 2,
 z: (a.z + bpt.z) / 2,
 wall: lean.wall,
 },
 ];
 sideH = attachH;
 } else {
 continue;
 }
 for (const p of endPosts) {
 const pick = pickPostStockLength(sideH, embedFt);
 posts.push({
 x: p.x,
 z: p.z,
 walls: [lean.wall],
 kind: 'leanto',
 leanToId: lean.id,
 face: 'end',
 shared: false,
 heightAboveGrade: sideH,
 embedFt,
 requiredFt: pick.requiredFt,
 totalLengthFt: pick.stockFt,
 stockFt: pick.stockFt,
 gradeBufferApplied: pick.gradeBufferApplied,
 fieldCutFt: pick.fieldCutFt || null,
 });
 }
 }
 }
 }

 // Mark main posts along attachment span as shared (not double-counted)
 const sharedMain = [];
 for (const mp of mainPosts) {
 if (!mp.walls?.includes(lean.wall)) continue;
 let along = 0;
 if (lean.wall === 'front' || lean.wall === 'back') along = mp.x;
 else along = mp.z;
 if (along >= offset - 0.1 && along <= offset + length + 0.1) {
 mp.sharedWithLeanTo = mp.sharedWithLeanTo || [];
 if (!mp.sharedWithLeanTo.includes(lean.id)) mp.sharedWithLeanTo.push(lean.id);
 mp.kind = mp.kind === 'main' ? 'main-shared' : mp.kind;
 sharedMain.push(mp);
 }
 }

 const materials = computeLeanToMaterials(b, lean, { length, depth, enclosed });

 return {
 posts,
 sharedMain,
 outerStart,
 outerEnd,
 innerStart,
 innerEnd,
 length,
 depth,
 offset,
 enclosed,
 materials,
 };
}

/**
 * Accurate lumber / metal quantity model for one lean-to.
 * Roof always; walls only when enclosed.
 */
export function computeLeanToMaterials(b, lean, dims) {
 const length = dims.length;
 const depth = dims.depth;
 const enclosed = dims.enclosed ?? isLeanEnclosed(lean);
 const girtSp = (b.girtSpacingIn || 24) / 12;
 const purlinSp = (b.purlinSpacingIn || 24) / 12;
 const metalOh = leanToOverhangFt(lean, b);
 const isGable = (lean.roofStyle || 'shed') === 'gable';
 const rafter = leanToRafterLength(lean, b);
 const rise = leanToRoofRise(lean);
 const attachH = leanToAttachHeight(b, lean);
 const outerH = Number(lean.eaveHeight) || 10;
 const ceilingLiner = lean.ceilingLiner === 'yes' || lean.ceilingLiner === true;

 // --- Lean roof purlins (production order list — same 2x4 Purlin package as main) ---
 // Shed: rows run along attachment length; count across depth + metal OH.
 // 8' deep @ 2' + 3" OH → ceil(8.25/2)+1 = 6 rows × 80' → packs into +30 of 16'
 // (main 128@16 + lean 30@16 = 158@16 — matches production Job Review).
 // Gable lean (ridge out from wall): 1 row per slope along lean length + ridge stubs.
 // SB 60×12+14′ gable lean: main 118/27 + lean 2@16 + 3@12 → 120/30.
 let purlinRows;
 /** Run length each purlin board covers (ft). */
 let purlinRunFt = length;
 /** Extra 12′ stubs (gable peak/ridge stations). */
 let purlinExtra12 = 0;
 if (isGable) {
 purlinRows = 2; // one purlin row per slope
 purlinRunFt = length;
 purlinExtra12 = 3; // SB peak/ridge station stubs
 } else {
 // Enclosed leans: +1 station pad (Mark dual → 10 rows / Levi shed).
 // Open leans: no pad + 16+12+12 pack + L/10 edge stubs (Prater → 6+4).
 const pad = enclosed ? 1 : 0;
 purlinRows = Math.max(2, Math.ceil((depth + metalOh) / purlinSp) + pad);
 purlinRunFt = length;
 if (!enclosed) purlinExtra12 = Math.max(0, Math.ceil(length / 10 - 1e-9));
 }
 const purlinLf = purlinRows * purlinRunFt;

 // --- Attachment ledger / truss bearer at main wall (always) ---
 // 2-ply carrier like main eaves so purlins seat properly
 const ledgerPlies = 2;
 const ledgerLf = ledgerPlies * length;
 const ledgerSize = b.trussCarrierSize || '2x10';

 // --- Outer eave sub-fascia (always) ---
 const subFasciaLf = length;
 // Gable lean also needs outer eave; both eaves on gable = outer only for attach (inner is main)

 // Open faces on enclosed lean (drive-through) — skip metal/girts/base on those faces
 const openOuter = isLeanFaceOpen(lean, 'outer');
 const openLeft = isLeanFaceOpen(lean, 'leftEnd');
 const openRight = isLeanFaceOpen(lean, 'rightEnd');

 // Main-building wainscot applies to enclosed lean walls only (not open/carport leans)
 const wainOn =
 enclosed &&
 b.wainscotColor &&
 b.wainscotColor !== 'NONE' &&
 String(b.wainscotColor).toUpperCase() !== '';
 const wainH = wainOn
 ? Math.min(Math.max(Number(b.wainscotHeightFt) || 3, 0.5), Math.max(0.5, outerH - 0.5))
 : 0;

 // --- Girts (enclosed faces only); first row at wainscot when on ---
 let girtLf = 0;
 let girtRows = 0;
 const girtLevelsOuter = enclosed
 ? girtLevelsForHeight(outerH, girtSp, wainH)
 : [];
 girtRows = girtLevelsOuter.length;
 if (enclosed) {
 if (!openOuter) girtLf += girtRows * length;
 const endH = (outerH + attachH) / 2;
 const endLevels = girtLevelsForHeight(endH, girtSp, wainH);
 if (!openLeft) girtLf += endLevels.length * depth;
 if (!openRight) girtLf += endLevels.length * depth;
 }

 // --- Skirt on lean: never (main perimeter only per product rules) ---
 const skirtLf = 0;

 // --- Roof metal ---
 // Shed: one plane, panels run up-slope, coverage along length
 // Gable: two planes
 const coverage = 3;
 const roofSides = isGable ? 2 : 1;
 const roofPanelQty = Math.ceil(length / coverage) * roofSides + (isGable ? 0 : 0);
 // Order cut: metal drip OH (not wood frame OH) + short add, nearest inch.
 // Mark 16'@2/12+3" → 16'7"; Prater 10'@2/12+3" → 10'6" (even if frame OH is 1').
 const metalInRaw = lean.metalOverhangIn != null ? Number(lean.metalOverhangIn) : 3;
 const metalOhOrderFt =
 (Number.isFinite(metalInRaw) && metalInRaw > 0 ? metalInRaw : 3) / 12;
 const leanPitchRatio = (Number(lean.pitch) || 3) / 12;
 const leanOrderSlope = isGable
 ? Math.hypot(depth / 2 + metalOhOrderFt, (depth / 2) * leanPitchRatio)
 : Math.hypot(depth + metalOhOrderFt, depth * leanPitchRatio);
 const leanAddIn = leanOrderSlope < 20 ? 1.5 : 2;
 const roofPanelLen = Math.round((leanOrderSlope + leanAddIn / 12) * 12) / 12;

 // --- Wall metal (closed enclosed faces only) ---
 // Upper panels stop at wainscot top when wainscot is on (band counted separately)
 let wallPanelLf = 0; // linear feet of wall coverage (divide by 3 for qty)
 let wallPanelLen = outerH + 1; // stock panel length (upper wall)
 if (enclosed) {
 if (wainH > 0) {
 wallPanelLen = Math.max(0.5, outerH - wainH + 1);
 }
 if (!openOuter) wallPanelLf += length;
 if (!openLeft) wallPanelLf += depth;
 if (!openRight) wallPanelLf += depth;
 }
 // Wainscot LF along closed lean faces (enclosed + wainscot only)
 let wainscotLf = 0;
 if (enclosed && wainH > 0) {
 if (!openOuter) wainscotLf += length;
 if (!openLeft) wainscotLf += depth;
 if (!openRight) wainscotLf += depth;
 }

 // --- Trim linear feet ---
 // Transition / sidewall flash: where lean roof meets main wall
 const transitionLf = length;
 // Outer eave edge
 const eaveEdgeLf = length;
 // Rake / gable edge: two end rakes × rafter length (shed) or more for gable
 const rakeLf = isGable ? 4 * rafter : 2 * rafter;
 // Ridge on gable lean only
 const ridgeLf = isGable ? length : 0;
 // Outer corners: only where both adjacent faces are closed
 let cornerCount = 0;
 if (enclosed) {
 if (!openOuter && !openLeft) cornerCount += 1;
 if (!openOuter && !openRight) cornerCount += 1;
 }
 // Base / rat guard on closed faces only
 let baseLf = 0;
 if (enclosed) {
 if (!openOuter) baseLf += length;
 if (!openLeft) baseLf += depth;
 if (!openRight) baseLf += depth;
 }

 // Ceiling liner area under lean roof (when enabled)
 const linerAreaSqFt = ceilingLiner
 ? leanToRoofAreaSqFt(lean, b, length)
 : 0;

 return {
 enclosed,
 isGable,
 length,
 depth,
 outerH,
 attachH,
 rise,
 rafter,
 metalOh,
 overhangIn: lean.overhangIn ?? 0,
 metalOverhangIn: lean.metalOverhangIn ?? 3,
 openFaces: leanOpenFaceList(lean),
 openOuter,
 openLeft,
 openRight,
 wainscotHeightFt: wainH,
 wainscotLf,
 girtLevels: girtLevelsOuter,
 purlinRows,
 purlinRunFt,
 purlinExtra12,
 purlinLf,
 ledgerPlies,
 ledgerLf,
 ledgerSize,
 subFasciaLf,
 girtRows,
 girtLf,
 skirtLf,
 roofPanelQty: Math.max(1, roofPanelQty),
 roofPanelLen,
 roofSides,
 wallPanelLf,
 wallPanelLen,
 transitionLf,
 eaveEdgeLf,
 rakeLf,
 ridgeLf,
 cornerCount,
 baseLf,
 ceilingLiner,
 linerAreaSqFt,
 };
}

/**
 * Girt elevations for a wall of given height (ft).
 * @param {number} wallHeightFt
 * @param {number} spacingFt
 * @param {number} wainH — 0 = no wainscot; else first girt at wainH
 */
/** @deprecated use useFullGirtPackage from productionPolicy */
export function useProductionGirtPackage(b) {
 return useFullGirtPackage(b);
}

/**
 * @param {number} wallHeightFt
 * @param {number} spacingFt
 * @param {number} [wainH]
 * @param {{ includeEave?: boolean }} [opts]
 */
export function girtLevelsForHeight(wallHeightFt, spacingFt, wainH = 0, opts = {}) {
 const eave = Math.max(1, Number(wallHeightFt) || 12);
 const sp = Math.max(0.5, Number(spacingFt) || 2);
 const includeEave = opts.includeEave !== false;
 void wainH;
 const roundY = (y) => Math.round(y * 1000) / 1000;
 const out = [];
 const topLimit = includeEave ? eave + 0.001 : eave - 0.05;

 for (let y = sp; y <= topLimit + 0.0001; y += sp) {
 if (!includeEave && y >= eave - 0.05) break;
 const yy = includeEave ? Math.min(y, eave) : y;
 if (yy > eave + 0.02) continue;
 if (out.length && Math.abs(out[out.length - 1] - yy) < 0.02) continue;
 if (!includeEave && yy >= eave - 0.05) continue;
 out.push(roundY(yy));
 }
 if (!out.length && eave > sp) out.push(roundY(sp));
 return out;
}


/**
 * True when both eave walls (left+right) have full-length enclosed shed leans.
 * In that dual-wing layout SB treats shared main eaves as interior (no main
 * eave girts/skirt); lean outers carry the skin. Single-lean jobs (Levi) still
 * count the host main wall.
 */
export function hasDualFullEnclosedEaveLeans(b) {
 const covers = (wall) =>
 (b.leanTos || []).some((lt) => {
 if (!lt || lt.wall !== wall || !isLeanEnclosed(lt)) return false;
 if ((lt.roofStyle || 'shed') === 'gable') return false;
 const wallLen = wallLength(b, wall);
 const offset = Number(lt.offset) || 0;
 const span =
 Number(lt.length) > 0
 ? Math.min(Number(lt.length) || 0, wallLen - offset)
 : wallLen - offset;
 return span >= wallLen - 0.1;
 });
 return covers('left') && covers('right');
}

/**
 * Horizontal wall girts — rows + runs from geometry; pack mode from productionPolicy.
 */
export function generateGirts(b) {
 const spacingFt = (b.girtSpacingIn || 24) / 12;
 const eave = Number(b.eaveHeight) || 12;
 const production = useFullGirtPackage(b);
 const levelOpts = { includeEave: girtIncludeEaveNailer(b) };

 const wainOn =
 b.wainscotColor &&
 b.wainscotColor !== 'NONE' &&
 String(b.wainscotColor).toUpperCase() !== '';
 let wainH = 0;
 if (wainOn) {
 wainH = Math.min(
 Math.max(Number(b.wainscotHeightFt) || 3, 0.5),
 Math.max(0.5, eave - 0.5),
 );
 }

 const levelsMain = girtLevelsForHeight(eave, spacingFt, wainH, levelOpts);
 const levels = levelsMain.filter((y) => y <= eave + 0.05);

 const closed = closedWallList(b);
 /** @type {{ wall: string, lengthFt: number, rows: number, host: string }[]} */
 const runs = [];
 const dualEaveLeans = hasDualFullEnclosedEaveLeans(b);
 for (const wall of closed) {
 // Dual enclosed eave leans: skip shared main eaves (interior to wings).
 if (dualEaveLeans && (wall === 'left' || wall === 'right')) continue;
 const len = wallLength(b, wall);
 runs.push({ wall, lengthFt: len, rows: levels.length, host: 'main' });
 }

 // Enclosed lean-to faces
 for (const lean of b.leanTos || []) {
 if (!isLeanEnclosed(lean)) continue;
 const wallLen = wallLength(b, lean.wall);
 const offset = Number(lean.offset) || 0;
 const length =
 lean.length > 0 ? Math.min(Number(lean.length) || 0, wallLen - offset) : wallLen - offset;
 const depth = Number(lean.depth) || 0;
 const attachH = leanToAttachHeight(b, lean);
 const mainPitch = Number(b.pitch) || 4;
 const leanPitch = Number(lean.pitch) || mainPitch;
 // Use lean pitch for outer eave (broken-pitch sheds). Same-pitch sheds
 // still match main because leanPitch === mainPitch after normalization.
 const pitchDrop = leanPitch;
 const geoOuter = Math.max(
 8,
 roundFtToNearestInch((Number(b.eaveHeight) || 12) - depth * (pitchDrop / 12)),
 );
 const storedOuter = Number(lean.eaveHeight) || geoOuter;
 const outerH =
 (lean.roofStyle || 'shed') === 'shed' ? Math.min(storedOuter, geoOuter) : storedOuter;
 if (!(length > 0.1)) continue;
 if (!isLeanFaceOpen(lean, 'outer')) {
 const lv = girtLevelsForHeight(outerH, spacingFt, wainH, levelOpts).filter(
 (y) => y <= outerH + 0.05,
 );
 runs.push({
 wall: `${lean.wall}-outer`,
 lengthFt: length,
 rows: lv.length,
 host: lean.id || 'lean',
 });
 }
 // Dual enclosed eave wings: lean end walls sit in the extended gable
 // plane and are packed with main gable girts in SB (Mark → ~56 not 85+).
 if (depth > 0.1 && !dualEaveLeans) {
 const endH = Math.max(outerH, attachH);
 const lv = girtLevelsForHeight(endH, spacingFt, wainH, levelOpts).filter(
 (y) => y <= endH + 0.05,
 );
 if (!isLeanFaceOpen(lean, 'leftEnd')) {
 runs.push({
 wall: `${lean.wall}-leftEnd`,
 lengthFt: depth,
 rows: lv.length,
 host: lean.id || 'lean',
 });
 }
 if (!isLeanFaceOpen(lean, 'rightEnd')) {
 runs.push({
 wall: `${lean.wall}-rightEnd`,
 lengthFt: depth,
 rows: lv.length,
 host: lean.id || 'lean',
 });
 }
 }
 }

 const linearFt = runs.reduce((s, r) => s + r.lengthFt * r.rows, 0);
 const openSidewalls = isWallOpen(b, 'left') && isWallOpen(b, 'right');

 return {
 levels,
 levelCount: levels.length,
 linearFt,
 runs,
 /** From productionPolicy: continuous | per-wall */
 packMode: girtPackMode(b),
 productionPackage: production,
 size: b.girtSize,
 walls: closed,
 openWalls: openWallList(b),
 openSidewalls,
 wainscotGirtAt: wainOn ? wainH : null,
 };
}

/**
 * Roof purlins along building length, spaced up the slope.
 *
 * halfRun = width/2 + frame OH + metal OH (min 3″ drip via policy)
 * pad     = purlinStationPad(b): metal OH ≥ 6″ → +2, else +1
 * rowsPerSide = max(2, ceil(halfRun / spacing) + pad)
 *
 * 30′ @ 3″ OH → 9/side; 55′ @ 6″ OH → 16/side (production).
 */
export function generatePurlins(b) {
 const metalOh = panelMetalOverhangIn(b) / 12;
 const frameOh = (Number(b.overhangIn) || 0) / 12;
 const rafter = rafterLength(b);
 const halfRun = (Number(b.width) || 0) / 2 + metalOh + frameOh;
 const stationPad = purlinStationPad(b);
 const rowsPerSide = purlinRowsPerSide(b);
 const sides = b.roofStyle === 'mono' ? 1 : 2;
 const runLength = Number(b.length) || 0;
 const linearFt = rowsPerSide * sides * runLength;

 return {
 rowsPerSide,
 sides,
 linearFt,
 size: b.purlinSize,
 rafterLength: rafter,
 stationPad,
 halfRunFt: halfRun,
 };
}

/**
 * Truss count along building length.
 */
export function generateTrusses(b) {
 // item list: 60' @ 5' o.c. → 13 trusses (ends inclusive)
 const sp = b.trussSpacing || 5;
 const n = Math.floor(b.length / sp) + 1;
 return {
 count: n,
 spacing: sp,
 actualSpacing: b.length / Math.max(1, n - 1),
 };
}

/**
 * Skirt board linear feet (treated).
 * Main closed perimeter + enclosed lean-to closed faces (includes lean base).
 * Open drive-through faces have no grade board.
 */
export function generateSkirt(b) {
 /** @type {{ lengthFt: number, rows: number }[]} */
 const runs = [];
 let linearFt = 0;
 const dualEaveLeans = hasDualFullEnclosedEaveLeans(b);
 for (const wall of closedWallList(b)) {
 if (dualEaveLeans && (wall === 'left' || wall === 'right')) continue;
 const len = wallLength(b, wall);
 linearFt += len;
 runs.push({ lengthFt: len, rows: 1 });
 }
 // Enclosed lean-tos: skirt on closed outer + end faces (includes lean base)
 for (const lean of b.leanTos || []) {
 if (!isLeanEnclosed(lean)) continue;
 const wallLen = wallLength(b, lean.wall);
 const offset = Number(lean.offset) || 0;
 const length =
 lean.length > 0 ? Math.min(Number(lean.length) || 0, wallLen - offset) : wallLen - offset;
 const depth = Number(lean.depth) || 0;
 if (!(length > 0.1) || !(depth > 0.1)) continue;
 if (!isLeanFaceOpen(lean, 'outer')) {
 linearFt += length;
 runs.push({ lengthFt: length, rows: 1 });
 }
 // Dual eave wings: lean-end skirt is in the extended gable line (Mark SB 8).
 if (!dualEaveLeans) {
 if (!isLeanFaceOpen(lean, 'leftEnd')) {
 linearFt += depth;
 runs.push({ lengthFt: depth, rows: 1 });
 }
 if (!isLeanFaceOpen(lean, 'rightEnd')) {
 linearFt += depth;
 runs.push({ lengthFt: depth, rows: 1 });
 }
 }
 }
 return {
 linearFt,
 runs,
 size: b.skirtSize || '2x6',
 note: 'Main closed perimeter + enclosed lean-to closed faces',
 };
}

/**
 * Truss carriers on eave walls (left & right along building length).
 * Always 2-ply of the selected size (2x10 or 2x12).
 * Linear feet of lumber = 2 eaves × length × 2 plies.
 */
export function generateTrussCarriers(b) {
 const size = b.trussCarrierSize || '2x10';
 const plies = 2;
 // Roof still needs carriers on eave lines even if wall is open (drive-through under roof)
 const eaveWalls = 2; // left + right
 const runFt = b.length;
 const linearFt = eaveWalls * plies * runFt;
 return {
 size,
 plies,
 eaveWalls,
 runFt,
 linearFt,
 description: `2-ply ${size} truss carrier @ eaves (L&R)`,
 };
}

/**
 * Opening lumber — production order package (calibrated to SmartBuild order lists).
 *
 * Names: Header / Trimmer / Sill / Backing (no KingStud on order list).
 * Stock: prefer 12' boards when RO + bearing fits.
 *
 * Window: 2-ply 2x6 header @12, 1 sill @12, 4 backing @12 (no jacks/kings on order).
 * Walk:   2-ply 2x6 header @12, 2 trimmers @12, 6x6 jamb posts.
 * OH/slider: 1× 2x12 @12 + 2× 2x6 @12 (SB order package), 6x6 jamb posts.
 *
 * Full package (eave≥14′ / lean) emits Header+Trimmer+Sill+Backing (Levi).
 * Small-shop takeoff omits Trimmer/Sill/Backing — headers + JambPost only (60×60×10 SB).
 *
 * Typical full OH + walk + 1 window → Header 1@2x12 + 4@2x6, Trimmer 2, Sill 1, Backing 4.
 */
export function openingFraming(openings, b = {}) {
 /** Order stock: prefer 12' for opening lumber when piece fits. */
 const stock12 = (ft) => {
 const x = Math.max(0.5, Number(ft) || 0);
 if (x <= 12.01) return 12;
 if (x <= 14.01) return 14;
 if (x <= 16.01) return 16;
 return Math.ceil(x);
 };

 return (openings || []).map((o) => {
 const w = Number(o.width) || 0;
 const h = Number(o.height) || 0;
 const type = o.type || 'walk';
 // Bearing past RO — order still packs to 12' stock for common openings
 const headerSpan = w + 0.5;

 if (type === 'window') {
 // Order list: Header + Sill + Backing only (no KingStud / window Trimmer lines)
 return {
 openingId: o.id,
 type,
 role: 'window',
 kingStuds: null,
 jackStuds: null,
 header: { size: '2x6', plies: 2, lengthFt: stock12(headerSpan), cutFt: headerSpan },
 sill: { size: '2x6', qty: 1, lengthFt: stock12(Math.max(w + 0.25, 1)), cutFt: w + 0.25 },
 // Window nailer package — 4× 2x6x12 per window (production "Backing")
 backing: { size: '2x6', qty: 4, lengthFt: 12 },
 needsJambPosts: false,
 headerWidth: w,
 };
 }

 if (type === 'walk') {
 return {
 openingId: o.id,
 type,
 role: 'walk',
 kingStuds: null,
 // Production lists door jacks as Trimmer @ 12'
 jackStuds: { size: '2x6', qty: 2, lengthFt: stock12(Math.max(h, 1)), cutFt: h },
 header: { size: '2x6', plies: 2, lengthFt: stock12(headerSpan), cutFt: headerSpan },
 sill: null,
 backing: null,
 needsJambPosts: true,
 headerWidth: w,
 };
 }

 // Overhead / slider — 2x12 main; small-shop also 2× 2x6 package boards per door
 // (SB 35×55: 3 OH → 3@2x12 + 6@2x6). Full package (Levi) lists 2x12 only.
 const smallShop = !useFullGirtPackage(b);
 return {
 openingId: o.id,
 type,
 role: type,
 kingStuds: null,
 jackStuds: null,
 header: {
 size: '2x12',
 plies: 1,
 lengthFt: stock12(Math.max(headerSpan, 10)),
 cutFt: headerSpan,
 },
 headerSecondary: smallShop
 ? {
 size: '2x6',
 plies: 2,
 lengthFt: stock12(Math.max(headerSpan, 10)),
 cutFt: headerSpan,
 }
 : null,
 sill: null,
 backing: null,
 needsJambPosts: true,
 headerWidth: w,
 };
 });
}

/**
 * Full framing package for one building (main + lean-tos).
 */
export function generateFraming(b) {
 // Normalize stale lean outer eaves (old default pitch 3 → 12' on 14'/8' lean)
 // so posts, metal, and girts share production geometry.
 // Keep explicit broken-pitch leans (lean.pitch ≠ main.pitch) — SB orders
 // separate roof planes; do not force lean pitch up to main.
 for (const lt of b.leanTos || []) {
 if (!lt || (lt.roofStyle || 'shed') === 'gable') continue;
 const depth = Number(lt.depth) || 0;
 if (!(depth > 0)) continue;
 const mainE = Number(b.eaveHeight) || 12;
 const mainPitch = Number(b.pitch) || 4;
 let leanPitch = Number(lt.pitch);
 // Only coerce the historical unset default of 3 when eaveHeight also looks
 // like the stale-3 geometry. Intentional lower pitches (e.g. 2/12 lean on
 // 4/12 main) must be preserved for broken-pitch takeoffs.
 const stale3 = Math.max(8, roundFtToNearestInch(mainE - depth * (3 / 12)));
 const cur0 = Number(lt.eaveHeight);
 const looksStale3 =
  Math.abs((leanPitch || 0) - 3) < 0.01 &&
  (!cur0 || Math.abs(cur0 - stale3) < 0.15);
 if (looksStale3) {
  lt.pitch = mainPitch;
  leanPitch = mainPitch;
 } else if (!(leanPitch > 0)) {
  leanPitch = mainPitch;
  lt.pitch = mainPitch;
 }
 // Outer eave drop follows lean pitch (broken-pitch) or main when matched.
 const dropPitch = leanPitch || mainPitch;
 const geo = Math.max(8, roundFtToNearestInch(mainE - depth * (dropPitch / 12)));
 // Coarse 0.1' rounding artifact (14−8×4/12 → 11.3 instead of 11'4")
 const coarse10 = Math.round((mainE - depth * (dropPitch / 12)) * 10) / 10;
 let cur = Number(lt.eaveHeight);
 if (!cur || Math.abs(cur - stale3) < 0.15 || Math.abs(cur - coarse10) < 0.05) {
 lt.eaveHeight = geo;
 } else {
 lt.eaveHeight = roundFtToNearestInch(cur);
 }
 }
 const mainPosts = generateMainPosts(b);
 const leanPackages = (b.leanTos || []).map((lt) => ({
 lean: lt,
 ...generateLeanToPosts(b, lt, mainPosts),
 }));
 // Deduplicate lean posts against main posts (safety)
 const mainKeys = new Set(mainPosts.map((p) => keyXZ(p.x, p.z)));
 const leanPosts = leanPackages
 .flatMap((p) => p.posts)
 .filter((p) => !mainKeys.has(keyXZ(p.x, p.z)));
 const girts = generateGirts(b);
 const purlins = generatePurlins(b);
 const trusses = generateTrusses(b);
 const skirt = generateSkirt(b);
 const trussCarriers = generateTrussCarriers(b);
 const openings = openingFraming(b.openings || [], b);

 // Aggregate lean-to lumber from per-package material models
 // Note: lean girts/skirt are already in girts.runs / skirt.runs.
 // Lean roof structure orders as Purlin (production), not Truss / Rafter.
 let leanGirtLf = 0;
 let leanPurlinLf = 0;
 let leanLedgerLf = 0;
 let leanSubFasciaLf = 0;
 for (const pkg of leanPackages) {
 const m = pkg.materials || computeLeanToMaterials(b, pkg.lean, pkg);
 leanGirtLf += m.girtLf || 0;
 leanPurlinLf += m.purlinLf || 0;
 leanLedgerLf += m.ledgerLf || 0;
 leanSubFasciaLf += m.subFasciaLf || 0;
 }

 return {
 mainPosts,
 leanPosts,
 allPosts: [...mainPosts, ...leanPosts],
 girts,
 purlins,
 trusses,
 skirt,
 trussCarriers,
 openings,
 leanPackages,
 leanGirtLf,
 leanPurlinLf,
 leanLedgerLf,
 leanSubFasciaLf,
 leanSkirtLf: skirt.runs?.filter((r) => r.lengthFt > 0).length || 0,
 roofRise: roofRise(b),
 rafterLength: rafterLength(b),
 };
}

/**
 * Round up linear feet into stock board lengths.
 * Prefers longer boards to reduce joints (common lumber yard practice).
 */
/**
 * Pack linear feet into whole boards.
 * Uses preferred stock order (first = most preferred when packing remainders).
 * When stock is [16,12,...], prefers maximizing 16' then filling with 12' (item list purlin mix).
 */
export function optimizeBoards(linearFt, stockLengths = [20, 16, 14, 12, 10, 8]) {
 let remaining = Math.max(0, linearFt);
 const boards = {};
 for (const len of stockLengths) boards[len] = 0;

 // Primary pack with preferred (first) length
 const primary = stockLengths[0];
 if (primary > 0 && remaining >= primary) {
 const n = Math.floor(remaining / primary);
 boards[primary] = n;
 remaining = Math.round((remaining - n * primary) * 1000) / 1000;
 }

 // Fill remainder: shortest board that covers remainder (avoid 20' for an 8' stub)
 const ascending = [...stockLengths].sort((a, b) => a - b);
 while (remaining > 0.01) {
 const picked = ascending.find((l) => l + 0.001 >= remaining) || ascending[ascending.length - 1];
 boards[picked] = (boards[picked] || 0) + 1;
 remaining = Math.round((remaining - picked) * 1000) / 1000;
 if (remaining < 0) remaining = 0;
 }

 return Object.entries(boards)
 .filter(([, qty]) => qty > 0)
 .map(([length, qty]) => ({ lengthFt: Number(length), qty }))
 .sort((a, b) => b.lengthFt - a.lengthFt);
}

/**
 * Post stock lengths: 2' increments from 8' through 24' (supplier max 6x6).
 * Taller stations order 24' + field spliced note.
 */
export const POST_STOCK_LENGTHS = [8, 10, 12, 14, 16, 18, 20, 22, 24];

/**
 * Max rise / full-roof-rise for collapsing a 2nd stock step (e.g. 18′→14′).
 * Sized so 60×10 low-gable jambs package as eave (SB 4@14′) while Levi front
 * OH jambs (riseFrac ≈ 0.44 on 55×14) keep full 22′ stock.
 */
export const JAMB_SECOND_STEP_MAX_RISE_FRAC = 0.42;

/**
 * Door jamb ORDER height (SB framing lists).
 *
 * Structural height still follows the rake for 3D/plans. For stock only:
 *  1) full stock ≤ eave stock + 2′  → package as eave (16′→14′ always)
 *  2) full stock ≤ eave stock + 4′ AND rise/fullRise ≤ 0.42 → eave
 *     (low 18′ gable jambs → 14′; mid/peak and Levi 22′ stay full height)
 *
 * Returns { heightFt, eaveClamped } so stock pick can apply SB eave-jamb step-down.
 */
export function jambOrderHeightFt(b, heightAboveGradeFt, isOpeningJamb, postDepthFt) {
 if (!isOpeningJamb) {
 return { heightFt: Number(heightAboveGradeFt) || 0, eaveClamped: false };
 }
 const eave = Number(b?.eaveHeight) || 0;
 const h = Number(heightAboveGradeFt) || 0;
 const embed = Number(postDepthFt ?? b?.postDepthFt) || 3;
 const eaveStock = pickPostStockLengthCore(eave, embed).stockFt;
 const fullStock = pickPostStockLengthCore(h, embed).stockFt;
 const riseAboveEave = h - eave;
 // Already on eave wall (no rise): normal eave post stock — do NOT step down.
 // (35×55×12 SB: all 6 jambs @16′ same as wall posts.)
 if (riseAboveEave <= 0.05) {
 return { heightFt: eave, eaveClamped: false };
 }
 // Low gable: collapse toward eave; eaveClamped triggers optional step-down stock
 if (fullStock <= eaveStock + 2.001) {
 return { heightFt: eave, eaveClamped: true };
 }
 if (fullStock <= eaveStock + 4.001) {
 const fullRise = Math.max(0.1, Number(roofRise(b)) || 0.1);
 const riseFrac = Math.max(0, riseAboveEave) / fullRise;
 if (riseFrac <= JAMB_SECOND_STEP_MAX_RISE_FRAC + 1e-9) {
 return { heightFt: eave, eaveClamped: true };
 }
 }
 return { heightFt: h, eaveClamped: false };
}

/**
 * Low-gable jambs collapsed to eave use the same stock as eave wall posts.
 * (Earlier −2′ step matched one 60×12 dump but broke 35×55 SB 6@16′ jambs.)
 */
export function eaveClampedJambStockFt(eaveHeightFt, postDepthFt) {
 const eave = Number(eaveHeightFt) || 0;
 const embed = Number(postDepthFt) || 3;
 return pickPostStockLengthCore(eave, embed).stockFt;
}

/**
 * Core stock pick (no jamb override). Used by pickPostStockLength + jamb rule.
 * @param {number} heightAboveGradeFt
 * @param {number} postDepthFt
 * @param {number[]} [stock]
 * @param {{ minGradeSlackFt?: number }} [coreOpts]
 *   minGradeSlackFt — default 0.5′ (6″). Jambs use ~0 so mid-gable 17.7′ stays 18′ not 20′.
 * @returns {{ requiredFt: number, stockFt: number, gradeBufferApplied: boolean, fieldCutFt: number|null, overMax?: boolean }}
 */
function pickPostStockLengthCore(
 heightAboveGradeFt,
 postDepthFt,
 stock = POST_STOCK_LENGTHS,
 coreOpts = {},
) {
 const sorted = [...stock].sort((a, b) => a - b);
 const requiredFt = (Number(heightAboveGradeFt) || 0) + (Number(postDepthFt) || 0);
 if (requiredFt <= 0) {
 return { requiredFt: 0, stockFt: sorted[0], gradeBufferApplied: false, fieldCutFt: null };
 }

 const eps = 0.001;
 const MIN_GRADE_SLACK_FT =
 coreOpts.minGradeSlackFt != null ? Number(coreOpts.minGradeSlackFt) : 0.5;
 let stockFt = sorted.find((L) => L + eps >= requiredFt);
 if (stockFt == null) {
 const maxL = sorted[sorted.length - 1] || 24;
 // Order max stock; field-cut callout = required to nearest inch (SB uses plan length)
 const fieldCutFt = Math.round(requiredFt * 12) / 12;
 return {
 requiredFt,
 stockFt: maxL,
 gradeBufferApplied: true,
 fieldCutFt,
 overMax: true,
 };
 }

 // SB mid-gable: req ~18.1–18.5′ orders 18′ not 20′ on narrow barns
 // (35×55 / 40×40 band). Wide barns (W ≥ 50, e.g. 60×12 mid @18.33′) keep 20′.
 // Do NOT general shortfall — that wrongly demotes 60×10 16.33′→16′ instead of 18′.
 if (
 !coreOpts.disableMidGable18 &&
 stockFt === 20 &&
 requiredFt > 18 + eps &&
 requiredFt <= 18.5 + eps
 ) {
 stockFt = 18;
 }

 let gradeBufferApplied = false;
 const slack = stockFt - requiredFt;
 // Exact hit OR slack under min → next 2' (only when stock covers required)
 if (slack >= -eps && slack < MIN_GRADE_SLACK_FT - eps) {
 const next = sorted.find((L) => L > stockFt + eps);
 if (next != null) {
 stockFt = next;
 gradeBufferApplied = true;
 }
 }

 let fieldCutFt = null;
 const maxStock = sorted[sorted.length - 1] || 24;
 if (requiredFt > maxStock + eps) {
 stockFt = maxStock;
 gradeBufferApplied = true;
 // Prefer actual required (nearest inch) so 12′ eave peaks call out ~25′ not a fixed 26′7″
 fieldCutFt = Math.round(requiredFt * 12) / 12;
 }

 return { requiredFt, stockFt, gradeBufferApplied, fieldCutFt };
}

/**
 * Order length for a post-frame post.
 *
 * required = height above grade (eave OR gable-end height at that station) + post depth
 * Then round UP to next even stock length (8'–24' max).
 *
 * Grade buffer (SB / production) for regular posts:
 *   1) Exact hit on a stock length → bump +2' (e.g. 18' exact → 20').
 *   2) If slack (stock − required) is under MIN_GRADE_SLACK (6"), bump +2'
 *      so peaks with 21.67' required don't order a tight 22' — SB uses 24'
 *      on 40×40 4/12 @ 3' embed (21.67' → 24').
 *
 * Door jambs (opts.isOpeningJamb):
 *   - near-eave stocks collapse to eave package (jambOrderHeightFt)
 *   - soft grade buffer (exact-hit only) so 17.7′ stays 18′ not 20′ (SB mid-jambs)
 *   - near-peak: if first pick is 22′ and required > 21′, bump to 24′ (SB peak jambs)
 *
 * @param {number} heightAboveGradeFt - eave height, or taller gable-end height toward peak
 * @param {number} postDepthFt
 * @param {number[]} [stock]
 * @param {{ isOpeningJamb?: boolean, building?: object }} [opts]
 * @returns {{ requiredFt: number, stockFt: number, gradeBufferApplied: boolean }}
 */
export function pickPostStockLength(heightAboveGradeFt, postDepthFt, stock = POST_STOCK_LENGTHS, opts = {}) {
 const isJamb = !!(opts && opts.isOpeningJamb);
 let orderH = heightAboveGradeFt;
 let eaveClamped = false;
 if (isJamb && opts.building) {
 const jo = jambOrderHeightFt(opts.building, heightAboveGradeFt, true, postDepthFt);
 orderH = jo.heightFt;
 eaveClamped = !!jo.eaveClamped;
 }
 // Eave-clamped jambs: SB packages shorter than eave wall posts on 12′+ eaves
 // (12′ eave → wall posts 16′, jambs 14′; 10′ eave → both 14′).
 if (isJamb && eaveClamped && opts.building) {
 const jambStock = eaveClampedJambStockFt(
 opts.building.eaveHeight,
 postDepthFt ?? opts.building.postDepthFt,
 );
 const embed = Number(postDepthFt ?? opts.building.postDepthFt) || 3;
 return {
 requiredFt: (Number(orderH) || 0) + embed,
 stockFt: jambStock,
 gradeBufferApplied: false,
 fieldCutFt: null,
 };
 }
 // Jambs: exact-hit buffer only. Regular posts: 6" grade buffer + mid-gable 18′ rule.
 // Wide buildings (W ≥ 50): SB keeps 20′ for mid-gable req 18.1–18.5′ (60×12).
 const W = Number(opts.building?.width) || 0;
 // Mid-gable 18′ demotion: mid-width (35–50′) always; narrow (<35′) only when
 // plain (no lean). Open/broken lean on 30′ keeps 20′ gable stock (Prater).
 const applyMidGable18 =
 (W >= 35 && W < 50) || (W > 0 && W < 35 && !hasAnyLean(opts.building));
 const pick = pickPostStockLengthCore(orderH, postDepthFt, stock, {
 minGradeSlackFt: isJamb ? 0.05 : 0.5,
 disableMidGable18: isJamb || !applyMidGable18,
 });
 // Near-peak grade (SB / Kane): bump tight 22′ stock to 24′ when required is
 // past the 21′ band (e.g. 32′×12′ 4/12 peak req 21.33′ → 24′, not 22′).
 // Exact req=21′ (h=18′ @ 3′ embed) stays 22′ (golden SB 1@22 + 1@24).
 // Applies to peak posts and near-peak jambs.
 const structH = Number(heightAboveGradeFt) || 0;
 const req = Number(pick.requiredFt) || 0;
 const nearPeakTight22 =
  pick.stockFt === 22 &&
  !pick.overMax &&
  (req > 21.001 || (isJamb && structH > 18.001));
 if (nearPeakTight22) {
 const next = [...(stock || POST_STOCK_LENGTHS)].sort((a, b) => a - b).find((L) => L > 22);
 if (next != null) {
 return {
 ...pick,
 stockFt: next,
 gradeBufferApplied: true,
 };
 }
 }
 return pick;
}

/**
 * Group posts into ordered stock lengths (already picked per-post via totalLengthFt).
 */
export function optimizePostLengths(posts) {
 /** @type {Record<string, { stockFt: number, qty: number, gradeBuffer: boolean, fieldCutFt: number|null }>} */
 const groups = {};
 for (const p of posts) {
 const pick =
 p.stockFt != null
 ? {
 stockFt: p.stockFt,
 requiredFt: p.requiredFt ?? p.totalLengthFt,
 gradeBufferApplied: !!p.gradeBufferApplied,
 fieldCutFt: p.fieldCutFt ?? null,
 }
 : pickPostStockLength(p.heightAboveGrade, p.embedFt);
 const stockFt = Math.round(Number(pick.stockFt) * 12) / 12;
 const fieldCutFt =
 pick.fieldCutFt != null && pick.fieldCutFt > 0
 ? Math.round(Number(pick.fieldCutFt) * 12) / 12
 : null;
 // Peak field-cut posts stay on their own order line (annotate 26'7")
 const key =
 fieldCutFt != null
 ? `fc:${Math.round(fieldCutFt * 12)}@${Math.round(stockFt * 12)}`
 : `st:${Math.round(stockFt * 12)}`;
 if (!groups[key]) {
 groups[key] = {
 stockFt,
 qty: 0,
 gradeBuffer: false,
 fieldCutFt,
 };
 }
 groups[key].qty += 1;
 if (pick.gradeBufferApplied) groups[key].gradeBuffer = true;
 }
 return Object.values(groups)
 .map((g) => ({
 lengthFt: g.stockFt,
 qty: g.qty,
 gradeBuffer: g.gradeBuffer,
 fieldCutFt: g.fieldCutFt,
 }))
 .sort((a, b) => {
 // Peak field-cut lines first among same stock, then longer stock first
 const fa = a.fieldCutFt || 0;
 const fb = b.fieldCutFt || 0;
 if (Math.abs(fb - fa) > 1e-6) return fb - fa;
 return b.lengthFt - a.lengthFt;
 });
}
