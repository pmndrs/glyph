import {
  defineGlyphConfig,
  glyph,
  resourceLease,
  type GlyphBindings,
  type GlyphConfigBindings,
  type GlyphConfigHandle,
  type GlyphHandle,
  type GlyphRoot,
  type GlyphSchema,
  type PortableResource,
} from '@pmndrs/glyph';

type IsAny<Value> = 0 extends 1 & Value ? true : false;

interface RecordingDrawRoot {
  readonly kind: 'recording-draw-root';
}

interface RecordingBoundary {
  readonly drawRoot: RecordingDrawRoot;
}

interface RecordingMaterialInput {
  readonly color: string;
}

interface RecordingTransformInput {
  readonly matrix: Float32Array;
}

interface RecordingResource {
  readonly kind: 'recording-resource';
  readonly payload: PortableResource;
}

interface RecordingBuffer {
  readonly kind: 'recording-buffer';
}

interface RecordingProgram {
  readonly kind: 'recording-program';
}

interface RecordingMaterial {
  readonly kind: 'recording-material';
}

interface RecordingTransform {
  readonly kind: 'recording-transform';
}

interface RecordingBatch {
  readonly kind: 'recording-batch';
}

interface RecordingInstance {
  readonly kind: 'recording-instance';
}

interface RecordingInstanceSpan {
  readonly kind: 'recording-instance-span';
}

type RecordingBindings = GlyphBindings<
  RecordingResource,
  RecordingBuffer,
  RecordingProgram,
  RecordingMaterial,
  RecordingTransform,
  RecordingBatch,
  RecordingInstance,
  RecordingInstanceSpan,
  RecordingDrawRoot,
  RecordingMaterialInput,
  RecordingTransformInput
>;

interface RecordingRoot extends GlyphRoot {
  readonly kind: 'recording-root';
  readonly result: Readonly<{ readonly kind: 'recording-result' }> | undefined;
}

const recordingSchema: GlyphSchema<RecordingBindings, RecordingBoundary> = {
  drawRoot: (boundary: RecordingBoundary) => boundary.drawRoot,
  program: () => Object.freeze({ kind: 'recording-program' as const }),
  buffer: () => Object.freeze({ kind: 'recording-buffer' as const }),
  material: (_boundary, material: RecordingMaterialInput) =>
    Object.freeze({ kind: 'recording-material' as const, material }),
  transform: (_boundary, transform: RecordingTransformInput, recordIndex) =>
    Object.freeze({ kind: 'recording-transform' as const, transform, recordIndex }),
  batch: () => Object.freeze({ kind: 'recording-batch' as const }),
  instance: () => Object.freeze({ kind: 'recording-instance' as const }),
  instanceSpan: () => Object.freeze({ kind: 'recording-instance-span' as const }),
};

const recordingConfig = defineGlyphConfig({
  schema: recordingSchema,
  encode: () => ({ descriptor: { capabilitySets: [], programs: [] }, codecLabel: 'recording' as const }),
  resolve: ({ payload, previous }) => {
    payload satisfies PortableResource;
    previous?.kind satisfies 'recording-resource' | undefined;
    return resourceLease(Object.freeze({ kind: 'recording-resource' as const, payload }), () => undefined);
  },
  renderer: () => ({
    decode: () => ({
      result: Object.freeze({ kind: 'recording-result' as const }),
      commit: (): void => undefined,
      discard: (): void => undefined,
    }),
    syncTransforms: (): void => undefined,
    dispose: (): void => undefined,
  }),
  root: {
    create: (context) => {
      context.codec.codecLabel satisfies 'recording';
      context.services.createText satisfies (typeof context.services)['createText'];
      let result: Readonly<{ readonly kind: 'recording-result' }> | undefined;
      const extension = {
        kind: 'recording-root' as const,
        get result() {
          return result;
        },
      };
      return context.create(extension, {
        boundary: Object.freeze({
          drawRoot: Object.freeze({ kind: 'recording-draw-root' as const }),
        }),
        shape: {
          accepted: (accepted) => {
            accepted.kind satisfies 'recording-result';
            result = accepted;
          },
        },
      });
    },
  },
});

type InferredRecordingBindings = GlyphConfigBindings<typeof recordingConfig>;
type RecordingHandle = GlyphConfigHandle<typeof recordingConfig>;
type RecordingRenderer = ReturnType<typeof recordingConfig.renderer>;
type RecordingView = Parameters<RecordingRenderer['decode']>[0];

const configIsNotAny: IsAny<typeof recordingConfig> = false;
const bindingsAreNotAny: IsAny<InferredRecordingBindings> = false;
const handleIsNotAny: IsAny<RecordingHandle> = false;
const viewIsNotAny: IsAny<RecordingView> = false;
void [configIsNotAny, bindingsAreNotAny, handleIsNotAny, viewIsNotAny];

declare const view: RecordingView;
view.displayList.kind satisfies 'unchanged' | 'replace';
view.updates.resources.at(0)?.resource.kind satisfies 'recording-resource' | undefined;
view.updates.buffers.at(0)?.buffer.kind satisfies 'recording-buffer' | undefined;
if (view.displayList.kind === 'replace') {
  view.displayList.value.drawRoot.kind satisfies 'recording-draw-root';
  view.displayList.value.transforms.at(0)?.value.kind satisfies 'recording-transform' | undefined;
  const child = view.displayList.value.children.at(0);
  if (child?.kind === 'batch') child.value.kind satisfies 'recording-batch';
  if (child?.kind === 'instance') child.value.kind satisfies 'recording-instance';
}

declare const bindings: InferredRecordingBindings;
bindings.materialInput.color satisfies string;
bindings.transformInput.matrix satisfies Float32Array;

async function configureGlyph(): Promise<void> {
  await glyph.init();
  await glyph.init();
  const first: RecordingHandle = glyph.handle('recording:first', recordingConfig);
  const second: RecordingHandle = glyph.handle('recording:second', recordingConfig);
  first.name satisfies undefined;
  first.disposed satisfies boolean;
  first.kind satisfies 'recording-root';
  first.result?.kind satisfies 'recording-result' | undefined;
  first.handle satisfies GlyphHandle<RecordingRoot>;
  const hud = first('hud');
  hud.kind satisfies 'recording-root';
  hud.name satisfies string;
  hud.handle satisfies RecordingHandle;
  // @ts-expect-error The handle fronts its anonymous root; invocation only selects named roots.
  first();
  second.dispose();

  // @ts-expect-error The config's exact root result is preserved.
  const wrong: { readonly kind: 'other' } = first;
  void wrong;
}

void configureGlyph;
