import { describe, it } from 'mocha';
import { expect } from 'chai';
import { unauthed } from '../utils';

describe('Version API', () => {
  it('returns version info without auth', async () => {
    const res = await unauthed().get('/version');
    expect(res.status).to.equal(200);
    expect(res.body.version).to.be.a('string');
    expect(res.body.restSchemaHash).to.be.a('string');
    expect(res.body.wsSchemaHash).to.be.a('string');
  });

  it('returns valid semver', async () => {
    const res = await unauthed().get('/version');
    expect(res.status).to.equal(200);
    // semver format: major.minor.patch
    expect(res.body.version).to.match(/^\d+\.\d+\.\d+/);
  });

  it('returns valid hashes', async () => {
    const res = await unauthed().get('/version');
    expect(res.status).to.equal(200);
    // hashes are 12 hex chars
    expect(res.body.restSchemaHash).to.match(/^[0-9a-f]{12}$/);
    expect(res.body.wsSchemaHash).to.match(/^[0-9a-f]{12}$/);
  });
});
