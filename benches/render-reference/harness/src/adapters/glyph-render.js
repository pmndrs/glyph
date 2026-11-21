import { glyph, msdf, slug } from 'glyph-render';
import { ThreeConfig, defineTextMaterial } from 'glyph-render/three';
import { makeGlyphAdapter } from './glyph-factory.js';

export default makeGlyphAdapter({ glyph, msdf, slug, ThreeConfig, build: 'render', defineTextMaterial });
