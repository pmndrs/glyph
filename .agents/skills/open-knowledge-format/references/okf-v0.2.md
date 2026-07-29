# Open Knowledge Format v0.2 reference

## Contents

1. [Status and vocabulary](#status-and-vocabulary)
2. [Concept frontmatter](#concept-frontmatter)
3. [Provenance, generation, and verification](#provenance-generation-and-verification)
4. [Lifecycle and trust](#lifecycle-and-trust)
5. [Reserved files and links](#reserved-files-and-links)
6. [Attested computations](#attested-computations)
7. [Conformance and versioning](#conformance-and-versioning)
8. [Migration from v0.1](#migration-from-v01)

## Status and vocabulary

OKF is an open, vendor-neutral directory format for portable human- and agent-readable knowledge. Version 0.2 is the current upstream specification. A bundle is a directory tree of UTF-8 Markdown files with YAML frontmatter and ordinary Markdown links.

- **Knowledge bundle:** the self-contained hierarchical unit of distribution.
- **Concept:** one unit of knowledge in one non-reserved Markdown file.
- **Concept ID:** the bundle-relative path without `.md`.
- **Source:** material a concept derives from, named in `sources`.
- **Actor:** an agent/tool, person, or process named by the standard actor convention.
- **Attested Computation:** a concept carrying a sanctioned computation plus executor and attester contracts.

OKF does not define a taxonomy, storage service, query system, or replacement for domain schemas.

## Concept frontmatter

```yaml
---
type: API Endpoint
title: Shape paragraph
description: Shapes styled Unicode runs into positioned glyphs.
resource: https://example.test/api/shape-paragraph
tags: [fonts, shaping]
sources:
  - id: opentype
    resource: https://learn.microsoft.com/en-us/typography/opentype/spec/
    title: OpenType specification
generated:
  by: font-doc-agent/2.0
  at: 2026-07-25T00:00:00Z
status: draft
---
```

Only `type` is always required. `title`, `description`, `resource`, `tags`, and the provenance/trust/lifecycle families are optional. Producers may add fields; consumers preserve unknown fields and tolerate unknown type values.

The body is standard Markdown. `# Schema`, `# Examples`, and `# Computation` have conventional meaning. Attribute a claim with a footnote whose label matches `sources[].id`:

```markdown
Glyph IDs are font-local.[^opentype]
```

## Provenance, generation, and verification

`sources` records derivation. Every entry requires `resource`; optional fields are `id`, `title`, `author`, `usage_count`, and `last_modified`. A shared `usage_window` frames usage counts, while an entry may override it. Treat these as objective signals, not a credibility score.

`generated` records the current concept revision:

```yaml
generated: { by: process:docs-build, at: 2026-07-25T00:00:00Z }
```

For `generated.by` and `verified[].by`, actors are `<producer>/<version>` for agents and tools, `human:<id>` for people, and `process:<id>` for automated processes. Use `human:` for hand-authored or human-confirmed content. A source's optional `author` is an objective producer label and is not one of the §7 identity fields.

`verified` records definition review and may be one `{ by, at }` mapping or a list of those mappings. Consumers treat a bare mapping as a one-element list.

## Lifecycle and trust

`status` uses `draft`, `stable`, or `deprecated`; an absent status means stable. `stale_after` is the first date the concept is stale. Derive freshness from that date; do not infer it from generation time.

Derived trust tiers are:

- unverified when no verification exists;
- machine-confirmed when the latest verification actor is a tool/process;
- human-reviewed when the latest verification actor starts with `human:`.

Trust is derived, not stored as a score. Missing optional trust and lifecycle fields never make a concept nonconformant.

## Reserved files and links

`index.md` is optional progressive-disclosure navigation. Index files have no frontmatter except that the bundle-root index may declare only:

```yaml
---
okf_version: '0.2'
---
```

`log.md` is optional and uses one H1 title followed by newest-first H2 dates:

```markdown
# Directory Update Log

## 2026-07-25

- **Update** — Added a concept.
```

Date headings use `YYYY-MM-DD`. Entries are flat prose; the bold leading action is conventional.

Links are ordinary Markdown and express directed, untyped relationships. A `references/` directory may mirror external material or contain run instructions and code as concepts, but its name is conventional rather than required.

## Attested computations

Each sanctioned computation is a separate `type: Attested Computation` concept. Its frontmatter declares `runtime` and may also declare:

- typed `parameters`;
- `computation`, either inline under `# Computation` or a referenced file;
- `executor`, including how to run and the expected receipt;
- `attester`, deterministic code that checks provenance and fidelity;
- ordinary provenance, verification, status, and freshness fields.

An executing agent supplies only declared parameter values. It does not author or edit the sanctioned computation. Verification reviews the definition; attestation checks one execution. A stale definition may attest correctly, and a verified definition still needs per-run attestation.

## Conformance and versioning

A v0.2 bundle conforms when:

1. every non-reserved Markdown file has parseable YAML frontmatter;
2. every concept has a non-empty `type`;
3. present `index.md` and `log.md` files follow their reserved structures.

Unknown fields/types, missing optional metadata, broken links, and missing indexes are not conformance failures. Consumers remain permissive and surface failing attestations.

The root may declare `okf_version: "0.2"`. Consumers that do not understand it attempt best-effort consumption.

## Migration from v0.1

V0.2 supersedes v0.1 with two deliberate breaking changes:

- `timestamp` is superseded by `generated.at` together with `generated.by`.
- Body `# Citations` lists are superseded by frontmatter `sources`; claim attribution uses matching footnotes.

All other v0.2 families are additive. A v0.2 consumer may fall back to legacy fields, but a migrated producer should remove them rather than accumulate debt.

## Sources

- [Open Knowledge Format v0.2 specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) — authoritative format, migration, and conformance source.
- [Introducing the Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) — motivation and design principles.
