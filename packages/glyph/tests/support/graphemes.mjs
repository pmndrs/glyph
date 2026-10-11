import { graphemeSegments } from 'unicode-segmenter/grapheme';

export function findGraphemeBoundaries(text) {
  if (!text.isWellFormed()) throw new RangeError('text must be well-formed UTF-16');
  const boundaries = [0];
  for (const segment of graphemeSegments(text)) boundaries.push(segment.index + segment.segment.length);
  return boundaries;
}
