'use strict';

const { withCacheHeaders } = require('../lib/asset-headers');

describe('withCacheHeaders', () => {
  test('adds Cache-Control: max-age=31536000, immutable to a successful response', () => {
    const original = new Response('fake bytes', { status: 200 });
    const result = withCacheHeaders(original);
    expect(result.headers.get('Cache-Control')).toBe('max-age=31536000, immutable');
    expect(result.status).toBe(200);
  });

  test('does not add Cache-Control to a 404 response (unknown token must not be cached)', () => {
    const notFound = new Response('Not found', { status: 404 });
    const result = withCacheHeaders(notFound);
    expect(result.headers.get('Cache-Control')).toBeNull();
    expect(result.status).toBe(404);
  });

  test('preserves the response body on a successful response', async () => {
    const original = new Response('hello world', { status: 200 });
    const result = withCacheHeaders(original);
    const text = await result.text();
    expect(text).toBe('hello world');
  });
});
