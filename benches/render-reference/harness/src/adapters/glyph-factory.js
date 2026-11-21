// @pmndrs/glyph on its documented path: a CLI-baked MSDF .font.glb, glyph.init(), one Three
// handle, createText(), and glyph.shape() before every render (README quick start).
import {
  ARABIC_FONT_SIZE,
  ARABIC_TEXT,
  ARABIC_WIDTH,
  KERN_FONT_SIZE,
  KERN_TEXT,
  KERN_WIDTH,
  LABELS,
  LABEL_FONT_SIZE,
  LABEL_LINE_HEIGHT,
  PARAGRAPH,
  PARAGRAPH_FONT_SIZE,
  PARAGRAPH_LINE_HEIGHT,
  PARAGRAPH_WIDTH,
} from '../content.js';

const exact = (size) => ({ width: { mode: 'exact', size } });

export function makeGlyphAdapter({ glyph, msdf, slug, ThreeConfig, build, defineTextMaterial }) {
  let three;
  let font;
  let text;
  const texts = [];
  return {
    async prepare(context) {
      await glyph.init();
      three = glyph.handle('main', ThreeConfig);
      // ?tech=slug draws the same scenes with the Slug technique (ASCII bake).
      const useSlug = context.query.get('tech') === 'slug';
      const name = useSlug
        ? 'noto-slug'
        : context.sceneName === 'arabic'
          ? 'amiri-arabic'
          : `noto-${context.query.get('font') ?? 'ascii'}`;
      font = await glyph.fontFace(`/fonts/${name}.${build}.font.glb`, { format: useSlug ? slug : msdf }).load();
    },
    author(context) {
      const { sceneName, scene } = context;
      const shadowShare = Number(context.query.get('shadow') ?? 0);
      if (sceneName === 'labels') {
        for (const label of LABELS) {
          const item = three.createText({
            font,
            text: label.text,
            style: {
              fontSize: LABEL_FONT_SIZE,
              lineHeight: LABEL_LINE_HEIGHT / LABEL_FONT_SIZE,
              color: '#ffffff',
              // ?shadow=N gives N percent of the labels a hard shadow (effect-variant comparison).
              ...(shadowShare >= 100 || (shadowShare > 0 && texts.length % Math.round(100 / shadowShare) === 0)
                ? { shadow: { color: '#3060ff', offset: [0.6, 0.6] } }
                : {}),
            },
            layout: { wrap: 'none' },
          });
          item.position.set(label.x, 600 - label.y, 0);
          scene.add(item);
          texts.push(item);
        }
        return;
      }
      if (sceneName === 'fx') {
        // Effect coverage for quad trimming: outline and shadow at several sizes, offsets inside and beyond the
        // baked field padding, plain text, and rotations about every axis.
        const sample = 'Glyph Ag fj Wy @%';
        const add = (options, x, y, rotate) => {
          const item = three.createText({ font, text: sample, layout: { wrap: 'none' }, ...options });
          item.position.set(x, 600 - y, 0);
          if (rotate !== undefined) item.rotation.set(...rotate);
          scene.add(item);
          texts.push(item);
        };
        let y = 6;
        for (const size of [6, 9, 12, 16, 24, 40, 64]) {
          const outline = { color: '#ff3030', width: size / 16 };
          const near = { color: '#3060ff', offset: [size / 20, size / 24] };
          const far = { color: '#30c060', offset: [-size / 6, size / 5] };
          const thin = { color: '#ffb000', width: size / 40 };
          const only = context.query.get('only');
          if (only === null || only === 'plain') add({ style: { fontSize: size, color: '#ffffff' } }, 8, y);
          if (only === null || only === 'outline') {
            add({ style: { fontSize: size, color: '#ffffff', outline } }, 8 + size * 9, y);
            add({ style: { fontSize: size, color: '#ffffff', outline: thin } }, 8 + size * 36, y);
          }
          if (only === null)
            add({ style: { fontSize: size, color: '#ffffff', outline, shadow: near } }, 8 + size * 18, y);
          if (only === null || only === 'shadow') {
            add({ style: { fontSize: size, color: '#ffffff', shadow: far } }, 8 + size * 27, y);
            add({ style: { fontSize: size, color: '#ffffff', shadow: near } }, 8 + size * 45, y);
          }
          y += size * 1.5 + 4;
        }
        const fx = {
          fontSize: 28,
          color: '#ffffff',
          outline: { color: '#ff3030', width: 28 / 16 },
          shadow: { color: '#3060ff', offset: [2, 2] },
        };
        if (context.query.get('only') !== null) return;
        add({ style: fx }, 20, 330, [0, 0, 0.5]);
        add({ style: fx }, 300, 330, [1.1, 0, 0]);
        add({ style: fx }, 300, 400, [0, 1.2, 0]);
        add({ style: fx }, 520, 330, [0.7, 0.6, 0.3]);
        add({ style: { fontSize: 28, color: '#ffffff' } }, 520, 430, [0.9, -0.8, -0.2]);
        add({ style: fx }, 20, 520, [0, Math.PI, 0]);
        return;
      }
      if (sceneName === 'arabic') {
        text = three.createText({
          font,
          text: ARABIC_TEXT,
          style: { fontSize: ARABIC_FONT_SIZE, lineHeight: 1.6, color: '#ffffff', direction: 'rtl', language: 'ar' },
          constraints: exact(ARABIC_WIDTH),
        });
      } else if (sceneName === 'kern') {
        text = three.createText({
          font,
          text: KERN_TEXT,
          style: { fontSize: KERN_FONT_SIZE, lineHeight: 1.5, color: '#ffffff' },
          constraints: exact(KERN_WIDTH),
        });
      } else {
        text = three.createText({
          font,
          // ?custom=1 composes a caller material over the canonical graph (red fill, glow from the true distance).
          ...(context.query.has('custom') && defineTextMaterial !== undefined
            ? {
                material: defineTextMaterial((material) => {
                  const composed = material.createDefaultMaterial();
                  const pixels = material.shader.trueDistance.mul(material.shader.pixelRange);
                  composed.colorNode = context.TSL.vec3(1, 0, 0);
                  composed.opacityNode = context.TSL.max(
                    material.shader.opacity,
                    context.TSL.smoothstep(-1.5, 0, pixels).mul(0.5),
                  );
                  return composed;
                }),
              }
            : {}),
          text: PARAGRAPH,
          style: {
            fontSize: PARAGRAPH_FONT_SIZE,
            lineHeight: PARAGRAPH_LINE_HEIGHT / PARAGRAPH_FONT_SIZE,
            color: '#ffffff',
          },
          constraints: exact(PARAGRAPH_WIDTH),
        });
      }
      text.position.set(0, 600, 0);
      scene.add(text);
      texts.push(text);
    },
    frame() {
      glyph.shape();
    },
    setWidth(width) {
      text.constraints = exact(width);
    },
    setText(value) {
      text.text = value;
    },
    stats() {
      const out = { gpuBytes: three.gpuBytes, texts: texts.length };
      try {
        const first = texts[0];
        const measured = first.measure();
        out.width = measured.width;
        out.height = measured.height;
        out.lineCount = measured.lineCount;
        out.glyphCount = texts.reduce((sum, item) => sum + item.measure().glyphCount, 0);
        out.commit = first.commitState().status;
      } catch (error) {
        out.statsError = String(error);
      }
      return out;
    },
  };
}
