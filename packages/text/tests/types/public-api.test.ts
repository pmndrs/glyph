import {
  defineRaster,
  defineRasterBaker,
  defineFont,
  createParagraphEngine,
  createRuntimeShaper,
  Text,
  FontLoader,
  FontRegistry,
  rasterBake,
  type AnyRasterModule,
  type BidiAnalysisViews,
  type FontInputOf,
  type FontRasterModuleOf,
  type LoadedFont,
  type GlyphPaint,
  type RasterKey,
  type RasterBatchOf,
  type RasterBakeDescriptorOf,
  type RasterBakeRequest,
  type RasterKindOf,
  type RasterOptionsOf,
  type RasterResourceOf,
  type RasterResourceSource,
  type RasterRuntime,
  type RasterSource,
  type RegisteredFont,
  type RegisteredRaster,
  type RuntimeShaper,
  type Sha256Hex,
  type ShapeBatchRequest,
  type ShapedBatchViews,
  type Paragraph,
  type ParagraphConstraints,
  type ParagraphMeasurement,
  type TextProperties,
  type TextUpdateProperties,
} from '../../src/index.js';
import type { ReactElement } from 'react';
import type { Object3D } from 'three/webgpu';
import type { LazyRaster, ReactTextProps, UseFont } from '../../src/react.js';
import { bitmap } from '../../src/raster/bitmap.js';

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
const shaperPromise: Promise<RuntimeShaper> = createRuntimeShaper({ registry: fontRegistry });
declare const fontHandle: RegisteredFont['handle'];
const shapeRequest: ShapeBatchRequest = {
  textUtf16: Uint16Array.of(0x41),
  features: [],
  runs: [
    {
      font: fontHandle,
      textStart: 0,
      textEnd: 1,
      direction: 'ltr',
      script: 'Latn',
      language: 'en',
      clusterLevel: 0,
      flags: 0x40,
      featureStart: 0,
      featureCount: 0,
    },
  ],
};
const shapedPromise: Promise<ShapedBatchViews> = shaperPromise.then((shaper) => shaper.shapeBatch(shapeRequest));
const bidiPromise: Promise<BidiAnalysisViews> = shaperPromise.then((shaper) =>
  shaper.analyzeBidi(Uint16Array.of(0x05d0), 'auto'),
);
const preparedParagraph: Promise<Paragraph> = shaperPromise.then((shaper) =>
  createParagraphEngine({ shaper }).create({ text: 'Hello', font: fontHandle }),
);
void registeredPromise;
void shaperPromise;
void shapedPromise;
void bidiPromise;
void preparedParagraph;

interface MsdfResource {
  readonly texture: unknown;
}

interface MsdfBatch {
  readonly instances: number;
  readonly object: Object3D;
  dispose(): void;
}

declare const rasterObject: Object3D;

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
  buildBatches(_layout, _resource): MsdfBatch {
    return { instances: 0, object: rasterObject, dispose() {} };
  },
  updatePaint(_batch, _paint, _fontSlot) {},
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
  buildBatches() {
    return { draws: 1, object: rasterObject, dispose() {} };
  },
  updatePaint() {},
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
  buildBatches() {
    return { draws: 1, object: rasterObject, dispose() {} };
  },
  updatePaint() {},
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

const validText: TextProperties = {
  text: 'Hello',
  font,
  raster: msdf,
};
void validText;
const coreText = new Text(validText);
const coreReady: Promise<void> = coreText.ready;
void coreReady;
void coreText.layout;
coreText.setProperties({ opacity: 0.75 });
coreText.dispose();

declare const paragraph: Paragraph;

const naturalMeasurement: ParagraphMeasurement = paragraph.measure();
const constrainedMeasurement = paragraph.measure({
  width: { mode: 'at-most', size: 320 },
});
const intrinsicParagraph = paragraph.layout();
const constrainedParagraph = paragraph.layout({
  width: { mode: 'at-most', size: 320 },
  height: { mode: 'unconstrained' },
  wrap: 'word',
});
const committedParagraph = paragraph.layout({
  width: { mode: 'exactly', size: 280 },
});
const hostLayoutConstraints: ParagraphConstraints = {
  width: { mode: 'at-most', size: 320 },
};
void intrinsicParagraph;
void naturalMeasurement;
void constrainedMeasurement;
void constrainedParagraph;
void committedParagraph;
void hostLayoutConstraints;

// @ts-expect-error Measurement deliberately omits positioned glyph arrays.
void naturalMeasurement.glyphIds;

// @ts-expect-error At-most constraints require an available size.
paragraph.layout({ width: { mode: 'at-most' } });

// @ts-expect-error Measurement and layout use the same constraint contract.
paragraph.measure({ height: { mode: 'exactly' } });

// @ts-expect-error Unconstrained axes do not carry a meaningless size.
paragraph.layout({ width: { mode: 'unconstrained', size: 320 } });

const titleFont = defineFont('/fonts/Inter-Regular.ttf', msdf);
type _TitleInput = Expect<Equal<FontInputOf<typeof titleFont>, '/fonts/Inter-Regular.ttf'>>;
type _TitleRaster = Expect<Equal<FontRasterModuleOf<typeof titleFont>, typeof msdf>>;
const tokenText: TextProperties = { text: 'Hello', font: titleFont };
void tokenText;

declare const useFont: UseFont;
const preloadedTitleFont = useFont.preload(titleFont);
type _PreloadedTitleFont = Expect<
  Equal<Awaited<typeof preloadedTitleFont>, LoadedFont<typeof msdf, '/fonts/Inter-Regular.ttf'>>
>;

function TitleFontTypeProbe(): null {
  const loadedTitleFont = useFont(titleFont);
  type _LoadedTitleFont = Expect<Equal<typeof loadedTitleFont, LoadedFont<typeof msdf, '/fonts/Inter-Regular.ttf'>>>;
  void (0 as unknown as _LoadedTitleFont);
  return null;
}
void TitleFontTypeProbe;

declare const nestedText: ReactElement<ReactTextProps>;
const reactTokenProps: ReactTextProps = {
  font: titleFont,
  fontSize: 0.24,
  position: [0, 1, 0],
  children: ['Fast ', nestedText],
};
const reactRawProps: ReactTextProps = {
  font: '/fonts/Inter-Regular.ttf',
  raster: msdf,
  children: 'One-off label',
};
void reactTokenProps;
void reactRawProps;

// @ts-expect-error React children own source text; the core text prop is not duplicated.
const duplicateReactText: ReactTextProps = { text: 'Hidden duplicate' };
void duplicateReactText;

// @ts-expect-error React raw-font props retain the core font/raster composition rule.
const reactRawWithoutRaster: ReactTextProps = { font: '/fonts/Inter-Regular.ttf' };
void reactRawWithoutRaster;

declare const lazyRaster: LazyRaster;
const deferredMsdf = lazyRaster(async () => ({ default: msdf }));
type _DeferredMsdf = Expect<Equal<typeof deferredMsdf, typeof msdf>>;

const textOnlyUpdate: TextUpdateProperties = { text: 'Updated' };
const paintOnlyUpdate: TextUpdateProperties = { opacity: 0.5 };
void textOnlyUpdate;
void paintOnlyUpdate;

// @ts-expect-error Span offsets cannot be replaced without their source text.
const spansOnlyUpdate: TextUpdateProperties = { spans: [] };
void spansOnlyUpdate;

// @ts-expect-error A raw font and raster must be replaced atomically.
const rasterOnlyUpdate: TextUpdateProperties = { raster: msdf };
void rasterOnlyUpdate;

const configuredFont = defineFont('/fonts/Inter-Regular.ttf', {
  module: configurable,
  options: { quality: 'high' },
});
const configuredText: TextProperties = { text: 'Configured', font: configuredFont };
void configuredText;

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

// @ts-expect-error A composed font already owns its raster definition.
const duplicateRaster: TextProperties = { text: 'Hello', font: titleFont, raster: msdf };
void duplicateRaster;

// @ts-expect-error A raw font input requires an explicit raster definition.
const missingModule: TextProperties = { text: 'Hello', font: '/fonts/Inter-Regular.ttf' };
void missingModule;

// @ts-expect-error Structured spans require their source text.
const missingText: TextProperties = { spans: [] };
void missingText;

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

const proseFont = defineFont('/fonts/Inter-Regular.ttf', bitmap({ strikes: [16, 32] }));
void proseFont;

const proseStrikes = [16, 32] as const;
const proseFontFromConst = defineFont('/fonts/Inter-Regular.ttf', bitmap({ strikes: proseStrikes }));
void proseFontFromConst;

declare const dynamicStrike: number;
declare const dynamicStrikes: number[];

// @ts-expect-error Bitmap strikes must be statically known numeric literals.
bitmap({ strikes: [dynamicStrike] });

// @ts-expect-error Bitmap strikes must be a non-empty tuple.
bitmap({ strikes: [] });

// @ts-expect-error A broad array cannot describe bake-time bitmap payloads.
bitmap({ strikes: dynamicStrikes });
