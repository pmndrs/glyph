import { describe, expect, it } from 'vitest';

import { GlyphLeasePolicy, type GlyphLeaseTarget } from './lease-policy';

const targets: readonly GlyphLeaseTarget<string>[] = [
  { key: 'far', distance: 400, ratio: 1 },
  { key: 'centre', distance: 20, ratio: 0.8 },
  { key: 'near', distance: 80, ratio: 1 },
];

describe('GlyphLeasePolicy', () => {
  it('ranks visible viewport targets without requiring pointer intent', () => {
    const policy = new GlyphLeasePolicy<string>();

    expect(policy.rank(targets, 'viewport').map(([key]) => key)).toEqual(['centre', 'near', 'far']);
  });

  it('keeps a dense gallery idle until a target is engaged', () => {
    const policy = new GlyphLeasePolicy<string>();

    expect(policy.rank(targets, 'pointer')).toEqual([]);
    policy.engage('far', 10);
    policy.engage('near', 20);

    expect(policy.rank(targets, 'pointer').map(([key]) => key)).toEqual(['near', 'far']);
  });

  it('drops engagements once their proxies leave the viewport', () => {
    const policy = new GlyphLeasePolicy<string>();
    policy.engage('centre', 10);
    policy.engage('near', 20);

    policy.retain(['centre']);

    expect(policy.rank(targets, 'pointer').map(([key]) => key)).toEqual(['centre']);
  });

  it('promotes a just-interacted target without losing stable leases', () => {
    const policy = new GlyphLeasePolicy<string>();
    policy.engage('centre', 20);
    policy.engage('near', 10);

    expect(policy.rank(targets, 'pointer', 'near').map(([key]) => key)).toEqual(['near', 'centre']);
  });
});
