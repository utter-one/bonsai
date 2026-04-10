import _SpeexResampler from 'speex-resampler';

/**
 * Re-exports the SpeexResampler constructor, working around Node.js native ESM-CJS interop:
 * the native ESM loader exposes module.exports as the default import verbatim, so when the
 * CJS build uses __esModule the actual class ends up at .default rather than at the top level.
 */
export default ((_SpeexResampler as any).default ?? _SpeexResampler) as typeof _SpeexResampler;
