# Diátaxis framework reference

## Primary model

Diátaxis, created by Daniele Procida, describes four forms of technical documentation. The forms arise from two dimensions:

- action versus cognition: doing something versus understanding something;
- acquisition versus application: learning a skill versus using an existing skill.

| | Acquisition: study | Application: work |
| --- | --- | --- |
| Action | Tutorial | How-to guide |
| Cognition | Explanation | Reference |

The framework is a practical compass. It does not require four folders, four sections on every subject, or a simultaneous rewrite of a documentation set.

## Distinguishing adjacent types

### Tutorial versus how-to

Both contain action, but their users are in different states.

- A tutorial creates a successful learning experience. The author controls the path and carries responsibility for success.
- A how-to guide helps an already-competent user reach a chosen goal. The user's situation controls the path, so conditions and alternatives may be necessary.

Diagnostic question: is the reader following a lesson selected by the author, or solving a problem selected by the reader?

### Reference versus explanation

Both communicate knowledge, but they support different activity.

- Reference is consulted during work. It should be authoritative, structured, neutral, and complete for its declared surface.
- Explanation is read to build understanding. It can be selective, discursive, comparative, and opinionated where evidence supports the position.

Diagnostic question: does the reader need an exact fact now, or a mental model that will help later?

## Practical quality signals

| Type | Strong signals | Common failure |
| --- | --- | --- |
| Tutorial | one path, tested steps, visible progress, expected results | alternatives and theory interrupt learning |
| How-to | concrete goal, prerequisites, actionable sequence, success check | teaches the product from first principles |
| Reference | stable structure, exact facts, defaults, constraints, coverage | procedural narrative or unexplained incompleteness |
| Explanation | causes, connections, tradeoffs, context, alternatives | becomes a procedure or field-by-field catalog |

Mixed content is not automatically defective. A short explanation can prevent a dangerous mistake in a how-to, and a reference entry can contain a compact example. Split when a secondary mode changes the reader, pace, or purpose of the page.

## Landing pages and project artifacts

README files and documentation homepages are navigation surfaces. They usually orient, establish trust, provide a short first success, and route readers to deeper material; they need not fit a single quadrant.

Internal project artifacts also have different jobs:

- ADRs preserve decisions and consequences.
- research logs preserve sources and findings.
- plans sequence future work.
- issue backlogs track execution.
- release notes describe change over time.

Do not distort these genres to make them look like product documentation. Apply Diátaxis when turning their stable findings into material for users.

## Open Knowledge Format composition

Diátaxis and Open Knowledge Format operate at different layers. Diátaxis classifies a reader-facing page by the need it serves. OKF makes a hierarchy of concept documents portable through frontmatter, links, citations, and reserved navigation files. Using both does not require mapping OKF `type` values directly to the four Diátaxis forms; descriptive artifact types such as `API Reference`, `Architecture Reference`, `Roadmap`, or `Research` remain valid when they accurately identify the concept.

Within an OKF bundle, ordinary concept pages retain their OKF frontmatter when they are reorganized through Diátaxis. The bundle's authoring profile may require metadata beyond upstream OKF's minimum, including a final last-modified `timestamp` and source citations.

An OKF `index.md` has a narrower role than a README or documentation homepage: it is a reserved directory listing for progressive disclosure. It should contain grouped links and concise descriptions, not tutorials, procedures, design arguments, plans, specifications, or copied summaries of authoritative concepts. It is not assigned a Diátaxis quadrant. Nested indexes have no frontmatter; the bundle-root index may contain only the version declaration allowed by the active OKF specification.

## Sources and surveyed skills

Primary sources:

- [Diátaxis](https://diataxis.fr/) — authoritative framework and full handbook.
- [Diátaxis in five minutes](https://diataxis.fr/start-here/) — concise definition of the four needs.
- [The Diátaxis map](https://diataxis.fr/map/) — the action/cognition and acquisition/application model.
- [Applying Diátaxis](https://diataxis.fr/application/) — incremental application rather than template-first restructuring.
- [Open Knowledge Format v0.1 specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) — concept metadata and reserved `index.md` navigation rules used when the frameworks are composed.

Community skills reviewed for this repository adaptation:

- [sammcj/agentic-coding: writing-documentation-with-diataxis](https://github.com/sammcj/agentic-coding/tree/main/Skills_disabled/diataxis-documentation) — strong compass and page-writing guidance.
- [keithpatton/diataxis-agent-skill](https://github.com/keithpatton/diataxis-agent-skill) — strong classification, audit, and anti-pattern coverage.
- [jayteealao/agent-skills: Diátaxis plugin](https://github.com/jayteealao/agent-skills) — useful treatment of READMEs as routing pages.

This repo skill is a concise original synthesis. It deliberately avoids community rules that make user confirmation mandatory for routine classification, prohibit all mixed-purpose pages, force folder layouts, or treat Diátaxis as a completeness checklist.

Diátaxis is attributed to Daniele Procida. Consult the authoritative site for its current licensing and citation guidance before republishing substantial source material.
