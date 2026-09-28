import 'reflect-metadata';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { unauthed } from '../utils';

// The test env leaves CORS_ORIGIN unset → default mode (every origin echoed back).
// Allowlist mode is covered by unit tests on the pure resolver (tests/unit/cors.test.ts),
// because the cors middleware reads the env var once at createApp() time.
describe('CORS (default mode — CORS_ORIGIN unset)', () => {
  it('preflight from a localhost origin is allowed with credentials', async () => {
    const res = await unauthed()
      .options('/api/profile')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Authorization');
    expect(res.status).to.equal(204);
    // Echoed origin (not '*') — this is what makes credentials:'include' work in browsers.
    expect(res.headers['access-control-allow-origin']).to.equal('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).to.equal('true');
    expect(res.headers['vary']).to.include('Origin');
    expect(res.headers['access-control-allow-methods']).to.include('GET');
    expect(res.headers['access-control-allow-headers']).to.include('Authorization');
  });

  it('preflight allows the X-Request-Id custom header (P1-04 correlation)', async () => {
    const res = await unauthed()
      .options('/api/profile')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'X-Request-Id');
    expect(res.status).to.equal(204);
    expect(res.headers['access-control-allow-headers']).to.include('X-Request-Id');
  });

  it('echoes arbitrary origins and exposes response headers to browser JS', async () => {
    // (POST /api/auth/login → 401 on bad credentials; GET /api/profile is 500 without auth —
    // pre-existing controller quirk, unrelated to CORS.)
    const res = await unauthed().post('/api/auth/login').send({ id: 'nobody@example.com', password: 'wrong' }).set('Origin', 'https://console.example.com');
    expect(res.status).to.equal(401); // auth required — we are testing the CORS surface
    expect(res.headers['access-control-allow-origin']).to.equal('https://console.example.com');
    expect(res.headers['access-control-allow-credentials']).to.equal('true');
    const exposed = String(res.headers['access-control-expose-headers'] ?? '');
    expect(exposed).to.include('X-Request-Id');
    expect(exposed).to.include('Retry-After');
    expect(exposed).to.include('RateLimit-Limit');
  });

  it('does not emit CORS headers for non-browser requests (no Origin header)', async () => {
    const res = await unauthed().post('/api/auth/login').send({ id: 'nobody@example.com', password: 'wrong' });
    expect(res.status).to.equal(401);
    expect(res.headers['access-control-allow-origin']).to.equal(undefined);
  });
});
