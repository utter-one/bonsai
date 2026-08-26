import 'reflect-metadata';
import { generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs';
import { rm } from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { container } from 'tsyringe';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { CallLogger, type ProviderCallEntry, type ProviderCallLogRow } from '../../../src/services/monitoring/CallLogger';
import { MetricsRegistry } from '../../../src/services/monitoring/MetricsRegistry';
import { ProviderCallRecorder, resetMonitoringAccessorsForTests } from '../../../src/services/monitoring/ProviderCallRecorder';
import { ProviderConnectionTester } from '../../../src/services/providers/connectionTest/ProviderConnectionTester';
import { StorageProviderFactory } from '../../../src/services/providers/storage/StorageProviderFactory';
import { NotFoundError } from '../../../src/errors';
import type { Provider } from '../../../src/types/models';
import type { RequestContext } from '../../../src/services/RequestContext';

// --- breaker double (P3-01 test seam) ---

class TestBreakerRegistry {
  successes: string[] = [];
  failures: Array<{ providerId: string; errorCode: string | null | undefined }> = [];

  recordSuccess(providerId: string): void {
    this.successes.push(providerId);
  }

  recordFailure(providerId: string, errorCode: string | null | undefined): void {
    this.failures.push({ providerId, errorCode });
  }

  reset(): void {
    this.successes.length = 0;
    this.failures.length = 0;
  }
}

// --- quiet monitoring doubles (p1-03 pattern) ---

const sharedBreakers = new TestBreakerRegistry();

class QuietCallLogger extends CallLogger {
  rows: ProviderCallLogRow[] = [];

  constructor(breakers: TestBreakerRegistry) {
    super(breakers as never);
  }

  get pendingEntries(): ProviderCallEntry[] {
    return this.buffer;
  }

  clearPending(): void {
    this.buffer.length = 0;
  }

  protected async persistRows(rows: ProviderCallLogRow[]): Promise<void> {
    this.rows.push(...rows);
  }

  protected onFlushError(): void {
    /* captured nowhere — flush cannot fail in this double */
  }
}

class QuietMetrics extends MetricsRegistry {
  protected override async persistRows(_rows: unknown[]): Promise<void> {
    /* discard */
  }

  protected override onFlushError(): void {
    /* discard */
  }
}

const sharedCallLogger = new QuietCallLogger(sharedBreakers);
const sharedMetrics = new QuietMetrics();

// --- stub object store: one local HTTP server speaking the wire protocol of each SDK ---

/**
 * Real SDK clients, zero cloud calls: S3 (ListObjectsV2 XML, path-style),
 * Azure Blob (comp=list XML) and GCS (storage/v1 JSON) all hit this local
 * endpoint — the providers' own `endpoint`/`apiEndpoint` config fields.
 */
function createStubObjectStore() {
  const requests: string[] = [];

  const s3Xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>test-bucket</Name><Prefix></Prefix><KeyCount>1</KeyCount><MaxKeys>1</MaxKeys><IsTruncated>false</IsTruncated>
  <Contents><Key>a.txt</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>"abc"</ETag><Size>5</Size><StorageClass>STANDARD</StorageClass></Contents>
</ListBucketResult>`;
  // The SDK's response mapper requires the ServiceEndpoint + ContainerName
  // root attributes and a <Blobs> wrapper around the <Blob> items (it maps
  // to the `segment.blobItems` composite) — a response without them
  // deserializes to an undefined body and the list call fails.
  const azureXml = `<?xml version="1.0" encoding="UTF-8"?>
<EnumerationResults ServiceEndpoint="http://127.0.0.1:9/" ContainerName="test-container">
  <Prefix></Prefix><MaxResults>1</MaxResults><Marker></Marker><NextMarker></NextMarker>
  <Blobs>
    <Blob><Name>a.txt</Name><Properties><Last-Modified>Mon, 01 Jan 2026 00:00:00 GMT</Last-Modified><Etag>0x8D</Etag><Content-Length>5</Content-Length><Content-Type>text/plain</Content-Type></Properties></Blob>
  </Blobs>
</EnumerationResults>`;
  const gcsJson = JSON.stringify({
    kind: 'storage#objects',
    items: [{ name: 'a.txt', size: '5', contentType: 'text/plain', updated: '2026-01-01T00:00:00.000Z', etag: 'abc' }],
  });

  let resolveListening: (() => void) | undefined;
  const listening = new Promise<void>((resolve) => {
    resolveListening = resolve;
  });
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    requests.push(url);
    if (url.includes('list-type=2')) {
      res.writeHead(200, { 'content-type': 'application/xml', 'x-amz-request-id': 'stub-request' });
      res.end(s3Xml);
    } else if (url.includes('comp=list')) {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(azureXml);
    } else if (url.startsWith('/storage/v1/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(gcsJson);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  server.listen(0, '127.0.0.1', () => resolveListening?.());

  return {
    server,
    requests,
    start: (): Promise<void> => listening,
    stop: (): Promise<void> => new Promise((resolve) => server.close(() => resolve())),
  };
}

const storeStub = createStubObjectStore();

/** Cryptographically valid (fake) service-account key — the GCS client self-signs a JWT with it. */
const gcsKeyFileJson = (() => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return JSON.stringify({
    type: 'service_account',
    project_id: 'fake-project',
    private_key_id: 'stubkey1',
    private_key: privateKey,
    client_email: 'stub@fake-project.iam.gserviceaccount.com',
    client_id: '123456789',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
})();

function storeUrl(): string {
  return `http://127.0.0.1:${(storeStub.server.address() as AddressInfo).port}`;
}

function savedProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'prov_storage_1',
    name: 'Local storage',
    description: null,
    providerType: 'storage',
    apiType: 'local',
    config: { basePath: '' } as Provider['config'],
    fallbacks: [],
    createdBy: null,
    tags: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const context: RequestContext = {
  operatorId: 'op_unit',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'unit-test',
  requestId: 'req_unit',
  timestamp: new Date(),
};

/** Tester with the DB row load replaced by an in-memory map (unit: no network, no DB). */
class TestTester extends ProviderConnectionTester {
  providers = new Map<string, Provider>();

  protected override async loadProvider(id: string): Promise<Provider> {
    const row = this.providers.get(id);
    if (!row) throw new NotFoundError(`Provider with id ${id} not found`);
    return row;
  }
}

describe('ProviderConnectionTester storage strategy (TPC-05)', function () {
  this.timeout(20_000);

  before(async () => {
    await storeStub.start();
    // The REAL factory (no seam needed — the stub endpoint comes from the
    // provider config itself). The recorder instance matters too: the
    // container's ProviderCallRecorder singleton caches the first CallLogger
    // it is resolved with (p1-03 pitfall).
    container.registerInstance(StorageProviderFactory, new StorageProviderFactory({ resolveObject: async (obj: Record<string, unknown>) => obj } as never));
    container.registerInstance(CallLogger, sharedCallLogger);
    container.registerInstance(MetricsRegistry, sharedMetrics);
    const recorder = new ProviderCallRecorder(sharedCallLogger, sharedMetrics);
    container.registerInstance(ProviderCallRecorder, recorder);
    resetMonitoringAccessorsForTests();
    // The factory lazy-loads provider modules via `import()` — under tsx that
    // is a second module graph whose own container/caches are unreachable from
    // this file. The globalThis seam (ProviderCallRecorder.ts) routes that
    // graph's record() calls into our quiet logger, so row assertions are
    // genuine instead of trivially-true.
    (globalThis as { __TEST_PROVIDER_CALL_RECORDER__?: unknown }).__TEST_PROVIDER_CALL_RECORDER__ = recorder;
  });

  after(async () => {
    delete (globalThis as { __TEST_PROVIDER_CALL_RECORDER__?: unknown }).__TEST_PROVIDER_CALL_RECORDER__;
    await storeStub.stop();
  });

  beforeEach(() => {
    sharedCallLogger.clearPending();
    sharedCallLogger.rows.length = 0;
    sharedBreakers.reset();
    resetMonitoringAccessorsForTests();
  });

  describe('local (filesystem, temp dir)', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bonsai-storage-test-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('list → ok:true, phase first-data, protocol local-fs, detail.path, row recorded for saved, breaker NOT fed', async () => {
      const tester = new TestTester();
      tester.providers.set('prov_storage_1', savedProvider({ config: { basePath: dir } as Provider['config'] }));

      const result = await tester.testConnection({ providerId: 'prov_storage_1' }, context);

      expect(result.ok).to.equal(true);
      expect(result.providerType).to.equal('storage');
      expect(result.apiType).to.equal('local');
      expect(result.protocol).to.equal('local-fs');
      expect(result.phase).to.equal('first-data');
      expect(result.errorCode).to.equal(null);
      expect(result.detail).to.include({ objects: 0, path: dir });

      // Read-only: list/delete are not instrumented by the production base → no rows.
      await sharedCallLogger.flushNow();
      expect(sharedCallLogger.rows).to.have.length(0);
      expect(sharedBreakers.failures).to.have.length(0);
      expect(sharedBreakers.successes).to.have.length(0);
    });

    it('write round trip → ok:true, phase write, detail { wrote, verified }, key cleaned up, upload/download rows, breaker NOT fed', async () => {
      const tester = new TestTester();
      tester.providers.set('prov_storage_1', savedProvider({ config: { basePath: dir } as Provider['config'] }));

      const result = await tester.testConnection({ providerId: 'prov_storage_1', write: true }, context);

      expect(result.ok).to.equal(true);
      expect(result.phase).to.equal('write');
      expect(result.detail).to.include({ wrote: true, verified: true, path: dir });

      // The throwaway key (and its metadata sidecar) is ALWAYS deleted. The
      // empty key directory may remain — that is the provider's normal
      // behavior for any upload under a nested key.
      const keyDir = path.join(dir, 'bonsai-connection-test');
      const leftoverFiles = fs.existsSync(keyDir) ? fs.readdirSync(keyDir, { recursive: true }) : [];
      expect(leftoverFiles).to.have.length(0);

      // The round trip records its own storage.upload + storage.download rows
      // (breaker-excluded via the tester's monitoring context).
      await sharedCallLogger.flushNow();
      const operations = sharedCallLogger.rows.map((row) => row.operation).sort();
      expect(operations).to.deep.equal(['storage.download', 'storage.upload']);
      for (const row of sharedCallLogger.rows) {
        expect(row.providerId).to.equal('prov_storage_1');
        expect(row.ok).to.equal(true);
      }
      expect(sharedBreakers.failures).to.have.length(0);
      expect(sharedBreakers.successes).to.have.length(0);
    });

    it('missing directory → ok:false, errorCode client_error (misconfiguration, not a vendor failure)', async () => {
      const missing = path.join(dir, 'does-not-exist');
      const tester = new TestTester();
      tester.providers.set('prov_storage_1', savedProvider({ config: { basePath: missing } as Provider['config'] }));

      const result = await tester.testConnection({ providerId: 'prov_storage_1' }, context);

      expect(result.ok).to.equal(false);
      expect(result.errorCode).to.equal('client_error');
      expect(result.phase).to.equal('auth');
      expect(result.errorText).to.contain('missing or not readable/writable');

      // The pre-check runs before init — the missing directory was NOT auto-created.
      expect(fs.existsSync(missing)).to.equal(false);
    });

    it('unreadable sub-directory → ok:false (client_error), never an unhandled exception', async () => {
      if (process.getuid?.() === 0) {
        this.skip(); // root ignores permission bits — the EACCES cannot be produced
        return;
      }
      const sub = path.join(dir, 'locked');
      fs.mkdirSync(sub);
      fs.writeFileSync(path.join(sub, 'a.txt'), 'x');
      fs.chmodSync(sub, 0);
      try {
        const tester = new TestTester();
        tester.providers.set('prov_storage_1', savedProvider({ config: { basePath: dir } as Provider['config'] }));

        const result = await tester.testConnection({ providerId: 'prov_storage_1' }, context);

        expect(result.ok).to.equal(false);
        expect(result.errorCode).to.equal('client_error');
        expect(result.errorText).to.contain('Local storage listing failed');
      } finally {
        fs.chmodSync(sub, 0o755);
      }
    });
  });

  describe('cloud SDKs (real clients against local stub endpoints — no cloud calls)', () => {
    it('s3 → ok:true, protocol sdk, one object listed, draft → zero rows / zero breaker feed', async () => {
      const tester = new TestTester();
      storeStub.requests.length = 0;

      const result = await tester.testConnection(
        {
          providerType: 'storage',
          apiType: 's3',
          config: {
            accessKeyId: 'AKIASTUB',
            secretAccessKey: 'stub-secret',
            region: 'us-east-1',
            endpoint: storeUrl(),
          },
          bucket: 'test-bucket',
        },
        context,
      );

      expect(result.ok).to.equal(true);
      expect(result.apiType).to.equal('s3');
      expect(result.protocol).to.equal('sdk');
      expect(result.phase).to.equal('first-data');
      expect(result.detail).to.include({ objects: 1 });

      // The production SDK really sent ListObjectsV2 (path-style) to the stub.
      expect(storeStub.requests.some((url) => url.startsWith('/test-bucket') && url.includes('list-type=2'))).to.equal(true);

      // Draft: un-stamped instance records nothing.
      await sharedCallLogger.flushNow();
      expect(sharedCallLogger.rows).to.have.length(0);
      expect(sharedCallLogger.pendingEntries).to.have.length(0);
      expect(sharedBreakers.failures).to.have.length(0);
      expect(sharedBreakers.successes).to.have.length(0);
    });

    it('azure-blob → ok:true, protocol sdk, one blob listed, draft → zero rows / zero breaker feed', async () => {
      const tester = new TestTester();
      storeStub.requests.length = 0;

      const result = await tester.testConnection(
        {
          providerType: 'storage',
          apiType: 'azure-blob',
          config: {
            accountName: 'fake',
            accountKey: Buffer.from('stub-account-key-0123456789').toString('base64'),
            endpoint: storeUrl(),
          },
          bucket: 'test-container',
        },
        context,
      );

      expect(result.ok).to.equal(true);
      expect(result.apiType).to.equal('azure-blob');
      expect(result.protocol).to.equal('sdk');
      expect(result.phase).to.equal('first-data');
      expect(result.detail).to.include({ objects: 1 });

      // The production SDK really sent a flat container listing to the stub.
      expect(storeStub.requests.some((url) => url.startsWith('/test-container') && url.includes('comp=list'))).to.equal(true);

      await sharedCallLogger.flushNow();
      expect(sharedCallLogger.rows).to.have.length(0);
      expect(sharedBreakers.failures).to.have.length(0);
    });

    it('gcs → ok:true, protocol sdk, one object listed, draft → zero rows / zero breaker feed', async () => {
      const tester = new TestTester();
      storeStub.requests.length = 0;

      const result = await tester.testConnection(
        {
          providerType: 'storage',
          apiType: 'gcs',
          config: {
            projectId: 'fake-project',
            keyFileJson: gcsKeyFileJson,
            apiEndpoint: storeUrl(),
          },
          bucket: 'test-bucket',
        },
        context,
      );

      expect(result.ok).to.equal(true);
      expect(result.apiType).to.equal('gcs');
      expect(result.protocol).to.equal('sdk');
      expect(result.phase).to.equal('first-data');
      expect(result.detail).to.include({ objects: 1 });

      // The production SDK really sent the REST objects listing to the stub.
      expect(storeStub.requests.some((url) => url.startsWith('/storage/v1/b/test-bucket/o'))).to.equal(true);

      await sharedCallLogger.flushNow();
      expect(sharedCallLogger.rows).to.have.length(0);
      expect(sharedBreakers.failures).to.have.length(0);
    });
  });
});
