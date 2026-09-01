import { glyph, type GlyphHandle } from '../../src/index.js';
import {
  defaultDecoder,
  defineDecoder,
  defineGlyphConfig,
  resourceLease,
  type AnyGlyphBindings,
  type BorrowedBoundCommandBuffer,
  type BorrowedTypedCommandBuffer,
  type DecodeContext,
  type GlyphConfig,
} from '../../src/core.js';

interface RecordingHandle extends GlyphHandle {
  readonly kind: 'recording';
}

type RecordingBindings = AnyGlyphBindings;

const recordingConfig = defineGlyphConfig<RecordingHandle, RecordingBindings, void>({
  capabilities: Object.freeze([]),
  encode: () => ({ descriptor: { capabilitySets: [], programs: [] } }),
  decode: defaultDecoder,
  resolve: ({ payload }) => resourceLease({ payload }, () => undefined),
  renderer: () => ({
    prepare: () => ({ result: undefined, commit: () => undefined, discard: () => undefined }),
    syncTransforms: () => undefined,
    dispose: () => undefined,
  }),
  createHandle: (context) => context.create({ kind: 'recording' as const }, () => undefined),
});

recordingConfig satisfies GlyphConfig<RecordingHandle, RecordingBindings, void>;

const tracedDecoder = defineDecoder<RecordingBindings>(
  (source: BorrowedTypedCommandBuffer, context: DecodeContext<RecordingBindings>) => {
    const frame: BorrowedBoundCommandBuffer<RecordingBindings> = defaultDecoder(source, context);
    return frame;
  },
);

const tracedConfig = defineGlyphConfig({ ...recordingConfig, decode: tracedDecoder });

async function configureGlyph(): Promise<void> {
  await glyph.init();
  await glyph.init();
  const first: RecordingHandle = glyph.handle('recording:first', recordingConfig);
  const second: RecordingHandle = glyph.handle('recording:second', tracedConfig);
  first.name satisfies string;
  first.disposed satisfies boolean;
  second.dispose();

  // @ts-expect-error A config's exact handle result is preserved.
  const wrong: { readonly kind: 'other' } = first;
  void wrong;
}

void configureGlyph;
