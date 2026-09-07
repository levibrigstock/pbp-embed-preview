/**
 * Construction plan sheets for We Build Structures / PoleBarn Pro.
 * Layout modeled on production plan sets (Dennis Anderson, Kyle, Josh, etc.):
 * Summary · Post Layout · Wall Layout · Truss Layout · Cross Sections · Assemblies + materials
 *
 * Plan orientation (production convention):
 *   horizontal axis = LENGTH, vertical axis = WIDTH
 * EXT wall labels on plan:
 *   EXT-1 top eave · EXT-2 right gable · EXT-3 bottom eave · EXT-4 left gable
 */

import {
 roofRise,
 wallLength,
 leanToLength,
 rafterLength,
 formatOpeningSize,
} from '../domain/types.js?v=20260806f';
import { generateFraming, pickPostStockLength } from '../domain/framing.js?v=20260806f';
import { getSheathingLayout } from '../takeoff/engine.js?v=20260806f';

const INK = '#111111';
const MUTED = '#555555';
const POST = '#5a6b2e';
const GIRT = '#c4a574';
const BEARER = '#d4b896';
const SKIRT = '#4a5a28';
const OPEN = '#333333';
const DIM = '#222222';
const GROUND = '#c4783a';
const SLAB = '#9aa0a8';
const GRADE = '#5a9a48';

/**
 * Draw full plan set onto canvas (print-ready white background).
 */
export function drawPlans(canvas, project, opts = {}) {
 const b =
 project.buildings.find((x) => x.id === (opts.buildingId || project.activeBuildingId)) ||
 project.buildings[0];
 if (!b) return { width: 0, height: 0 };

 let framing;
 let cut;
 let walls;
 let sheathing;
 try {
 framing = generateFraming(b);
 cut = buildCutList(b, framing);
 walls = wallInventory(b);
 } catch (err) {
 console.error('plans framing failed', err);
 framing = { mainPosts: [], purlins: {}, leanPackages: [] };
 cut = { lumber: [], metal: [] };
 walls = wallInventory(b);
 }
 try {
 sheathing = getSheathingLayout(b);
 } catch (err) {
 console.error('sheathing layout failed', err);
 sheathing = null;
 }

 const dpr = Math.min(window.devicePixelRatio || 1, 2);
 const pageW = opts.pageWidth || 1100;
 const pageH = 14000; // tall scroll: framing + sheathing sheets

 canvas.width = pageW * dpr;
 canvas.height = pageH * dpr;
 canvas.style.width = pageW + 'px';
 canvas.style.height = pageH + 'px';

 const ctx = canvas.getContext('2d');
 ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
 ctx.fillStyle = '#ffffff';
 ctx.fillRect(0, 0, pageW, pageH);
 ctx.fillStyle = INK;
 ctx.strokeStyle = INK;
 ctx.lineWidth = 1.2;
 ctx.font = '12px Arial, sans-serif';

 const margin = 18;
 const contentW = pageW - margin * 2;
 let y = 12;
 const meta = jobMeta(project);

 const gap = 28; // clear space between sheet frames (no stacked borders)
 // Production plan sheet order:
 // Summary → Cross Sections → Post Layout → Wall Layout → Truss → Roof assembly
 // → Sheathing ROOF-1/2 → Sheathing EXT-1…4 → Wall assemblies → Cut List
 try {
 y = sheetSummary(ctx, project, b, framing, margin, y, contentW, meta) + gap;
 y = sheetCrossSectionEave(ctx, b, framing, margin, y, contentW, 480, meta) + gap;
 y = sheetCrossSectionGable(ctx, b, framing, margin, y, contentW, 500, meta) + gap;
 y = sheetPostLayout(ctx, b, framing, margin, y, contentW, 520, meta) + gap;
 y = sheetWallLayout(ctx, b, framing, walls, margin, y, contentW, 420, meta) + gap;
 y = sheetTrussLayout(ctx, b, framing, margin, y, contentW, 460, meta) + gap;
 y = sheetAssemblyRoof(ctx, b, framing, margin, y, contentW, 400, meta) + gap;
 y = sheetAssemblyRoofMaterials(ctx, b, framing, cut, margin, y, contentW, meta) + gap;

 // Sheathing drawings — sheet sizes labeled for field placement (crew critical)
 if (sheathing && sheathing.roof && sheathing.walls) {
 y = sheetSheathingLegend(ctx, b, sheathing, margin, y, contentW, meta) + gap;
 for (const plane of sheathing.roof.planes || []) {
 y = sheetSheathingRoof(ctx, b, plane, sheathing, margin, y, contentW, meta) + gap;
 }
 for (const wall of sheathing.walls) {
 y = sheetSheathingWall(ctx, b, wall, sheathing, margin, y, contentW, meta) + gap;
 }
 } else {
 y = sheetSheathingError(ctx, margin, y, contentW, meta, 'Sheathing layout unavailable') + gap;
 }

 for (const wall of walls) {
 y = sheetAssemblyWall(ctx, b, framing, wall, margin, y, contentW, 380, meta) + gap;
 y = sheetAssemblyWallMaterials(ctx, b, framing, wall, margin, y, contentW, meta) + gap;
 }

 y = sheetCutSummary(ctx, cut, margin, y, contentW, meta) + gap;
 y = sheetNotes(ctx, b, margin, y, contentW, meta) + 16;
 } catch (err) {
 console.error('drawPlans sheet error', err);
 ctx.fillStyle = '#b00020';
 ctx.font = '14px Arial';
 ctx.fillText('Plan draw error: ' + (err && err.message ? err.message : String(err)), margin, y + 40);
 y += 80;
 }

 const usedH = Math.ceil(y + 24);
 try {
 const img = ctx.getImageData(0, 0, pageW * dpr, usedH * dpr);
 canvas.height = usedH * dpr;
 canvas.style.height = usedH + 'px';
 ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
 ctx.putImageData(img, 0, 0);
 } catch (_) {
 /* ignore crop errors */
 }

 return { width: pageW, height: usedH, cutList: cut };
}

export function printPlans(project, buildingId) {
 const canvas = document.createElement('canvas');
 drawPlans(canvas, project, { buildingId, pageWidth: 1000 });
 const data = canvas.toDataURL('image/png');
 const w = window.open('', '_blank');
 if (!w) {
 alert('Pop-up blocked — allow pop-ups to print plans.');
 return;
 }
 w.document.write(`<!DOCTYPE html><html><head><title>Plans — ${project.project || 'Job'}</title>
 <style>
 body{margin:0;background:#fff;font-family:Arial,sans-serif}
 img{width:100%;display:block}
 @media print{body{margin:0}}
 </style></head>
 <body><img src="${data}" onload="setTimeout(function(){window.focus();window.print()},200)" /></body></html>`);
 w.document.close();
}

/* ───────────────── Shared chrome ───────────────── */

function jobMeta(project) {
 const now = new Date();
 return {
 job: project.project || project.customer || 'Job',
 customer: project.customer || '',
 date: now.toLocaleDateString(),
 time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
 };
}

/** Snap to half-pixels so 1px strokes don't double-blur. */
function px(n) {
 return Math.round(n) + 0.5;
}

function pageChrome(ctx, x, y, w, h, title, meta) {
 ctx.save();
 const x0 = Math.round(x);
 const y0 = Math.round(y);
 const ww = Math.round(w);
 const hh = Math.round(h);
 // Outer frame (single stroke, crisp 1.5px)
 ctx.strokeStyle = INK;
 ctx.lineWidth = 1.5;
 ctx.strokeRect(x0 + 0.5, y0 + 0.5, ww - 1, hh - 1);
 // Title band fill (no second outer box)
 ctx.fillStyle = '#f7f7f7';
 ctx.fillRect(x0 + 1, y0 + 1, ww - 2, 34);
 // Title divider only
 ctx.beginPath();
 ctx.moveTo(px(x0), px(y0 + 36));
 ctx.lineTo(px(x0 + ww), px(y0 + 36));
 ctx.lineWidth = 1;
 ctx.stroke();
 ctx.font = 'bold 15px Arial';
 ctx.fillStyle = INK;
 ctx.textAlign = 'center';
 ctx.fillText(title, x0 + ww / 2, y0 + 23);
 ctx.textAlign = 'right';
 ctx.font = '10px Arial';
 ctx.fillText(`Job: ${meta.job}`, x0 + ww - 12, y0 + 14);
 ctx.fillText(`Date: ${meta.date}`, x0 + ww - 12, y0 + 26);
 ctx.textAlign = 'left';
 ctx.restore();
 return y0 + 48; // content start
}

function fitScale(worldW, worldH, boxW, boxH, pad = 40) {
 return Math.min((boxW - pad * 2) / Math.max(worldW, 1), (boxH - pad * 2) / Math.max(worldH, 1));
}

function dimH(ctx, x, y, len, label) {
 ctx.save();
 ctx.strokeStyle = DIM;
 ctx.fillStyle = DIM;
 ctx.lineWidth = 1;
 ctx.beginPath();
 ctx.moveTo(x, y);
 ctx.lineTo(x + len, y);
 ctx.moveTo(x, y - 4);
 ctx.lineTo(x, y + 4);
 ctx.moveTo(x + len, y - 4);
 ctx.lineTo(x + len, y + 4);
 ctx.stroke();
 ctx.font = '10px Arial';
 ctx.textAlign = 'center';
 ctx.fillText(label, x + len / 2, y - 6);
 ctx.textAlign = 'left';
 ctx.restore();
}

function dimV(ctx, x, y, len, label) {
 ctx.save();
 ctx.strokeStyle = DIM;
 ctx.fillStyle = DIM;
 ctx.lineWidth = 1;
 ctx.beginPath();
 ctx.moveTo(x, y);
 ctx.lineTo(x, y + len);
 ctx.moveTo(x - 4, y);
 ctx.lineTo(x + 4, y);
 ctx.moveTo(x - 4, y + len);
 ctx.lineTo(x + 4, y + len);
 ctx.stroke();
 ctx.save();
 ctx.translate(x - 8, y + len / 2);
 ctx.rotate(-Math.PI / 2);
 ctx.font = '10px Arial';
 ctx.textAlign = 'center';
 ctx.fillText(label, 0, 0);
 ctx.restore();
 ctx.restore();
}

function wallInventory(b) {
 // Production EXT labels with plan view: length horizontal, width vertical.
 // Top eave EXT-1, right gable EXT-2, bottom eave EXT-3, left gable EXT-4.
 // Domain: left/right = eave walls (along length), front/back = gables (along width).
 return [
 { id: 'EXT-1', wall: 'left', name: 'Top eave (EXT-1)', role: 'eave', planSide: 'top' },
 { id: 'EXT-2', wall: 'back', name: 'Right gable (EXT-2)', role: 'gable', planSide: 'right' },
 { id: 'EXT-3', wall: 'right', name: 'Bottom eave (EXT-3)', role: 'eave', planSide: 'bottom' },
 { id: 'EXT-4', wall: 'front', name: 'Left gable (EXT-4)', role: 'gable', planSide: 'left' },
 ];
}

function openingsOnWall(b, wall) {
 return (b.openings || []).filter(
 (o) => (!o.host || o.host === 'main') && o.wall === wall,
 );
}

function fmtFtIn(ft) {
 const whole = Math.floor(ft + 1e-9);
 const inches = Math.round((ft - whole) * 12);
 if (inches <= 0) return `${whole}'`;
 if (inches === 12) return `${whole + 1}'`;
 return `${whole}' ${inches}"`;
}

/* ───────────────── 1. Summary Sheet ───────────────── */

const KEY_ROW_H = 18;
const KEY_HEAD_H = 22;

function keyTableHeight(rowCount) {
 return KEY_HEAD_H + rowCount * KEY_ROW_H;
}

function sheetSummary(ctx, project, b, framing, x, y0, w, meta) {
 // Match production: left column tables, right column 3D slots — no stacked overlap
 const rows = [
 ['Width', `${b.width}'`],
 ['Length', `${b.length}'`],
 ['Ceiling Height', `${b.eaveHeight}'`],
 ['Slab Depth', b.hasSlab ? `${b.slabThicknessIn || 4}"` : '—'],
 ['Overhangs', `${((b.overhangIn || 0) + (b.metalOverhangIn ?? 3)) / 12}' (metal)`],
 ['Roof Pitch', `${b.pitch}/12`],
 ['Roof Style', b.roofStyle || 'gable'],
 ['Post Spacing', `${b.postSpacing}' o.c.`],
 ['Post Embed', `${b.postDepthFt || 3}'`],
 ['Truss Spacing', `${b.trussSpacing}' o.c.`],
 ['Girt / Purlin', `${b.girtSpacingIn || 24}" / ${b.purlinSpacingIn || 24}"`],
 ];
 const jobRows = [
 ['Customer Name', project.customer || ''],
 ['Project', project.project || ''],
 ['Location', project.location || ''],
 ['Buildings', String(project.buildings?.length || 1)],
 ['Openings', String((b.openings || []).length)],
 ['Attachments', String((b.leanTos || []).length)],
 ['Main Posts', String(framing.mainPosts.length)],
 ['Trusses', String(framing.trusses.count)],
 ];

 const leftW = 280;
 const pad = 16;
 const gapTables = 16;
 const gapCols = 20;
 const sumH = keyTableHeight(rows.length);
 const jobH = keyTableHeight(jobRows.length);
 const leftStackH = sumH + gapTables + jobH;
 const rightW = Math.max(200, w - leftW - pad * 2 - gapCols);
 const rightX = x + pad + leftW + gapCols;
 // Two equal preview slots with gap between
 const slotGap = 14;
 const slotH = Math.max(140, Math.floor((leftStackH - slotGap) / 2));
 const contentH = Math.max(leftStackH, slotH * 2 + slotGap);
 const h = 48 + pad + contentH + pad;

 pageChrome(ctx, x, y0, w, h, 'Summary Sheet', meta);
 const contentTop = y0 + 48 + pad;

 // Left: Summary then Job — stacked with clear gap (never overlap)
 drawKeyTable(ctx, x + pad, contentTop, leftW, 'Summary', rows);
 drawKeyTable(ctx, x + pad, contentTop + sumH + gapTables, leftW, 'Job Information', jobRows);

 // Right: two preview slots, fully within sheet, clear of left tables
 const slot1Y = contentTop;
 const slot2Y = contentTop + slotH + slotGap;
 drawPreviewSlot(
 ctx,
 rightX,
 slot1Y,
 rightW,
 slotH,
 '3D view — use Screenshot from 3D tab for customer renders',
 );
 drawPreviewSlot(
 ctx,
 rightX,
 slot2Y,
 rightW,
 slotH,
 `${b.width}' × ${b.length}' × ${b.eaveHeight}' · ${b.pitch}/12 ${b.roofStyle}`,
 );

 return y0 + h;
}

function drawPreviewSlot(ctx, x, y, w, h, caption) {
 const x0 = Math.round(x);
 const y0 = Math.round(y);
 const ww = Math.round(w);
 const hh = Math.round(h);
 ctx.save();
 // Soft fill + single outer border only
 ctx.fillStyle = '#f4f6f8';
 ctx.fillRect(x0, y0, ww, hh);
 ctx.strokeStyle = '#b0b6bc';
 ctx.lineWidth = 1;
 ctx.strokeRect(x0 + 0.5, y0 + 0.5, ww - 1, hh - 1);
 // Inner dashed guide (inset so it never doubles the outer edge)
 ctx.strokeStyle = '#d0d5da';
 ctx.setLineDash([4, 3]);
 ctx.strokeRect(x0 + 8.5, y0 + 8.5, ww - 17, hh - 17);
 ctx.setLineDash([]);
 ctx.fillStyle = MUTED;
 ctx.font = '11px Arial';
 ctx.textAlign = 'center';
 ctx.textBaseline = 'middle';
 // Word-wrap caption if needed
 const maxW = ww - 24;
 const words = String(caption).split(/\s+/);
 const lines = [];
 let line = '';
 for (const word of words) {
 const test = line ? `${line} ${word}` : word;
 if (ctx.measureText(test).width > maxW && line) {
 lines.push(line);
 line = word;
 } else {
 line = test;
 }
 }
 if (line) lines.push(line);
 const lineH = 14;
 const startY = y0 + hh / 2 - ((lines.length - 1) * lineH) / 2;
 lines.forEach((ln, i) => {
 ctx.fillText(ln, x0 + ww / 2, startY + i * lineH);
 });
 ctx.textAlign = 'left';
 ctx.textBaseline = 'alphabetic';
 ctx.restore();
}

/**
 * Two-column key/value table with a single crisp border grid (no double lines).
 * Returns bottom Y of the table.
 */
function drawKeyTable(ctx, x, y, w, title, rows) {
 ctx.save();
 const rowH = KEY_ROW_H;
 const headH = KEY_HEAD_H;
 const x0 = Math.round(x);
 const y0 = Math.round(y);
 const ww = Math.round(w);
 const n = rows.length;
 const totalH = headH + n * rowH;
 const col0 = Math.round(ww * 0.48);

 // Fills only (no strokes yet)
 ctx.fillStyle = '#d8d8d8';
 ctx.fillRect(x0, y0, ww, headH);
 for (let i = 0; i < n; i++) {
 ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f7f7f7';
 ctx.fillRect(x0, y0 + headH + i * rowH, ww, rowH);
 }

 // Build entire grid as one path — outer + horizontals + vertical
 ctx.strokeStyle = INK;
 ctx.lineWidth = 1;
 ctx.beginPath();
 // Outer box (half-pixel for crisp 1px)
 const L = x0 + 0.5;
 const T = y0 + 0.5;
 const R = x0 + ww - 0.5;
 const B = y0 + totalH - 0.5;
 ctx.moveTo(L, T);
 ctx.lineTo(R, T);
 ctx.lineTo(R, B);
 ctx.lineTo(L, B);
 ctx.closePath();
 // Horizontal rules under header and between rows (not duplicating top/bottom)
 for (let i = 0; i < n; i++) {
 const yy = y0 + headH + i * rowH + 0.5;
 ctx.moveTo(L, yy);
 ctx.lineTo(R, yy);
 }
 // Vertical column split (header + body)
 const vx = x0 + col0 + 0.5;
 ctx.moveTo(vx, T);
 ctx.lineTo(vx, B);
 ctx.stroke();

 // Text
 ctx.fillStyle = INK;
 ctx.font = 'bold 11px Arial';
 ctx.textAlign = 'left';
 ctx.textBaseline = 'middle';
 ctx.fillText(title, x0 + 6, y0 + headH / 2);
 ctx.font = '10px Arial';
 rows.forEach((r, i) => {
 const cy = y0 + headH + i * rowH + rowH / 2;
 ctx.fillText(r[0], x0 + 5, cy);
 ctx.fillText(String(r[1] ?? ''), x0 + col0 + 5, cy);
 });
 ctx.textBaseline = 'alphabetic';
 ctx.restore();
 return y0 + totalH;
}

/* ───────────────── 2. Post Layout ───────────────── */

/** Production-style opening label (for field labeling). */
function openingPlanLabel(o) {
 const wIn = Math.round((Number(o.width) || 0) * 12);
 const hIn = Math.round((Number(o.height) || 0) * 12);
 if (o.type === 'overhead') return [`Non Insulated`, `Overhead Door`, `${wIn}X${Math.round(o.height)}`];
 if (o.type === 'walk') return [`Walk Door`, formatOpeningSize(o.width, o.height)];
 if (o.type === 'window') return [`Window`, formatOpeningSize(o.width, o.height)];
 if (o.type === 'slider') return [`Slider Door`, formatOpeningSize(o.width, o.height)];
 return [formatOpeningSize(o.width, o.height)];
}

/** Continuous dimension chain along a horizontal line (production style). */
function dimChainH(ctx, xs, y, labelFn) {
 if (xs.length < 2) return;
 ctx.save();
 ctx.strokeStyle = DIM;
 ctx.fillStyle = DIM;
 ctx.lineWidth = 1;
 ctx.font = '9px Arial';
 ctx.textAlign = 'center';
 // baseline
 ctx.beginPath();
 ctx.moveTo(xs[0], y);
 ctx.lineTo(xs[xs.length - 1], y);
 ctx.stroke();
 for (let i = 0; i < xs.length; i++) {
 ctx.beginPath();
 ctx.moveTo(xs[i], y - 4);
 ctx.lineTo(xs[i], y + 4);
 ctx.stroke();
 }
 for (let i = 0; i < xs.length - 1; i++) {
 const mid = (xs[i] + xs[i + 1]) / 2;
 const ft = labelFn(i, xs[i], xs[i + 1]);
 if (ft != null && ft !== '') ctx.fillText(ft, mid, y - 6);
 }
 ctx.textAlign = 'left';
 ctx.restore();
}

function dimChainV(ctx, x, ys, labelFn) {
 if (ys.length < 2) return;
 ctx.save();
 ctx.strokeStyle = DIM;
 ctx.fillStyle = DIM;
 ctx.lineWidth = 1;
 ctx.font = '9px Arial';
 ctx.beginPath();
 ctx.moveTo(x, ys[0]);
 ctx.lineTo(x, ys[ys.length - 1]);
 ctx.stroke();
 for (let i = 0; i < ys.length; i++) {
 ctx.beginPath();
 ctx.moveTo(x - 4, ys[i]);
 ctx.lineTo(x + 4, ys[i]);
 ctx.stroke();
 }
 for (let i = 0; i < ys.length - 1; i++) {
 const mid = (ys[i] + ys[i + 1]) / 2;
 const ft = labelFn(i, ys[i], ys[i + 1]);
 if (ft == null || ft === '') continue;
 ctx.save();
 ctx.translate(x - 8, mid);
 ctx.rotate(-Math.PI / 2);
 ctx.textAlign = 'center';
 ctx.fillText(ft, 0, 0);
 ctx.restore();
 }
 ctx.restore();
}

function postsOnWall(framing, b, wall) {
 if (wall === 'front') {
 return framing.mainPosts
 .filter((p) => Math.abs(p.z) < 0.35)
 .sort((a, c) => a.x - c.x)
 .map((p) => p.x);
 }
 if (wall === 'back') {
 return framing.mainPosts
 .filter((p) => Math.abs(p.z - b.length) < 0.35)
 .sort((a, c) => a.x - c.x)
 .map((p) => p.x);
 }
 if (wall === 'left') {
 return framing.mainPosts
 .filter((p) => Math.abs(p.x) < 0.35)
 .sort((a, c) => a.z - c.z)
 .map((p) => p.z);
 }
 return framing.mainPosts
 .filter((p) => Math.abs(p.x - b.width) < 0.35)
 .sort((a, c) => a.z - c.z)
 .map((p) => p.z);
}

function sheetPostLayout(ctx, b, framing, x, y0, w, h, meta) {
 pageChrome(ctx, x, y0, w, h, 'Post Layout', meta);
 const top = y0 + 48;
 const areaH = h - 60;

 // Extents include lean-tos (world x/z)
 let minX = 0;
 let maxX = b.width;
 let minZ = 0;
 let maxZ = b.length;
 for (const pkg of framing.leanPackages || []) {
 for (const p of [pkg.outerStart, pkg.outerEnd, pkg.innerStart, pkg.innerEnd]) {
 if (!p) continue;
 minX = Math.min(minX, p.x);
 maxX = Math.max(maxX, p.x);
 minZ = Math.min(minZ, p.z);
 maxZ = Math.max(maxZ, p.z);
 }
 }
 // Plan: horizontal = length (z), vertical = width (x)
 const worldLen = maxZ - minZ;
 const worldWid = maxX - minX;
 const scale = fitScale(worldLen, worldWid, w - 140, areaH - 100, 40);
 const ox = x + (w - worldLen * scale) / 2 - minZ * scale;
 const oy = top + 55 - minX * scale;
 const tL = (z) => ox + z * scale; // length axis → screen X
 const tW = (wx) => oy + wx * scale; // width axis → screen Y

 // Building outline (length × width in plan)
 ctx.lineWidth = 1.75;
 ctx.strokeStyle = INK;
 ctx.strokeRect(tL(0) + 0.5, tW(0) + 0.5, b.length * scale - 1, b.width * scale - 1);

 // Lean-tos
 ctx.strokeStyle = '#666';
 ctx.setLineDash([4, 3]);
 for (const pkg of framing.leanPackages || []) {
 const pts = [pkg.innerStart, pkg.outerStart, pkg.outerEnd, pkg.innerEnd].filter(Boolean);
 if (pts.length < 2) continue;
 ctx.beginPath();
 pts.forEach((p, i) => (i ? ctx.lineTo(tL(p.z), tW(p.x)) : ctx.moveTo(tL(p.z), tW(p.x))));
 ctx.closePath();
 ctx.stroke();
 }
 ctx.setLineDash([]);

 // Posts
 for (const p of framing.mainPosts) {
 const s = Math.max(6, 0.65 * scale);
 ctx.fillStyle = POST;
 ctx.fillRect(tL(p.z) - s / 2, tW(p.x) - s / 2, s, s);
 }
 for (const p of framing.leanPosts || []) {
 const s = Math.max(5, 0.5 * scale);
 ctx.fillStyle = '#6a7a3a';
 ctx.fillRect(tL(p.z) - s / 2, tW(p.x) - s / 2, s, s);
 }

 // Openings — thick wall marks + product labels
 ctx.font = '8px Arial';
 for (const o of b.openings || []) {
 if (o.host && o.host !== 'main') continue;
 const a = o.offset;
 const c = o.offset + o.width;
 ctx.strokeStyle = OPEN;
 ctx.lineWidth = 3.5;
 ctx.beginPath();
 let mx = 0;
 let my = 0;
 let centerLabel = false;
 if (o.wall === 'left') {
 // top eave (EXT-1): horizontal along length
 ctx.moveTo(tL(a), tW(0));
 ctx.lineTo(tL(c), tW(0));
 mx = tL((a + c) / 2);
 my = tW(0) + 12;
 centerLabel = true;
 } else if (o.wall === 'right') {
 // bottom eave (EXT-3)
 ctx.moveTo(tL(a), tW(b.width));
 ctx.lineTo(tL(c), tW(b.width));
 mx = tL((a + c) / 2);
 my = tW(b.width) - 4;
 centerLabel = true;
 } else if (o.wall === 'front') {
 // left gable (EXT-4): vertical along width
 ctx.moveTo(tL(0), tW(a));
 ctx.lineTo(tL(0), tW(c));
 mx = tL(0) + 6;
 my = tW((a + c) / 2);
 } else {
 // back gable (EXT-2)
 ctx.moveTo(tL(b.length), tW(a));
 ctx.lineTo(tL(b.length), tW(c));
 mx = tL(b.length) - 72;
 my = tW((a + c) / 2);
 }
 ctx.stroke();
 ctx.fillStyle = MUTED;
 const lines = openingPlanLabel(o);
 lines.forEach((ln, i) => {
 const tw = ctx.measureText(ln).width;
 ctx.fillText(ln, centerLabel ? mx - tw / 2 : mx, my + i * 10);
 });
 }
 ctx.lineWidth = 1;

 // Post bay chains — eave walls (horizontal, along length)
 const leftPts = [...new Set([0, ...postsOnWall(framing, b, 'left'), b.length])].sort((a, c) => a - c);
 const rightPts = [...new Set([0, ...postsOnWall(framing, b, 'right'), b.length])].sort((a, c) => a - c);
 // Gable walls (vertical, along width)
 const frontPts = [...new Set([0, ...postsOnWall(framing, b, 'front'), b.width])].sort((a, c) => a - c);
 const backPts = [...new Set([0, ...postsOnWall(framing, b, 'back'), b.width])].sort((a, c) => a - c);

 // Top eave (EXT-1 / left wall) bay dims
 dimChainH(
 ctx,
 leftPts.map((ft) => tL(ft)),
 tW(0) - 16,
 (i) => fmtFtIn(leftPts[i + 1] - leftPts[i]),
 );
 dimH(ctx, tL(0), tW(0) - 34, b.length * scale, `${b.length}'`);

 // Bottom eave (EXT-3 / right wall)
 dimChainH(
 ctx,
 rightPts.map((ft) => tL(ft)),
 tW(b.width) + 18,
 (i) => fmtFtIn(rightPts[i + 1] - rightPts[i]),
 );
 dimH(ctx, tL(0), tW(b.width) + 36, b.length * scale, `${b.length}'`);

 // Left gable (EXT-4 / front)
 dimChainV(
 ctx,
 tL(0) - 16,
 frontPts.map((ft) => tW(ft)),
 (i) => fmtFtIn(frontPts[i + 1] - frontPts[i]),
 );
 dimV(ctx, tL(0) - 36, tW(0), b.width * scale, `${b.width}'`);

 // Right gable (EXT-2 / back)
 dimChainV(
 ctx,
 tL(b.length) + 16,
 backPts.map((ft) => tW(ft)),
 (i) => fmtFtIn(backPts[i + 1] - backPts[i]),
 );
 dimV(ctx, tL(b.length) + 36, tW(0), b.width * scale, `${b.width}'`);

 // Diagonal overall (production post layout)
 ctx.strokeStyle = '#888';
 ctx.setLineDash([3, 3]);
 ctx.beginPath();
 ctx.moveTo(tL(0), tW(0));
 ctx.lineTo(tL(b.length), tW(b.width));
 ctx.stroke();
 ctx.setLineDash([]);
 const diag = Math.hypot(b.width, b.length);
 ctx.fillStyle = MUTED;
 ctx.font = '10px Arial';
 ctx.fillText(fmtFtIn(diag), tL(b.length / 2) + 6, tW(b.width / 2) - 4);

 return y0 + h;
}

/* ───────────────── 3. Wall Layout ───────────────── */

function sheetWallLayout(ctx, b, framing, walls, x, y0, w, h, meta) {
 pageChrome(ctx, x, y0, w, h, 'Wall Layout', meta);
 const top = y0 + 48;
 // Plan: horizontal = length, vertical = width
 const scale = fitScale(b.length + 8, b.width + 8, w - 140, h - 110, 30);
 const ox = x + (w - b.length * scale) / 2;
 const oy = top + 55;
 const tL = (z) => ox + z * scale;
 const tW = (wx) => oy + wx * scale;

 // Wall band as filled perimeter (avoids thick stroke + outline double box)
 const band = Math.max(8, Math.min(14, 0.5 * scale));
 const bx = tL(0);
 const by = tW(0);
 const bw = b.length * scale;
 const bh = b.width * scale;
 ctx.fillStyle = '#ffffff';
 ctx.fillRect(bx, by, bw, bh);
 ctx.fillStyle = '#ebe4d4';
 ctx.fillRect(bx, by, bw, band);
 ctx.fillRect(bx, by + bh - band, bw, band);
 ctx.fillRect(bx, by, band, bh);
 ctx.fillRect(bx + bw - band, by, band, bh);
 ctx.strokeStyle = INK;
 ctx.lineWidth = 1.25;
 ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

 // EXT labels — production: top EXT-1, right EXT-2, bottom EXT-3, left EXT-4
 ctx.font = 'bold 11px Arial';
 ctx.fillStyle = INK;
 ctx.textAlign = 'center';
 ctx.textBaseline = 'middle';
 ctx.fillText('EXT-1', tL(b.length / 2), by + band / 2);
 ctx.fillText('EXT-3', tL(b.length / 2), by + bh - band / 2);
 // Vertical side labels centered in side bands
 ctx.save();
 ctx.translate(bx + band / 2, tW(b.width / 2));
 ctx.rotate(-Math.PI / 2);
 ctx.fillText('EXT-4', 0, 0);
 ctx.restore();
 ctx.save();
 ctx.translate(bx + bw - band / 2, tW(b.width / 2));
 ctx.rotate(-Math.PI / 2);
 ctx.fillText('EXT-2', 0, 0);
 ctx.restore();

 ctx.font = '12px Arial';
 ctx.textBaseline = 'middle';
 ctx.fillText(`${b.width}'x${b.length}'`, tL(b.length / 2), tW(b.width / 2));
 ctx.textAlign = 'left';
 ctx.textBaseline = 'alphabetic';

 // Opening marks
 ctx.font = '8px Arial';
 for (const o of b.openings || []) {
 if (o.host && o.host !== 'main') continue;
 const a = o.offset;
 const c = o.offset + o.width;
 ctx.strokeStyle = OPEN;
 ctx.lineWidth = 2.5;
 ctx.beginPath();
 let lx = 0;
 let ly = 0;
 let center = false;
 if (o.wall === 'left') {
 ctx.moveTo(tL(a), tW(0));
 ctx.lineTo(tL(c), tW(0));
 lx = tL((a + c) / 2);
 ly = tW(0) + 16;
 center = true;
 } else if (o.wall === 'right') {
 ctx.moveTo(tL(a), tW(b.width));
 ctx.lineTo(tL(c), tW(b.width));
 lx = tL((a + c) / 2);
 ly = tW(b.width) - 10;
 center = true;
 } else if (o.wall === 'front') {
 ctx.moveTo(tL(0), tW(a));
 ctx.lineTo(tL(0), tW(c));
 lx = tL(0) + 10;
 ly = tW((a + c) / 2);
 } else {
 ctx.moveTo(tL(b.length), tW(a));
 ctx.lineTo(tL(b.length), tW(c));
 lx = tL(b.length) - 70;
 ly = tW((a + c) / 2);
 }
 ctx.stroke();
 ctx.fillStyle = MUTED;
 const lines = openingPlanLabel(o);
 lines.forEach((ln, i) => {
 const tw = ctx.measureText(ln).width;
 ctx.fillText(ln, center ? lx - tw / 2 : lx, ly + i * 9);
 });
 }
 ctx.lineWidth = 1;

 // Overall dims: horizontal = length, vertical = width
 dimH(ctx, tL(0), tW(0) - 28, b.length * scale, `${b.length}'`);
 dimH(ctx, tL(0), tW(b.width) + 32, b.length * scale, `${b.length}'`);
 dimV(ctx, tL(0) - 32, tW(0), b.width * scale, `${b.width}'`);
 dimV(ctx, tL(b.length) + 32, tW(0), b.width * scale, `${b.width}'`);

 // Opening break chain on top eave (EXT-1 / left wall)
 const eaveOpens = openingsOnWall(b, 'left').sort((a, c) => a.offset - c.offset);
 if (eaveOpens.length) {
 const pts = [0];
 for (const o of eaveOpens) {
 pts.push(o.offset, o.offset + o.width);
 }
 pts.push(b.length);
 const uniq = [...new Set(pts.map((v) => Math.round(v * 100) / 100))].sort((a, c) => a - c);
 dimChainH(
 ctx,
 uniq.map((ft) => tL(ft)),
 tW(0) - 14,
 (i) => fmtFtIn(uniq[i + 1] - uniq[i]),
 );
 }

 return y0 + h;
}

/* ───────────────── Truss Layout ───────────────── */

/**
 * Production-style plan: length horizontal, width vertical.
 * Clean wall band (filled, not thick stroke), purlin boards as discrete
 * filled rects with gaps at splices — no overlapping strokes.
 */
function sheetTrussLayout(ctx, b, framing, x, y0, w, hFixed, meta) {
 const trussSp = b.trussSpacing || 5;
 const tc = framing.trusses?.count || Math.floor(b.length / trussSp) + 1;
 const purlinSpFt = (b.purlinSpacingIn || 24) / 12;
 const half = b.width / 2;

 // Purlin stations from each eave toward ridge (deduped, capped for readability)
 const stations = [];
 for (let d = purlinSpFt; d < half - 0.05; d += purlinSpFt) {
 stations.push(d);
 stations.push(b.width - d);
 }
 // Optional ridge purlin only if there's room away from neighbors
 if (stations.length === 0 || Math.min(...stations.map((s) => Math.abs(s - half))) > purlinSpFt * 0.4) {
 stations.push(half);
 }
 stations.sort((a, c) => a - c);
 let rowXs = [...new Set(stations.map((v) => Math.round(v * 1000) / 1000))];
 // Cap density: if scaled rows would be < 14px apart, thin them out
 const maxRows = 14;
 if (rowXs.length > maxRows) {
 const step = Math.ceil(rowXs.length / maxRows);
 rowXs = rowXs.filter((_, i) => i % step === 0 || i === rowXs.length - 1);
 }

 // Dynamic sheet height from content
 const drawW = w - 80;
 const drawH = Math.min(380, Math.max(220, 40 + rowXs.length * 22 + 80));
 const h = 48 + 24 + drawH + 28;
 pageChrome(ctx, x, y0, w, h, 'Truss Layout', meta);

 const scale = fitScale(b.length, b.width, drawW, drawH, 8);
 const ox = x + (w - b.length * scale) / 2;
 const oy = y0 + 48 + 16 + (drawH - b.width * scale) / 2;
 const tL = (z) => ox + z * scale;
 const tW = (wx) => oy + wx * scale;

 const bx = tL(0);
 const by = tW(0);
 const bw = b.length * scale;
 const bh = b.width * scale;
 // Wall band thickness in px (fixed visual weight, not a second stroked outline)
 const band = Math.max(8, Math.min(14, 0.45 * scale));

 ctx.save();

 // Interior fill
 ctx.fillStyle = '#ffffff';
 ctx.fillRect(bx, by, bw, bh);

 // Perimeter wall band as four filled rects (no thick strokeRect overlap)
 ctx.fillStyle = '#ebe4d4';
 ctx.fillRect(bx, by, bw, band); // top eave
 ctx.fillRect(bx, by + bh - band, bw, band); // bottom eave
 ctx.fillRect(bx, by, band, bh); // left gable
 ctx.fillRect(bx + bw - band, by, band, bh); // right gable

 // Single crisp outer outline only
 ctx.strokeStyle = INK;
 ctx.lineWidth = 1.25;
 ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
 // Inner edge of wall band (one line, inset)
 ctx.strokeStyle = '#c8c0b0';
 ctx.lineWidth = 1;
 ctx.strokeRect(bx + band + 0.5, by + band + 0.5, bw - band * 2 - 1, bh - band * 2 - 1);

 // Clip purlins/trusses to interior so they never paint over wall band edges
 const inset = band + 2;
 ctx.save();
 ctx.beginPath();
 ctx.rect(bx + inset, by + inset, bw - inset * 2, bh - inset * 2);
 ctx.clip();

 // Truss lines (vertical = across width)
 ctx.strokeStyle = '#d4cec2';
 ctx.lineWidth = 1;
 for (let i = 0; i < tc; i++) {
 const z = tc === 1 ? b.length / 2 : (i / (tc - 1)) * b.length;
 const cx = tL(z);
 ctx.beginPath();
 ctx.moveTo(cx, by + inset);
 ctx.lineTo(cx, by + bh - inset);
 ctx.stroke();
 }

 // Purlin boards: filled rectangles with small splice gaps (no overlapping laps)
 const boardH = Math.max(3, Math.min(6, purlinSpFt * scale * 0.22));
 const spliceGap = 3; // px gap between segments — prevents visual merge/overlap
 const stockLens = [16, 12, 10];
 const letterByKey = {};
 let nextLetter = 0;
 const letters = 'ABCDEFGH';
 function letterFor(cutFt) {
 const key = Math.round(cutFt * 4) / 4;
 if (!letterByKey[key]) {
 letterByKey[key] = letters[nextLetter % letters.length];
 nextLetter++;
 }
 return letterByKey[key];
 }

 ctx.font = 'bold 9px Arial';
 ctx.textAlign = 'center';
 ctx.textBaseline = 'bottom';

 for (let ri = 0; ri < rowXs.length; ri++) {
 const rowX = rowXs[ri];
 const yy = tW(rowX) - boardH / 2;
 // Stagger start offset on alternate rows (production look) without overlapping
 const staggerFt = ri % 2 === 1 ? Math.min(4, b.length * 0.08) : 0;
 const segs = [];
 if (staggerFt > 0.1) {
 segs.push({ z0: 0, z1: staggerFt });
 }
 let z = staggerFt;
 let si = 0;
 while (z < b.length - 0.02) {
 let use = stockLens[si % stockLens.length];
 if (use > b.length - z) use = b.length - z;
 segs.push({ z0: z, z1: z + use });
 z += use;
 si++;
 }

 for (const seg of segs) {
 const cut = seg.z1 - seg.z0;
 if (cut < 0.15) continue;
 let x0 = tL(seg.z0);
 let x1 = tL(seg.z1);
 // Inset each segment ends slightly so neighbors don't share a pixel edge
 if (seg.z0 > 0.05) x0 += spliceGap / 2;
 if (seg.z1 < b.length - 0.05) x1 -= spliceGap / 2;
 const sw = x1 - x0;
 if (sw < 2) continue;

 ctx.fillStyle = '#d4b896';
 ctx.fillRect(x0, yy, sw, boardH);
 // Single thin outline on board (not a second heavy stroke)
 ctx.strokeStyle = '#b89868';
 ctx.lineWidth = 0.75;
 ctx.strokeRect(x0 + 0.25, yy + 0.25, sw - 0.5, boardH - 0.5);

 // Letter only if segment is wide enough to read
 if (sw >= 18) {
 ctx.fillStyle = INK;
 ctx.fillText(letterFor(cut), x0 + sw / 2, yy - 1);
 }
 }
 }

 ctx.restore(); // end clip

 // Small truss tick marks at mid-width — only if no purlin sits exactly on ridge
 const ridgeClear = rowXs.every((rx) => Math.abs(rx - half) > purlinSpFt * 0.35);
 if (ridgeClear) {
 ctx.strokeStyle = '#666';
 ctx.lineWidth = 1;
 for (let i = 0; i < tc; i++) {
 const z = tc === 1 ? b.length / 2 : (i / (tc - 1)) * b.length;
 const cx = tL(z);
 const cy = tW(half);
 ctx.beginPath();
 ctx.moveTo(cx - 3, cy);
 ctx.lineTo(cx + 3, cy);
 ctx.moveTo(cx, cy - 4);
 ctx.lineTo(cx, cy + 4);
 ctx.stroke();
 }
 }

 // Legend below drawing, inside sheet padding
 ctx.font = '10px Arial';
 ctx.fillStyle = MUTED;
 ctx.textAlign = 'left';
 ctx.textBaseline = 'alphabetic';
 ctx.fillText(
 `Trusses: ${tc} @ ${trussSp}' o.c. · Purlins: 2x4 @ ${b.purlinSpacingIn || 24}" o.c. · ${b.pitch}/12`,
 x + 18,
 y0 + h - 12,
 );

 ctx.restore();
 return y0 + h;
}

/* ───────────────── 4–5. Cross sections ───────────────── */

function sheetCrossSectionEave(ctx, b, framing, x, y0, w, h, meta) {
 pageChrome(ctx, x, y0, w, h, 'Cross Section - EXT-1', meta);
 const top = y0 + 52;
 const rise = roofRise(b);
 const embed = b.postDepthFt || 3;
 const eave = b.eaveHeight;
 const worldH = eave + rise + embed + 2;
 const scale = fitScale(8, worldH, 280, h - 100, 20);
 const cx = x + w / 2;
 const gradeY = top + (h - 80) * 0.72;
 const X = (ft) => cx + ft * scale;
 const Y = (ftUp) => gradeY - ftUp * scale; // positive up from grade

 // Ground / slab
 ctx.fillStyle = GROUND;
 ctx.fillRect(X(-3), gradeY, 6 * scale, embed * scale + 20);
 ctx.fillStyle = GRADE;
 ctx.fillRect(X(-2.2), gradeY - 4, 4.4 * scale, 6);
 if (b.hasSlab) {
 ctx.fillStyle = SLAB;
 ctx.fillRect(X(-1.8), gradeY - 6, 3.6 * scale, 8);
 }

 // Post hole
 ctx.fillStyle = '#b8b0a0';
 ctx.fillRect(X(-0.55), gradeY, 1.1 * scale, embed * scale);
 // Post
 ctx.fillStyle = POST;
 ctx.fillRect(X(-0.25), Y(eave), 0.5 * scale, (eave + embed) * scale);

 // Girts
 const girtSp = (b.girtSpacingIn || 24) / 12;
 ctx.fillStyle = GIRT;
 for (let elev = girtSp; elev < eave - 0.25; elev += girtSp) {
 ctx.fillRect(X(-0.7), Y(elev) - 2, 0.9 * scale, 5);
 }
 // Skirt
 ctx.fillStyle = SKIRT;
 ctx.fillRect(X(-0.75), Y(0.5) - 2, 1.0 * scale, 8);
 // Truss bearer
 ctx.fillStyle = BEARER;
 ctx.fillRect(X(-0.8), Y(eave) - 4, 1.2 * scale, 10);

 // Roof eave detail
 ctx.strokeStyle = '#8b1e1e';
 ctx.lineWidth = 2;
 ctx.beginPath();
 ctx.moveTo(X(-1.5), Y(eave + 0.3));
 ctx.lineTo(X(1.8), Y(eave + rise * 0.35));
 ctx.stroke();
 // Purlins on slope
 ctx.fillStyle = GIRT;
 for (let i = 0; i < 3; i++) {
 const t = 0.15 + i * 0.2;
 ctx.fillRect(X(-0.3 + t * 1.5), Y(eave + t * rise * 0.5) - 2, 10, 4);
 }

 // Dims
 dimV(ctx, X(-2.2), Y(eave), eave * scale, `${eave}'`);
 dimV(ctx, X(1.4), gradeY, embed * scale, `${embed}'`);
 dimH(ctx, X(-0.55), gradeY + embed * scale + 12, 1.1 * scale, `1' 4"`);

 // Callouts left
 ctx.fillStyle = INK;
 ctx.font = '10px Arial';
 let ly = top + 10;
 const leftNotes = [
 `ROOF: ${b.roofColor || 'BK'} 29 GA AG PANEL`,
 `PURLINS: 2X4 @ ${b.purlinSpacingIn || 24}" O.C.`,
 `WALL: ${b.wallColor || 'AL'} 29 GA AG PANEL`,
 `EXTERIOR GIRTS: 2X6 @ ${b.girtSpacingIn || 24}" O.C.`,
 `TRUSS CARRIER: ${b.trussCarrierSize || '2x10'} 2-PLY`,
 `CORNER / INTERMEDIATE POSTS: 6X6 CCA`,
 `SKIRT: ${b.skirtSize || '2x6'} TREATED @ GRADE`,
 `SIDING BEGINS 0' ABOVE GRADE`,
 ];
 leftNotes.forEach((n) => {
 ctx.fillText(n, x + 16, ly);
 ly += 14;
 });

 // Callouts right
 ly = top + 10;
 const rightNotes = [
 `${b.pitch}/12 TRUSS SYSTEM`,
 `TRUSS SPACING: ${b.trussSpacing * 12}" O.C.`,
 `INTERIOR CARRIER: ${b.trussCarrierSize || '2x10'} 2YP`,
 `SLAB: ${b.hasSlab ? (b.slabThicknessIn || 4) + '"' : 'NONE'}`,
 `FOUNDATION:`,
 ` POST HOLE: ${embed}' × 1' 4" DIA.`,
 ` POST TO FOUNDATION: EMBED`,
 ];
 rightNotes.forEach((n) => {
 ctx.fillText(n, x + w - 240, ly);
 ly += 14;
 });

 return y0 + h;
}

function sheetCrossSectionGable(ctx, b, framing, x, y0, w, h, meta) {
 pageChrome(ctx, x, y0, w, h, 'Cross Section - EXT-2 (Gable End)', meta);
 const top = y0 + 52;
 const rise = roofRise(b);
 const embed = b.postDepthFt || 3;
 const eave = b.eaveHeight;
 const peak = eave + rise;
 const worldH = peak + embed + 2;
 const worldW = b.width + 4;
 const scale = fitScale(worldW, worldH, w - 320, h - 100, 20);
 const ox = x + 160;
 const gradeY = top + (h - 80) * 0.75;
 const X = (ft) => ox + ft * scale;
 const Y = (ftUp) => gradeY - ftUp * scale;

 // Ground
 ctx.fillStyle = GROUND;
 ctx.fillRect(X(-1), gradeY, (b.width + 2) * scale, embed * scale + 16);
 ctx.fillStyle = GRADE;
 ctx.fillRect(X(0), gradeY - 3, b.width * scale, 5);
 if (b.hasSlab) {
 ctx.fillStyle = SLAB;
 ctx.fillRect(X(0.2), gradeY - 5, (b.width - 0.4) * scale, 7);
 }

 // Use front wall posts (z≈0)
 const gablePosts = framing.mainPosts
 .filter((p) => Math.abs(p.z) < 0.25)
 .sort((a, c) => a.x - c.x);
 for (const p of gablePosts) {
 const postH = p.heightAboveGrade || eave;
 ctx.fillStyle = '#b8b0a0';
 ctx.fillRect(X(p.x) - 0.3 * scale, gradeY, 0.6 * scale, embed * scale);
 ctx.fillStyle = POST;
 ctx.fillRect(X(p.x) - 0.22 * scale, Y(postH), 0.44 * scale, (postH + embed) * scale);
 }

 // Girts full width levels
 const girtSp = (b.girtSpacingIn || 24) / 12;
 ctx.fillStyle = GIRT;
 for (let elev = girtSp; elev < eave - 0.2; elev += girtSp) {
 ctx.fillRect(X(0), Y(elev) - 2, b.width * scale, 5);
 }
 // Skirt
 ctx.fillStyle = SKIRT;
 ctx.fillRect(X(0), Y(0.45) - 2, b.width * scale, 8);

 // Roof / truss outline
 ctx.strokeStyle = INK;
 ctx.lineWidth = 2;
 ctx.beginPath();
 if (b.roofStyle === 'gable') {
 ctx.moveTo(X(0), Y(eave));
 ctx.lineTo(X(b.width / 2), Y(peak));
 ctx.lineTo(X(b.width), Y(eave));
 ctx.stroke();
 // Truss web sample
 ctx.strokeStyle = GIRT;
 ctx.lineWidth = 3;
 ctx.beginPath();
 ctx.moveTo(X(b.width * 0.25), Y(eave));
 ctx.lineTo(X(b.width / 2), Y(eave + rise * 0.55));
 ctx.lineTo(X(b.width * 0.75), Y(eave));
 ctx.stroke();
 // Bottom chord
 ctx.beginPath();
 ctx.moveTo(X(0), Y(eave));
 ctx.lineTo(X(b.width), Y(eave));
 ctx.stroke();
 } else {
 ctx.moveTo(X(0), Y(peak));
 ctx.lineTo(X(b.width), Y(eave));
 ctx.stroke();
 }
 // Metal roof line
 ctx.strokeStyle = '#8b1e1e';
 ctx.lineWidth = 2;
 ctx.beginPath();
 if (b.roofStyle === 'gable') {
 ctx.moveTo(X(-0.5), Y(eave + 0.15));
 ctx.lineTo(X(b.width / 2), Y(peak + 0.25));
 ctx.lineTo(X(b.width + 0.5), Y(eave + 0.15));
 } else {
 ctx.moveTo(X(-0.5), Y(peak + 0.15));
 ctx.lineTo(X(b.width + 0.5), Y(eave + 0.15));
 }
 ctx.stroke();

 dimH(ctx, X(0), gradeY + embed * scale + 14, b.width * scale, `${b.width}'`);
 dimV(ctx, X(-1.2), Y(eave), eave * scale, `${eave}'`);
 if (b.roofStyle === 'gable') {
 dimV(ctx, X(b.width + 1.2), Y(peak), peak * scale, fmtFtIn(peak));
 }

 ctx.fillStyle = INK;
 ctx.font = '10px Arial';
 let ly = top + 8;
 [
 `ROOF: ${b.roofColor || 'BK'} 29 GA`,
 `WALL: ${b.wallColor || 'AL'} 29 GA`,
 `PURLINS: 2X4 @ ${b.purlinSpacingIn || 24}"`,
 `GIRTS: 2X6 @ ${b.girtSpacingIn || 24}"`,
 `POSTS: 6X6 CCA`,
 `TRUSS: ${b.pitch}/12 @ ${b.trussSpacing}' O.C.`,
 `CARRIER: ${b.trussCarrierSize || '2x10'} 2-PLY`,
 ].forEach((n) => {
 ctx.fillText(n, x + 14, ly);
 ly += 13;
 });

 return y0 + h;
}

/* ───────────────── Assembly wall elevation ───────────────── */

function sheetAssemblyWall(ctx, b, framing, wallDef, x, y0, w, h, meta) {
 const wall = wallDef.wall;
 pageChrome(ctx, x, y0, w, h, `Assembly Drawing — ${wallDef.id}`, meta);
 const top = y0 + 52;
 const wallW = wallLength(b, wall);
 const eave = b.eaveHeight;
 const rise = roofRise(b);
 const isGable = wall === 'front' || wall === 'back';
 const peak = isGable && b.roofStyle === 'gable' ? eave + rise : eave;
 const scale = fitScale(wallW + 2, peak + 3, w - 40, h - 80, 30);
 const ox = x + (w - wallW * scale) / 2;
 const groundY = y0 + h - 28;
 const X = (ft) => ox + ft * scale;
 const Y = (ftUp) => groundY - ftUp * scale;

 // Ground line
 ctx.strokeStyle = INK;
 ctx.beginPath();
 ctx.moveTo(x + 20, groundY);
 ctx.lineTo(x + w - 20, groundY);
 ctx.stroke();

 // Posts
 const posts =
 wall === 'front' || wall === 'back'
 ? framing.mainPosts
 .filter((p) =>
 wall === 'front' ? Math.abs(p.z) < 0.25 : Math.abs(p.z - b.length) < 0.25,
 )
 .sort((a, c) => a.x - c.x)
 : framing.mainPosts
 .filter((p) =>
 wall === 'left' ? Math.abs(p.x) < 0.25 : Math.abs(p.x - b.width) < 0.25,
 )
 .sort((a, c) => a.z - c.z);

 const postCoords = posts.map((p) => (wall === 'front' || wall === 'back' ? p.x : p.z));

 // Ensure corner posts at 0 and wallW
 const locs = [...new Set([0, ...postCoords, wallW])].sort((a, c) => a - c);

 for (const loc of locs) {
 let height = eave;
 if (isGable && b.roofStyle === 'gable') {
 const t = wallW > 0 ? loc / wallW : 0;
 height = eave + (t <= 0.5 ? t * 2 : (1 - t) * 2) * rise;
 }
 ctx.fillStyle = POST;
 ctx.fillRect(X(loc) - 0.2 * scale, Y(height), 0.4 * scale, height * scale + 8);
 }

 // Girts
 const girtSp = (b.girtSpacingIn || 24) / 12;
 ctx.fillStyle = GIRT;
 for (let elev = girtSp; elev < eave - 0.15; elev += girtSp) {
 ctx.fillRect(X(0), Y(elev) - 2, wallW * scale, 5);
 }
 // Skirt
 ctx.fillStyle = SKIRT;
 ctx.fillRect(X(0), Y(0.4) - 2, wallW * scale, 7);
 // Truss bearer (eave walls only)
 if (!isGable) {
 ctx.fillStyle = BEARER;
 ctx.fillRect(X(0), Y(eave) - 3, wallW * scale, 8);
 }

 // Roof line
 ctx.strokeStyle = INK;
 ctx.lineWidth = 1.5;
 ctx.beginPath();
 if (isGable && b.roofStyle === 'gable') {
 ctx.moveTo(X(0), Y(eave));
 ctx.lineTo(X(wallW / 2), Y(peak));
 ctx.lineTo(X(wallW), Y(eave));
 } else {
 ctx.moveTo(X(0), Y(eave));
 ctx.lineTo(X(wallW), Y(eave));
 }
 ctx.stroke();

 // Openings (fill then single stroke — avoid double borders)
 for (const o of openingsOnWall(b, wall)) {
 const sill = o.sillHeight || 0;
 const left = o.offset;
 const ox = X(left);
 const oy = Y(sill + o.height);
 const ow = o.width * scale;
 const oh = o.height * scale;
 ctx.fillStyle = '#ffffff';
 ctx.fillRect(ox, oy, ow, oh);
 ctx.strokeStyle = OPEN;
 ctx.lineWidth = 1.25;
 ctx.strokeRect(ox + 0.5, oy + 0.5, ow - 1, oh - 1);
 ctx.fillStyle = MUTED;
 ctx.font = '9px Arial';
 ctx.fillText(formatOpeningSize(o.width, o.height), ox + 3, oy + oh / 2 + 3);
 }

 // Letter labels on members (sample A–H)
 ctx.fillStyle = INK;
 ctx.font = 'bold 10px Arial';
 ctx.fillText('A', X(0) - 10, Y(eave / 2));
 ctx.fillText('B', X(wallW) + 4, Y(eave / 2));
 ctx.fillText('E', X(wallW * 0.15), Y(girtSp * 2) - 4);
 ctx.fillText('F', X(wallW * 0.45), Y(girtSp * 3) - 4);
 ctx.fillText('H', X(wallW * 0.4), Y(0.4) + 12);
 if (!isGable) ctx.fillText('G', X(wallW * 0.5), Y(eave) - 6);

 dimH(ctx, X(0), groundY + 14, wallW * scale, `${wallW}'`);

 return y0 + h;
}

function sheetAssemblyWallMaterials(ctx, b, framing, wallDef, x, y0, w, meta) {
 const wall = wallDef.wall;
 const wallW = wallLength(b, wall);
 const isGable = wall === 'front' || wall === 'back';
 const girtSp = (b.girtSpacingIn || 24) / 12;
 const girtRows = Math.max(1, Math.floor((b.eaveHeight - 0.5) / girtSp));
 const posts =
 wall === 'front' || wall === 'back'
 ? framing.mainPosts.filter((p) =>
 wall === 'front' ? Math.abs(p.z) < 0.25 : Math.abs(p.z - b.length) < 0.25,
 )
 : framing.mainPosts.filter((p) =>
 wall === 'left' ? Math.abs(p.x) < 0.25 : Math.abs(p.x - b.width) < 0.25,
 );
 const stock = {};
 for (const p of posts) {
 const L = p.stockFt || pickPostStockLength(p.totalLengthFt || b.eaveHeight + (b.postDepthFt || 3)).stockFt;
 stock[L] = (stock[L] || 0) + 1;
 }

 const rows = [];
 let label = 65; // A
 Object.keys(stock)
 .map(Number)
 .sort((a, c) => c - a)
 .forEach((L) => {
 rows.push({
 label: String.fromCharCode(label++),
 usage: 'Post',
 sku: `6x6x${L}`,
 material: `6X6 CCA POST`,
 qty: stock[L],
 cut: `${L}'`,
 part: `${L}'`,
 });
 });
 rows.push({
 label: String.fromCharCode(label++),
 usage: 'Girt',
 sku: '2x6',
 material: '2X6 SYP',
 qty: girtRows,
 cut: `${wallW}'`,
 part: `${Math.ceil(wallW / 2) * 2}'`,
 });
 if (!isGable) {
 rows.push({
 label: String.fromCharCode(label++),
 usage: 'Truss Bearer',
 sku: b.trussCarrierSize || '2x10',
 material: `${(b.trussCarrierSize || '2x10').toUpperCase()} 2YP`,
 qty: 2,
 cut: `${wallW}'`,
 part: `${Math.ceil(wallW / 2) * 2}'`,
 });
 }
 rows.push({
 label: String.fromCharCode(label++),
 usage: 'Skirt Board',
 sku: b.skirtSize || '2x6',
 material: `${(b.skirtSize || '2x6').toUpperCase()} TREATED`,
 qty: 1,
 cut: `${wallW}'`,
 part: `${Math.ceil(wallW / 2) * 2}'`,
 });

 // Title + table title + header + body rows + padding
 const h = 72 + (rows.length + 1) * 18 + 24;
 pageChrome(ctx, x, y0, w, h, `Material List — ${wallDef.id}`, meta);
 drawMaterialTable(ctx, x + 16, y0 + 52, w - 32, rows);
 return y0 + h;
}

/* ───────────────── Roof assembly ───────────────── */

function sheetAssemblyRoof(ctx, b, framing, x, y0, w, h, meta) {
 pageChrome(ctx, x, y0, w, h, 'Assembly Drawing — ROOF-1', meta);
 const top = y0 + 52;
 // Same plan orientation: length horizontal, width vertical
 const scale = fitScale(b.length + 2, b.width + 2, w - 60, h - 90, 24);
 const ox = x + (w - b.length * scale) / 2;
 const oy = top + 24;
 const tL = (z) => ox + z * scale;
 const tW = (wx) => oy + wx * scale;

 const bx = tL(0);
 const by = tW(0);
 const bw = b.length * scale;
 const bh = b.width * scale;

 ctx.fillStyle = '#ffffff';
 ctx.fillRect(bx, by, bw, bh);
 ctx.strokeStyle = INK;
 ctx.lineWidth = 1.25;
 ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

 // Purlin stations (capped density)
 const purlinSp = (b.purlinSpacingIn || 24) / 12;
 const half = b.width / 2;
 const stations = [];
 for (let d = purlinSp; d < half - 0.05; d += purlinSp) {
 stations.push(d, b.width - d);
 }
 stations.push(half);
 let uniq = [...new Set(stations.map((v) => Math.round(v * 1000) / 1000))].sort((a, c) => a - c);
 if (uniq.length > 12) {
 const step = Math.ceil(uniq.length / 12);
 uniq = uniq.filter((_, i) => i % step === 0 || i === uniq.length - 1);
 }

 // Truss lines under purlins
 ctx.strokeStyle = '#ddd8d0';
 ctx.lineWidth = 1;
 const tc = framing.trusses?.count || 2;
 for (let i = 0; i < tc; i++) {
 const z = tc === 1 ? b.length / 2 : (i / (tc - 1)) * b.length;
 const cx = tL(z);
 ctx.beginPath();
 ctx.moveTo(cx, by + 1);
 ctx.lineTo(cx, by + bh - 1);
 ctx.stroke();
 }

 // Discrete purlin boards with splice gaps
 const boardH = Math.max(3, Math.min(6, purlinSp * scale * 0.2));
 const spliceGap = 3;
 const stocks = [16, 16, 12];
 const letters = 'ABCDEF';
 let li = 0;
 ctx.font = 'bold 9px Arial';
 ctx.textAlign = 'center';
 ctx.textBaseline = 'bottom';
 for (let ri = 0; ri < uniq.length; ri++) {
 const rowX = uniq[ri];
 const yy = tW(rowX) - boardH / 2;
 let z = 0;
 let si = 0;
 while (z < b.length - 0.05) {
 let use = stocks[si % stocks.length];
 if (use > b.length - z) use = b.length - z;
 let x0 = tL(z);
 let x1 = tL(z + use);
 if (z > 0.05) x0 += spliceGap / 2;
 if (z + use < b.length - 0.05) x1 -= spliceGap / 2;
 const sw = x1 - x0;
 if (sw >= 2) {
 ctx.fillStyle = '#d4b896';
 ctx.fillRect(x0, yy, sw, boardH);
 ctx.strokeStyle = '#b89868';
 ctx.lineWidth = 0.75;
 ctx.strokeRect(x0 + 0.25, yy + 0.25, sw - 0.5, boardH - 0.5);
 if (sw >= 18) {
 ctx.fillStyle = INK;
 ctx.fillText(letters[li % letters.length], x0 + sw / 2, yy - 1);
 }
 }
 li++;
 z += use;
 si++;
 }
 }
 ctx.textAlign = 'left';
 ctx.textBaseline = 'alphabetic';

 return y0 + h;
}

function sheetAssemblyRoofMaterials(ctx, b, framing, cut, x, y0, w, meta) {
 const purlinLf = framing.purlins?.linearFt || 0;
 const rows = [
 {
 label: 'A',
 usage: 'Purlin',
 sku: '2x4',
 material: '2X4 SYP',
 qty: Math.ceil(purlinLf / 16) || 1,
 cut: "16'",
 part: "16'",
 },
 {
 label: 'B',
 usage: 'Purlin',
 sku: '2x4',
 material: '2X4 SYP',
 qty: Math.ceil(purlinLf / 12) || 1,
 cut: "12'",
 part: "12'",
 },
 {
 label: 'H',
 usage: 'Eave Sub Fascia',
 sku: '2x6',
 material: '2X6 SYP',
 qty: 2,
 cut: `${b.length}'`,
 part: `${Math.ceil(b.length / 2) * 2}'`,
 },
 {
 label: 'L',
 usage: 'Gable Sub Fascia',
 sku: '2x6',
 material: '2X6 SYP',
 qty: 2,
 cut: `${b.width}'`,
 part: `${Math.ceil(b.width / 2) * 2}'`,
 },
 ];
 const h = 72 + (rows.length + 1) * 18 + 24;
 pageChrome(ctx, x, y0, w, h, 'Material List — ROOF-1', meta);
 drawMaterialTable(ctx, x + 16, y0 + 52, w - 32, rows);
 return y0 + h;
}

/* ───────────────── Tables ───────────────── */

function drawMaterialTable(ctx, x, y, w, rows) {
 ctx.save();
 ctx.font = 'bold 12px Arial';
 ctx.fillStyle = INK;
 ctx.textAlign = 'left';
 ctx.textBaseline = 'alphabetic';
 ctx.fillText('Material List', x, y + 12);

 const cols = [
 { key: 'label', title: 'Label', ww: 0.08 },
 { key: 'usage', title: 'Usage', ww: 0.18 },
 { key: 'sku', title: 'Sku', ww: 0.14 },
 { key: 'material', title: 'Material', ww: 0.28 },
 { key: 'qty', title: 'Qty', ww: 0.08 },
 { key: 'cut', title: 'Cut Len.', ww: 0.12 },
 { key: 'part', title: 'Part Len.', ww: 0.12 },
 ];
 const rowH = 18;
 const n = rows.length;
 const x0 = Math.round(x);
 const tableY = Math.round(y + 18);
 const ww = Math.round(w);
 const totalH = (n + 1) * rowH;

 // Fills
 ctx.fillStyle = '#e4e4e4';
 ctx.fillRect(x0, tableY, ww, rowH);
 for (let i = 1; i <= n; i++) {
 ctx.fillStyle = i % 2 === 0 ? '#f7f7f7' : '#ffffff';
 ctx.fillRect(x0, tableY + i * rowH, ww, rowH);
 }

 // Single path for outer + all grid lines (no double borders)
 const L = x0 + 0.5;
 const T = tableY + 0.5;
 const R = x0 + ww - 0.5;
 const B = tableY + totalH - 0.5;
 ctx.strokeStyle = INK;
 ctx.lineWidth = 1;
 ctx.beginPath();
 ctx.moveTo(L, T);
 ctx.lineTo(R, T);
 ctx.lineTo(R, B);
 ctx.lineTo(L, B);
 ctx.closePath();
 for (let i = 1; i <= n; i++) {
 const yy = tableY + i * rowH + 0.5;
 ctx.moveTo(L, yy);
 ctx.lineTo(R, yy);
 }
 let acc = x0;
 for (let c = 0; c < cols.length - 1; c++) {
 acc += Math.round(ww * cols[c].ww);
 const vx = acc + 0.5;
 ctx.moveTo(vx, T);
 ctx.lineTo(vx, B);
 }
 ctx.stroke();

 // Header + body text centered vertically in rows
 ctx.fillStyle = INK;
 ctx.textBaseline = 'middle';
 ctx.font = 'bold 10px Arial';
 let cx = x0;
 cols.forEach((c) => {
 const cw = Math.round(ww * c.ww);
 ctx.fillText(c.title, cx + 4, tableY + rowH / 2);
 cx += cw;
 });
 ctx.font = '10px Arial';
 rows.forEach((r, i) => {
 const cy = tableY + (i + 1) * rowH + rowH / 2;
 cx = x0;
 cols.forEach((c) => {
 const cw = Math.round(ww * c.ww);
 ctx.fillText(String(r[c.key] ?? ''), cx + 4, cy);
 cx += cw;
 });
 });
 ctx.textBaseline = 'alphabetic';
 ctx.restore();
 return tableY + totalH;
}

/* ───────────────── Sheathing drawings (sheet maps) ─────────────────
 * Crews use these to know which cut length goes at which station.
 * Panel coverage = 3'. Labels are ordered cut lengths (same math as takeoff).
 */

function sheetSheathingError(ctx, x, y0, w, meta, msg) {
 const h = 100;
 pageChrome(ctx, x, y0, w, h, 'Sheathing Drawings', meta);
 ctx.fillStyle = '#b00020';
 ctx.font = '13px Arial';
 ctx.fillText(msg || 'Sheathing layout failed to load.', x + 20, y0 + 70);
 ctx.fillStyle = MUTED;
 ctx.font = '11px Arial';
 ctx.fillText('Hard-refresh the browser (Cmd+Shift+R), then open 2D / Plans again.', x + 20, y0 + 90);
 return y0 + h;
}

function sheetSheathingLegend(ctx, b, sheathing, x, y0, w, meta) {
 const h = 168;
 pageChrome(ctx, x, y0, w, h, 'Sheathing Key — Sheet Metal Placement', meta);
 const top = y0 + 52;
 ctx.fillStyle = INK;
 ctx.font = '12px Arial';
 const leftCut = sheathing.leftRoofCutLengthFt;
 const rightCut = sheathing.rightRoofCutLengthFt;
 const roofNote =
 leftCut != null &&
 rightCut != null &&
 Math.abs(leftCut - rightCut) > 0.05
 ? `Roof: left ${fmtFtIn(leftCut)} · right ${fmtFtIn(rightCut)} (continuous lean side folds lean roof into longer sheets)`
 : `Roof panels: cut length = slope (rafter + metal OH) → ${sheathing.roofCutLabel} · qty along building length`;
 const lines = [
 'Panel coverage: 3\' net · 29 ga AG panel · lengths match item-list cut sizes',
 roofNote,
 `Eave walls (EXT-1 / EXT-3): full height ${fmtFtIn(sheathing.eavePanelHeightFt)} (eave + 1')${sheathing.wainscotHeightFt > 0 ? ` · wainscot band ${fmtFtIn(sheathing.wainscotHeightFt)}` : ''}`,
 'Gable ends (EXT-2 / EXT-4): one 3\' sheet per bay; cut height = roof line in bay + 1\'6\' stock',
 'Each rectangle below is ONE sheet. Number = cut length to pull from the bundle. Openings shown as cutouts.',
 'Install order: start at a corner / gable end, work across. Match label to measured station on the wall or roof.',
 ];
 let yy = top + 8;
 for (const line of lines) {
 ctx.fillText(line, x + 20, yy);
 yy += 16;
 }
 ctx.font = '11px Arial';
 ctx.fillStyle = MUTED;
 ctx.fillText(
 `Wall color: ${b.wallColor || 'AL'} Roof color: ${b.roofColor || 'BK'} Trim: ${b.trimColor || b.roofColor || 'BK'}`,
 x + 20,
 yy + 6,
 );
 return y0 + h;
}

/**
 * ROOF-1 / ROOF-2 — equal-length panels arrayed along building length.
 */
function sheetSheathingRoof(ctx, b, plane, sheathing, x, y0, w, meta) {
 const panels = plane.panels || [];
 const n = Math.max(1, panels.length);
 // Sheet height scales with panel count
 const h = Math.min(420, Math.max(280, 160 + n * 8));
 pageChrome(ctx, x, y0, w, h, `Sheathing Drawing — ${plane.id}`, meta);
 const top = y0 + 52;
 const bot = y0 + h - 36;
 const left = x + 36;
 const right = x + w - 36;
 const boxW = right - left;
 const boxH = bot - top - 28;

 ctx.fillStyle = MUTED;
 ctx.font = '11px Arial';
 ctx.fillText(
 `${plane.name} · ${n} sheets × ${sheathing.roofCutLabel} · along ${fmtFtIn(plane.alongFt)} building length · 3' coverage`,
 left,
 top + 4,
 );

 // Draw as a horizontal row of vertical panels (ROOF sheet layout)
 const gap = 1;
 const totalGaps = (n - 1) * gap;
 const pw = (boxW - totalGaps) / n;
 const ph = Math.min(boxH - 10, 200);
 const yPanel = top + 28 + (boxH - ph) / 2;

 ctx.strokeStyle = INK;
 ctx.lineWidth = 1.1;
 ctx.font = 'bold 11px Arial';
 ctx.textAlign = 'center';
 for (let i = 0; i < n; i++) {
 const p = panels[i];
 const px0 = left + i * (pw + gap);
 ctx.fillStyle = '#fafafa';
 ctx.fillRect(px0, yPanel, pw, ph);
 ctx.strokeRect(px0 + 0.5, yPanel + 0.5, pw - 1, ph - 1);
 // Vertical label (cut length) — rotated if panel is narrow
 ctx.save();
 ctx.fillStyle = INK;
 if (pw < 28) {
 ctx.translate(px0 + pw / 2, yPanel + ph / 2);
 ctx.rotate(-Math.PI / 2);
 ctx.font = 'bold 10px Arial';
 ctx.fillText(p.cutLabel, 0, 3);
 } else {
 ctx.font = 'bold 12px Arial';
 ctx.fillText(p.cutLabel, px0 + pw / 2, yPanel + ph / 2 + 4);
 }
 ctx.restore();
 // Station mark under panel
 ctx.fillStyle = MUTED;
 ctx.font = '9px Arial';
 ctx.fillText(`${fmtFtIn(p.u0)}`, px0 + pw / 2, yPanel + ph + 12);
 }
 ctx.textAlign = 'left';

 // Overall dimension
 dimH(ctx, left, bot - 4, boxW, `${fmtFtIn(plane.alongFt)} along eave · each sheet ${sheathing.roofCutLabel} up-slope`);

 // Footer note
 ctx.fillStyle = MUTED;
 ctx.font = '10px Arial';
 ctx.fillText(
 'Roof sheets run from eave to ridge (or eave to high side on mono). Pull length shown on each sheet.',
 left,
 y0 + h - 12,
 );

 return y0 + h;
}

/**
 * EXT-1…4 wall sheathing — vertical sheets with cut-length labels + opening cutouts.
 */
function sheetSheathingWall(ctx, b, wall, sheathing, x, y0, w, meta) {
 const isGable = wall.role === 'gable';
 const h = isGable ? 480 : 400;
 pageChrome(ctx, x, y0, w, h, `Sheathing Drawing — ${wall.id}`, meta);
 const top = y0 + 52;
 const groundY = y0 + h - 40;
 const left = x + 48;
 const right = x + w - 36;
 const boxW = right - left;

 ctx.fillStyle = MUTED;
 ctx.font = '11px Arial';
 const openNote = wall.open
 ? ' · OPEN WALL (drive-through) — no sheets below eave'
 : '';
 ctx.fillText(
 `${wall.name} (${wall.wall}) · ${fmtFtIn(wall.alongFt)} long · 3' coverage${openNote}`,
 left,
 top + 4,
 );

 if (wall.open && wall.role === 'eave') {
 ctx.fillStyle = INK;
 ctx.font = '13px Arial';
 ctx.fillText('No wall sheathing on this face (open / drive-through).', left, top + 80);
 ctx.font = '11px Arial';
 ctx.fillStyle = MUTED;
 ctx.fillText('Gable peak metal above eave (if applicable) is on the gable sheathing sheet.', left, top + 104);
 return y0 + h;
 }

 if (wall.open && wall.role === 'gable') {
 ctx.fillStyle = MUTED;
 ctx.font = '11px Arial';
 ctx.fillText(
 'OPEN gable: sheets shown are peak metal ABOVE eave only (drive-through clears below).',
 left,
 top + 18,
 );
 }

 // Max drawing height from panels
 let maxH = sheathing.eavePanelHeightFt;
 for (const p of wall.panels) {
 maxH = Math.max(maxH, p.y1 || p.cutLengthFt || 0, p.stockHeightFt || 0);
 }
 if (isGable && b.roofStyle === 'gable') {
 maxH = Math.max(maxH, b.eaveHeight + roofRise(b) + 2);
 }
 const drawH = groundY - top - 36;
 const scale = Math.min(boxW / Math.max(wall.alongFt, 1), drawH / Math.max(maxH, 1));
 const ox = left + (boxW - wall.alongFt * scale) / 2;
 const X = (ft) => ox + ft * scale;
 const Y = (ftUp) => groundY - ftUp * scale;

 // Ground line
 ctx.strokeStyle = INK;
 ctx.lineWidth = 1.2;
 ctx.beginPath();
 ctx.moveTo(ox - 8, groundY);
 ctx.lineTo(ox + wall.alongFt * scale + 8, groundY);
 ctx.stroke();

 // Group panels: draw full/upper first, then wainscot (so labels read cleanly)
 const mainPanels = wall.panels.filter((p) => p.band !== 'wainscot');
 const wainPanels = wall.panels.filter((p) => p.band === 'wainscot');

 const drawPanelRect = (p, fill) => {
 const x0 = X(p.u0);
 const x1 = X(p.u1);
 const yTop = Y(p.y1);
 const yBot = Y(p.y0);
 const pw = Math.max(2, x1 - x0);
 const ph = Math.max(2, yBot - yTop);
 ctx.fillStyle = fill;
 ctx.fillRect(x0, yTop, pw, ph);
 ctx.strokeStyle = INK;
 ctx.lineWidth = 1;
 ctx.strokeRect(x0 + 0.5, yTop + 0.5, pw - 1, ph - 1);
 // Cut length label
 ctx.save();
 ctx.fillStyle = INK;
 ctx.textAlign = 'center';
 if (pw < 22 || ph < 36) {
 ctx.translate(x0 + pw / 2, yTop + ph / 2);
 ctx.rotate(-Math.PI / 2);
 ctx.font = 'bold 9px Arial';
 ctx.fillText(p.cutLabel, 0, 3);
 } else {
 ctx.font = 'bold 11px Arial';
 ctx.fillText(p.cutLabel, x0 + pw / 2, yTop + ph / 2 + 4);
 }
 ctx.restore();
 };

 for (const p of mainPanels) drawPanelRect(p, '#f7f7f7');
 for (const p of wainPanels) drawPanelRect(p, '#e8e8e8');

 // Rake outline on gable (visual guide above stepped sheets)
 if (isGable && b.roofStyle === 'gable') {
 const eave = b.eaveHeight;
 const peak = eave + roofRise(b);
 ctx.strokeStyle = MUTED;
 ctx.lineWidth = 1;
 ctx.setLineDash([4, 3]);
 ctx.beginPath();
 ctx.moveTo(X(0), Y(eave));
 ctx.lineTo(X(wall.alongFt / 2), Y(peak));
 ctx.lineTo(X(wall.alongFt), Y(eave));
 ctx.stroke();
 ctx.setLineDash([]);
 }

 // Opening cutouts (white) with size label
 for (const o of wall.openings || []) {
 const sill = Number(o.sillHeight) || 0;
 const ow = Number(o.width) || 3;
 const oh = Number(o.height) || 7;
 const leftO = Number(o.offset) || 0;
 const ox0 = X(leftO);
 const oy0 = Y(sill + oh);
 const rw = ow * scale;
 const rh = oh * scale;
 ctx.fillStyle = '#ffffff';
 ctx.fillRect(ox0, oy0, rw, rh);
 ctx.strokeStyle = OPEN;
 ctx.lineWidth = 1.25;
 ctx.strokeRect(ox0 + 0.5, oy0 + 0.5, rw - 1, rh - 1);
 ctx.fillStyle = MUTED;
 ctx.font = '9px Arial';
 ctx.textAlign = 'center';
 ctx.fillText(formatOpeningSize(ow, oh), ox0 + rw / 2, oy0 + rh / 2 + 3);
 ctx.textAlign = 'left';
 }

 // Dimensions
 dimH(ctx, ox, groundY + 16, wall.alongFt * scale, `${fmtFtIn(wall.alongFt)}`);
 if (mainPanels.length) {
 const sample = mainPanels[Math.floor(mainPanels.length / 2)];
 dimV(
 ctx,
 ox - 14,
 Y(sample.y1),
 (sample.y1 - sample.y0) * scale,
 sample.cutLabel,
 );
 }

 // Count summary strip
 const counts = {};
 for (const p of wall.panels) {
 const k = p.cutLabel;
 counts[k] = (counts[k] || 0) + 1;
 }
 const summary = Object.entries(counts)
 .map(([len, qty]) => `${qty} × ${len}`)
 .join(' ');
 ctx.fillStyle = MUTED;
 ctx.font = '10px Arial';
 ctx.fillText(`Sheet count: ${summary || '—'}`, left, y0 + h - 12);

 return y0 + h;
}

function sheetCutSummary(ctx, cut, x, y0, w, meta) {
 const lumber = cut.lumber || [];
 const metal = cut.metal || [];
 const lrows = lumber.map((r, i) => ({
 label: String(i + 1),
 usage: r.usage || r.kind || 'Lumber',
 sku: r.sku || r.size || '',
 material: r.desc || r.material || '',
 qty: r.qty ?? r.count ?? '',
 cut: r.length || r.cut || '',
 part: r.stock || r.part || '',
 }));
 const mrows = metal.map((r, i) => ({
 label: String.fromCharCode(65 + i),
 usage: r.usage || 'Metal',
 sku: r.sku || '',
 material: r.desc || r.material || '',
 qty: r.qty ?? '',
 cut: r.length || '',
 part: r.stock || '',
 }));
 // Estimate height: chrome + lumber table + metal table + padding
 const h =
 56 +
 22 +
 (lrows.length ? 20 + (lrows.length + 1) * 18 : 24) +
 28 +
 (mrows.length ? 20 + (mrows.length + 1) * 18 : 0) +
 28;
 pageChrome(ctx, x, y0, w, h, 'Cut List Summary', meta);
 let y = y0 + 52;
 if (lrows.length) {
 y = drawMaterialTable(ctx, x + 16, y, w - 32, lrows) + 16;
 } else {
 ctx.font = '10px Arial';
 ctx.fillStyle = INK;
 ctx.fillText('See assembly material lists above.', x + 16, y + 16);
 y += 28;
 }
 if (mrows.length) {
 ctx.font = 'bold 12px Arial';
 ctx.fillStyle = INK;
 ctx.fillText('Metal', x + 16, y + 4);
 y += 8;
 drawMaterialTable(ctx, x + 16, y, w - 32, mrows);
 }
 return y0 + h;
}

function sheetNotes(ctx, b, x, y0, w, meta) {
 const h = 120;
 pageChrome(ctx, x, y0, w, h, 'General Notes', meta);
 const notes = [
 'PRELIMINARY PLANS — NOT FOR CONSTRUCTION without PE review and local code compliance.',
 'Post embedment, frost depth, and wind/snow loads must be verified for site conditions.',
 'Metal panel coverage assumed 3\' exposed. Truss design by manufacturer for stated loads.',
 'Openings shown are rough openings; verify unit sizes with supplier before ordering.',
 `Building: ${b.width}' W × ${b.length}' L × ${b.eaveHeight}' eave · ${b.pitch}/12 ${b.roofStyle} · posts ${b.postSpacing}' o.c.`,
 ];
 ctx.font = '11px Arial';
 ctx.fillStyle = INK;
 let y = y0 + 56;
 notes.forEach((n) => {
 ctx.fillText(n, x + 16, y);
 y += 14;
 });
 return y0 + h;
}

/* ───────────────── Cut list data ───────────────── */

function buildCutList(b, framing) {
 const lumber = [];
 const metal = [];

 // Posts by stock length
 const postCounts = {};
 for (const p of framing.mainPosts) {
 const L = p.stockFt || p.totalLengthFt;
 postCounts[L] = (postCounts[L] || 0) + 1;
 }
 Object.keys(postCounts)
 .map(Number)
 .sort((a, c) => c - a)
 .forEach((L) => {
 lumber.push({
 usage: 'Post',
 size: '6x6',
 sku: `6x6x${L}`,
 desc: `6X6 CCA POST ${L}'`,
 qty: postCounts[L],
 length: `${L}'`,
 stock: `${L}'`,
 });
 });

 // Girts
 const girtSp = (b.girtSpacingIn || 24) / 12;
 const girtRows = Math.max(1, Math.floor((b.eaveHeight - 0.5) / girtSp));
 const girtLf = girtRows * (2 * b.width + 2 * b.length);
 lumber.push({
 usage: 'Girt',
 size: '2x6',
 sku: '2x6',
 desc: '2X6 SYP GIRT',
 qty: Math.ceil(girtLf / 20),
 length: "20'",
 stock: "20'",
 });

 // Truss bearers
 lumber.push({
 usage: 'Truss Bearer',
 size: b.trussCarrierSize || '2x10',
 sku: b.trussCarrierSize || '2x10',
 desc: `${(b.trussCarrierSize || '2x10').toUpperCase()} 2-PLY CARRIER`,
 qty: Math.ceil((2 * b.length) / 20) * 2,
 length: "20'",
 stock: "20'",
 });

 // Skirt
 lumber.push({
 usage: 'Skirt',
 size: b.skirtSize || '2x6',
 sku: b.skirtSize || '2x6',
 desc: `${(b.skirtSize || '2x6').toUpperCase()} TREATED SKIRT`,
 qty: Math.ceil((2 * b.width + 2 * b.length) / 16),
 length: "16'",
 stock: "16'",
 });

 // Purlins
 const purlinLf = framing.purlins?.linearFt || b.length * 10;
 lumber.push({
 usage: 'Purlin',
 size: '2x4',
 sku: '2x4',
 desc: '2X4 SYP PURLIN',
 qty: Math.ceil(purlinLf / 16),
 length: "16'",
 stock: "16'",
 });

 // Metal rough
 const wallSf = 2 * (b.width + b.length) * b.eaveHeight;
 const roofSf = 2 * rafterLength(b) * b.length;
 metal.push({
 usage: 'Wall Panel',
 desc: `${b.wallColor || 'AL'} ${b.wallGauge === '26' ? '26' : '29'}GA AG PANEL`,
 qty: Math.ceil(wallSf / (3 * b.eaveHeight)),
 length: `${b.eaveHeight}'`,
 });
 metal.push({
 usage: 'Roof Panel',
 desc: `${b.roofColor || 'BK'} ${b.roofGauge === '26' ? '26' : '29'}GA AG PANEL`,
 qty: Math.ceil(roofSf / (3 * rafterLength(b))),
 length: `${Math.ceil(rafterLength(b))}'`,
 });

 return { lumber, metal };
}
