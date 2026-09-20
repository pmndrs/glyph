import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assert, bench, group } from '@pmndrs/labs';

const packageRoot = process.env.GLYPH_LABS_PACKAGE_ROOT;
if (packageRoot === undefined) {
  throw new Error('GLYPH_LABS_PACKAGE_ROOT must identify an installed @pmndrs/glyph package');
}

const glyphPackage = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/index.js')).href
)) as typeof import('@pmndrs/glyph');
const threePackage = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/three.js')).href
)) as typeof import('@pmndrs/glyph/three');

const { bitmap, glyph } = glyphPackage;
const { defineThreeConfig } = threePackage;
const safeFontBytes = await readFile(new URL('../fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url));
const unsafeBoundaryFontBytes = await readFile(
  new URL('../fixtures/rendering/fredoka-issue-216-bitmap-16.font.glb', import.meta.url),
);

await glyph.init();
const safeFont = glyph.fontFace(new Blob([new Uint8Array(safeFontBytes)], { type: 'model/gltf-binary' }), {
  format: bitmap({ strikes: [16] }),
});
const unsafeBoundaryFont = glyph.fontFace(
  new Blob([new Uint8Array(unsafeBoundaryFontBytes)], { type: 'model/gltf-binary' }),
  { format: bitmap({ strikes: [16] }) },
);
await Promise.all([safeFont.load(), unsafeBoundaryFont.load()]);

const safeText =
  'Typography is a moving system. Familiar words wrap while a responsive panel changes the space around them.';
const unsafeBoundaryText =
  'Reveals one grapheme at a time over a duration. Layout stays put and a trigger fires at the end.';
const longUnsafeBoundaryText = Array.from({ length: 48 }, () => unsafeBoundaryText).join(' ');
const editedLongUnsafeBoundaryText = longUnsafeBoundaryText.replaceAll('Reveals', 'reveals');
const disableSpaceKerning = (text: string) =>
  Array.from(text.matchAll(/ /gu), (match) => ({
    end: match.index + 1,
    start: match.index,
    tag: 'kern',
    value: 0,
  }));
let nextHandle = 1;

function createParagraph(
  text: string,
  width: number,
  font: typeof safeFont,
  features: readonly {
    readonly end: number;
    readonly start: number;
    readonly tag: string;
    readonly value: number;
  }[] = [],
) {
  const root = glyph.handle(
    `labs:unsafe-line-breaks:${String(nextHandle++)}`,
    defineThreeConfig({ capacity: { size: 256, policy: 'grow' } }),
  );
  const textGroup = root.createTextGroup();
  const paragraph = root.createText({
    font,
    text,
    style: { features, fontSize: 24 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: width } },
  });
  textGroup.add(paragraph);
  textGroup.updateMatrixWorld(true);
  if (textGroup.error !== undefined) throw textGroup.error;
  return { paragraph, root, textGroup };
}

function disposeParagraph(created: ReturnType<typeof createParagraph>): void {
  created.textGroup.dispose();
  created.paragraph.dispose();
  created.root.dispose();
}

function benchmarkReflow(
  name: string,
  text: string,
  font: typeof safeFont,
  widths: readonly [number, number],
  features: readonly {
    readonly end: number;
    readonly start: number;
    readonly tag: string;
    readonly value: number;
  }[] = [],
): void {
  bench(name, function* () {
    const created = createParagraph(text, widths[0], font, features);
    let alternate = false;
    const measurementChecksum = yield () => {
      alternate = !alternate;
      created.paragraph.constraints = {
        width: { mode: 'exact', size: alternate ? widths[1] : widths[0] },
      };
      const measurement = created.paragraph.measure();
      return measurement.contentWidth + measurement.lineCount;
    };
    assert(measurementChecksum > 0, 'word-wrap measurement must contain laid-out lines');
    disposeParagraph(created);
  });
}

function benchmarkTextEdit(name: string, texts: readonly [string, string], font: typeof safeFont, width: number): void {
  bench(name, function* () {
    const created = createParagraph(texts[0], width, font);
    let alternate = false;
    const measurementChecksum = yield () => {
      alternate = !alternate;
      created.paragraph.text = alternate ? texts[1] : texts[0];
      const measurement = created.paragraph.measure();
      return measurement.contentWidth + measurement.lineCount;
    };
    assert(measurementChecksum > 0, 'edited word-wrap measurement must contain laid-out lines');
    disposeParagraph(created);
  });
}

group('unsafe legal line boundaries @core', () => {
  benchmarkReflow('common-safe word-wrap reflow @layout', safeText, safeFont, [419, 420]);
  benchmarkReflow(
    'issue 216 reporter workaround @layout',
    unsafeBoundaryText,
    unsafeBoundaryFont,
    [419, 420],
    disableSpaceKerning(unsafeBoundaryText),
  );
  benchmarkReflow(
    'issue 216 unsafe-boundary word-wrap reflow @layout',
    unsafeBoundaryText,
    unsafeBoundaryFont,
    [419, 420],
  );
  benchmarkReflow(
    'long reporter workaround paragraph reflow @layout',
    longUnsafeBoundaryText,
    unsafeBoundaryFont,
    [419, 420],
    disableSpaceKerning(longUnsafeBoundaryText),
  );
  benchmarkReflow(
    'long unsafe-boundary paragraph reflow @layout',
    longUnsafeBoundaryText,
    unsafeBoundaryFont,
    [419, 420],
  );
  benchmarkTextEdit(
    'long unsafe-boundary paragraph text edit @layout',
    [longUnsafeBoundaryText, editedLongUnsafeBoundaryText],
    unsafeBoundaryFont,
    420,
  );
});
