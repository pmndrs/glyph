import { describe, expect, it } from 'vitest'
import baseline from '../generated/autoresearch-baseline-v0.json'
import { assertAutoresearchBaseline, assertAutoresearchDisabled } from './autoresearch'

describe('autoresearch baseline', () => {
  it('is valid and fails closed with campaigns disabled', () => {
    expect(() => assertAutoresearchBaseline(baseline)).not.toThrow()
    const parsed: unknown = baseline
    assertAutoresearchBaseline(parsed)
    expect(() => assertAutoresearchDisabled(parsed)).not.toThrow()
    expect(parsed.campaign.state).toBe('disabled')
  })

  it('rejects malformed evidence and unapproved campaign activation', () => {
    const malformed = structuredClone(baseline)
    const firstEvidence = malformed.evidence[0]
    if (firstEvidence === undefined) throw new Error('baseline must contain evidence')
    firstEvidence.sha256 = 'not-a-hash'
    expect(() => assertAutoresearchBaseline(malformed)).toThrow(/sha256/)

    const enabled = {
      ...baseline,
      campaign: {
        state: 'enabled',
        approvedBy: 'human:maintainer',
        approvedAt: '2026-07-26T00:00:00Z',
        manifest: 'fixtures/autoresearch/experiment-v0.json',
      },
    } as const
    assertAutoresearchBaseline(enabled)
    expect(() => assertAutoresearchDisabled(enabled)).toThrow(/explicit maintainer approval/)
  })
})
