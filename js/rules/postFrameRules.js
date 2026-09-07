/**
 * Post-frame construction rule checks.
 * Based on common NFBA / municipal practices (not a PE stamp substitute).
 *
 * Typical references:
 * - Posts 8' o.c. common; many jurisdictions cap at 8–12'
 * - Wall girts min 2x4 @ 24" o.c. for 8' spans
 * - Purlins min 2x4; spacing per metal panel / snow load
 * - Embedded posts: frost depth, concrete pad, AWPA UC4B treatment
 * - Large openings need engineered headers
 */

import {
 wallLength,
 openingHostLength,
 openWallList,
 isWallOpen,
 WALL_LABELS,
} from '../domain/types.js?v=20260806f';
import {
 generateFraming,
 pickPostStockLength,
 postHeightAboveGrade,
 postAlongWall,
 postBlocksOpening,
 isDoorOpening,
 isWindowOpening,
} from '../domain/framing.js?v=20260806f';
import { auditBuilding } from './constructionAudit.js?v=20260806f';

/**
 * @returns {{level:'ok'|'warn'|'error', code:string, message:string, category?: string}[]}
 */
export function evaluateBuildingRules(b, takeoffItems = null) {
 const rules = [];
 const framing = generateFraming(b);

 // Size-aware construction self-check (geometry + takeoff cross-check)
 try {
 const audit = auditBuilding(b, takeoffItems);
 for (const it of audit.items) {
 rules.push({
 level: it.level,
 code: it.code,
 message: it.message,
 category: it.category,
 });
 }
 } catch (err) {
 rules.push({
 level: 'warn',
 code: 'AUDIT_FAILED',
 message: `Construction self-check could not run: ${err.message || err}`,
 category: 'System',
 });
 }

 // --- Posts ---
 if (b.postSpacing > 12) {
 rules.push({
 level: 'error',
 code: 'POST_SPACING_EXCESS',
 message: `Post spacing ${b.postSpacing}' exceeds typical max (12'). Engineering required.`,
 });
 } else if (b.postSpacing > 10) {
 rules.push({
 level: 'warn',
 code: 'POST_SPACING_HIGH',
 message: `Post spacing ${b.postSpacing}' is high — verify with engineer / local code (common max 8–10').`,
 });
 } else if (b.postSpacing > 8) {
 rules.push({
 level: 'warn',
 code: 'POST_SPACING_ABOVE_COMMON',
 message: `Post spacing ${b.postSpacing}' is above the most common 8' o.c. — confirm girt span and loads.`,
 });
 } else {
 rules.push({
 level: 'ok',
 code: 'POST_SPACING_OK',
 message: `Post spacing ${b.postSpacing}' o.c. is within common post-frame practice.`,
 });
 }

 // --- Trusses ---
 if (b.trussSpacing > 8) {
 rules.push({
 level: 'warn',
 code: 'TRUSS_SPACING_HIGH',
 message: `Truss spacing ${b.trussSpacing}' — verify purlin design and truss manufacturer specs.`,
 });
 } else {
 rules.push({
 level: 'ok',
 code: 'TRUSS_SPACING_OK',
 message: `Truss spacing ${b.trussSpacing}' is in a typical range.`,
 });
 }

 // --- Width / clear span ---
 if (b.width > 60) {
 rules.push({
 level: 'warn',
 code: 'WIDTH_ENGINEERED',
 message: `Width ${b.width}' is large — engineered trusses and PE review typically required.`,
 });
 } else if (b.width > 40) {
 rules.push({
 level: 'ok',
 code: 'WIDTH_STANDARD_WIDE',
 message: `Width ${b.width}' — use engineered trusses rated for site snow/wind loads.`,
 });
 } else {
 rules.push({
 level: 'ok',
 code: 'WIDTH_OK',
 message: `Width ${b.width}' is in a standard post-frame range.`,
 });
 }

 // --- Height ---
 if (b.eaveHeight > 20) {
 rules.push({
 level: 'warn',
 code: 'HEIGHT_HIGH',
 message: `Eave height ${b.eaveHeight}' — check post embedment, wind, and post grade/size.`,
 });
 } else {
 rules.push({
 level: 'ok',
 code: 'HEIGHT_OK',
 message: `Eave height ${b.eaveHeight}' is common for shops and barns.`,
 });
 }

 // --- Pitch ---
 if (b.pitch < 2) {
 rules.push({
 level: 'warn',
 code: 'PITCH_LOW',
 message: `Roof pitch ${b.pitch}/12 is low for metal — confirm panel manufacturer min slope.`,
 });
 } else if (b.pitch > 8) {
 rules.push({
 level: 'ok',
 code: 'PITCH_STEEP',
 message: `Pitch ${b.pitch}/12 is steep — plan for longer posts/rafters and fall protection.`,
 });
 } else {
 rules.push({
 level: 'ok',
 code: 'PITCH_OK',
 message: `Roof pitch ${b.pitch}/12 is typical for post-frame metal roofs.`,
 });
 }

 // --- Girts ---
 const girtSpan = b.postSpacing;
 const girtIn = b.girtSpacingIn || 24;
 if (girtIn > 24 && girtSpan >= 8) {
 rules.push({
 level: 'warn',
 code: 'GIRT_SPACING',
 message: `Girts @ ${girtIn}" o.c. with ${girtSpan}' post span — many codes want 2x4/2x6 ≤24" o.c.`,
 });
 } else {
 rules.push({
 level: 'ok',
 code: 'GIRT_OK',
 message: `Wall girts ${b.girtSize} @ ${girtIn}" o.c. for ${girtSpan}' post spans (verify load).`,
 });
 }

 // --- Purlins ---
 const purlinIn = b.purlinSpacingIn || 24;
 if (purlinIn > 24) {
 rules.push({
 level: 'warn',
 code: 'PURLIN_SPACING',
 message: `Purlin spacing ${purlinIn}" — confirm metal panel gauge and snow load tables.`,
 });
 } else {
 rules.push({
 level: 'ok',
 code: 'PURLIN_OK',
 message: `Roof purlins ${b.purlinSize} @ ${purlinIn}" o.c.`,
 });
 }

 // --- Openings on walls / lean-tos ---
 for (const o of b.openings || []) {
 const wl = openingHostLength(b, o);
 const end = o.offset + o.width;
 const hostLabel =
 !o.host || o.host === 'main'
 ? `${o.wall} wall`
 : `lean-to ${o.face || 'outer'}`;

 if (o.host && o.host !== 'main') {
 const lean = (b.leanTos || []).find((l) => l.id === o.host);
 if (!lean) {
 rules.push({
 level: 'error',
 code: 'OPENING_ORPHAN_LEAN',
 message: `${labelOpening(o)} references a missing lean-to.`,
 });
 continue;
 }
 const maxH = lean.eaveHeight;
 if (o.height > maxH - 0.25) {
 rules.push({
 level: 'error',
 code: 'OPENING_TOO_TALL_LEAN',
 message: `${labelOpening(o)} height exceeds lean-to eave (${maxH}').`,
 });
 }
 }

 if (o.offset < 0 || end > wl + 0.05) {
 rules.push({
 level: 'error',
 code: 'OPENING_OUT_OF_BOUNDS',
 message: `${labelOpening(o)} on ${hostLabel} is outside length (${wl.toFixed(1)}').`,
 });
 } else if (o.offset < 1 || end > wl - 1) {
 rules.push({
 level: 'warn',
 code: 'OPENING_NEAR_CORNER',
 message: `${labelOpening(o)} on ${hostLabel} is within 1' of an end — check post/header bearing.`,
 });
 }

 if (o.type === 'overhead' || o.type === 'slider') {
 if (o.width > 16) {
 rules.push({
 level: 'warn',
 code: 'LARGE_OPENING',
 message: `${labelOpening(o)} is wide — engineered header / door package required.`,
 });
 } else if (o.width > 12) {
 rules.push({
 level: 'warn',
 code: 'MED_OPENING',
 message: `${labelOpening(o)} — verify header size and king posts / trimmers.`,
 });
 }
 const maxH = !o.host || o.host === 'main' ? b.eaveHeight : (b.leanTos || []).find((l) => l.id === o.host)?.eaveHeight || b.eaveHeight;
 if (o.height > maxH - 0.5) {
 rules.push({
 level: 'error',
 code: 'OPENING_TOO_TALL',
 message: `${labelOpening(o)} height exceeds eave height.`,
 });
 }
 }

 if ((!o.host || o.host === 'main') && o.width > b.postSpacing) {
 rules.push({
 level: 'warn',
 code: 'OPENING_MULTI_BAY',
 message: `${labelOpening(o)} spans more than one post bay — engineered header across multiple bays required.`,
 });
 }

 // --- Buildable post / stud rules (main walls only) ---
 if (!o.host || o.host === 'main') {
 const wall = o.wall || 'front';
 const u0 = Number(o.offset);
 const u1 = u0 + Number(o.width);
 const blocking = (framing.mainPosts || []).filter((p) => {
 const u = postAlongWall(p, wall, b);
 return u != null && postBlocksOpening(u, o);
 });

 if (blocking.length) {
 rules.push({
 level: 'error',
 code: 'POST_IN_OPENING',
 message: `${labelOpening(o)} on ${wall} still has ${blocking.length} post(s) in the RO — must clear or relocate.`,
 });
 } else if (isDoorOpening(o)) {
 // Doors: 6x6 required both jambs (moved post counts as one side)
 const near = (target) =>
 (framing.mainPosts || []).some((p) => {
 const u = postAlongWall(p, wall, b);
 return u != null && Math.abs(u - target) <= 0.25;
 });
 const leftJamb = near(u0);
 const rightJamb = near(u1);
 if (!leftJamb || !rightJamb) {
 rules.push({
 level: 'error',
 code: 'DOOR_JAMB_POSTS',
 message: `${labelOpening(o)} on ${wall}: needs a 6x6 at each jamb (${u0.toFixed(1)}' & ${u1.toFixed(1)}'). If a post was in the RO it should move to one side.`,
 });
 } else {
 const jambMarked = (framing.mainPosts || []).filter(
 (p) => p.openingJamb && postAlongWall(p, wall, b) != null,
 ).length;
 rules.push({
 level: 'ok',
 code: 'DOOR_JAMB_OK',
 message: `${labelOpening(o)} on ${wall}: RO clear, 6x6 at both jambs${jambMarked ? ` (${jambMarked} jamb post(s) tagged)` : ''}. Header bears on posts; walk doors order 2x6 Header + Trimmer.`,
 });
 }
 if (o.type === 'overhead' && o.width > 16) {
 rules.push({
 level: 'warn',
 code: 'OH_ENGINEER_HEADER',
 message: `${labelOpening(o)}: OH over 16' needs PE header / door package — order lists 1× 2x12 header stock.`,
 });
 }
 } else if (isWindowOpening(o)) {
 // Windows: order Header + Sill + Backing (no 6x6 jambs; no KingStud line)
 rules.push({
 level: 'ok',
 code: 'WINDOW_STUD_FRAME',
 message: `${labelOpening(o)} on ${wall}: order Header (2-ply 2x6) + Sill + Backing; no extra 6x6 jamb posts. If a post was in the RO it relocates to the nearer jamb only.`,
 });
 if (o.width > 6) {
 rules.push({
 level: 'warn',
 code: 'WIDE_WINDOW',
 message: `${labelOpening(o)} is wider than 6' — verify header size and stud layout with your supplier package.`,
 });
 }
 const sill = Number(o.sillHeight) || 0;
 if (sill + o.height > b.eaveHeight - 0.25) {
 rules.push({
 level: 'error',
 code: 'WINDOW_TOO_TALL',
 message: `${labelOpening(o)} sill + height exceeds eave — not buildable as placed.`,
 });
 }
 }

 // Corner / bearing conflict for doors near building corners
 if (isDoorOpening(o) && (u0 < 0.5 || u1 > openingHostLength(b, o) - 0.5)) {
 rules.push({
 level: 'error',
 code: 'DOOR_AT_CORNER',
 message: `${labelOpening(o)} is too close to a wall end — need room for a full jamb post and corner post (min ~6").`,
 });
 }
 }
 }

 // --- Open walls (drive-through) ---
 const openWalls = openWallList(b);
 if (openWalls.length) {
 const labels = openWalls.map((w) => WALL_LABELS[w] || w).join(', ');
 rules.push({
 level: 'ok',
 code: 'OPEN_WALL',
 message: `Open wall (drive-through): ${labels} — metal/girts/mid-posts cleared to eave height only; gable peak metal above eave stays. Roof trusses retained inside.`,
 });
 }
 for (const o of b.openings || []) {
 if (o.host && o.host !== 'main') continue;
 if (isWallOpen(b, o.wall)) {
 rules.push({
 level: 'error',
 code: 'OPENING_ON_OPEN_WALL',
 message: `${labelOpening(o)} is on an open wall (${WALL_LABELS[o.wall] || o.wall}). Close the wall or remove the opening.`,
 });
 }
 }

 // Overlapping openings on same host surface
 const bySurface = {};
 for (const o of b.openings || []) {
 const key = `${o.host || 'main'}|${o.wall}|${o.face || 'main'}`;
 (bySurface[key] ||= []).push(o);
 }
 for (const [surface, list] of Object.entries(bySurface)) {
 const sorted = [...list].sort((a, b) => a.offset - b.offset);
 for (let i = 1; i < sorted.length; i++) {
 const prev = sorted[i - 1];
 const cur = sorted[i];
 if (cur.offset < prev.offset + prev.width) {
 rules.push({
 level: 'error',
 code: 'OPENING_OVERLAP',
 message: `Openings overlap on ${surface} (${labelOpening(prev)} and ${labelOpening(cur)}).`,
 });
 }
 }
 }

 // --- Lean-tos ---
 for (const lt of b.leanTos || []) {
 const wl = wallLength(b, lt.wall);
 const len = lt.length > 0 ? lt.length : wl - lt.offset;
 const label = lt.name || ((lt.roofStyle || 'shed') === 'gable' ? 'Gable extension' : 'Lean-to');
 if (lt.offset < 0 || lt.offset + len > wl + 0.05) {
 rules.push({
 level: 'error',
 code: 'ATTACH_BOUNDS',
 message: `${label} on ${lt.wall} extends beyond the main wall.`,
 });
 }
 if (lt.depth < 6) {
 rules.push({
 level: 'warn',
 code: 'ATTACH_SHALLOW',
 message: `${label} depth ${lt.depth}' is shallow — still valid but check use case.`,
 });
 }
 if (lt.eaveHeight > b.eaveHeight) {
 rules.push({
 level: 'warn',
 code: 'ATTACH_TALLER',
 message: `${label} eave (${lt.eaveHeight}') is taller than main building — check attachment detail.`,
 });
 }
 const roof = (lt.roofStyle || 'shed') === 'gable' ? 'gable' : 'shed';
 const ridge =
 roof === 'gable' ? ` · ridge rise ~${((lt.depth / 2) * (lt.pitch / 12)).toFixed(1)}'` : '';
 const enc = lt.enclosed === false ? 'open' : 'enclosed';
 rules.push({
 level: 'ok',
 code: 'ATTACH_OK',
 message: `${label} (${roof}, ${enc}) on ${lt.wall}: ${lt.depth}' deep × ${len.toFixed(1)}' long @ ${lt.eaveHeight}' eave · ${lt.pitch}/12${ridge}${lt.snapToPosts === true ? ' · snap to posts' : ''}${enc === 'open' ? ' · posts+roof only (no wall metal/girts)' : ' · walls on outer+ends · transition flash to main'}.`,
 });
 }

 // Shared post summary
 const shared = framing.mainPosts.filter((p) => p.sharedWithLeanTo?.length);
 if (shared.length) {
 rules.push({
 level: 'ok',
 code: 'SHARED_POSTS',
 message: `${shared.length} main-wall post(s) shared with lean-to(s) — not double-counted in takeoff.`,
 });
 }

 // --- Post depth / stock length (2' steps 8'–32', grade buffer on exact) ---
 const depth = b.postDepthFt ?? 4;
 const eavePick = pickPostStockLength(b.eaveHeight, depth);
 const peakH = postHeightAboveGrade(b, b.width / 2, 0, ['front']).heightAboveGrade;
 const peakPick = pickPostStockLength(peakH, depth);

 if (depth < 3 || depth > 6) {
 rules.push({
 level: 'warn',
 code: 'POST_DEPTH_RANGE',
 message: `Post depth ${depth}' is outside the usual 3'–6' range — confirm with local frost / soils.`,
 });
 }

 rules.push({
 level: 'ok',
 code: 'POST_LENGTH_EAVE',
 message: `Eave posts: ${b.eaveHeight}' above grade + ${depth}' depth = ${eavePick.requiredFt}' → order ${eavePick.stockFt}'${eavePick.gradeBufferApplied ? ' (grade buffer)' : ''}.`,
 });

 if (b.roofStyle === 'gable' || b.roofStyle === 'mono') {
 const rise = peakH - b.eaveHeight;
 rules.push({
 level: 'ok',
 code: 'POST_LENGTH_GABLE',
 message:
 b.roofStyle === 'gable'
 ? `Gable-end posts: grow with ${b.pitch}/12 pitch (rise ${rise.toFixed(1)}' at peak). Peak station ~${peakH.toFixed(1)}' above grade + ${depth}' depth → order ${peakPick.stockFt}'${peakPick.gradeBufferApplied ? ' (grade buffer)' : ''}. Intermediate gable posts size between eave and peak.`
 : `Mono posts: high eave / rake step with pitch. Tallest ~${peakH.toFixed(1)}' above grade + ${depth}' → order ${peakPick.stockFt}'.`,
 });
 }

 const byStock = {};
 for (const p of framing.mainPosts) {
 byStock[p.stockFt] = (byStock[p.stockFt] || 0) + 1;
 }
 const stockSummary = Object.entries(byStock)
 .sort((a, b) => Number(b[0]) - Number(a[0]))
 .map(([L, n]) => `${n} @ ${L}'`)
 .join(', ');
 rules.push({
 level: 'ok',
 code: 'POST_STOCK_MIX',
 message: `Main post order mix: ${stockSummary || '—'} (stock 8'–32' in 2' steps).`,
 });

 if (eavePick.overMax || eavePick.requiredFt > 32 || peakPick.overMax || peakPick.requiredFt > 32) {
 rules.push({
 level: 'error',
 code: 'POST_OVER_MAX',
 message: `A required post length exceeds 32' stock max — special-order or splice detail needed.`,
 });
 }

 // --- Skirt main-only ---
 rules.push({
 level: 'ok',
 code: 'SKIRT_MAIN_ONLY',
 message: `Skirt board ${b.skirtSize || '2x6'} treated — main perimeter ${2 * (b.width + b.length)} lf only (lean-tos/awnings excluded).`,
 });

 // --- Truss carriers ---
 const tcSize = b.trussCarrierSize || '2x10';
 rules.push({
 level: 'ok',
 code: 'TRUSS_CARRIER',
 message: `Truss carrier: 2-ply ${tcSize} on both eave walls (left & right) × ${b.length}' = ${4 * b.length} lf lumber.`,
 });

 // --- Foundation note ---
 rules.push({
 level: 'ok',
 code: 'FOUNDATION_NOTE',
 message: `Embedded posts at ${depth}' depth + concrete pad. Confirm frost depth and soil bearing for ${b.name || 'building'}.`,
 });

 if (b.hasSlab) {
 rules.push({
 level: 'ok',
 code: 'SLAB_OK',
 message: `Slab ${b.slabThicknessIn}" — separate from post embedment; keep posts free or use thickened edge as detailed.`,
 });
 }

 // Summary counts
 rules.push({
 level: 'ok',
 code: 'FRAMING_SUMMARY',
 message: `Framing: ${framing.allPosts.length} posts, ${framing.trusses.count} trusses, ~${Math.round(framing.girts.linearFt + framing.leanGirtLf)} lf girts, ~${Math.round(framing.purlins.linearFt + framing.leanPurlinLf)} lf purlins.`,
 });

 return rules;
}

function labelOpening(o) {
 const names = { walk: 'Walk door', window: 'Window', overhead: 'OH door', slider: 'Slider' };
 return `${names[o.type] || o.type} ${o.width}'×${o.height}'`;
}

/**
 * @param {object} project
 * @param {object[]} [takeoffItems] optional — when provided, qty cross-checks run
 */
export function evaluateProjectRules(project, takeoffItems = null) {
 const all = [];
 for (const b of project.buildings) {
 const buildingRules = evaluateBuildingRules(b, takeoffItems).map((r) => ({
 ...r,
 buildingId: b.id,
 buildingName: b.name,
 }));
 all.push(...buildingRules);
 }

 // Multi-building spacing soft check
 if (project.buildings.length > 1) {
 for (let i = 0; i < project.buildings.length; i++) {
 for (let j = i + 1; j < project.buildings.length; j++) {
 const a = project.buildings[i];
 const b = project.buildings[j];
 const dx = Math.abs(a.siteX - b.siteX);
 const dz = Math.abs(a.siteZ - b.siteZ);
 // Rough AABB gap
 const gapX = dx - (a.width + b.width) / 2;
 const gapZ = dz - (a.length + b.length) / 2;
 if (gapX < 10 && gapZ < 10) {
 all.push({
 level: 'warn',
 code: 'BUILDING_PROXIMITY',
 message: `"${a.name}" and "${b.name}" may be closer than 10' clear — check fire separation and equipment access.`,
 buildingId: a.id,
 buildingName: a.name,
 });
 }
 }
 }
 }

 return all;
}
