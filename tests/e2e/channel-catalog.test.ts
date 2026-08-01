import { describe, it } from 'mocha';
import { expect } from 'chai';
import { authed } from '../utils';

describe('Channel Catalog API', () => {

  describe('list', () => {
    it('returns channel catalog', async () => {
      const res = await authed().get('/api/channel-catalog');
      expect(res.status).to.equal(200);
      expect(res.body.channels).to.be.an('array');
      expect(res.body.channels.length).to.be.greaterThanOrEqual(1);
    });

    it('channels have capabilities', async () => {
      const res = await authed().get('/api/channel-catalog');
      expect(res.status).to.equal(200);
      for (const ch of res.body.channels) {
        expect(ch).to.have.property('type');
        expect(ch).to.have.property('name');
        expect(ch).to.have.property('capabilities');
        expect(ch.capabilities).to.have.property('supportsVoiceInput');
        expect(ch.capabilities).to.have.property('supportsTextInput');
        expect(ch.capabilities).to.have.property('supportsVoiceOutput');
        expect(ch.capabilities).to.have.property('supportsTextOutput');
      }
    });
  });

  describe('single channel', () => {
    it('returns channel by type', async () => {
      const res = await authed().get('/api/channel-catalog');
      expect(res.status).to.equal(200);
      const firstType = res.body.channels[0].type;
      const single = await authed().get(`/api/channel-catalog/${firstType}`);
      expect(single.status).to.equal(200);
      expect(single.body.type).to.equal(firstType);
    });

    it('returns 404 for unknown type', async () => {
      const res = await authed().get('/api/channel-catalog/nonexistent');
      expect(res.status).to.equal(404);
    });
  });
});
