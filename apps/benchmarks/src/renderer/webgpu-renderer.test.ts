import * as THREE from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'
import { disposeConfiguredRenderer } from './webgpu-renderer'

describe('configured renderer disposal', () => {
  it('waits for WebGL context loss before completing', async () => {
    interface TestWebGlContext {
      getExtension(name: 'WEBGL_lose_context'): WEBGL_lose_context | null
      isContextLost(): boolean
    }
    const canvas = new EventTarget() as EventTarget & {
      getContext(type: 'webgl2'): TestWebGlContext
    }
    canvas.getContext = () => ({
      getExtension: () => ({ loseContext() {} }) as WEBGL_lose_context,
      isContextLost: () => false,
    })
    const dispose = vi.fn<() => void>(() => {
      queueMicrotask(() => canvas.dispatchEvent(new Event('webglcontextlost')))
    })
    const renderer = {
      backend: Object.create(THREE.WebGLBackend.prototype),
      dispose,
      domElement: canvas,
    } as unknown as THREE.WebGPURenderer

    let completed = false
    const disposal = disposeConfiguredRenderer(renderer).then(() => {
      completed = true
    })
    expect(dispose).toHaveBeenCalledOnce()
    expect(completed).toBe(false)

    await disposal
    expect(completed).toBe(true)
  })

  it('completes immediately for non-WebGL renderers', async () => {
    const dispose = vi.fn<() => void>()
    const renderer = {
      backend: {},
      dispose,
    } as unknown as THREE.WebGPURenderer

    await disposeConfiguredRenderer(renderer)
    expect(dispose).toHaveBeenCalledOnce()
  })
})
