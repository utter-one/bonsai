import * as _opus from '@discordjs/opus';

/**
 * Re-exports the OpusEncoder constructor, working around Node.js native ESM-CJS interop:
 * the native ESM loader exposes module.exports as the default import verbatim, so when the
 * CJS build uses __esModule the actual class ends up at .default rather than at the top level.
 */
const _opusModule = (_opus as any).default ?? _opus;
export default _opusModule.OpusEncoder as typeof _opus.OpusEncoder;
