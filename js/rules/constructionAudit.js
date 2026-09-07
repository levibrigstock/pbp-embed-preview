/**
 * Size-aware construction + takeoff self-check.
 * Verifies geometry, framing quantities, and buildability for custom buildings.
 * Not a PE stamp — checklist for sound post-frame practice.
 */

import {
  wallLength,
  rafterLength,
  isWallOpen,
  openWallList,
} from '../domain/types.js?v=20260806f';
import {
  generateFraming,
  girtLevelsForHeight,
  isDoorOpening,
  isWindowOpening,
} from '../domain/framing.js?v=20260806f';
import { describePolicyForBuilding } from '../domain/productionPolicy.js?v=20260806f';

/**
 * @typedef {{ level: 'ok'|'warn'|'error', code: string, category: string, message: string }} AuditItem
 */

/**
 * Run full construction / measurement audit for one building.
 * @param {object} b
 * @param {object[]} [takeoffItems] optional live takeoff lines for qty checks
 * @returns {{ items: AuditItem[], summary: { ok: number, warn: number, error: number, pass: boolean } }}
 */
export function auditBuilding(b, takeoffItems = null) {
  /** @type {AuditItem[]} */
  const items = [];
  const push = (level, category, code, message) => {
    items.push({ level, category, code, message });
  };

  const W = Number(b.width) || 0;
  const L = Number(b.length) || 0;
  const H = Number(b.eaveHeight) || 0;
  const pitch = Number(b.pitch) || 0;
  const postSp = Number(b.postSpacing) || 10;
  const embed = Number(b.postDepthFt) || 0;
  const girtIn = Number(b.girtSpacingIn) || 24;
  const purlinIn = Number(b.purlinSpacingIn) || 24;
  const trussSp = Number(b.trussSpacing) || 5;
  const framing = generateFraming(b);
  const policy = describePolicyForBuilding(b);

  push(
    'ok',
    'Production policy',
    'POLICY_ACTIVE',
    `Order policy: girts ${policy.girtPackage}; purlin pad ${policy.purlinStationPad}; panel metal OH ${policy.panelMetalOverhangIn}"; roof cut ~${policy.roofCutFt.toFixed?.(2) ?? policy.roofCutFt}'; eave wall ~${policy.eaveWallPanelFt.toFixed?.(2) ?? policy.eaveWallPanelFt}'; truss blocks ${policy.trussBlocks}.`,
  );

  // ── Dimensions ──
  if (W >= 12 && W <= 80 && L >= 16 && L <= 200 && H >= 8 && H <= 24) {
    push(
      'ok',
      'Dimensions',
      'DIM_OK',
      `Building ${W}×${L}×${H}' is within normal custom post-frame range.`,
    );
  } else if (W < 8 || L < 12 || H < 6) {
    push(
      'error',
      'Dimensions',
      'DIM_TOO_SMALL',
      `Footprint/height ${W}×${L}×${H}' is below practical post-frame minimums.`,
    );
  } else {
    push(
      'warn',
      'Dimensions',
      'DIM_UNUSUAL',
      `${W}×${L}×${H}' is outside common shop/barn ranges — verify engineering and package.`,
    );
  }

  if (pitch >= 2 && pitch <= 8) {
    push('ok', 'Dimensions', 'PITCH_OK', `Roof pitch ${pitch}/12 is suitable for metal panels.`);
  } else if (pitch < 2) {
    push(
      'error',
      'Dimensions',
      'PITCH_TOO_LOW',
      `Pitch ${pitch}/12 is below typical metal minimum — confirm panel manufacturer.`,
    );
  } else {
    push(
      'warn',
      'Dimensions',
      'PITCH_STEEP',
      `Pitch ${pitch}/12 is steep — check post length, rafter/fly package, and fall protection.`,
    );
  }

  // ── Posts ──
  const posts = framing.mainPosts || [];
  const cornersNeeded = 4;
  if (posts.length >= cornersNeeded) {
    push(
      'ok',
      'Posts',
      'POST_COUNT_OK',
      `${posts.length} main posts (corners + intermediates @ ${postSp}' o.c.).`,
    );
  } else {
    push(
      'error',
      'Posts',
      'POST_COUNT_LOW',
      `Only ${posts.length} main posts — need at least 4 corners.`,
    );
  }

  if (embed >= 3 && embed <= 5) {
    push(
      'ok',
      'Posts',
      'EMBED_OK',
      `Post embed ${embed}' is in a typical frost/holding range (confirm local frost depth).`,
    );
  } else if (embed < 2) {
    push(
      'error',
      'Posts',
      'EMBED_SHALLOW',
      `Post embed ${embed}' is too shallow for permanent post-frame — increase depth.`,
    );
  } else {
    push(
      'warn',
      'Posts',
      'EMBED_CHECK',
      `Post embed ${embed}' — verify frost line and overturning for this eave height.`,
    );
  }

  if (H > 16 && embed < 4) {
    push(
      'warn',
      'Posts',
      'EMBED_VS_HEIGHT',
      `${H}' eave with ${embed}' embed — tall walls often need deeper embed or PE review.`,
    );
  } else if (H <= 16 && embed >= 3) {
    push(
      'ok',
      'Posts',
      'EMBED_VS_HEIGHT_OK',
      `Embed ${embed}' is reasonable for ${H}' eave height.`,
    );
  }

  if (postSp > 0 && postSp <= 10) {
    push('ok', 'Posts', 'POST_SPACING_OK', `Post spacing ${postSp}' o.c. supports common girt spans.`);
  } else if (postSp > 12) {
    push(
      'error',
      'Posts',
      'POST_SPACING_FAIL',
      `Post spacing ${postSp}' exceeds 12' — not acceptable without engineering.`,
    );
  } else {
    push(
      'warn',
      'Posts',
      'POST_SPACING_HIGH',
      `Post spacing ${postSp}' — verify girt size and loads.`,
    );
  }

  // Over-max stock field splice note
  const tallPosts = posts.filter((p) => p.fieldCutFt && p.fieldCutFt > (p.stockFt || 0));
  if (tallPosts.length) {
    push(
      'ok',
      'Posts',
      'FIELD_SPLICE_NOTED',
      `${tallPosts.length} post(s) order max stock with FIELD SPLICED length notes (peak/tall stations).`,
    );
  }

  // ── Girts (geometry self-check) ──
  const girtSpFt = girtIn / 12;
  const levels = girtLevelsForHeight(H, girtSpFt, 0);
  const closed = ['front', 'back', 'left', 'right'].filter((w) => !isWallOpen(b, w));
  let girtLfGeom = 0;
  for (const wall of closed) {
    // Skip main face fully covered by enclosed lean (same as generateGirts intent)
    const leanOn = (b.leanTos || []).some(
      (lt) => lt.wall === wall && lt.enclosed !== false && lt.enclosure !== 'open',
    );
    if (leanOn && (wall === 'left' || wall === 'right' || wall === 'front' || wall === 'back')) {
      // still count if generateGirts includes it — use framing runs instead
    }
  }
  const runs = framing.girts?.runs || [];
  girtLfGeom = runs.reduce((s, r) => s + (r.lengthFt || 0) * (r.rows || 0), 0);
  const girtBoardsGeom = girtLfGeom > 0 ? Math.ceil(girtLfGeom / 20 - 1e-9) : 0;

  const girtPkg = framing.girts || {};
  const packMode = girtPkg.packMode || 'continuous';
  if (levels.length >= 3) {
    push(
      'ok',
      'Girts',
      'GIRT_ROWS_OK',
      `${levels.length} girt row(s) @ ${girtIn}" o.c. on ${H}' eave (${packMode === 'per-wall' ? 'production package — eave nailer included' : 'small-shop package — eave via carrier/subfascia'}).`,
    );
  } else {
    push(
      'warn',
      'Girts',
      'GIRT_ROWS_LOW',
      `Only ${levels.length} girt row(s) — check eave height and girt spacing.`,
    );
  }

  if (girtBoardsGeom > 0 || (takeoffItems && takeoffItems.some((i) => i.usage === 'Girt'))) {
    const modeLabel =
      packMode === 'per-wall'
        ? 'per-wall pack (large / lean production)'
        : 'continuous LF pack (small plain shop)';
    push(
      'ok',
      'Girts',
      'GIRT_PACK_OK',
      `Girt packing: ${modeLabel}${girtLfGeom ? ` · ~${Math.round(girtLfGeom)} lf geometry` : ''}.`,
    );
  }

  // Cross-check takeoff if provided (allow openings deduct + per-wall waste)
  if (takeoffItems) {
    const girtQty = takeoffItems
      .filter((i) => i.usage === 'Girt')
      .reduce((s, i) => s + (Number(i.qty) || 0), 0);
    if (girtQty > 0 && girtBoardsGeom > 0) {
      const tol = packMode === 'per-wall' ? 8 : 3; // waste + opening deducts
      if (Math.abs(girtQty - girtBoardsGeom) <= tol || girtQty <= girtBoardsGeom + 2) {
        push(
          'ok',
          'Takeoff',
          'GIRT_QTY_MATCH',
          `Takeoff Girt qty ${girtQty} aligned with geometry (~${girtBoardsGeom} lf-pack, ${packMode}).`,
        );
      } else {
        push(
          'warn',
          'Takeoff',
          'GIRT_QTY_MISMATCH',
          `Takeoff Girt ${girtQty} vs geometry ~${girtBoardsGeom} — review openings deduct or open walls.`,
        );
      }
    }
  }

  // ── Purlins ──
  const pur = framing.purlins || {};
  const rowsPerSide = pur.rowsPerSide || 0;
  const purSides = pur.sides || 2;
  if (rowsPerSide >= 4) {
    push(
      'ok',
      'Purlins',
      'PURLIN_ROWS_OK',
      `${rowsPerSide} purlin row(s)/side × ${purSides} slope(s) @ ${purlinIn}" (width-aware station pad).`,
    );
  } else {
    push(
      'warn',
      'Purlins',
      'PURLIN_ROWS_LOW',
      `Only ${rowsPerSide} purlin rows/side — check width, OH, and spacing.`,
    );
  }

  // ── Trusses ──
  const trussN = framing.trusses?.count || 0;
  const expectTruss = L > 0 && trussSp > 0 ? Math.floor(L / trussSp) + 1 : 0;
  if (trussN === expectTruss && trussN > 0) {
    push(
      'ok',
      'Trusses',
      'TRUSS_COUNT_OK',
      `${trussN} trusses @ ${trussSp}' o.c. on ${L}' length (ends inclusive).`,
    );
  } else if (expectTruss > 0) {
    push(
      'warn',
      'Trusses',
      'TRUSS_COUNT_CHECK',
      `Truss count ${trussN} vs expected ${expectTruss} for ${L}' @ ${trussSp}' o.c.`,
    );
  }

  if (W > 0 && W <= 60) {
    push(
      'ok',
      'Trusses',
      'SPAN_OK',
      `${W}' clear span — use manufacturer-rated engineered trusses for site loads.`,
    );
  } else if (W > 60) {
    push(
      'warn',
      'Trusses',
      'SPAN_WIDE',
      `${W}' span typically requires PE / special truss design.`,
    );
  }

  // ── Roof slope length ──
  const raf = rafterLength(b);
  if (raf > 0 && raf < 60) {
    push(
      'ok',
      'Roof',
      'RAFTER_LEN_OK',
      `Roof slope length ≈ ${raf.toFixed(2)}' (drives panel cut + fly package).`,
    );
  }

  // ── Skirt / perimeter ──
  const skirtLf = framing.skirt?.linearFt || 0;
  if (skirtLf > 0) {
    const peri = 2 * (W + L);
    push(
      'ok',
      'Skirt',
      'SKIRT_OK',
      `Skirt ≈ ${Math.round(skirtLf)} lf (main closed perimeter${skirtLf > peri + 1 ? ' + lean faces' : ''}).`,
    );
  }

  // ── Openings ──
  const openings = b.openings || [];
  if (!openings.length) {
    push('ok', 'Openings', 'NO_OPENINGS', 'No openings — full wall framing and metal package.');
  } else {
    let openOk = 0;
    let openBad = 0;
    for (const o of openings) {
      const maxH =
        !o.host || o.host === 'main'
          ? H
          : (b.leanTos || []).find((l) => l.id === o.host)?.eaveHeight || H;
      const hostLen =
        !o.host || o.host === 'main'
          ? wallLength(b, o.wall || 'front')
          : (() => {
              const lean = (b.leanTos || []).find((l) => l.id === o.host);
              if (!lean) return 0;
              if (o.face === 'leftEnd' || o.face === 'rightEnd') return Number(lean.depth) || 0;
              const wl = wallLength(b, lean.wall);
              return lean.length > 0
                ? Math.min(Number(lean.length) || 0, wl)
                : wl - (Number(lean.offset) || 0);
            })();
      const end = Number(o.offset) + Number(o.width);
      const sill = Number(o.sillHeight) || 0;
      if (o.offset < -0.05 || end > hostLen + 0.1) {
        openBad += 1;
        push(
          'error',
          'Openings',
          'OPEN_BOUNDS',
          `${o.type || 'opening'} ${o.width}×${o.height}' is outside host wall (${hostLen.toFixed(1)}').`,
        );
      } else if (sill + Number(o.height) > maxH + 0.05) {
        openBad += 1;
        push(
          'error',
          'Openings',
          'OPEN_HEIGHT',
          `${o.type || 'opening'} exceeds wall height at placement.`,
        );
      } else {
        openOk += 1;
      }

      if (isDoorOpening(o) && (!o.host || o.host === 'main')) {
        const ofr = (framing.openings || []).find((x) => x.openingId === o.id);
        if (ofr?.header) {
          push(
            'ok',
            'Openings',
            'DOOR_HEADER',
            `${o.type} ${o.width}' gets order header ${ofr.header.size} (${ofr.header.plies || 1}-ply stock).`,
          );
        }
      }
      if (isWindowOpening(o)) {
        const ofr = (framing.openings || []).find((x) => x.openingId === o.id);
        if (ofr?.header && ofr?.sill && ofr?.backing) {
          push(
            'ok',
            'Openings',
            'WINDOW_PACKAGE',
            `Window ${o.width}×${o.height}' — Header + Sill + Backing on order list.`,
          );
        }
      }
    }
    if (openOk && !openBad) {
      push(
        'ok',
        'Openings',
        'OPENINGS_PLACED_OK',
        `${openings.length} opening(s) within wall bounds and height.`,
      );
    }
  }

  // ── Lean-tos ──
  for (const lt of b.leanTos || []) {
    const depth = Number(lt.depth) || 0;
    const outer = Number(lt.eaveHeight) || 0;
    if (depth < 4) {
      push(
        'warn',
        'Lean-to',
        'LEAN_SHALLOW',
        `${lt.name || 'Lean-to'}: depth ${depth}' is very shallow.`,
      );
    } else if (depth > 0 && outer >= 8) {
      push(
        'ok',
        'Lean-to',
        'LEAN_OK',
        `${lt.name || 'Lean-to'}: ${depth}' deep, outer eave ${outer.toFixed(1)}', ${lt.enclosed === false || lt.enclosure === 'open' ? 'open' : 'enclosed'} — purlin roof package (not trusses).`,
      );
    }
    if (outer > H + 0.1) {
      push(
        'error',
        'Lean-to',
        'LEAN_TALLER_THAN_MAIN',
        `${lt.name || 'Lean-to'} outer eave ${outer}' exceeds main eave ${H}'.`,
      );
    }
  }
  if (!(b.leanTos || []).length) {
    push('ok', 'Lean-to', 'NO_LEAN', 'No lean-to attachments.');
  }

  // ── Open walls ──
  const openWalls = openWallList(b);
  if (openWalls.length) {
    push(
      'ok',
      'Open walls',
      'OPEN_WALLS',
      `Open wall(s): ${openWalls.join(', ')} — no girts/metal below eave on those faces.`,
    );
  }

  // ── Takeoff internal consistency ──
  if (takeoffItems && takeoffItems.length) {
    const postsTakeoff = takeoffItems
      .filter((i) => i.usage === 'Post' || i.usage === 'JambPost')
      .reduce((s, i) => s + (Number(i.qty) || 0), 0);
    const postsFraming = (framing.allPosts || []).length;
    if (postsTakeoff > 0 && postsFraming > 0) {
      if (Math.abs(postsTakeoff - postsFraming) <= 2) {
        push(
          'ok',
          'Takeoff',
          'POST_QTY_MATCH',
          `Takeoff posts ${postsTakeoff} ≈ framing stations ${postsFraming}.`,
        );
      } else {
        push(
          'warn',
          'Takeoff',
          'POST_QTY_GAP',
          `Takeoff posts ${postsTakeoff} vs framing ${postsFraming} — check lean share / jambs.`,
        );
      }
    }

    const hasTruss = takeoffItems.some((i) => i.usage === 'Truss' || i.usage === 'TrussGableEnd');
    if (hasTruss && W > 0) {
      push(
        'ok',
        'Takeoff',
        'TRUSS_LINES_OK',
        'Engineered truss lines present for main span (lean uses purlins, not trusses).',
      );
    }

    // Skirt boards cover closed perimeter roughly
    const skirtQty = takeoffItems
      .filter((i) => i.usage === 'SkirtBoard')
      .reduce((s, i) => s + (Number(i.qty) || 0) * (parseFloat(i.length) || 20), 0);
    if (skirtLf > 0 && skirtQty > 0) {
      if (skirtQty >= skirtLf - 5) {
        push(
          'ok',
          'Takeoff',
          'SKIRT_COVER_OK',
          `Skirt stock covers ${Math.round(skirtQty)} lf vs ${Math.round(skirtLf)} lf geometry.`,
        );
      } else {
        push(
          'warn',
          'Takeoff',
          'SKIRT_SHORT',
          `Skirt stock ${Math.round(skirtQty)} lf < geometry ${Math.round(skirtLf)} lf.`,
        );
      }
    }
  }

  // ── Summary ──
  let ok = 0;
  let warn = 0;
  let error = 0;
  for (const it of items) {
    if (it.level === 'ok') ok += 1;
    else if (it.level === 'warn') warn += 1;
    else if (it.level === 'error') error += 1;
  }

  return {
    items,
    summary: {
      ok,
      warn,
      error,
      pass: error === 0,
      total: items.length,
    },
  };
}

/**
 * Audit every building in a project.
 * @param {object} project
 * @param {object[]} [takeoffItems]
 */
export function auditProject(project, takeoffItems = null) {
  const buildings = project?.buildings || [];
  const byBuilding = buildings.map((b) => ({
    buildingId: b.id,
    buildingName: b.name || 'Building',
    ...auditBuilding(b, takeoffItems),
  }));
  const summary = byBuilding.reduce(
    (acc, b) => {
      acc.ok += b.summary.ok;
      acc.warn += b.summary.warn;
      acc.error += b.summary.error;
      acc.total += b.summary.total;
      return acc;
    },
    { ok: 0, warn: 0, error: 0, total: 0, pass: true },
  );
  summary.pass = summary.error === 0;
  return { byBuilding, summary };
}

/**
 * Human-readable checklist text.
 */
export function formatAuditReport(audit) {
  const lines = [
    `Construction self-check`,
    `Result: ${audit.summary.error === 0 ? 'PASS' : 'NEEDS ATTENTION'} — ${audit.summary.ok} ok · ${audit.summary.warn} warn · ${audit.summary.error} error`,
    '',
  ];
  const list = audit.items || audit.byBuilding?.[0]?.items || [];
  let cat = '';
  for (const it of list) {
    if (it.category !== cat) {
      cat = it.category;
      lines.push(`── ${cat} ──`);
    }
    const mark = it.level === 'ok' ? '✓' : it.level === 'warn' ? '!' : '✗';
    lines.push(`  ${mark} ${it.message}`);
  }
  return lines.join('\n');
}
