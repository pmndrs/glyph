import {
  type AnyRasterFormat,
  type RasterDataOf,
  type RasterOptionsOf,
  type RasterFormatDescriptorOf,
  type RasterFormatId,
  type RasterFormatRequest,
} from '../../src/index.js';
import { defineRasterFormat, defineRasterResourceId } from '../../src/config/raster-format.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;
type IsAny<Value> = 0 extends 1 & Value ? true : false;

interface TestData {
  readonly records: Uint16Array;
}

const page = defineRasterResourceId('test/page/0');
void page;

const technique = defineRasterFormat({
  id: 'test.msdf',
  kind: 'test-msdf',
  extension: 'TEST_font_mtsdf',
  version: 0,
  textEffects: [],
  descriptor(options: { readonly quality: 'small' | 'large' }) {
    return { quality: options.quality } as const;
  },
  async decode(): Promise<TestData> {
    return { records: new Uint16Array() };
  },
  dispose() {},
});

type _TechniqueId = Expect<Equal<typeof technique.id, RasterFormatId & 'test.msdf'>>;
type _Options = Expect<Equal<RasterOptionsOf<typeof technique>, { readonly quality: 'small' | 'large' }>>;
type _Descriptor = Expect<Equal<RasterFormatDescriptorOf<typeof technique>, { readonly quality: 'small' | 'large' }>>;
type _Data = Expect<Equal<RasterDataOf<typeof technique>, TestData>>;

const request: RasterFormatRequest<typeof technique> = { raster: technique, options: { quality: 'small' } };
void request;
// @ts-expect-error Required technique options cannot be omitted.
const missingOptions: RasterFormatRequest<typeof technique> = { raster: technique };
void missingOptions;

const erased: AnyRasterFormat = technique;
void erased;
type _ErasedDataIsUnknown = Expect<Equal<RasterDataOf<AnyRasterFormat>, unknown>>;
type _ErasedDataIsNotAny = Expect<Equal<IsAny<RasterDataOf<AnyRasterFormat>>, false>>;

// @ts-expect-error Every technique must state its supported text effects.
defineRasterFormat({
  id: 'test.missing-effects',
  kind: 'test-missing-effects',
  extension: 'TEST_missing_effects',
  version: 0,
  descriptor: () => ({}),
  async decode() {
    return {};
  },
  dispose() {},
});

defineRasterFormat({
  id: 'test.invalid-descriptor',
  kind: 'test-invalid',
  extension: 'TEST_invalid',
  version: 0,
  textEffects: [],
  // @ts-expect-error Technique descriptors must remain JSON values.
  descriptor() {
    return { invalid: () => undefined };
  },
  async decode() {
    return {};
  },
  dispose() {},
});
