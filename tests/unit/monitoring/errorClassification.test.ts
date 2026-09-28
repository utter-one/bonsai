import { describe, it } from 'mocha';
import { expect } from 'chai';
import { classifyThirdPartyError } from '../../../src/utils/errorClassification';

function httpError(status: number, message = 'error'): any {
  return Object.assign(new Error(message), { status });
}

describe('classifyThirdPartyError (P1-02)', () => {
  describe('HTTP status shapes (OpenAI/Anthropic style .status)', () => {
    it('401 → auth', () => {
      expect(classifyThirdPartyError(httpError(401, 'Incorrect API key provided'))).to.deep.equal({ code: 'auth', statusHttp: 401 });
    });

    it('403 → auth', () => {
      expect(classifyThirdPartyError(httpError(403, 'Forbidden'))).to.deep.equal({ code: 'auth', statusHttp: 403 });
    });

    it('429 → rate_limited', () => {
      expect(classifyThirdPartyError(httpError(429, 'Rate limit reached'))).to.deep.equal({ code: 'rate_limited', statusHttp: 429 });
    });

    it('500/502/503 → server_error', () => {
      for (const status of [500, 502, 503, 504]) {
        expect(classifyThirdPartyError(httpError(status)).code).to.equal('server_error');
      }
    });

    it('400/422 → client_error', () => {
      for (const status of [400, 422]) {
        expect(classifyThirdPartyError(httpError(status, 'bad request')).code).to.equal('client_error');
      }
    });

    it('404 with key semantics → auth', () => {
      expect(classifyThirdPartyError(httpError(404, 'The API key was not found in your account')).code).to.equal('auth');
      expect(classifyThirdPartyError(httpError(404, 'invalid x-api-key provided')).code).to.equal('auth');
    });

    it('404 without key semantics → client_error', () => {
      expect(classifyThirdPartyError(httpError(404, 'Model gpt-x does not exist')).code).to.equal('client_error');
    });
  });

  describe('Twilio shapes', () => {
    it('statusCode 401 + code 20003 → auth', () => {
      const err = Object.assign(new Error('Authentication error - API key is invalid'), { statusCode: 401, code: 20003 });
      expect(classifyThirdPartyError(err)).to.deep.equal({ code: 'auth', statusHttp: 401 });
    });

    it('numeric code 20404 without HTTP status → client_error', () => {
      const err = Object.assign(new Error('The requested resource was not found'), { code: 20404 });
      expect(classifyThirdPartyError(err).code).to.equal('client_error');
    });

    it('statusCode 429 → rate_limited', () => {
      const err = Object.assign(new Error('Too many requests'), { statusCode: 429, code: 21606 });
      expect(classifyThirdPartyError(err).code).to.equal('rate_limited');
    });
  });

  describe('Meta/FB Graph JSON shapes', () => {
    it('OAuthException → auth', () => {
      const err = { error: { type: 'OAuthException', code: 190, message: 'Invalid OAuth access token.' } };
      expect(classifyThirdPartyError(err).code).to.equal('auth');
    });

    it('auth code 200 → auth', () => {
      const err = { error: { code: 200, message: 'Invalid Authorization' } };
      expect(classifyThirdPartyError(err).code).to.equal('auth');
    });

    it('rate limit code 4 → rate_limited', () => {
      const err = { error: { code: 4, message: 'Some kind of user rate limit reached' } };
      expect(classifyThirdPartyError(err).code).to.equal('rate_limited');
    });
  });

  describe('AWS SDK v3 shapes', () => {
    it('UnrecognizedClientException → auth', () => {
      const err = { name: 'UnrecognizedClientException', $metadata: { httpStatusCode: 403 }, message: 'The security token included in the request is invalid.' };
      expect(classifyThirdPartyError(err)).to.deep.equal({ code: 'auth', statusHttp: 403 });
    });

    it('ThrottlingException → rate_limited', () => {
      const err = { name: 'ThrottlingException', $metadata: { httpStatusCode: 429 }, message: 'Rate exceeded' };
      expect(classifyThirdPartyError(err).code).to.equal('rate_limited');
    });

    it('ServiceUnavailableException → server_error', () => {
      const err = { name: 'ServiceUnavailableException', $metadata: { httpStatusCode: 503 }, message: 'Service unavailable' };
      expect(classifyThirdPartyError(err).code).to.equal('server_error');
    });
  });

  describe('Node/undici network shapes', () => {
    it('ECONNREFUSED → network', () => {
      const err = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' });
      expect(classifyThirdPartyError(err).code).to.equal('network');
    });

    it('ETIMEDOUT → network (per spec: node network codes)', () => {
      const err = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
      expect(classifyThirdPartyError(err).code).to.equal('network');
    });

    it('ECONNRESET/ENOTFOUND/EAI_AGAIN → network', () => {
      for (const code of ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN']) {
        const err = Object.assign(new Error(code), { code });
        expect(classifyThirdPartyError(err).code).to.equal('network');
      }
    });

    it('fetch failed with cause chain → classified from cause', () => {
      const cause = Object.assign(new Error('connect ETIMEDOUT 1.2.3.4:443'), { code: 'ETIMEDOUT' });
      const err = new TypeError('fetch failed');
      (err as any).cause = cause;
      expect(classifyThirdPartyError(err).code).to.equal('network');
    });

    it('undici connect timeout in cause → timeout', () => {
      const err = new TypeError('fetch failed');
      (err as any).cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
      expect(classifyThirdPartyError(err).code).to.equal('timeout');
    });

    it('other undici codes in cause → network', () => {
      const err = new TypeError('fetch failed');
      (err as any).cause = { code: 'UND_ERR_SOCKET' };
      expect(classifyThirdPartyError(err).code).to.equal('network');
    });

    it('DOMException TimeoutError (AbortSignal.timeout) → timeout', () => {
      const err = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      expect(classifyThirdPartyError(err).code).to.equal('timeout');
    });
  });

  describe('message-based fallback', () => {
    it('rate limit wording → rate_limited', () => {
      expect(classifyThirdPartyError(new Error('Rate limit reached for requests')).code).to.equal('rate_limited');
      expect(classifyThirdPartyError(new Error('quota exceeded')).code).to.equal('rate_limited');
    });

    it('timeout wording → timeout', () => {
      expect(classifyThirdPartyError(new Error('Request timed out after 30s')).code).to.equal('timeout');
    });

    it('auth wording → auth', () => {
      expect(classifyThirdPartyError(new Error('invalid api key')).code).to.equal('auth');
      expect(classifyThirdPartyError(new Error('permission denied')).code).to.equal('auth');
    });

    it('5xx wording → server_error', () => {
      expect(classifyThirdPartyError(new Error('upstream returned 502')).code).to.equal('server_error');
    });
  });

  describe('garbage input never throws', () => {
    it('null/undefined/primitives → unknown', () => {
      expect(classifyThirdPartyError(null).code).to.equal('unknown');
      expect(classifyThirdPartyError(undefined).code).to.equal('unknown');
      expect(classifyThirdPartyError(42).code).to.equal('unknown');
      expect(classifyThirdPartyError('something broke').code).to.equal('unknown');
    });

    it('unclassifiable object → unknown', () => {
      expect(classifyThirdPartyError({ foo: 'bar' }).code).to.equal('unknown');
    });
  });
});
