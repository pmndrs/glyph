import {
  borrowedChecksum,
  createLabels,
  disposeLabels,
  inspectDraws,
  inspectGlyphPaint,
  span,
  txt,
} from './fixture.ts';

function formattedLabel(text: string) {
  return txt`${span({ color: '#ffffff', decoration: { underline: true } })`${text.slice(0, 5)}`}${text.slice(5)}`;
}

function trailingSpanLabel(text: string, trailingColor: string): ReturnType<typeof formattedLabel> {
  const content = `${text} alpha beta gamma delta epsilon`;
  const literal = formattedLabel(content);
  const spanCount = 8;
  return {
    ...literal,
    spans: Array.from({ length: spanCount }, (_, index) => ({
      start: Math.floor((content.length * index) / spanCount),
      end: Math.floor((content.length * (index + 1)) / spanCount),
      style: { color: index === spanCount - 1 ? trailingColor : '#ffffff' },
    })),
  };
}

/** Exact trailing-span publication workload shared by Labs timing and attribution. */
export function createTrailingSpanPublicationWorkload(count = 1_000) {
  const created = createLabels(count);
  const desired = ['#ff2f00', '#2f7fff'].map((trailingColor) =>
    created.labels.map((label) => ({ text: trailingSpanLabel(label.text, trailingColor) })),
  );
  let selected = 0;

  const setNext = () => {
    selected = selected === 0 ? 1 : 0;
    const next = desired[selected]!;
    for (let index = 0; index < created.labels.length; index++) {
      created.labels[index]!.set(next[index]!);
    }
  };
  const commit = () => {
    created.scene.updateMatrixWorld(true);
    if (created.textGroup.error !== undefined) throw created.textGroup.error;
    return created.textGroup.textCount;
  };
  const update = () => {
    setNext();
    return commit();
  };
  const inspect = () => {
    const paint = inspectGlyphPaint(created.scene);
    return {
      checksum: borrowedChecksum(created.labels),
      draws: inspectDraws(created.scene),
      paint,
      paintMatchesSelected:
        selected === 0
          ? paint.redDominant > 0 && paint.blueDominant === 0
          : paint.blueDominant > 0 && paint.redDominant === 0,
      textCount: created.textGroup.textCount,
    };
  };

  return {
    commit,
    dispose: () => disposeLabels(created),
    inspect,
    setNext,
    update,
  };
}
