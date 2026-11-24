/* @workflow {
  "name": "hero:capture",
  "summary": "Step the Glyph Hero a frame at a time in GPU Chromium, saving frames, a video, and GPU frame times per beat.",
  "requirements": "Workspace dependencies, built Glyph Wasm artifacts, baked hero fonts, Playwright's Chromium with WebGPU, and ffmpeg for the video.",
  "writes": "Frames, <scenario>.mp4 and <scenario>.json under --out (default /Volumes/Depot/Developer/glyph-scratch/hero/capture)",
  "args": ["--scenario", "attract", "--tier", "full"]
} */
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';

import type { installProbe } from '../src/probe.ts';

const { values } = parseArgs({
  options: {
    scenario: { type: 'string', default: 'attract' },
    tier: { type: 'string', default: 'full' },
    out: { type: 'string', default: '/Volumes/Depot/Developer/glyph-scratch/hero/capture' },
    width: { type: 'string', default: '1600' },
    height: { type: 'string', default: '900' },
    /** Frames of video a second. The hero always steps at sixty. */
    fps: { type: 'string', default: '30' },
    /** Keep one frame in this many as a still, besides the video. */
    stills: { type: 'string', default: '90' },
    seconds: { type: 'string' },
    /** Save frames only from this playback second on. */
    from: { type: 'string', default: '0' },
    still: { type: 'boolean', default: false },
    /** Let the display's clock run the hero and only measure: no frames are saved. */
    realtime: { type: 'boolean', default: false },
    'no-video': { type: 'boolean', default: false },
  },
});

type Probe = typeof window & {
  heroProbe: {
    actions: ReturnType<typeof import('../src/actions.ts').actions>;
    hold(): void;
    step(frames: number): Promise<number>;
    read(): Record<string, string | number | boolean>;
  };
};
// The probe's type is the script's contract with the page.
type _Installed = typeof installProbe;

/** What each scenario does, as commands at playback seconds, and how long it runs. */
interface Scenario {
  readonly seconds: number;
  /** Named spans of playback seconds, for the per-beat frame times. */
  readonly beats: readonly (readonly [name: string, from: number, to: number])[];
  readonly cues: readonly (readonly [at: number, run: string])[];
}

const drag = (from: readonly [number, number], to: readonly [number, number], at: number, seconds: number) => {
  const cues: [number, string][] = [[at, `a.pressPage(${from[0]}, ${from[1]})`]];
  const steps = Math.round(seconds * 30);

  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const eased = t * t * (3 - 2 * t);
    cues.push([
      at + (seconds * step) / steps,
      `a.dragPage(${from[0] + (to[0] - from[0]) * eased}, ${from[1] + (to[1] - from[1]) * eased})`,
    ]);
  }

  cues.push([at + seconds + 0.02, 'a.releasePage()']);

  return cues;
};

const SCENARIOS: Record<string, Scenario> = {
  // The attract loop, start to the cut back to the caret.
  attract: {
    seconds: 62,
    beats: [
      ['caret', 0, 5],
      ['spread', 5, 13],
      ['columns', 13, 25],
      ['stone', 25, 37],
      ['rewind', 37, 41],
      ['edit', 41, 52],
      ['dive', 52, 62],
    ],
    cues: [],
  },
  // The visitor's page: gutters and the edge dragged, the stone flung, a click and typing, the wheel.
  interact: {
    seconds: 40,
    beats: [
      ['handover', 0, 3],
      ['gutter', 3, 11],
      ['edge', 11, 16],
      ['fling', 16, 26],
      ['type', 26, 33],
      ['scroll', 33, 40],
    ],
    cues: [
      [0.5, 'a.pressKey(" ")'],
      // The first gutter, pulled right to two columns, then left to four.
      ...drag([11.6, 15], [16.2, 15.4], 3, 2.2),
      ...drag([16.2, 15], [8.6, 15.5], 6.4, 2.6),
      // The page's edge, in and back out.
      ...drag([29.6, 14], [22.5, 14.5], 11, 2),
      ...drag([22.5, 14], [29.6, 14.5], 13.4, 1.8),
      // The stone, dragged through the text and flung.
      ...drag([24.4, 21], [9, 13], 16.5, 1.6),
      [22.5, 'a.rewindStone()'],
      // A click in the first column, and typing.
      [26.5, 'a.pressPage(5.2, 13.1)'],
      [26.55, 'a.releasePage()'],
      ...Array.from('Typed live.', (character, index): [number, string] => [
        27.2 + index * 0.16,
        `a.pressKey(${JSON.stringify(character)})`,
      ]),
      [30, 'a.pressKey("Backspace")'],
      [30.2, 'a.pressKey("Backspace")'],
      // A click inside the Arabic specimen.
      [31, 'a.pressPage(35.2, 10.25)'],
      [31.05, 'a.releasePage()'],
      [31.8, 'a.pressKey("ArrowLeft")'],
      // The wheel, into the drop cap.
      ...Array.from({ length: 30 }, (_, index): [number, string] => [33.5 + index * 0.12, 'a.scrollPage(30)']),
    ],
  },
};

const scenario = SCENARIOS[values.scenario];

if (scenario === undefined) throw new Error(`unknown scenario ${values.scenario}`);

const seconds = values.seconds === undefined ? scenario.seconds : Number(values.seconds);
const fps = Number(values.fps);
const out = join(
  values.out,
  `${values.scenario}-${values.tier}${values.still ? '-still' : ''}${values.realtime ? '-realtime' : ''}`,
);
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'frames'), { recursive: true });

const server = await createServer({
  root: new URL('..', import.meta.url).pathname,
  server: { port: 5312, host: '127.0.0.1' },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const failures: string[] = [];

try {
  const page: Page = await browser.newPage({
    viewport: { width: Number(values.width), height: Number(values.height) },
    deviceScaleFactor: 1,
    reducedMotion: values.still ? 'reduce' : 'no-preference',
  });
  page.on('console', (message) => {
    // Three renames the locals of a Slug integral evaluated a second time in one shader, and says so each time.
    if (message.text().includes('already in use. Renamed to')) return;

    if (message.type() === 'error' || message.type() === 'warning') {
      failures.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  await page.goto(`http://127.0.0.1:5312/?probe&dpr=1&tier=${values.tier}`);
  await page.waitForFunction(
    () => document.documentElement.dataset.heroState === 'ready' && 'heroProbe' in window,
    undefined,
    { timeout: 120_000 },
  );
  const adapter = await page.evaluate(async () => {
    const found = await navigator.gpu.requestAdapter();

    return found === null ? 'none' : `${found.info.vendor} ${found.info.architecture} ${found.info.description}`;
  });
  const samples: { at: number; gpuMs: number; stepMs: number; reflowMs: number; bodies: number; moving: number }[] = [];
  let last: Record<string, string | number | boolean> = {};

  if (values.realtime) {
    // The display's clock runs the hero. Each animation frame reads the GPU's time for the frame before it.
    const run = await page.evaluate(
      async ({ cues, length }) => {
        const probe = (window as Probe).heroProbe;
        const a = probe.actions;
        const start = Number(probe.read().elapsed);
        const taken: { at: number; gpuMs: number; stepMs: number; reflowMs: number; bodies: number; moving: number }[] =
          [];
        let cue = 0;
        let previous = performance.now();
        let state = probe.read();

        while (Number(state.elapsed) - start < length) {
          await new Promise(requestAnimationFrame);
          const now = performance.now();
          const gpuMs = await probe.step(0);
          state = probe.read();
          const at = Number(state.elapsed) - start;

          while (cue < cues.length && cues[cue]![0] <= at) new Function('a', cues[cue++]![1])(a);

          taken.push({
            at,
            gpuMs,
            stepMs: now - previous,
            reflowMs: Number(state.reflowMs),
            bodies: Number(state.bodies),
            moving: Number(state.moving),
          });
          previous = now;
        }

        return { taken, state };
      },
      { cues: [...scenario.cues].sort((left, right) => left[0] - right[0]), length: seconds },
    );
    samples.push(...run.taken);
    last = run.state;
  } else {
    await page.evaluate(() => (window as Probe).heroProbe.hold());
    // The cover fades on the display's clock, which is not running here.
    await page.addStyleTag({ content: '.hero-cover { display: none }' });
    const canvas = page.locator('canvas');
    const cues = [...scenario.cues].sort((left, right) => left[0] - right[0]);
    const stepsPerFrame = 60 / fps;
    const stills = Number(values.stills);
    let cue = 0;

    for (let frame = 0; frame < seconds * fps; frame++) {
      const at = frame / fps;
      const due: string[] = [];

      while (cue < cues.length && cues[cue]![0] <= at) due.push(cues[cue++]![1]);

      const result = await page.evaluate(
        async ({ commands, steps }) => {
          const probe = (window as Probe).heroProbe;
          const a = probe.actions;

          // Each cue is one director command, named here by the scenario.
          for (const command of commands) new Function('a', command)(a);

          const before = performance.now();
          const gpuMs = await probe.step(steps);

          return { gpuMs, stepMs: (performance.now() - before) / steps, state: probe.read() };
        },
        { commands: due, steps: stepsPerFrame },
      );
      last = result.state;
      samples.push({
        at,
        gpuMs: result.gpuMs,
        stepMs: result.stepMs,
        reflowMs: Number(result.state.reflowMs),
        bodies: Number(result.state.bodies),
        moving: Number(result.state.moving),
      });

      if (result.state.textAgrees !== true) failures.push(`text and script disagree at ${at.toFixed(2)} s`);

      if (at >= Number(values.from) && (!values['no-video'] || frame % stills === 0)) {
        await canvas.screenshot({
          path: join(out, 'frames', `${String(frame).padStart(5, '0')}.jpg`),
          type: 'jpeg',
          quality: 92,
        });
      }

      if (frame % (fps * 5) === 0) {
        console.log(
          `${at.toFixed(0).padStart(3)} s  ${String(result.state.shot).padEnd(8)} gpu ${result.gpuMs.toFixed(2)} ms  step ${result.stepMs.toFixed(2)} ms  bodies ${result.state.bodies}  moving ${result.state.moving}`,
        );
      }
    }
  }

  const percentile = (numbers: number[], fraction: number) => {
    const sorted = [...numbers].sort((left, right) => left - right);

    return Number((sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0).toFixed(2));
  };
  const beats = scenario.beats.map(([name, from, to]) => {
    const within = samples.filter((sample) => sample.at >= from && sample.at < to);

    return {
      beat: name,
      gpuP50: percentile(
        within.map((sample) => sample.gpuMs),
        0.5,
      ),
      gpuP95: percentile(
        within.map((sample) => sample.gpuMs),
        0.95,
      ),
      frameP50: percentile(
        within.map((sample) => sample.stepMs),
        0.5,
      ),
      frameP95: percentile(
        within.map((sample) => sample.stepMs),
        0.95,
      ),
      reflowMax: percentile(
        within.map((sample) => sample.reflowMs),
        1,
      ),
      bodiesMax: Math.max(0, ...within.map((sample) => sample.bodies)),
    };
  });
  console.table(beats);
  await writeFile(
    join(out, 'report.json'),
    `${JSON.stringify({ scenario: values.scenario, tier: values.tier, still: values.still, adapter, size: [Number(values.width), Number(values.height)], beats, end: last, failures }, undefined, 2)}\n`,
  );

  if (!values['no-video'] && !values.realtime) {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-framerate',
        String(fps),
        '-i',
        join(out, 'frames', '%05d.jpg'),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '18',
        join(out, `${values.scenario}-${values.tier}.mp4`),
      ],
      { stdio: 'inherit' },
    );
  }

  console.log(`adapter: ${adapter}`);
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) {
  console.error([...new Set(failures)].join('\n'));
  process.exit(1);
}
