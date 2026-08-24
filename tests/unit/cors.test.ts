import { expect } from 'chai';
import { parseCorsOriginEnv, resolveCorsOrigin } from '../../src/http/middleware/cors';

describe('CORS origin resolution', () => {
  describe('parseCorsOriginEnv', () => {
    it('returns null when unset or blank (default mode)', () => {
      expect(parseCorsOriginEnv(undefined)).to.equal(null);
      expect(parseCorsOriginEnv('')).to.equal(null);
      expect(parseCorsOriginEnv('   ')).to.equal(null);
      expect(parseCorsOriginEnv(' , , ')).to.equal(null);
    });

    it('parses a comma-separated list, trimming whitespace', () => {
      expect(parseCorsOriginEnv('http://localhost:5173, https://console.example.com')).to.deep.equal([
        'http://localhost:5173',
        'https://console.example.com',
      ]);
    });
  });

  describe('resolveCorsOrigin', () => {
    it('allows non-browser requests (no Origin header) in both modes', () => {
      expect(resolveCorsOrigin(undefined, ['http://a.test'])).to.equal(true);
      expect(resolveCorsOrigin(undefined, null)).to.equal(true);
    });

    it('default mode echoes the request origin (credentials-compatible)', () => {
      expect(resolveCorsOrigin('http://localhost:5173', null)).to.equal('http://localhost:5173');
      expect(resolveCorsOrigin('http://127.0.0.1:4173', null)).to.equal('http://127.0.0.1:4173');
      expect(resolveCorsOrigin('https://console.example.com', null)).to.equal('https://console.example.com');
    });

    it('allowlist mode echoes exact matches and rejects everything else', () => {
      const list = ['http://localhost:5173'];
      expect(resolveCorsOrigin('http://localhost:5173', list)).to.equal('http://localhost:5173');
      expect(resolveCorsOrigin('http://localhost:9999', list)).to.equal(false);
      expect(resolveCorsOrigin('https://evil.example.com', list)).to.equal(false);
    });

    it('allowlist matching is exact — scheme and port matter', () => {
      const list = ['http://localhost:5173'];
      expect(resolveCorsOrigin('http://127.0.0.1:5173', list)).to.equal(false);
      expect(resolveCorsOrigin('https://localhost:5173', list)).to.equal(false);
      expect(resolveCorsOrigin('http://localhost:5173/', list)).to.equal(false);
    });
  });
});
