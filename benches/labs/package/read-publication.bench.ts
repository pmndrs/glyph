import { assert, bench, group } from '@pmndrs/labs';

import { createLabels, createLabelScene, disposeLabels, font } from './fixture.ts';
import { freshSnapshot, renderFrame, requireFresh, spawnAndBreakApart, updateThenRead } from './read-publication.ts';

// Application flows that read fresh layout, in scenes of 1, 100, or 1,000 labels (.agents/docs/planning/decisions/commit-on-read.md). Workloads that repeat work on
// mounted labels time as steady state under @read-publication; workloads whose every call mounts new text pay a
// first-time cost and time under @cold.

group('one label in a small scene @read-publication @one-label', () => {
  bench('edit a label and read its glyphs', function* () {
    const created = createLabels(1);
    const label = created.labels[0]!;
    let alternate = false;
    yield {
      bench: () => {
        alternate = !alternate;
        return updateThenRead(
          created,
          [label],
          (object) => {
            object.text = alternate ? 'Ready' : 'Paused';
          },
          (object) => requireFresh(object.measureGlyphs()?.length ?? -1, object.text.length),
          false,
        );
      },
      snapshot: () => freshSnapshot([label]),
    };
    disposeLabels(created);
  });

  bench('edit a label and draw without reading layout', function* () {
    const created = createLabels(1);
    const label = created.labels[0]!;
    let alternate = false;
    yield {
      bench: () => {
        alternate = !alternate;
        label.text = alternate ? 'Ready' : 'Paused';
        renderFrame(created);
        return label.text.length;
      },
      snapshot: () => freshSnapshot([label]),
    };
    disposeLabels(created);
  });
});

group('one label in a small scene, mounted fresh @cold @one-label', () => {
  bench('mount a label and read its glyphs before the first frame', function* () {
    const created = createLabels(1);
    let measured = 0;
    yield {
      bench: () => {
        const label = created.root.createText({ font, text: 'Ready', style: { fontSize: 16 } });
        try {
          measured = updateThenRead(
            created,
            [label],
            (object) => created.textGroup.add(object),
            (object) => requireFresh(object.measureGlyphs()?.length ?? -1, object.text.length),
            false,
          );
          return measured;
        } finally {
          label.dispose();
        }
      },
      snapshot: () => measured,
    };
    disposeLabels(created);
  });
});

for (const count of [1, 100, 1_000]) {
  const scene = `in a scene of ${String(count)} label${count === 1 ? '' : 's'}`;
  const small = count === 1 ? ' @small-scene' : '';

  group(`${scene} @read-publication`, () => {
    bench(`type in a text field${small}`, function* () {
      const created = createLabels(count);
      const field = created.root.createText({ font, text: 'Search: glyph', style: { fontSize: 16 } });
      created.textGroup.add(field);
      renderFrame(created);
      let typed = false;
      let selection = 0;
      yield {
        bench: () => {
          typed = !typed;
          return updateThenRead(
            created,
            [field],
            (object) => {
              object.text = typed ? 'Search: glyphs' : 'Search: glyph';
            },
            (object) => {
              const caret = requireFresh(object.caretAt(10_000, 0)?.offset ?? -1, object.text.length);
              selection = object.selectionRects(8, object.text.length)?.length ?? 0;
              return caret + selection;
            },
            false,
          );
        },
        snapshot: () => selection,
      };
      field.dispose();
      disposeLabels(created);
    });

    bench(`click to place the caret${small}`, function* () {
      const created = createLabels(count);
      const field = created.root.createText({ font, text: 'Search: glyph', style: { fontSize: 16 } });
      created.textGroup.add(field);
      renderFrame(created);
      let pointer = 0;
      yield {
        bench: () => {
          pointer = (pointer + 7) % 120;
          const caret = field.caretAt(pointer, 0)?.offset ?? -1;
          renderFrame(created);
          return caret;
        },
        snapshot: () => field.caretAt(10_000, 0)?.offset,
      };
      field.dispose();
      disposeLabels(created);
    });

    if (count === 1) return;

    for (const [schedule, eachInTurn] of [
      ['all, then read each', false],
      ['each in turn', true],
    ] as const) {
      bench(`edit 50 lines and place carets: ${schedule}`, function* () {
        const created = createLabels(count);
        const lines = Array.from({ length: 50 }, (_, line) =>
          created.root.createText({ font, text: `let item${String(line)} = 0`, style: { fontSize: 16 } }),
        );
        created.textGroup.add(...lines);
        renderFrame(created);
        let typed = false;
        yield {
          bench: () => {
            typed = !typed;
            return updateThenRead(
              created,
              lines,
              (line, index) => {
                line.text = `let item${String(index)} = 0${typed ? ';' : ''}`;
              },
              (line) => {
                const caret = requireFresh(line.caretAt(10_000, 0)?.offset ?? -1, line.text.length);
                return caret + (line.selectionRects(line.text.length - 2, line.text.length)?.length ?? 0);
              },
              eachInTurn,
            );
          },
          snapshot: () => lines.map((line) => line.caretAt(10_000, 0)?.offset === line.text.length),
        };
        for (const line of lines) line.dispose();
        disposeLabels(created);
      });

      bench(`dashboard, 100 tickers rolling digits: ${schedule}`, function* () {
        const created = createLabels(count);
        const tickers = created.labels.slice(0, 100);
        for (const ticker of tickers) ticker.text = '12,345';
        renderFrame(created);
        let tick = false;
        yield {
          bench: () => {
            tick = !tick;
            const value = tick ? '123,456' : '12,345';
            return updateThenRead(
              created,
              tickers,
              (ticker) => {
                ticker.text = value;
              },
              (ticker) => requireFresh(ticker.measureGlyphs()?.length ?? 0, value.length),
              eachInTurn,
            );
          },
          snapshot: () => freshSnapshot(tickers),
        };
        disposeLabels(created);
      });
    }

    bench('dashboard, 100 tickers without reading layout', function* () {
      const created = createLabels(count);
      const tickers = created.labels.slice(0, 100);
      for (const ticker of tickers) ticker.text = '12,345';
      renderFrame(created);
      let tick = false;
      yield {
        bench: () => {
          tick = !tick;
          for (const ticker of tickers) ticker.text = tick ? '123,456' : '12,345';
          renderFrame(created);
          return tickers.length;
        },
        snapshot: () => freshSnapshot(tickers),
      };
      disposeLabels(created);
    });
  });

  group(`${scene}, mounting new text @cold`, () => {
    bench(`break a title into letters${small}`, function* () {
      const created = createLabels(count);
      let copied = 0;
      yield {
        bench: () => {
          const title = spawnAndBreakApart(created, ['Glyph'], false);
          copied = title.copied;
          title.unmount();
          return copied;
        },
        snapshot: () => copied,
      };
      disposeLabels(created);
    });

    if (count === 1) return;

    for (const [schedule, eachInTurn] of [
      ['all, then read each', false],
      ['each in turn', true],
    ] as const) {
      bench(`floating combat text, 30 numbers: ${schedule}`, function* () {
        const created = createLabels(count);
        const damage = Array.from({ length: 30 }, (_, hit) => String(1_000 + hit * 37));
        let copied = 0;
        yield {
          bench: () => {
            const burst = spawnAndBreakApart(created, damage, eachInTurn);
            copied = burst.copied;
            // The numbers expire, so every burst spawns into the same scene.
            burst.unmount();
            return copied;
          },
          snapshot: () => copied,
        };
        disposeLabels(created);
      });

      bench(`load the scene and break every label apart: ${schedule}`, function* () {
        const texts = Array.from({ length: count }, () => 'WWWWWWWWWWWW');
        const copied = yield () => {
          const created = createLabelScene(count);
          try {
            const loaded = spawnAndBreakApart(created, texts, eachInTurn);
            loaded.unmount();
            return loaded.copied;
          } finally {
            created.textGroup.dispose();
            created.root.dispose();
          }
        };
        assert.equal(copied, count * 12);
        return copied;
      });
    }
  });
}
