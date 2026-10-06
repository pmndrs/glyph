// Renders the visual tour's report.json as one self-contained HTML page (no external assets; images are relative).

const escape = (text) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const short = (sha) => (sha ? sha.slice(0, 8) : '—');
const percent = (fraction) => (fraction === undefined ? '—' : `${(fraction * 100).toFixed(fraction < 0.001 ? 4 : 2)}%`);

const VERDICT_LABEL = {
  identical: 'identical',
  rounding: '≤ 1/255',
  changed: 'changed',
  missing: 'missing',
  'size-mismatch': 'size mismatch',
};

function sceneTitle(scene) {
  const technique = scene.technique === 'mtsdf' ? 'msdf' : scene.technique;
  const time = scene.time === 'soak' ? 'after soak' : `t = ${scene.time} ms`;
  return `${scene.workload} · ${technique} · ${scene.backend} · ${time}`;
}

function numbersTable(scene) {
  const d = scene.diff;
  if (d === undefined || d.sizeMismatch) return `<p class="error">${escape(scene.error ?? d?.sizeMismatch)}</p>`;
  const rows = [
    ['max |Δ|', `${d.maxAbs}/255`],
    ['mean |Δ|', `${d.meanAbs.toFixed(4)}/255`],
    ['px > 1/255', `${d.over1.toLocaleString()} (${percent(d.over1Fraction)})`],
    ['px > 8/255', `${d.over8.toLocaleString()} (${percent(d.over8 / d.pixels)})`],
    [
      'changed box',
      d.changedBounds
        ? `${d.changedBounds[2]}×${d.changedBounds[3]} at ${d.changedBounds[0]},${d.changedBounds[1]}`
        : '—',
    ],
    ['glyphs A / B', `${scene.glyphs?.a ?? '—'} / ${scene.glyphs?.b ?? '—'}`],
    ['draws A / B', `${scene.draws?.a ?? '—'} / ${scene.draws?.b ?? '—'}`],
  ];
  if (scene.noise && !scene.noise.sizeMismatch) {
    rows.push(['A vs A again', `max ${scene.noise.maxAbs}, px>1 ${scene.noise.over1.toLocaleString()}`]);
  }
  return `<table class="numbers">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${escape(v)}</td></tr>`).join('')}</table>`;
}

function sceneHtml(pr, scene, index) {
  const id = `pr${pr.number}-${scene.key}`;
  const unstable = (scene.noise?.over1 ?? 0) > 0;
  const images = scene.images;
  const figures = images
    ? `<div class="panels"><div class="grid">
        <figure><figcaption>A · ${escape(short(pr.base))}</figcaption><img src="${escape(images.a)}" alt="A" loading="lazy" data-role="a"></figure>
        <figure class="flip-host"><figcaption><span class="when-b">B · ${escape(short(pr.head))}</span><span class="when-a">A · ${escape(short(pr.base))} (flipped)</span></figcaption>
          <img src="${escape(images.b)}" alt="B" loading="lazy" data-role="b" class="when-b"><img src="${escape(images.a)}" alt="A" loading="lazy" class="when-a" data-role="a-flip"></figure>
        <figure><figcaption>diff heatmap</figcaption>${images.diff ? `<img src="${escape(images.diff)}" alt="diff" loading="lazy" data-role="diff">` : '<p>—</p>'}</figure>
      </div>
      <div class="loupe" hidden><canvas data-role="a"></canvas><canvas data-role="b"></canvas><canvas data-role="diff"></canvas>
        <p class="hint">4× nearest-neighbour around <span class="at"></span>. Click a panel to move, <kbd>Esc</kbd> to close.</p></div></div>`
    : `<p class="error">${escape(scene.error ?? 'no images')}</p>`;
  return `<article class="scene" id="${escape(id)}" data-index="${index}" tabindex="-1">
    <header><h3>${escape(sceneTitle(scene))}</h3>
      <span class="badge ${escape(scene.verdict)}">${escape(VERDICT_LABEL[scene.verdict] ?? scene.verdict)}</span>
      ${unstable ? '<span class="badge unstable" title="A captured twice differs: this scene is not deterministic">unstable</span>' : ''}
      ${images ? '<button type="button" class="flip">Flip A/B <kbd>space</kbd></button>' : ''}
    </header>
    <div class="body">${figures}${numbersTable(scene)}</div>
  </article>`;
}

function prHtml(pr) {
  const stacked = pr.stacked
    ? `<p class="stacked"><strong>Stacked PR.</strong> A is the merge base with <code>${escape(pr.baseRef)}</code>${pr.stackedOn ? ` (the head of #${pr.stackedOn})` : ''}, not <code>${escape(pr.defaultBranch)}</code>, so differences are this PR's change only.</p>`
    : '';
  const builds = ['A', 'B']
    .map((side) => {
      const build = pr[`build${side}`];
      if (build === undefined) return '';
      const steps = (build.steps ?? [])
        .map((step) => `${step.name} ${step.ok ? `${Math.round(step.ms / 1000)}s` : 'failed'}`)
        .join(', ');
      return `<li>${side}: ${build.ok ? 'built' : 'FAILED'}${build.cached ? ' (cached)' : ''}${build.skipped ? ' (--skip-build)' : ''}${steps ? ` — ${escape(steps)}` : ''}</li>`;
    })
    .join('');
  const errors = pr.errors?.length
    ? `<details class="errors" open><summary>${pr.errors.length} error(s)</summary>${pr.errors.map((e) => `<pre>${escape(e)}</pre>`).join('')}</details>`
    : '';
  const warnings = (pr.warnings ?? []).map((w) => `<p class="warning">${escape(w)}</p>`).join('');
  return `<section class="pr" id="pr${pr.number}">
    <h2><a href="${escape(pr.url)}">#${pr.number}</a> ${escape(pr.title)}</h2>
    <p class="shas">A <code>${escape(short(pr.base))}</code> (merge base with <code>${escape(pr.baseRef)}</code> @ <code>${escape(short(pr.baseTip))}</code>) → B <code>${escape(short(pr.head))}</code>${pr.headRef ? ` (<code>${escape(pr.headRepo ?? '')}:${escape(pr.headRef)}</code>)` : ''}</p>
    ${stacked}
    <div class="note"><strong>What to look at${pr.notes?.topic ? ` — ${escape(pr.notes.topic)}` : ''}:</strong> ${escape(pr.notes?.note)}
      ${pr.notes?.expect ? `<br><span class="expect">Expectation: ${pr.notes.expect === 'identical' ? 'identical pixels' : 'visible change'}. Status: <strong>${escape(pr.summary?.status ?? 'failed')}</strong></span>` : ''}</div>
    ${warnings}<ul class="builds">${builds}</ul>${errors}
    ${pr.scenes.map((scene, index) => sceneHtml(pr, scene, index)).join('\n')}
  </section>`;
}

function summaryHtml(report) {
  const rows = report.prs
    .map((pr) => {
      const s = pr.summary ?? {};
      const statusClass = /UNEXPECTED|failed|saw none/.test(s.status ?? 'failed')
        ? 'bad'
        : s.status === 'as expected'
          ? 'good'
          : '';
      return `<tr>
        <td><a href="#pr${pr.number}">#${pr.number}</a></td>
        <td>${escape(pr.title)}${pr.stacked ? ` <span class="badge stacked-badge">on ${escape(pr.baseRef)}</span>` : ''}</td>
        <td><code>${escape(short(pr.base))}</code> → <code>${escape(short(pr.head))}</code></td>
        <td>${escape(pr.notes?.expect ?? '—')}</td>
        <td class="${statusClass}">${escape(s.status ?? 'failed')}</td>
        <td>${s.changed ?? 0} / ${s.scenes ?? 0}</td>
        <td>${s.rounding ?? 0}</td>
        <td>${s.missing ?? 0}</td>
        <td>${s.maxAbs ?? '—'}</td>
        <td>${(s.over8 ?? 0).toLocaleString()}</td>
        <td>${pr.errors?.length ?? 0}</td>
      </tr>`;
    })
    .join('');
  return `<table class="summary"><thead><tr><th>PR</th><th>title</th><th>A → B</th><th>expect</th><th>status</th>
    <th>changed</th><th>≤1/255</th><th>missing</th><th>max |Δ|</th><th>px &gt; 8/255</th><th>errors</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const STYLE = `
:root { color-scheme: light dark; --bg: #f7f7f8; --fg: #1b1c1f; --muted: #5d6068; --panel: #ffffff; --line: #d9dbe0;
  --accent: #4b5bd8; --good: #1f7a3d; --bad: #b3261e; --warn: #9a6400; --code: #eceef2; }
@media (prefers-color-scheme: dark) { :root { --bg: #111214; --fg: #e7e8ea; --muted: #9a9ea8; --panel: #1a1b1f;
  --line: #2d2f36; --accent: #8c98ff; --good: #5ccf85; --bad: #ff7b72; --warn: #e3b341; --code: #23252b; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
main { max-width: 1680px; margin: 0 auto; padding: 16px; }
a { color: var(--accent); }
code, kbd { font: 12px ui-monospace, monospace; background: var(--code); padding: 1px 4px; border-radius: 4px; }
kbd { border: 1px solid var(--line); }
h1 { font-size: 20px; margin: 8px 0; } h2 { font-size: 18px; margin: 32px 0 4px; border-top: 1px solid var(--line); padding-top: 16px; }
h3 { font-size: 14px; margin: 0; font-weight: 600; }
.meta, .hint, .shas { color: var(--muted); }
.note { background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--accent); padding: 8px 12px; border-radius: 6px; }
.stacked { border-left: 4px solid var(--warn); padding-left: 8px; }
.warning { color: var(--warn); } .error { color: var(--bad); white-space: pre-wrap; }
.errors pre { white-space: pre-wrap; background: var(--panel); border: 1px solid var(--line); padding: 8px; max-height: 320px; overflow: auto; }
table { border-collapse: collapse; } .summary { width: 100%; background: var(--panel); }
.summary th, .summary td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
.good { color: var(--good); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; }
.scene { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; margin: 12px 0; padding: 10px; outline: none; }
.scene.current { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
.scene header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.scene header button { margin-left: auto; }
button { font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 2px 10px; cursor: pointer; }
.badge { font-size: 12px; padding: 0 8px; border-radius: 10px; border: 1px solid var(--line); }
.badge.changed { color: var(--bad); border-color: var(--bad); } .badge.identical { color: var(--good); border-color: var(--good); }
.badge.rounding { color: var(--warn); border-color: var(--warn); } .badge.missing, .badge.unstable { color: var(--bad); }
.body { display: grid; grid-template-columns: 1fr 230px; gap: 10px; }
@media (max-width: 900px) { .body { grid-template-columns: 1fr; } }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; min-width: 0; }
@media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
figure { margin: 0; min-width: 0; } figcaption { font-size: 12px; color: var(--muted); }
figure img { width: 100%; display: block; background: #000; cursor: zoom-in; image-rendering: auto; }
.flip-host .when-a { display: none; } .scene.flipped .flip-host .when-a { display: block; } .scene.flipped .flip-host .when-b { display: none; }
.flip-host span.when-a { display: none; } .scene.flipped .flip-host span.when-a { display: inline; color: var(--warn); }
.panels { min-width: 0; display: grid; gap: 6px; }
.loupe { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.loupe[hidden] { display: none; } .loupe canvas { width: 100%; image-rendering: pixelated; background: #000; cursor: crosshair; }
.loupe .hint { grid-column: 1 / -1; margin: 0; font-size: 12px; }
.numbers { align-self: start; }
.numbers th { text-align: left; font-weight: 500; color: var(--muted); padding-right: 8px; white-space: nowrap; }
.numbers td { font-variant-numeric: tabular-nums; }
.legend span { display: inline-block; width: 10px; height: 10px; margin: 0 4px 0 10px; vertical-align: middle; }
`;

const SCRIPT = `
const scenes = [...document.querySelectorAll('.scene')];
let current = -1;
function select(index) {
  if (scenes.length === 0) return;
  current = (index + scenes.length) % scenes.length;
  scenes.forEach((scene, i) => scene.classList.toggle('current', i === current));
  scenes[current].scrollIntoView({ block: 'start', behavior: 'smooth' });
  scenes[current].focus({ preventScroll: true });
  history.replaceState(null, '', '#' + scenes[current].id);
}
function flip(scene) {
  if (!scene) return;
  scene.classList.toggle('flipped');
  const loupe = scene.querySelector('.loupe');
  if (loupe && !loupe.hidden) drawLoupe(scene, loupe.dataset.x, loupe.dataset.y);
}
function sourceFor(scene, role) {
  const flipped = scene.classList.contains('flipped');
  if (role === 'b' && flipped) role = 'a-flip';
  return scene.querySelector('img[data-role="' + role + '"]');
}
function drawLoupe(scene, x, y) {
  const loupe = scene.querySelector('.loupe');
  loupe.hidden = false;
  loupe.dataset.x = x; loupe.dataset.y = y;
  for (const canvas of loupe.querySelectorAll('canvas')) {
    const image = sourceFor(scene, canvas.dataset.role);
    if (!image || !image.complete) { image && image.addEventListener('load', () => drawLoupe(scene, x, y), { once: true }); continue; }
    const shown = canvas.getBoundingClientRect().width || 400;
    const width = Math.round(shown / 4), height = Math.round(width * 0.6);
    canvas.width = width * 4; canvas.height = height * 4;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    const sx = Math.max(0, Math.min(image.naturalWidth - width, Math.round(x - width / 2)));
    const sy = Math.max(0, Math.min(image.naturalHeight - height, Math.round(y - height / 2)));
    canvas.dataset.sx = sx; canvas.dataset.sy = sy;
    context.drawImage(image, sx, sy, width, height, 0, 0, width * 4, height * 4);
  }
  loupe.querySelector('.at').textContent = Math.round(x) + ', ' + Math.round(y);
}
document.addEventListener('click', (event) => {
  const scene = event.target.closest('.scene');
  if (!scene) return;
  current = scenes.indexOf(scene);
  scenes.forEach((s, i) => s.classList.toggle('current', i === current));
  if (event.target.matches('button.flip')) { flip(scene); return; }
  if (event.target.matches('figure img')) {
    const rect = event.target.getBoundingClientRect();
    const scale = event.target.naturalWidth / rect.width;
    drawLoupe(scene, (event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale);
  } else if (event.target.matches('.loupe canvas')) {
    const canvas = event.target, rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width / 4;
    drawLoupe(scene, Number(canvas.dataset.sx) + (event.clientX - rect.left) * scale, Number(canvas.dataset.sy) + (event.clientY - rect.top) * scale);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.target.closest && event.target.closest('input, textarea, select')) return;
  if (event.key === 'j') select(current + 1);
  else if (event.key === 'k') select(current - 1);
  else if (event.key === ' ') { event.preventDefault(); flip(scenes[current] ?? scenes[0]); }
  else if (event.key === 'Escape') document.querySelectorAll('.loupe').forEach((loupe) => (loupe.hidden = true));
});
const fromHash = scenes.findIndex((scene) => '#' + scene.id === location.hash);
if (fromHash >= 0) select(fromHash);
`;

export function renderReport(report) {
  const o = report.options;
  const capture =
    o.capture === 'probe'
      ? 'stock <code>benchmark:presentation-screenshots</code> probe (full page after the soak; telemetry panels masked; animated workloads are not deterministic)'
      : 'Presentation route driven with a fixed page clock (<code>capture.mjs</code>): each workload at fixed scene times after mount, canvas only';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Glyph Visual Tour</title><style>${STYLE}</style></head>
<body><main>
<h1>Visual tour · ${escape(report.run)}</h1>
<p class="meta">${escape(report.repository)} · ${escape(report.createdAt)} · backends ${escape(o.backends.join(', '))} · techniques ${escape(o.techniques.map((t) => (t === 'mtsdf' ? 'msdf' : t)).join(', '))} · ${o.workloads.length} workloads · ${o.software ? '<strong>SwiftShader (software)</strong>' : 'GPU'} · DPR ${o.dpr}<br>Capture: ${capture}.</p>
<p class="meta">Keys: <kbd>j</kbd>/<kbd>k</kbd> next/previous scene · <kbd>space</kbd> flip A/B · click an image to magnify 4× · <kbd>Esc</kbd> closes the magnifier. Scenes are sorted most-changed first.
<span class="legend">Heatmap:<span style="background:#ffdc28"></span>&gt; 8/255<span style="background:#ff4c3c"></span>B darker<span style="background:#2878ff"></span>B brighter (2–8/255)<span style="background:#444"></span>B, unchanged</span></p>
<p class="note">${escape(report.outlineReminder)} See <a href="../../../outline-stream/README.md">spikes/outline-stream/README.md</a>; once <code>serve.mjs</code> runs, its page is <a href="http://localhost:5178/gpu/">http://localhost:5178/gpu/</a>.</p>
${summaryHtml(report)}
${report.prs.map(prHtml).join('\n')}
</main><script>${SCRIPT}</script></body></html>
`;
}
