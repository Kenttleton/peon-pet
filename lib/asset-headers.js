'use strict';

/**
 * Adds an immutable long-lived Cache-Control header to a successful
 * peon-asset:// response. Safe because asset tokens are never reused
 * after a pack reload (main.js's reloadPack clears the token maps but
 * never resets the counter — see main.js:239-248) — a given
 * peon-asset://<token> URL's bytes never change during its lifetime, so
 * Chromium's per-profile HTTP cache can dedupe identical fetches across
 * renderer processes. Left untouched on non-200 responses so a transient
 * 404 (e.g. a race during reload) is never itself cached.
 *
 * @param {Response} response
 * @returns {Response}
 */
function withCacheHeaders(response) {
  if (response.status !== 200) return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'max-age=31536000, immutable');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

module.exports = { withCacheHeaders };
