import { describe, expect, it } from 'vitest'

import type { BenchmarkMeasurement } from './contracts'
import { scenarioById } from './scenarios'

const sceneMeasurement: BenchmarkMeasurement = {
  sample: 0,
  durationMs: 1,
  outputBytes: 512 * 320 * 4,
  hash: '57e86b4b1e299a4574354a6eb46a13be150ac5a627c0dc0042739bd904e5a1e7',
  metrics: {
    backendWebGpu: 0,
    backendWebGl2: 1,
    dpr: 1,
    sceneCount: 4,
    textObjectCount: 4,
    glyphCount: 174,
    drawCount: 4,
    changedPixels: 14_818,
    distinctRgbColors: 2_800,
    artifactBytes: 39_347_692,
    compressedArtifactBytes: 6_979_347,
    renderTargetGpuBytes: 512 * 320 * 4,
    fontLoadMs: 1,
    firstDrawMs: 1,
    renderMs: 1,
  },
}

const samplingMeasurement: BenchmarkMeasurement = {
  sample: 0,
  durationMs: 1,
  outputBytes: 512 * 512 * 4,
  hash: 'a21ba2802534643cc63bcb7d24afc92a45ec3725d936680d87ae4688a7fc1563',
  metrics: {
    backendWebGpu: 0,
    backendWebGl2: 1,
    dpr: 1,
    fixtureIsInter: 1,
    pixelCount: 512 * 512,
    glyphCount: 84,
    meanAbsoluteError: 0.09691,
    maximumError: 30,
    errorPixels: 3_231,
    renderMs: 1,
  },
}

const sourceOutlineMeasurement: BenchmarkMeasurement = {
  sample: 0,
  durationMs: 1,
  outputBytes: 384 * 128 * 4,
  hash: 'pinned-source-outline-frame',
  metrics: {
    techniqueBitmap: 1,
    techniqueMtsdf: 0,
    backendWebGpu: 1,
    backendWebGl2: 0,
    dpr: 1,
    pixelCount: 384 * 128,
    physicalPpem: 16,
    meanAbsoluteError: 7.393,
    maximumError: 255,
    errorPixels: 5_852,
    renderMs: 1,
  },
}

describe('MTSDF scenario acceptance', () => {
  it('rejects a deterministic substitute for the canonical WebGL2 scene', () => {
    const scenario = scenarioById('mtsdf-text-scenes')
    expect(scenario.validate([sceneMeasurement])).toContain('deterministic MTSDF')
    expect(() => scenario.validate([{ ...sceneMeasurement, hash: 'static-substitute' }])).toThrow(
      'scene evidence drifted',
    )
  })

  it('rejects sampling error outside the reviewed base-level envelope', () => {
    const scenario = scenarioById('mtsdf-sampling-conformance')
    expect(scenario.validate([samplingMeasurement])).toContain('CPU MTSDF comparison')
    expect(() =>
      scenario.validate([
        {
          ...samplingMeasurement,
          metrics: { ...samplingMeasurement.metrics, meanAbsoluteError: 0.251 },
        },
      ]),
    ).toThrow('comparison contract')
    expect(() =>
      scenario.validate([
        {
          ...samplingMeasurement,
          metrics: { ...samplingMeasurement.metrics, errorPixels: 6_000 },
        },
      ]),
    ).toThrow('comparison contract')
  })

  it('rejects source-outline error outside the reviewed browser envelope', () => {
    const scenario = scenarioById('source-outline-fidelity')
    expect(scenario.validate([sourceOutlineMeasurement])).toContain(
      'source-outline comparisons within reviewed envelopes',
    )
    expect(() =>
      scenario.validate([
        {
          ...sourceOutlineMeasurement,
          metrics: { ...sourceOutlineMeasurement.metrics, meanAbsoluteError: 12.001 },
        },
      ]),
    ).toThrow('reviewed browser coverage envelope')
    expect(() =>
      scenario.validate([
        {
          ...sourceOutlineMeasurement,
          metrics: {
            ...sourceOutlineMeasurement.metrics,
            errorPixels: Math.floor(384 * 128 * 0.2) + 1,
          },
        },
      ]),
    ).toThrow('reviewed browser coverage envelope')
  })
})
