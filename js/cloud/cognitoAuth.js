/**
 * Minimal Cognito USER_PASSWORD_AUTH for the SPA (no Amplify dependency).
 * Tokens kept in sessionStorage; cleared on logout.
 */

import { loadCloudConfig, isCloudEnabled } from './config.js';

const TOKENS_KEY = 'polebarn_pro_cognito_tokens_v1';

function cognitoEndpoint(region) {
  return `https://cognito-idp.${region}.amazonaws.com/`;
}

async function cognitoCall(region, target, body) {
  const res = await fetch(cognitoEndpoint(region), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.message || json.__type || `Cognito error ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

export function readTokens() {
  try {
    const raw = sessionStorage.getItem(TOKENS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearTokens() {
  try {
    sessionStorage.removeItem(TOKENS_KEY);
  } catch (_) {}
}

function saveTokens(auth) {
  const payload = {
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    refreshToken: auth.RefreshToken,
    expiresAt: Date.now() + (Number(auth.ExpiresIn) || 3600) * 1000 - 30_000,
  };
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(payload));
  return payload;
}

/** Decode JWT payload (no verify — API Gateway verifies). */
export function decodeJwt(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function cloudLogin(email, password) {
  const cfg = await loadCloudConfig();
  if (!isCloudEnabled(cfg)) {
    return { ok: false, error: 'Cloud auth is not configured.' };
  }
  try {
    const out = await cognitoCall(cfg.region, 'InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: cfg.clientId,
      AuthParameters: {
        USERNAME: String(email || '').trim().toLowerCase(),
        PASSWORD: String(password || ''),
      },
    });
    if (out.ChallengeName) {
      return {
        ok: false,
        error: `Additional challenge required: ${out.ChallengeName}. Complete via Cognito console / MFA setup.`,
        challenge: out,
      };
    }
    if (!out.AuthenticationResult?.IdToken) {
      return { ok: false, error: 'Sign-in failed (no tokens).' };
    }
    const tokens = saveTokens(out.AuthenticationResult);
    const claims = decodeJwt(tokens.idToken) || {};
    return {
      ok: true,
      tokens,
      session: {
        userId: claims.sub,
        email: claims.email || email,
        name: claims.name || claims.email || 'User',
        role: (claims['cognito:groups'] || []).includes('admin') ? 'admin' : 'user',
        cloud: true,
        loggedInAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, error: e.message || 'Cloud sign-in failed.' };
  }
}

export async function refreshCloudSession() {
  const cfg = await loadCloudConfig();
  const tokens = readTokens();
  if (!isCloudEnabled(cfg) || !tokens?.refreshToken) return null;
  if (tokens.expiresAt && Date.now() < tokens.expiresAt && tokens.idToken) {
    return tokens;
  }
  try {
    const out = await cognitoCall(cfg.region, 'InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: cfg.clientId,
      AuthParameters: {
        REFRESH_TOKEN: tokens.refreshToken,
      },
    });
    if (!out.AuthenticationResult) return null;
    // Refresh flow may omit refresh token — keep previous
    const merged = {
      ...out.AuthenticationResult,
      RefreshToken: out.AuthenticationResult.RefreshToken || tokens.refreshToken,
    };
    return saveTokens(merged);
  } catch {
    clearTokens();
    return null;
  }
}

export async function getIdToken() {
  const tokens = (await refreshCloudSession()) || readTokens();
  return tokens?.idToken || null;
}

export function cloudLogout() {
  clearTokens();
}
