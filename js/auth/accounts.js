/**
 * Browser-local accounts (email + password).
 * Passwords: PBKDF2-SHA-256 (migrates legacy SHA-256 on login).
 * Successful login unlocks the AES-GCM data vault for jobs/CRM.
 * Never throws on boot — always leaves a usable admin account (dev/local).
 */

import {
  pbkdf2Hex,
  vaultIterations,
  unlockVault,
  lockVault,
  rewrapVaultForNewPassword,
} from '../security/cryptoVault.js';

const USERS_KEY = 'polebarn_pro_users_v2';
const SESSION_KEY = 'polebarn_pro_session_v1';
const LEGACY_USERS_KEY = 'polebarn_pro_users_v1';

const DEFAULT_ADMIN = {
  email: 'admin@webuildstructures.com',
  password: 'Admin123!',
  name: 'Administrator',
  role: 'admin',
};

const MIN_PASSWORD_LEN = 8;

function uid(prefix = 'usr') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomSalt() {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return toHex(bytes);
  } catch {
    return `salt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

/** Legacy fast SHA-256 (migrate away on next successful login). */
async function hashPasswordLegacySha256(password, salt) {
  const raw = `${String(salt)}|${String(password)}`;
  try {
    if (globalThis.crypto?.subtle) {
      const data = new TextEncoder().encode(raw);
      const buf = await crypto.subtle.digest('SHA-256', data);
      return toHex(buf);
    }
  } catch (err) {
    console.warn('subtle digest failed, using fallback hash', err);
  }
  let h1 = 2166136261;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 16777619);
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
  }
  const a = (h1 >>> 0).toString(16).padStart(8, '0');
  const b = (h2 >>> 0).toString(16).padStart(8, '0');
  return (a + b).padEnd(64, '0').slice(0, 64);
}

async function hashPassword(password, salt, iterations = vaultIterations()) {
  return pbkdf2Hex(password, salt, iterations);
}

function isProdHost() {
  try {
    const h = String(location.hostname || '');
    return h && h !== 'localhost' && h !== '127.0.0.1' && !h.endsWith('.local');
  } catch {
    return false;
  }
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function readUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeUsers(list) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('writeUsers failed', err);
  }
}

function userLooksValid(u) {
  return !!(u && u.id && u.email && u.salt && u.passwordHash);
}

async function buildUser({ email, password, name, role, isSeed = false, id = null }) {
  const salt = randomSalt();
  const iterations = vaultIterations();
  const passwordHash = await hashPassword(password, salt, iterations);
  return {
    id: id || uid('usr'),
    email: normalizeEmail(email),
    name: (name || 'User').trim(),
    role: role === 'admin' ? 'admin' : 'user',
    salt,
    passwordHash,
    hashAlgo: 'pbkdf2-sha256',
    hashIter: iterations,
    active: true,
    isSeed: !!isSeed,
    mustChangePassword: !!isSeed,
    createdAt: new Date().toISOString(),
  };
}

async function verifyPassword(user, password) {
  const algo = user.hashAlgo || 'sha256';
  if (algo === 'pbkdf2-sha256') {
    const iter = user.hashIter || vaultIterations();
    const hash = await hashPassword(password, user.salt, iter);
    return hash === user.passwordHash;
  }
  const legacy = await hashPasswordLegacySha256(password, user.salt);
  return legacy === user.passwordHash;
}

async function upgradeUserHash(user, password) {
  const salt = randomSalt();
  const iterations = vaultIterations();
  user.salt = salt;
  user.passwordHash = await hashPassword(password, salt, iterations);
  user.hashAlgo = 'pbkdf2-sha256';
  user.hashIter = iterations;
}

/**
 * Always succeeds. Creates / repairs default admin on local/dev.
 * Production hosts do not auto-heal the default password.
 */
export async function ensureSeedAdmin() {
  try {
    try {
      localStorage.removeItem(LEGACY_USERS_KEY);
    } catch (_) {}

    let users = readUsers().filter((u) => u && u.email);
    const adminEmail = normalizeEmail(DEFAULT_ADMIN.email);
    let admin = users.find((u) => normalizeEmail(u.email) === adminEmail);

    let needWrite = false;
    if (!admin || !userLooksValid(admin)) {
      const fixed = await buildUser({
        email: DEFAULT_ADMIN.email,
        password: DEFAULT_ADMIN.password,
        name: (admin && admin.name) || DEFAULT_ADMIN.name,
        role: 'admin',
        isSeed: true,
        id: admin?.id,
      });
      if (admin?.createdAt) fixed.createdAt = admin.createdAt;
      users = [fixed, ...users.filter((u) => normalizeEmail(u.email) !== adminEmail)];
      admin = fixed;
      needWrite = true;
    } else if (admin.isSeed && !isProdHost()) {
      // Local/dev: keep seed admin usable with default password if still marked seed
      const ok = await verifyPassword(admin, DEFAULT_ADMIN.password);
      if (!ok) {
        const fixed = await buildUser({
          email: DEFAULT_ADMIN.email,
          password: DEFAULT_ADMIN.password,
          name: admin.name || DEFAULT_ADMIN.name,
          role: 'admin',
          isSeed: true,
          id: admin.id,
        });
        fixed.createdAt = admin.createdAt || fixed.createdAt;
        users = [fixed, ...users.filter((u) => normalizeEmail(u.email) !== adminEmail)];
        needWrite = true;
      }
    }

    if (!users.some((u) => u.role === 'admin' && u.active !== false)) {
      const fixed = await buildUser({
        email: DEFAULT_ADMIN.email,
        password: DEFAULT_ADMIN.password,
        name: DEFAULT_ADMIN.name,
        role: 'admin',
        isSeed: true,
      });
      users = [fixed, ...users.filter((u) => normalizeEmail(u.email) !== adminEmail)];
      needWrite = true;
    }

    if (needWrite || !readUsers().length) writeUsers(users);

    if (!isProdHost()) {
      try {
        const check = await verifyPassword(
          readUsers().find((u) => normalizeEmail(u.email) === adminEmail) || {},
          DEFAULT_ADMIN.password,
        );
        if (!check) {
          const hard = await buildUser({
            email: DEFAULT_ADMIN.email,
            password: DEFAULT_ADMIN.password,
            name: DEFAULT_ADMIN.name,
            role: 'admin',
            isSeed: true,
          });
          const rest = readUsers().filter((u) => normalizeEmail(u.email) !== adminEmail);
          writeUsers([hard, ...rest]);
        }
      } catch (_) {
        /* ignore */
      }
    }

    clearSession();
    lockVault();

    return {
      created: needWrite,
      users: readUsers(),
      defaultCredentials: isProdHost()
        ? { email: DEFAULT_ADMIN.email, password: '' }
        : {
            email: DEFAULT_ADMIN.email,
            password: DEFAULT_ADMIN.password,
          },
      isProd: isProdHost(),
    };
  } catch (err) {
    console.error('ensureSeedAdmin recovered from error', err);
    try {
      const fixed = await buildUser({
        email: DEFAULT_ADMIN.email,
        password: DEFAULT_ADMIN.password,
        name: DEFAULT_ADMIN.name,
        role: 'admin',
        isSeed: true,
      });
      writeUsers([fixed]);
    } catch (_) {}
    clearSession();
    lockVault();
    return {
      created: true,
      users: readUsers(),
      defaultCredentials: {
        email: DEFAULT_ADMIN.email,
        password: isProdHost() ? '' : DEFAULT_ADMIN.password,
      },
      isProd: isProdHost(),
    };
  }
}

export async function resetDefaultAdminPassword() {
  if (isProdHost()) {
    return {
      ok: false,
      error: 'Reset default admin is disabled on production hosts. Use an existing admin account.',
    };
  }
  const adminEmail = normalizeEmail(DEFAULT_ADMIN.email);
  const users = readUsers();
  const existing = users.find((u) => normalizeEmail(u.email) === adminEmail);
  const fixed = await buildUser({
    email: DEFAULT_ADMIN.email,
    password: DEFAULT_ADMIN.password,
    name: existing?.name || DEFAULT_ADMIN.name,
    role: 'admin',
    isSeed: true,
    id: existing?.id,
  });
  fixed.createdAt = existing?.createdAt || fixed.createdAt;
  writeUsers([fixed, ...users.filter((u) => normalizeEmail(u.email) !== adminEmail)]);
  clearSession();
  lockVault();
  return {
    ok: true,
    email: DEFAULT_ADMIN.email,
    password: DEFAULT_ADMIN.password,
  };
}

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.userId) return null;
    const user = readUsers().find((u) => u.id === s.userId && u.active !== false);
    if (!user) {
      clearSession();
      return null;
    }
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: !!(user.mustChangePassword || user.isSeed),
      loggedInAt: s.loggedInAt,
    };
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}

function setSession(user) {
  const session = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    loggedInAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (_) {}
  return {
    ...session,
    mustChangePassword: !!(user.mustChangePassword || user.isSeed),
  };
}

export async function login(email, password) {
  const e = normalizeEmail(email);
  const pw = String(password ?? '').replace(/^\s+|\s+$/g, '');
  if (!e || !pw) return { ok: false, error: 'Enter email and password.' };

  let users = readUsers();
  if (!users.length) {
    await ensureSeedAdmin();
    users = readUsers();
  }

  const user = users.find((u) => normalizeEmail(u.email) === e);
  if (!user) {
    return {
      ok: false,
      error: isProdHost()
        ? `No account for “${e}”.`
        : `No account for “${e}”. Use ${DEFAULT_ADMIN.email} / ${DEFAULT_ADMIN.password}`,
    };
  }
  if (user.active === false) {
    return { ok: false, error: 'That account is disabled.' };
  }

  let ok = await verifyPassword(user, pw);
  if (!ok) {
    if (
      !isProdHost() &&
      normalizeEmail(user.email) === normalizeEmail(DEFAULT_ADMIN.email) &&
      pw === DEFAULT_ADMIN.password
    ) {
      await resetDefaultAdminPassword();
      return login(email, password);
    }
    return {
      ok: false,
      error: isProdHost()
        ? 'Wrong password.'
        : 'Wrong password. Default is Admin123! (capital A + !). Or click Reset admin password.',
    };
  }

  // Migrate legacy SHA-256 → PBKDF2
  if ((user.hashAlgo || 'sha256') !== 'pbkdf2-sha256') {
    await upgradeUserHash(user, pw);
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      users[idx] = user;
      writeUsers(users);
    }
  }

  try {
    await unlockVault(user.id, pw);
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'Signed in, but data vault failed to unlock.',
    };
  }

  const mustChange = !!(user.mustChangePassword || user.isSeed);
  return {
    ok: true,
    session: setSession(user),
    mustChangePassword: mustChange,
  };
}

/**
 * Change password for the signed-in user (required after seed login).
 * Rewraps the data vault DEK so jobs/CRM stay readable.
 */
export async function changeOwnPassword(currentPassword, newPassword) {
  const session = getSession();
  if (!session?.userId) return { ok: false, error: 'Not signed in.' };
  const pw = String(newPassword || '');
  if (pw.length < MIN_PASSWORD_LEN) {
    return { ok: false, error: `New password must be at least ${MIN_PASSWORD_LEN} characters.` };
  }
  if (pw === DEFAULT_ADMIN.password) {
    return { ok: false, error: 'Choose a new password — do not reuse the default.' };
  }

  const users = readUsers();
  const idx = users.findIndex((u) => u.id === session.userId);
  if (idx < 0) return { ok: false, error: 'User not found.' };
  const user = { ...users[idx] };

  const ok = await verifyPassword(user, currentPassword);
  if (!ok) return { ok: false, error: 'Current password is incorrect.' };

  try {
    await rewrapVaultForNewPassword(user.id, currentPassword, pw);
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not re-seal data vault.' };
  }

  await upgradeUserHash(user, pw);
  user.isSeed = false;
  user.mustChangePassword = false;
  users[idx] = user;
  writeUsers(users);
  setSession(user);
  return { ok: true, session: getSession() };
}

export function logout() {
  lockVault();
  clearSession();
}

export function listUsers() {
  return readUsers().map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active !== false,
    createdAt: u.createdAt,
  }));
}

export async function createUser({ email, password, name, role }, actor) {
  if (!actor || actor.role !== 'admin') {
    return { ok: false, error: 'Only admins can create accounts.' };
  }
  const e = normalizeEmail(email);
  if (!e || !e.includes('@')) return { ok: false, error: 'Enter a valid email address.' };
  if (!password || String(password).length < MIN_PASSWORD_LEN) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` };
  }
  const users = readUsers();
  if (users.some((u) => normalizeEmail(u.email) === e)) {
    return { ok: false, error: 'An account with that email already exists.' };
  }
  const user = await buildUser({
    email: e,
    password: String(password),
    name: (name || e.split('@')[0] || 'User').trim(),
    role: role === 'admin' ? 'admin' : 'user',
    isSeed: false,
  });
  user.mustChangePassword = false;
  users.push(user);
  writeUsers(users);
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      active: true,
      createdAt: user.createdAt,
    },
  };
}

export async function updateUser(userId, patch, actor) {
  if (!actor || actor.role !== 'admin') {
    return { ok: false, error: 'Only admins can edit accounts.' };
  }
  const users = readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx < 0) return { ok: false, error: 'User not found.' };
  const user = { ...users[idx] };

  if (patch.role === 'user' || patch.active === false) {
    const wouldDemote = patch.role === 'user' && user.role === 'admin';
    const wouldDisable = patch.active === false && user.active !== false;
    if (wouldDemote || wouldDisable) {
      const otherAdmins = users.filter(
        (u) => u.id !== userId && u.role === 'admin' && u.active !== false,
      );
      if (!otherAdmins.length) {
        return { ok: false, error: 'Cannot remove or demote the last admin account.' };
      }
    }
  }

  if (patch.name != null) user.name = String(patch.name).trim() || user.name;
  if (patch.role === 'admin' || patch.role === 'user') user.role = patch.role;
  if (typeof patch.active === 'boolean') user.active = patch.active;

  if (patch.password) {
    if (String(patch.password).length < MIN_PASSWORD_LEN) {
      return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` };
    }
    await upgradeUserHash(user, String(patch.password));
    if (normalizeEmail(user.email) === normalizeEmail(DEFAULT_ADMIN.email)) {
      user.isSeed = false;
      user.mustChangePassword = false;
    }
  }

  users[idx] = user;
  writeUsers(users);
  const session = getSession();
  if (session?.userId === userId) setSession(user);
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      active: user.active !== false,
      createdAt: user.createdAt,
    },
  };
}

export function deleteUser(userId, actor) {
  if (!actor || actor.role !== 'admin') {
    return { ok: false, error: 'Only admins can delete accounts.' };
  }
  if (actor.userId === userId) {
    return { ok: false, error: 'You cannot delete your own account while logged in.' };
  }
  const users = readUsers();
  const target = users.find((u) => u.id === userId);
  if (!target) return { ok: false, error: 'User not found.' };
  if (target.role === 'admin') {
    const otherAdmins = users.filter(
      (u) => u.id !== userId && u.role === 'admin' && u.active !== false,
    );
    if (!otherAdmins.length) {
      return { ok: false, error: 'Cannot delete the last admin account.' };
    }
  }
  writeUsers(users.filter((u) => u.id !== userId));
  return { ok: true };
}

/** Clear session + user table (recovery). */
export function wipeAuthStorage() {
  try {
    localStorage.removeItem(USERS_KEY);
    localStorage.removeItem(LEGACY_USERS_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch (_) {}
  lockVault();
}

export { DEFAULT_ADMIN, MIN_PASSWORD_LEN, isProdHost };
