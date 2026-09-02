import {
  defineGlyphConfig,
  defineGlyphSchema,
  glyph,
  resourceLease,
  type AnyGlyphBindings,
  type CommandBufferView,
  type GlyphConfig,
  type GlyphHandle,
  type GlyphRoot,
} from '../../src/index.js';

interface RecordingRoot extends GlyphRoot {
  readonly kind: 'recording-root';
}

type RecordingHandle = GlyphHandle<RecordingRoot>;

type RecordingBindings = AnyGlyphBindings;

const recordingConfig = defineGlyphConfig({
  schema: defineGlyphSchema({
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
  resolve: ({ payload }) => resourceLease({ payload }, () => undefined),
  renderer: () => ({
    decode: (view) => {
      const commandBufferView: CommandBufferView<RecordingBindings> = view;
      void commandBufferView;
      return { result: undefined, commit: () => undefined, discard: () => undefined };
    },
    syncTransforms: () => undefined,
    dispose: () => undefined,
  }),
  adapterLabel: 'recording' as const,
  root: {
    create: (context) => {
      context.config.schema satisfies (typeof context.config)['schema'];
      context.config.renderer satisfies (typeof context.config)['renderer'];
      context.config.adapterLabel satisfies 'recording';
      // @ts-expect-error The selected config surface is exact rather than an open AnyGlyphConfig bag.
      void context.config.notAConfigHook;
      return context.create(
        Object.freeze({
          kind: 'recording-root' as const,
        }),
        { boundary: undefined },
      );
    },
  },
});

recordingConfig satisfies GlyphConfig<RecordingRoot, RecordingBindings, void>;

async function configureGlyph(): Promise<void> {
  await glyph.init();
  await glyph.init();
  const first: RecordingHandle = glyph.handle('recording:first', recordingConfig);
  const second: RecordingHandle = glyph.handle('recording:second', recordingConfig);
  first.name satisfies string;
  first.disposed satisfies boolean;
  first.kind satisfies 'recording-root';
  first.handle satisfies RecordingHandle;
  const hud = first('hud');
  hud satisfies RecordingRoot;
  hud.handle satisfies GlyphHandle;
  // @ts-expect-error The handle itself fronts the anonymous root; invocation only selects named roots.
  first();
  second.dispose();

  // @ts-expect-error A config's exact handle result is preserved.
  const wrong: { readonly kind: 'other' } = first;
  void wrong;
}

void configureGlyph;
