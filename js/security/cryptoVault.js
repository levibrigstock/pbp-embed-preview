/**
 * PoleBarn Pro — local data vault (Phase 0)
 *
 * - Password → PBKDF2-SHA-256 → KEK
 * - Random AES-256-GCM data key (DEK) wrapped by KEK
 * - Jobs / CRM sealed as AES-GCM envelopes in localStorage
 *
 * Key material lives in memory only while unlocked. Logout / refresh locks it.
 */

const VAULT_META_PREFIX = 'polebarn_pro_vault_meta_';
const VAULT_VERSION = 1;
const PBKDF2_ITERATIONS = 210_000;
const TEXT = new TextEncoder();
const TEXT_OUT = new TextDecoder();

/** @type {CryptoKey | null} */
let dek = null;
/** @type {string | null} */
let unlockedUserId = null;

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex) {
  const s = String(hex || '');
  if (s.length % 2) throw new Error('Invalid hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(String(b64 || ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function metaKey(userId) {
  return `${VAULT_META_PREFIX}${userId || 'local'}`;
}

function requireSubtle() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required for encrypted storage.');
  }
  return crypto.subtle;
}

export function isVaultUnlocked() {
  return !!(dek && unlockedUserId);
}

export function vaultUserId() {
  return unlockedUserId;
}

export function lockVault() {
  dek = null;
  unlockedUserId = null;
}

/** True when a string looks like a PBP vault envelope (not plaintext JSON). */
export function looksEncrypted(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const t = raw.trim();
  if (!t.startsWith('{')) return false;
  try {
    const o = JSON.parse(t);
    return !!(o && o.__pbpVault === VAULT_VERSION && o.ct && o.iv);
  } catch {
    return false;
  }
}

async function importPasswordKey(password) {
  const subtle = requireSubtle();
  return subtle.importKey('raw', TEXT.encode(String(password)), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ]);
}

async function deriveKek(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const subtle = requireSubtle();
  const base = await importPasswordKey(password);
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt'],
  );
}

/** PBKDF2-SHA-256 hex digest for password verification (auth). */
export async function pbkdf2Hex(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  const subtle = requireSubtle();
  const base = await importPasswordKey(password);
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: fromHex(saltHex),
      iterations,
      hash: 'SHA-256',
    },
    base,
    256,
  );
  return toHex(bits);
}

export function newSaltHex(bytes = 16) {
  return toHex(randomBytes(bytes));
}

export function vaultIterations() {
  return PBKDF2_ITERATIONS;
}

function readMeta(userId) {
  try {
    const raw = localStorage.getItem(metaKey(userId));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || o.v !== VAULT_VERSION || !o.salt || !o.wrappedKey) return null;
    return o;
  } catch {
    return null;
  }
}

function writeMeta(userId, meta) {
  localStorage.setItem(metaKey(userId), JSON.stringify(meta));
}

async function createFreshVault(userId, password) {
  const subtle = requireSubtle();
  const salt = randomBytes(16);
  const kek = await deriveKek(password, salt);
  const freshDek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const iv = randomBytes(12);
  const wrapped = await subtle.wrapKey('raw', freshDek, kek, {
    name: 'AES-GCM',
    iv,
  });
  writeMeta(userId, {
    v: VAULT_VERSION,
    kdf: 'PBKDF2-SHA256',
    iter: PBKDF2_ITERATIONS,
    salt: toHex(salt),
    iv: toHex(iv),
    wrappedKey: toB64(wrapped),
    createdAt: new Date().toISOString(),
  });
  dek = freshDek;
  unlockedUserId = userId;
  return { created: true };
}

/**
 * Unlock (or create) the vault for this user with their login password.
 */
export async function unlockVault(userId, password) {
  if (!userId) throw new Error('Missing user id for vault.');
  if (!password) throw new Error('Password required to unlock vault.');
  requireSubtle();

  const meta = readMeta(userId);
  if (!meta) {
    return createFreshVault(userId, password);
  }

  const subtle = requireSubtle();
  const kek = await deriveKek(password, fromHex(meta.salt), meta.iter || PBKDF2_ITERATIONS);
  try {
    // extractable:true so password-change can re-wrap the same DEK (key never leaves memory to disk)
    dek = await subtle.unwrapKey(
      'raw',
      fromB64(meta.wrappedKey),
      kek,
      { name: 'AES-GCM', iv: fromHex(meta.iv) },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  } catch {
    lockVault();
    throw new Error('Could not unlock data vault — wrong password or corrupt key.');
  }
  unlockedUserId = userId;
  return { created: false };
}

/**
 * After a password change: re-wrap the same DEK with the new password.
 * Vault must already be unlocked (or pass oldPassword to unlock first).
 */
export async function rewrapVaultForNewPassword(userId, oldPassword, newPassword) {
  if (!isVaultUnlocked() || unlockedUserId !== userId) {
    await unlockVault(userId, oldPassword);
  }
  if (!dek) throw new Error('Vault not unlocked.');
  const subtle = requireSubtle();
  // Export DEK raw, then create new wrap
  const exported = await subtle.exportKey('raw', dek);
  const freshDek = await subtle.importKey('raw', exported, { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const salt = randomBytes(16);
  const kek = await deriveKek(newPassword, salt);
  const iv = randomBytes(12);
  const wrapped = await subtle.wrapKey('raw', freshDek, kek, { name: 'AES-GCM', iv });
  writeMeta(userId, {
    v: VAULT_VERSION,
    kdf: 'PBKDF2-SHA256',
    iter: PBKDF2_ITERATIONS,
    salt: toHex(salt),
    iv: toHex(iv),
    wrappedKey: toB64(wrapped),
    createdAt: new Date().toISOString(),
  });
  dek = await subtle.importKey('raw', exported, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  unlockedUserId = userId;
}

/** Encrypt a JSON-serializable value → envelope JSON string. */
export async function sealJson(value) {
  if (!dek) throw new Error('Data vault is locked. Sign in again.');
  const subtle = requireSubtle();
  const iv = randomBytes(12);
  const plain = TEXT.encode(JSON.stringify(value));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, dek, plain);
  return JSON.stringify({
    __pbpVault: VAULT_VERSION,
    alg: 'AES-GCM',
    iv: toHex(iv),
    ct: toB64(ct),
  });
}

/** Decrypt envelope JSON string → value. Throws if locked / corrupt. */
export async function openJson(raw) {
  if (!dek) throw new Error('Data vault is locked. Sign in again.');
  if (!looksEncrypted(raw)) {
    return JSON.parse(raw);
  }
  const subtle = requireSubtle();
  const env = JSON.parse(raw);
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromHex(env.iv) },
    dek,
    fromB64(env.ct),
  );
  return JSON.parse(TEXT_OUT.decode(plain));
}

/**
 * Read localStorage key: decrypt if sealed, else parse plaintext and
 * optionally migrate to sealed form.
 */
export async function loadSealed(key, { migrate = true } = {}) {
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  if (looksEncrypted(raw)) {
    return openJson(raw);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (migrate && isVaultUnlocked()) {
    try {
      localStorage.setItem(key, await sealJson(value));
    } catch (err) {
      console.warn('Vault migrate failed for', key, err);
    }
  }
  return value;
}

/** Seal value and write to localStorage. */
export async function saveSealed(key, value) {
  if (!isVaultUnlocked()) throw new Error('Data vault is locked. Sign in again.');
  localStorage.setItem(key, await sealJson(value));
}

/** Download an encrypted backup blob for the given payload. */
export async function exportEncryptedBackup(filename, value) {
  const sealed = await sealJson(value);
  const blob = new Blob([sealed], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.pbpvault') ? filename : `${filename}.pbpvault`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
