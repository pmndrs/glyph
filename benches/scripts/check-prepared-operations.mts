/* @workflow {
  "name": "benchmark:prepared-operations-check",
  "summary": "Check prepared-operation Labs generators deterministically against an installed Glyph package.",
  "requirements": "Pass --package-root <installed Glyph root>; the package and authenticated Labs fixtures must already exist. No build, server, or timing run.",
  "writes": "stdout only."
} */
import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--package-root' || args[1] === '') {
  throw new Error('Pass --package-root <installed Glyph root>');
}
process.env.GLYPH_LABS_PACKAGE_ROOT = resolve(args[1]!);

const { preparedOperation, preparedOperationCounts, preparedOperations } =
  await import('../labs/package/prepared-operations.bench.ts');

let checked = 0;
for (const count of preparedOperationCounts) {
  for (const operation of preparedOperations) {
    for (const invocations of [2, 3]) {
      const generator = preparedOperation(count, operation);
      try {
        const firstStep = generator.next();
        if (firstStep.done) throw new Error('generator finished before yielding its operation');
        const run = firstStep.value;
        const firstResult = run();
        for (let index = 1; index < invocations; index += 1) run();
        const end = generator.next(firstResult);
        if (!end.done) throw new Error('generator yielded more than one operation');
        checked += 1;
      } catch (error) {
        try {
          generator.return(undefined);
        } catch (cleanupError) {
          console.error('Prepared-operation cleanup failed:', cleanupError);
        }
        throw new Error(`${String(count)} labels first ${operation}, ${String(invocations)} invocations failed`, {
          cause: error,
        });
      }
    }
  }
}
process.stdout.write(`Prepared-operation generators passed: ${String(checked)} cases.\n`);
