// WebGPU backend: WGSL, band headers and references in storage buffers, variant A's curves in an rgba16float
// texture, variant B's points in an array<u32> storage buffer. Timing uses timestamp-query when the adapter has it,
// otherwise wall time around queue.onSubmittedWorkDone().
import { TEXTURE_WIDTH, wgslSource } from './shaders.mjs';
import { INSTANCE_STRIDE, projectionUniforms } from './scene.mjs';

const TARGET_FORMAT = 'rgba8unorm';

export async function createWebGpuBackend(canvas) {
  if (!navigator.gpu) throw new Error('navigator.gpu is missing (WebGPU unavailable or not a secure context)');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('requestAdapter() returned null');
  const timestamps = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: timestamps ? ['timestamp-query'] : [],
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
    },
  });
  const errors = [];
  device.addEventListener('uncapturederror', (event) => {
    errors.push(event.error.message);
    console.error('WebGPU error:', event.error.message);
  });
  device.lost.then((info) => console.error('WebGPU device lost:', info.message));
  const context = canvas.getContext('webgpu');
  const info = adapter.info ?? {};

  /** @type {Map<string, GPURenderPipeline>} */
  const pipelines = new Map();
  let resources = null;
  let target = null;
  let scene = null;

  function checkErrors(where) {
    if (errors.length) throw new Error(`WebGPU ${where}: ${errors.splice(0).join('; ')}`);
  }

  function storage(data) {
    const size = Math.max(16, Math.ceil(data.byteLength / 4) * 4);
    const buffer = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const padded = new Uint8Array(size);
    padded.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    device.queue.writeBuffer(buffer, 0, padded);
    return buffer;
  }

  async function pipeline(variant) {
    let result = pipelines.get(variant.id);
    if (result) return result;
    const code = wgslSource(variant);
    const module = device.createShaderModule({ code, label: `slug ${variant.id}` });
    const compilation = await module.getCompilationInfo();
    const messages = compilation.messages.filter((m) => m.type === 'error');
    if (messages.length) {
      throw new Error(
        `WGSL ${variant.id}: ${messages.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n')}`,
      );
    }
    const float4 = (location, offset) => ({ shaderLocation: location, offset, format: 'float32x4' });
    result = await device.createRenderPipelineAsync({
      label: `slug ${variant.id}`,
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: INSTANCE_STRIDE,
            stepMode: 'instance',
            attributes: [
              float4(0, 0),
              float4(1, 16),
              float4(2, 32),
              { shaderLocation: 3, offset: 48, format: 'float32' },
              { shaderLocation: 4, offset: 52, format: 'uint32x4' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [
          {
            format: TARGET_FORMAT,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-strip' },
    });
    pipelines.set(variant.id, result);
    return result;
  }

  function bindGroup(variant, pipe) {
    const key = `${variant.id}`;
    let group = resources.groups.get(key);
    if (group) return group;
    const uniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const isA = variant.fetch === 'A';
    group = {
      uniform,
      coordScale: isA ? 1 : resources.unitsPerEm,
      group: device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: resources.headers } },
          { binding: 2, resource: { buffer: isA ? resources.refsA : resources.refsB } },
          { binding: 3, resource: isA ? resources.curveView : { buffer: resources.points } },
        ],
      }),
    };
    resources.groups.set(key, group);
    return group;
  }

  function writeUniforms(group) {
    const p = projectionUniforms(target.width, target.height);
    device.queue.writeBuffer(
      group.uniform,
      0,
      new Float32Array([...p.row0, ...p.row1, ...p.row3, ...p.viewport, group.coordScale, 0]),
    );
  }

  function encodePass(encoder, pipe, group, draws, timestampWrites) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: target.view, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' },
      ],
      ...(timestampWrites ? { timestampWrites } : {}),
    });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, group.group);
    pass.setVertexBuffer(0, scene.buffer);
    for (let d = 0; d < draws; d += 1) pass.draw(4, scene.count);
    pass.end();
  }

  async function prepared(variant) {
    const pipe = await pipeline(variant);
    const group = bindGroup(variant, pipe);
    writeUniforms(group);
    return { pipe, group };
  }

  return {
    name: 'webgpu',
    timer: timestamps ? 'timestamp-query' : 'onSubmittedWorkDone',
    info: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description },

    setAsset(asset) {
      if (resources) {
        for (const buffer of [resources.headers, resources.refsA, resources.refsB, resources.points]) buffer.destroy();
        resources.curveTexture.destroy();
      }
      const curveTexture = device.createTexture({
        size: [TEXTURE_WIDTH, asset.curves.rows],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture: curveTexture },
        asset.curves.data,
        { bytesPerRow: TEXTURE_WIDTH * 8, rowsPerImage: asset.curves.rows },
        [TEXTURE_WIDTH, asset.curves.rows],
      );
      resources = {
        unitsPerEm: asset.unitsPerEm,
        headers: storage(asset.headers.data),
        refsA: storage(asset.refsA.data),
        refsB: storage(asset.refsB.data),
        points: storage(asset.points.data),
        curveTexture,
        curveView: curveTexture.createView(),
        groups: new Map(),
      };
      checkErrors('upload');
    },

    setTarget(width, height) {
      target?.texture.destroy();
      canvas.width = width;
      canvas.height = height;
      context.configure({
        device,
        format: TARGET_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
        alphaMode: 'opaque',
      });
      const texture = device.createTexture({
        size: [width, height],
        format: TARGET_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      target = { texture, view: texture.createView(), width, height };
    },

    setScene(instances) {
      scene?.buffer.destroy();
      const buffer = device.createBuffer({
        size: instances.data.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, instances.data);
      scene = { buffer, count: instances.count };
    },

    /** Per-frame GPU (or wall) milliseconds for `frames` frames after `warmup` frames, plus pipelined wall ms. */
    async time(variant, { frames, warmup, draws }) {
      const { pipe, group } = await prepared(variant);
      for (let i = 0; i < warmup; i += 1) {
        const encoder = device.createCommandEncoder();
        encodePass(encoder, pipe, group, draws);
        device.queue.submit([encoder.finish()]);
      }
      await device.queue.onSubmittedWorkDone();
      checkErrors(`warm-up ${variant.id}`);

      const samples = [];
      if (timestamps) {
        const querySet = device.createQuerySet({ type: 'timestamp', count: frames * 2 });
        const resolve = device.createBuffer({
          size: frames * 16,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        const read = device.createBuffer({
          size: frames * 16,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        const start = performance.now();
        for (let i = 0; i < frames; i += 1) {
          const encoder = device.createCommandEncoder();
          encodePass(encoder, pipe, group, draws, {
            querySet,
            beginningOfPassWriteIndex: i * 2,
            endOfPassWriteIndex: i * 2 + 1,
          });
          device.queue.submit([encoder.finish()]);
        }
        await device.queue.onSubmittedWorkDone();
        const wall = (performance.now() - start) / frames;
        const encoder = device.createCommandEncoder();
        encoder.resolveQuerySet(querySet, 0, frames * 2, resolve, 0);
        encoder.copyBufferToBuffer(resolve, 0, read, 0, frames * 16);
        device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);
        const ticks = new BigInt64Array(read.getMappedRange().slice(0));
        read.unmap();
        for (let i = 0; i < frames; i += 1) samples.push(Number(ticks[i * 2 + 1] - ticks[i * 2]) / 1e6);
        querySet.destroy();
        resolve.destroy();
        read.destroy();
        checkErrors(`timing ${variant.id}`);
        return { samples, pipelinedWallMs: wall, timer: 'timestamp-query' };
      }
      const start = performance.now();
      for (let i = 0; i < frames; i += 1) {
        const t0 = performance.now();
        const encoder = device.createCommandEncoder();
        encodePass(encoder, pipe, group, draws);
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        samples.push(performance.now() - t0);
      }
      checkErrors(`timing ${variant.id}`);
      return { samples, pipelinedWallMs: (performance.now() - start) / frames, timer: 'onSubmittedWorkDone' };
    },

    /** Render one frame (one draw), show it on the canvas, and return top-down RGBA8 pixels. */
    async render(variant) {
      const { pipe, group } = await prepared(variant);
      const { width, height } = target;
      const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
      const read = device.createBuffer({
        size: bytesPerRow * height,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const encoder = device.createCommandEncoder();
      encodePass(encoder, pipe, group, 1);
      encoder.copyTextureToBuffer({ texture: target.texture }, { buffer: read, bytesPerRow }, [width, height]);
      encoder.copyTextureToTexture({ texture: target.texture }, { texture: context.getCurrentTexture() }, [
        width,
        height,
      ]);
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(read.getMappedRange());
      const pixels = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
      }
      read.unmap();
      read.destroy();
      checkErrors(`render ${variant.id}`);
      return pixels;
    },

    destroy() {
      device.destroy();
    },
  };
}
