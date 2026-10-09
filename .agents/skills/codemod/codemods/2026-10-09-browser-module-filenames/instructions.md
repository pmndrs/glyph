# Browser module filename migration

This repository-only move changes the private source module and corresponding private distribution test imports. Public `fingerprint` symbols, JSON properties, headers, algorithms and persisted identities remain unchanged. Applications require no migration.

Run against packages/glyph with tsconfig.build.json. The transform is idempotent. Review residual `internal/fingerprint.js` and `internal/fingerprint.ts` imports, rebuild the distribution, and run fingerprint vectors plus installed-package browser loading with fingerprint URLs blocked. Do not edit generated distribution files.
