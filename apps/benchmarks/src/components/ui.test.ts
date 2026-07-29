import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Field, logarithmicRangePosition, logarithmicRangeValue } from './ui'

describe('Field', () => {
  it('gives range controls a full-width unpadded travel surface', () => {
    const markup = renderToStaticMarkup(
      createElement(Field, { label: 'Opacity', min: 0, max: 100, type: 'range', value: 50 }),
    )

    expect(markup).toContain('range-shell')
    expect(markup).toContain('range-control')
    expect(markup).toContain('min-w-0')
    expect(markup).toContain('w-full')
    expect(markup).toContain('--range-progress:0.5')
    expect(markup).not.toContain('px-2.5')
  })

  it('clamps the filled rail to the declared range', () => {
    const markup = renderToStaticMarkup(
      createElement(Field, { label: 'Stroke', min: 20, max: 80, type: 'range', value: 120 }),
    )

    expect(markup).toContain('--range-progress:1')
  })

  it('maps logarithmic range travel back to exact stepped values', () => {
    expect(logarithmicRangePosition(8, 8, 1_024)).toBe(0)
    expect(logarithmicRangePosition(1_024, 8, 1_024)).toBe(1)
    expect(logarithmicRangeValue(0.5, 8, 1_024, 1)).toBe(91)
    expect(Number.isInteger(logarithmicRangeValue(0.73, 8, 1_024, 1))).toBe(true)
  })

  it('keeps semantic accessibility values on logarithmic controls', () => {
    const markup = renderToStaticMarkup(
      createElement(Field, {
        label: 'Icon size',
        max: 1_024,
        min: 8,
        onRangeValueChange: () => undefined,
        rangeScale: 'logarithmic',
        step: 1,
        type: 'range',
        value: 128,
      }),
    )

    expect(markup).toContain('aria-valuemin="8"')
    expect(markup).toContain('aria-valuemax="1024"')
    expect(markup).toContain('aria-valuenow="128"')
    expect(markup).toContain('--range-progress:0.5714285714285714')
  })

  it('retains inset padding for text inputs', () => {
    const markup = renderToStaticMarkup(
      createElement(Field, { label: 'Samples', type: 'number', value: 32 }),
    )

    expect(markup).not.toContain('range-control')
    expect(markup).toContain('px-2.5')
  })
})
