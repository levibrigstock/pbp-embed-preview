/**
 * Reliable boot:
 * 1) Login is already visible in HTML
 * 2) Load modules
 * 3) Seed accounts (never throws)
 * 4) Start App
 */

function setStatus(text) {
 const el = document.getElementById('bootStatus');
 if (!el) return;
 if (!text) {
 el.style.display = 'none';
 el.textContent = '';
 return;
 }
 el.style.display = 'block';
 el.textContent = text;
}

function showError(msg) {
 console.error(msg);
 setStatus('');
 const login = document.getElementById('loginScreen');
 if (login) {
 login.classList.remove('is-hidden');
 login.style.display = 'flex';
 }
 const shell = document.getElementById('appShell');
 if (shell) {
 shell.style.display = 'none';
 shell.classList.remove('is-open');
 }
 const err = document.getElementById('loginError');
 if (err) {
 err.style.display = 'block';
 err.textContent = String(msg);
 }
}

// Keep login painted even if later JS fails
try {
 const login = document.getElementById('loginScreen');
 if (login) login.style.display = 'flex';
} catch (_) {}

window.addEventListener('DOMContentLoaded', () => {
 boot();
});

async function boot() {
 setStatus('Starting…');
 try {
 setStatus('Loading app…');
 const [{ App }, auth] = await Promise.all([
 import('./ui/app.js?v=20260806f'),
 import('./auth/accounts.js?v=20260806f'),
 ]);

 setStatus('Preparing accounts…');
 let seed;
 try {
 seed = await auth.ensureSeedAdmin();
 } catch (e) {
 console.warn('seed failed, wiping auth', e);
 try {
 auth.wipeAuthStorage();
 seed = await auth.ensureSeedAdmin();
 } catch (e2) {
 seed = {
 created: true,
 defaultCredentials: {
 email: 'admin@webuildstructures.com',
 password: 'Admin123!',
 },
 };
 }
 }

 setStatus('Ready');
 window.__polebarn = new App({ seed });
 setStatus('');
 } catch (err) {
 console.error(err);
 showError(
 'Could not start PoleBarn Pro: ' +
 (err?.message || err) +
 '. Click “Fix app storage” below if this keeps happening.',
 );
 // Wire recovery button if present
 const fixBtn = document.getElementById('fixStorageBtn');
 if (fixBtn) fixBtn.style.display = 'block';
 }
}

window.addEventListener('unhandledrejection', (ev) => {
 console.error('unhandledrejection', ev.reason);
 if (!window.__polebarn) {
 showError('Startup error: ' + (ev.reason?.message || ev.reason || 'unknown'));
 }
});
