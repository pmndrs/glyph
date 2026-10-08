import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assert, bench, group } from '@pmndrs/labs';

import { borrowedChecksum, createLabels, disposeLabels, inspectDraws, span, txt } from './fixture.ts';

const packageRoot = process.env.GLYPH_LABS_PACKAGE_ROOT;
if (packageRoot === undefined) throw new Error('Installed Glyph package root is required');
interface ReactiveSnapshotPackage {
  snapshotReactivePropertyList<Value extends object>(value: unknown, label: string, previous?: Value): Value;
}

interface FormattedTextInternals {
  inheritClusterAlignedSpans?<Span extends Readonly<{ start: number; end: number }>>(
    text: string,
    source: readonly Readonly<{ start: number; end: number }>[],
    spans: readonly Span[],
  ): readonly Span[];
}

let reactiveSnapshotPackage: ReactiveSnapshotPackage;
const reactiveSnapshotPath = resolve(packageRoot, 'dist/vue/internal/property-snapshot.js');
if (existsSync(reactiveSnapshotPath)) {
  reactiveSnapshotPackage = (await import(pathToFileURL(reactiveSnapshotPath).href)) as ReactiveSnapshotPackage;
} else {
  const previous = (await import(pathToFileURL(resolve(packageRoot, 'dist/internal/desired-text.js')).href)) as {
    snapshotPropertyList<Value extends object>(value: unknown, label: string, prior?: Value): Value;
  };
  reactiveSnapshotPackage = { snapshotReactivePropertyList: previous.snapshotPropertyList };
}

const { snapshotReactivePropertyList } = reactiveSnapshotPackage;
const formattedTextPath = resolve(packageRoot, 'dist/formatted-text.js');
const formattedTextPackage = (
  existsSync(formattedTextPath) ? await import(pathToFileURL(formattedTextPath).href) : {}
) as FormattedTextInternals;
const inheritClusterAlignedSpans = formattedTextPackage.inheritClusterAlignedSpans;
if (process.env.GLYPH_LABS_ARTIFACT_ROLE === 'candidate' && inheritClusterAlignedSpans === undefined) {
  throw new Error('candidate package does not expose the cluster-provenance helper exercised by @frameworks');
}

function formattedLabel(text: string) {
  return txt`${span({ color: '#ffffff', decoration: { underline: true } })`${text.slice(0, 5)}`}${text.slice(5)}`;
}

const bindFrameworkLabel: (flattened: ReturnType<typeof formattedLabel>) => ReturnType<typeof formattedLabel> =
  inheritClusterAlignedSpans === undefined
    ? (flattened) =>
        Object.freeze({
          ...flattened,
          spans: Object.freeze(flattened.spans.map((entry) => Object.freeze({ ...entry }))),
        })
    : (flattened) => {
        const spans = flattened.spans.map((entry) => Object.freeze({ ...entry }));
        return Object.freeze({
          ...flattened,
          spans: inheritClusterAlignedSpans(flattened.text, flattened.spans, spans),
        });
      };

group('framework normalization publication @publication', () => {
  bench('reuse 1000 unchanged Vue property snapshots @vue', function* () {
    const count = 1_000;
    const inputs = Array.from({ length: count }, (_, index) => [
      { fontSize: 16 },
      false,
      { color: index % 2 === 0 ? '#ffffff' : '#eeeeee', decoration: { underline: true } },
    ]);
    const snapshots = inputs.map((input) => snapshotReactivePropertyList(input, 'Labs text style'));

    const update = () => {
      let reusedCount = 0;
      for (let index = 0; index < inputs.length; index++) {
        const previous = snapshots[index]!;
        const next = snapshotReactivePropertyList(inputs[index], 'Labs text style', previous);
        if (next === previous) reusedCount++;
        snapshots[index] = next;
      }
      return reusedCount;
    };
    update();
    const reused = yield update;
    if (process.env.GLYPH_LABS_ARTIFACT_ROLE === 'baseline') assert.equal(reused === 0 || reused === count, true);
    else assert.equal(reused, count);
  });

  bench('normalize 1000 equivalent formatted flow updates @normalization', function* () {
    const count = 1_000;
    const created = createLabels(count);
    const desired = [0, 1].map(() =>
      created.labels.map((label) => ({
        text: formattedLabel(label.text),
        style: { fontSize: 16 },
        layout: { wrap: 'word' as const },
        constraints: { width: { mode: 'exact' as const, size: 160 } },
        flow: {
          regions: [{ key: 'main', shape: { kind: 'rectangle' as const, bounds: [0, 0, 160, 64] as const } }],
        },
      })),
    );
    let selected = 0;

    const update = () => {
      selected = selected === 0 ? 1 : 0;
      const next = desired[selected]!;
      for (let index = 0; index < created.labels.length; index++) {
        created.labels[index]!.set(next[index]!);
      }
      created.scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    update();
    const expectedChecksum = borrowedChecksum(created.labels);
    const textCount = yield update;
    assert.equal(textCount, count);
    assert.equal(borrowedChecksum(created.labels), expectedChecksum);

    disposeLabels(created);
  });

  bench('bind and normalize 1000 framework-shaped formatted flow updates @frameworks', function* () {
    const count = 1_000;
    const created = createLabels(count);
    const flattened = [0, 1].map(() => created.labels.map((label) => formattedLabel(label.text)));
    let selected = 0;

    const update = () => {
      selected = selected === 0 ? 1 : 0;
      const next = flattened[selected]!;
      for (let index = 0; index < created.labels.length; index++) {
        created.labels[index]!.set({
          text: bindFrameworkLabel(next[index]!),
          style: { fontSize: 16 },
          layout: { wrap: 'word' as const },
          constraints: { width: { mode: 'exact' as const, size: 160 } },
          flow: {
            regions: [{ key: 'main', shape: { kind: 'rectangle' as const, bounds: [0, 0, 160, 64] as const } }],
          },
        });
      }
      created.scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    update();
    const expectedChecksum = borrowedChecksum(created.labels);
    const expectedDraws = inspectDraws(created.textGroup);
    const textCount = yield update;
    assert.equal(textCount, count);
    assert.equal(borrowedChecksum(created.labels), expectedChecksum);
    assert.equal(inspectDraws(created.textGroup).glyphs, expectedDraws.glyphs);
    assert.equal(inspectDraws(created.textGroup).draws, expectedDraws.draws);

    disposeLabels(created);
  });
});
