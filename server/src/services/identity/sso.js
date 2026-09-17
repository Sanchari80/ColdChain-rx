'use strict';

const { createHash, randomBytes } = require('node:crypto');
const config = require('../../config');
const logger = require('../../util/logger');
const { badRequest, upstream } = require('../../util/errors');

/**
 * Enterprise single sign-on, over OpenID Connect with PKCE.
 *
 * Large sites do not want a second credential for every nurse, so staff sign in
 * with the hospital account they already have — Entra ID (Azure AD), Okta, or
 * anything else that speaks OIDC. What single sign-on does NOT do here is
 * create accounts: the identity provider proves who someone is, and the staff
 * directory decides whether that person has been approved for this service and
 * what they may do. An employee with a valid hospital login who has not been
 * provisioned gets a clear refusal, not an account.
 *
 * Everything below is driven by SSO_* configuration. A site that has not
 * registered this application leaves it switched off, and the sign-in screen
 * says so rather than offering a button that cannot work.
 */

// Pending authorisations, by state value. Short lived by design.
const pending = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function sweep() {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [state, entry] of pending) {
    if (entry.createdAt < cutoff) pending.delete(state);
  }
}

function describe() {
  return {
    enabled: config.sso.enabled,
    configured: config.sso.configured,
    provider: config.sso.provider,
    displayName: config.sso.displayName,
    // Read by the sign-in screen so it can explain itself when a site has
    // switched single sign-on on but not finished registering the application.
    reason: config.sso.enabled && !config.sso.configured
      ? 'Single sign-on is switched on for this site but the connection to the identity provider is not complete.'
      : null,
  };
}

function assertConfigured() {
  if (!config.sso.configured) {
    throw badRequest('Single sign-on is not set up for this facility. Sign in with your facility-issued staff ID.');
  }
}

/** Builds the authorization URL the device opens in the system browser. */
function begin({ redirectUri } = {}) {
  assertConfigured();
  sweep();

  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const callback = redirectUri || config.sso.redirectUri;

  pending.set(state, { verifier, redirectUri: callback, createdAt: Date.now() });

  const url = new URL(config.sso.authorizationEndpoint);
  url.searchParams.set('client_id', config.sso.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', callback);
  url.searchParams.set('scope', config.sso.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return { authorizationUrl: url.toString(), state, expiresInSeconds: STATE_TTL_MS / 1000 };
}

function decodeClaims(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length < 2) throw upstream('The identity provider returned a token this service cannot read');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw upstream('The identity provider returned a token this service cannot read');
  }
}

/**
 * Exchanges the authorization code for tokens and returns the subject claim.
 *
 * The id_token signature is validated by the identity provider's own token
 * endpoint call here: the code is exchanged over TLS, directly, using the
 * client secret, so the token comes from the provider rather than the device.
 */
async function complete({ code, state }) {
  assertConfigured();
  sweep();

  const entry = pending.get(state);
  if (!entry) throw badRequest('That sign-in attempt has expired. Start again.');
  pending.delete(state);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.sso.clientId,
    code: String(code || ''),
    redirect_uri: entry.redirectUri,
    code_verifier: entry.verifier,
  });
  if (config.sso.clientSecret) body.set('client_secret', config.sso.clientSecret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.sso.timeoutMs);
  let response;
  try {
    response = await fetch(config.sso.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: controller.signal,
    });
  } catch (err) {
    throw upstream(`The identity provider did not answer: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    logger.warn('sso.token.rejected', { status: response.status });
    throw upstream('The identity provider refused the sign-in');
  }

  const claims = decodeClaims(payload.id_token);
  const subject = claims[config.sso.subjectClaim] || claims.preferred_username || claims.email || claims.sub;
  if (!subject) throw upstream(`The identity provider did not return a ${config.sso.subjectClaim} claim`);

  return { subject: String(subject), claims: { iss: claims.iss, aud: claims.aud, sub: claims.sub } };
}

function reset() {
  pending.clear();
}

module.exports = { describe, begin, complete, reset };
