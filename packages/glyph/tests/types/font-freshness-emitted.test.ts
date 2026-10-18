import { type FontFreshness, fontIsUpToDate } from '@pmndrs/glyph/bake';

interface TrackedFreshness extends FontFreshness {
  readonly checkedAt: number;
}

const oldConstruction: FontFreshness = { fresh: true, reason: 'cached' };
const oldExtension: TrackedFreshness = { fresh: false, reason: 'changed', checkedAt: 1 };

declare const result: Awaited<ReturnType<typeof fontIsUpToDate>>;
if (result.fresh) {
  const outputBytes: number = result.outputBytes;
  void outputBytes;
}

void oldConstruction;
void oldExtension;
