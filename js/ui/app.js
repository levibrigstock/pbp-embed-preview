/**
 * We Build Structures UI: top bar, ribbon, accordion inspector, overlays.
 */

import {
 createProject,
 createBuilding,
 createOpening,
 createLeanTo,
 createSiteProp,
 SITE_PROP_TYPES,
 OPENING_TYPES,
 OPENING_PRESETS,
 WALK_DOOR_HEIGHT,
 WALLS,
 WALL_LABELS,
 LEAN_FACES,
 LEAN_FACE_LABELS,
 formatOpeningSize,
 openingHostLength,
 isWallOpen,
 openWallList,
 toggleOpenWall,
 syncSidewallMetalFromOpenWalls,
 isLeanFaceOpen,
 toggleLeanOpenFace,
 isLeanEnclosed,
} from '../domain/types.js?v=20260902e';
import { pickPostStockLength, postHeightAboveGrade } from '../domain/framing.js?v=20260902e';
import { evaluateProjectRules } from '../rules/postFrameRules.js?v=20260902e';
import { takeoffProject, toItemListCsv, money } from '../takeoff/engine.js?v=20260902e';
import {
 printProductionPackage,
 downloadProductionPackage,
} from '../takeoff/productionPackage.js?v=20260902e';
import {
 runLeviScorecard,
 formatScorecardReport,
 comparePasteToItems,
 formatPasteCompareReport,
} from '../takeoff/scorecard.js?v=20260902e';
import {
 runAllRegressionChecks,
 formatRegressionReport,
} from '../takeoff/regressionCheck.js?v=20260902e';
import {
 describePolicyForBuilding,
 formatPolicySummary,
} from '../domain/productionPolicy.js?v=20260902e';
import { collectJobMessages } from '../rules/jobMessages.js?v=20260902e';
import {
 parseItemListCsv,
 applyImport,
 resetCatalog,
 catalogStats,
 CATALOG,
} from '../takeoff/catalog.js?v=20260902e';
// SceneView (Three.js) is loaded lazily in _bootWorkspace so login is never blocked by CDN
import { drawPlans, printPlans } from '../render/plans.js?v=20260902e';
import {
 getSession,
 login,
 logout,
 listUsers,
 createUser,
 updateUser,
 deleteUser,
 resetDefaultAdminPassword,
 changeOwnPassword,
 DEFAULT_ADMIN,
 isProdHost,
} from '../auth/accounts.js?v=20260902e';
import {
 loadSealed,
 saveSealed,
 isVaultUnlocked,
 lockVault,
} from '../security/cryptoVault.js?v=20260902e';
import { loadCloudConfig, isCloudEnabled } from '../cloud/config.js?v=20260902e';
import { cloudLogin, cloudLogout } from '../cloud/cognitoAuth.js?v=20260902e';
import { cloudPutJob, cloudPutCrm } from '../cloud/apiClient.js?v=20260902e';
import {
 loadBoard,
 saveBoard,
 createCard,
 cardsInColumn,
 moveCard,
 daysSince,
 avatarColor,
 initials,
} from '../crm/salesBoard.js?v=20260902e';

const $ = (id) => document.getElementById(id);
/** Active job snapshot (per user) */
const STORAGE_ACTIVE_PREFIX = 'polebarn_pro_active_job_';
/** Legacy single active key (migrated once) */
const STORAGE_ACTIVE_LEGACY = 'polebarn_pro_active_job';
/** Library of saved jobs { id, name, customer, project, location, savedAt, userId, data }[] */
const STORAGE_LIBRARY = 'polebarn_pro_job_library';
const PRICE_HIDDEN_KEY = 'polebarn_pro_hide_price';
/** Job Review: sort detail lines by cut length (longest first). Default on. */
const BOM_SORT_BY_LENGTH_KEY = 'polebarn_pro_bom_sort_length';
const MAX_JOBS_PER_USER = 50;

export class App {
 constructor({ seed } = {}) {
 this.session = getSession();
 this._seedInfo = seed || null;
 this._moveLiveTimer = null;
 this._bomCat = 'summary';
 this._lastTakeoff = null;
 // Default ON (longest-first). Only off when user explicitly set '0'.
 this._bomSortByLength = localStorage.getItem(BOM_SORT_BY_LENGTH_KEY) !== '0';
 this._priceHidden = localStorage.getItem(PRICE_HIDDEN_KEY) === '1';
 this._booted = false;
 this.project = null;
 this.scene = null;
 /** Snapshots taken before each change — pop one per Undo */
 this._undoStack = [];
 this._undoMax = 50;
 this._undoPaused = false;
 this._undoBatch = null; // { label, timer } for coalescing form edits
 this._moveUndoPushed = false;
 /** Currently selected lean-to / attachment id for inspector edit form */
 this.selectedLeanToId = null;
 this._leanEditBound = false;

 this._uiBound = false;
 /** Fingerprint of last saved/loaded project — used to detect unsaved edits */
 this._cleanFingerprint = null;
 /** @type {null | (() => void)} action after save / don't-save from leave prompt */
 this._pendingLeaveAction = null;
 this._bindAuth();
 // Always show login first — never auto-enter 3D on refresh (avoids black screen / WebGL race)
 this.session = null;
 try {
 // Keep session data for pre-filled chip only; require explicit Sign in
 const existing = getSession();
 if (existing && $('loginEmail') && !$('loginEmail').value) {
 $('loginEmail').value = existing.email || DEFAULT_ADMIN.email;
 }
 } catch (_) {}
 this._showLogin();
 }

 /** Capture current project so the next mutation can be undone. */
 _pushUndo(label = 'Change') {
 if (this._undoPaused || !this.project) return;
 try {
 const snap = JSON.stringify(this.project);
 const top = this._undoStack[this._undoStack.length - 1];
 if (top && top.snap === snap) {
 top.label = label || top.label;
 this._updateUndoButton();
 return;
 }
 this._undoStack.push({ snap, label: label || 'Change', at: Date.now() });
 while (this._undoStack.length > this._undoMax) this._undoStack.shift();
 this._updateUndoButton();
 } catch (err) {
 console.warn('undo push failed', err);
 }
 }

 /**
   * For continuous form typing: push once at the start of a burst,
   * then ignore further pushes with the same label until idle.
   */
 _pushUndoCoalesced(label, idleMs = 900) {
 if (this._undoPaused || !this.project) return;
 if (this._undoBatch?.label === label) {
 clearTimeout(this._undoBatch.timer);
 this._undoBatch.timer = setTimeout(() => {
 this._undoBatch = null;
 }, idleMs);
 return;
 }
 this._pushUndo(label);
 if (this._undoBatch?.timer) clearTimeout(this._undoBatch.timer);
 this._undoBatch = {
 label,
 timer: setTimeout(() => {
 this._undoBatch = null;
 }, idleMs),
 };
 }

 _clearUndo() {
 this._undoStack = [];
 this._undoBatch = null;
 this._moveUndoPushed = false;
 this._updateUndoButton();
 }

 _updateUndoButton() {
 const btn = $('undoBtn');
 if (!btn) return;
 const n = this._undoStack.length;
 btn.disabled = n === 0;
 btn.textContent = n > 0 ? `Undo (${n})` : 'Undo';
 btn.title =
 n > 0
 ? `Undo: ${this._undoStack[n - 1].label} · Ctrl/Cmd+Z (stack: ${n})`
 : 'Nothing to undo';
 }

 _undo() {
 if (!this._undoStack.length || !this.project) {
 $('hint') && ($('hint').textContent = 'Nothing to undo.');
 return;
 }
 const entry = this._undoStack.pop();
 this._undoPaused = true;
 this._undoBatch = null;
 this._moveUndoPushed = false;
 try {
 this.project = createProject(JSON.parse(entry.snap));
 this._syncFormFromActive();
 this.refresh();
 this.scene?.heroShot?.();
 if ($('hint')) {
 $('hint').textContent = `Undid: ${entry.label}${
 this._undoStack.length ? ` · ${this._undoStack.length} step${this._undoStack.length === 1 ? '' : 's'} left` : ''
 }`;
 }
 } catch (err) {
 console.error(err);
 alert('Undo failed: ' + (err.message || err));
 } finally {
 this._undoPaused = false;
 this._updateUndoButton();
 }
 }

 _activeStorageKey() {
 const uid = this.session?.userId || 'anon';
 return STORAGE_ACTIVE_PREFIX + uid;
 }


 _showChangePasswordGate(currentPassword) {
 const form = $('loginForm');
 const gate = $('changePasswordGate');
 const hint = $('loginSeedHint');
 if (form) form.style.display = 'none';
 if (hint) hint.style.display = 'none';
 if (gate) {
 gate.style.display = 'block';
 if ($('changePwCurrent')) $('changePwCurrent').value = currentPassword || '';
 if ($('changePwNew')) $('changePwNew').value = '';
 if ($('changePwNew2')) $('changePwNew2').value = '';
 if ($('changePwError')) {
 $('changePwError').style.display = 'none';
 $('changePwError').textContent = '';
 }
 $('changePwNew')?.focus();
 }
 }

 async _submitChangePassword() {
 const errEl = $('changePwError');
 const cur = $('changePwCurrent')?.value || '';
 const a = $('changePwNew')?.value || '';
 const b = $('changePwNew2')?.value || '';
 if (errEl) {
 errEl.style.display = 'none';
 errEl.textContent = '';
 }
 if (a !== b) {
 if (errEl) {
 errEl.textContent = 'New passwords do not match.';
 errEl.style.display = 'block';
 }
 return;
 }
 const res = await changeOwnPassword(cur, a);
 if (!res.ok) {
 if (errEl) {
 errEl.textContent = res.error || 'Could not change password.';
 errEl.style.display = 'block';
 }
 return;
 }
 this.session = res.session || getSession();
 const gate = $('changePasswordGate');
 if (gate) gate.style.display = 'none';
 const form = $('loginForm');
 if (form) form.style.display = '';
 try {
 await this._enterApp();
 } catch (bootErr) {
 console.error(bootErr);
 }
 }

 _showLogin() {
 const shell = $('appShell');
 const loginEl = $('loginScreen');
 if (shell) {
 shell.style.display = 'none';
 shell.classList.remove('is-open');
 }
 if (loginEl) {
 loginEl.classList.remove('is-hidden');
 loginEl.style.display = 'flex';
 }

 const creds = this._seedInfo?.defaultCredentials || {
 email: DEFAULT_ADMIN.email,
 password: isProdHost() ? '' : DEFAULT_ADMIN.password,
 };
 const hint = $('loginSeedHint');
 if (hint) {
 if (isProdHost() || !creds.password) {
 hint.style.display = 'block';
 hint.innerHTML = `Use your company account. Jobs and CRM are <b>encrypted</b> in this browser after sign-in.`;
 } else {
 hint.style.display = 'block';
 hint.innerHTML = `Default admin: <code>${esc(creds.email)}</code><br />Password: <code>${esc(creds.password)}</code> <span style="opacity:.8">(capital A, ends with !)</span><br /><span style="opacity:.85">Change this password after first sign-in — data is encrypted at rest.</span>`;
 }
 }
 if ($('loginEmail') && !$('loginEmail').value) {
 $('loginEmail').value = creds.email || DEFAULT_ADMIN.email;
 }
 // Hide change-password panel when showing login
 const gate = $('changePasswordGate');
 if (gate) gate.style.display = 'none';
 const form = $('loginForm');
 if (form) form.style.display = '';
 const resetBtn = $('resetAdminBtn');
 if (resetBtn) resetBtn.style.display = isProdHost() ? 'none' : '';
 }

 /**
   * Open the designer. Keeps login visible until 3D is ready (no black flash).
   * @returns {Promise<void>}
   */
 async _enterApp() {
 this.session = getSession();
 if (!this.session) {
 this._showLogin();
 return;
 }

 const errEl = $('loginError');
 if (errEl) {
 errEl.style.display = 'block';
 errEl.textContent = 'Loading 3D designer…';
 errEl.style.background = 'transparent';
 errEl.style.borderColor = 'var(--border)';
 errEl.style.color = 'var(--muted)';
 }

 try {
 if (!this._booted) {
 // Load Three.js + build scene while login is still visible
 await this._bootWorkspace();
 this._booted = true;
 } else {
 this.project = (await this._loadActiveJob()) || this._defaultProject();
 if (!Array.isArray(this.project.props)) this.project.props = [];
 this._syncFormFromActive();
 if (this.scene) {
 this.refresh();
 this.scene.heroShot?.();
 }
 }
 this._markProjectClean();

 // Only now hide login and show the app
 const loginEl = $('loginScreen');
 const shell = $('appShell');
 if (loginEl) {
 loginEl.classList.add('is-hidden');
 loginEl.style.display = 'none';
 }
 if (shell) {
 shell.style.display = 'flex';
 shell.classList.add('is-open');
 }
 // Canvas may have been 0-size while shell was hidden
 try {
 this.scene?.resize?.();
 this.scene?.heroShot?.();
 } catch (_) {}

 if (errEl) {
 errEl.style.display = 'none';
 errEl.textContent = '';
 errEl.style.background = '';
 errEl.style.borderColor = '';
 errEl.style.color = '';
 }
 this._updateUserChrome();
 } catch (err) {
 console.error('Failed to open workspace', err);
 this._booted = false;
 this.scene = null;
 this._showLogin();
 if (errEl) {
 errEl.style.display = 'block';
 errEl.style.background = '';
 errEl.style.borderColor = '';
 errEl.style.color = '';
 errEl.textContent =
 'Could not open the designer: ' +
 (err.message || err) +
 '. Click “Fix app storage” if this keeps happening.';
 }
 throw err;
 }
 }

 async _bootWorkspace() {
 this.project = (await this._loadActiveJob()) || this._defaultProject();
 if (!Array.isArray(this.project.props)) this.project.props = [];
 this.selectedPropId = null;

 const canvas = $('viewport');
 if (!canvas) {
 throw new Error('3D canvas (#viewport) not found in the page.');
 }

 // Lazy-load Three.js scene only after sign-in
 let SceneView;
 try {
 // Cache-bust so lean-to geometry fixes always load after deploys
 const mod = await import('../render/scene.js?v=20260902e');
 SceneView = mod.SceneView;
 } catch (err) {
 throw new Error(
 'Could not load the 3D engine (Three.js). Check internet access to unpkg.com. ' +
 (err.message || err),
 );
 }

 this.scene = new SceneView(canvas, {
 onWallClick: (data) => this._placeOpening(data),
 onOpenWallClick: (data) => this._toggleOpenWallFrom3D(data),
 onOpeningClick: (data) => this._selectOpening(data),
 onOpeningMove: (data) => this._moveOpening(data),
 onGroundClick: (data) => this._placeProp(data),
 onPropClick: (data) => this._selectProp(data),
 });
 // Default: shell-only sales look
 this.scene.showFraming = false;
 this.scene.showMetal = true;

 if (!this._uiBound) {
 this._bind();
 this._uiBound = true;
 }
 this._syncFormFromActive();
 this._renderCatalogStats();
 this._applyPriceVisibility();
 this._clearUndo();
 this.refresh();
 // After first refresh (may normalize lean eaves etc.) so dirty detect is accurate
 this._markProjectClean();
 requestAnimationFrame(() => {
 try {
 this.scene?.resize?.();
 this.scene?.heroShot?.();
 this._syncViewBar();
 if (this.scene && this.scene.webglOk === false && $('hint')) {
 $('hint').textContent =
 '3D graphics unavailable in this browser — use the forms, Job Review, and Save/Load. Try Chrome with hardware acceleration for 3D.';
 }
 } catch (err) {
 console.warn('post-boot camera', err);
 }
 });
 }

 _updateUserChrome() {
 const s = this.session;
 const chip = $('userChip');
 if (chip && s) {
 chip.textContent = s.name || s.email;
 chip.title = `${s.name || ''} · ${s.email} · ${s.role}`;
 }
 const accBtn = $('accountsBtn');
 if (accBtn) accBtn.style.display = s?.role === 'admin' ? '' : 'none';
 }

 _bindAuth() {
 $('loginForm')?.addEventListener('submit', async (ev) => {
 ev.preventDefault();
 const errEl = $('loginError');
 const btn = $('loginSubmit');
 if (errEl) {
 errEl.style.display = 'none';
 errEl.textContent = '';
 }
 const email = $('loginEmail')?.value || '';
 const password = $('loginPassword')?.value || '';
 if (btn) btn.disabled = true;
 try {
 let result;
 const cloudCfg = await loadCloudConfig();
 if (isCloudEnabled(cloudCfg)) {
 const cloud = await cloudLogin(email, password);
 if (!cloud.ok) {
 // Fall back to local vault auth (migration / offline shop PC)
 console.warn('Cloud login failed, trying local', cloud.error);
 result = await login(email, password);
 if (!result.ok) {
 if (errEl) {
 errEl.textContent = cloud.error || result.error || 'Sign-in failed.';
 errEl.style.display = 'block';
 }
 return;
 }
 this.session = result.session;
 this._cloudSession = false;
 if ($('loginPassword')) $('loginPassword').value = '';
 if (result.mustChangePassword || result.session?.mustChangePassword) {
 this._showChangePasswordGate(password);
 return;
 }
 try {
 await this._enterApp();
 } catch (bootErr) {
 console.error(bootErr);
 }
 return;
 }
 // Local auth (hash migrate) + vault always keyed by Cognito sub when cloud is on
 let mustChange = false;
 const local = await login(email, password);
 if (local.ok) mustChange = !!(local.mustChangePassword || local.session?.mustChangePassword);
 try {
 const { unlockVault } = await import('../security/cryptoVault.js?v=20260902e');
 await unlockVault(cloud.session.userId, password);
 } catch (vaultErr) {
 console.warn('Vault unlock for cloud user', vaultErr);
 if (!local.ok) {
 if (errEl) {
 errEl.textContent = vaultErr.message || 'Could not unlock data vault.';
 errEl.style.display = 'block';
 }
 return;
 }
 }
 result = {
 ok: true,
 session: { ...cloud.session, mustChangePassword: mustChange },
 mustChangePassword: mustChange,
 cloud: true,
 };
 } else {
 result = await login(email, password);
 }
 if (!result.ok) {
 if (errEl) {
 errEl.textContent = result.error || 'Sign-in failed.';
 errEl.style.display = 'block';
 }
 return;
 }
 this.session = result.session;
 this._cloudSession = !!result.cloud || !!result.session?.cloud;
 if ($('loginPassword')) $('loginPassword').value = '';
 if (result.mustChangePassword || result.session?.mustChangePassword) {
 this._showChangePasswordGate(password);
 return;
 }
 try {
 await this._enterApp();
 } catch (bootErr) {
 console.error(bootErr);
 }
 } catch (err) {
 if (errEl) {
 errEl.textContent = 'Sign-in error: ' + (err.message || err);
 errEl.style.display = 'block';
 }
 } finally {
 if (btn) btn.disabled = false;
 }
 });

  $('changePwForm')?.addEventListener('submit', async (ev) => {
 ev.preventDefault();
 await this._submitChangePassword();
 });

 $('resetAdminBtn')?.addEventListener('click', async () => {
 const errEl = $('loginError');
 try {
 const res = await resetDefaultAdminPassword();
 if (!res.ok) {
 if (errEl) {
 errEl.textContent = res.error || 'Reset not allowed.';
 errEl.style.display = 'block';
 }
 return;
 }
 if ($('loginEmail')) $('loginEmail').value = res.email;
 if ($('loginPassword')) $('loginPassword').value = res.password;
 if (errEl) {
 errEl.style.display = 'none';
 errEl.textContent = '';
 }
 const hint = $('loginSeedHint');
 if (hint) {
 hint.style.display = 'block';
 hint.innerHTML = `Admin password reset.<br />Email: <code>${esc(res.email)}</code><br />Password: <code>${esc(res.password)}</code><br />Click <b>Sign in</b>, then set a new password.`;
 }
 } catch (err) {
 if (errEl) {
 errEl.textContent = 'Reset failed: ' + (err.message || err);
 errEl.style.display = 'block';
 }
 }
 });

 $('fixStorageBtn')?.addEventListener('click', () => {
 try {
 const keys = [];
 for (let i = 0; i < localStorage.length; i++) {
 const k = localStorage.key(i);
 if (k && k.startsWith('polebarn')) keys.push(k);
 }
 keys.forEach((k) => localStorage.removeItem(k));
 } catch (_) {}
 window.location.href = './?ok=1';
 });

 $('logoutBtn')?.addEventListener('click', async () => {
 try {
 if (this.project && isVaultUnlocked()) {
 await this._persistActiveJob();
 }
 } catch (_) {}
 logout();
 cloudLogout();
 lockVault();
 this.session = null;
 this._cloudSession = false;
 this._closeLoadModal();
 this._closeSaveModal();
 this._closeAccountsModal();
 this._showLogin();
 });
 }

 async _loadActiveJob() {
 try {
 if (!isVaultUnlocked()) return null;
 let data = await loadSealed(this._activeStorageKey(), { migrate: true });
 // One-time migrate legacy global active job into this user's slot
 if (!data) {
 const legacy = localStorage.getItem(STORAGE_ACTIVE_LEGACY);
 if (legacy) {
 try {
 data = JSON.parse(legacy);
 await saveSealed(this._activeStorageKey(), data);
 localStorage.removeItem(STORAGE_ACTIVE_LEGACY);
 } catch (_) {
 data = null;
 }
 }
 }
 if (!data || typeof data !== 'object') return null;
 if (!Array.isArray(data.buildings) || !data.buildings.length) return null;
 return createProject(data);
 } catch (err) {
 console.warn('Could not load active job, using default', err);
 return null;
 }
 }

 /** Persist active project (encrypted). Fire-and-forget safe via write chain. */
 _persistActiveJob() {
 if (!this.project || !isVaultUnlocked()) return Promise.resolve();
 const key = this._activeStorageKey();
 const snap = JSON.parse(JSON.stringify(this.project));
 this._vaultWriteChain = (this._vaultWriteChain || Promise.resolve())
 .then(() => saveSealed(key, snap))
 .catch((err) => console.warn('persist active job failed', err));
 return this._vaultWriteChain;
 }

 async _readAllLibrary() {
 try {
 if (!isVaultUnlocked()) return [];
 const list = await loadSealed(STORAGE_LIBRARY, { migrate: true });
 return Array.isArray(list) ? list : [];
 } catch (_) {
 return [];
 }
 }

 async _writeAllLibrary(list) {
 if (!isVaultUnlocked()) {
 console.warn('write library: vault locked');
 return;
 }
 await saveSealed(STORAGE_LIBRARY, list);
 }

 /** Jobs visible to the signed-in user */
 async _readLibrary() {
 const uid = this.session?.userId;
 const all = await this._readAllLibrary();
 if (!uid) return [];
 return all.filter((j) => j.userId === uid || !j.userId);
 }

 async _writeLibraryForUser(userJobs) {
 const uid = this.session?.userId;
 if (!uid) return;
 const all = await this._readAllLibrary();
 const others = all.filter((j) => j.userId && j.userId !== uid);
 const userIds = new Set(userJobs.map((j) => j.id));
 const legacyKeep = all.filter((j) => !j.userId && !userIds.has(j.id));
 const stamped = userJobs.map((j) => ({ ...j, userId: uid }));
 await this._writeAllLibrary([...stamped, ...legacyKeep, ...others]);
 }

 /** Open save form (interactive SAVE) */
 _openSaveModal() {
 if (!this.session) {
 this._showLogin();
 return;
 }
 const modal = $('saveJobModal');
 if (!modal) return;
 if ($('saveJobName')) $('saveJobName').value = this.project.project || '';
 if ($('saveJobCustomer')) $('saveJobCustomer').value = this.project.customer || '';
 if ($('saveJobAddress')) $('saveJobAddress').value = this.project.location || '';
 this._tickSaveTimestamp();
 modal.style.display = 'flex';
 requestAnimationFrame(() => $('saveJobName')?.focus());
 }

 _tickSaveTimestamp() {
 const el = $('saveJobTimestamp');
 if (!el) return;
 const now = new Date();
 el.textContent = now.toLocaleString(undefined, {
 dateStyle: 'full',
 timeStyle: 'medium',
 });
 el.dataset.iso = now.toISOString();
 }

 _closeSaveModal() {
 const modal = $('saveJobModal');
 if (modal) modal.style.display = 'none';
 }

 /**
 * Stable snapshot of current project for dirty detection.
 * @returns {string}
 */
 _projectFingerprint() {
 try {
 if (!this.project) return '';
 return JSON.stringify(this.project);
 } catch (_) {
 return String(Date.now());
 }
 }

 /** Mark current project as clean (saved / just loaded / new). */
 _markProjectClean() {
 this._cleanFingerprint = this._projectFingerprint();
 }

 /** True when project differs from last clean snapshot. */
 _isProjectDirty() {
 if (!this.project) return false;
 if (this._cleanFingerprint == null) return true;
 return this._projectFingerprint() !== this._cleanFingerprint;
 }

 _closeUnsavedModal() {
 const modal = $('unsavedJobModal');
 if (modal) modal.style.display = 'none';
 }

 /**
 * If dirty, prompt Save / Don't save / Cancel. Otherwise run action immediately.
 * @param {() => void} action
 * @param {string} [message]
 */
 _confirmLeaveCurrentJob(action, message) {
 if (typeof action !== 'function') return;
 if (!this._isProjectDirty()) {
 action();
 return;
 }
 this._pendingLeaveAction = action;
 const msg = $('unsavedJobMessage');
 if (msg) {
 msg.textContent =
 message ||
 'You have unsaved changes on the current job. Save before continuing?';
 }
 const modal = $('unsavedJobModal');
 if (modal) modal.style.display = 'flex';
 else {
 // Fallback if modal missing
 if (confirm('Save your current work before continuing?\n\nOK = save first, Cancel = discard and continue.')) {
 this._pendingLeaveAction = action;
 this._openSaveModal();
 } else {
 const fn = this._pendingLeaveAction;
 this._pendingLeaveAction = null;
 fn?.();
 }
 }
 }

 _runPendingLeaveAction() {
 const fn = this._pendingLeaveAction;
 this._pendingLeaveAction = null;
 this._closeUnsavedModal();
 if (typeof fn === 'function') fn();
 }

 /**
   * Persist current job to active slot + named library entry.
   * @param {{ silent?: boolean, meta?: { jobName?: string, customer?: string, address?: string, savedAt?: string } }} opts
   */
 async _saveJobToStorage({ silent = false, meta = null } = {}) {
 try {
 if (!this.session) {
 alert('Sign in to save jobs.');
 return false;
 }

 if (meta) {
 if (meta.jobName != null) this.project.project = String(meta.jobName).trim() || this.project.project;
 if (meta.customer != null) this.project.customer = String(meta.customer).trim();
 if (meta.address != null) this.project.location = String(meta.address).trim();
 }

 const id = this.project.id || `job_${Date.now()}`;
 this.project.id = id;
 const savedAt = meta?.savedAt || new Date().toISOString();
 const data = JSON.parse(JSON.stringify(this.project));
 await saveSealed(this._activeStorageKey(), data);

 const lib = await this._readLibrary();
 const jobName = this.project.project || 'Job';
 const customer = this.project.customer || '';
 const address = this.project.location || '';
 const name = `${customer ? customer + ' — ' : ''}${jobName}`.trim() || jobName;

 const entry = {
 id,
 name,
 customer,
 project: jobName,
 location: address,
 address,
 savedAt,
 userId: this.session.userId,
 savedBy: this.session.email,
 data,
 };
 const idx = lib.findIndex((j) => j.id === id);
 if (idx >= 0) lib[idx] = entry;
 else lib.unshift(entry);
 // Cap per-user library
 while (lib.length > MAX_JOBS_PER_USER) lib.pop();
 await this._writeLibraryForUser(lib);

 this._syncFormFromActive();
 if ($('headerJobName')) {
 $('headerJobName').textContent = `"${this.project.customer || this.project.project}"`;
 }

 this._markProjectClean();

 if (!silent) {
 const when = new Date(savedAt).toLocaleString();
 $('hint').textContent = `Saved “${name}” · ${when} (${lib.length} job${lib.length === 1 ? '' : 's'} in your library).`;
 }
 // Mirror to cloud when Cognito session is active
 if (this._cloudSession || this.session?.cloud) {
 try {
 await cloudPutJob(id, {
 name,
 customer,
 location: address,
 savedAt,
 data,
 });
 if (!silent) {
 $('hint').textContent += ' · synced to cloud';
 }
 } catch (syncErr) {
 console.warn('Cloud job sync failed', syncErr);
 if (!silent) {
 $('hint').textContent += ' · cloud sync failed (saved locally)';
 }
 }
 }

 // Continue load / new-job flow after user chose Save from leave prompt
 if (this._pendingLeaveAction) {
 const fn = this._pendingLeaveAction;
 this._pendingLeaveAction = null;
 this._closeUnsavedModal();
 // Defer so save modal can close cleanly first
 queueMicrotask(() => fn());
 }
 return true;
 } catch (err) {
 console.error(err);
 alert('Save failed: ' + (err.message || err));
 return false;
 }
 }

 _jobSizeSummary(entry) {
 const b = entry?.data?.buildings?.[0];
 if (!b) return [];
 const chips = [];
 if (b.width && b.length) chips.push(`${b.width}×${b.length} ft`);
 if (b.eaveHeight) chips.push(`${b.eaveHeight}' eave`);
 if (b.pitch != null) chips.push(`${b.pitch}/12 pitch`);
 const more = (entry.data.buildings?.length || 1) - 1;
 if (more > 0) chips.push(`+${more} building${more === 1 ? '' : 's'}`);
 const opens = (entry.data.buildings || []).reduce(
 (n, x) => n + (x.openings?.length || 0),
 0,
 );
 if (opens) chips.push(`${opens} opening${opens === 1 ? '' : 's'}`);
 const leantos = (entry.data.buildings || []).reduce(
 (n, x) => n + (x.leanTos?.length || 0),
 0,
 );
 if (leantos) chips.push(`${leantos} attachment${leantos === 1 ? '' : 's'}`);
 return chips;
 }

 _openLoadModal() {
 const modal = $('jobLibraryModal');
 if (!modal) {
 alert('Job library UI is missing. Refresh the page.');
 return;
 }
 modal.style.display = 'flex';
 const search = $('jobLibrarySearch');
 if (search) {
 search.value = '';
 // Focus after paint so the screen is visible first
 requestAnimationFrame(() => search.focus());
 }
 this._renderJobLibrary();
 }

 _closeLoadModal() {
 const modal = $('jobLibraryModal');
 if (modal) modal.style.display = 'none';
 }

 _filterLibrary(lib, query) {
 const q = (query || '').trim().toLowerCase();
 if (!q) return lib;
 return lib.filter((j) => {
 const hay = [
 j.name,
 j.customer,
 j.project,
 j.location,
 j.address,
 j.savedBy,
 j.data?.customer,
 j.data?.project,
 j.data?.location,
 j.data?.buildings?.[0]?.name,
 ]
 .filter(Boolean)
 .join(' ')
 .toLowerCase();
 return hay.includes(q);
 });
 }

 async _renderJobLibrary() {
 const listEl = $('jobLibraryList');
 const emptyEl = $('jobLibraryEmpty');
 const noMatchEl = $('jobLibraryNoMatch');
 const countEl = $('jobLibraryCount');
 if (!listEl) return;

 const lib = await this._readLibrary();
 const query = $('jobLibrarySearch')?.value || '';
 const filtered = this._filterLibrary(lib, query);
 const activeId = this.project?.id;

 if (countEl) {
 if (query.trim()) {
 countEl.textContent = `${filtered.length} of ${lib.length} job${lib.length === 1 ? '' : 's'}`;
 } else {
 countEl.textContent = `${lib.length} job${lib.length === 1 ? '' : 's'}`;
 }
 }

 listEl.innerHTML = '';
 if (emptyEl) emptyEl.style.display = 'none';
 if (noMatchEl) noMatchEl.style.display = 'none';

 if (!lib.length) {
 listEl.style.display = 'none';
 if (emptyEl) emptyEl.style.display = 'flex';
 return;
 }

 if (!filtered.length) {
 listEl.style.display = 'none';
 if (noMatchEl) noMatchEl.style.display = 'flex';
 return;
 }

 listEl.style.display = 'flex';

 for (const entry of filtered) {
 const card = document.createElement('article');
 card.className = 'job-card' + (entry.id && entry.id === activeId ? ' is-active' : '');
 card.dataset.jobId = entry.id;

 const when = entry.savedAt
 ? new Date(entry.savedAt).toLocaleString(undefined, {
 dateStyle: 'medium',
 timeStyle: 'short',
 })
 : 'Unknown date';
 const customer = entry.customer || entry.data?.customer || '—';
 const project = entry.project || entry.data?.project || entry.name || 'Untitled job';
 const location = entry.address || entry.location || entry.data?.location || '';
 const chips = this._jobSizeSummary(entry);
 const chipsHtml = chips
 .map((c) => `<span class="job-chip">${esc(c)}</span>`)
 .join('');

 card.innerHTML = `
 <div class="job-card-main" data-action="load" title="Click to load this job">
 <div class="job-card-title-row">
 <h3 class="job-card-title">${esc(project)}</h3>
 ${entry.id === activeId ? '<span class="job-card-badge">Current</span>' : ''}
 </div>
 <p class="job-card-meta">
 <strong>${esc(customer)}</strong>
 ${location ? `<br />📍 ${esc(location)}` : ''}
 <br />Saved ${esc(when)}${entry.savedBy ? ` · ${esc(entry.savedBy)}` : ''}
 </p>
 ${chipsHtml ? `<div class="job-card-dims">${chipsHtml}</div>` : ''}
 </div>
 <div class="job-card-actions">
 <button type="button" class="job-load-btn" data-action="load">Load</button>
 <button type="button" class="job-delete-btn" data-action="delete">Delete</button>
 </div>
 `;

 card.addEventListener('click', (ev) => {
 const actionEl = ev.target.closest('[data-action]');
 const action = actionEl?.dataset?.action;
 if (action === 'delete') {
 ev.stopPropagation();
 this._deleteLibraryJob(entry.id);
 return;
 }
 if (action === 'load' || ev.target.closest('.job-card-main')) {
 this._loadLibraryJob(entry.id);
 }
 });

 listEl.appendChild(card);
 }
 }

 _loadLibraryJob(id) {
 // Already on this job — just close the library
 if (id && this.project?.id === id && !this._isProjectDirty()) {
 this._closeLoadModal();
 return;
 }
 this._confirmLeaveCurrentJob(
 () => this._applyLibraryJob(id),
 'You have unsaved changes. Save before loading another job?',
 );
 }

 async _applyLibraryJob(id) {
 const lib = await this._readLibrary();
 const entry = lib.find((j) => j.id === id);
 if (!entry?.data) {
 alert('That job could not be found. It may have been deleted.');
 this._renderJobLibrary();
 return;
 }
 try {
 this.project = createProject(entry.data);
 if (!this.project.id) this.project.id = entry.id;
 this._persistActiveJob();
 this._clearUndo();
 this._syncFormFromActive();
 this.refresh();
 this.scene?.heroShot?.();
 this._markProjectClean();
 this._closeLoadModal();
 this._closeUnsavedModal();
 const when = entry.savedAt ? new Date(entry.savedAt).toLocaleString() : '';
 $('hint').textContent = `Loaded “${entry.name || entry.project || 'job'}”${when ? ` (saved ${when})` : ''}.`;
 } catch (err) {
 alert('Load failed: ' + (err.message || err));
 }
 }

 /**
 * Start a blank default job (new library id so SAVE creates a new entry).
 */
 _startNewJob() {
 this._confirmLeaveCurrentJob(
 () => this._applyNewJob(),
 'You have unsaved changes. Save before starting a new job?',
 );
 }

 _applyNewJob() {
 try {
 this.project = this._defaultProject();
 this.project.id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
 this.project.project = 'New Job';
 this.project.customer = 'Customer Name';
 this._persistActiveJob();
 this._clearUndo();
 this.selectedLeanToId = null;
 this._syncFormFromActive();
 this.refresh();
 this.scene?.heroShot?.();
 this._markProjectClean();
 this._closeLoadModal();
 this._closeUnsavedModal();
 if ($('headerJobName')) {
 $('headerJobName').textContent = `"${this.project.customer || this.project.project}"`;
 }
 $('hint').textContent = 'New job started — set customer and dimensions, then SAVE to your library.';
 } catch (err) {
 console.error(err);
 alert('Could not start new job: ' + (err.message || err));
 }
 }

 async _deleteLibraryJob(id) {
 const all = await this._readAllLibrary();
 const entry = all.find((j) => j.id === id);
 if (!entry) {
 this._renderJobLibrary();
 return;
 }
 const uid = this.session?.userId;
 if (entry.userId && entry.userId !== uid) {
 alert('You can only delete your own jobs.');
 return;
 }
 const label = entry.name || entry.project || 'this job';
 if (!confirm(`Delete saved job “${label}”?\n\nThis only removes it from browser storage. It cannot be undone.`)) {
 return;
 }
 await this._writeAllLibrary(all.filter((j) => j.id !== id));
 $('hint').textContent = `Deleted “${label}”.`;
 this._renderJobLibrary();
 }

 /* —— Accounts (admin) —— */
 _openAccountsModal() {
 if (this.session?.role !== 'admin') {
 alert('Only administrators can manage accounts.');
 return;
 }
 const modal = $('accountsModal');
 if (!modal) return;
 const err = $('addUserError');
 if (err) {
 err.style.display = 'none';
 err.textContent = '';
 }
 modal.style.display = 'flex';
 this._renderAccountsList();
 }

 _closeAccountsModal() {
 const modal = $('accountsModal');
 if (modal) modal.style.display = 'none';
 }

 _renderAccountsList() {
 const list = $('accountsList');
 if (!list) return;
 const users = listUsers();
 list.innerHTML = '';
 if (!users.length) {
 list.innerHTML = '<p class="small">No accounts yet.</p>';
 return;
 }
 for (const u of users) {
 const row = document.createElement('div');
 row.className = 'account-row' + (u.active ? '' : ' is-inactive');
 const created = u.createdAt
 ? new Date(u.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })
 : '';
 row.innerHTML = `
 <div class="account-info">
 <div class="name">${esc(u.name)}${u.active ? '' : ' (disabled)'}</div>
 <div class="email">${esc(u.email)}${created ? ` · since ${esc(created)}` : ''}</div>
 </div>
 <span class="account-role ${u.role === 'admin' ? 'is-admin' : ''}">${esc(u.role)}</span>
 <div class="account-actions">
 <button type="button" data-act="role" title="Toggle admin/user">Role</button>
 <button type="button" data-act="password" title="Reset password">Password</button>
 <button type="button" data-act="toggle" title="Enable or disable">${u.active ? 'Disable' : 'Enable'}</button>
 <button type="button" class="danger" data-act="delete" title="Delete account">Delete</button>
 </div>
 `;
 row.querySelectorAll('button[data-act]').forEach((btn) => {
 btn.addEventListener('click', () => this._accountAction(u, btn.dataset.act));
 });
 list.appendChild(row);
 }
 }

 async _accountAction(user, act) {
 const actor = this.session;
 if (!actor || actor.role !== 'admin') return;

 if (act === 'delete') {
 if (!confirm(`Delete account “${user.email}”?`)) return;
 const res = deleteUser(user.id, actor);
 if (!res.ok) {
 alert(res.error);
 return;
 }
 this._renderAccountsList();
 return;
 }

 if (act === 'role') {
 const next = user.role === 'admin' ? 'user' : 'admin';
 if (!confirm(`Change ${user.email} to ${next}?`)) return;
 const res = await updateUser(user.id, { role: next }, actor);
 if (!res.ok) {
 alert(res.error);
 return;
 }
 if (user.id === actor.userId) this.session = getSession();
 this._updateUserChrome();
 this._renderAccountsList();
 return;
 }

 if (act === 'toggle') {
 const res = await updateUser(user.id, { active: !user.active }, actor);
 if (!res.ok) {
 alert(res.error);
 return;
 }
 this._renderAccountsList();
 return;
 }

 if (act === 'password') {
 const pw = prompt(`New password for ${user.email} (min 6 characters):`, '');
 if (pw == null || pw === '') return;
 const res = await updateUser(user.id, { password: pw }, actor);
 if (!res.ok) {
 alert(res.error);
 return;
 }
 alert('Password updated.');
 }
 }

 _applyPriceVisibility() {
 const block = $('priceBlock');
 const value = $('headerPrice');
 if (!block) return;
 block.classList.toggle('price-hidden', !!this._priceHidden);
 block.title = this._priceHidden
 ? 'Price hidden — triple-click to show again'
 : 'Triple-click to hide price (customer demo)';
 // When hidden, keep the center target visible but mask the number
 if (value && this._priceHidden) {
 value.textContent = '••••••';
 }
 }

 _setHeaderPrice(amount) {
 const value = $('headerPrice');
 if (!value) return;
 if (this._priceHidden) {
 value.textContent = '••••••';
 } else {
 value.textContent = money(amount);
 }
 }

 _togglePriceVisibility() {
 this._priceHidden = !this._priceHidden;
 try {
 localStorage.setItem(PRICE_HIDDEN_KEY, this._priceHidden ? '1' : '0');
 } catch (_) {}
 this._applyPriceVisibility();
 // Restore real amount when showing again
 if (!this._priceHidden && this._lastTakeoff) {
 this._setHeaderPrice(this._lastTakeoff.total);
 }
 if ($('hint')) {
 $('hint').textContent = this._priceHidden
 ? 'Calculated price hidden for customer view — triple-click the center price to show.'
 : 'Calculated price shown.';
 }
 }

 _defaultProject() {
 // Starting default: 30×40×12, 3' embed, 10' posts, 2' girt/purlin, 5' truss, 3" metal OH
 return createProject({
 customer: 'Customer Name',
 project: '30x40 Shop',
 location: 'Oklahoma',
 buildings: [
 createBuilding({
 name: 'Main Building',
 width: 30,
 length: 40,
 eaveHeight: 12,
 pitch: 4,
 postSpacing: 10,
 postDepthFt: 3,
 trussSpacing: 5,
 girtSpacingIn: 24,
 purlinSpacingIn: 24,
 girtSize: '2x6',
 purlinSize: '2x4',
 skirtSize: '2x6',
 trussCarrierSize: '2x10',
 overhangIn: 0,
 metalOverhangIn: 3,
 roofColor: 'BK',
 wallColor: 'AL',
 trimColor: 'BK',
 wainscotColor: 'NONE',
 wainscotHeightFt: 3,
 insulation: 'none',
 hasSlab: false,
 openings: [],
 }),
 ],
 });
 }

 activeBuilding() {
 return (
 this.project.buildings.find((b) => b.id === this.project.activeBuildingId) ||
 this.project.buildings[0]
 );
 }

 _bind() {
 // Job fields
 ['customer', 'project', 'location', 'laborSq', 'markup', 'freightMiles', 'salesTaxPct'].forEach((id) => {
 $(id)?.addEventListener('input', () => {
 this._pushUndoCoalesced('Job details');
 this.project.customer = $('customer').value;
 this.project.project = $('project').value;
 this.project.location = $('location').value;
 this.project.laborPerSqFt = num('laborSq');
 this.project.markupPct = num('markup');
 if ($('freightMiles')) {
 this.project.freightMiles = Math.max(0, num('freightMiles'));
 }
 if ($('salesTaxPct')) {
 this.project.salesTaxPct = Math.max(0, num('salesTaxPct'));
 }
 this.refresh({ rebuildScene: false });
 });
 $(id)?.addEventListener('change', () => {
 if (id === 'freightMiles' && $('freightMiles')) {
 this.project.freightMiles = Math.max(0, num('freightMiles'));
 this.refresh({ rebuildScene: false });
 }
 if (id === 'salesTaxPct' && $('salesTaxPct')) {
 this.project.salesTaxPct = Math.max(0, num('salesTaxPct'));
 this.refresh({ rebuildScene: false });
 }
 });
 });

 // CRM sales board
 this._bindCrmBoardUi();

 const shellIds = [
 'bName',
 'width',
 'length',
 'height',
 'pitch',
 'postSpacing',
 'postDepth',
 'trussSpacing',
 'trussCarrier',
 'girtSpacing',
 'purlinSpacing',
 'girtSize',
 'purlinSize',
 'skirtSize',
 'postProtectors',
 'permaColumns',
 'sidewallMetal',
 'overhang',
 'metalOverhang',
 'freightMiles',
 'salesTaxPct',
 'roofStyle',
 'wallColor',
 'roofColor',
 'wallGauge',
 'roofGauge',
 'trimColor',
 'wainscotColor',
 'wainscotHeight',
 'insulation',
 'insulationType',
 'hasSlab',
 'slab',
 'siteX',
 'siteZ',
 ];
 shellIds.forEach((id) => {
 $(id)?.addEventListener('input', () => {
 this._pushUndoCoalesced('Building edit');
 this._applyFormToActive();
 this._updateColorSwatches();
 this.refresh();
 });
 $(id)?.addEventListener('change', () => {
 this._pushUndoCoalesced('Building edit');
 this._applyFormToActive();
 this._updateColorSwatches();
 this.refresh();
 });
 });

 $('undoBtn')?.addEventListener('click', () => this._undo());
 document.addEventListener('keydown', (ev) => {
 const mod = ev.metaKey || ev.ctrlKey;
 if (!mod || (ev.key !== 'z' && ev.key !== 'Z')) return;
 if (ev.shiftKey) return; // leave redo free for later
 const tag = (ev.target?.tagName || '').toLowerCase();
 // Allow undo even from inputs when using Ctrl/Cmd+Z (design undo, not text)
 // Skip if user is typing in login
 if ($('loginScreen')?.style.display === 'flex') return;
 if (!this.session || !this._booted) return;
 if (this._undoStack.length === 0) return;
 // If focused in a text field and browser would undo text, still do design undo
 // when stack has entries (design tool priority)
 ev.preventDefault();
 this._undo();
 });

 // Openings
 const applyPresetToFields = () => {
 const id = $('openPreset')?.value;
 if (!id || id === 'custom') {
 if ($('openCustomRow')) $('openCustomRow').style.display = 'grid';
 this._syncOpeningSillUi();
 return;
 }
 if ($('openCustomRow')) $('openCustomRow').style.display = 'none';
 const p = OPENING_PRESETS.find((x) => x.id === id);
 if (!p) return;
 if ($('openType')) $('openType').value = p.type;
 if ($('openW')) $('openW').value = p.width;
 if ($('openH')) $('openH').value = p.height;
 if ($('openSill')) {
 $('openSill').value = p.sillHeight ?? (p.type === 'window' ? 3 : 0);
 }
 this._syncOpeningSillUi();
 };
 $('openPreset')?.addEventListener('change', applyPresetToFields);
 $('openType')?.addEventListener('change', () => {
 // Default sill when switching type in custom mode
 const t = $('openType')?.value;
 if ($('openSill') && (t === 'walk' || t === 'overhead' || t === 'slider')) {
 if (num('openSill') > 0.5) $('openSill').value = 0;
 } else if ($('openSill') && t === 'window' && num('openSill') < 0.5) {
 $('openSill').value = 3;
 }
 this._syncOpeningSillUi();
 });
 const syncOffsetUi = () => {
 this._syncOpeningOffsetUi();
 // If an opening is selected, re-express its position in the new measure mode
 const b = this.activeBuilding();
 const id = this.scene?.selectedOpeningId;
 const o = b?.openings?.find((x) => x.id === id);
 if (o && $('openX')) {
 const wallLen = openingHostLength(b, o);
 $('openX').value = this._openingUiDistanceFromOffset(
 o.offset ?? 0,
 wallLen,
 o.width,
 );
 }
 };
 $('openFrom')?.addEventListener('change', syncOffsetUi);
 $('openTo')?.addEventListener('change', syncOffsetUi);
 $('openCenterSide')?.addEventListener('change', syncOffsetUi);
 applyPresetToFields();
 this._syncOpeningOffsetUi();
 this._syncOpeningSillUi();

 $('addOpeningBtn')?.addEventListener('click', () => {
 const b = this.activeBuilding();
 if (!b) return;
 const draft = this._currentOpeningDraft();
 const host = $('openHost')?.value || 'main';
 const wall = $('openWall')?.value || 'front';
 const wallLen =
 host === 'main'
 ? wall === 'front' || wall === 'back'
 ? b.width
 : b.length
 : openingHostLength(b, { host, wall, face: $('openFace')?.value || 'outer' });
 const offset = this._openingOffsetFromUi(wallLen, draft.width);
 this._pushUndo('Add opening');
 const op = createOpening({
 ...draft,
 wall,
 offset,
 sillHeight: draft.sillHeight,
 host: host === 'main' ? 'main' : host,
 face: host === 'main' ? 'main' : $('openFace')?.value || 'outer',
 });
 if (!Array.isArray(b.openings)) b.openings = [];
 b.openings.push(op);
 this.scene.selectedOpeningId = op.id;
 if (!this.scene.showMetal) {
 this.scene.showMetal = true;
 }
 this._syncViewBar();
 this.refresh();
 this._showInsp('doors');
 $('hint').textContent = `Added ${OPENING_TYPES[draft.type]?.label || draft.type} ${formatOpeningSize(draft.width, draft.height)} on ${wall}${draft.type === 'window' ? `, sill ${draft.sillHeight}'` : ''} · ${this._describeOffset(offset, wallLen, draft.width)}.`;
 });

 $('updateOpeningBtn')?.addEventListener('click', () => {
 const b = this.activeBuilding();
 const id = this.scene?.selectedOpeningId;
 const o = b?.openings?.find((x) => x.id === id);
 if (!o) {
 alert('Select an opening in the list (or click it in 3D) first.');
 return;
 }
 this._pushUndo('Update opening');
 const draft = this._currentOpeningDraft();
 o.type = draft.type;
 o.width = draft.width;
 o.height = draft.height;
 o.sillHeight = draft.sillHeight ?? 0;
 o.wall = $('openWall')?.value || o.wall;
 const host = $('openHost')?.value || 'main';
 o.host = host === 'main' ? 'main' : host;
 o.face = host === 'main' ? 'main' : $('openFace')?.value || o.face || 'outer';
 const wallLen = openingHostLength(b, o);
 o.offset = this._openingOffsetFromUi(wallLen, o.width);
 this.refresh();
 $('hint').textContent = `Updated → ${formatOpeningSize(o.width, o.height)}${o.type === 'window' ? ` sill ${o.sillHeight}'` : ''} on ${o.wall} · ${this._describeOffset(o.offset, wallLen, o.width)}.`;
 });

 const startPlaceMode = () => {
 const draft = this._currentOpeningDraft();
 this.scene.setPlaceOpeningDraft(draft);
 this.scene.setMode('place-opening');
 this._setModeButtons('place');
 this._showInsp('doors');
 if (!this.scene.showMetal) {
 this.scene.showMetal = true;
 this.scene.rebuild();
 this._syncViewBar();
 }
 $('hint').textContent = `Click a wall to place ${OPENING_TYPES[draft.type]?.label || draft.type} (${formatOpeningSize(draft.width, draft.height)}).`;
 };
 $('placeOpeningBtn')?.addEventListener('click', startPlaceMode);
 $('placeOpeningBtnPanel')?.addEventListener('click', startPlaceMode);

 $('moveOpeningBtn')?.addEventListener('click', () => {
 this.scene.setMode('move-opening');
 this._setModeButtons('move');
 this._showInsp('doors');
 $('hint').textContent = 'Drag an opening along its wall. Release to commit.';
 });

 // Open Wall: click gable or eave face to toggle drive-through
 $('openWallBtn')?.addEventListener('click', () => {
 if (!this.scene) return;
 this.scene.setPlaceOpeningDraft(null);
 this.scene.setPlacePropDraft(null);
 this.scene.setMode('open-wall');
 this._setModeButtons('open-wall');
 this._showInsp('main');
 // Ensure pickable wall faces exist
 if (!this.scene.showMetal) {
 this.scene.showMetal = true;
 this.scene.rebuild();
 this._syncViewBar();
 }
 $('hint').textContent =
 'Open Wall: click a main wall or enclosed lean-to face (outer/end) to open or close. Esc to cancel.';
 });

 // Background props palette
 const startPlaceProp = (type) => {
 if (!SITE_PROP_TYPES[type]) return;
 this.scene.setPlacePropDraft({ type });
 this.scene.setMode('place-prop');
 this._setModeButtons('prop');
 this._showInsp('background');
 document.querySelectorAll('.prop-chip').forEach((b) => {
 b.classList.toggle('active', b.dataset.prop === type);
 });
 const label = SITE_PROP_TYPES[type].label;
 if ($('propPlaceHint')) {
 $('propPlaceHint').textContent = `Click the ground to place: ${label}. Esc or Cancel to stop.`;
 }
 $('hint').textContent = `Background: click ground to place ${label}.`;
 };
 $('backgroundBtn')?.addEventListener('click', () => {
 this._showInsp('background');
 this.scene.setMode('orbit');
 this._setModeButtons('orbit');
 $('hint').textContent = 'Background: pick a person, animal, or truck, then click the ground.';
 });
 document.querySelectorAll('.prop-chip').forEach((btn) => {
 btn.addEventListener('click', () => startPlaceProp(btn.dataset.prop));
 });
 $('propCancelPlace')?.addEventListener('click', () => {
 this.scene.setPlacePropDraft(null);
 this.scene.setMode('orbit');
 this._setModeButtons('orbit');
 document.querySelectorAll('.prop-chip').forEach((b) => b.classList.remove('active'));
 if ($('propPlaceHint')) $('propPlaceHint').textContent = 'Select something above to start placing.';
 $('hint').textContent = 'Orbit mode.';
 });
 $('propApplySelected')?.addEventListener('click', () => {
 const p = this._selectedProp();
 if (!p) {
 alert('Select a background item in the list first (or click it in 3D).');
 return;
 }
 this._pushUndo('Edit background item');
 p.rotationDeg = num('propRot');
 p.scale = Math.max(0.4, Math.min(2.5, num('propScale') || 1));
 this.refresh();
 $('hint').textContent = `Updated ${p.label || p.type}.`;
 });
 $('propClearAll')?.addEventListener('click', () => {
 if (!(this.project.props || []).length) return;
 if (!confirm('Remove all background people, animals, and vehicles?')) return;
 this._pushUndo('Clear background');
 this.project.props = [];
 this.selectedPropId = null;
 this.scene.selectedPropId = null;
 this.refresh();
 });

 $('orbitBtn')?.addEventListener('click', () => {
 this.scene.setPlacePropDraft(null);
 document.querySelectorAll('.prop-chip').forEach((b) => b.classList.remove('active'));
 this.scene.setMode('orbit');
 this._setModeButtons('orbit');
 $('hint').textContent =
 'Orbit: drag rotate · scroll zoom · right-drag pan · drag under the building to view from below';
 });

 const applyView = () => {
 this.scene.rebuild();
 this._syncViewBar();
 $('skinToggle')?.classList.toggle('mode-on', this.scene.showMetal);
 $('frameToggle')?.classList.toggle('mode-on', this.scene.showFraming);
 };

 $('frameToggle')?.addEventListener('click', () => {
 this.scene.showFraming = !this.scene.showFraming;
 // If both off, force frame on so you always see something
 if (!this.scene.showMetal && !this.scene.showFraming) this.scene.showFraming = true;
 applyView();
 $('hint').textContent = this.scene.showFraming
 ? 'Frame ON — posts, trusses (tan), girts (green), purlins (blue), bearers (orange).'
 : 'Frame OFF.';
 });
 $('skinToggle')?.addEventListener('click', () => {
 this.scene.showMetal = !this.scene.showMetal;
 if (!this.scene.showMetal && !this.scene.showFraming) this.scene.showFraming = true;
 applyView();
 $('hint').textContent = this.scene.showMetal
 ? 'Skin ON — ag panel walls & roof.'
 : 'Skin OFF — frame only.';
 });
 $('frameAllBtn')?.addEventListener('click', () => this.scene.frameAll());
 $('heroBtn')?.addEventListener('click', () => {
 this.scene.heroShot();
 $('hint').textContent = 'Hero angle set — great for estimate screenshots.';
 });
 $('orbitSpinBtn')?.addEventListener('click', () => {
 const on = !this.scene.autoOrbit;
 this.scene.setAutoOrbit(on);
 $('orbitSpinBtn')?.classList.toggle('mode-on', on);
 $('hint').textContent = on ? 'Auto-spin on — click Spin again to stop.' : 'Auto-spin off.';
 });
 $('screenshotBtn')?.addEventListener('click', async () => {
 $('hint').textContent = 'Rendering 1920×1080 estimate image…';
 try {
 await this.scene.captureScreenshot({
 width: 1920,
 height: 1080,
 brand: true,
 filename: `${slug(this.project.project || 'building')}-render.png`,
 });
 $('hint').textContent = 'Screenshot saved — attach it to your estimate.';
 } catch (err) {
 console.error(err);
 $('hint').textContent = 'Screenshot failed: ' + err.message;
 }
 });
 $('presentBtn')?.addEventListener('click', () => {
 const on = !document.body.classList.contains('presenting');
 document.body.classList.toggle('presenting', on);
 this.scene.setPresentationMode(on);
 $('presentBtn')?.classList.toggle('mode-on', on);
 if (on) {
 this.scene.showFraming = false;
 this.scene.showMetal = true;
 this.scene.rebuild();
 this.scene.heroShot();
 this.scene.setAutoOrbit(true);
 $('orbitSpinBtn')?.classList.add('mode-on');
 $('hint').textContent = 'Presentation mode — Screenshot when the angle looks right.';
 } else {
 this.scene.setAutoOrbit(false);
 $('orbitSpinBtn')?.classList.remove('mode-on');
 $('hint').textContent = 'Exited presentation mode.';
 }
 this._syncViewBar();
 window.dispatchEvent(new Event('resize'));
 });

 // View bar presets
 $('viewShell')?.addEventListener('click', () => {
 this.scene.showMetal = true;
 this.scene.showFraming = false;
 applyView();
 $('hint').textContent = 'Skin only — customer-facing metal look.';
 });
 $('viewFrame')?.addEventListener('click', () => {
 this.scene.showMetal = false;
 this.scene.showFraming = true;
 applyView();
 $('hint').textContent =
 'Frame only — posts, trusses, girts, purlins (main + lean-to metal off).';
 });
 $('viewBoth')?.addEventListener('click', () => {
 this.scene.showMetal = true;
 this.scene.showFraming = true;
 applyView();
 $('hint').textContent = 'Skin + Frame — structure under metal.';
 });

 const openAttachModal = (presetKind) => {
 const modal = $('attachModal');
 if (!modal) return;
 modal.style.display = 'flex';
 if (presetKind && $('attKind')) {
 $('attKind').value = presetKind;
 }
 this._syncAttachModal();
 };
 const closeAttachModal = () => {
 const modal = $('attachModal');
 if (modal) modal.style.display = 'none';
 };

 $('addBuildingBtn')?.addEventListener('click', () => openAttachModal('leanto'));
 $('openAttachBtn')?.addEventListener('click', () => openAttachModal('leanto'));
 $('attachModalClose')?.addEventListener('click', closeAttachModal);
 $('attCancel')?.addEventListener('click', closeAttachModal);
 $('attachModal')?.addEventListener('click', (e) => {
 if (e.target === $('attachModal')) closeAttachModal();
 });

 $('attKind')?.addEventListener('change', () => this._syncAttachModal());
 $('attRoof')?.addEventListener('change', () => {
 // Keep kind in sync when user picks roof style
 const roof = $('attRoof')?.value;
 if ($('attKind')?.value === 'separate') return;
 if (roof === 'gable' && $('attKind')) $('attKind').value = 'gable-extension';
 if (roof === 'shed' && $('attKind')) $('attKind').value = 'leanto';
 this._syncAttachModal();
 });

 $('attConfirm')?.addEventListener('click', () => {
 const kind = $('attKind')?.value || 'leanto';
 if (kind === 'separate') {
 this._pushUndo('Add separate building');
 const n = this.project.buildings.length + 1;
 const b = createBuilding({
 name: $('attSepName')?.value || `Building ${n}`,
 width: num('attSepW') || 30,
 length: num('attSepL') || 40,
 eaveHeight: num('attSepH') || 12,
 roofStyle: $('attSepRoof')?.value === 'mono' ? 'mono' : 'gable',
 siteX: num('attSepX'),
 siteZ: num('attSepZ'),
 });
 this.project.buildings.push(b);
 this.project.activeBuildingId = b.id;
 this._syncFormFromActive();
 closeAttachModal();
 this.refresh();
 this.scene.frameAll();
 $('hint').textContent = `Added separate building "${b.name}" on site.`;
 return;
 }

 const roofStyle = $('attRoof')?.value === 'gable' ? 'gable' : 'shed';
 const resolvedKind = roofStyle === 'gable' ? 'gable-extension' : 'leanto';
 const b = this.activeBuilding();
 this._pushUndo(roofStyle === 'gable' ? 'Add gable extension' : 'Add lean-to');
 const enclosed = $('attEnclosed')?.value !== 'open';
 const depth = num('attDepth') || 12;
 const pitch = num('attPitch') || b.pitch || 4;
 // Default outer eave = main eave − depth×pitch/12 (shed drop), min 8'
 const defaultLeanEave = Math.max(
 8,
 Math.round((b.eaveHeight - depth * (pitch / 12)) * 12) / 12,
 );
 const att = createLeanTo({
 kind: resolvedKind,
 roofStyle,
 name: $('attName')?.value || (roofStyle === 'gable' ? 'Gable extension' : 'Lean-to'),
 wall: $('attWall')?.value || 'left',
 depth,
 length: num('attLength') || 0,
 offset: num('attOffset') || 0,
 eaveHeight: num('attHeight') || defaultLeanEave,
 pitch,
 snapToPosts: $('attSnap')?.value === 'yes',
 // Leans default to 10' o.c. independently of main building spacing
 postSpacing: Math.max(4, num('attPostSp') || 10),
 enclosed,
 overhangIn: num('attOverhang') || 0,
 metalOverhangIn: $('attMetalOh') ? num('attMetalOh') : 3,
 ceilingLiner: $('attLiner')?.value === 'yes' ? 'yes' : 'none',
 hasSlab: $('attSlab')?.value === 'yes',
 slabThicknessIn: Math.max(0, num('attSlabThk') || b.slabThicknessIn || 4),
 _mainEaveHeight: b.eaveHeight,
 _mainPitch: b.pitch,
 _mainSlabThicknessIn: b.slabThicknessIn,
 });
 b.leanTos.push(att);
 this.selectedLeanToId = att.id;
 this._refreshOpenHostOptions();
 closeAttachModal();
 if (!this.scene.showMetal) this.scene.showMetal = true;
 this.refresh();
 this.scene.heroShot();
 const encLabel = att.enclosed ? 'enclosed' : 'open';
 $('hint').textContent = `Added ${att.name}: ${encLabel}, ${att.depth}' deep, ${att.roofStyle} roof @ ${att.pitch}/12 on ${att.wall} wall. Edit it in Details.`;
 this._showInsp('details');
 });

 $('saveBtn')?.addEventListener('click', () => {
 this._openSaveModal();
 });
 $('loadBtn')?.addEventListener('click', () => {
 this._openLoadModal();
 });

 // Save job form
 $('saveJobClose')?.addEventListener('click', () => this._closeSaveModal());
 $('saveJobCancel')?.addEventListener('click', () => this._closeSaveModal());
 $('saveJobModal')?.addEventListener('click', (ev) => {
 if (ev.target === $('saveJobModal')) this._closeSaveModal();
 });
 $('saveJobForm')?.addEventListener('submit', async (ev) => {
 ev.preventDefault();
 const jobName = ($('saveJobName')?.value || '').trim();
 const customer = ($('saveJobCustomer')?.value || '').trim();
 const address = ($('saveJobAddress')?.value || '').trim();
 if (!jobName) {
 alert('Enter a job name.');
 $('saveJobName')?.focus();
 return;
 }
 if (!address) {
 alert('Enter an address / site location.');
 $('saveJobAddress')?.focus();
 return;
 }
 this._tickSaveTimestamp();
 const savedAt = $('saveJobTimestamp')?.dataset?.iso || new Date().toISOString();
 const ok = await this._saveJobToStorage({
 silent: false,
 meta: { jobName, customer, address, savedAt },
 });
 if (ok) this._closeSaveModal();
 });

 // Unsaved changes before load / new job
 $('unsavedJobClose')?.addEventListener('click', () => {
 this._pendingLeaveAction = null;
 this._closeUnsavedModal();
 });
 $('unsavedJobCancel')?.addEventListener('click', () => {
 this._pendingLeaveAction = null;
 this._closeUnsavedModal();
 });
 $('unsavedJobDiscard')?.addEventListener('click', () => {
 this._runPendingLeaveAction();
 });
 $('unsavedJobSave')?.addEventListener('click', () => {
 // Keep _pendingLeaveAction; save modal success will run it
 this._closeUnsavedModal();
 this._openSaveModal();
 });
 $('unsavedJobModal')?.addEventListener('click', (ev) => {
 if (ev.target === $('unsavedJobModal')) {
 this._pendingLeaveAction = null;
 this._closeUnsavedModal();
 }
 });

 // Job library (LOAD) screen
 $('jobLibraryClose')?.addEventListener('click', () => this._closeLoadModal());
 $('jobLibraryEmptyClose')?.addEventListener('click', () => this._closeLoadModal());
 $('jobLibraryNewBtn')?.addEventListener('click', () => this._startNewJob());
 $('jobLibraryEmptyNew')?.addEventListener('click', () => this._startNewJob());
 $('jobLibrarySearch')?.addEventListener('input', () => this._renderJobLibrary());
 $('jobLibraryModal')?.addEventListener('click', (ev) => {
 if (ev.target === $('jobLibraryModal')) this._closeLoadModal();
 });

 // Accounts (admin)
 $('accountsBtn')?.addEventListener('click', () => this._openAccountsModal());
 $('accountsClose')?.addEventListener('click', () => this._closeAccountsModal());
 $('accountsModal')?.addEventListener('click', (ev) => {
 if (ev.target === $('accountsModal')) this._closeAccountsModal();
 });
 $('addUserForm')?.addEventListener('submit', async (ev) => {
 ev.preventDefault();
 const errEl = $('addUserError');
 if (errEl) {
 errEl.style.display = 'none';
 errEl.textContent = '';
 }
 const result = await createUser(
 {
 name: $('newUserName')?.value,
 email: $('newUserEmail')?.value,
 password: $('newUserPassword')?.value,
 role: $('newUserRole')?.value,
 },
 this.session,
 );
 if (!result.ok) {
 if (errEl) {
 errEl.textContent = result.error || 'Could not create account.';
 errEl.style.display = 'block';
 }
 return;
 }
 if ($('newUserName')) $('newUserName').value = '';
 if ($('newUserEmail')) $('newUserEmail').value = '';
 if ($('newUserPassword')) $('newUserPassword').value = '';
 if ($('newUserRole')) $('newUserRole').value = 'user';
 this._renderAccountsList();
 $('hint').textContent = `Account created: ${result.user.email}`;
 });

 document.addEventListener('keydown', (ev) => {
 if (ev.key !== 'Escape') return;
 if ($('accountsModal')?.style.display !== 'none' && $('accountsModal')?.style.display) {
 this._closeAccountsModal();
 return;
 }
 if ($('unsavedJobModal')?.style.display !== 'none' && $('unsavedJobModal')?.style.display) {
 this._pendingLeaveAction = null;
 this._closeUnsavedModal();
 return;
 }
 if ($('saveJobModal')?.style.display !== 'none' && $('saveJobModal')?.style.display) {
 // Cancel leave flow if user was saving before load/new
 this._pendingLeaveAction = null;
 this._closeSaveModal();
 return;
 }
 const modal = $('jobLibraryModal');
 if (modal && modal.style.display !== 'none') {
 this._closeLoadModal();
 return;
 }
 // Cancel place / open-wall modes
 if (
 this.scene?.mode === 'place-prop' ||
 this.scene?.mode === 'place-opening' ||
 this.scene?.mode === 'open-wall' ||
 this.scene?.mode === 'move-opening'
 ) {
 this.scene.setPlacePropDraft(null);
 this.scene.setPlaceOpeningDraft(null);
 this.scene.setMode('orbit');
 this._setModeButtons('orbit');
 document.querySelectorAll('.prop-chip').forEach((b) => b.classList.remove('active'));
 if ($('propPlaceHint')) {
 $('propPlaceHint').textContent = 'Select something above to start placing.';
 }
 $('hint').textContent = 'Orbit mode.';
 }
 });

 // Persist active job when leaving (per user)
 window.addEventListener('beforeunload', () => {
 try {
 if (this.project && this.session) {
 this._persistActiveJob();
 }
 } catch (_) {}
 });

 // Triple-click center Calculated Price → hide/show (customer demos)
 // Uses event.detail (browser click count) — custom counters fight text-selection.
 {
 const block = $('priceBlock');
 if (block) {
 // Stop the browser from selecting the $ amount on multi-click
 block.addEventListener('mousedown', (ev) => {
 if (ev.detail > 1) {
 ev.preventDefault();
 }
 });
 block.addEventListener('selectstart', (ev) => {
 ev.preventDefault();
 });
 block.addEventListener('click', (ev) => {
 // detail = 1 single, 2 double, 3 triple (standard DOM)
 if (ev.detail !== 3) return;
 ev.preventDefault();
 ev.stopPropagation();
 try {
 window.getSelection?.()?.removeAllRanges?.();
 } catch (_) {}
 this._togglePriceVisibility();
 });
 }
 }

 $('exportJsonBtn')?.addEventListener('click', async () => {
 // SAVE AS = download JSON; also library-save with current fields (no form)
 await this._saveJobToStorage({
 silent: true,
 meta: {
 jobName: this.project.project,
 customer: this.project.customer,
 address: this.project.location,
 savedAt: new Date().toISOString(),
 },
 });
 const blob = new Blob([JSON.stringify(this.project, null, 2)], {
 type: 'application/json',
 });
 download(blob, `${slug(this.project.customer || this.project.project)}.json`);
 $('hint').textContent = 'Saved to library and downloaded JSON (SAVE AS).';
 });
 $('exportCsvBtn')?.addEventListener('click', () => {
 const takeoff = this._lastTakeoff || takeoffProject(this.project);
 const csv = toItemListCsv(this.project, takeoff);
 download(new Blob([csv], { type: 'text/csv' }), `${slug(this.project.project)}-item-list.csv`);
 this._openPane('bom');
 });
 $('prodPackageBtn')?.addEventListener('click', () => {
 this._printProductionPackage();
 });
$('runScorecardBtn')?.addEventListener('click', () => {
 this._runScorecard();
 });
 $('sbPasteCompareBtn')?.addEventListener('click', () => {
 this._runSbPasteCompare();
 });
 $('makeQuoteBtn')?.addEventListener('click', () => {
 this._onMakeQuote();
 });
 $('messagesBtn')?.addEventListener('click', () => {
 this._showMessagesModal({ fromQuote: false });
 });
 $('messagesClose')?.addEventListener('click', () => this._hideMessagesModal());
 $('messagesOk')?.addEventListener('click', () => this._onMessagesOk());
 $('messagesModal')?.addEventListener('click', (e) => {
 if (e.target === $('messagesModal')) this._hideMessagesModal();
 });
 $('homeBtn')?.addEventListener('click', () => {
 this._closeAllPanes();
 this._setNav('3d');
 });

 // Catalog
 $('catalogFile')?.addEventListener('change', async (e) => {
 const file = e.target.files?.[0];
 if (!file) return;
 const text = await file.text();
 try {
 const parsed = parseItemListCsv(text);
 if (!parsed.rows.length) {
 alert('No material rows found. Use an Item list with Cost CSV.');
 return;
 }
 const n = applyImport(parsed, file.name);
 this._renderCatalogStats();
 this.refresh({ rebuildScene: false });
 alert(
 `Imported ${parsed.rows.length} rows from ${file.name}\n` +
 `Posts: ${n.posts}, Boards: ${n.boards}, Metal: ${n.metal}, Trim: ${n.trim}`,
 );
 } catch (err) {
 console.error(err);
 alert('Import failed: ' + err.message);
 }
 e.target.value = '';
 });
 $('resetCatalogBtn')?.addEventListener('click', () => {
 if (!confirm('Reset price book to built-in defaults?')) return;
 resetCatalog();
 this._renderCatalogStats();
 this.refresh({ rebuildScene: false });
 });

 // Plans
 $('printPlansBtn')?.addEventListener('click', () => {
 printPlans(this.project, this.project.activeBuildingId);
 });
 $('printProdPackagePlansBtn')?.addEventListener('click', () => {
 this._printProductionPackage();
 });
 $('refreshPlansBtn')?.addEventListener('click', () => this._drawPlans());

 // Nav tabs → overlays / 3d
 document.querySelectorAll('.nav-tabs button').forEach((btn) => {
 btn.addEventListener('click', () => {
 const view = btn.dataset.view;
 this._setNav(view);
 if (view === '3d') this._closeAllPanes();
 else this._openPane(view === 'bom' ? 'bom' : view);
 });
 });

 // Close overlays
 document.querySelectorAll('[data-close]').forEach((btn) => {
 btn.addEventListener('click', () => {
 this._closeAllPanes();
 this._setNav('3d');
 });
 });

 // Inspector tabs
 document.querySelectorAll('.insp-tabs button').forEach((btn) => {
 btn.addEventListener('click', () => this._showInsp(btn.dataset.insp));
 });

 // Job Review section tabs (Summary + categories)
 document.querySelectorAll('#bomCats button').forEach((btn) => {
 btn.addEventListener('click', () => {
 document.querySelectorAll('#bomCats button').forEach((b) => b.classList.remove('active'));
 btn.classList.add('active');
 this._bomCat = btn.getAttribute('data-cat') || btn.dataset.cat || 'summary';
 this._renderBomTable();
 });
 });

 // Sort-by-length toggle (detail tabs only; preference persisted)
 const sortLenCb = $('bomSortByLength');
 if (sortLenCb) {
 sortLenCb.checked = !!this._bomSortByLength;
 sortLenCb.addEventListener('change', () => {
 this._bomSortByLength = !!sortLenCb.checked;
 try {
 localStorage.setItem(BOM_SORT_BY_LENGTH_KEY, this._bomSortByLength ? '1' : '0');
 } catch (_) {
 /* ignore quota / private mode */
 }
 this._renderBomTable();
 });
 }

 $('openHost')?.addEventListener('change', () => {
 const isMain = $('openHost').value === 'main';
 if ($('openFaceRow')) $('openFaceRow').style.display = isMain ? 'none' : 'grid';
 if ($('openWall')) $('openWall').disabled = !isMain;
 });
 }

 _setNav(view) {
 document.querySelectorAll('.nav-tabs button').forEach((b) => {
 b.classList.toggle('active', b.dataset.view === view);
 });
 }

 _openPane(name) {
 this._closeAllPanes();
 const pane = $(`pane-${name}`);
 if (pane) pane.classList.add('open');
 if (name === 'plans') this._drawPlans();
 if (name === 'catalog') this._renderCatalogStats();
 if (name === 'bom') {
 // Always refresh takeoff when opening Job Review
 try {
        if (this.project) this._lastTakeoff = takeoffProject(this.project);
      } catch (err) {
 console.error('Job Review takeoff failed', err);
 }
 // Ensure a valid tab is selected
 if (!this._bomCat) this._bomCat = 'summary';
 // Sync active cat button + toggles
 document.querySelectorAll('#bomCats button').forEach((b) => {
 b.classList.toggle('active', b.dataset.cat === this._bomCat);
 });
 const sortLenCb = $('bomSortByLength');
 if (sortLenCb) sortLenCb.checked = !!this._bomSortByLength;
 this._renderBomTable();
 }
 if (name === 'crm') this._renderSalesBoard();
 }

 _crmUserId() {
 return this.session?.userId || this.session?.email || 'local';
 }

 async _ensureSalesBoard() {
 if (!this._salesBoard) {
 this._salesBoard = await loadBoard(this._crmUserId());
 }
 return this._salesBoard;
 }

 _getSalesBoard() {
 return this._salesBoard || { columns: [], cards: [] };
 }

 _persistSalesBoard() {
 const board = this._salesBoard;
 if (!board || !isVaultUnlocked()) return;
 saveBoard(this._crmUserId(), board).catch((err) =>
 console.warn('CRM save failed', err),
 );
 if (this._cloudSession || this.session?.cloud) {
 cloudPutCrm(board).catch((err) => console.warn('CRM cloud sync failed', err));
 }
 }

 /** Shareable job URL (uses project id). */
 _jobShareLink() {
 const id = this.project?.id || '';
 try {
 const base = `${location.origin}${location.pathname}`;
 return `${base}?job=${encodeURIComponent(id)}`;
 } catch {
 return `http://localhost:5173/?job=${encodeURIComponent(id)}`;
 }
 }

 _bindCrmBoardUi() {
 if (this._crmBoardBound) return;
 this._crmBoardBound = true;

 $('crmAddCardBtn')?.addEventListener('click', () => {
 this._openCrmCardModal(null);
 });
 $('crmAddFromJobBtn')?.addEventListener('click', () => {
 this._addCurrentJobToBoard();
 });
 $('crmCardModalClose')?.addEventListener('click', () => this._closeCrmCardModal());
 $('crmCardCancel')?.addEventListener('click', () => this._closeCrmCardModal());
 $('crmCardModal')?.addEventListener('click', (ev) => {
 if (ev.target === $('crmCardModal')) this._closeCrmCardModal();
 });
 $('crmCardSave')?.addEventListener('click', () => this._saveCrmCardModal());
 $('crmCardDelete')?.addEventListener('click', () => this._deleteCrmCardFromModal());
 }

 async _renderSalesBoard() {
 await this._ensureSalesBoard();
 const board = this._getSalesBoard();
 const el = $('salesBoard');
 if (!el) return;

 // Refresh days-in-stage display from stageEnteredAt
 for (const c of board.cards) {
 c.daysInStage = daysSince(c.stageEnteredAt || c.createdAt);
 }

 el.innerHTML = board.columns
 .map((col) => {
 const cards = cardsInColumn(board, col.id);
 const cardsHtml = cards.length
 ? cards.map((c) => this._salesCardHtml(c, col)).join('')
          : `<div class="sb-empty">Drop cards here</div>`;
        return `<div class="sb-column" data-col="${esc(col.id)}">
          <div class="sb-column-head">
            <div class="sb-column-title">${esc(col.title)} <span class="sb-column-count">${cards.length}</span></div>
            <div class="sb-column-sub">${esc(col.subtitle || '')}</div>
 </div>
          <div class="sb-column-cards" data-col="${esc(col.id)}">${cardsHtml}</div>
 </div>`;
 })
 .join('');

 this._bindSalesBoardDnD(el);
 }

 _salesCardHtml(card, col) {
 const path = `${card.pipeline || 'Residential Retail'} -> ${col?.title || card.stage}`;
 const avatars = (card.assignees?.length
 ? card.assignees
 : card.salesman
 ? [initials(card.salesman)]
 : ['?']
 ).slice(0, 3);
 const avatarHtml = avatars
 .map(
 (a) =>
          `<span class="sb-avatar" style="background:${avatarColor(a)}" title="${esc(a)}">${esc(a)}</span>`,
 )
 .join('');
 const days = card.daysInStage ?? daysSince(card.stageEnteredAt);
 const docs = `${card.docsDone ?? 0}/${card.docsTotal ?? 0}`;
 const calls = card.calls ?? 0;
 const link = card.jobLink
      ? `<a class="sb-card-link" href="${esc(card.jobLink)}" target="_blank" rel="noopener" draggable="false">↗ Job link</a>`
 : '';
    return `<div class="sb-card" draggable="true" data-card-id="${esc(card.id)}" data-stage="${esc(card.stage)}">
      <div class="sb-card-name">${esc(card.name)}</div>
      <div class="sb-card-path" title="${esc(path)}">${esc(path)}</div>
      <div class="sb-card-meta">
        <div class="sb-avatars">${avatarHtml}</div>
        <div class="sb-stats">
          <span class="sb-stat" title="Days in stage">⏱ <strong>${days}</strong></span>
          <span class="sb-stat" title="Docs">📄 <strong>${esc(docs)}</strong></span>
          <span class="sb-stat" title="Calls">📞 <strong>${calls}</strong></span>
 </div>
 </div>
 ${link}
 </div>`;
 }

 _bindSalesBoardDnD(root) {
 let dragId = null;

    root.querySelectorAll('.sb-card').forEach((card) => {
 card.addEventListener('dragstart', (ev) => {
 dragId = card.dataset.cardId;
        card.classList.add('sb-dragging');
 ev.dataTransfer.effectAllowed = 'move';
 ev.dataTransfer.setData('text/plain', dragId);
 });
 card.addEventListener('dragend', () => {
        card.classList.remove('sb-dragging');
        root.querySelectorAll('.sb-column-cards').forEach((z) => z.classList.remove('sb-drag-over'));
 dragId = null;
 });
 card.addEventListener('dblclick', (ev) => {
 ev.preventDefault();
 this._openCrmCardModal(card.dataset.cardId);
 });
 // Prevent link from starting drag weirdness
 card.querySelector('a')?.addEventListener('click', (ev) => ev.stopPropagation());
 });

    root.querySelectorAll('.sb-column-cards').forEach((zone) => {
 zone.addEventListener('dragover', (ev) => {
 ev.preventDefault();
 ev.dataTransfer.dropEffect = 'move';
        zone.classList.add('sb-drag-over');
 });
      zone.addEventListener('dragleave', () => zone.classList.remove('sb-drag-over'));
 zone.addEventListener('drop', (ev) => {
 ev.preventDefault();
        zone.classList.remove('sb-drag-over');
 const id = ev.dataTransfer.getData('text/plain') || dragId;
 if (!id) return;
 const toStage = zone.dataset.col;
 // Drop before card under cursor if any
        const overCard = ev.target.closest?.('.sb-card');
 const beforeId = overCard && overCard.dataset.cardId !== id ? overCard.dataset.cardId : null;
 const board = this._getSalesBoard();
 moveCard(board, id, toStage, beforeId);
 this._persistSalesBoard();
 this._renderSalesBoard();
 });
 });
 }

 _openCrmCardModal(cardId) {
 const board = this._getSalesBoard();
 const card = cardId ? board.cards.find((c) => c.id === cardId) : null;
 const stageSel = $('crmCardStage');
 if (stageSel) {
 stageSel.innerHTML = board.columns
 .map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`)
 .join('');
 }
 if ($('crmCardModalTitle')) {
 $('crmCardModalTitle').textContent = card ? 'Edit card' : 'New lead card';
 }
 if ($('crmCardId')) $('crmCardId').value = card?.id || '';
 if ($('crmCardName')) $('crmCardName').value = card?.name || '';
 if ($('crmCardStage')) $('crmCardStage').value = card?.stage || board.columns[0]?.id || 'leads';
 if ($('crmCardSalesman')) $('crmCardSalesman').value = card?.salesman || '';
 if ($('crmCardPipeline')) {
 $('crmCardPipeline').value = card?.pipeline || 'Residential Retail';
 }
 if ($('crmCardAddress')) $('crmCardAddress').value = card?.address || '';
 if ($('crmCardState')) $('crmCardState').value = card?.state || '';
 if ($('crmCardJobLink')) $('crmCardJobLink').value = card?.jobLink || '';
 if ($('crmCardNotes')) $('crmCardNotes').value = card?.notes || '';
 if ($('crmCardDelete')) $('crmCardDelete').style.display = card ? '' : 'none';
 const modal = $('crmCardModal');
 if (modal) modal.style.display = 'flex';
 }

 _closeCrmCardModal() {
 const modal = $('crmCardModal');
 if (modal) modal.style.display = 'none';
 }

 _saveCrmCardModal() {
 const board = this._getSalesBoard();
 const id = $('crmCardId')?.value || '';
 const name = ($('crmCardName')?.value || '').trim() || 'New lead';
 const stage = $('crmCardStage')?.value || 'leads';
 const salesman = ($('crmCardSalesman')?.value || '').trim();
 const payload = {
 name,
 stage,
 salesman,
 pipeline: ($('crmCardPipeline')?.value || '').trim() || 'Residential Retail',
 address: ($('crmCardAddress')?.value || '').trim(),
 state: ($('crmCardState')?.value || '').trim(),
 jobLink: ($('crmCardJobLink')?.value || '').trim(),
 notes: ($('crmCardNotes')?.value || '').trim(),
 assignees: salesman ? [initials(salesman)] : [],
 };
 if (id) {
 const card = board.cards.find((c) => c.id === id);
 if (card) {
 const stageChanged = card.stage !== payload.stage;
 Object.assign(card, payload);
 if (stageChanged) {
 card.stageEnteredAt = new Date().toISOString();
 card.daysInStage = 0;
 }
 card.updatedAt = new Date().toISOString();
 }
 } else {
 board.cards.push(createCard(payload));
 }
 this._persistSalesBoard();
 this._closeCrmCardModal();
 this._renderSalesBoard();
 }

 _deleteCrmCardFromModal() {
 const id = $('crmCardId')?.value;
 if (!id) return;
 if (!confirm('Delete this sales card?')) return;
 const board = this._getSalesBoard();
 board.cards = board.cards.filter((c) => c.id !== id);
 this._persistSalesBoard();
 this._closeCrmCardModal();
 this._renderSalesBoard();
 }

 _addCurrentJobToBoard() {
 if (!this.project) return;
 const board = this._getSalesBoard();
 const jobId = this.project.id || '';
 // Avoid duplicate card for same job
 if (jobId && board.cards.some((c) => c.jobId === jobId)) {
 alert('This job is already on the sales board.');
 this._renderSalesBoard();
 return;
 }
 const name =
 this.project.customer ||
 this.project.crm?.name ||
 this.project.project ||
 'Current job';
 const salesman = this.project.crm?.salesman || this.session?.name || '';
 const card = createCard({
 name,
 stage: 'design',
 pipeline: 'Residential Retail',
 salesman,
 assignees: salesman ? [initials(salesman)] : [],
 address: this.project.crm?.address || this.project.location || '',
 state: this.project.crm?.state || '',
 jobId,
 jobLink: this._jobShareLink(),
 notes: this.project.crm?.notes || '',
 });
 board.cards.push(card);
 this._persistSalesBoard();
 this._renderSalesBoard();
 if ($('hint')) {
 $('hint').textContent = `Added “${name}” to Sales Board → In Design.`;
 }
 }

 _closeAllPanes() {
 document.querySelectorAll('.overlay-pane').forEach((p) => p.classList.remove('open'));
 }

 _showInsp(name) {
 document.querySelectorAll('.insp-tabs button').forEach((b) => {
 b.classList.toggle('active', b.dataset.insp === name);
 });
 document.querySelectorAll('.insp-panel').forEach((p) => {
 p.classList.toggle('active', p.id === `insp-${name}`);
 });
 }

 _ensureProps() {
 if (!Array.isArray(this.project.props)) this.project.props = [];
 return this.project.props;
 }

 _selectedProp() {
 if (!this.selectedPropId) return null;
 return this._ensureProps().find((p) => p.id === this.selectedPropId) || null;
 }

 _placeProp(data) {
 if (!data?.type || !SITE_PROP_TYPES[data.type]) return;
 this._pushUndo(`Add ${SITE_PROP_TYPES[data.type].label}`);
 const def = SITE_PROP_TYPES[data.type];
 // Nudge slightly if stacking on same spot
 const props = this._ensureProps();
 let x = data.x;
 let z = data.z;
 const clash = props.some((p) => Math.hypot(p.x - x, p.z - z) < 1.5);
 if (clash) {
 x += 2;
 z += 1;
 }
 const prop = createSiteProp({
 type: data.type,
 x,
 z,
 rotationDeg: def.defaultRot ?? 0,
 });
 props.push(prop);
 this.selectedPropId = prop.id;
 this.scene.selectedPropId = prop.id;
 // Stay in place mode so user can drop multiple of same type
 this.refresh();
 if ($('propRot')) $('propRot').value = prop.rotationDeg;
 if ($('propScale')) $('propScale').value = prop.scale;
 $('hint').textContent = `Placed ${def.label} at (${x}, ${z}). Click again to place another, or Cancel.`;
 }

 _selectProp(data) {
 const id = data?.propId;
 if (!id) return;
 this.selectedPropId = id;
 this.scene.selectedPropId = id;
 const p = this._selectedProp();
 if (p) {
 if ($('propRot')) $('propRot').value = p.rotationDeg ?? 0;
 if ($('propScale')) $('propScale').value = p.scale ?? 1;
 this._showInsp('background');
 $('hint').textContent = `Selected ${p.label || SITE_PROP_TYPES[p.type]?.label || p.type}. Rotate/scale below, or Remove.`;
 }
 this.scene.rebuild();
 this._renderPropsList();
 }

 _renderPropsList() {
 const el = $('propsList');
 if (!el) return;
 const props = this._ensureProps();
 if (!props.length) {
 el.innerHTML = '<div class="small">No background items yet.</div>';
 return;
 }
 el.innerHTML = props
 .map((p) => {
 const label = SITE_PROP_TYPES[p.type]?.label || p.label || p.type;
 const sel = p.id === this.selectedPropId ? ' selected-item' : '';
 return `<div class="list-item${sel}" data-pid="${p.id}">
 <div><b>${esc(label)}</b> @ ${p.x}, ${p.z} · ${p.rotationDeg || 0}°</div>
 <button type="button" class="danger" data-id="${p.id}">Remove</button>
 </div>`;
 })
 .join('');
 el.querySelectorAll('.list-item').forEach((row) => {
 row.addEventListener('click', (ev) => {
 if (ev.target.closest('button')) return;
 this._selectProp({ propId: row.dataset.pid });
 });
 });
 el.querySelectorAll('button.danger').forEach((btn) => {
 btn.addEventListener('click', (ev) => {
 ev.stopPropagation();
 this._pushUndo('Remove background item');
 this.project.props = this._ensureProps().filter((p) => p.id !== btn.dataset.id);
 if (this.selectedPropId === btn.dataset.id) {
 this.selectedPropId = null;
 this.scene.selectedPropId = null;
 }
 this.refresh();
 });
 });
 }

 _setModeButtons(mode) {
 $('orbitBtn')?.classList.toggle('mode-on', mode === 'orbit');
 $('placeOpeningBtn')?.classList.toggle('mode-on', mode === 'place');
 $('moveOpeningBtn')?.classList.toggle('mode-on', mode === 'move');
 $('openWallBtn')?.classList.toggle('mode-on', mode === 'open-wall');
 $('backgroundBtn')?.classList.toggle('mode-on', mode === 'prop');
 }

 /**
   * Apply open/closed state for one main wall (3D or chip).
   */
 _setWallOpenState(building, wall) {
 if (!building || !wall) return null;
 if (!Array.isArray(building.openWalls)) {
 building.openWalls = openWallList(building);
 }
 building.openWalls = toggleOpenWall(building, wall);
 syncSidewallMetalFromOpenWalls(building);
 // Drop openings on a wall that is now open
 if (isWallOpen(building, wall)) {
 building.openings = (building.openings || []).filter(
 (o) => (o.host && o.host !== 'main') || o.wall !== wall,
 );
 }
 return isWallOpen(building, wall);
 }

 /**
   * 3D click while in Open Wall mode — main wall or enclosed lean-to face.
   */
 _toggleOpenWallFrom3D(data) {
 if (data?.miss) {
 $('hint').textContent =
 'Open Wall: click a main wall or an enclosed lean-to face (outer / end). Esc to cancel.';
 return;
 }
 let building =
 this.project.buildings.find((x) => x.id === data.buildingId) ||
 this.activeBuilding();
 if (!building) return;
 if (data.buildingId) this.project.activeBuildingId = data.buildingId;
 building =
 this.project.buildings.find((x) => x.id === data.buildingId) || building;

 // Lean-to face open/close
 if (data.leanToId && data.face) {
 const lt = (building.leanTos || []).find((l) => l.id === data.leanToId);
 if (!lt) {
 $('hint').textContent = 'Lean-to not found.';
 return;
 }
 if (!isLeanEnclosed(lt)) {
 $('hint').textContent =
 'That lean-to is fully open (carport). Set Enclosure to Enclosed to open individual walls.';
 return;
 }
 this._pushUndo('Open lean wall');
 if (!Array.isArray(lt.openFaces)) lt.openFaces = [];
 lt.openFaces = toggleLeanOpenFace(lt, data.face);
 // Drop openings on that face
 if (isLeanFaceOpen(lt, data.face)) {
 building.openings = (building.openings || []).filter(
 (o) => !(o.host === lt.id && (o.face || 'outer') === data.face),
 );
 }
 this._fillFormFromActive();
 this.refresh();
 if (this.scene) {
 this.scene.setMode('open-wall');
 this._setModeButtons('open-wall');
 }
 const fl = LEAN_FACE_LABELS[data.face] || data.face;
 const name = lt.name || 'Lean-to';
 const nowOpen = isLeanFaceOpen(lt, data.face);
 $('hint').textContent = nowOpen
 ? `${name} · ${fl} OPEN (drive-through). Click again to close.`
 : `${name} · ${fl} CLOSED. Click another wall or Esc for Orbit.`;
 return;
 }

 if (!data?.wall) {
 $('hint').textContent =
 'Open Wall: click a main wall or enclosed lean face. Esc to cancel.';
 return;
 }

 this._pushUndo('Open wall');
 const nowOpen = this._setWallOpenState(building, data.wall);
 this._fillFormFromActive();
 this.refresh();
 if (this.scene) {
 this.scene.setMode('open-wall');
 this._setModeButtons('open-wall');
 }
 const label = WALL_LABELS[data.wall] || data.wall;
 $('hint').textContent = nowOpen
 ? `${label} OPEN to eave height (drive-through). Gable peak metal stays above eave. Click again to close.`
 : `${label} is CLOSED — full wall metal restored. Click another wall or Esc for Orbit.`;
 }

 /** Chip toggles under Building details for open walls (+ lean faces). */
 _renderOpenWallChips() {
 const host = $('openWallChips');
 if (!host) return;
 const b = this.activeBuilding();
 if (!b) {
 host.innerHTML = '';
 return;
 }
 if (!Array.isArray(b.openWalls)) b.openWalls = openWallList(b);
 const open = new Set(openWallList(b));
 let html = WALLS.map((w) => {
 const on = open.has(w);
 const lab = WALL_LABELS[w] || w;
 return `<button type="button" class="open-wall-chip${on ? ' is-open' : ''}" data-kind="main" data-wall="${w}" title="${
 on ? 'Click to close wall' : 'Click to open for drive-through'
 }">${on ? '● Open' : '○ Closed'}: ${lab}</button>`;
 }).join('');

 // Enclosed lean-to faces
 for (const lt of b.leanTos || []) {
 if (!isLeanEnclosed(lt)) continue;
 if (!Array.isArray(lt.openFaces)) lt.openFaces = [];
 const name = lt.name || 'Lean-to';
 html += `<div class="open-wall-lean-label" style="width:100%;margin-top:6px;font-size:11px;color:var(--muted)">${esc(
 name,
 )} walls</div>`;
 html += LEAN_FACES.map((face) => {
 const on = isLeanFaceOpen(lt, face);
 const lab = LEAN_FACE_LABELS[face] || face;
 return `<button type="button" class="open-wall-chip${on ? ' is-open' : ''}" data-kind="lean" data-lean="${lt.id}" data-face="${face}" title="${
 on ? 'Click to close lean face' : 'Click to open lean face'
 }">${on ? '● Open' : '○ Closed'}: ${lab}</button>`;
 }).join('');
 }

 host.innerHTML = html;
 host.querySelectorAll('.open-wall-chip').forEach((btn) => {
 btn.addEventListener('click', () => {
 if (btn.dataset.kind === 'lean') {
 const lt = (b.leanTos || []).find((l) => l.id === btn.dataset.lean);
 if (!lt) return;
 this._pushUndo('Open lean wall');
 lt.openFaces = toggleLeanOpenFace(lt, btn.dataset.face);
 if (isLeanFaceOpen(lt, btn.dataset.face)) {
 b.openings = (b.openings || []).filter(
 (o) =>
 !(o.host === lt.id && (o.face || 'outer') === btn.dataset.face),
 );
 }
 this._renderOpenWallChips();
 this.refresh();
 return;
 }
 const wall = btn.dataset.wall;
 this._pushUndo('Open wall');
 this._setWallOpenState(b, wall);
 this._renderOpenWallChips();
 this.refresh();
 });
 });
 }

 _syncViewBar() {
 const shell = this.scene.showMetal && !this.scene.showFraming;
 const frame = !this.scene.showMetal && this.scene.showFraming;
 const both = this.scene.showMetal && this.scene.showFraming;
 $('viewShell')?.classList.toggle('active', shell);
 $('viewFrame')?.classList.toggle('active', frame);
 $('viewBoth')?.classList.toggle('active', both);
 $('skinToggle')?.classList.toggle('mode-on', this.scene.showMetal);
 $('frameToggle')?.classList.toggle('mode-on', this.scene.showFraming);
 }

 _applyFormToActive() {
 const b = this.activeBuilding();
 if (!b) return;
 b.name = $('bName').value || b.name;
 b.width = num('width');
 b.length = num('length');
 b.eaveHeight = num('height');
 b.pitch = num('pitch');
 b.postSpacing = num('postSpacing');
 b.postDepthFt = num('postDepth');
 b.trussSpacing = num('trussSpacing');
 b.trussCarrierSize = $('trussCarrier').value;
 b.girtSpacingIn = num('girtSpacing');
 b.purlinSpacingIn = num('purlinSpacing');
 {
 const gs = $('girtSize')?.value || b.girtSize || '2x6';
 b.girtSize = ['2x4', '2x6', '2x8'].includes(gs) ? gs : '2x6';
 }
 {
 const ps = $('purlinSize')?.value || b.purlinSize || '2x4';
 b.purlinSize = ['2x4', '2x6', '2x8'].includes(ps) ? ps : '2x4';
 }
 b.skirtSize = $('skirtSize').value;
 if ($('postProtectors')) {
 b.postProtectors = $('postProtectors').value === 'yes';
 }
 if ($('permaColumns')) {
 b.permaColumns = $('permaColumns').value === 'yes';
 }
 // openWalls are toggled via chips / 3D Open Wall mode — never overwrite from form
 if (!Array.isArray(b.openWalls)) b.openWalls = openWallList(b);
 syncSidewallMetalFromOpenWalls(b);
 if ($('sidewallMetal')) {
 $('sidewallMetal').value = b.sidewallMetal === false ? 'no' : 'yes';
 }
 b.overhangIn = Math.max(0, num('overhang') || 0);
 // Default 3" when field empty/NaN — explicit 0 still allowed in the input,
 // but panel order length applies a production min drip (see engine panelMetalOverhangIn).
 const metalRaw = $('metalOverhang')?.value;
 b.metalOverhangIn =
 metalRaw === '' || metalRaw == null
 ? 3
 : Math.max(0, Number(metalRaw) || 0);
 // Order package always SB-auto from geometry (no UI override)
 b.orderPackageMode = 'auto';
 // Freight + sales tax are job-level
 if ($('freightMiles')) {
 this.project.freightMiles = Math.max(0, num('freightMiles'));
 }
 if ($('salesTaxPct')) {
 this.project.salesTaxPct = Math.max(0, num('salesTaxPct'));
 }
 b.roofStyle = $('roofStyle').value;
 b.wallColor = $('wallColor')?.value || b.wallColor || 'AL';
 b.roofColor = $('roofColor')?.value || b.roofColor || 'BK';
 b.wallGauge = $('wallGauge')?.value === '26' ? '26' : '29';
 b.roofGauge = $('roofGauge')?.value === '26' ? '26' : '29';
 // Trim is independent — never silently fall back to roof when the select is present
 if ($('trimColor') && $('trimColor').value) {
 b.trimColor = $('trimColor').value;
 } else if (!b.trimColor) {
 b.trimColor = b.roofColor || 'BK';
 }
 b.wainscotColor = $('wainscotColor')?.value || 'NONE';
 b.wainscotHeightFt = num('wainscotHeight') || 3;
 b.insulation = $('insulation')?.value || 'none';
 if ($('insulationType')) {
 const t = $('insulationType').value || 'fiberglass3';
 b.insulationType =
 t === 'thermaguard' || t === 'both' || t === 'double'
 ? t === 'double'
 ? 'both'
 : t
 : 'fiberglass3';
 }
 b.hasSlab = $('hasSlab').value === 'yes';
 this._syncWainscotRow();
 this._syncInsulationTypeRow();
 b.slabThicknessIn = num('slab');
 b.siteX = num('siteX');
 b.siteZ = num('siteZ');
 this._updatePostLengthHint();
 }

 /** Show hex swatches next to color dropdowns so trim/wall/roof changes are obvious. */
 _updateColorSwatches() {
 const map = {
 BK: '#1a1a1a',
 AL: '#e8e4dc',
 OTG: '#a8a8a8',
 GAL: '#b8c0c8',
 BR: '#5c4030',
 TN: '#c4a882',
 GR: '#2d5a3d',
 RD: '#8b1e1e',
 BU: '#5c1a2e',
 SL: '#3a3d42',
 LB: '#6a8fad',
 CG: '#9a7b5a',
 NONE: 'transparent',
 };
 const set = (selectId, swatchId) => {
 const sel = $(selectId);
 const sw = $(swatchId);
 if (!sel || !sw) return;
 const code = sel.value || '';
 sw.style.background = map[code] || '#888';
 sw.title = code || '';
 sw.style.borderColor = code === 'AL' || code === 'GAL' || code === 'NONE' ? '#666' : 'transparent';
 };
 set('roofColor', 'swatchRoof');
 set('wallColor', 'swatchWall');
 set('trimColor', 'swatchTrim');
 set('wainscotColor', 'swatchWainscot');
 }

 _updatePostLengthHint() {
 const el = $('postLengthHint');
 if (!el) return;
 const b = this.activeBuilding();
 const eave = num('height') || b?.eaveHeight || 12;
 const depth = num('postDepth') || b?.postDepthFt || 4;
 const width = num('width') || b?.width || 30;
 const pitch = num('pitch') || b?.pitch || 4;
 const roofStyle = $('roofStyle')?.value || b?.roofStyle || 'gable';
 const probe = {
 width,
 eaveHeight: eave,
 pitch,
 roofStyle,
 };
 const eavePick = pickPostStockLength(eave, depth);
 const peakH = postHeightAboveGrade(probe, width / 2, 0, ['front']).heightAboveGrade;
 const peakPick = pickPostStockLength(peakH, depth);
 const eaveBuf = eavePick.gradeBufferApplied ? ' +grade' : '';
 const peakBuf = peakPick.gradeBufferApplied ? ' +grade' : '';
 if (roofStyle === 'mono') {
 el.textContent = `Posts: low eave order ${eavePick.stockFt}' · high/rake up to ${peakPick.stockFt}' (${peakH.toFixed(1)}' above grade + ${depth}' depth). Stock 8'–24' / 2' steps.`;
 } else {
 el.textContent = `Eave posts → ${eavePick.stockFt}' (${eave}'+${depth}'${eaveBuf}). Gable ends grow with pitch → peak ~${peakPick.stockFt}' (${peakH.toFixed(1)}'+${depth}'${peakBuf}). Stock 8'–24' / 2' steps.`;
 }
 }

 _syncFormFromActive() {
 const b = this.activeBuilding();
 if (!b) return;
 $('customer').value = this.project.customer;
 $('project').value = this.project.project;
 $('location').value = this.project.location;
 $('laborSq').value = this.project.laborPerSqFt;
 $('markup').value = this.project.markupPct;

 $('bName').value = b.name;
 $('width').value = b.width;
 $('length').value = b.length;
 $('height').value = b.eaveHeight;
 $('pitch').value = b.pitch;
 $('postSpacing').value = b.postSpacing;
 $('postDepth').value = String(b.postDepthFt ?? 4);
 $('trussSpacing').value = b.trussSpacing;
 $('trussCarrier').value = b.trussCarrierSize || '2x10';
 $('girtSpacing').value = b.girtSpacingIn;
 $('purlinSpacing').value = b.purlinSpacingIn;
 if ($('girtSize')) {
 const gs = b.girtSize || '2x6';
 $('girtSize').value = ['2x4', '2x6', '2x8'].includes(gs) ? gs : '2x6';
 }
 if ($('purlinSize')) {
 const ps = b.purlinSize || '2x4';
 $('purlinSize').value = ['2x4', '2x6', '2x8'].includes(ps) ? ps : '2x4';
 }
 $('skirtSize').value = b.skirtSize || '2x6';
 if ($('postProtectors')) {
 $('postProtectors').value = b.postProtectors ? 'yes' : 'no';
 }
 if ($('permaColumns')) {
 $('permaColumns').value = b.permaColumns ? 'yes' : 'no';
 }
 if (!Array.isArray(b.openWalls)) b.openWalls = openWallList(b);
 syncSidewallMetalFromOpenWalls(b);
 if ($('sidewallMetal')) {
 $('sidewallMetal').value = b.sidewallMetal === false ? 'no' : 'yes';
 }
 this._renderOpenWallChips();
 $('overhang').value = b.overhangIn ?? 0;

 if ($('metalOverhang')) $('metalOverhang').value = b.metalOverhangIn ?? 3;
 if ($('freightMiles')) {
 $('freightMiles').value = this.project.freightMiles ?? 0;
 }
 if ($('salesTaxPct')) {
 $('salesTaxPct').value = this.project.salesTaxPct ?? 9.5;
 }
 $('roofStyle').value = b.roofStyle;
 if ($('wallColor')) $('wallColor').value = b.wallColor || 'AL';
 if ($('roofColor')) $('roofColor').value = b.roofColor || 'BK';
 if ($('wallGauge')) $('wallGauge').value = b.wallGauge === '26' ? '26' : '29';
 if ($('roofGauge')) $('roofGauge').value = b.roofGauge === '26' ? '26' : '29';
 if ($('trimColor')) {
 const tc = b.trimColor || b.roofColor || 'BK';
 $('trimColor').value = tc;
 // If stored code isn't in the list, force a valid option
 if ($('trimColor').value !== tc) $('trimColor').value = 'BK';
 }
 if ($('wainscotColor')) $('wainscotColor').value = b.wainscotColor || 'NONE';
 this._updateColorSwatches();
 if ($('wainscotHeight')) $('wainscotHeight').value = b.wainscotHeightFt ?? 3;
 if ($('insulation')) $('insulation').value = b.insulation || 'none';
 if ($('insulationType')) {
 const t = b.insulationType || 'fiberglass3';
 $('insulationType').value =
 t === 'thermaguard' || t === 'both' || t === 'double'
 ? t === 'double'
 ? 'both'
 : t
 : 'fiberglass3';
 }
 this._syncWainscotRow();
 this._syncInsulationTypeRow();
 $('hasSlab').value = b.hasSlab ? 'yes' : 'no';
 $('slab').value = b.slabThicknessIn;
 $('siteX').value = b.siteX;
 $('siteZ').value = b.siteZ;
 this._refreshOpenHostOptions();
 this._updateDimBadges();
 this._updatePostLengthHint();
 }

 _updateDimBadges() {
 // Dimension labels are rendered in the 3D scene now
 }

 _syncWainscotRow() {
 const row = $('wainscotHeightRow');
 if (!row) return;
 const on = ($('wainscotColor')?.value || 'NONE') !== 'NONE';
 row.style.display = on ? 'grid' : 'none';
 }

 /** Show insulation type (fiberglass / ThermaGuard) only when a package is selected. */
 _syncInsulationTypeRow() {
 const row = $('insulationTypeRow');
 const sel = $('insulationType');
 const pkg = $('insulation')?.value || 'none';
 const on = pkg !== 'none';
 if (row) row.style.display = on ? 'block' : 'none';
 if (sel) sel.disabled = !on;
 }

 _refreshOpenHostOptions() {
 const b = this.activeBuilding();
 const sel = $('openHost');
 if (!sel) return;
 const cur = sel.value;
 sel.innerHTML = `<option value="main">Main building</option>`;
 for (const lt of b.leanTos || []) {
 const opt = document.createElement('option');
 opt.value = lt.id;
 const label = lt.name || ((lt.roofStyle || 'shed') === 'gable' ? 'Gable ext.' : 'Lean-to');
 opt.textContent = `${label} on ${lt.wall} (${lt.depth}' deep)`;
 sel.appendChild(opt);
 }
 if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
 const isMain = sel.value === 'main';
 if ($('openFaceRow')) $('openFaceRow').style.display = isMain ? 'none' : 'grid';
 if ($('openWall')) $('openWall').disabled = !isMain;
 }

 _currentOpeningDraft() {
 const presetId = $('openPreset')?.value;
 let type;
 let width;
 let height;
 let sillHeight;
 if (presetId && presetId !== 'custom') {
 const p = OPENING_PRESETS.find((x) => x.id === presetId);
 if (p) {
 type = p.type;
 width = p.width;
 height = p.height;
 // Prefer live sill field so user can override preset sill before add
 sillHeight =
 $('openSill') != null && $('openSill').value !== ''
 ? num('openSill')
 : p.sillHeight ?? (p.type === 'window' ? 3 : 0);
 }
 }
 if (!type) {
 type = $('openType')?.value || 'walk';
 width = num('openW') || OPENING_TYPES[type]?.defaultW || 3;
 height = num('openH') || OPENING_TYPES[type]?.defaultH || WALK_DOOR_HEIGHT;
 sillHeight =
 $('openSill') != null && $('openSill').value !== ''
 ? num('openSill')
 : type === 'window'
 ? 3
 : 0;
 }
 if (type !== 'window' && type !== 'custom') {
 // Force grade doors to sill 0 unless user set custom sill intentionally for windows
 if (type === 'walk' || type === 'overhead' || type === 'slider') {
 // still allow non-zero if they typed it (e.g. raised threshold)
 }
 }
 return {
 type,
 width,
 height,
 sillHeight: Math.max(0, sillHeight ?? 0),
 };
 }

 _syncOpeningSillUi() {
 const type =
 ($('openPreset')?.value !== 'custom' &&
 OPENING_PRESETS.find((p) => p.id === $('openPreset')?.value)?.type) ||
 $('openType')?.value ||
 'walk';
 const hint = $('openSillHint');
 if (hint) {
 hint.textContent =
 type === 'window'
 ? 'Window sill above grade (typical 2.5–3.5\').'
 : 'Walk/garage doors are usually 0 (at grade).';
 }
 }

 _syncOpeningOffsetUi() {
 const from = $('openFrom')?.value || 'left';
 const to = $('openTo')?.value || 'corner';
 const sideRow = $('openCenterSideRow');
 if (sideRow) sideRow.style.display = from === 'center' ? 'grid' : 'none';
 const side = $('openCenterSide')?.value || 'right';
 const toLabel = to === 'center' ? 'center of opening' : 'left corner of opening';
 let fromLabel = 'left of wall';
 if (from === 'right') fromLabel = 'right of wall';
 if (from === 'center') {
 fromLabel = side === 'left' ? 'wall center (toward left)' : 'wall center (toward right)';
 }
 if ($('openOffsetHint')) {
 $('openOffsetHint').textContent = `From ${fromLabel} to ${toLabel}.`;
 }
 if ($('openXLabel')) {
 $('openXLabel').textContent =
 from === 'center' ? 'Distance from center ft' : `Distance from ${from} ft`;
 }
 }

 /**
   * Convert UI distance (left/right/center × corner/center) → left-edge offset from left of wall.
   */
 _openingOffsetFromUi(wallLen, openW) {
 const dist = Math.max(0, num('openX'));
 const from = $('openFrom')?.value || 'left';
 const to = $('openTo')?.value || 'corner';
 const side = $('openCenterSide')?.value || 'right';
 const w = Math.max(0.5, openW || 3);
 // Position of the measured point on the opening, from left of wall
 let refFromLeft;
 if (from === 'left') refFromLeft = dist;
 else if (from === 'right') refFromLeft = wallLen - dist;
 else refFromLeft = wallLen / 2 + (side === 'right' ? dist : -dist);

 // Convert opening ref → left corner of opening
 let leftEdge = to === 'center' ? refFromLeft - w / 2 : refFromLeft;
 leftEdge = Math.max(0, Math.min(wallLen - w, leftEdge));
 return Math.round(leftEdge * 100) / 100;
 }

 /** Reverse: left-edge offset → distance shown in the UI for current mode. */
 _openingUiDistanceFromOffset(leftEdge, wallLen, openW) {
 const from = $('openFrom')?.value || 'left';
 const to = $('openTo')?.value || 'corner';
 const side = $('openCenterSide')?.value || 'right';
 const w = Math.max(0.5, openW || 3);
 const refFromLeft = to === 'center' ? leftEdge + w / 2 : leftEdge;
 if (from === 'left') return Math.round(refFromLeft * 100) / 100;
 if (from === 'right') return Math.round((wallLen - refFromLeft) * 100) / 100;
 // center: absolute distance; update side so sign matches
 const delta = refFromLeft - wallLen / 2;
 if ($('openCenterSide')) {
 $('openCenterSide').value = delta >= 0 ? 'right' : 'left';
 }
 return Math.round(Math.abs(delta) * 100) / 100;
 }

 _describeOffset(leftEdge, wallLen, openW) {
 const from = $('openFrom')?.value || 'left';
 const to = $('openTo')?.value || 'corner';
 const dist = this._openingUiDistanceFromOffset(leftEdge, wallLen, openW);
 const toTxt = to === 'center' ? 'center' : 'left corner';
 if (from === 'center') {
 const side = $('openCenterSide')?.value || 'right';
 return `${dist}' ${side} of wall center → opening ${toTxt}`;
 }
 return `${dist}' from wall ${from} → opening ${toTxt}`;
 }

 _placeOpening(data) {
 const b = this.project.buildings.find((x) => x.id === data.buildingId);
 if (!b) return;
 // Cannot place openings on open drive-through walls (main or lean)
 if ((!data.host || data.host === 'main') && isWallOpen(b, data.wall)) {
 $('hint').textContent =
 `${WALL_LABELS[data.wall] || data.wall} is open (drive-through). Close it first, or place openings on another wall.`;
 return;
 }
 if (data.host && data.host !== 'main') {
 const lt = (b.leanTos || []).find((l) => l.id === data.host);
 const face = data.face || 'outer';
 if (lt && isLeanFaceOpen(lt, face)) {
 $('hint').textContent = `${lt.name || 'Lean-to'} ${LEAN_FACE_LABELS[face] || face} is open. Close it before placing an opening.`;
 return;
 }
 }
 const draft = this._currentOpeningDraft();
 this._pushUndo('Place opening');
 // 3D click always returns left-edge offset
 let offset = Math.round(data.offset * 10) / 10;
 const wallLen = openingHostLength(b, {
 wall: data.wall,
 host: data.host || 'main',
 face: data.face || 'main',
 });
 const width = data.width ?? draft.width;
 offset = Math.max(0, Math.min(wallLen - width, offset));
 b.openings.push(
 createOpening({
 type: data.type || draft.type,
 width,
 height: data.height ?? draft.height,
 wall: data.wall,
 offset,
 sillHeight: data.sillHeight ?? draft.sillHeight ?? 0,
 host: data.host || 'main',
 face: data.face || 'main',
 }),
 );
 this.scene.setMode('orbit');
 this._setModeButtons('orbit');
 if (!this.scene.showMetal) this.scene.showMetal = true;
 const sillNote =
 (data.type || draft.type) === 'window'
 ? ` · sill ${(data.sillHeight ?? draft.sillHeight ?? 0)}'`
 : '';
 $('hint').textContent = `Placed ${OPENING_TYPES[data.type || draft.type]?.label || 'opening'} ${formatOpeningSize(width, data.height ?? draft.height)} on ${data.wall} @ ${offset.toFixed(1)} ft from left${sillNote}`;
 this.refresh();
 }

 _selectOpening(data) {
 const id = data?.openingId;
 if (!id) return;
 this.scene.selectedOpeningId = id;
 document.querySelectorAll('#openings .list-item').forEach((el) => {
 el.classList.toggle('selected-item', el.dataset.oid === id);
 });
 // Load into form for revising
 const b = this.activeBuilding();
 const o = b?.openings?.find((x) => x.id === id);
 if (o) {
 if ($('openPreset')) $('openPreset').value = 'custom';
 if ($('openCustomRow')) $('openCustomRow').style.display = 'grid';
 if ($('openType')) $('openType').value = o.type || 'walk';
 if ($('openW')) $('openW').value = o.width;
 if ($('openH')) $('openH').value = o.height;
 if ($('openSill')) $('openSill').value = o.sillHeight ?? (o.type === 'window' ? 3 : 0);
 if ($('openWall')) $('openWall').value = o.wall || 'front';
 if ($('openHost')) {
 $('openHost').value = !o.host || o.host === 'main' ? 'main' : o.host;
 this._refreshOpenHostOptions();
 }
 if ($('openFace') && o.face) $('openFace').value = o.face;
 const wallLen = openingHostLength(b, o);
 // Prefer showing as "from left → left corner" for clarity when selecting
 if ($('openFrom')) $('openFrom').value = 'left';
 if ($('openTo')) $('openTo').value = 'corner';
 this._syncOpeningOffsetUi();
 this._syncOpeningSillUi();
 if ($('openX')) {
 $('openX').value = this._openingUiDistanceFromOffset(o.offset ?? 0, wallLen, o.width);
 }
 this._showInsp('doors');
 const sillTxt =
 o.type === 'window' ? ` · sill ${o.sillHeight ?? 0}'` : '';
 $('hint').textContent = `Selected ${OPENING_TYPES[o.type]?.label || o.type} ${formatOpeningSize(o.width, o.height)}${sillTxt} — edit sill/offset then Update selected.`;
 }
 // Rebuild so selection highlight shows in 3D
 this.scene.rebuild?.();
 }

 _moveOpening(data) {
 const b = this.project.buildings.find((x) => x.id === data.buildingId);
 const o = b?.openings?.find((x) => x.id === data.openingId);
 if (!o) return;
 if (data.live && !this._moveUndoPushed) {
 this._pushUndo('Move opening');
 this._moveUndoPushed = true;
 }
 if (!data.live) {
 if (!this._moveUndoPushed) this._pushUndo('Move opening');
 this._moveUndoPushed = false;
 }
 const max = openingHostLength(b, o);
 o.offset = Math.max(0, Math.min(max - o.width, data.offset));
 if (!data.live) {
 this.refresh();
 $('hint').textContent = `Moved opening to ${o.offset.toFixed(1)} ft`;
 } else {
 clearTimeout(this._moveLiveTimer);
 this._moveLiveTimer = setTimeout(() => {
 this._renderOpenings();
 this.refresh({ rebuildScene: false });
 }, 120);
 }
 }

 refresh({ rebuildScene = true } = {}) {
 this._renderBuildingList();
 this._renderOpenings();
 this._renderLeanTos();
 this._renderPropsList();
 this._refreshOpenHostOptions();
 this._updateDimBadges();
 this._updatePostLengthHint();

 let takeoff;
 try {
 takeoff = takeoffProject(this.project);
 this._lastTakeoff = takeoff;
 } catch (err) {
 console.error('takeoffProject failed', err);
 takeoff = this._lastTakeoff || {
 items: [],
 material: 0,
 labor: 0,
 laborSell: 0,
 freight: 0,
 salesTax: 0,
 salesTaxPct: this.project?.salesTaxPct ?? 9.5,
 total: 0,
 floorArea: 0,
 };
 }
 let rules = [];
 try {
 // Pass takeoff so self-check can verify qty vs geometry (size-aware)
 rules = evaluateProjectRules(this.project, takeoff.items || []);
 } catch (err) {
 console.error('evaluateProjectRules failed', err);
 rules = [
 {
 level: 'error',
 code: 'RULES_CRASH',
 message: 'Rule engine error: ' + (err.message || err),
 },
 ];
 }

 // Header price + job name
 this._setHeaderPrice(takeoff.total);
 if ($('headerJobName')) {
 $('headerJobName').textContent = `"${this.project.customer || this.project.project}"`;
 }
 this._applyPriceVisibility();
 // Keep active job warm in storage (silent, per user)
 try {
 if (this.session) {
 this._persistActiveJob();
 }
 } catch (_) {}
 if ($('total')) $('total').textContent = money(takeoff.total);
 if ($('quoteMeta')) {
 const parts = [
 this.project.project,
 `${Math.round(takeoff.floorArea)} sq ft`,
 `materials ${money(takeoff.material)}`,
 ];
 if ((takeoff.laborSell || takeoff.labor || 0) > 0) {
 parts.push(`labor ${money(takeoff.laborSell ?? takeoff.labor)}`);
 }
 if ((takeoff.freight || 0) > 0) parts.push(`freight ${money(takeoff.freight)}`);
 if ((takeoff.salesTax || 0) > 0) {
 parts.push(`tax ${money(takeoff.salesTax)}`);
 }
 $('quoteMeta').textContent = parts.join(' · ');
 }
 const stats = catalogStats();
 if ($('major')) {
 const freightPill =
 (takeoff.freight || 0) > 0
 ? `<span class="pill">Freight ${money(takeoff.freight)}</span>`
 : '';
 const taxPill =
 (takeoff.salesTax || 0) > 0
 ? `<span class="pill">Tax ${money(takeoff.salesTax)} (${takeoff.salesTaxPct || 0}%)</span>`
 : '';
 const laborShown =
 takeoff.laborSell != null ? takeoff.laborSell : takeoff.labor;
 const laborPill =
 (laborShown || 0) > 0
 ? `<span class="pill">Labor ${money(laborShown)}</span>`
 : '';
 $('major').innerHTML = [
 `<span class="pill">Materials ${money(takeoff.material)}</span>`,
 laborPill,
 freightPill,
 taxPill,
 `<span class="pill">Total ${money(takeoff.total)}</span>`,
 `<span class="pill">Buildings ${this.project.buildings.length}</span>`,
 `<span class="pill">Lines ${takeoff.items.length}</span>`,
 `<span class="pill">${esc(stats.sourceName)}</span>`,
 ]
 .filter(Boolean)
 .join('');
 }

 try {
 this._renderBomTable();
 } catch (err) {
 console.error('BOM render in refresh', err);
 }
 try {
 if ($('bomExport')) $('bomExport').value = toItemListCsv(this.project, takeoff);
 } catch (err) {
 console.error('CSV export preview', err);
 }

 // Messages badge (errors + warnings count)
 try {
 const msgReport = collectJobMessages(this.project, takeoff);
 this._lastMessagesReport = msgReport;
 this._updateMessagesBadge(msgReport);
 } catch (err) {
 console.error('messages badge', err);
 }

 if ($('rules')) {
 const nOk = rules.filter((r) => r.level === 'ok').length;
 const nWarn = rules.filter((r) => r.level === 'warn').length;
 const nErr = rules.filter((r) => r.level === 'error').length;
 const pass = nErr === 0;
 let policyBlock = '';
 try {
 const ab = this.activeBuilding();
 if (ab) {
 const pol = describePolicyForBuilding(ab);
 const polText = formatPolicySummary(ab);
 policyBlock = `<div class="rule-summary" style="margin-bottom:10px;border-color:#3a5a7a;background:#141c28">
 <strong>Production policy (active building)</strong>
 <pre style="margin:6px 0 0;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#c8d6e8">${esc(polText)}</pre>
 <div class="rule-summary-sub" style="margin-top:6px">JambPost lines = off-grid door jambs only. Door jambs that land on the post grid stay as Post. Package always follows SmartBuild rules (eave ≥ 14′ or lean → full; else small-shop).</div>
 </div>`;
 }
 } catch (_) {}
 const summary = `${policyBlock}<div class="rule-summary ${pass ? 'pass' : 'fail'}">
 <strong>Construction self-check:</strong>
 ${pass ? 'PASS' : 'NEEDS ATTENTION'} —
 <span class="rs-ok">${nOk} ok</span> ·
 <span class="rs-warn">${nWarn} warn</span> ·
 <span class="rs-err">${nErr} error</span>
 <div class="rule-summary-sub">Size-aware geometry + takeoff cross-check for sound post-frame construction (not a PE stamp).</div>
 </div>`;
 let lastCat = '';
 const body = rules
 .map((r) => {
 const cat = r.category || '';
 let catHead = '';
 if (cat && cat !== lastCat) {
 lastCat = cat;
 catHead = `<div class="rule-cat">${esc(cat)}</div>`;
 }
 const mark =
 r.level === 'ok' ? '✓' : r.level === 'warn' ? '!' : '✗';
 const name = r.buildingName ? `<b>${esc(r.buildingName)}</b>: ` : '';
 return `${catHead}<div class="rule ${r.level}"><span class="rule-mark">${mark}</span> ${name}${esc(r.message)}</div>`;
 })
 .join('');
 $('rules').innerHTML = summary + body;
 }

 if (rebuildScene && this.scene) {
 try {
 this.scene.setProject(this.project);
 } catch (err) {
 console.error('3D rebuild failed', err);
 if ($('hint')) $('hint').textContent = '3D view error: ' + (err.message || err);
 }
 }
 if ($('pane-plans')?.classList.contains('open')) this._drawPlans();
 }

 _renderBomTable() {
 try {
 let takeoff = this._lastTakeoff;
 if (!takeoff && this.project) {
 try {
 takeoff = takeoffProject(this.project);
 this._lastTakeoff = takeoff;
 } catch (err) {
 console.error(err);
 takeoff = {
 items: [],
 material: 0,
 labor: 0,
 laborSell: 0,
 freight: 0,
 salesTax: 0,
 salesTaxPct: this.project?.salesTaxPct ?? 9.5,
 total: 0,
 };
 }
 }
 takeoff = takeoff || { items: [], material: 0, labor: 0, freight: 0, salesTax: 0, total: 0 };

 const cat = this._bomCat || 'summary';
 const isSummary = cat === 'summary';
 const sumView = $('bomSummaryView');
 const detView = $('bomDetailView');
 const csvWrap = $('bomCsvWrap');
 if (sumView) sumView.style.display = isSummary ? '' : 'none';
 if (detView) detView.style.display = isSummary ? 'none' : '';
 if (csvWrap) csvWrap.style.display = isSummary ? 'none' : '';

 if (isSummary) {
 this._renderBomSummary(takeoff);
 return;
 }

 const body = $('bomBody');
 if (!body) return;
 // Map safe data-cat values → real category names
 const catMap = {
 DoorsWindows: 'Doors & Windows',
 'Doors & Windows': 'Doors & Windows',
 };
 const realCat = catMap[cat] || cat;

 // Labor is job-level (not material lines) — show a single summary row
 if (realCat === 'Labor') {
 const laborAmt =
 Number(takeoff.laborSell != null ? takeoff.laborSell : takeoff.labor) || 0;
 const rate = Number(this.project?.laborPerSqFt) || 0;
 const area = Math.round(Number(takeoff.floorArea) || 0);
 const markup = Number(this.project?.markupPct) || 0;
 body.innerHTML = `<tr>
 <td><b>Labor</b></td>
 <td class="sku">LABOR</td>
 <td class="desc">${area} sq ft × $${rate.toFixed(2)}/sf${
 markup ? ` + ${markup}% labor markup` : ''
 }</td>
 <td></td>
 <td></td>
 <td></td>
 <td class="num">1</td>
 <td class="num col-cost">${money(laborAmt)}</td>
 <td class="num col-ext">${money(laborAmt)}</td>
 </tr>`;
 return;
 }

 let items =
 realCat === 'all'
 ? [...(takeoff.items || [])]
 : (takeoff.items || []).filter((i) => i.category === realCat);
 if (!items.length) {
 body.innerHTML = `<tr><td colspan="9" class="small">No lines in this section.</td></tr>`;
 return;
 }
 // Group by Usage, longest length first within each group
 if (this._bomSortByLength) {
 items = sortBomItemsByLength(items);
 }
 body.innerHTML = items
 .map(
 (i) =>
 `<tr>
 <td><b>${esc(i.usage || i.category)}</b></td>
 <td class="sku">${esc(i.sku)}</td>
 <td class="desc">${esc(i.description)}</td>
 <td>${esc(i.color)}</td>
 <td class="angle">${esc(i.angle || '')}</td>
 <td>${esc(i.length)}</td>
 <td class="num">${formatQty(i.qty)}</td>
 <td class="num col-cost">${money(i.cost)}</td>
 <td class="num col-ext">${money(i.extCost)}</td>
 </tr>`,
 )
 .join('');
 } catch (err) {
 console.error('Job Review render failed', err);
 const body = $('bomSummaryBody') || $('bomBody');
 if (body) {
 body.innerHTML = `<tr><td colspan="4" style="padding:16px;color:#c44">Job Review error: ${esc(err.message || err)}. Try hard-refresh (Cmd+Shift+R).</td></tr>`;
 }
 const sumView = $('bomSummaryView');
 if (sumView) sumView.style.display = '';
 }
 }

 /**
   * Job Review summary: section totals, weight estimates,
   * taxable / tax / non-taxable labor / grand total.
   */
 _renderBomSummary(takeoff) {
 const body = $('bomSummaryBody');
 if (!body) {
 console.warn('bomSummaryBody missing from DOM — hard-refresh the page');
 return;
 }

 const sectionOrder = [
 'Framing',
 'Sheathing',
 'Trim',
 'Doors & Windows',
 'Accessories',
 'Trusses',
 'Insulation',
 'Concrete',
 'Freight',
 ];
 const byCat = {};
 const wtCat = {};
 for (const sec of sectionOrder) {
 byCat[sec] = 0;
 wtCat[sec] = 0;
 }
 for (const i of takeoff.items || []) {
 const cat = i.category || 'Other';
 if (byCat[cat] == null) byCat[cat] = 0;
 if (wtCat[cat] == null) wtCat[cat] = 0;
 byCat[cat] += Number(i.extCost) || 0;
 try {
 wtCat[cat] += estimateLineWeightLb(i);
 } catch (_) {
 /* weight is optional */
 }
 }

 // Pricing model: materials + freight taxable; labor (w/ markup) non-taxable
 const laborAmt = Number(takeoff.laborSell != null ? takeoff.laborSell : takeoff.labor) || 0;
 const freightShown = Number(takeoff.freight) || byCat.Freight || 0;
 byCat.Freight = freightShown;

 const materialSum = sectionOrder
 .filter((s) => s !== 'Freight')
 .reduce((s, k) => s + (byCat[k] || 0), 0);
 const taxable = materialSum + freightShown;
 const taxPct =
 Number(
 takeoff.salesTaxPct != null
 ? takeoff.salesTaxPct
 : this.project?.salesTaxPct,
 ) || 0;
 const salesTax =
 takeoff.salesTax != null ? Number(takeoff.salesTax) : taxable * (taxPct / 100);
 const nonTaxable = laborAmt;
 const grand =
 takeoff.total != null ? Number(takeoff.total) : taxable + salesTax + nonTaxable;
 const totalWt = Object.values(wtCat).reduce((s, w) => s + w, 0);

 const fmtMoney = (n) =>
 Number(n || 0).toLocaleString(undefined, {
 style: 'currency',
 currency: 'USD',
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
 });
 const fmtWt = (lb) =>
 `${Number(lb || 0).toLocaleString(undefined, {
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
 })} lbs`;

 // Screenshot order: sections, Labor, Freight, then totals
 const displaySections = [
 'Framing',
 'Sheathing',
 'Trim',
 'Doors & Windows',
 'Accessories',
 'Trusses',
 'Insulation',
 'Concrete',
 'Labor',
 'Freight',
 ];
 const rows = [];
 for (const sec of displaySections) {
 let amt = 0;
 let wt = 0;
 if (sec === 'Labor') {
 amt = laborAmt;
 wt = 0;
 } else if (sec === 'Freight') {
 amt = freightShown;
 wt = wtCat.Freight || 0;
 } else {
 amt = byCat[sec] || 0;
 wt = wtCat[sec] || 0;
 }
 if ((sec === 'Insulation' || sec === 'Concrete') && amt <= 0) continue;
 rows.push(
 `<tr class="summary-section">
 <td><b>${esc(sec)}</b></td>
 <td class="desc-empty"></td>
 <td class="num col-cost">${fmtMoney(amt)}</td>
 <td class="num col-ext">${fmtWt(wt)}</td>
 </tr>`,
 );
 }
 rows.push(
 `<tr class="summary-taxable">
 <td><b>Taxable Total</b></td>
 <td></td>
 <td class="num col-cost">${fmtMoney(taxable)}</td>
 <td class="num col-ext"></td>
 </tr>`,
 );
 rows.push(
 `<tr class="summary-tax">
 <td><b>Sales Tax</b></td>
 <td class="summary-rate">${Number(taxPct).toFixed(3)}%</td>
 <td class="num col-cost">${fmtMoney(salesTax)}</td>
 <td class="num col-ext"></td>
 </tr>`,
 );
 rows.push(
 `<tr class="summary-nontax">
 <td><b>Non-taxable Total</b></td>
 <td></td>
 <td class="num col-cost">${fmtMoney(nonTaxable)}</td>
 <td class="num col-ext"></td>
 </tr>`,
 );
 rows.push(
 `<tr class="summary-grand">
 <td><b>Grand Total</b></td>
 <td></td>
 <td class="num col-cost">${fmtMoney(grand)}</td>
 <td class="num col-ext">${fmtWt(totalWt)}</td>
 </tr>`,
 );

 body.innerHTML = rows.join('');
 }

 _drawPlans() {
 const canvas = $('plansCanvas');
 if (!canvas) return;
 try {
 drawPlans(canvas, this.project, { buildingId: this.project.activeBuildingId });
 } catch (err) {
 console.error('2D plans failed', err);
 const ctx = canvas.getContext('2d');
 if (ctx) {
 canvas.width = 900;
 canvas.height = 200;
 canvas.style.width = '900px';
 canvas.style.height = '200px';
 ctx.fillStyle = '#fff';
 ctx.fillRect(0, 0, 900, 200);
 ctx.fillStyle = '#b00020';
 ctx.font = '14px Arial';
 ctx.fillText('2D plans error: ' + (err?.message || err), 20, 40);
 ctx.fillStyle = '#444';
 ctx.font = '12px Arial';
 ctx.fillText('Hard-refresh (Cmd+Shift+R) and open 2D / Plans again.', 20, 70);
 }
 }
 }

 /**
 * Toggle production scorecard panel on/off.
 * Off → run Levi + multi-size checks and show. On → hide.
 */
 _runScorecard() {
 const box = $('scorecardResult');
 const btn = $('runScorecardBtn');
 const pasteBox = $('sbPasteBox');

 // Toggle off when already open
 if (box?.dataset?.open === '1') {
 box.style.display = 'none';
 box.dataset.open = '0';
 if (pasteBox) pasteBox.style.display = 'none';
 if (btn) {
 btn.textContent = 'Scorecard';
 btn.title = 'Show production scorecard (qty / length checks)';
 btn.classList.remove('scorecard-on');
 }
 if ($('hint')) $('hint').textContent = 'Scorecard hidden.';
 return;
 }

 try {
 const { report } = runLeviScorecard();
 const multi = runAllRegressionChecks();
 let policyText = '';
 try {
 const ab = this.activeBuilding();
 if (ab) policyText = '\n\n── Active building policy ──\n' + formatPolicySummary(ab);
 } catch (_) {}
 const text =
 formatScorecardReport(report) +
 '\n\n' +
 formatRegressionReport(multi) +
 policyText;
 const allOk = report.fail === 0 && multi.pass;
 if (box) {
 box.style.display = 'block';
 box.dataset.open = '1';
 box.textContent = text;
 box.style.borderColor = allOk ? '#3a6a4a' : '#8a3030';
 box.style.background = allOk ? '#1a2420' : '#2a1818';
 box.style.color = allOk ? '#c8e6c9' : '#f0c0c0';
 }
 if (pasteBox) pasteBox.style.display = 'block';
 if (btn) {
 btn.textContent = 'Hide scorecard';
 btn.title = 'Hide production scorecard';
 btn.classList.add('scorecard-on');
 }
 if ($('hint')) {
 $('hint').textContent = allOk
 ? `Scorecard PASS ${report.pass}/${report.total} · multi-size ${multi.passCount}/${multi.total}`
 : `Scorecard gaps — Levi ${report.pass}/${report.total}, multi-size ${multi.passCount}/${multi.total}`;
 }
 console.log('[scorecard]', report, multi);
 } catch (err) {
 console.error(err);
 if (box) {
 box.style.display = 'block';
 box.dataset.open = '1';
 box.textContent = 'Scorecard error: ' + (err.message || err);
 box.style.borderColor = '#8a3030';
 box.style.background = '#2a1818';
 box.style.color = '#f0c0c0';
 }
 if (btn) {
 btn.textContent = 'Hide scorecard';
 btn.classList.add('scorecard-on');
 }
 alert('Scorecard failed: ' + (err.message || err));
 }
 }

 /**
 * Collect + show Errors and Warnings (SmartBuild-style modal).
 * @param {{ fromQuote?: boolean }} [opts] fromQuote → Ok continues to Job Review
 */
 _showMessagesModal(opts = {}) {
 this._messagesFromQuote = !!opts.fromQuote;
 let takeoff = this._lastTakeoff;
 try {
 if (!takeoff || opts.fromQuote) {
 takeoff = takeoffProject(this.project);
 this._lastTakeoff = takeoff;
 }
 } catch (err) {
 console.error(err);
 }
 const report = collectJobMessages(this.project, takeoff);
 this._lastMessagesReport = report;
 this._updateMessagesBadge(report);

 const body = $('messagesBody');
 if (body) {
 if (!report.total) {
 body.innerHTML =
 '<p class="messages-empty">No errors or warnings for this job.</p>';
 } else {
 let html = '';
 if (report.errors.length) {
 html += `<div class="messages-section-title errors">Errors:</div><ul class="messages-list errors">`;
 for (const m of report.errors) {
 html += `<li><span class="msg-cat">${esc(m.category || 'Error')}</span>${esc(m.message)}</li>`;
 }
 html += `</ul>`;
 }
 if (report.warnings.length) {
 html += `<div class="messages-section-title warnings">Warnings:</div><ul class="messages-list warnings">`;
 for (const m of report.warnings) {
 html += `<li><span class="msg-cat">${esc(m.category || 'Warning')}</span>${esc(m.message)}</li>`;
 }
 html += `</ul>`;
 }
 body.innerHTML = html;
 }
 }
 const modal = $('messagesModal');
 if (modal) modal.style.display = 'flex';
 if ($('hint')) {
 $('hint').textContent = report.total
 ? `${report.errorCount} error(s), ${report.warnCount} warning(s)`
 : 'No messages';
 }
 return report;
 }

 _hideMessagesModal() {
 const modal = $('messagesModal');
 if (modal) modal.style.display = 'none';
 this._messagesFromQuote = false;
 }

 _onMessagesOk() {
 const fromQuote = this._messagesFromQuote;
 this._hideMessagesModal();
 if (fromQuote) {
 this._openPane('bom');
 }
 }

 /** MAKE QUOTE: show Errors/Warnings first (like SmartBuild), then Job Review. */
 _onMakeQuote() {
 try {
 this.refresh({ rebuildScene: false });
 } catch (err) {
 console.error(err);
 }
 const report = this._showMessagesModal({ fromQuote: true });
 // If nothing to show, go straight to quote
 if (!report.total) {
 this._hideMessagesModal();
 this._openPane('bom');
 }
 }

 /** Update topbar Messages badge from latest report. */
 _updateMessagesBadge(report) {
 const btn = $('messagesBtn');
 const badge = $('messagesBadge');
 if (!btn || !badge) return;
 const n = report?.total || 0;
 const errs = report?.errorCount || 0;
 if (n <= 0) {
 badge.hidden = true;
 badge.textContent = '0';
 btn.classList.remove('has-errors', 'has-warnings');
 btn.title = 'Errors and warnings for this job — none right now';
 return;
 }
 badge.hidden = false;
 badge.textContent = String(n);
 badge.classList.toggle('warn-only', errs === 0);
 btn.classList.toggle('has-errors', errs > 0);
 btn.classList.toggle('has-warnings', errs === 0 && n > 0);
 btn.title = `${errs} error(s), ${(report.warnCount || 0)} warning(s) — click to view`;
 }

 /** P8: compare pasted SB order lines to the active building takeoff. */
 _runSbPasteCompare() {
 const raw = $('sbPasteInput')?.value || '';
 const out = $('sbPasteResult');
 try {
 const items =
 this._lastTakeoff?.items ||
 takeoffProject(this.project).items ||
 [];
 const report = comparePasteToItems(raw, items);
 const text = formatPasteCompareReport(report, 'SB paste → active job takeoff');
 if (out) {
 out.textContent = text;
 out.style.color = report.fail === 0 && report.total > 0 ? '#a8e0b0' : '#f0c0c0';
 }
 if ($('hint')) {
 $('hint').textContent =
 report.total === 0
 ? 'Paste SB lines to compare'
 : `Paste compare ${report.pass}/${report.total}`;
 }
 } catch (err) {
 if (out) out.textContent = 'Paste compare error: ' + (err.message || err);
 }
 }

/**
   * Builder-ready package: order list + plans for shop/field PDF.
   */
 _printProductionPackage() {
 if (!this.project) {
 alert('No project loaded.');
 return;
 }
 let plansDataUrl = '';
 try {
 const canvas = document.createElement('canvas');
 drawPlans(canvas, this.project, {
 buildingId: this.project.activeBuildingId,
 pageWidth: 1000,
 });
 plansDataUrl = canvas.toDataURL('image/png');
 } catch (err) {
 console.warn('plans for production package failed', err);
 }
 try {
 printProductionPackage(this.project, {
 plansDataUrl,
 buildingId: this.project.activeBuildingId,
 });
 if ($('hint')) {
 $('hint').textContent =
 'Production package opened — use Download package (save file) or Print → Save as PDF.';
 }
 } catch (err) {
 console.error(err);
 alert('Production package failed: ' + (err.message || err));
 }
 }

 _renderCatalogStats() {
 const s = catalogStats();
 const el = $('catalogStats');
 if (!el) return;
 el.innerHTML = `
 <div class="small"><b>Source:</b> ${esc(s.sourceName)}</div>
 <div class="small"><b>Imported:</b> ${s.importedAt ? new Date(s.importedAt).toLocaleString() : '—'}</div>
 <div style="margin-top:8px">
 <span class="pill">Posts ${s.posts}</span>
 <span class="pill">Boards ${s.boards}</span>
 <span class="pill">Metal ${s.metal}</span>
 <span class="pill">Trim ${s.trimSkus}</span>
 </div>
 `;
 const tbody = $('catalogSample');
 if (tbody) {
 const postRows = Object.entries(CATALOG.posts)
 .sort((a, b) => Number(a[0]) - Number(b[0]))
 .map(
 ([len, v]) =>
 `<tr><td>Post</td><td class="sku">${esc(v.sku)}</td><td>${esc(v.desc)}</td><td>${len}'</td><td class="num">${money(v.cost)}</td></tr>`,
 );
 const boardRows = Object.entries(CATALOG.boards)
 .slice(0, 12)
 .map(
 ([k, v]) =>
 `<tr><td>Board</td><td class="sku">${esc(v.sku)}</td><td>${esc(v.desc)}</td><td>${esc(k)}</td><td class="num">${money(v.cost)}</td></tr>`,
 );
 tbody.innerHTML = [...postRows, ...boardRows].join('');
 }
 }

 _renderBuildingList() {
 const el = $('buildingList');
 if (!el) return;
 el.innerHTML = this.project.buildings
 .map((b) => {
 const sel = b.id === this.project.activeBuildingId ? 'selected' : '';
 return `<button type="button" class="${sel}" data-id="${b.id}">${esc(b.name)} (${b.width}×${b.length})</button>`;
 })
 .join('');
 el.querySelectorAll('button').forEach((btn) => {
 btn.addEventListener('click', () => {
 this._applyFormToActive();
 this.project.activeBuildingId = btn.dataset.id;
 this._syncFormFromActive();
 this.refresh();
 });
 });
 }

 _renderOpenings() {
 const b = this.activeBuilding();
 const el = $('openings');
 if (!el) return;
 if (!b?.openings?.length) {
 el.innerHTML = '<div class="small">No openings yet. Pick a size and click Add Opening.</div>';
 return;
 }
 const sel = this.scene?.selectedOpeningId;
 el.innerHTML = b.openings
 .map((o) => {
 const label = OPENING_TYPES[o.type]?.label || o.type;
 const size = formatOpeningSize(o.width, o.height);
 const host =
 !o.host || o.host === 'main'
 ? o.wall
 : `lean-to ${o.face || 'outer'}`;
 const cls = o.id === sel ? 'list-item selected-item' : 'list-item';
 const sill =
 o.type === 'window' || (o.sillHeight != null && o.sillHeight > 0)
 ? ` · sill ${o.sillHeight ?? 0}'`
 : '';
 return `<div class="${cls}" data-oid="${o.id}" title="Click to select and edit">
 <div><b>${esc(label)} ${esc(size)}</b>${esc(host)} @ ${o.offset} ft from left${esc(sill)}</div>
 <button type="button" class="danger" data-id="${o.id}">Remove</button>
 </div>`;
 })
 .join('');
 el.querySelectorAll('.list-item').forEach((row) => {
 row.addEventListener('click', (ev) => {
 if (ev.target.closest('button')) return;
 this._selectOpening({ openingId: row.dataset.oid });
 });
 });
 el.querySelectorAll('button.danger').forEach((btn) => {
 btn.addEventListener('click', (ev) => {
 ev.stopPropagation();
 this._pushUndo('Remove opening');
 const i = b.openings.findIndex((o) => o.id === btn.dataset.id);
 if (i >= 0) b.openings.splice(i, 1);
 if (this.scene?.selectedOpeningId === btn.dataset.id) {
 this.scene.selectedOpeningId = null;
 }
 this.refresh();
 });
 });
 }

 _syncAttachModal() {
 const kind = $('attKind')?.value || 'leanto';
 const isSep = kind === 'separate';
 if ($('attAttachFields')) $('attAttachFields').style.display = isSep ? 'none' : 'block';
 if ($('attSeparateFields')) $('attSeparateFields').style.display = isSep ? 'block' : 'none';
 if (isSep) return;

 if (kind === 'gable-extension') {
 if ($('attRoof')) $('attRoof').value = 'gable';
 if ($('attName') && (!$('attName').dataset.touched || $('attName').value === 'Lean-to')) {
 $('attName').value = 'Gable extension';
 }
 if ($('attHint')) {
 $('attHint').textContent =
 'Gable extension: ridge runs down the middle of the depth; two slopes. Eave height is the outer/side eave.';
 }
 if ($('attPitch') && Number($('attPitch').value) < 3) $('attPitch').value = 4;
 } else {
 if ($('attRoof')) $('attRoof').value = 'shed';
 if ($('attName') && (!$('attName').dataset.touched || $('attName').value === 'Gable extension')) {
 $('attName').value = 'Lean-to';
 }
 if ($('attHint')) {
 $('attHint').textContent =
 'Lean-to (shed): mono roof from the main building down to the outer eave. Depth = how far it sticks out.';
 }
 }
 $('attName')?.addEventListener(
 'input',
 () => {
 if ($('attName')) $('attName').dataset.touched = '1';
 },
 { once: true },
 );
 }

 _selectedLeanTo() {
 const b = this.activeBuilding();
 if (!b || !this.selectedLeanToId) return null;
 return (b.leanTos || []).find((l) => l.id === this.selectedLeanToId) || null;
 }

 _bindLeanEditUi() {
 if (this._leanEditBound) return;
 this._leanEditBound = true;

 const fieldIds = [
 'ltName',
 'ltWall',
 'ltRoof',
 'ltDepth',
 'ltLength',
 'ltOffset',
 'ltEave',
 'ltPitch',
 'ltEnclosed',
 'ltOverhang',
 'ltMetalOh',
 'ltLiner',
 'ltSlab',
 'ltSlabThk',
 'ltSnap',
 'ltPostSp',
 ];

 const onEdit = () => {
 if (!this._selectedLeanTo()) return;
 this._pushUndoCoalesced('Edit lean-to', 700);
 this._applyLeanEditForm({ live: true });
 };

 for (const id of fieldIds) {
 const el = $(id);
 if (!el) continue;
 el.addEventListener('input', onEdit);
 el.addEventListener('change', onEdit);
 }

 $('leanEditClose')?.addEventListener('click', () => {
 this.selectedLeanToId = null;
 this._renderLeanTos();
 });
 }

 _syncLeanEditForm() {
 const panel = $('leanEditPanel');
 if (!panel) return;
 const lt = this._selectedLeanTo();
 if (!lt) {
 panel.style.display = 'none';
 return;
 }
 panel.style.display = 'block';
 if ($('leanEditTitle')) {
 $('leanEditTitle').textContent = `Edit: ${lt.name || 'Attachment'}`;
 }

 // Pause listeners while populating to avoid recursive apply
 this._leanFormSyncing = true;
 if ($('ltName')) $('ltName').value = lt.name || '';
 if ($('ltWall')) $('ltWall').value = lt.wall || 'left';
 if ($('ltRoof')) $('ltRoof').value = (lt.roofStyle || 'shed') === 'gable' ? 'gable' : 'shed';
 if ($('ltDepth')) $('ltDepth').value = lt.depth ?? 12;
 if ($('ltLength')) $('ltLength').value = lt.length ?? 0;
 if ($('ltOffset')) $('ltOffset').value = lt.offset ?? 0;
 if ($('ltEave')) $('ltEave').value = lt.eaveHeight ?? 10;
 if ($('ltPitch')) $('ltPitch').value = lt.pitch ?? b?.pitch ?? 4;
 if ($('ltEnclosed')) $('ltEnclosed').value = lt.enclosed === false ? 'open' : 'enclosed';
 if ($('ltOverhang')) $('ltOverhang').value = lt.overhangIn ?? 0;
 if ($('ltMetalOh')) $('ltMetalOh').value = lt.metalOverhangIn ?? 3;
 if ($('ltLiner')) $('ltLiner').value = lt.ceilingLiner === 'yes' ? 'yes' : 'none';
 if ($('ltSlab')) $('ltSlab').value = lt.hasSlab ? 'yes' : 'no';
 if ($('ltSlabThk')) {
 $('ltSlabThk').value =
 lt.slabThicknessIn ?? this.activeBuilding()?.slabThicknessIn ?? 4;
 }
 if ($('ltSnap')) $('ltSnap').value = lt.snapToPosts ? 'yes' : 'no';
 if ($('ltPostSp')) $('ltPostSp').value = lt.postSpacing ?? 10;
 this._leanFormSyncing = false;
 this._updateLeanSummaryHint(lt);
 }

 _updateLeanSummaryHint(lt) {
 const el = $('ltSummaryHint');
 if (!el || !lt) return;
 const len = lt.length > 0 ? `${lt.length}'` : 'full';
 const metalOh = lt.metalOverhangIn != null ? Number(lt.metalOverhangIn) : 3;
 const oh = (Number(lt.overhangIn) || 0) + metalOh;
 const liner = lt.ceilingLiner === 'yes' ? 'liner on' : 'no liner';
 const slab = lt.hasSlab
 ? `slab ${lt.slabThicknessIn != null ? lt.slabThicknessIn : 4}"`
 : 'no slab';
 const postSp = Number(lt.postSpacing) || 10;
 el.textContent = `${lt.enclosed === false ? 'Open' : 'Enclosed'} · ${lt.roofStyle || 'shed'} · ${lt.depth}'×${len} · ${lt.pitch}/12 · posts ${postSp}' o.c. · OH ${oh}" · ${liner} · ${slab}`;
 }

 _applyLeanEditForm({ live = false } = {}) {
 if (this._leanFormSyncing) return;
 const b = this.activeBuilding();
 const lt = this._selectedLeanTo();
 if (!b || !lt) return;

 const roofStyle = $('ltRoof')?.value === 'gable' ? 'gable' : 'shed';
 lt.name = ($('ltName')?.value || '').trim() || lt.name || 'Lean-to';
 lt.wall = $('ltWall')?.value || lt.wall || 'left';
 lt.roofStyle = roofStyle;
 lt.kind = roofStyle === 'gable' ? 'gable-extension' : 'leanto';
 lt.depth = Math.max(4, num('ltDepth') || lt.depth || 12);
 lt.length = Math.max(0, num('ltLength'));
 lt.offset = Math.max(0, num('ltOffset'));
 lt.eaveHeight = Math.max(6, num('ltEave') || lt.eaveHeight || 10);
 lt.pitch = Math.max(1, num('ltPitch') || lt.pitch || 3);
 lt.enclosed = $('ltEnclosed')?.value !== 'open';
 lt.overhangIn = Math.max(0, num('ltOverhang'));
 lt.metalOverhangIn = Math.max(0, $('ltMetalOh') ? num('ltMetalOh') : lt.metalOverhangIn ?? 3);
 lt.ceilingLiner = $('ltLiner')?.value === 'yes' ? 'yes' : 'none';
 lt.hasSlab = $('ltSlab')?.value === 'yes';
 lt.slabThicknessIn = Math.max(
 0,
 num('ltSlabThk') || lt.slabThicknessIn || b.slabThicknessIn || 4,
 );
 lt.snapToPosts = $('ltSnap')?.value === 'yes';
 lt.postSpacing = Math.max(4, num('ltPostSp') || 10);

 this._updateLeanSummaryHint(lt);
 this._refreshOpenHostOptions();

 if (live) {
 clearTimeout(this._leanLiveTimer);
 this._leanLiveTimer = setTimeout(() => {
 this.refresh();
 if ($('hint')) {
 $('hint').textContent = `Updated ${lt.name}: ${lt.depth}' deep, ${lt.pitch}/12 ${lt.roofStyle}, ${lt.enclosed ? 'enclosed' : 'open'}.`;
 }
 }, 80);
 } else {
 this.refresh();
 }
 }

 _renderLeanTos() {
 this._bindLeanEditUi();
 const b = this.activeBuilding();
 const el = $('leanTos');
 if (!el) return;

 // Drop selection if lean was removed or building changed
 if (this.selectedLeanToId && !(b?.leanTos || []).some((l) => l.id === this.selectedLeanToId)) {
 this.selectedLeanToId = null;
 }

 if (!b?.leanTos?.length) {
 el.innerHTML = '<div class="small">No attachments yet. Click Attached Building or + Add attachment.</div>';
 this._syncLeanEditForm();
 return;
 }

 el.innerHTML = b.leanTos
 .map((lt) => {
 const len = lt.length > 0 ? `${lt.length}'` : 'full wall';
 const roof = (lt.roofStyle || 'shed') === 'gable' ? 'Gable' : 'Shed';
 const title = lt.name || (roof === 'Gable' ? 'Gable extension' : 'Lean-to');
 const enclosed = lt.enclosed !== false;
 const encLabel = enclosed ? 'Enclosed' : 'Open';
 const liner = lt.ceilingLiner === 'yes' ? ' · liner' : '';
 const slab = lt.hasSlab ? ' · slab' : '';
 const postSp = Number(lt.postSpacing) || 10;
 const sel = lt.id === this.selectedLeanToId ? ' selected-lean' : '';
 return `<div class="list-item lean-row${sel}" data-select="${lt.id}">
 <div>
 <b>${esc(title)}</b>
 <span class="tag">${esc(encLabel)}</span>
 ${roof} · ${lt.depth}' deep × ${len} on ${esc(lt.wall)} · ${lt.eaveHeight}' eave · ${lt.pitch}/12 · posts ${postSp}' o.c.${liner}${slab}
 </div>
 <div class="list-actions">
 <button type="button" data-act="edit" data-id="${lt.id}">Edit</button>
 <button type="button" data-act="toggle-enc" data-id="${lt.id}" title="Toggle open / enclosed">${enclosed ? 'Make open' : 'Enclose'}</button>
 <button type="button" class="danger" data-act="remove" data-id="${lt.id}">Remove</button>
 </div>
 </div>`;
 })
 .join('');

 el.querySelectorAll('.lean-row').forEach((row) => {
 row.addEventListener('click', (ev) => {
 if (ev.target.closest('button')) return;
 this.selectedLeanToId = row.dataset.select;
 this._showInsp('details');
 this._renderLeanTos();
 });
 });

 el.querySelectorAll('button').forEach((btn) => {
 btn.addEventListener('click', (ev) => {
 ev.stopPropagation();
 const id = btn.dataset.id;
 const act = btn.dataset.act || 'remove';
 if (act === 'edit') {
 this.selectedLeanToId = id;
 this._showInsp('details');
 this._renderLeanTos();
 return;
 }
 if (act === 'toggle-enc') {
 const lt = b.leanTos.find((l) => l.id === id);
 if (!lt) return;
 this._pushUndo(lt.enclosed === false ? 'Enclose lean-to' : 'Open lean-to');
 lt.enclosed = lt.enclosed === false; // toggle: false→true, true/undefined→false
 if (this.selectedLeanToId === id) this._syncLeanEditForm();
 this.refresh();
 return;
 }
 this._pushUndo('Remove attachment');
 b.openings = b.openings.filter((o) => o.host !== id);
 const i = b.leanTos.findIndex((l) => l.id === id);
 if (i >= 0) b.leanTos.splice(i, 1);
 if (this.selectedLeanToId === id) this.selectedLeanToId = null;
 this._refreshOpenHostOptions();
 this.refresh();
 });
 });

 this._syncLeanEditForm();
 }
}

function num(id) {
 const el = $(id);
 if (!el) return 0;
 return parseFloat(el.value) || 0;
}

/**
 * Shipping weight (lb) for Job Review summary:
 *   6x6 posts ≈ 10 lb/ft  (18' → 180 lb)
 *   2x4 ≈ 1.5 lb/ft      (16' → 24 lb)
 *   2x6 dry ≈ 2.2 lb/ft  (20' → 44 lb); CCA/KDAT ≈ 3.35 (20' → 67 lb)
 *   2x8 ≈ 3.0 lb/ft      (12' → 36 lb)
 *   29ga panel ≈ 2.0 lb per lineal ft of cut length
 *     (matches production Weight column: 12' wall → 24 lb, 38'4" roof → ~76.7 lb)
 *   Engineered truss ≈ 6.62 lb per ft of span (30'×9 ≈ 1,787 lb production)
 *   Formed trim — production per-piece package weights (not a flat lb/ft):
 *     RidgeCap/Base often 0 lb; EaveEdge ~5 lb/pc; fascia ~4; corner ~3–4;
 *     WainscotTrim ~2; TopOfWall ~5.
 */
/** 29ga QLOC panel: lb per foot of cut length (3' coverage) — production Weight col. */
const PANEL_LB_PER_CUT_FT = 2.0;

function estimateLineWeightLb(i) {
 const q = Number(i.qty) || 0;
 if (q <= 0) return 0;
 const desc = `${i.description || ''} ${i.sku || ''} ${i.usage || ''}`;
 const usage = String(i.usage || '');
 const cat = i.category || '';
 // Parse "16'", "26' 7\"", "10' 6\"", decimal feet
 const lenFt = parseLengthFeet(i.length);

 if (cat === 'Freight' || cat === 'Labor') return 0;

 // 6x6 posts — 10 lb/ft
 if (
 usage === 'Post' ||
 /6x6|6X6|CCA POST|CCAPOST|PERMACOL/i.test(desc) ||
 (/Post/i.test(usage) && !/Protector|Bearer|Block/i.test(usage))
 ) {
 return q * Math.max(lenFt, 8) * 10.0;
 }

 // Engineered trusses — package weight scales with span
 // Calibrated to production Weight column: 30' × 9 trusses ≈ 1,787 lb → ~6.62 lb/ft span
 // (was 8.2 → ~2,214 lb on 30×40, ~427 lb high vs SB)
 if (cat === 'Trusses' || usage === 'Truss' || usage === 'TrussGableEnd') {
 let span = lenFt;
 if (!(span > 5)) {
 const m = desc.match(/(\d+)\s*'\s*span|TRUSS(\d{2,})|span\s*(\d+)/i);
 span = m ? parseFloat(m[1] || m[2] || m[3]) : 40;
 }
 const TRUSS_LB_PER_SPAN_FT = 6.62;
 return q * Math.max(span, 12) * TRUSS_LB_PER_SPAN_FT;
 }

 // Formed trim FIRST — before panel regex.
 // Bug: WainscotTrim matches "Wainscot" and TopOfWall SKU "FJQLP" matches "QLP",
 // so trim was weighed as 2 lb/ft panels (Summary ~1626 lb vs production ~495).
 if (cat === 'Trim') {
 return q * trimPieceWeightLb(usage, desc, lenFt);
 }

 // 29ga ag panels — by category/usage only (do not scan trim SKUs for QLP)
 if (
 cat === 'Sheathing' ||
 usage === 'ExteriorRoof' ||
 usage === 'ExteriorWall' ||
 usage === 'ExteriorSoffit' ||
 usage === 'Soffit' ||
 usage === 'Wainscot'
 ) {
 const L = Math.max(
 lenFt,
 usage === 'ExteriorSoffit' || usage === 'Soffit' || /Soffit/i.test(usage) ? 0.2 : 1,
 );
 return q * L * PANEL_LB_PER_CUT_FT;
 }

 // Dimensional lumber — framing line weights (match order-list Weight column)
 // Treated 2x6 skirt ~67 lb @ 20' (3.35 lb/ft); dry 2x6 girt ~44 lb @ 20' (2.2)
 let plf = 2.2; // default ~2x6 dry SYP
 if (/2x4|2X4/i.test(desc)) plf = 1.5;
 else if (/2x6|2X6/i.test(desc)) {
 plf = /CCA|KDAT|treated|pressure.?treat|ACQ|MCQ/i.test(desc + ' ' + usage)
 ? 3.35
 : 2.2;
 } else if (/2x8|2X8/i.test(desc)) plf = 3.0;
 else if (/2x10|2X10/i.test(desc)) plf = 3.7;
 else if (/2x12|2X12/i.test(desc)) plf = 4.4;
 if (cat === 'Framing' || cat === 'Insulation') {
 if (lenFt > 0) return q * lenFt * plf;
 if (/ThermaGuard|Fiberglass|INSUL|TMG/i.test(desc)) return q * 12;
 return q * 15;
 }
 if (cat === 'Accessories') {
 if (/16D RING|NAIL16DRS/i.test(desc)) return q * 50;
 if (/40D|NPB4025|POLE BARN 40D/i.test(desc)) return q * 30;
 if (/1 1\/2 Metwood|15MW|1 12 Metwood/i.test(desc)) return q * 3;
 if (/2 Metwood|2MW/i.test(desc)) return q * 4;
 if (/DECKSCR|STAR DRIVE DECK/i.test(desc)) return q * 4;
 if (/BUTYL/i.test(desc)) return q * 3;
 if (/CLOSURE/i.test(desc)) return q * 1;
 if (/THERMAGUARD|6125THGRD/i.test(desc)) return q * 0;
 if (/PAINT PEN|PAINTPEN/i.test(desc)) return q * 0;
 if (/SCREW5164|TIMBER HEX/i.test(desc)) return q * 0;
 if (/Screw|bag|NAIL/i.test(desc)) return q * 8;
 return q * 3;
 }
 if (cat === 'Concrete') {
 if (/Ready|mix|READYMIX/i.test(desc)) return q * 4000;
 if (/Rebar/i.test(desc)) return q * 20 * 0.668;
 return q * 5;
 }
 if (cat === 'Doors & Windows') return q * 80;
 return q * 5;
}

/**
 * Trim package weight (lb per piece).
 * Calibrated to typical formed-trim package weights.
 */
function trimPieceWeightLb(usage, desc, lenFt) {
 const u = String(usage || '');
 const d = String(desc || '');
 const L = Number(lenFt) || 10;

 // Often 0.00 lb — shipping weight not assigned / negligible
 if (
 u === 'RidgeCap' ||
 u === 'LeanToRidge' ||
 u === 'Base' ||
 u === 'LeanToBase' ||
 /Rat Guard|RTG/i.test(d)
 ) {
 return 0;
 }

 // Long eave trim — ~5.0 lb @ 10'
 if (u === 'EaveEdge' || u === 'LeanToEave' || /Long Eave|LET/i.test(d)) {
 return 0.5 * Math.max(L, 1); // 5 lb / 10'
 }

 // Top of wall foam/J — ~5.0 lb @ 10'
 if (u === 'TopOfWall' || /Quadra Loc|FJQLP|TopOfWall/i.test(d)) {
 return 0.5 * Math.max(L, 1);
 }

 // Single-angle fascia — ~4.0 lb @ 10'
 if (
 u === 'EaveFascia' ||
 u === 'GableFascia' ||
 /Single Angle|SANG/i.test(d)
 ) {
 return 0.4 * Math.max(L, 1);
 }

 // Wainscot double angle — ~2.0 lb @ 10'
 if (u === 'WainscotTrim' || /Double Angle|DANG/i.test(d)) {
 return 0.2 * Math.max(L, 1);
 }

 // Rake / corner / gable edge — ~3–4 lb/pc (weakly length-dependent)
 if (
 u === 'GableEdge' ||
 u === 'Corner' ||
 u === 'LeanToCorner' ||
 u === 'LeanToRake' ||
 /Rake and Corner|COR/i.test(d)
 ) {
 if (L >= 18) return 4.0;
 if (L >= 14) return 4.0;
 if (L >= 10) return 3.0;
 return 3.0;
 }

 // Sidewall / transition flash — light formed (estimate between eave & fascia)
 if (u === 'LeanToTransition' || /Sidewall|Transition|SWF/i.test(d)) {
 return 0.35 * Math.max(L, 1);
 }

 // Door/window trim — light
 if (/Door|Window|Trim/i.test(u)) {
 return 0.25 * Math.max(L, 8);
 }

 // Fallback: ~0.35 lb/ft actual length (no artificial 8' floor)
 return 0.35 * Math.max(L, 1);
}

/** Parse length labels: 16' | 26' 7" | 10.5 | 0' | 3' 7 1/2" */
function parseLengthFeet(raw) {
 const s = String(raw || '').trim();
 if (!s || s === "0'" || s === '0') return 0;
 // feet + inches + optional fraction: 3' 7 1/2" or 26' 7"
 const fiFrac = s.match(/(\d+)\s*'\s*(\d+)\s+(\d+)\s*\/\s*(\d+)\s*"?/);
 if (fiFrac) {
 return (
 parseInt(fiFrac[1], 10) +
 (parseInt(fiFrac[2], 10) + parseInt(fiFrac[3], 10) / parseInt(fiFrac[4], 10)) / 12
 );
 }
 // feet + inches: 26' 7" or 26'7"
 const fi = s.match(/(\d+)\s*'\s*(\d+)\s*"?/);
 if (fi) return parseInt(fi[1], 10) + parseInt(fi[2], 10) / 12;
 const ft = s.match(/(\d+(?:\.\d+)?)\s*'/);
 if (ft) return parseFloat(ft[1]);
 const n = parseFloat(s);
 return Number.isFinite(n) ? n : 0;
}

/**
 * Job Review sort: group by Usage, then length descending within each group.
 * e.g. all Posts together (26', 24', 22'…), then all Girts, Purlins, etc.
 */
/** Preferred Usage order within a section (production item-list style). */
const BOM_USAGE_ORDER = [
 'Post',
 'JambPost',
 'Header',
 'Trimmer',
 'Sill',
 'Backing',
 'TrussBearer',
 'SkirtBoard',
 'Girt',
 'Purlin',
 'EaveSubFascia',
 'GableSubFascia',
 'LeanToSubFascia',
 'Rafter',
 'EndRafter',
 'TrussBlock',
 'Truss',
 'TrussGableEnd',
 'ExteriorRoof',
 'ExteriorWall',
 'ExteriorSoffit',
 'Soffit',
 'Wainscot',
 'RidgeCap',
 'EaveEdge',
 'EaveFascia',
 'GableFascia',
 'GableEdge',
 'Corner',
 'Base',
 'WainscotTrim',
 'TopOfWall',
];

function usageSortKey(usage) {
  const u = String(usage || '').trim();
  const i = BOM_USAGE_ORDER.indexOf(u);
  return i >= 0 ? i : 1000; // unknown usages sort alpha after known
}

const BOM_CATEGORY_ORDER = [
  'Framing',
  'Sheathing',
  'Trim',
  'Doors & Windows',
  'Accessories',
  'Trusses',
  'Insulation',
  'Concrete',
  'Labor',
  'Freight',
];

function categorySortKey(cat) {
  const c = String(cat || '').trim();
  const i = BOM_CATEGORY_ORDER.indexOf(c);
  return i >= 0 ? i : 500; // unknown categories after known, then alpha via usage
}

function sortBomItemsByLength(items) {
  return [...items].sort((a, b) => {
    // Section first (matters on "All lines")
    const ca = categorySortKey(a.category);
    const cb = categorySortKey(b.category);
    if (ca !== cb) return ca - cb;

    const ua = String(a.usage || a.category || '');
    const ub = String(b.usage || b.category || '');
    const ka = usageSortKey(ua);
    const kb = usageSortKey(ub);
    if (ka !== kb) return ka - kb;
    // Same usage family — alpha if both unknown
    if (ka >= 1000 && ua !== ub) return ua.localeCompare(ub);

    // Within group: longest first
    const la = parseLengthFeet(a.length);
    const lb = parseLengthFeet(b.length);
    if (Math.abs(lb - la) > 1e-6) return lb - la;
    const d = String(a.description || '').localeCompare(String(b.description || ''));
    if (d) return d;
    return (Number(b.qty) || 0) - (Number(a.qty) || 0);
  });
}

function formatQty(q) {
 if (Number.isInteger(q)) return String(q);
 return (Math.round(q * 100) / 100).toString();
}

function esc(s) {
 return String(s ?? '')
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;');
}

function slug(s) {
 return String(s || 'job').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'job';
}

function download(blob, filename) {
 const a = document.createElement('a');
 a.href = URL.createObjectURL(blob);
 a.download = filename;
 a.click();
 URL.revokeObjectURL(a.href);
}
