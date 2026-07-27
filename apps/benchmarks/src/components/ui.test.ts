import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Field } from './ui'

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

  it('retains inset padding for text inputs', () => {
    const markup = renderToStaticMarkup(
      createElement(Field, { label: 'Samples', type: 'number', value: 32 }),
    )

    expect(markup).not.toContain('range-control')
    expect(markup).toContain('px-2.5')
  })
})
