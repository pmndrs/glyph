# Open Knowledge Format v0.1 reference

## Status and intent

The Open Knowledge Format (OKF) is an open, vendor-neutral format introduced by Google Cloud for portable knowledge used by humans and agents. Version 0.1 is currently marked **Draft**. It represents a bundle as a directory of UTF-8 Markdown files with YAML frontmatter and standard Markdown links.

Its goals are to make knowledge human-readable, agent-parseable, version-control friendly, portable, and independent of a required SDK or platform. It intentionally does not define a universal taxonomy, storage service, query system, or replacement for domain schemas.

## Vocabulary

- **Knowledge bundle:** a self-contained hierarchical collection and the unit of distribution.
- **Concept:** one unit of knowledge represented by one non-reserved Markdown file.
- **Concept ID:** the concept file's bundle-relative path without the `.md` suffix.
- **Frontmatter:** the YAML metadata block at the beginning of a concept.
- **Link:** a standard Markdown link that asserts a directed, untyped relationship.
- **Citation:** an internal or external link supporting a claim.

## Concept frontmatter

```yaml
---
type: API Endpoint
title: Shape paragraph
description: Shapes styled Unicode runs into positioned glyphs.
resource: https://example.test/api/shape-paragraph
tags: [fonts, shaping]
timestamp: 2026-07-23T00:00:00Z
---
```

Only `type` is required. `title`, `description`, `resource`, `tags`, and `timestamp` are recommended or optional. Producers may define additional fields. Consumers should preserve unknown fields and tolerate unknown type values.

The body is standard Markdown. The upstream spec gives conventional meaning to these optional headings:

- `# Schema` for structured fields;
- `# Examples` for concrete usage;
- `# Citations` for sources supporting claims.

## Reserved files

`index.md` is an optional directory listing. It supports progressive disclosure by linking to concepts or subdirectories with short descriptions. It normally has no frontmatter. The bundle-root index may use frontmatter only to declare a target such as `okf_version: "0.1"`.

`log.md` is an optional update history. Entries are grouped under ISO `YYYY-MM-DD` headings, newest first. A leading word such as **Creation**, **Update**, or **Deprecation** is conventional rather than mandatory.

## Links and citations

OKF supports bundle-root-relative and ordinary relative Markdown links. Root-relative links are recommended for stability across some file moves. The prose around a link communicates its semantics; the format does not define edge types.

Consumers must tolerate broken links because a bundle can be partial or evolving. Producers should still resolve them before shipping a curated bundle. External claims should identify their sources in a final citations section when applicable.

## Conformance boundary

A v0.1 bundle conforms when:

1. every non-reserved Markdown file has parseable YAML frontmatter;
2. every such frontmatter block contains a non-empty `type`;
3. every present `index.md` and `log.md` follows the reserved-file structure.

Missing optional fields, unknown types or fields, broken links, and missing indexes do not make a bundle non-conformant. Tools may report them as quality warnings, but consumers should remain permissive.

## Sources and surveyed skills

Primary sources:

- [Open Knowledge Format v0.1 specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) — authoritative draft format and conformance rules.
- [Introducing the Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) — motivation, design principles, and reference implementations.
- [GoogleCloudPlatform/knowledge-catalog OKF directory](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) — upstream examples and tooling.

Community skills reviewed for this repository adaptation:

- [hu-qi/OpenKnowledgeFormat-Skill](https://github.com/hu-qi/OpenKnowledgeFormat-Skill) — concise creation, conversion, maintenance, and validation workflows.
- [sniperunder123/okf-knowledge](https://github.com/sniperunder123/okf-knowledge) — useful index-first querying and separation of conformance errors from producer lints.
- [fabricioctelles/skills: okf-open-knowledge-format](https://github.com/fabricioctelles/skills/tree/main/skills/okf-open-knowledge-format) — broad workflow and guardrail coverage.

This repo skill is an original synthesis grounded in the upstream draft. It excludes dependencies on a particular command syntax, linter, visualizer, cloud product, taxonomy, or Python environment. Recheck the upstream draft before relying on exact conformance language because OKF is new and versioned for change.
