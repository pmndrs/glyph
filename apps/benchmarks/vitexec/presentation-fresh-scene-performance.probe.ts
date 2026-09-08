/* @workflow { "name": "benchmark:presentation-fresh-scene-performance", "summary": "Measure selected Presentation workloads in independent scene-local telemetry windows.", "requirements": "GPU-enabled Chromium and authenticated benchmark fixtures.", "writes": "Standard output only.", "args": ["--gpu", "--path", "/?rounds=7", "--timeout", "300"] } */

export {};

interface FreshSceneSample {
  readonly cpuMs: number;
  readonly draws: number;
  readonly frames: number;
  readonly glyphs: number;
  readonly gpuFrames: number;
  readonly gpuMs: number;
  readonly round: number;
  readonly workload: string;
}

const workloads = ['off-axis-3d', 'dynamic-layout', 'paint-effects', 'icon-grid', 'rich-text'] as const;
const roundsParameter = Number(new URL(location.href).searchParams.get('rounds') ?? '7');
if (!Number.isSafeInteger(roundsParameter) || roundsParameter <= 0 || roundsParameter > 20) {
  throw new RangeError('fresh-scene rounds must be an integer in [1, 20]');
}

if (window.top !== window.self) await new Promise<never>(() => {});

const samples: FreshSceneSample[] = [];
for (let round = 0; round < roundsParameter; round += 1) {
  for (let offset = 0; offset < workloads.length; offset += 1) {
    const workload = workloads[(round + offset) % workloads.length]!;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0';
    iframe.src = `/presentation?mode=benchmark&technique=bitmap&backend=webgpu&delivery=baked&dpr=2&font=inter&workload=${workload}`;
    document.body.append(iframe);
    try {
      const viewport = await waitFor(() => {
        const candidate = iframe.contentDocument?.querySelector<HTMLElement>(
          `[data-testid="comparison-live-viewport"][data-technique="bitmap"][data-workload="${workload}"]`,
        );
        if (candidate === null || candidate === undefined || candidate.offsetParent === null) return undefined;
        if (candidate.dataset.presentationPending !== 'false') return undefined;
        if (!(Number(candidate.dataset.framesPerSecond) > 0) || !(Number(candidate.dataset.drawCount) > 0)) {
          return undefined;
        }
        if (candidate.dataset.missingGlyphCount !== '0') return undefined;
        return candidate;
      });
      const child = iframe.contentWindow;
      if (child === null) throw new Error('fresh-scene iframe lost its window');
      await waitFrames(child, 30);
      const startingFrames = Number(viewport.dataset.submitHistoryLength);
      await waitFor(() =>
        Number(viewport.dataset.submitHistoryLength) >= startingFrames + 120 &&
        Number(viewport.dataset.gpuHistoryLength) >= 120
          ? true
          : undefined,
      );
      const sample = {
        round,
        workload,
        cpuMs: Number(viewport.dataset.medianSubmitMs),
        gpuMs: Number(viewport.dataset.medianGpuMs),
        frames: Number(viewport.dataset.submitHistoryLength) - startingFrames,
        gpuFrames: Number(viewport.dataset.gpuHistoryLength),
        draws: Number(viewport.dataset.drawCount),
        glyphs: Number(viewport.dataset.glyphCount),
      } satisfies FreshSceneSample;
      samples.push(sample);
      console.log('fresh-scene-cell', JSON.stringify(sample));
    } finally {
      iframe.remove();
    }
    await waitFrames(window, 2);
  }
}

console.log('fresh-scene-summary', JSON.stringify({ rounds: roundsParameter, samples }));
console.log('fresh-scene-ready');

function waitFor<Value>(read: () => Value | undefined, timeoutMs = 60_000): Promise<Value> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      const value = read();
      if (value !== undefined) resolve(value);
      else if (performance.now() - started >= timeoutMs) reject(new Error('fresh scene timed out'));
      else requestAnimationFrame(poll);
    };
    poll();
  });
}

function waitFrames(target: Window, count: number): Promise<void> {
  return new Promise((resolve) => {
    const next = (): void => {
      count -= 1;
      if (count === 0) resolve();
      else target.requestAnimationFrame(next);
    };
    target.requestAnimationFrame(next);
  });
}
