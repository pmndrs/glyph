import { bakeFont, type FontBakeCore, type NodeBakeOptions, type NodeFontBakeReport } from '@pmndrs/glyph/bake';
import type { PreparedFontReport } from '../../dist/font-baker/index.js';

declare const core: FontBakeCore;
declare const source: Uint8Array;
declare const dynamicFallback: boolean;

const selection = { formatVersion: 0, fontFaceIndex: 1, unicodeRanges: [{ start: 0x41, end: 0x41 }] } as const;
const defaultPrepared = core.prepare({ source, selection });
const defaultFace: 0 = defaultPrepared.report.fontFaceIndex;
const defaultMethod: 'subset' = defaultPrepared.report.preparation;
const falsePrepared = core.prepare({ source, selection: { ...selection, allowWholeFaceFallback: false } });
const falseFace: 0 = falsePrepared.report.fontFaceIndex;

const optedIn = core.prepare({ source, selection: { ...selection, allowWholeFaceFallback: true } });
const dynamic = core.prepare({ source, selection: { ...selection, allowWholeFaceFallback: dynamicFallback } });
const optedInFace: number = optedIn.report.fontFaceIndex;
const dynamicFace: number = dynamic.report.fontFaceIndex;
// @ts-expect-error A whole-face fallback can retain the selected collection face.
const invalidOptedInFace: 0 = optedIn.report.fontFaceIndex;
// @ts-expect-error A dynamic option cannot promise face zero.
const invalidDynamicFace: 0 = dynamic.report.fontFaceIndex;

const defaultBake = bakeFont({ input: 'font.ttf', output: 'font.glb', font: { fontFaceIndex: 1 } });
const oldOptions: NodeBakeOptions = { input: 'font.ttf', output: 'font.glb', font: { fontFaceIndex: 1 } };
const annotatedDefaultBake = bakeFont(oldOptions);
const falseBake = bakeFont({
  input: 'font.ttf',
  output: 'font.glb',
  font: { fontFaceIndex: 1 },
  allowWholeFaceFallback: false,
});
const optedInBake = bakeFont({
  input: 'font.otf',
  output: 'font.glb',
  font: { fontFaceIndex: 1 },
  allowWholeFaceFallback: true,
});
const dynamicBake = bakeFont({
  input: 'font.otf',
  output: 'font.glb',
  font: { fontFaceIndex: 1 },
  allowWholeFaceFallback: dynamicFallback,
});
const dynamicOptions: NodeBakeOptions<readonly [], boolean> = {
  input: 'font.otf',
  output: 'font.glb',
  font: { fontFaceIndex: 1 },
  allowWholeFaceFallback: dynamicFallback,
};
const annotatedDynamicBake = bakeFont(dynamicOptions);

declare const oldAnnotatedReport: NodeFontBakeReport;
const oldAnnotatedFace: 0 | undefined = oldAnnotatedReport.preparation?.fontFaceIndex;
declare const oldAnnotatedPreparation: PreparedFontReport;
const oldPreparedFace: 0 = oldAnnotatedPreparation.fontFaceIndex;

async function readFace() {
  const defaultReport = await defaultBake;
  const annotatedDefaultReport = await annotatedDefaultBake;
  const falseReport = await falseBake;
  const optedInReport = await optedInBake;
  const dynamicReport = await dynamicBake;
  const annotatedDynamicReport = await annotatedDynamicBake;
  const defaultBakeFace: 0 | undefined = defaultReport.preparation?.fontFaceIndex;
  const annotatedDefaultFace: 0 | undefined = annotatedDefaultReport.preparation?.fontFaceIndex;
  const falseBakeFace: 0 | undefined = falseReport.preparation?.fontFaceIndex;
  const optedInBakeFace: number | undefined = optedInReport.preparation?.fontFaceIndex;
  const dynamicBakeFace: number | undefined = dynamicReport.preparation?.fontFaceIndex;
  const annotatedDynamicFace: number | undefined = annotatedDynamicReport.preparation?.fontFaceIndex;
  // @ts-expect-error Opted-in fallback can retain the selected collection face.
  const invalidOptedInBakeFace: 0 | undefined = optedInReport.preparation?.fontFaceIndex;
  return {
    defaultBakeFace,
    annotatedDefaultFace,
    falseBakeFace,
    optedInBakeFace,
    dynamicBakeFace,
    annotatedDynamicFace,
    invalidOptedInBakeFace,
  };
}

void defaultFace;
void defaultMethod;
void falseFace;
void optedInFace;
void dynamicFace;
void invalidOptedInFace;
void invalidDynamicFace;
void oldAnnotatedFace;
void oldPreparedFace;
void readFace;
