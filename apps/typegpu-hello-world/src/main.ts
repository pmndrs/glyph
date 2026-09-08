import { glyph } from '@pmndrs/glyph';
import { defineTypeGpuConfig, type TypeGpuText } from '@pmndrs/glyph/typegpu';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { slug } from '@pmndrs/glyph/raster/slug';
import tgpu, { d, std } from 'typegpu';
import fontUrl from '../assets/inter-latin.font.glb?url';
import './style.css';

const animation = tgpu.bindGroupLayout({
  angle: { uniform: d.f32 },
});

const canvas = document.querySelector('canvas')!;
const status = document.querySelector<HTMLElement>('#status')!;
const message = document.querySelector<HTMLInputElement>('#message')!;
const size = document.querySelector<HTMLInputElement>('#size')!;
const color = document.querySelector<HTMLInputElement>('#color')!;
const raster = document.querySelector<HTMLSelectElement>('#raster')!;
const tilt = document.querySelector<HTMLInputElement>('#tilt')!;
const tiltValue = document.querySelector<HTMLOutputElement>('#tilt-value')!;
const sizeValue = document.querySelector<HTMLOutputElement>('#size-value')!;

const ctrl = new AbortController();
export const ready = start(ctrl.signal);
ready.catch((error: unknown) => {
  ctrl.abort();
  status.textContent = error instanceof Error ? error.message : String(error);
});

window.addEventListener('pagehide', () => ctrl.abort(), { once: true });

async function start(signal: AbortSignal) {
  if (navigator.gpu === undefined) throw new Error('This example needs a browser with WebGPU support.');

  const root = await tgpu.init();
  signal.addEventListener('abort', () => root.destroy());

  const angle = root.createUniform(d.f32, 0);
  const animationGroup = root.createBindGroup(animation, { angle });

  const fonts = {
    bitmap: glyph.fontFace(fontUrl, { format: bitmap({ strikes: [32] }) }),
    msdf: glyph.fontFace(fontUrl, { format: msdf }),
    slug: glyph.fontFace(fontUrl, { format: slug }),
  };
  signal.addEventListener('abort', () => {
    for (const font of Object.values(fonts)) font.dispose();
  });

  const context = root.configureContext({ canvas, alphaMode: 'premultiplied' });
  signal.addEventListener('abort', () => context.unconfigure());

  function selectedFont() {
    switch (raster.value) {
      case 'bitmap':
        return fonts.bitmap;
      case 'slug':
        return fonts.slug;
      default:
        return fonts.msdf;
    }
  }

  await glyph.init();
  const handle = glyph.handle(
    'hello:typegpu',
    defineTypeGpuConfig({
      root,
      format: navigator.gpu.getPreferredCanvasFormat(),
      transformPosition: (position, viewport) => {
        'use gpu';
        const x = (position.x * 2) / viewport.x - 1;
        const y = 1 - (position.y * 2) / viewport.y;
        const w = 1 + x * std.sin(animation.$.angle) * 0.3;
        return d.vec4f(x * std.cos(animation.$.angle), y, w * 0.5, w);
      },
      transformColor: (color) => {
        'use gpu';
        return d.vec4f(
          std.mix(color.rgb, color.rgb.mul(d.vec3f(0.6, 0.8, 1)), std.abs(std.sin(animation.$.angle))),
          color.a,
        );
      },
    }),
  );
  signal.addEventListener('abort', () => handle?.dispose());

  await Promise.all(Object.values(fonts).map((font) => font.load()));
  const text: TypeGpuText = handle.createText({ font: fonts.msdf, text: message.value });
  signal.addEventListener('abort', () => text?.dispose());

  function update(): void {
    if (signal.aborted || text === undefined || handle === undefined) return;
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio;
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    sizeValue.value = `${size.value} px`;
    text.update({
      font: selectedFont(),
      text: message.value,
      position: [24, 64],
      style: { fontSize: Number(size.value), color: color.value },
      constraints: { width: { mode: 'at-most', size: Math.max(1, bounds.width - 48) } },
      rasterPixelRatio: ratio,
    });
    glyph.shape();
    draw();
    status.textContent = `${raster.value.toUpperCase()} · ${text.glyphs().glyphIds.length} glyphs · WebGPU`;
  }

  function onInput(event: Event): void {
    if (event.target === tilt) {
      tiltValue.value = `${tilt.value}°`;
      angle.write((Number(tilt.value) * Math.PI) / 180);
      draw();
    } else {
      update();
    }
  }

  function draw(): void {
    if (handle === undefined || context === null) return;

    const encoder = root['~unstable'].createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context,
          clearValue: [27 / 255, 32 / 255, 64 / 255, 1],
        },
      ],
    });

    // Other TypeGPU pipelines can record into this same pass before or after text.
    handle.with(animationGroup).draw(pass, { width: canvas.clientWidth, height: canvas.clientHeight });
    pass.end();
    encoder.submit();
  }

  update();

  const observer = new ResizeObserver(update);
  observer.observe(canvas);
  signal.addEventListener('abort', () => observer?.disconnect());

  document.querySelector('form')!.addEventListener('input', onInput);
  signal.addEventListener('abort', () => document.querySelector('form')!.removeEventListener('input', onInput));

  return { root, handle, text, fonts, draw, update, animationGroup };
}
