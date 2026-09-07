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
 * "Request a quote" collects name / phone / email and bundles them with the
 * public config. For this slice the lead is logged to the console and appended
 * to localStorage (`polebarnpro:leads:<companyId>`). See handoffLead() for how a
 * company CRM / webhook plugs in later.
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

init().catch((err) => {
  console.error('[embed] failed to start', err);
  const hint = document.querySelector('.viewer-hint');
  if (hint) hint.textContent = '3D preview unavailable in this browser.';
});

async function init() {
  populateColorSelects();
  bindBuildingControls();
  bindColorControls();
  bindMetalAndConcrete();
  bindLeanTos();
  bindOpenings();
  bindQuoteDialog();

  $('companyFoot').textContent = `Configurator ID: ${COMPANY_ID}`;
  syncFormFromConfig();

  await startViewer();
  bindViewerControls();
  applyConfigToViewer(true);

  // Opt-in debug handle for manual / automated testing (?debug=1). Read-only
  // getters — no behaviour, nothing sensitive.
  if (params.get('debug') === '1') {
    window.__embed = {
      get scene() { return scene; },
      get config() { return config; },
    };
  }
}

async function startViewer() {
  const canvas = $('viewport');
  try {
    const { SceneView } = await import('../render/scene.js?v=20260902e');
    // Reuse the viewer's built-in opening placement/drag. The handlers only ever
    // receive plain geometry (wall, offset, size) — no prices, takeoffs, or
    // framing cross this boundary.
    scene = new SceneView(canvas, {
      onWallClick: (data) => placeOpeningFromViewer(data),
      onOpeningMove: (data) => dragOpeningFromViewer(data),
      onOpeningClick: (data) => flashOpeningRow(data?.openingId, false),
    });
    scene.showFraming = false;
    scene.showMetal = true;
  } catch (err) {
    console.warn('[embed] 3D engine unavailable', err);
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
    const project = createProject({
      customer: 'Website visitor',
      project: `${config.building.width}x${config.building.length}`,
      buildings: [publicConfigToBuildingPartial(config)],
    });
    scene.setProject(project);
    scene.resize?.();
    if (immediate) scene.heroShot?.();
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
    });

    item.querySelectorAll('[data-k]').forEach((input) => {
      input.addEventListener('change', () => {
        const k = input.dataset.k;
        if (k === 'enclosed') lt.enclosed = input.checked;
        else if (k === 'eaveHeight') lt.eaveHeight = input.value === '' ? null : Number(input.value);
        else lt[k] = Number(input.value);
        config.leanTos[i] = defaultPublicLeanTo(lt);
        commit();
      });
    });

    item.querySelector('[data-sel="wall"]').addEventListener('change', (e) => {
      lt.wall = e.target.value;
      config.leanTos[i] = defaultPublicLeanTo(lt);
      commit();
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
  // The public embed only exposes main-building walls.
  if (data.host && data.host !== 'main') {
    showBanner('Openings can only go on the four main walls here.', false);
    return;
  }
  const draft = placeDraft || {};
  const op = defaultPublicOpening({
    type: PUBLIC_OPENING_TYPES[data.type] ? data.type : draft.type || 'window',
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
        <strong>${PUBLIC_OPENING_TYPES[op.type]?.label || 'Opening'} ${i + 1}</strong>
        <button type="button" class="link" data-remove>Remove</button>
      </div>
      <div class="row">
        <div class="field">
          <label>Type</label>
          <select data-sel="type">${typeOpts}</select>
        </div>
        <div class="field">
          <label>Wall</label>
          ${wallSelect(op.wall, 'wall')}
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
      // Re-seed size defaults for the new type, keep id/wall/offset.
      config.openings[i] = defaultPublicOpening({
        id: op.id,
        type: e.target.value,
        wall: op.wall,
        offset: op.offset,
      });
      commit();
      renderOpeningList();
    });

    item.querySelector('[data-sel="wall"]').addEventListener('change', (e) => {
      op.wall = e.target.value;
      config.openings[i] = defaultPublicOpening(op);
      commit();
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

/* ─────────────────────── request quote (lead stub) ─────────────────────── */

function bindQuoteDialog() {
  const dlg = $('quoteDialog');
  $('requestQuoteBtn').addEventListener('click', () => {
    $('quoteSent').hidden = true;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  });
  $('quoteCancel').addEventListener('click', () => dlg.close());

  $('quoteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const lead = {
      name: $('leadName').value.trim(),
      phone: $('leadPhone').value.trim(),
      email: $('leadEmail').value.trim(),
    };
    if (!lead.name || !lead.phone || !lead.email) return;

    const record = buildLeadRecord(lead);
    handoffLead(record);

    $('quoteSent').hidden = false;
    setTimeout(() => dlg.close(), 1400);
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
    lead,
    publicConfig: clean, // guaranteed free of price / SKU / takeoff / CRM fields
  };
}

/**
 * Lead handoff — STUB for this slice.
 *
 * Now:  console.log + append to localStorage `polebarnpro:leads:<companyId>`.
 *
 * Later (company CRM integration), replace the body with one of:
 *
 *   1. Webhook  — POST `record` as JSON to a per-company endpoint resolved from
 *      `companyId` (e.g. an env-configured map or a small `/api/lead` proxy that
 *      looks up the tenant). The proxy forwards to the company's CRM (HubSpot,
 *      Salesforce, Zoho, a Zapier catch-hook, etc.).
 *
 *   2. Email    — the same proxy formats `record` into a templated email to the
 *      company's sales inbox.
 *
 *   3. postMessage — when embedded via iframe, `window.parent.postMessage(record,
 *      targetOrigin)` so the host site's own JS captures the lead. The host page
 *      passes its origin in as `?parentOrigin=` and we validate it.
 *
 * The payload shape (`record`) does not change when the transport changes.
 */
function handoffLead(record) {
  console.log('[embed] LEAD (stub handoff):', record);
  try {
    const prev = JSON.parse(localStorage.getItem(LEADS_KEY) || '[]');
    prev.push(record);
    localStorage.setItem(LEADS_KEY, JSON.stringify(prev));
  } catch (err) {
    console.warn('[embed] could not store lead locally', err);
  }

  // Best-effort notify a host page if we are iframed and it asked for messages.
  const parentOrigin = params.get('parentOrigin');
  if (parentOrigin && window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({ type: 'polebarnpro:lead', record }, parentOrigin);
    } catch (err) {
      console.warn('[embed] postMessage to parent failed', err);
    }
  }
}

/* ─────────────────────── form <-> config sync ─────────────────────── */

function syncFormFromConfig() {
  $('title').textContent = 'Design Your Building';
  setVal('width', config.building.width);
  setVal('length', config.building.length);
  setVal('eaveHeight', config.building.eaveHeight);
  setVal('pitch', config.building.pitch);
  setVal('roofStyle', config.building.roofStyle);

  setVal('wallColor', config.colors.wall);
  setVal('roofColor', config.colors.roof);
  setVal('trimColor', config.colors.trim);
  setVal('wainscotColor', config.colors.wainscot);
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
  }
  $('wainscotColor').innerHTML =
    `<option value="NONE">None</option>` + colorOpts;
}

function wallSelect(current, selKey) {
  const opts = PUBLIC_WALLS.map(
    (w) => `<option value="${w}" ${w === current ? 'selected' : ''}>${PUBLIC_WALL_LABELS[w]}</option>`,
  ).join('');
  return `<select data-sel="${selKey}">${opts}</select>`;
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
