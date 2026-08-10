import {
  defineRasterResourceId,
  defineRasterTechnique,
  type AnyRasterTechnique,
  type RasterDataOf,
  type RasterOptionsOf,
  type RasterTechniqueDescriptorOf,
  type RasterTechniqueId,
  type RasterTechniqueRequest,
} from '../../src/index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;
type IsAny<Value> = 0 extends 1 & Value ? true : false;

interface TestData {
  readonly records: Uint16Array;
}

const page = defineRasterResourceId('test/page/0');
void page;

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
  dispose() {},
});

type _TechniqueId = Expect<Equal<typeof technique.id, RasterTechniqueId & 'test.msdf'>>;
type _Options = Expect<Equal<RasterOptionsOf<typeof technique>, { readonly quality: 'small' | 'large' }>>;
type _Descriptor = Expect<
  Equal<RasterTechniqueDescriptorOf<typeof technique>, { readonly quality: 'small' | 'large' }>
>;
type _Data = Expect<Equal<RasterDataOf<typeof technique>, TestData>>;

const request: RasterTechniqueRequest<typeof technique> = { technique, options: { quality: 'small' } };
void request;
// @ts-expect-error Required technique options cannot be omitted.
const missingOptions: RasterTechniqueRequest<typeof technique> = { technique };
void missingOptions;

const erased: AnyRasterTechnique = technique;
void erased;
type _ErasedDataIsUnknown = Expect<Equal<RasterDataOf<AnyRasterTechnique>, unknown>>;
type _ErasedDataIsNotAny = Expect<Equal<IsAny<RasterDataOf<AnyRasterTechnique>>, false>>;

defineRasterTechnique({
  id: 'test.invalid-descriptor',
  kind: 'test-invalid',
  extension: 'TEST_invalid',
  version: 0,
  // @ts-expect-error Technique descriptors must remain JSON values.
  descriptor() {
    return { invalid: () => undefined };
  },
  async decode() {
    return {};
  },
  dispose() {},
});
