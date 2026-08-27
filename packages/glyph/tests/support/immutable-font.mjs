import {
  createImmutableFontBacking,
  createImmutableFontLease,
  createImmutableFontVariant,
} from '../../dist/loaded-font.js';

const METRICS = Object.freeze({
  unitsPerEm: 1_000,
  ascender: 800,
  descender: -200,
  lineGap: 0,
  underlinePosition: -100,
  underlineThickness: 50,
  strikeoutPosition: 300,
  strikeoutSize: 50,
});

export function immutableTestFont(technique, data = {}, glyphCount = 2) {
  const registered = {
    glyphCount,
    metrics: METRICS,
    dispose() {},
  };
  const backing = createImmutableFontBacking(registered);
  const variant = createImmutableFontVariant({
    backing,
    technique,
    raster: { dispose() {} },
    data,
  });
  return createImmutableFontLease(variant);
}
