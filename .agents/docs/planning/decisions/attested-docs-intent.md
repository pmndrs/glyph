---
type: Decision
title: 'Docs intent is attested in pull requests and verified after merge, never gated'
description: 'Contributors attest per changed package, CI shows attestation status, and a reviewer verifies every attestation and gap after merge; nothing blocks a merge or shares a file.'
decision_status: Accepted
decided: '2026-10-05'
generated:
  by: human:thejustinwalsh
  at: '2026-10-05T16:45:27Z'
---

# Docs intent is attested in pull requests and verified after merge, never gated

## Decision

Docs upkeep is audited, not gated. Concepts store no source pin; the retired `source_digest` is a validation finding.

- **Attest.** A contributor that changes a package's source updates its concept where it is now wrong, then, after the
  last source change, runs `docs:attest -- <package> "<what changed and was checked>"`. That writes one new
  `attestations/<date>-<package>-<digest>.md` naming the package source it covers as a SHA-256 over git blob IDs, which
  is identical in every checkout with or without Git LFS content. The committing identity is the attester.
- **Show.** On every commit until each package the branch changed is attested at the source about to be committed,
  the hook names it as missing or stale with the command to fix it; attesting after the last source change silences
  it, so the reminder always has an exit. CI's `Docs report` judges the pull request at its own head and shows, per
  changed package, whether the concept was edited and an icon for its attestation: ✅ attested, ⚠️ stale, or ❌
  missing, with a link to the concept and the command to fix each. Each missing or stale attestation and each
  validation finding is also a warning annotation on its file, which marks the check without failing it.
- **Verify.** The `Sync agent docs` issue (label `agents`), rewritten on every push to `main` and daily, lists per
  package the attestations still pending and the gaps: merges since the last verification that changed the package
  without attesting it, named by pull request. A reviewer checks each claim against its pull request's diff, corrects
  the docs from that evidence, and runs `docs:verify -- <slug>`, which writes one verification Log Entry with the
  `verified_sources` it confirmed and a `reviews` row per attestation and gap with its verdict, and removes the
  consumed attestations. The issue closes when every package matches its verified source with nothing pending.

Audits read git history and refuse a shallow clone; attesting, the hook, and validation need none.

## Why

The stored digest made every pull request touching a package conflict on one line, and the commit hook re-pinned it
automatically, so it cost a rebase per merge and proved no review happened. Intent and its verification are different
claims by different actors, so they are recorded separately: an attestation is the contributor's claim about exact
source, and a verification is the reviewer's verdict on it. Both are new files created by one change each, so
concurrent pull requests never edit the same record, and every merge either carries intent or appears as a gap until
a reviewer accounts for it.

## Consequences

Merging never waits on docs. Every accepted pull request that lacked an attestation is recorded with its number in a
verification entry's `reviews`, searchable with `docs:list -- log --mentions gap`. A digest pins a claim to exact
source but cannot prove the review was careful; the reviewer's verdict and the git history of each record carry that
accountability. Rebase-and-merge pull requests may show source commits other than the attesting one as gaps, so pull
requests here merge with merge commits or squashes. `docs:update` and `generate-package-digests.mjs` are removed.
