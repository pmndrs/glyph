// WebGL2 backend: GLSL ES 3.00, R32UI band headers and R16UI references in usampler2D, variant A's curves in an
// RGBA16F sampler2D, variant B's points in an RG16I isampler2D, all read with texelFetch. Timing uses
// EXT_disjoint_timer_query_webgl2 when available, otherwise wall time around gl.finish().
import { GLSL_VERTEX, TEXTURE_WIDTH, glslFragmentSource } from './shaders.mjs';
import { INSTANCE_STRIDE, projectionUniforms } from './scene.mjs';

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

export function createWebGl2Backend(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('getContext("webgl2") returned null');
  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const info = {
    renderer: gl.getParameter(gl.RENDERER),
    vendor: gl.getParameter(gl.VENDOR),
    unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
    unmaskedVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
    version: gl.getParameter(gl.VERSION),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  };

  const programs = new Map();
  let textures = null;
  let target = null;
  let scene = null;

  function compile(type, source, label) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`GLSL ${label}: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }

  function program(variant) {
    let entry = programs.get(variant.id);
    if (entry) return entry;
    const handle = gl.createProgram();
    gl.attachShader(handle, compile(gl.VERTEX_SHADER, GLSL_VERTEX, `${variant.id} vertex`));
    gl.attachShader(handle, compile(gl.FRAGMENT_SHADER, glslFragmentSource(variant), `${variant.id} fragment`));
    gl.linkProgram(handle);
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
      throw new Error(`GLSL ${variant.id} link: ${gl.getProgramInfoLog(handle)}`);
    }
    const location = (name) => gl.getUniformLocation(handle, name);
    entry = {
      handle,
      isA: variant.fetch === 'A',
      row0: location('uRow0'),
      row1: location('uRow1'),
      row3: location('uRow3'),
      viewport: location('uViewport'),
      coordScale: location('uCoordScale'),
    };
    gl.useProgram(handle);
    gl.uniform1i(location('uBandHeaders'), 0);
    gl.uniform1i(location('uBandRefs'), 1);
    gl.uniform1i(location(entry.isA ? 'uCurves' : 'uPoints'), 2);
    programs.set(variant.id, entry);
    return entry;
  }

  function texture(internalFormat, format, type, data, rows) {
    const handle = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, TEXTURE_WIDTH, rows, 0, format, type, data);
    return handle;
  }

  function checkError(where) {
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`WebGL2 ${where}: error 0x${error.toString(16)}`);
  }

  function bind(variant) {
    const entry = program(variant);
    gl.useProgram(entry.handle);
    const p = projectionUniforms(target.width, target.height);
    gl.uniform4fv(entry.row0, p.row0);
    gl.uniform4fv(entry.row1, p.row1);
    gl.uniform4fv(entry.row3, p.row3);
    gl.uniform2fv(entry.viewport, p.viewport);
    gl.uniform1f(entry.coordScale, entry.isA ? 1 : textures.unitsPerEm);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.headers);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, entry.isA ? textures.refsA : textures.refsB);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, entry.isA ? textures.curves : textures.points);
    gl.bindVertexArray(scene.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);
  }

  function frame(draws) {
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let d = 0; d < draws; d += 1) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.count);
  }

  function present() {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      target.width,
      target.height,
      0,
      0,
      target.width,
      target.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  }

  async function queryResults(queries) {
    const samples = [];
    for (const query of queries) {
      while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) await nextTask();
      samples.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
    }
    return { samples, disjoint: Boolean(gl.getParameter(timerExt.GPU_DISJOINT_EXT)) };
  }

  return {
    name: 'webgl2',
    timer: timerExt ? 'EXT_disjoint_timer_query_webgl2' : 'gl.finish',
    info,

    setAsset(asset) {
      if (textures)
        for (const key of ['headers', 'refsA', 'refsB', 'curves', 'points']) gl.deleteTexture(textures[key]);
      textures = {
        unitsPerEm: asset.unitsPerEm,
        headers: texture(gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, asset.headers.data, asset.headers.rows),
        refsA: texture(gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, asset.refsA.data, asset.refsA.rows),
        refsB: texture(gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, asset.refsB.data, asset.refsB.rows),
        curves: texture(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, asset.curves.data, asset.curves.rows),
        points: texture(gl.RG16I, gl.RG_INTEGER, gl.SHORT, asset.points.data, asset.points.rows),
      };
      checkError('upload');
    },

    setTarget(width, height) {
      if (target) {
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteTexture(target.texture);
      }
      canvas.width = width;
      canvas.height = height;
      const color = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, color);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
      target = { framebuffer, texture: color, width, height };
    },

    setScene(instances) {
      if (scene) {
        gl.deleteVertexArray(scene.vao);
        gl.deleteBuffer(scene.buffer);
      }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, instances.data, gl.STATIC_DRAW);
      for (let location = 0; location < 3; location += 1) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 4, gl.FLOAT, false, INSTANCE_STRIDE, location * 16);
        gl.vertexAttribDivisor(location, 1);
      }
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, INSTANCE_STRIDE, 48);
      gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribIPointer(4, 4, gl.UNSIGNED_INT, INSTANCE_STRIDE, 52);
      gl.vertexAttribDivisor(4, 1);
      gl.bindVertexArray(null);
      scene = { vao, buffer, count: instances.count };
    },

    async time(variant, { frames, warmup, draws }) {
      bind(variant);
      for (let i = 0; i < warmup; i += 1) frame(draws);
      gl.finish();
      checkError(`warm-up ${variant.id}`);
      const probe = new Uint8Array(4);
      if (timerExt) {
        // A disjoint event (clock change, context switch) invalidates the batch; retry a few times.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          gl.getParameter(timerExt.GPU_DISJOINT_EXT);
          const queries = [];
          const start = performance.now();
          for (let i = 0; i < frames; i += 1) {
            const query = gl.createQuery();
            gl.beginQuery(timerExt.TIME_ELAPSED_EXT, query);
            frame(draws);
            gl.endQuery(timerExt.TIME_ELAPSED_EXT);
            queries.push(query);
          }
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
          const wall = (performance.now() - start) / frames;
          const { samples, disjoint } = await queryResults(queries);
          checkError(`timing ${variant.id}`);
          if (!disjoint) return { samples, pipelinedWallMs: wall, timer: 'EXT_disjoint_timer_query_webgl2' };
          console.warn(`WebGL2 ${variant.id}: GPU_DISJOINT_EXT, retrying`);
        }
        throw new Error(`WebGL2 ${variant.id}: timer queries disjoint three times`);
      }
      const samples = [];
      const start = performance.now();
      for (let i = 0; i < frames; i += 1) {
        const t0 = performance.now();
        frame(draws);
        gl.finish();
        samples.push(performance.now() - t0);
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
      checkError(`timing ${variant.id}`);
      return { samples, pipelinedWallMs: (performance.now() - start) / frames, timer: 'gl.finish' };
    },

    /** Render one frame (one draw), show it on the canvas, and return top-down RGBA8 pixels. */
    async render(variant) {
      bind(variant);
      frame(1);
      const { width, height } = target;
      const raw = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      present();
      checkError(`render ${variant.id}`);
      const pixels = new Uint8Array(raw.length);
      const row = width * 4;
      for (let y = 0; y < height; y += 1) pixels.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
      return pixels;
    },

    destroy() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
