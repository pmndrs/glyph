import { assert, bench, group } from '@pmndrs/labs';

import {
  createLabels,
  createParagraph,
  disposeLabels,
  disposeParagraph,
  paragraphTextForGlyphs,
  attachToScene,
  createPublishedParagraph,
} from './fixture.ts';

const paragraphText = paragraphTextForGlyphs(22_000);

// Every timed call pays a first-time cost on freshly mounted state, so these workloads time alike on every build and
// stay out of the steady-state suites, whose workloads repeat work that setup has already performed once.
group('first-time operations @cold', () => {
  bench('mount and publish a 22k-glyph paragraph @exhaustive', function* () {
    let committed = false;
    const textCount = yield () => {
      const created = createPublishedParagraph(paragraphText);
      committed = created.paragraph.commitState().status === 'committed';
      const result = created.textGroup.textCount;
      disposeParagraph(created);
      return result;
    };
    assert.equal(textCount, 1);
    assert(committed, 'cold paragraph must complete publication before disposal');
  });

  bench('mount a label and publish its first edit', function* () {
    let iteration = 0;
    let committed = false;
    const textCount = yield () => {
      const created = createParagraph(`label ${String(iteration)}`);
      created.paragraph.text = `edited ${String(iteration++)}`;
      const scene = attachToScene(created.textGroup);
      scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      committed = created.paragraph.commitState().status === 'committed';
      const result = created.textGroup.textCount;
      disposeParagraph(created);
      return result;
    };
    assert.equal(textCount, 1);
    assert(committed, 'cold label edit must complete publication before disposal');
  });

  bench('mount 100 labels and borrow glyphs from each once', function* () {
    const glyphCount = yield () => {
      const created = createLabels();
      const result = created.labels.reduce(
        (total, label) => total + label.readGlyphs((glyphs) => glyphs.glyphCount),
        0,
      );
      disposeLabels(created);
      return result;
    };
    assert(glyphCount > 0, 'first borrows must contain glyphs');
  });
});
