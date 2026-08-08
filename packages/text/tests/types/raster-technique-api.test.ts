import {
  defineRasterResourceId,
  defineRasterTechnique,
  type AnyRasterTechnique,
  type GlyphBatchStorage,
  type GlyphBatchStorageOf,
  type RasterBindingOf,
  type RasterDataOf,
  type RasterGlyphWriteInput,
  type RasterOptionsOf,
  type RasterTechniqueDescriptorOf,
  type RasterTechniqueId,
} from '../../src/index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;

type Expect<Value extends true> = Value;
type IsAny<Value> = 0 extends 1 & Value ? true : false;

interface TestData {
  readonly records: Uint16Array;
}

interface TestBinding {
  readonly page: number;
}

interface TestStorage {
  readonly origins: Float32Array;
  readonly glyphs: Uint16Array;
}

const page = defineRasterResourceId('test/page/0');

const technique = defineRasterTechnique({
  id: 'test.msdf',
  kind: 'test-msdf',
  extension: 'TEST_font_mtsdf',
  version: 0,
  descriptor(options: { readonly quality: 'small' | 'large' }) {
    return { quality: options.quality } as const;
  },
  async decode(): Promise<TestData> {
    return { records: new Uint16Array() };
  },
  select() {
    return { resource: page, pipelineVariant: 0, binding: { page: 0 } as TestBinding };
  },
  createStorage(capacity): TestStorage {
    return {
      origins: new Float32Array(capacity * 2),
      glyphs: new Uint16Array(capacity),
    };
  },
  writeStorage() {},
  dispose() {},
});

type _TechniqueId = Expect<Equal<typeof technique.id, RasterTechniqueId & 'test.msdf'>>;
type _Options = Expect<Equal<RasterOptionsOf<typeof technique>, { readonly quality: 'small' | 'large' }>>;
type _Descriptor = Expect<
  Equal<RasterTechniqueDescriptorOf<typeof technique>, { readonly quality: 'small' | 'large' }>
>;
type _Data = Expect<Equal<RasterDataOf<typeof technique>, TestData>>;
type _Binding = Expect<Equal<RasterBindingOf<typeof technique>, TestBinding>>;
type _Storage = Expect<Equal<GlyphBatchStorageOf<typeof technique>, TestStorage>>;

declare const writeInput: RasterGlyphWriteInput<TestData, TestBinding>;
const writeOrigin: number = writeInput.glyphs[0]!.originX + writeInput.glyphs[0]!.originY;
const writePage: number = writeInput.binding.page;
void writeOrigin;
void writePage;

const erased: AnyRasterTechnique = technique;
void erased;
type _ErasedDataIsUnknown = Expect<Equal<RasterDataOf<AnyRasterTechnique>, unknown>>;
type _ErasedStorage = Expect<Equal<GlyphBatchStorageOf<AnyRasterTechnique>, GlyphBatchStorage>>;
type _ErasedDataIsNotAny = Expect<Equal<IsAny<RasterDataOf<AnyRasterTechnique>>, false>>;

defineRasterTechnique({
  id: 'test.invalid-storage',
  kind: 'test-invalid',
  extension: 'TEST_invalid',
  version: 0,
  descriptor() {
    return {};
  },
  async decode() {
    return {};
  },
  select() {
    return { resource: page, pipelineVariant: 0, binding: {} };
  },
  // @ts-expect-error Canonical storage fields must all be ArrayBufferView values.
  createStorage() {
    return { invalid: 1 };
  },
  writeStorage() {},
  dispose() {},
});
