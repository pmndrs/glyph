/* @workflow {
  "name": "benchmark:prepare-spans-check",
  "summary": "Run the three-span Labs rows (setter, setter + read, setter + frame) of the batching, edit, lifecycle and stress files without timing and assert their layout digests against an installed Glyph package; benchmark:prepared-operations-check covers the prepared-operation rows.",
  "requirements": "Pass --package-root <installed or built Glyph package root>; the package and authenticated Labs fixtures must already exist. No build, server, or timing run.",
  "writes": "stdout only."
} */
import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--package-root' || args[1] === '') {
  throw new Error('Pass --package-root <installed Glyph root>');
}
process.env.GLYPH_LABS_PACKAGE_ROOT = resolve(args[1]!);

for (const file of ['batching', 'edit', 'lifecycle', 'stress']) {
  await import(`../labs/package/${file}.bench.ts`);
}
const { spanRows } = await import('../labs/package/prepare-spans.ts');

let checked = 0;
for (const { name, run } of spanRows) {
  // Two and three calls end on each side of every alternating workload.
  for (const invocations of [2, 3]) {
    const generator = run();
    try {
      const firstStep = generator.next();
      if (firstStep.done) throw new Error('generator finished before yielding its operation');
      const step = firstStep.value;
      const call = typeof step === 'function' ? step : step.manual;
      const firstResult = call();
      for (let index = 1; index < invocations; index += 1) call();
      // Labs hands a self-timed step no result, and any other step its first one.
      const end = generator.next(typeof step === 'function' ? firstResult : undefined);
      if (!end.done) throw new Error('generator yielded more than one operation');
      checked += 1;
    } catch (error) {
      try {
        generator.return(undefined);
      } catch (cleanupError) {
        console.error('Three-span cleanup failed:', cleanupError);
      }
      throw new Error(`${name}, ${String(invocations)} invocations failed`, { cause: error });
    }
  }
}
process.stdout.write(`Three-span generators passed: ${String(checked)} cases over ${String(spanRows.length)} rows.\n`);
