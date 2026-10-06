#!/usr/bin/env node
// Local A/B visual tour of pending pmndrs/glyph pull requests. Node 22, no npm dependencies.
//
//   node spikes/visual-tour/tour.mjs [--prs 256,234,227,229,240,235] [--base main] [--workloads editorial,zoom-text]
//     [--backends webgpu,webgl2] [--techniques bitmap,msdf,slug] [--times 0,2500] [--dpr 2]
//     [--keep] [--skip-build] [--full-build] [--recapture] [--noise] [--software] [--chromium <path>]
//     [--capture tour|probe] [--run <name>] [--open | --serve] [--port 5179]
//
// Per PR: fetch pull/<n>/head, read the base branch from the GitHub API, build A (merge base with that branch) and B
// (head) in worktrees under .work/<sha>/, capture the same Presentation scenes with both, diff them, and write
// out/<run>/report.json and out/<run>/index.html. See README.md for the full checklist.
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SOFTWARE_FLAGS, WORKLOADS } from './capture.mjs';
import { decodePng, diffImages, encodePng } from './png.mjs';
import { renderReport } from './report.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../..');
const workRoot = join(here, '.work');
const REPOSITORY = 'pmndrs/glyph';

/** Built-in "what to look at" notes; spikes/visual-tour/prs.json overrides them per PR number. */
const DEFAULT_NOTES = {
  256: {
    topic: 'Slug dilation',
    expect: 'change',
    note:
      'Edge pixels on wide, short glyphs (dashes, underscores) and tall, narrow glyphs (i, l) at small sizes, on Slug. ' +
      'Expect B to keep antialiased fringes that A clips, and WebGPU and WebGL2 to agree more closely. ' +
      'Bitmap and MSDF should be identical.',
  },
  234: {
    topic: 'TextGroup batch boundaries',
    expect: 'identical',
    note: 'Grouping and visibility toggles. Pixels should be identical unless a workload hides groups.',
  },
  227: {
    topic: 'Retain transforms for patch-only publication',
    expect: 'identical',
    note: 'Pixels should be identical; any difference is a regression.',
  },
  229: {
    topic: 'TypeGPU position updates',
    expect: 'identical',
    note:
      'Pixels should be identical; any difference is a regression. The default capture uses the TSL shader path, so ' +
      'this tour only proves the Three adapter side is unchanged.',
  },
  240: {
    topic: 'Publish pending layout on read',
    expect: 'identical',
    note: 'Pixels should be identical; any difference is a regression.',
  },
  235: {
    topic: 'Glyph outlines',
    expect: 'identical',
    note: 'Pixels should be identical; outlines are opt-in.',
  },
};
const OUTLINE_REMINDER =
  'The outline-format A/B (V0 curve texels vs shared outline points) is not in this tour: it lives in ' +
  'spikes/outline-stream (node spikes/outline-stream/prepare.mjs, then node spikes/outline-stream/serve.mjs).';
const PROBE_MASKS = [
  // The stock probe screenshots the whole page: telemetry panel and size badges change between runs and builds.
  [816, 32, 432, 240],
  [536, 644, 712, 46],
];

// ---- arguments -------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = argv[index + 1];
  if (next === undefined || next.startsWith('--')) throw new Error(`--${name} needs a value`);
  return next;
};
const list = (name, fallback) =>
  value(name, fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

if (flag('help') || flag('h')) {
  const source = await readFile(fileURLToPath(import.meta.url), 'utf8');
  console.log(source.split('\n').slice(1, 11).join('\n').replaceAll('// ', '').replaceAll('//', ''));
  process.exit(0);
}

const options = {
  prs: list('prs', '256,234,227,229,240,235').map(Number),
  base: value('base', 'main'),
  workloads: list('workloads', WORKLOADS.map(([id]) => id).join(',')),
  backends: list('backends', 'webgpu,webgl2'),
  techniques: list('techniques', 'bitmap,msdf,slug').map((technique) => (technique === 'msdf' ? 'mtsdf' : technique)),
  times: list('times', '0,2500').map(Number),
  dpr: Number(value('dpr', '2')),
  capture: value('capture', 'tour'),
  keep: flag('keep'),
  skipBuild: flag('skip-build'),
  fullBuild: flag('full-build'),
  recapture: flag('recapture'),
  noise: flag('noise'),
  software: flag('software'),
  chromium: value('chromium', process.env.PMNDRS_GLYPH_CHROMIUM_EXECUTABLE_PATH ?? ''),
  run: value('run', new Date().toISOString().replaceAll(':', '').replace(/\..*/, '').replace('T', '-')),
  open: flag('open'),
  serve: flag('serve') || flag('open'),
  port: Number(value('port', process.env.PORT ?? '5179')),
};
const knownWorkloads = new Set(WORKLOADS.map(([id]) => id));
for (const workload of options.workloads)
  if (!knownWorkloads.has(workload)) throw new Error(`unknown workload ${workload}`);
for (const backend of options.backends)
  if (!['webgpu', 'webgl2'].includes(backend)) throw new Error(`bad backend ${backend}`);
for (const technique of options.techniques) {
  if (!['bitmap', 'mtsdf', 'slug'].includes(technique)) throw new Error(`bad technique ${technique}`);
}
if (!['tour', 'probe'].includes(options.capture)) throw new Error('--capture must be tour or probe');
if (options.prs.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error('--prs takes PR numbers');

const outDir = join(here, 'out', options.run);
const hasMise = spawnSync('mise', ['--version'], { stdio: 'ignore' }).status === 0;
const pnpmCommand = hasMise ? ['mise', 'exec', '--', 'pnpm'] : ['pnpm'];
const variant = `${options.capture}-${options.software ? 'swiftshader' : 'gpu'}-dpr${options.dpr}`;

// ---- processes ---------------------------------------------------------------------------------------------------
function git(...args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

/** Runs a command with output teed to a log file; resolves with the duration, rejects with the log's tail. */
async function run(command, args, { cwd, log, env }) {
  await mkdir(join(workRoot, 'logs'), { recursive: true });
  const logPath = join(workRoot, 'logs', log);
  const started = Date.now();
  const { createWriteStream } = await import('node:fs');
  const stream = createWriteStream(logPath);
  stream.write(`$ (cd ${cwd} && ${[command, ...args].join(' ')})\n`);
  let tail = '';
  const code = await new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const take = (chunk) => {
      stream.write(chunk);
      tail = (tail + chunk.toString()).slice(-4000);
      if (process.env.TOUR_VERBOSE) process.stdout.write(chunk);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.once('error', fail);
    child.once('close', done);
  });
  await new Promise((done) => stream.end(done));
  const ms = Date.now() - started;
  if (code !== 0) {
    const error = new Error(`${command} ${args.join(' ')} exited ${code} (log: ${relative(repo, logPath)})`);
    error.tail = tail.split('\n').slice(-25).join('\n');
    error.log = relative(repo, logPath);
    throw error;
  }
  return { ms, log: relative(repo, logPath) };
}

const seconds = (ms) => `${(ms / 1000).toFixed(0)}s`;
const short = (sha) => sha.slice(0, 8);

// ---- GitHub ------------------------------------------------------------------------------------------------------
async function githubJson(path) {
  const url = `https://api.github.com/repos/${REPOSITORY}/${path}`;
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'glyph-visual-tour' };
  const token = process.env.GITHUB_TOKEN;
  for (const auth of token ? [true, false] : [false]) {
    const requestHeaders = auth ? { ...headers, authorization: `Bearer ${token}` } : headers;
    try {
      const response = await fetch(url, { headers: requestHeaders, signal: AbortSignal.timeout(20_000) });
      if (response.ok) return await response.json();
      if (auth && (response.status === 401 || response.status === 403)) continue;
      throw new Error(`GitHub ${response.status} for ${path}`);
    } catch (error) {
      // Node's fetch ignores HTTPS_PROXY; curl honours it, so behind a proxy fall back to curl.
      const curl = spawnSync(
        'curl',
        ['-sSf', '-m', '20', ...Object.entries(requestHeaders).flatMap(([k, v]) => ['-H', `${k}: ${v}`]), url],
        { encoding: 'utf8' },
      );
      if (curl.status === 0) return JSON.parse(curl.stdout);
      if (auth) continue;
      throw error;
    }
  }
  throw new Error(`GitHub request failed for ${path}`);
}

async function loadNotes() {
  const path = join(here, 'prs.json');
  if (!existsSync(path)) return DEFAULT_NOTES;
  const overrides = JSON.parse(await readFile(path, 'utf8'));
  const merged = { ...DEFAULT_NOTES };
  for (const [number, entry] of Object.entries(overrides)) merged[number] = { ...merged[number], ...entry };
  return merged;
}

// ---- worktrees and builds ----------------------------------------------------------------------------------------
const built = new Map();

async function readState(sha) {
  return readFile(join(workRoot, 'state', `${sha}.json`), 'utf8').then(JSON.parse, () => ({}));
}

async function writeState(sha, state) {
  await mkdir(join(workRoot, 'state'), { recursive: true });
  await writeFile(join(workRoot, 'state', `${sha}.json`), `${JSON.stringify(state, null, 2)}\n`);
}

/** Creates, installs and builds the worktree for one commit, once per run and once per SHA across runs. */
function prepare(sha) {
  if (!built.has(sha)) built.set(sha, prepareOnce(sha));
  return built.get(sha);
}

async function prepareOnce(sha) {
  const tree = join(workRoot, sha);
  const state = await readState(sha);
  const steps = [];
  if (!existsSync(join(tree, '.git'))) {
    if (options.skipBuild)
      return { tree, ok: false, steps, error: `--skip-build, but ${relative(repo, tree)} does not exist` };
    git('worktree', 'add', '--detach', tree, sha);
    delete state.build;
  }
  if (options.skipBuild) return { tree, ok: true, steps, skipped: true };
  if (state.build?.ok && state.build.fullBuild === options.fullBuild) {
    console.log(`  ${short(sha)} already built (${state.build.at})`);
    return { tree, ok: true, steps, cached: true };
  }
  const plan = [
    ['lfs', 'git', ['lfs', 'pull']],
    ['install', pnpmCommand[0], [...pnpmCommand.slice(1), 'install', '--frozen-lockfile']],
    [
      'build',
      pnpmCommand[0],
      [...pnpmCommand.slice(1), ...(options.fullBuild ? ['build'] : ['--filter', '@pmndrs/glyph', 'build'])],
    ],
  ];
  for (const [name, command, args] of plan) {
    process.stdout.write(`  ${short(sha)} ${name}… `);
    try {
      const result = await run(command, args, { cwd: tree, log: `${sha}-${name}.log` });
      steps.push({ name, ok: true, ...result });
      console.log(seconds(result.ms));
    } catch (error) {
      console.log('FAILED');
      steps.push({ name, ok: false, error: error.message, log: error.log, tail: error.tail });
      await writeState(sha, { ...state, build: { ok: false, at: new Date().toISOString(), steps } });
      return { tree, ok: false, steps, error: `${name} failed: ${error.message}`, tail: error.tail };
    }
  }
  await writeState(sha, {
    ...state,
    build: { ok: true, fullBuild: options.fullBuild, at: new Date().toISOString(), steps },
  });
  return { tree, ok: true, steps };
}

// ---- capture -----------------------------------------------------------------------------------------------------
async function chromiumWrapper(tree) {
  // The stock probe hard-codes its Chromium flags but honours PMNDRS_GLYPH_CHROMIUM_EXECUTABLE_PATH, so software
  // rendering goes through a wrapper executable that appends the SwiftShader flags.
  let browser = options.chromium;
  if (browser === '') {
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import('playwright').then(({ chromium }) => console.log(chromium.executablePath()))",
      ],
      { cwd: join(tree, 'benches'), encoding: 'utf8' },
    );
    browser = probe.stdout.trim();
  }
  if (!existsSync(browser)) {
    throw new Error(
      `Chromium not found at ${JSON.stringify(browser)}; install it with playwright or pass --chromium <path>`,
    );
  }
  const wrapper = join(workRoot, 'chromium-swiftshader.sh');
  await writeFile(
    wrapper,
    `#!/bin/sh\nexec ${JSON.stringify(browser)} "$@" --enable-unsafe-webgpu ${SOFTWARE_FLAGS.join(' ')}\n`,
  );
  await chmod(wrapper, 0o755);
  return wrapper;
}

function sceneKey(backend, technique, workload, time) {
  return `${backend}-${technique}-${workload}-t${time}`;
}

/** Captures one build for every backend × technique, reusing cached images for this SHA and capture variant. */
async function captureBuild(sha, tree, tag) {
  const results = new Map();
  const errors = [];
  for (const backend of options.backends) {
    for (const technique of options.techniques) {
      const dir = join(workRoot, 'captures', sha, tag, `${backend}-${technique}`);
      const manifestPath = join(dir, 'manifest.json');
      const manifest = await readFile(manifestPath, 'utf8').then(JSON.parse, () => ({ scenes: [] }));
      const have = (workload, time) =>
        manifest.scenes.find((scene) => scene.workload === workload && scene.time === time && scene.file !== undefined);
      const times = options.capture === 'probe' ? ['soak'] : options.times;
      const missing = options.recapture
        ? options.workloads
        : options.workloads.filter((workload) => times.some((time) => have(workload, time) === undefined));
      if (missing.length > 0) {
        if (!existsSync(join(tree, 'benches', 'node_modules'))) {
          errors.push(`${backend}/${technique}: worktree ${relative(repo, tree)} is not installed`);
        } else {
          process.stdout.write(`  ${short(sha)} capture ${backend}/${technique} (${missing.length} workloads)… `);
          try {
            const result =
              options.capture === 'probe'
                ? await captureWithProbe(tree, dir, backend, technique, missing, sha)
                : await run(
                    process.execPath,
                    [
                      join(here, 'capture.mjs'),
                      '--out',
                      dir,
                      '--backend',
                      backend,
                      '--technique',
                      technique,
                      '--workloads',
                      missing.join(','),
                      '--times',
                      options.times.join(','),
                      '--dpr',
                      String(options.dpr),
                      ...(options.software ? ['--software'] : []),
                    ],
                    {
                      cwd: join(tree, 'benches'),
                      log: `${sha}-${tag}-${backend}-${technique}.log`,
                      env: options.chromium ? { PMNDRS_GLYPH_CHROMIUM_EXECUTABLE_PATH: options.chromium } : {},
                    },
                  );
            console.log(seconds(result.ms));
          } catch (error) {
            console.log('FAILED');
            errors.push(`${backend}/${technique}: ${error.message}\n${error.tail ?? ''}`);
          }
        }
      }
      const fresh = await readFile(manifestPath, 'utf8').then(JSON.parse, () => ({ scenes: [] }));
      if (fresh.error) errors.push(`${backend}/${technique}: ${fresh.error}`);
      if (fresh.pageErrors?.length) {
        errors.push(
          `${backend}/${technique}: ${fresh.pageErrors.length} page error(s), first: ${fresh.pageErrors[0].split('\n')[0]}`,
        );
      }
      for (const workload of options.workloads) {
        for (const time of times) {
          const scene = fresh.scenes.find((entry) => entry.workload === workload && entry.time === time);
          results.set(sceneKey(backend, technique, workload, time), {
            backend,
            technique,
            workload,
            time,
            path: scene?.file ? join(dir, scene.file) : undefined,
            glyphCount: scene?.glyphCount,
            drawCount: scene?.drawCount,
            error: scene?.error ?? (scene === undefined ? 'not captured' : undefined),
          });
        }
      }
    }
  }
  return { results, errors };
}

/** `benchmark:presentation-screenshots` for one backend × technique: the worktree's own probe, unmodified. */
async function captureWithProbe(tree, dir, backend, technique, workloads, sha) {
  await mkdir(dir, { recursive: true });
  const env = {
    PRESENTATION_SCREENSHOT_DIR: dir,
    PRESENTATION_BACKEND: backend,
    PRESENTATION_TECHNIQUE: technique,
    ...(workloads.length === 1 ? { PRESENTATION_WORKLOAD: workloads[0] } : {}),
    ...(options.software
      ? { PMNDRS_GLYPH_CHROMIUM_EXECUTABLE_PATH: await chromiumWrapper(tree) }
      : options.chromium
        ? { PMNDRS_GLYPH_CHROMIUM_EXECUTABLE_PATH: options.chromium }
        : {}),
  };
  const scenes = [];
  let result;
  let failure;
  try {
    result = await run(process.execPath, [join(tree, 'benches/scripts/run-presentation-workload-probe.mts')], {
      cwd: join(tree, 'benches'),
      log: `${sha}-probe-${backend}-${technique}.log`,
      env,
    });
  } catch (error) {
    failure = error;
  }
  for (const workload of options.workloads) {
    const file = `${backend}-${technique}-${workload}.png`;
    scenes.push(
      existsSync(join(dir, file))
        ? { workload, time: 'soak', file }
        : { workload, time: 'soak', error: failure?.message ?? 'probe wrote no screenshot' },
    );
  }
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify({ capture: 'probe', scenes }, null, 2)}\n`);
  if (failure) throw failure;
  return result;
}

// ---- diff --------------------------------------------------------------------------------------------------------
async function loadImage(path) {
  return decodePng(await readFile(path));
}

function numbers(diff) {
  if (diff.sizeMismatch) return { sizeMismatch: diff.sizeMismatch };
  const { heatmap: _heatmap, ...rest } = diff;
  return { ...rest, meanAbs: Number(rest.meanAbs.toFixed(5)), over1Fraction: Number(rest.over1Fraction.toFixed(6)) };
}

function verdict(diff) {
  if (diff === undefined) return 'missing';
  if (diff.sizeMismatch) return 'size-mismatch';
  if (diff.maxAbs === 0) return 'identical';
  if (diff.over1 === 0) return 'rounding';
  return 'changed';
}

// ---- main --------------------------------------------------------------------------------------------------------
const notes = await loadNotes();
await mkdir(join(outDir, 'img'), { recursive: true });
console.log(
  `visual tour ${options.run}: PRs ${options.prs.join(', ')}; ${options.backends.join('+')} × ${options.techniques.join('+')} × ${options.workloads.length} workloads × times ${options.capture === 'probe' ? 'soak' : options.times.join(',')} (${variant})`,
);
console.log(`using ${pnpmCommand.join(' ')}${hasMise ? '' : ' (mise not on PATH)'}`);

// Resolve every PR first so stacked bases can name the PR that owns their base branch.
const resolved = [];
for (const number of options.prs) {
  const entry = {
    number,
    notes: notes[number] ?? { note: 'No notes for this PR; add one in spikes/visual-tour/prs.json.' },
  };
  resolved.push(entry);
  try {
    let meta;
    try {
      meta = await githubJson(`pulls/${number}`);
    } catch (error) {
      entry.warnings = [`GitHub API unavailable (${error.message}); using --base ${options.base}`];
    }
    entry.title = meta?.title ?? `PR #${number}`;
    entry.url = meta?.html_url ?? `https://github.com/${REPOSITORY}/pull/${number}`;
    entry.state = meta?.state;
    entry.author = meta?.user?.login;
    entry.baseRef = meta?.base?.ref ?? options.base;
    entry.headRef = meta?.head?.ref;
    entry.headRepo = meta?.head?.repo?.full_name;
    entry.defaultBranch = meta?.base?.repo?.default_branch ?? 'main';
    git('fetch', '--quiet', 'origin', `+refs/pull/${number}/head`);
    entry.head = git('rev-parse', 'FETCH_HEAD');
    git('fetch', '--quiet', 'origin', `+refs/heads/${entry.baseRef}`);
    entry.baseTip = git('rev-parse', 'FETCH_HEAD');
    entry.base = git('merge-base', entry.head, entry.baseTip);
    if (meta?.head?.sha && meta.head.sha !== entry.head) {
      (entry.warnings ??= []).push(`API head ${short(meta.head.sha)} differs from fetched ${short(entry.head)}`);
    }
  } catch (error) {
    entry.error = `resolve failed: ${error.message}`;
  }
}
for (const entry of resolved) {
  if (entry.error) continue;
  entry.stacked = entry.baseRef !== entry.defaultBranch;
  const owner = resolved.find((other) => other.headRef === entry.baseRef);
  entry.stackedOn = owner?.number;
  const against = entry.stacked
    ? `STACKED: compares against its base branch ${entry.baseRef}${owner ? ` (PR #${owner.number})` : ''}, not ${entry.defaultBranch}, so the diff shows only this PR's change`
    : `base ${entry.baseRef}`;
  console.log(
    `#${entry.number} ${entry.title}\n  A ${short(entry.base)} (merge base with ${entry.baseRef} @ ${short(entry.baseTip)})  B ${short(entry.head)}\n  ${against}`,
  );
}

const report = {
  run: options.run,
  createdAt: new Date().toISOString(),
  repository: REPOSITORY,
  options: { ...options, chromium: options.chromium || undefined },
  variant,
  masks: options.capture === 'probe' ? PROBE_MASKS : [],
  outlineReminder: OUTLINE_REMINDER,
  prs: [],
};

for (const entry of resolved) {
  const pr = { ...entry, scenes: [], errors: entry.error ? [entry.error] : [] };
  delete pr.error;
  report.prs.push(pr);
  if (pr.errors.length > 0) continue;
  console.log(`\n#${pr.number}: build and capture`);
  const started = Date.now();
  try {
    const builds = {};
    for (const [side, sha] of [
      ['a', pr.base],
      ['b', pr.head],
    ]) {
      const build = await prepare(sha);
      builds[side] = build;
      pr[`build${side.toUpperCase()}`] = {
        ok: build.ok,
        cached: build.cached,
        skipped: build.skipped,
        steps: build.steps,
      };
      if (!build.ok)
        pr.errors.push(`${side.toUpperCase()} (${short(sha)}) ${build.error}${build.tail ? `\n${build.tail}` : ''}`);
    }
    if (!builds.a.ok && !builds.b.ok) continue;
    const captureA = await captureBuild(pr.base, builds.a.tree, variant);
    const captureB = await captureBuild(pr.head, builds.b.tree, variant);
    const captureRepeat = options.noise ? await captureBuild(pr.base, builds.a.tree, `${variant}-repeat`) : undefined;
    pr.errors.push(...captureA.errors.map((e) => `A: ${e}`), ...captureB.errors.map((e) => `B: ${e}`));
    if (captureRepeat) pr.errors.push(...captureRepeat.errors.map((e) => `A repeat: ${e}`));

    const prDir = join(outDir, 'img', `pr-${pr.number}`);
    await mkdir(prDir, { recursive: true });
    const masks = report.masks;
    for (const [key, a] of captureA.results) {
      const b = captureB.results.get(key);
      const scene = {
        key,
        backend: a.backend,
        technique: a.technique,
        workload: a.workload,
        time: a.time,
        glyphs: { a: a.glyphCount, b: b?.glyphCount },
        draws: { a: a.drawCount, b: b?.drawCount },
      };
      pr.scenes.push(scene);
      if (!a.path || !b?.path) {
        scene.error = [!a.path && `A: ${a.error}`, !b?.path && `B: ${b?.error}`].filter(Boolean).join('; ');
        scene.verdict = 'missing';
        continue;
      }
      try {
        const [imageA, imageB] = await Promise.all([loadImage(a.path), loadImage(b.path)]);
        const diff = diffImages(imageA, imageB, { masks });
        scene.diff = numbers(diff);
        scene.verdict = verdict(scene.diff);
        await copyFile(a.path, join(prDir, `${key}-a.png`));
        await copyFile(b.path, join(prDir, `${key}-b.png`));
        scene.images = { a: `img/pr-${pr.number}/${key}-a.png`, b: `img/pr-${pr.number}/${key}-b.png` };
        if (diff.heatmap) {
          await writeFile(join(prDir, `${key}-diff.png`), encodePng(diff.heatmap));
          scene.images.diff = `img/pr-${pr.number}/${key}-diff.png`;
        }
        const repeat = captureRepeat?.results.get(key);
        if (repeat?.path) {
          const noise = diffImages(imageA, await loadImage(repeat.path), { masks });
          scene.noise = numbers(noise);
        }
      } catch (error) {
        scene.error = `diff failed: ${error.message}`;
        scene.verdict = 'missing';
      }
    }
  } catch (error) {
    pr.errors.push(`tour failed for this PR: ${error.stack ?? error.message}`);
  }
  pr.ms = Date.now() - started;
  const counts = pr.scenes.reduce((acc, scene) => ({ ...acc, [scene.verdict]: (acc[scene.verdict] ?? 0) + 1 }), {});
  pr.summary = summarize(pr);
  console.log(
    `  #${pr.number}: ${
      Object.entries(counts)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ') || 'no scenes'
    } — ${pr.summary.status}`,
  );
  await writeOutputs();
}

function summarize(pr) {
  const scenes = pr.scenes;
  const changed = scenes.filter((scene) => scene.verdict === 'changed');
  const unstable = scenes.filter((scene) => (scene.noise?.over1 ?? 0) > 0);
  const missing = scenes.filter((scene) => scene.verdict === 'missing');
  const expect = pr.notes?.expect;
  let status;
  if (scenes.length === 0) status = pr.errors.length > 0 ? 'failed' : 'no scenes';
  else if (expect === 'identical' && changed.length > 0) status = 'UNEXPECTED DIFFERENCE';
  else if (expect === 'change' && changed.length === 0 && missing.length < scenes.length)
    status = 'expected a change, saw none';
  else if (missing.length > 0) status = 'partial';
  else status = 'as expected';
  return {
    status,
    scenes: scenes.length,
    changed: changed.length,
    rounding: scenes.filter((scene) => scene.verdict === 'rounding').length,
    identical: scenes.filter((scene) => scene.verdict === 'identical').length,
    missing: missing.length,
    unstable: unstable.length,
    maxAbs: Math.max(0, ...scenes.map((scene) => scene.diff?.maxAbs ?? 0)),
    over8: scenes.reduce((sum, scene) => sum + (scene.diff?.over8 ?? 0), 0),
  };
}

async function writeOutputs() {
  for (const pr of report.prs) {
    pr.scenes.sort(
      (x, y) =>
        (y.diff?.over1 ?? -1) - (x.diff?.over1 ?? -1) ||
        (y.diff?.meanAbs ?? -1) - (x.diff?.meanAbs ?? -1) ||
        (y.diff?.maxAbs ?? -1) - (x.diff?.maxAbs ?? -1) ||
        x.key.localeCompare(y.key),
    );
  }
  await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outDir, 'index.html'), renderReport(report));
}

await writeOutputs();

if (!options.keep && !options.skipBuild) {
  for (const sha of built.keys()) {
    const tree = join(workRoot, sha);
    if (!existsSync(tree)) continue;
    spawnSync('git', ['worktree', 'remove', '--force', tree], { cwd: repo });
    await rm(tree, { recursive: true, force: true });
    const state = await readState(sha);
    delete state.build;
    await writeState(sha, state);
  }
  spawnSync('git', ['worktree', 'prune'], { cwd: repo });
  console.log(
    `\nremoved ${built.size} worktrees (pass --keep to reuse builds; captures stay cached in .work/captures)`,
  );
}

console.log(`\n${OUTLINE_REMINDER}`);
console.log(`report: ${relative(repo, join(outDir, 'index.html'))}  (${relative(repo, join(outDir, 'report.json'))})`);
for (const pr of report.prs) {
  console.log(
    `  #${pr.number} ${pr.summary?.status ?? 'failed'}${pr.errors.length ? ` — ${pr.errors.length} error(s)` : ''}`,
  );
}

if (options.serve) {
  const root = resolve(here, '..');
  const urlPath = `/${relative(root, outDir).split(sep).join('/')}/`;
  const url = await serveStatic(root, options.port, urlPath);
  console.log(`serving ${root}\nopen ${url}`);
  if (options.open) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    spawn(opener, [url], { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  }
}

function serveStatic(root, port, urlPath) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.md': 'text/plain; charset=utf-8',
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.css': 'text/css',
  };
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    let file = normalize(join(root, pathname));
    if (file !== root && !file.startsWith(root + sep)) return response.writeHead(403).end('forbidden');
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    if (!info?.isFile()) return response.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${pathname}`);
    response.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'content-length': info.size,
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => done(`http://localhost:${server.address().port}${urlPath}`));
  });
}
