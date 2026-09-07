/**
 * Cloud runtime config (Phase 1).
 * Prefer js/cloud/runtime-config.json written by deploy:aws:api.
 * Falls back to window.__PBP_CLOUD__ or disabled local-only mode.
 */

let cached = null;

const DEFAULT = {
  enabled: false,
  region: 'us-east-1',
  userPoolId: '',
  clientId: '',
  apiBase: '',
};

export async function loadCloudConfig() {
  if (cached) return cached;
  if (typeof window !== 'undefined' && window.__PBP_CLOUD__) {
    cached = { ...DEFAULT, ...window.__PBP_CLOUD__, enabled: true };
    return cached;
  }
  try {
    const res = await fetch('./js/cloud/runtime-config.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      cached = { ...DEFAULT, ...json };
      return cached;
    }
  } catch (_) {
    /* offline / missing file */
  }
  cached = { ...DEFAULT };
  return cached;
}

export function isCloudEnabled(cfg) {
  const c = cfg || cached || DEFAULT;
  return !!(c.enabled && c.userPoolId && c.clientId && c.apiBase);
}

export function clearCloudConfigCache() {
  cached = null;
}
