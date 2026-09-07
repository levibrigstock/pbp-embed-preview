/**
 * Authenticated fetch against the PoleBarn Pro HTTP API.
 */

import { loadCloudConfig, isCloudEnabled } from './config.js';
import { getIdToken } from './cognitoAuth.js';

async function apiFetch(path, { method = 'GET', body } = {}) {
  const cfg = await loadCloudConfig();
  if (!isCloudEnabled(cfg)) {
    throw new Error('Cloud API is not configured.');
  }
  const token = await getIdToken();
  if (!token) throw new Error('Not signed in to cloud.');

  const url = `${String(cfg.apiBase).replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body != null ? { 'content-type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `API ${res.status}`);
  }
  return json;
}

export async function cloudGetMe() {
  return apiFetch('me');
}

export async function cloudListJobs() {
  const out = await apiFetch('jobs');
  return out.jobs || [];
}

export async function cloudGetJob(id) {
  return apiFetch(`jobs/${encodeURIComponent(id)}`);
}

export async function cloudPutJob(id, payload) {
  return apiFetch(`jobs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: payload,
  });
}

export async function cloudDeleteJob(id) {
  return apiFetch(`jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function cloudGetCrm() {
  return apiFetch('crm');
}

export async function cloudPutCrm(board) {
  return apiFetch('crm', { method: 'PUT', body: { board } });
}
