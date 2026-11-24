import { expect, it } from 'vitest';
import { GUTTER } from './content';
import { columnBoxes, createManuscript, currentOffset, currentText, originalOffsets, type Box } from './utils';

it('tiles the width with equal columns, and slides between whole counts without a jump', () => {
  const boxes: Box[] = [];

  expect(columnBoxes(boxes, 3, 27, 16)).toBe(3);
  expect(boxes[0]!.left).toBe(0);
  expect(boxes[2]!.right).toBeCloseTo(27);
  expect(boxes[1]!.left - boxes[0]!.right).toBeCloseTo(GUTTER);
  expect(boxes[0]!.right - boxes[0]!.left).toBeCloseTo(boxes[2]!.right - boxes[2]!.left);

  // A gutter dragged from three columns toward two: the last column narrows out of the right edge.
  let previous = boxes[0]!.right;

  for (let columns = 2.8; columns >= 2.2; columns -= 0.05) {
    const count = columnBoxes(boxes, columns, 27, 16);
    expect(boxes[count - 1]!.right).toBeCloseTo(27);
    expect(boxes[0]!.right).toBeGreaterThan(previous - 1e-9);
    expect(boxes[0]!.right - previous).toBeLessThan(0.7);
    previous = boxes[0]!.right;
  }

  expect(columnBoxes(boxes, 2, 27, 16)).toBe(2);
});

it('keeps every remaining character findable while characters leave and return', () => {
  const script = createManuscript('living page');
  const take = (original: number) => {
    script.removed[original] = 1;
    script.removedCount++;
  };
  take(1);
  take(4);
  take(7);

  expect(currentText(script)).toBe('lvig age');
  expect(currentOffset(script, 5)).toBe(3);
  const originals = originalOffsets(new Uint32Array(script.original.length), script);
  expect(Array.from(originals.slice(0, 8), (offset) => script.original[offset]).join('')).toBe('lvig age');
});
