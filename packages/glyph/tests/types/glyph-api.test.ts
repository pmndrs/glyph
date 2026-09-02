import { glyph, type GlyphConfig, type GlyphHandle } from '../../src/index.js';
import {
  defaultDecoder,
  createGlyphRootRegistry,
  defineDecoder,
  defineGlyphConfig,
  defineGlyphSchema,
  resourceLease,
  type AnyGlyphBindings,
  type BorrowedBoundCommandBuffer,
  type BorrowedTypedCommandBuffer,
  type DecodeContext,
  type GlyphRoot,
} from '../../src/core.js';

interface RecordingRoot extends GlyphRoot {
  readonly kind: 'recording-root';
}

interface RecordingHandle extends GlyphHandle<RecordingRoot> {
  readonly kind: 'recording';
}

type RecordingBindings = AnyGlyphBindings;

const recordingConfig = defineGlyphConfig<RecordingHandle, RecordingBindings, void>({
  schema: defineGlyphSchema<RecordingBindings>()({
    drawRoot: () => undefined,
    program: () => ({}),
    buffer: () => ({}),
    material: () => ({}),
    transform: () => ({}),
    batch: () => ({}),
    instance: () => ({}),
    instanceSpan: () => ({}),
  }),
  encode: () => ({ descriptor: { capabilitySets: [], programs: [] } }),
  decode: defaultDecoder,
  resolve: ({ payload }) => resourceLease({ payload }, () => undefined),
  renderer: () => ({
    prepare: () => ({ result: undefined, commit: () => undefined, discard: () => undefined }),
    syncTransforms: () => undefined,
    dispose: () => undefined,
  }),
  createHandle: (context) => {
    const roots = createGlyphRootRegistry<RecordingRoot>((name, release) => {
      let disposed = false;
      return Object.freeze({
        name,
        kind: 'recording-root' as const,
        get disposed(): boolean {
          return disposed;
        },
        dispose(): void {
          if (disposed) return;
          disposed = true;
          release();
        },
      });
    });
    return context.create(
      Object.assign((name: string) => roots.get(name), { kind: 'recording' as const }),
      () => roots.dispose(),
    );
  },
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
  first('hud') satisfies RecordingRoot;
  // @ts-expect-error The handle itself fronts the anonymous root; invocation only selects named roots.
  first();
  second.dispose();

  // @ts-expect-error A config's exact handle result is preserved.
  const wrong: { readonly kind: 'other' } = first;
  void wrong;
}

void configureGlyph;
