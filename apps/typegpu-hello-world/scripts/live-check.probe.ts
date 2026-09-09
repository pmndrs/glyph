import { glyph } from '@pmndrs/glyph';
import { defineTypeGpuConfig, type TypeGpuDraw } from '@pmndrs/glyph/typegpu';
import tgpu, { common, d, std } from 'typegpu';
import { MsdfCoverageInput, msdfCoverage } from '@pmndrs/glyph/shaders/typegpu/msdf';
import { ready } from '/src/main.ts';

const app = await ready;
const { root } = app;
const handle = app.handle.with(app.animationGroup);
const errors: string[] = [];
root.device.addEventListener('uncapturederror', (event: GPUUncapturedErrorEvent) => errors.push(event.error.message));
const width = 512;
const height = 256;
const format = navigator.gpu.getPreferredCanvasFormat();
const target = root.device.createTexture({
  size: [width, height],
  format,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
});
const readback = root.device.createBuffer({
  size: width * height * 4,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});
async function pixels(drawHandle = handle, depth?: { texture: GPUTexture; clear: number }) {
  root.device.pushErrorScope('validation');
  const encoder = root.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view: target.createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
    depthStencilAttachment: depth && {
      view: depth.texture.createView(),
      depthClearValue: depth.clear,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  drawHandle.draw(pass, { width, height });
  // A caller command after Glyph demonstrates that draw() leaves the pass open.
  pass.setScissorRect(0, 0, width, height);
  pass.end();
  encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: width * 4 }, [width, height]);
  root.device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const bytes = new Uint8Array(readback.getMappedRange()).slice();
  readback.unmap();
  const error = await root.device.popErrorScope();
  if (error !== null) throw new Error(error.message);
  return bytes;
}
function visible(bytes: Uint8Array) {
  let count = 0;
  for (let i = 3; i < bytes.length; i += 4) if (bytes[i]! > 0) count++;
  return count;
}
async function verifyMsdfRotation() {
  const attachment = root.device.createTexture({
    size: [4, 4],
    format: 'rgba32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const result = root.device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  root.device.pushErrorScope('validation');
  try {
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const fragment = tgpu.fragmentFn({ in: { position: d.builtin.position }, out: d.vec4f })((input) => {
        'use gpu';
        const uv = d
          .vec2f(
            cosine * input.position.x - sine * input.position.y,
            sine * input.position.x + cosine * input.position.y,
          )
          .div(64);
        const coverage = msdfCoverage(
          MsdfCoverageInput({
            atlasCoordinate: uv,
            shadowCoordinate: uv,
            uvBounds: d.vec4f(-100, -100, 100, 100),
            atlasSize: d.vec2f(128),
            pixelRange: 4,
            baseSample: d.vec4f(0.6),
            shadowSample: d.vec4f(0.6),
            outlineWidth: 0,
          }),
        );
        // Negative control: the former L1 footprint must differ at 45 degrees.
        const formerRange = 0.5 * std.dot(d.vec2f(4 / 128), d.vec2f(1).div(std.fwidth(uv)));
        return d.vec4f(coverage.x, coverage.z, 0.1 * formerRange + 0.5, 1);
      });
      const pipeline = root.createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment,
        targets: { format: 'rgba32float' },
      });
      const encoder = root.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: attachment.createView(), loadOp: 'clear', storeOp: 'store' }],
      });
      pipeline.with(pass).draw(3);
      pass.end();
      encoder.copyTextureToBuffer({ texture: attachment }, { buffer: result, bytesPerRow: 256 }, [4, 4]);
      root.device.queue.submit([encoder.finish()]);
      await result.mapAsync(GPUMapMode.READ);
      const values = new Float32Array(result.getMappedRange()).slice();
      result.unmap();
      // UV scale 1/64 and atlas range 4/128 imply 2 pixels per distance unit: .1 * 2 + .5 = .7.
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          const offset = y * 64 + x * 4;
          if (Math.abs(values[offset]! - 0.7) > 1e-5 || Math.abs(values[offset + 1]! - 0.7) > 1e-5)
            throw new Error(`MSDF fill/shadow footprint changed at angle ${angle}: ${values[offset]}`);
          if (angle === Math.PI / 4 && Math.abs(values[offset + 2]! - 0.7) < 0.05)
            throw new Error('MSDF rotation negative control failed to discriminate the former fwidth footprint');
        }
    }
  } finally {
    result.destroy();
    attachment.destroy();
    const error = await root.device.popErrorScope();
    if (error !== null) throw new Error(error.message);
  }
}
async function verifyHooks() {
  const poseLayout = tgpu.bindGroupLayout({ pose: { uniform: d.vec2f } });
  const paintLayout = tgpu.bindGroupLayout({ tint: { uniform: d.vec3f } });
  const pose = root.createUniform(d.vec2f, [0, 0]);
  const tint = root.createUniform(d.vec3f, [1, 0, 0]);
  const green = root.createUniform(d.vec3f, [0, 1, 0]);
  const poseGroup = root.createBindGroup(poseLayout, { pose });
  const paintGroup = root.createBindGroup(paintLayout, { tint });
  const greenGroup = root.createBindGroup(paintLayout, { tint: green });
  const cutoff = root.createUniform(d.f32, width);
  const depth = root.device.createTexture({
    size: [width, height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const custom = glyph.handle(
    'typegpu:shader-hooks',
    defineTypeGpuConfig({
      root,
      format,
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      transformPosition: (position, viewport) => {
        'use gpu';
        const x = (position.x * 2) / viewport.x - 1;
        const y = 1 - (position.y * 2) / viewport.y;
        const w = 1 + x * std.sin(poseLayout.$.pose.x) * 0.3;
        return d.vec4f(x * std.cos(poseLayout.$.pose.x) + poseLayout.$.pose.y * w, y, w * 0.5, w);
      },
      transformColor: (color, fragmentPosition) => {
        'use gpu';
        return d.vec4f(paintLayout.$.tint, std.select(color.a, 0, fragmentPosition.x >= cutoff.$));
      },
    }),
  );
  const text = custom.createText({
    font: app.fonts.msdf,
    text: 'Shader callbacks',
    position: [24, 64],
    style: { fontSize: 48 },
  });
  const plain = glyph.handle('typegpu:default-shaders', defineTypeGpuConfig({ root, format }));
  const plainText = plain.createText({
    font: app.fonts.msdf,
    text: 'Shader callbacks',
    position: [24, 64],
    style: { fontSize: 48 },
  });
  const positioned = custom.with(poseGroup);
  const bound = positioned.with(paintGroup);
  const draw = (clear = 1) => pixels(bound, { texture: depth, clear });
  function expectDrawError(view: TypeGpuDraw, message: RegExp) {
    const encoder = root.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    let caught: unknown;
    try {
      view.draw(pass, { width, height });
    } catch (error) {
      caught = error;
    } finally {
      pass.end();
    }
    if (!(caught instanceof Error) || !message.test(caught.message))
      throw new Error(`Expected draw to throw ${message}, received ${String(caught)}`);
  }
  const red = format.startsWith('bgra') ? 2 : 0;
  const blue = format.startsWith('bgra') ? 0 : 2;
  try {
    for (const font of Object.values(app.fonts)) {
      text.update({ font });
      plainText.update({ font });
      glyph.shape();
      const defaultPixels = await pixels(plain);
      if (visible(defaultPixels) < 100) throw new Error('Default shaders did not render text');
      pose.write([0, 0]);
      tint.write([1, 0, 0]);
      cutoff.write(width);
      const before = await draw();
      if (visible(before) < 100) throw new Error('Callback pipeline did not render text');
      if (
        !before.some((value, i) => i % 4 === red && value > 100) ||
        before.some((value, i) => i % 4 === blue && value !== 0)
      )
        throw new Error('Color callback did not replace RGB');
      const alternate = await pixels(bound.with(greenGroup), { texture: depth, clear: 1 });
      if (
        !alternate.some((value, i) => i % 4 === 1 && value > 100) ||
        alternate.some((value, i) => (i % 4 === red || i % 4 === blue) && value !== 0)
      )
        throw new Error('The last bind group for a layout did not replace the earlier binding');
      if ((await draw()).some((value, i) => value !== before[i]))
        throw new Error('with() mutated an earlier draw view');
      expectDrawError(custom, /Missing bind groups/);
      expectDrawError(positioned, /Missing bind groups/);
      tint.write([0, 0, 1]);
      const recolored = await draw();
      if (
        visible(recolored) !== visible(before) ||
        !recolored.some((value, i) => i % 4 === blue && value > 100) ||
        recolored.some((value, i) => i % 4 === red && value !== 0)
      )
        throw new Error('Uniform recoloring changed coverage or failed to update without shaping');
      pose.write([0.7, 0]);
      const rotated = await draw();
      if (visible(rotated) < 100 || !rotated.some((value, i) => value !== recolored[i]))
        throw new Error('Perspective rotation failed to update without shaping');
      if (visible(await draw(0.25)) !== 0) throw new Error('Text ignored caller depth attachment');
      if (visible(await draw(0.75)) < 100) throw new Error('Text used incorrect clip depth');
      cutoff.write(0);
      if (visible(await draw()) !== 0) throw new Error('Fragment position was not supplied to color callback');
      cutoff.write(width);
      pose.write([0, 4]);
      if (visible(await draw()) !== 0) throw new Error('Position callback failed to move text outside the viewport');
      const isolated = await pixels(plain);
      if (isolated.some((value, i) => value !== defaultPixels[i]))
        throw new Error('Custom callbacks leaked into the default config');
    }
    pose.write([0, 0]);
    const sibling = custom('label');
    sibling.createText({ font: app.fonts.msdf, text: 'Named root', position: [24, 64], style: { fontSize: 48 } });
    glyph.shape();
    if (visible(await pixels(sibling.with(poseGroup).with(paintGroup), { texture: depth, clear: 1 })) < 100)
      throw new Error('Named roots did not forward bind groups');
    custom.dispose();
    expectDrawError(bound, /disposed/);
  } finally {
    text.dispose();
    custom.dispose();
    plainText.dispose();
    plain.dispose();
    depth.destroy();
    pose.buffer.destroy();
    tint.buffer.destroy();
    green.buffer.destroy();
    cutoff.buffer.destroy();
  }
}
async function verifyIncrementalReflow() {
  for (const [name, font] of Object.entries(app.fonts)) {
    const reflow = glyph.handle(`typegpu:reflow:${name}`, defineTypeGpuConfig({ root, format }));
    const text = 'alpha beta gamma delta epsilon zeta eta theta';
    const retained = reflow.createText({
      font,
      text,
      position: [24, 24],
      style: { fontSize: 32 },
      constraints: { width: { mode: 'exact', size: 280 } },
    });
    try {
      glyph.shape();
      const before = await pixels(reflow);
      retained.update({ constraints: { width: { mode: 'exact', size: 120 } } });
      glyph.shape();
      const incremental = await pixels(reflow);
      if (!incremental.some((value, index) => value !== before[index]))
        throw new Error(`${name} width reflow did not move pixels`);

      const cold = reflow('cold');
      cold.createText({
        font,
        text,
        position: [24, 24],
        style: { fontSize: 32 },
        constraints: { width: { mode: 'exact', size: 120 } },
      });
      glyph.shape();
      const rebuilt = await pixels(cold);
      if (rebuilt.some((value, index) => value !== incremental[index]))
        throw new Error(`${name} incremental reflow differs from a cold final-state root`);
    } finally {
      retained.dispose();
      reflow.dispose();
    }
  }
}
// The app already owns the singleton; its update() invokes the public glyph.shape().
const message = document.querySelector<HTMLInputElement>('#message')!;
const raster = document.querySelector<HTMLSelectElement>('#raster')!;
const counts: Record<string, number> = {};
try {
  await verifyMsdfRotation();
  for (const format of ['bitmap', 'msdf', 'slug']) {
    raster.value = format;
    message.value = 'Hello, TypeGPU!';
    app.update();
    const before = await pixels();
    counts[format] = visible(before);
    if (counts[format]! < 100) throw new Error(`${format} produced no readable text`);
    const idle = await pixels();
    if (before.some((value, i) => value !== idle[i])) throw new Error(`${format} idle draw changed pixels`);
    message.value = 'Updated text';
    app.update();
    const after = await pixels();
    if (visible(after) < 100 || !after.some((value, i) => value !== before[i]))
      throw new Error(`${format} update did not change pixels`);
    message.value = '';
    app.update();
    if (visible(await pixels()) !== 0) throw new Error(`${format} empty text did not clear draws`);
  }
  await verifyHooks();
  await verifyIncrementalReflow();
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  readback.destroy();
  target.destroy();
  window.dispatchEvent(new Event('pagehide'));
}
console.log('typegpu-hello-world-live-ok', JSON.stringify(counts));
export {};
