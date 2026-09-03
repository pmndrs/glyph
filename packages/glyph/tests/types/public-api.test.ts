import {
  createFontLibrary,
  defineFont,
  loadFont,
  type AnyRasterFormat,
  type FontInputOf,
  type Font,
  type FontBytesInput,
  type FontRasterFormatOf,
  type RasterBakeDescriptorOf,
  type RasterBakeRequest,
  type RasterCoverage,
  type RasterDataOf,
  type RasterDecodeArtifact,
  type RasterDecodeFont,
  type RasterKindOf,
  type RasterOptionsOf,
  type RasterResourceSource,
  type RasterSource,
  type Sha256Hex,
} from '../../src/index.js';
import { defineRasterBaker, rasterBake } from '../../src/bake.js';
import { defineRasterFormat } from '../../src/config/raster-format.js';

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

interface MsdfResource {
  readonly texture: unknown;
}

const msdf = defineRasterFormat({
  id: 'test.msdf',
  kind: 'msdf',
  extension: 'PMNDRS_font_distance_field',
  version: 0,
  textEffects: ['outline', 'shadow'],
  descriptor() {
    return { encoding: 'mtsdf' } as const;
  },
  async decode(): Promise<MsdfResource> {
    return { texture: {} };
  },
  dispose() {},
});

type _MsdfKind = Expect<Equal<RasterKindOf<typeof msdf>, 'msdf'>>;
type _MsdfResource = Expect<Equal<RasterDataOf<typeof msdf>, MsdfResource>>;

const configurable = defineRasterFormat({
  id: 'studio.configurable-raster',
  kind: 'studio.configurable-raster',
  extension: 'STUDIO_font_configurable',
  version: 0,
  textEffects: [],
  descriptor(options: { readonly quality: 'low' | 'high' }) {
    return { quality: options.quality };
  },
  async decode() {
    return { configured: true as const };
  },
  dispose() {},
});
type _ConfigurableOptions = Expect<Equal<RasterOptionsOf<typeof configurable>, { readonly quality: 'low' | 'high' }>>;

const acceptsExternal: AnyRasterFormat = configurable;
void acceptsExternal;

declare const decodeFont: RasterDecodeFont;
declare const slugArtifact: RasterDecodeArtifact<'slug'>;
void slugArtifact.extensionData;
const slugBytes: Uint8Array = slugArtifact.view(0);
void slugBytes;
// @ts-expect-error Technique decoders receive metadata, not mutable registry handles.
void decodeFont.handle;
// @ts-expect-error Technique decoders do not own registered raster disposal.
slugArtifact.dispose();

// @ts-expect-error An MSDF decoder cannot consume a Slug artifact.
msdf.decode(decodeFont, slugArtifact);

const titleFont = defineFont('/fonts/Inter-Regular.ttf', msdf);
type _TitleInput = Expect<Equal<FontInputOf<typeof titleFont>, '/fonts/Inter-Regular.ttf'>>;
type _TitleRaster = Expect<Equal<FontRasterFormatOf<typeof titleFont>, typeof msdf>>;
const loadedTitle: Promise<Font<typeof msdf>> = loadFont(titleFont);
void loadedTitle;

const library = createFontLibrary({ maximumEntries: 8 });
const cachedTitle: Promise<Font<typeof msdf>> = library.loadFont(titleFont);
void cachedTitle;
library.clear(titleFont);
library.dispose();

declare const fontBytes: Uint8Array<ArrayBuffer>;
const copiedBytes: FontBytesInput = { bytes: fontBytes };
const transferredBytes: FontBytesInput = { bytes: fontBytes, ownership: 'transfer' };
void copiedBytes;
void transferredBytes;
// @ts-expect-error Byte input is explicit; a bare typed array is not a font location.
loadFont({ baked: fontBytes }, msdf);

const configuredFont = defineFont('/fonts/Inter-Regular.ttf', {
  raster: configurable,
  options: { quality: 'high' },
});
void configuredFont;

// @ts-expect-error A configurable raster format requires its options.
defineFont('/fonts/Inter-Regular.ttf', configurable);
// @ts-expect-error A configured raster request cannot omit its options.
defineFont('/fonts/Inter-Regular.ttf', { raster: configurable });
// @ts-expect-error Raster package option literals remain package-owned.
defineFont('/fonts/Inter-Regular.ttf', { raster: configurable, options: { quality: 'ultra' } });

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

void defineFont({ baked: '/fonts/Inter.font.glb' }, msdf);
declare const sourceUrl: URL;
void defineFont(sourceUrl, msdf);
// @ts-expect-error A font input requires either source or baked bytes.
defineFont({}, msdf);
// @ts-expect-error An optional forbidden source cannot be supplied as undefined.
defineFont({ baked: '/fonts/Inter.font.glb', source: undefined }, msdf);

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
      report: { metadataBytes: 0, serializedBytes: 0, gpuBytes: 0, pages: [] },
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
      settings: { language: options.language, scripts: ['Latn', 'Hani'], fallback: null },
    } as const;
  },
  async bake(request) {
    return {
      rasterKey: request.rasterKey,
      kind: 'nested-json',
      extension: 'PMNDRS_font_nested_json',
      version: 0,
      artifacts: [],
      report: { metadataBytes: 0, serializedBytes: 0, gpuBytes: 0, pages: [] },
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
