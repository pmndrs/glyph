import {
  defineRaster,
  defineRasterBatchStage,
  defineRasterBaker,
  defineFont,
  FontLoader,
  FontRegistry,
  rasterBake,
  type AnyRasterModule,
  type FontInputOf,
  type FontRasterModuleOf,
  type GlyphPaint,
  type RasterKey,
  type RasterBatchOf,
  type RasterCoverage,
  type RasterBakeDescriptorOf,
  type RasterBakeRequest,
  type RasterKindOf,
  type RasterObjectDrawBatch,
  type RasterOptionsOf,
  type RasterResourceOf,
  type RasterResourceSource,
  type RasterRuntime,
  type RasterSource,
  type RegisteredFont,
  type RegisteredRaster,
  type Sha256Hex,
} from '../../src/index.js';
import type { Object3D } from 'three/webgpu';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;

type Expect<Value extends true> = Value;

const resolverRasterSource: RasterSource = { type: 'external' };
void resolverRasterSource;
// @ts-expect-error URI-addressed raster artifacts require an authenticated hash.
const unauthenticatedRasterSource: RasterSource = { type: 'external', uri: 'bitmap.glb' };
void unauthenticatedRasterSource;
declare const pageHash: Sha256Hex;
const externalRasterResource: RasterResourceSource = {
  type: 'external',
  uri: 'page.ktx2',
  byteLength: 1024,
  artifactHash: pageHash,
};
void externalRasterResource;

const fontRegistry = new FontRegistry({ maxArtifactBytes: 64 * 1024 * 1024 });
const fontLoader = new FontLoader({
  registry: fontRegistry,
  baseUrl: 'https://assets.example/app/',
  development: false,
});
const registeredPromise: Promise<RegisteredFont> = fontLoader.load('/fonts/Inter.ttf');
void registeredPromise;

interface MsdfResource {
  readonly texture: unknown;
}

interface MsdfBatch {
  readonly instances: number;
  readonly object: Object3D;
  dispose(): void;
}

declare const rasterObject: Object3D;
const objectDrawBatch: RasterObjectDrawBatch<Object3D> = {
  object: rasterObject,
  setRenderOrderBase() {},
  dispose() {},
};
void objectDrawBatch;

const msdf = defineRaster({
  kind: 'msdf',
  extension: 'PMNDRS_font_distance_field',
  version: 0,
  descriptor() {
    return { encoding: 'mtsdf' };
  },
  async decode(_font, _raster): Promise<MsdfResource> {
    return { texture: {} };
  },
  async prepare() {},
  stageBatch(previous): import('../../src/index.js').RasterBatchStage<MsdfBatch> {
    const batch = previous ?? { instances: 0, object: rasterObject, dispose() {} };
    return defineRasterBatchStage(
      batch,
      () => undefined,
      () => {
        if (previous === undefined) batch.dispose();
      },
    );
  },
  dispose(_resource) {},
});

type _MsdfKind = Expect<Equal<RasterKindOf<typeof msdf>, 'msdf'>>;
type _MsdfResource = Expect<Equal<RasterResourceOf<typeof msdf>, MsdfResource>>;
type _MsdfBatch = Expect<Equal<RasterBatchOf<typeof msdf>, MsdfBatch>>;

const external = defineRaster({
  kind: 'studio.custom-raster',
  extension: 'STUDIO_font_custom',
  version: 0,
  descriptor() {
    return {};
  },
  async decode() {
    return { custom: true as const };
  },
  async prepare() {},
  stageBatch(previous) {
    const batch = previous ?? { draws: 1, dispose() {} };
    return defineRasterBatchStage(
      batch,
      () => undefined,
      () => {
        if (previous === undefined) batch.dispose();
      },
    );
  },
  dispose() {},
});

const configurable = defineRaster({
  kind: 'studio.configurable-raster',
  extension: 'STUDIO_font_configurable',
  version: 0,
  descriptor(options: { readonly quality: 'low' | 'high' }) {
    return { quality: options.quality };
  },
  async decode() {
    return { configured: true as const };
  },
  async prepare() {},
  stageBatch(previous) {
    const batch = previous ?? { draws: 1, object: rasterObject, dispose() {} };
    return defineRasterBatchStage(
      batch,
      () => undefined,
      () => {
        if (previous === undefined) batch.dispose();
      },
    );
  },
  dispose() {},
});
type _ConfigurableOptions = Expect<Equal<RasterOptionsOf<typeof configurable>, { readonly quality: 'low' | 'high' }>>;

const acceptsExternal: AnyRasterModule = external;
void acceptsExternal;

declare const font: RegisteredFont;
declare const runtime: RasterRuntime;
declare const slugArtifact: RegisteredRaster<'slug'>;
declare const glyphPaint: GlyphPaint;
void glyphPaint;
void slugArtifact.extensionData;
const slugBytes: Uint8Array = slugArtifact.view(0);
void slugBytes;

const loaded = runtime.load(font, { module: msdf });
type _LoadedKind = Expect<Equal<Awaited<typeof loaded>['artifact']['kind'], 'msdf'>>;
type _LoadedResource = Expect<Equal<Awaited<typeof loaded>['resource'], MsdfResource>>;

const loadedConfigured = runtime.load(font, {
  module: configurable,
  options: { quality: 'low' },
});
type _LoadedConfiguredKind = Expect<
  Equal<Awaited<typeof loadedConfigured>['artifact']['kind'], 'studio.configurable-raster'>
>;

// @ts-expect-error Runtime loading retains required raster options.
runtime.load(font, { module: configurable });

// @ts-expect-error An MSDF decoder cannot consume a Slug artifact.
msdf.decode(font, slugArtifact);

const titleFont = defineFont('/fonts/Inter-Regular.ttf', msdf);
type _TitleInput = Expect<Equal<FontInputOf<typeof titleFont>, '/fonts/Inter-Regular.ttf'>>;
type _TitleRaster = Expect<Equal<FontRasterModuleOf<typeof titleFont>, typeof msdf>>;

const configuredFont = defineFont('/fonts/Inter-Regular.ttf', {
  module: configurable,
  options: { quality: 'high' },
});
void configuredFont;

// @ts-expect-error A configurable raster module requires its options.
defineFont('/fonts/Inter-Regular.ttf', configurable);

// @ts-expect-error A configured raster request cannot omit its options.
defineFont('/fonts/Inter-Regular.ttf', { module: configurable });

// @ts-expect-error Raster package option literals remain package-owned.
defineFont('/fonts/Inter-Regular.ttf', { module: configurable, options: { quality: 'ultra' } });

const relocatedFont = defineFont(
  {
    source: '/fonts/Inter-Regular.ttf',
    baked: 'https://cdn.example.com/generated/Inter.font.glb',
  },
  msdf,
);
type _RelocatedInput = Expect<
  Equal<
    FontInputOf<typeof relocatedFont>,
    {
      readonly source: '/fonts/Inter-Regular.ttf';
      readonly baked: 'https://cdn.example.com/generated/Inter.font.glb';
    }
  >
>;

const bakedOnlyFont = defineFont({ baked: '/fonts/Inter.font.glb' }, msdf);
void bakedOnlyFont;

declare const sourceUrl: URL;
const urlFont = defineFont(sourceUrl, msdf);
void urlFont;

// @ts-expect-error A font input requires either source or baked bytes.
defineFont({}, msdf);

// @ts-expect-error An optional forbidden source cannot be supplied as undefined.
defineFont({ baked: '/fonts/Inter.font.glb', source: undefined }, msdf);

declare const rasterKey: RasterKey;
void font.loadRaster({ rasterKey, kind: 'msdf' });
void font.loadRaster(
  { rasterKey, kind: 'msdf' },
  {
    async resolveResource({ source }) {
      return source.uri === 'page.ktx2' ? new Uint8Array(source.byteLength) : undefined;
    },
  },
);
declare const registeredRaster: RegisteredRaster;
void registeredRaster.resource(externalRasterResource);

// @ts-expect-error A kind is not a stable raster selection when options can differ.
font.loadRaster({ kind: 'msdf' });

const msdfBaker = defineRasterBaker({
  kind: 'msdf',
  extension: 'PMNDRS_font_distance_field',
  version: 0,
  descriptor(options: { readonly pixelRange: number }) {
    return { pixelRange: options.pixelRange };
  },
  async bake(request) {
    return {
      rasterKey: request.rasterKey,
      kind: 'msdf',
      extension: 'PMNDRS_font_distance_field',
      version: 0,
      artifacts: [],
      report: {
        metadataBytes: 0,
        serializedBytes: 0,
        gpuBytes: 0,
        pages: [],
      },
    };
  },
});

type _BakerKind = Expect<Equal<typeof msdfBaker.kind, 'msdf'>>;
type _BakerDescriptor = Expect<Equal<RasterBakeDescriptorOf<typeof msdfBaker>, { pixelRange: number }>>;

const nestedDescriptorBaker = defineRasterBaker({
  kind: 'nested-json',
  extension: 'PMNDRS_font_nested_json',
  version: 0,
  descriptor(options: { readonly language: string }) {
    return {
      formatVersion: 0,
      settings: {
        language: options.language,
        scripts: ['Latn', 'Hani'],
        fallback: null,
      },
    } as const;
  },
  async bake(request) {
    type _RequestDescriptor = Expect<
      Equal<
        typeof request.descriptor,
        {
          readonly formatVersion: 0;
          readonly settings: {
            readonly language: string;
            readonly scripts: readonly ['Latn', 'Hani'];
            readonly fallback: null;
          };
        }
      >
    >;
    return {
      rasterKey: request.rasterKey,
      kind: 'nested-json',
      extension: 'PMNDRS_font_nested_json',
      version: 0,
      artifacts: [],
      report: {
        metadataBytes: 0,
        serializedBytes: 0,
        gpuBytes: 0,
        pages: [],
      },
    };
  },
});

type _NestedDescriptor = Expect<
  Equal<
    RasterBakeDescriptorOf<typeof nestedDescriptorBaker>,
    {
      readonly formatVersion: 0;
      readonly settings: {
        readonly language: string;
        readonly scripts: readonly ['Latn', 'Hani'];
        readonly fallback: null;
      };
    }
  >
>;

// @ts-expect-error Raster descriptors cannot contain undefined.
type _UndefinedDescriptor = RasterBakeRequest<{ readonly invalid: undefined }>;

// @ts-expect-error Raster descriptors cannot contain functions.
type _FunctionDescriptor = RasterBakeRequest<{ readonly invalid: () => void }>;

// @ts-expect-error Raster descriptors cannot contain bigint values.
type _BigIntDescriptor = RasterBakeRequest<{ readonly invalid: bigint }>;

// @ts-expect-error Raster descriptors cannot contain Date objects.
type _DateDescriptor = RasterBakeRequest<{ readonly invalid: Date }>;

// @ts-expect-error Raster descriptors cannot contain Map objects.
type _MapDescriptor = RasterBakeRequest<{ readonly invalid: Map<string, string> }>;

const msdfPlan = rasterBake(msdfBaker, {
  packaging: { artifact: 'external', pages: 'external' },
  options: { pixelRange: 4 },
});
type _PlanOptions = Expect<Equal<typeof msdfPlan.options, { readonly pixelRange: number }>>;

rasterBake(msdfBaker, {
  packaging: { artifact: 'external', pages: 'external' },
  // @ts-expect-error The package-owned MSDF baker requires its own options.
  options: { ppem: 16 },
});

const proseCoverage: RasterCoverage = {
  unicodeRanges: [{ start: 0x20, end: 0x7e }],
  text: 'Authored text',
  glyphIds: [0, 43],
};
void proseCoverage;

declare const dynamicStrike: number;
declare const dynamicStrikes: number[];

// @ts-expect-error Bitmap strikes must be statically known numeric literals.
bitmap({ strikes: [dynamicStrike] });

// @ts-expect-error Bitmap strikes must be a non-empty tuple.
bitmap({ strikes: [] });

// @ts-expect-error A broad array cannot describe bake-time bitmap payloads.
bitmap({ strikes: dynamicStrikes });
