'use strict';

const { upstream } = require('./errors');

/**
 * fetch() with a hard timeout and a typed failure. Node 18+ ships fetch and
 * AbortSignal.timeout natively, so there is no HTTP client dependency here.
 */
async function requestJson(url, { method = 'GET', headers = {}, body, timeoutMs = 10000, label = 'upstream' } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' || err.name === 'AbortError'
      ? `${label} did not respond within ${timeoutMs}ms`
      : `${label} is unreachable`;
    throw upstream(reason, { url, cause: err.message });
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 2000) };
    }
  }

  if (!response.ok) {
    throw upstream(`${label} returned ${response.status}`, { url, status: response.status, payload });
  }
  return payload;
}

module.exports = { requestJson };
