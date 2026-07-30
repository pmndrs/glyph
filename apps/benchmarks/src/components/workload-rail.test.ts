import { describe, expect, it } from 'vitest';
import { workloadScrollEdges } from '../benchmark/workloads';

describe('workload rail scroll edges', () => {
  it('marks only the edges with additional content', () => {
    expect(workloadScrollEdges({ clientHeight: 200, scrollHeight: 500, scrollTop: 0 })).toEqual({
      before: false,
      after: true,
    });
    expect(workloadScrollEdges({ clientHeight: 200, scrollHeight: 500, scrollTop: 120 })).toEqual({
      before: true,
      after: true,
    });
    expect(workloadScrollEdges({ clientHeight: 200, scrollHeight: 500, scrollTop: 300 })).toEqual({
      before: true,
      after: false,
    });
  });

  it('hides both fades when the workload list fits', () => {
    expect(workloadScrollEdges({ clientHeight: 500, scrollHeight: 300, scrollTop: 0 })).toEqual({
      before: false,
      after: false,
    });
  });
});
