import cjkContract from '../../fixtures/contracts/paragraph-cjk-layout-v0.json';

export const paragraphCjkCoverageText = Object.values(cjkContract.cases)
  .map(({ text }) => text)
  .join('')
  // Variation selectors shape beside their base scalar but do not name standalone cmap glyphs.
  .replace(/[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu, '');
