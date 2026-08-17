/**
 * Development-only diagnostics.
 *
 * Guidance that helps someone integrating the library — a lease that outlived its
 * paragraph, a teardown stage that failed and was stepped over — is worth saying loudly
 * while they are building, and worth nothing in a shipped bundle. Every consumer pays for
 * the message strings otherwise, and the engine already has a mechanism for conditions
 * that must hold in production: an ordinary `throw`.
 *
 * `DEV` is written as the ecosystem-standard `process.env.NODE_ENV` comparison because
 * every bundler replaces it with a literal. The comparison then folds to `false` and each
 * `if (DEV)` block is eliminated along with the strings inside it. The library itself
 * deliberately ships the guard unfolded: a library build cannot know which mode the
 * consuming application will build in, so the consumer's bundler decides.
 *
 * Use it for guidance only:
 *
 * ```ts
 * if (DEV) console.warn('a Text still holds a lease on this font');   // stripped
 * if (capacity <= 0) throw new RangeError('capacity must be positive'); // always
 * ```
 *
 * The package-size harness measures the production graph and asserts that no
 * development-only text survives it, so a diagnostic that leaks into shipped bytes fails
 * the build rather than going unnoticed.
 */
export const DEV: boolean = process.env.NODE_ENV !== 'production';
