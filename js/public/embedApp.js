/**
 * PoleBarn Pro — public configurator embed (FIRST SLICE).
 *
 * Wires the form controls in public/embed.html to a public config object and a
 * read-only 3D viewer. The customer NEVER sees price, material lists, takeoff,
 * plan sheets, or any internal quoting field — this bundle imports none of that.
 *
 * Data flow:
 *   form controls  ──▶  publicConfig (js/public/publicConfig.js contract)
 *                  ──▶  publicConfigToBuildingPartial()
 *                  ──▶  createProject() / SceneView  (viewer only)
 *
 * "Request a quote" collects name / phone / email / zip and bundles them with
 * the public config plus four elevation screenshots (front/back/left/right).
 * handoffLead() always keeps a console + localStorage copy
 * (`polebarnpro:leads:<companyId>`, without image payloads) and, when a host
 * page asked for it, posts the record to `window.parent`. When a quote-email
 * endpoint is configured it POSTs specs + PNG attachments to email
 * support@webuild-structures.com (Cloudflare Worker + Resend). An optional
 * lead webhook (CRM) still receives the JSON record without images.
 *
 * Per-company chrome (title, brand strip, optional logo / accent) comes from
 * `public/company-config.json` keyed by companyId — see resolveCompanyBranding().
 */

import {
  defaultPublicConfig,
  defaultPublicLeanTo,
  defaultPublicOpening,
  validatePublicConfig,
  publicConfigToBuildingPartial,
  sanitizeCompanyId,
  PUBLIC_COLORS,
  PUBLIC_COLOR_CODES,
  PUBLIC_WALLS,
  PUBLIC_WALL_LABELS,
  PUBLIC_OPENING_TYPES,
  PUBLIC_OPENING_TYPE_KEYS,
  PUBLIC_OPENING_FACES,
  PUBLIC_OPENING_FACE_LABELS,
  PUBLIC_LIMITS,
  PUBLIC_SCHEMA_VERSION,
} from './publicConfig.js';

import { createProject } from '../domain/types.js?v=20260806f';

const $ = (id) => document.getElementById(id);

/* ───────────────────────────── boot ───────────────────────────── */

const params = new URLSearchParams(location.search);
const COMPANY_ID = sanitizeCompanyId(params.get('companyId') || 'demo');
const STORAGE_KEY = `polebarnpro:embed:${COMPANY_ID}`;
const LEADS_KEY = `polebarnpro:leads:${COMPANY_ID}`;

/** Working public config — always kept valid via validatePublicConfig(). */
let config = loadSavedConfig() || validatePublicConfig(defaultPublicConfig(COMPANY_ID)).config;

let scene = null;
let rebuildTimer = 0;

/** Active "tap a wall to drop this" draft, or null. Viewer-only UI state. */
let placeDraft = null;
let dragListTimer = 0;

/** Filled lazily by resolveLeadWebhook / resolveQuoteEmail / resolveCompanyBranding (must be above init()). */
let leadWebhookLookup;
let quoteEmailLookup;
let companyBrandingLookup;

init().catch((err) => {
  console.error('[embed] failed to start', err);
  const hint = document.querySelector('.viewer-hint');
  if (hint) hint.textContent = '3D preview failed: ' + ((err && (err.message || String(err))) || 'unknown');
});

async function init() {
  try {
    populateColorSelects();
    bindBuildingControls();
    bindColorControls();
    bindMetalAndConcrete();
    bindLeanTos();
    bindOpenings();
    bindQuoteDialog();

    const branding = await resolveCompanyBranding();
    applyCompanyBranding(branding);

    $('companyFoot').textContent = `Configurator ID: ${COMPANY_ID}`;
    syncFormFromConfig();

    await startViewer();
    bindViewerControls();
    try {
      applyConfigToViewer(true);
    } catch (err) {
      console.warn('[embed] applyConfigToViewer failed', err);
    }
    // Soft device hint only when SceneView constructed but WebGL did not come up.
    if (scene && !scene.webglOk) {
      const hint = document.querySelector('.viewer-hint');
      if (hint) {
        hint.textContent =
          '3D preview unavailable on this device — form and quote still work.';
      }
    }
    // Mobile browsers often report 0-height canvas on the first paint; force
    // resize on the next 1–2 frames so the lite WebGL view actually fills.
    if (scene?.webglOk) {
      requestAnimationFrame(() => {
        scene.resize?.();
        requestAnimationFrame(() => scene.resize?.());
      });
    }

    // Opt-in debug handle for manual / automated testing (?debug=1). Read-only
    // getters — no behaviour, nothing sensitive.
    if (params.get('debug') === '1') {
      window.__embed = {
        get scene() { return scene; },
        get config() { return config; },
        resolveLeadWebhook, // Promise<string|null> — check which endpoint is live
        resolveCompanyBranding, // Promise<branding> — displayName / logoUrl / accent
        buildLeadRecord: () => buildLeadRecord({ name: 'Test', phone: '000', email: 't@t', zip: '12345' }),
        captureElevations: () => captureElevationShots(),
        resolveQuoteEmail,
      };
    }
  } catch (err) {
    console.error('[embed] failed to start', err);
    const hint = document.querySelector('.viewer-hint');
    if (hint) hint.textContent = '3D preview failed: ' + ((err && (err.message || String(err))) || 'unknown');
  }
}

async function startViewer() {
  const canvas = $('viewport');
  // Wait for layout — Safari often reports 0×0 canvas on the first tick.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const parent = canvas?.parentElement;
    const w = Math.max(parent?.clientWidth || 0, canvas?.clientWidth || 0, 320);
    const h = Math.max(parent?.clientHeight || 0, canvas?.clientHeight || 0, 240);
    if (canvas) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    }
  } catch (_) {
    /* non-fatal */
  }
  try {
    const { SceneView } = await import('../render/scene.js?v=20260909b');
    // lite: true keeps phone WebGL from OOMing (no shadows / env map / high-performance).
    scene = new SceneView(canvas, {
      lite: true,
      onWallClick: (data) => placeOpeningFromViewer(data),
      onOpeningMove: (data) => dragOpeningFromViewer(data),
      onOpeningClick: (data) => flashOpeningRow(data?.openingId, false),
    });
    scene.showFraming = false;
    scene.showMetal = true;
    if (!scene.webglOk) {
      const hint = document.querySelector('.viewer-hint');
      if (hint) {
        hint.textContent =
          '3D preview unavailable on this device — form and quote still work.';
      }
    }
  } catch (err) {
    console.warn('[embed] 3D engine unavailable', err);
    const hint = document.querySelector('.viewer-hint');
    if (hint) {
      const msg = (err && (err.message || String(err))) || 'unknown error';
      hint.textContent = '3D preview failed: ' + msg;
    }
  }
}

function bindViewerControls() {
  const recenter = $('recenterBtn');
  const reset = $('resetViewBtn');
  if (recenter) {
    recenter.addEventListener('click', () => {
      if (!scene) return;
      scene.frameAll?.();
    });
  }
  if (reset) {
    reset.addEventListener('click', () => {
      if (!scene) return;
      scene.heroShot?.();
    });
  }
}

/* ─────────────────────── viewer update ─────────────────────── */

function applyConfigToViewer(immediate = false) {
  persistConfig();
  renderWarnings();
  if (!scene) return;

  clearTimeout(rebuildTimer);
  const run = () => {
    try {
      const project = createProject({
        customer: 'Website visitor',
        project: `${config.building.width}x${config.building.length}`,
        buildings: [publicConfigToBuildingPartial(config)],
      });
      scene.setProject(project);
      scene.resize?.();
      if (immediate) scene.heroShot?.();
    } catch (err) {
      console.warn('[embed] viewer update failed', err);
    }
  };
  if (immediate) run();
  else rebuildTimer = setTimeout(run, 120);
}

function renderWarnings() {
  const { warnings } = validatePublicConfig(config);
  const el = $('warnings');
  if (!warnings.length) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = warnings.join('\n');
}

/* ─────────────────────── building controls ─────────────────────── */

function bindBuildingControls() {
  bindNumber('width', (v) => (config.building.width = v));
  bindNumber('length', (v) => (config.building.length = v));
  bindNumber('eaveHeight', (v) => (config.building.eaveHeight = v));
  bindNumber('pitch', (v) => (config.building.pitch = v));
  $('roofStyle').addEventListener('change', (e) => {
    config.building.roofStyle = e.target.value;
    commit();
  });
}

function bindColorControls() {
  for (const [id, key] of [
    ['wallColor', 'wall'],
    ['roofColor', 'roof'],
    ['trimColor', 'trim'],
    ['wainscotColor', 'wainscot'],
  ]) {
    $(id).addEventListener('change', (e) => {
      config.colors[key] = e.target.value;
      if (key === 'wainscot') syncWainscotHeightVisibility();
      commit();
    });
  }
  bindNumber('wainscotHeight', (v) => (config.colors.wainscotHeightFt = v));
}

function bindMetalAndConcrete() {
  $('metalGauge').addEventListener('change', (e) => {
    config.metalGauge = e.target.value;
    commit();
  });
  $('concreteEnabled').addEventListener('change', (e) => {
    config.concrete.enabled = e.target.checked;
    $('concreteThickWrap').hidden = !e.target.checked;
    commit();
  });
  bindNumber('concreteThickness', (v) => (config.concrete.thicknessIn = v));
}

/* ─────────────────────── lean-tos ─────────────────────── */

function bindLeanTos() {
  $('addLean').addEventListener('click', () => {
    config.leanTos.push(defaultPublicLeanTo({ wall: 'left' }));
    commit();
    renderLeanList();
  });
}

function renderLeanList() {
  const host = $('leanList');
  host.innerHTML = '';
  config.leanTos.forEach((lt, i) => {
    const item = el('div', 'list-item');
    item.innerHTML = `
      <div class="list-head">
        <strong>Lean-to ${i + 1}</strong>
        <button type="button" class="link" data-remove>Remove</button>
      </div>
      <div class="row">
        <div class="field">
          <label>Wall</label>
          ${wallSelect(lt.wall, 'wall')}
        </div>
        <div class="field">
          <label>Depth (ft)</label>
          <input type="number" data-k="depth" min="4" max="40" step="1" value="${lt.depth}" />
        </div>
        <div class="field">
          <label>Length (ft, 0 = full)</label>
          <input type="number" data-k="length" min="0" max="300" step="1" value="${lt.length}" />
        </div>
        <div class="field">
          <label>Offset (ft)</label>
          <input type="number" data-k="offset" min="0" max="300" step="1" value="${lt.offset}" />
        </div>
        <div class="field">
          <label>Roof pitch (x/12)</label>
          <input type="number" data-k="pitch" min="0.5" max="12" step="0.5" value="${lt.pitch}" />
        </div>
        <div class="field">
          <label>Outer eave (ft, blank = auto)</label>
          <input type="number" data-k="eaveHeight" min="6" max="20" step="0.5" value="${lt.eaveHeight ?? ''}" />
        </div>
        <div class="field full inline">
          <input type="checkbox" data-k="enclosed" ${lt.enclosed ? 'checked' : ''} id="lean-enc-${i}" />
          <label for="lean-enc-${i}" style="font-size:14px;color:var(--text)">Enclosed (walls &amp; girts)</label>
        </div>
      </div>
    `;

    item.querySelector('[data-remove]').addEventListener('click', () => {
      config.leanTos.splice(i, 1);
      commit();
      renderLeanList();
      // A removed lean-to may have hosted openings — validate demoted them.
      renderOpeningList();
    });

    item.querySelectorAll('[data-k]').forEach((input) => {
      input.addEventListener('change', () => {
        const k = input.dataset.k;
        if (k === 'enclosed') lt.enclosed = input.checked;
        else if (k === 'eaveHeight') lt.eaveHeight = input.value === '' ? null : Number(input.value);
        else lt[k] = Number(input.value);
        config.leanTos[i] = defaultPublicLeanTo(lt);
        commit();
        // Enclosure/wall changes affect where openings can live.
        renderOpeningList();
      });
    });

    item.querySelector('[data-sel="wall"]').addEventListener('change', (e) => {
      lt.wall = e.target.value;
      config.leanTos[i] = defaultPublicLeanTo(lt);
      commit();
      renderOpeningList();
    });

    host.appendChild(item);
  });
}

/* ─────────────────────── openings ─────────────────────── */

function bindOpenings() {
  $('addOpening').addEventListener('click', () => {
    if (!openingCapacityLeft()) return;
    config.openings.push(defaultPublicOpening({ type: 'window', wall: 'front' }));
    commit();
    renderOpeningList();
    flashOpeningRow(config.openings[config.openings.length - 1].id);
  });

  document.querySelectorAll('[data-add-type]').forEach((btn) => {
    btn.addEventListener('click', () => enterPlaceMode(btn.dataset.addType));
  });

  $('placeCancel').addEventListener('click', exitViewerEditMode);
  $('moveOpeningToggle').addEventListener('click', toggleMoveMode);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && viewerReady() && scene.mode !== 'orbit') exitViewerEditMode();
  });
}

/** The 3D viewer is present AND actually rendering (WebGL up). */
function viewerReady() {
  return !!(scene && scene.webglOk);
}

/** True if another opening can be added; otherwise flash a limit hint. */
function openingCapacityLeft() {
  if (config.openings.length < PUBLIC_LIMITS.opening.maxCount) return true;
  showBanner(`You can add up to ${PUBLIC_LIMITS.opening.maxCount} openings.`, false);
  setTimeout(exitViewerEditMode, 1600);
  return false;
}

/* ── viewer edit modes ── */

/**
 * Enter "tap a wall to drop a <type>" mode. Falls back to a plain list add when
 * the 3D viewer is unavailable (no WebGL).
 */
function enterPlaceMode(type) {
  const t = PUBLIC_OPENING_TYPES[type] ? type : 'window';
  const def = PUBLIC_OPENING_TYPES[t];

  if (!viewerReady()) {
    // No 3D view to tap — just add it to the list.
    if (!openingCapacityLeft()) return;
    config.openings.push(defaultPublicOpening({ type: t, wall: 'front' }));
    commit();
    renderOpeningList();
    flashOpeningRow(config.openings[config.openings.length - 1].id);
    return;
  }

  // Toggle off if the same chip is tapped again.
  if (scene.mode === 'place-opening' && placeDraft && placeDraft.type === t) {
    exitViewerEditMode();
    return;
  }
  if (!openingCapacityLeft()) return;

  placeDraft = {
    type: t,
    width: def.defaultW,
    height: def.defaultH,
    sillHeight: def.defaultSill,
  };
  scene.setPlaceOpeningDraft(placeDraft);
  scene.setMode('place-opening');
  $('moveOpeningToggle').classList.remove('active');
  setPaletteActive(t);
  showBanner(`Tap a wall to add a ${def.label.toLowerCase()}`, true);
}

function toggleMoveMode() {
  if (!viewerReady()) {
    showBanner('The 3D view is needed to drag openings. Edit the offset in the list instead.', false);
    return;
  }
  if (scene.mode === 'move-opening') {
    exitViewerEditMode();
    return;
  }
  if (!config.openings.length) {
    showBanner('Add a window or door first, then drag it.', false);
    setTimeout(exitViewerEditMode, 1600);
    return;
  }
  placeDraft = null;
  scene.setPlaceOpeningDraft(null);
  scene.setMode('move-opening');
  setPaletteActive(null);
  $('moveOpeningToggle').classList.add('active');
  showBanner('Drag an opening along its wall. Release to set the position.', true);
}

function exitViewerEditMode() {
  placeDraft = null;
  if (scene) {
    scene.setPlaceOpeningDraft(null);
    scene.setMode('orbit');
  }
  setPaletteActive(null);
  $('moveOpeningToggle').classList.remove('active');
  $('placeBanner').hidden = true;
}

function setPaletteActive(type) {
  document.querySelectorAll('[data-add-type]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.addType === type);
  });
}

let bannerHideTimer = 0;
function showBanner(text, keepOpen) {
  $('placeBannerText').textContent = text;
  $('placeBanner').hidden = false;
  clearTimeout(bannerHideTimer);
  if (keepOpen) return;
  // Transient notice: hide it again unless we're mid edit-mode.
  bannerHideTimer = setTimeout(() => {
    if (!scene || scene.mode === 'orbit') $('placeBanner').hidden = true;
  }, 2200);
}

/* ── viewer → publicConfig ── */

/** A wall was tapped in place-opening mode. */
function placeOpeningFromViewer(data) {
  // Main walls: always OK. Lean-to walls: only when the lean-to is enclosed.
  const host = data.host && data.host !== 'main' ? data.host : 'main';
  if (host !== 'main') {
    const lean = config.leanTos.find((lt) => lt.id === host);
    if (!lean) {
      showBanner('That lean-to isn’t ready yet — try again in a moment.', false);
      return;
    }
    if (lean.enclosed === false) {
      showBanner('Open lean-tos have no walls. Tick “Enclosed” on the lean-to to add doors or windows.', false);
      return;
    }
  }
  const draft = placeDraft || {};
  const op = defaultPublicOpening({
    type: PUBLIC_OPENING_TYPES[data.type] ? data.type : draft.type || 'window',
    host,
    face: host !== 'main' ? data.face || 'outer' : undefined,
    wall: data.wall,
    width: data.width ?? draft.width,
    height: data.height ?? draft.height,
    sillHeight: data.sillHeight ?? draft.sillHeight,
    offset: data.offset,
  });
  config.openings.push(op);
  if (scene) scene.selectedOpeningId = op.id;
  commit();
  renderOpeningList();
  exitViewerEditMode();
  flashOpeningRow(op.id);
}

/** An existing opening is being dragged along its wall. */
function dragOpeningFromViewer(data) {
  const i = config.openings.findIndex((o) => o.id === data.openingId);
  if (i < 0) return;
  config.openings[i] = defaultPublicOpening({
    ...config.openings[i],
    offset: data.offset,
  });

  if (data.live) {
    // The viewer moves its own mesh during the drag — just keep the form list
    // roughly in step without a full scene rebuild.
    clearTimeout(dragListTimer);
    dragListTimer = setTimeout(renderOpeningList, 120);
    return;
  }
  commit(); // drop: re-validate, persist, rebuild viewer to the committed offset
  renderOpeningList();
}

function flashOpeningRow(id, scroll = true) {
  if (!id) return;
  clearTimeout(dragListTimer);
  renderOpeningList();
  const row = document.querySelector(`#openingList .list-item[data-oid="${id}"]`);
  if (!row) return;
  if (scroll) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  row.classList.remove('flash');
  void row.offsetWidth; // restart the animation
  row.classList.add('flash');
}

function renderOpeningList() {
  const host = $('openingList');
  host.innerHTML = '';
  config.openings.forEach((op, i) => {
    const item = el('div', 'list-item');
    item.dataset.oid = op.id;
    const typeOpts = PUBLIC_OPENING_TYPE_KEYS.map(
      (t) => `<option value="${t}" ${t === op.type ? 'selected' : ''}>${PUBLIC_OPENING_TYPES[t].label}</option>`,
    ).join('');
    item.innerHTML = `
      <div class="list-head">
        <strong>${PUBLIC_OPENING_TYPES[op.type]?.label || 'Opening'} ${i + 1}
          <span class="loc-note">· ${openingLocationLabel(op)}</span></strong>
        <button type="button" class="link" data-remove>Remove</button>
      </div>
      <div class="row">
        <div class="field">
          <label>Type</label>
          <select data-sel="type">${typeOpts}</select>
        </div>
        <div class="field">
          <label>Wall / face</label>
          ${openingLocationSelect(op)}
        </div>
        <div class="field">
          <label>Width (ft)</label>
          <input type="number" data-k="width" min="1" max="24" step="0.5" value="${op.width}" />
        </div>
        <div class="field">
          <label>Height (ft)</label>
          <input type="number" data-k="height" min="1" max="16" step="0.5" value="${op.height}" />
        </div>
        <div class="field">
          <label>Offset from left (ft)</label>
          <input type="number" data-k="offset" min="0" max="300" step="0.5" value="${op.offset}" />
        </div>
        <div class="field">
          <label>Sill height (ft)</label>
          <input type="number" data-k="sillHeight" min="0" max="18" step="0.5" value="${op.sillHeight}" />
        </div>
      </div>
    `;

    item.querySelector('[data-remove]').addEventListener('click', () => {
      config.openings.splice(i, 1);
      commit();
      renderOpeningList();
    });

    item.querySelector('[data-sel="type"]').addEventListener('change', (e) => {
      // Re-seed size defaults for the new type, keep id / location / offset.
      config.openings[i] = defaultPublicOpening({
        id: op.id,
        type: e.target.value,
        host: op.host,
        face: op.face,
        wall: op.wall,
        offset: op.offset,
      });
      commit();
      renderOpeningList();
    });

    item.querySelector('[data-sel="location"]').addEventListener('change', (e) => {
      // Value is "<host>:<seg>" — host 'main' → seg is a main wall; otherwise
      // host is a lean-to id and seg is the lean-to face.
      const raw = e.target.value;
      const sep = raw.indexOf(':');
      const nextHost = raw.slice(0, sep);
      const seg = raw.slice(sep + 1);
      if (nextHost === 'main') {
        config.openings[i] = defaultPublicOpening({ ...op, host: 'main', wall: seg, face: undefined });
      } else {
        const lean = config.leanTos.find((lt) => lt.id === nextHost);
        config.openings[i] = defaultPublicOpening({
          ...op,
          host: nextHost,
          face: seg,
          wall: lean ? lean.wall : op.wall,
        });
      }
      commit();
      renderOpeningList();
    });

    item.querySelectorAll('[data-k]').forEach((input) => {
      input.addEventListener('change', () => {
        op[input.dataset.k] = Number(input.value);
        config.openings[i] = defaultPublicOpening(op);
        commit();
      });
    });

    host.appendChild(item);
  });
}

/* ─────────────────────── request quote (lead handoff) ─────────────────────── */

/** US ZIP: 12345 or 12345-6789 */
function isValidZip(zip) {
  return /^\d{5}(-\d{4})?$/.test(String(zip || '').trim());
}

/**
 * Capture four elevation PNGs from the live viewer (phone-safe toDataURL).
 * Returns {} when WebGL is unavailable — quote still proceeds without images.
 */
async function captureElevationShots() {
  if (!scene?.webglOk || typeof scene.captureElevationShots !== 'function') {
    return {};
  }
  try {
    return (await scene.captureElevationShots({ maxWidth: 1280, maxHeight: 800 })) || {};
  } catch (err) {
    console.warn('[embed] elevation capture failed', err);
    return {};
  }
}

/** Specs summary for email body / CRM paste (no prices). */
function formatBuildingSpecs(publicConfig) {
  const b = publicConfig?.building || {};
  const c = publicConfig?.colors || {};
  const lines = [
    `Size: ${b.width}' W × ${b.length}' L × ${b.eaveHeight}' eave`,
    `Roof: ${b.roofStyle || 'gable'} · ${b.pitch}/12 pitch`,
    `Colors: wall ${c.wall || '—'} · roof ${c.roof || '—'} · trim ${c.trim || '—'}`,
    `Metal gauge: ${publicConfig?.metalGauge || '—'}`,
  ];
  const concrete = publicConfig?.concrete;
  if (concrete?.enabled) {
    lines.push(`Concrete slab: yes · ${concrete.thicknessIn || 4}"`);
  } else {
    lines.push('Concrete slab: no');
  }
  const leans = Array.isArray(publicConfig?.leanTos) ? publicConfig.leanTos : [];
  if (leans.length) {
    lines.push(
      'Lean-tos: ' +
        leans
          .map(
            (lt) =>
              `${lt.wall} ${lt.depth}' deep` +
              (lt.length ? ` × ${lt.length}'` : '') +
              (lt.enclosed ? ' enclosed' : ' open'),
          )
          .join('; '),
    );
  } else {
    lines.push('Lean-tos: none');
  }
  const openings = Array.isArray(publicConfig?.openings) ? publicConfig.openings : [];
  if (openings.length) {
    lines.push(
      'Openings: ' +
        openings
          .map(
            (o) =>
              `${o.type || 'opening'} ${o.width}'×${o.height}' on ${o.wall}` +
              (o.offset != null ? ` @ ${o.offset}'` : ''),
          )
          .join('; '),
    );
  } else {
    lines.push('Openings: none');
  }
  return lines.join('\n');
}

function bindQuoteDialog() {
  const dlg = $('quoteDialog');
  let pendingRecord = null;
  let closeTimer = null;

  function clearCloseTimer() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function resetQuoteUi() {
    clearCloseTimer();
    pendingRecord = null;
    $('quoteSent').hidden = true;
    $('quoteError').hidden = true;
    const handoff = $('quoteHandoff');
    if (handoff) handoff.hidden = true;
    const copied = $('quoteCopied');
    if (copied) copied.hidden = true;
    const hint = $('quoteCopyHint');
    if (hint) hint.hidden = true;
    const formFields = $('quoteFormFields');
    if (formFields) formFields.hidden = false;
    const actions = $('quoteFormActions');
    if (actions) actions.hidden = false;
  }

  function showCopyLeadUi({ keepOpen, hint, hintText }) {
    const handoff = $('quoteHandoff');
    if (!handoff) return;
    handoff.hidden = false;
    const hintEl = $('quoteCopyHint');
    if (hintEl) {
      hintEl.hidden = !hint;
      if (hint) {
        hintEl.textContent =
          hintText ||
          'Paste into Pole Barn Pro → Website Leads → Paste JSON.';
      }
    }
    const copied = $('quoteCopied');
    if (copied) copied.hidden = true;
    if (!keepOpen) {
      clearCloseTimer();
      closeTimer = setTimeout(() => dlg.close(), 1800);
    }
  }

  async function copyPendingLeadJson() {
    if (!pendingRecord) return;
    const json = JSON.stringify(pendingRecord, null, 2);
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(json);
        ok = true;
      }
    } catch (_) {}
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = json;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) {
        ok = false;
      }
    }
    if (!ok) {
      window.prompt('Copy lead JSON:', json);
      return;
    }
    const copied = $('quoteCopied');
    if (copied) {
      copied.hidden = false;
      setTimeout(() => {
        if (copied) copied.hidden = true;
      }, 1600);
    }
  }

  $('requestQuoteBtn').addEventListener('click', () => {
    resetQuoteUi();
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  });
  $('quoteCancel').addEventListener('click', () => {
    clearCloseTimer();
    dlg.close();
  });
  $('quoteDone')?.addEventListener('click', () => {
    clearCloseTimer();
    dlg.close();
  });
  $('quoteCopyJson')?.addEventListener('click', () => {
    copyPendingLeadJson();
  });

  $('quoteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = $('quoteSubmit');
    if (submitBtn.disabled) return;

    const lead = {
      name: $('leadName').value.trim(),
      phone: $('leadPhone').value.trim(),
      email: $('leadEmail').value.trim(),
      zip: $('leadZip').value.trim(),
    };
    if (!lead.name || !lead.phone || !lead.email || !lead.zip) return;
    if (!isValidZip(lead.zip)) {
      const zipEl = $('leadZip');
      if (zipEl) {
        zipEl.setCustomValidity('Enter a valid US zip (12345 or 12345-6789).');
        zipEl.reportValidity();
        zipEl.setCustomValidity('');
      }
      return;
    }

    $('quoteSent').hidden = true;
    $('quoteError').hidden = true;
    const handoff = $('quoteHandoff');
    if (handoff) handoff.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Capturing views…';

    let elevations = {};
    try {
      elevations = await captureElevationShots();
    } catch (_) {
      elevations = {};
    }

    const record = buildLeadRecord(lead);
    pendingRecord = record;
    submitBtn.textContent = 'Sending…';

    try {
      const result = await handoffLead(record, elevations);
      $('quoteSent').hidden = false;
      const emailed = !!(result && result.email);
      const usedWebhook = !!(result && result.webhook);
      if (emailed || usedWebhook) {
        showCopyLeadUi({ keepOpen: false, hint: false });
      } else {
        const formFields = $('quoteFormFields');
        if (formFields) formFields.hidden = true;
        const actions = $('quoteFormActions');
        if (actions) actions.hidden = true;
        showCopyLeadUi({
          keepOpen: true,
          hint: true,
          hintText: result?.emailSkipped
            ? 'Quote saved on this device. Email delivery needs the quote-email endpoint (see PR / EMBED_HOSTING). Copy JSON for Website Leads.'
            : 'Paste into Pole Barn Pro → Website Leads → Paste JSON.',
        });
      }
    } catch (err) {
      console.warn('[embed] quote delivery failed', err);
      $('quoteError').hidden = false;
      const formFields = $('quoteFormFields');
      if (formFields) formFields.hidden = true;
      const actions = $('quoteFormActions');
      if (actions) actions.hidden = true;
      showCopyLeadUi({ keepOpen: true, hint: true });
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send';
    }
  });
}

function buildLeadRecord(lead) {
  const { config: clean } = validatePublicConfig(config);
  return {
    schemaVersion: PUBLIC_SCHEMA_VERSION,
    companyId: COMPANY_ID,
    submittedAt: new Date().toISOString(),
    source: 'public-configurator-embed',
    pageUrl: location.href,
    lead: {
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      zip: lead.zip,
    },
    publicConfig: clean, // guaranteed free of price / SKU / takeoff / CRM fields
    specsText: formatBuildingSpecs(clean),
  };
}

/**
 * Lead handoff.
 *
 * Always: console.log + append to localStorage `polebarnpro:leads:<companyId>` +
 * (when `?parentOrigin=` is set and we are iframed) postMessage to the host page.
 * Elevation PNGs are NEVER written to localStorage (quota) or postMessage.
 *
 * When a quote-email endpoint is configured (see resolveQuoteEmail), POST the
 * record + elevation data URLs so the worker can email support@ with attachments.
 * When a lead webhook is configured (see resolveLeadWebhook), also POST the JSON
 * record (no images) for CRM / Zapier.
 */
async function handoffLead(record, elevations = {}) {
  console.log('[embed] LEAD:', record);
  try {
    const prev = JSON.parse(localStorage.getItem(LEADS_KEY) || '[]');
    prev.push(record);
    localStorage.setItem(LEADS_KEY, JSON.stringify(prev));
  } catch (err) {
    console.warn('[embed] could not store lead locally', err);
  }

  const parentOrigin = params.get('parentOrigin');
  if (parentOrigin && window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({ type: 'polebarnpro:lead', record }, parentOrigin);
    } catch (err) {
      console.warn('[embed] postMessage to parent failed', err);
    }
  }

  const result = { webhook: false, email: false, emailSkipped: false };

  const emailEndpoint = await resolveQuoteEmail();
  const webhookEndpoint = await resolveLeadWebhook();

  if (emailEndpoint) {
    const elevationKeys = ['front', 'back', 'left', 'right'].filter(
      (k) => elevations && typeof elevations[k] === 'string' && elevations[k].startsWith('data:image'),
    );
    // Delivery > perfect: still send the quote even if some elevations are missing/blank.
    if (elevationKeys.length < 4) {
      console.warn(
        '[embed] fewer than 4 valid elevation PNGs; sending quote anyway',
        elevationKeys.length,
        elevationKeys,
      );
    }
    const payload = {
      ...record,
      elevations: Object.fromEntries(elevationKeys.map((k) => [k, elevations[k]])),
      to: 'support@webuild-structures.com',
    };
    const res = await fetch(emailEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Quote email endpoint responded ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    result.email = true;
  } else {
    result.emailSkipped = true;
  }

  // CRM / Zapier webhook — separate from email; never attach huge PNGs.
  if (webhookEndpoint && webhookEndpoint !== emailEndpoint) {
    const res = await fetch(webhookEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(`Lead webhook responded ${res.status}`);
    result.webhook = true;
  } else if (webhookEndpoint && webhookEndpoint === emailEndpoint) {
    // Same URL already handled as email endpoint.
    result.webhook = result.email;
  }

  // If neither email nor webhook is configured, local + copy-JSON path is OK
  // (phone preview before secrets are wired). Do not throw.
  return result;
}

/** True only for a well-formed absolute https:// URL. */
function isHttpsUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * Resolve the lead webhook URL, first source wins:
 *   1. `?leadWebhook=` query param  (must be an absolute https URL)
 *   2. `window.__PBP_LEAD_WEBHOOK__` global  (host page / deploy injects it)
 *   3. optional `public/lead-config.json` — `{ "<companyId>": { "webhookUrl" },
 *      "default": { "webhookUrl" } }`. Kept out of git; ship the .example file.
 * Returns a Promise<string|null>. The lookup (including the fetch) runs once.
 */
function resolveLeadWebhook() {
  if (leadWebhookLookup) return leadWebhookLookup;
  leadWebhookLookup = (async () => {
    const fromQuery = params.get('leadWebhook');
    if (isHttpsUrl(fromQuery)) return fromQuery;

    if (isHttpsUrl(window.__PBP_LEAD_WEBHOOK__)) return window.__PBP_LEAD_WEBHOOK__;

    try {
      const res = await fetch(new URL('lead-config.json', location.href), { cache: 'no-store' });
      if (res.ok) {
        const map = await res.json();
        const entry = (map && (map[COMPANY_ID] || map.default)) || null;
        if (entry && isHttpsUrl(entry.webhookUrl)) return entry.webhookUrl;
      }
    } catch (_) {
      /* no lead-config.json deployed — fine, fall through to null */
    }
    return null;
  })();
  return leadWebhookLookup;
}

/**
 * Resolve the quote → email endpoint (Cloudflare Worker / Resend proxy).
 * First source wins:
 *   1. `?quoteEmail=` query param
 *   2. `window.__PBP_QUOTE_EMAIL_URL__`
 *   3. `public/lead-config.json` → `quoteEmailUrl` on company or default
 * Returns Promise<string|null>.
 */
function resolveQuoteEmail() {
  if (quoteEmailLookup) return quoteEmailLookup;
  quoteEmailLookup = (async () => {
    const fromQuery = params.get('quoteEmail');
    if (isHttpsUrl(fromQuery)) return fromQuery;

    if (isHttpsUrl(window.__PBP_QUOTE_EMAIL_URL__)) return window.__PBP_QUOTE_EMAIL_URL__;

    try {
      const res = await fetch(new URL('lead-config.json', location.href), { cache: 'no-store' });
      if (res.ok) {
        const map = await res.json();
        const entry = (map && (map[COMPANY_ID] || map.default)) || null;
        if (entry && isHttpsUrl(entry.quoteEmailUrl)) return entry.quoteEmailUrl;
      }
    } catch (_) {
      /* optional */
    }
    return null;
  })();
  return quoteEmailLookup;
}


/* ─────────────────────── company branding chrome ─────────────────────── */

const DEFAULT_BRANDING = {
  displayName: 'Design Your Building',
  logoUrl: null,
  accent: null,
};


/**
 * Resolve per-company embed chrome from `public/company-config.json`:
 *   { "<companyId>": { displayName, logoUrl?, accent? }, "default": { … } }
 * Falls back to DEFAULT_BRANDING when the file is missing or the entry is thin.
 * logoUrl / accent are only accepted when they look safe (https image URL / CSS color).
 */
function resolveCompanyBranding() {
  if (companyBrandingLookup) return companyBrandingLookup;
  companyBrandingLookup = (async () => {
    try {
      const res = await fetch(new URL('company-config.json', location.href), { cache: 'no-store' });
      if (!res.ok) return { ...DEFAULT_BRANDING };
      const map = await res.json();
      const entry = (map && (map[COMPANY_ID] || map.default)) || null;
      if (!entry || typeof entry !== 'object') return { ...DEFAULT_BRANDING };
      const displayName =
        typeof entry.displayName === 'string' && entry.displayName.trim()
          ? entry.displayName.trim()
          : DEFAULT_BRANDING.displayName;
      const logoUrl = isHttpsUrl(entry.logoUrl) ? entry.logoUrl.trim() : null;
      const accent = isCssColor(entry.accent) ? entry.accent.trim() : null;
      return { displayName, logoUrl, accent };
    } catch (_) {
      /* no company-config.json deployed — use defaults */
      return { ...DEFAULT_BRANDING };
    }
  })();
  return companyBrandingLookup;
}

/** True for a simple CSS color token safe to assign to --accent (hex / rgb / named). */
function isCssColor(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const v = value.trim();
  // Reject urls(), expressions, and anything that could escape a CSS declaration.
  if (/[;{}]|url\s*\(|expression|@import/i.test(v)) return false;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return true;
  if (/^rgba?\(/i.test(v) || /^hsla?\(/i.test(v)) return true;
  // Short named colors only (no spaces / punctuation beyond hyphen).
  if (/^[a-z]{3,20}$/i.test(v)) return true;
  return false;
}

/** Apply branding to document title, brand strip, and optional --accent. */
function applyCompanyBranding(branding) {
  const name = branding?.displayName || DEFAULT_BRANDING.displayName;
  document.title = name;

  const strip = $('brandStrip');
  const nameEl = $('brandName');
  const logoEl = $('brandLogo');
  if (nameEl) nameEl.textContent = name;
  if (logoEl) {
    if (branding?.logoUrl) {
      logoEl.src = branding.logoUrl;
      logoEl.alt = name;
      logoEl.hidden = false;
      logoEl.onerror = () => {
        logoEl.hidden = true;
        logoEl.removeAttribute('src');
      };
    } else {
      logoEl.hidden = true;
      logoEl.removeAttribute('src');
    }
  }
  if (strip) strip.hidden = false;

  if (branding?.accent) {
    document.documentElement.style.setProperty('--accent', branding.accent);
  }

  // Keep the form h1 in sync when branding is more specific than the generic title.
  const titleEl = $('title');
  if (titleEl) {
    titleEl.textContent = name;
  }
}

/* ─────────────────────── form <-> config sync ─────────────────────── */

function syncFormFromConfig() {
  // Page/form title set by applyCompanyBranding(); leave h1 alone here.
  setVal('width', config.building.width);
  setVal('length', config.building.length);
  setVal('eaveHeight', config.building.eaveHeight);
  setVal('pitch', config.building.pitch);
  setVal('roofStyle', config.building.roofStyle);

  setVal('wallColor', config.colors.wall);
  setVal('roofColor', config.colors.roof);
  setVal('trimColor', config.colors.trim);
  setVal('wainscotColor', config.colors.wainscot);
  for (const id of ['wallColor', 'roofColor', 'trimColor', 'wainscotColor']) syncColorUi(id);
  setVal('wainscotHeight', config.colors.wainscotHeightFt);
  syncWainscotHeightVisibility();

  setVal('metalGauge', config.metalGauge);

  $('concreteEnabled').checked = config.concrete.enabled;
  $('concreteThickWrap').hidden = !config.concrete.enabled;
  setVal('concreteThickness', config.concrete.thicknessIn);

  renderLeanList();
  renderOpeningList();
}

function syncWainscotHeightVisibility() {
  $('wainscotHeightWrap').hidden = ($('wainscotColor').value || 'NONE') === 'NONE';
}

/** Re-validate, keep form labels honest, refresh viewer. */
function commit() {
  config = validatePublicConfig(config).config;
  applyConfigToViewer();
}

/* ─────────────────────── persistence ─────────────────────── */

function persistConfig() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (_) {
    /* private mode / quota — non-fatal */
  }
}

function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validatePublicConfig(JSON.parse(raw)).config;
  } catch (_) {
    return null;
  }
}

/* ─────────────────────── small DOM helpers ─────────────────────── */

function populateColorSelects() {
  const colorOpts = PUBLIC_COLOR_CODES.map(
    (code) => `<option value="${code}">${PUBLIC_COLORS[code].label}</option>`,
  ).join('');
  for (const id of ['wallColor', 'roofColor', 'trimColor']) {
    $(id).innerHTML = colorOpts;
    enhanceColorField(id, false);
  }
  $('wainscotColor').innerHTML =
    `<option value="NONE">None</option>` + colorOpts;
  enhanceColorField('wainscotColor', true);
}

/** Swatch + chip strip so phone users see real colors, not just names. */
function enhanceColorField(selectId, allowNone) {
  const sel = $(selectId);
  if (!sel || sel.dataset.colorUi === '1') return;
  sel.dataset.colorUi = '1';
  const wrap = document.createElement('div');
  wrap.className = 'color-field';
  const sw = document.createElement('span');
  sw.className = 'swatch';
  sw.setAttribute('aria-hidden', 'true');
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sw);
  wrap.appendChild(sel);

  const chips = document.createElement('div');
  chips.className = 'color-chips';
  chips.setAttribute('role', 'listbox');
  chips.setAttribute('aria-label', sel.previousElementSibling?.textContent || 'Color');
  const codes = allowNone ? ['NONE', ...PUBLIC_COLOR_CODES] : PUBLIC_COLOR_CODES;
  for (const code of codes) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'option');
    btn.dataset.code = code;
    btn.title = code === 'NONE' ? 'None' : PUBLIC_COLORS[code].label;
    btn.setAttribute('aria-label', btn.title);
    btn.style.background = code === 'NONE'
      ? 'repeating-linear-gradient(45deg,#ccc 0 4px,#eee 4px 8px)'
      : PUBLIC_COLORS[code].hex;
    btn.addEventListener('click', () => {
      sel.value = code;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      syncColorUi(selectId);
    });
    chips.appendChild(btn);
  }
  wrap.parentNode.insertBefore(chips, wrap.nextSibling);

  sel.addEventListener('change', () => syncColorUi(selectId));
  syncColorUi(selectId);
}

function syncColorUi(selectId) {
  const sel = $(selectId);
  if (!sel) return;
  const code = sel.value;
  const wrap = sel.closest('.color-field');
  const sw = wrap?.querySelector('.swatch');
  if (sw) {
    sw.style.background = code === 'NONE'
      ? 'repeating-linear-gradient(45deg,#ccc 0 4px,#eee 4px 8px)'
      : (PUBLIC_COLORS[code]?.hex || '#ccc');
  }
  const chips = wrap?.parentNode?.querySelector('.color-chips');
  if (chips) {
    chips.querySelectorAll('button').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.code === code ? 'true' : 'false');
    });
  }
}

function wallSelect(current, selKey) {
  const opts = PUBLIC_WALLS.map(
    (w) => `<option value="${w}" ${w === current ? 'selected' : ''}>${PUBLIC_WALL_LABELS[w]}</option>`,
  ).join('');
  return `<select data-sel="${selKey}">${opts}</select>`;
}

/** Short "where is this opening" label for an opening list row. */
function openingLocationLabel(op) {
  if (!op.host || op.host === 'main') return PUBLIC_WALL_LABELS[op.wall] || op.wall;
  const idx = config.leanTos.findIndex((lt) => lt.id === op.host);
  const face = PUBLIC_OPENING_FACE_LABELS[op.face || 'outer'] || op.face;
  return idx < 0 ? `Lean-to · ${face}` : `Lean-to ${idx + 1} · ${face}`;
}

/**
 * Location picker for an opening: the four main walls, plus a group per enclosed
 * lean-to (outer / left end / right end). Option values are "<host>:<seg>".
 */
function openingLocationSelect(op) {
  const groups = [];
  const mainOpts = PUBLIC_WALLS.map((w) => {
    const sel = (!op.host || op.host === 'main') && op.wall === w ? 'selected' : '';
    return `<option value="main:${w}" ${sel}>${PUBLIC_WALL_LABELS[w]}</option>`;
  }).join('');
  groups.push(`<optgroup label="Main building">${mainOpts}</optgroup>`);

  config.leanTos.forEach((lt, idx) => {
    if (lt.enclosed === false) return; // open lean-tos have no walls to host openings
    const faceOpts = PUBLIC_OPENING_FACES.map((f) => {
      const sel = op.host === lt.id && (op.face || 'outer') === f ? 'selected' : '';
      return `<option value="${lt.id}:${f}" ${sel}>${PUBLIC_OPENING_FACE_LABELS[f]}</option>`;
    }).join('');
    const wallLabel = PUBLIC_WALL_LABELS[lt.wall] || lt.wall;
    groups.push(`<optgroup label="Lean-to ${idx + 1} (${wallLabel})">${faceOpts}</optgroup>`);
  });

  return `<select data-sel="location">${groups.join('')}</select>`;
}

function bindNumber(id, apply) {
  $(id).addEventListener('change', (e) => {
    const n = parseFloat(e.target.value);
    if (Number.isFinite(n)) apply(n);
    commit();
  });
}

function setVal(id, v) {
  const node = $(id);
  if (node) node.value = v;
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
