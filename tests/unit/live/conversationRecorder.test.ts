import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { ConversationRecorder } from '../../../src/services/live/ConversationRecorder';

function makeStorageService(): any {
  const uploads: any[] = [];
  return {
    uploadArtifact: async (...args: any[]) => {
      uploads.push(args);
      return { id: 'artifact_mock' };
    },
    uploads,
  };
}

function makeRecorder(overrides: any = {}): ConversationRecorder {
  const storage = makeStorageService();
  return new ConversationRecorder(
    { enabled: true, recordInput: true, recordOutput: true, format: 'pcm_16000' },
    'pcm_16000',
    'pcm_16000',
    storage,
    { storageProviderId: 'prov_1' },
    'proj_1',
    'conv_1',
    overrides,
  );
}

describe('ConversationRecorder', () => {
  describe('recordInput/recordOutput defaults', () => {
    it('defaults recordInput to true', () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      expect((recorder as any).recordInput).to.be.true;
    });

    it('defaults recordOutput to true', () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      expect((recorder as any).recordOutput).to.be.true;
    });

    it('respects recordInput false', () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true, recordInput: false }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      expect((recorder as any).recordInput).to.be.false;
    });

    it('respects recordOutput false', () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true, recordOutput: false }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      expect((recorder as any).recordOutput).to.be.false;
    });
  });

  describe('pushInput/pushOutput', () => {
    it('pushes input chunks to buffer', () => {
      const recorder = makeRecorder();
      const chunk = Buffer.from('hello');
      recorder.pushInput(chunk);
      expect((recorder as any).inputChunks).to.have.length(1);
    });

    it('pushes output chunks to buffer', () => {
      const recorder = makeRecorder();
      const chunk = Buffer.from('hello');
      recorder.pushOutput(chunk);
      expect((recorder as any).outputChunks).to.have.length(1);
    });

    it('skips input when recordInput is false', () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true, recordInput: false }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      recorder.pushInput(Buffer.from('hello'));
      expect((recorder as any).inputChunks).to.have.length(0);
    });

    it('skips output when recordOutput is false', () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true, recordOutput: false }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      recorder.pushOutput(Buffer.from('hello'));
      expect((recorder as any).outputChunks).to.have.length(0);
    });
  });

  describe('flush', () => {
    it('does nothing when no chunks and no storage config', async () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true }, 'pcm_16000', 'pcm_16000', storage,
        null, 'proj_1', 'conv_1',
      );
      await recorder.flush();
      expect(storage.uploads).to.have.length(0);
    });

    it('does nothing when no storage config', async () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true }, 'pcm_16000', 'pcm_16000', storage,
        null, 'proj_1', 'conv_1',
      );
      recorder.pushInput(Buffer.from('hello'));
      await recorder.flush();
      expect(storage.uploads).to.have.length(0);
    });

    it('flushes input recording to storage', async () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true, recordInput: true, recordOutput: false }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      recorder.pushInput(Buffer.from('hello'));
      await recorder.flush();
      expect(storage.uploads).to.have.length(1);
    });

    it('flushes output recording to storage', async () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true, recordInput: false, recordOutput: true }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      recorder.pushOutput(Buffer.from('world'));
      await recorder.flush();
      expect(storage.uploads).to.have.length(1);
    });

    it('flushes both input and output', async () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      recorder.pushInput(Buffer.from('hello'));
      recorder.pushOutput(Buffer.from('world'));
      await recorder.flush();
      expect(storage.uploads).to.have.length(2);
    });

    it('clears chunks after flush', async () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      recorder.pushInput(Buffer.from('hello'));
      await recorder.flush();
      expect((recorder as any).inputChunks).to.have.length(0);
    });

    it('prevents concurrent flush', async () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      recorder.pushInput(Buffer.from('hello'));
      // Flush twice — second should be no-op due to isFlushing flag
      await recorder.flush();
      await recorder.flush();
      expect(storage.uploads).to.have.length(1);
    });
  });

  describe('buildRecordingMetadata', () => {
    it('includes format in metadata', () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true, format: 'pcm_16000' }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      const meta = (recorder as any).buildRecordingMetadata();
      expect(meta.format).to.equal('pcm_16000');
      expect(meta.sampleRate).to.equal('16000');
    });

    it('includes g711 sample rate for mulaw', () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true, format: 'mulaw' }, 'mulaw', 'mulaw', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      const meta = (recorder as any).buildRecordingMetadata();
      expect(meta.format).to.equal('mulaw');
      expect(meta.sampleRate).to.equal('8000');
    });
  });

  describe('destroy', () => {
    it('clears converters', () => {
      const storage = makeStorageService();
      const recorder = new ConversationRecorder(
        { enabled: true }, 'pcm_16000', 'pcm_16000', storage,
        { storageProviderId: 'prov_1' }, 'proj_1', 'conv_1',
      );
      recorder.destroy();
      expect((recorder as any).inputConverter).to.be.null;
      expect((recorder as any).outputConverter).to.be.null;
    });
  });
});
