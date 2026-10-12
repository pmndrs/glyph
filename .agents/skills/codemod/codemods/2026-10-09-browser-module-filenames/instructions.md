# Browser module filename migration

This repository-only move changes the private source module and corresponding private distribution test imports. Public `fingerprint` symbols, JSON properties, headers, algorithms and persisted identities remain unchanged. Applications require no migration.

Run against packages/glyph with tsconfig.build.json. The transform is idempotent. The source module is `src/internal/content-digest.ts` and the generated distribution module is `dist/internal/content-digest.js`. Rebuild the distribution, and run fingerprint vectors plus installed-package browser loading with fingerprint URLs blocked. Do not edit generated distribution files.
