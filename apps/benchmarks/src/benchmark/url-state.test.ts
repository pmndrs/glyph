import { describe, expect, it } from 'vitest'
import { readHarnessLocation, writeHarnessLocation } from './url-state'

describe('harness URL state', () => {
  it('round-trips a reproducible selection', () => {
    const value = { target: 'font-baker', scenario: 'cold-load-payload', view: 'report' } as const
    expect(readHarnessLocation(writeHarnessLocation(value))).toEqual(value)
  })

  it('rejects unknown views without losing target and scenario', () => {
    expect(readHarnessLocation('?target=slug&scenario=overview&view=unknown')).toEqual({
      target: 'slug',
      scenario: 'overview',
      view: 'scene',
    })
  })
})
