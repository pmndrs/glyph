import {
  type RasterFormatMetadata,
  type RasterDataOf,
  type RasterOptionsOf,
  type RasterFormatDescriptorOf,
  type RasterFormatId,
  type RasterFormatRequest,
  type RasterOptionsArgument,
} from '../../src/index.js';
import {
  defineRasterFormat,
  defineRasterResourceId,
  type RasterFormatRequestMetadata,
} from '../../src/config/raster-format.js';
import * as RasterFormatApi from '../../src/config/raster-format.js';

// @ts-expect-error Integrators carry a concrete RasterFormat or the honest metadata base, never an Any alias.
type _RemovedAnyRasterFormat = RasterFormatApi.AnyRasterFormat;

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

interface TestData {
  readonly records: Uint16Array;
}

type _NoOptionsArgument = Expect<Equal<RasterOptionsArgument<never>, undefined>>;
type _OptionalOptionsArgument = Expect<
  Equal<RasterOptionsArgument<{ readonly quality?: number } | undefined>, { readonly quality?: number } | undefined>
>;
type _RequiredOptionsArgument = Expect<
  Equal<RasterOptionsArgument<{ readonly quality: number }>, { readonly quality: number }>
>;

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

const request: RasterFormatRequest<typeof technique> = technique({ quality: 'small' });
const requestMetadata: RasterFormatRequestMetadata = request;
void request;
void requestMetadata;
// @ts-expect-error The metadata view deliberately does not invent an options type.
void requestMetadata.options;
// @ts-expect-error Required technique options cannot be omitted.
const missingOptions: RasterFormatRequest<typeof technique> = { raster: technique };
void missingOptions;

const metadata: RasterFormatMetadata = technique;
void metadata;
type _MetadataDoesNotInventData = Expect<Equal<RasterDataOf<RasterFormatMetadata>, never>>;

function preserveRasterFormat<const Format extends RasterFormatMetadata>(format: Format): Format {
  return format;
}

const preserved = preserveRasterFormat(technique);
type _ConstraintPreservesData = Expect<Equal<RasterDataOf<typeof preserved>, TestData>>;

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
