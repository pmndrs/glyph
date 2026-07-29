---
name: diataxis-docs
description: Design, classify, write, audit, or restructure technical documentation with the Diátaxis framework. Use for tutorials, how-to guides, reference material, explanations, documentation maps, README routing, documentation audits, or requests to separate mixed-purpose docs. Do not apply it automatically to internal plans, ADRs, research logs, or specifications unless the user wants those artifacts organized as product documentation.
---

# Diátaxis documentation

Use Diátaxis as a decision tool, not a four-folder template. Start from the reader's immediate need, give each page one primary purpose, and link across purposes when the reader is likely to need a different kind of help.

Read [references/framework.md](references/framework.md) before a broad documentation audit, information-architecture change, or ambiguous classification. It records the primary sources, the compass, and the distinctions most often lost in shorter skills.

## Classify the need

Ask two questions internally:

1. Does the reader need action or understanding?
2. Are they acquiring skill or applying existing skill?

Map the answers:

| Reader need                          | Mode                    | Documentation type |
| ------------------------------------ | ----------------------- | ------------------ |
| Learn by doing                       | action + acquisition    | Tutorial           |
| Complete a real task                 | action + application    | How-to guide       |
| Look up facts while working          | cognition + application | Reference          |
| Understand reasons and relationships | cognition + acquisition | Explanation        |

Infer the type when the evidence is clear. Ask only when choosing incorrectly would materially change the requested artifact.

## Choose the operation

### Create or revise one page

1. State the intended reader and outcome in working notes.
2. Select one primary documentation type.
3. Preserve accurate repository-specific facts and examples.
4. Write according to the type rules below.
5. Move substantial off-purpose material to a better page, or link to an existing page.
6. Check navigation so the reader has an obvious next destination.

### Audit a documentation set

1. Inventory pages and their apparent audience.
2. Classify each page by its dominant need; record uncertain or mixed pages.
3. Find user journeys and missing destinations, not merely empty quadrants.
4. Flag misleading titles, duplicated material, stale facts, dead ends, and mixed-purpose pages.
5. Recommend the smallest useful restructure. Do not create empty sections merely to complete a matrix.
6. Report evidence and concrete moves, splits, merges, or links.

### Restructure mixed documentation

1. Preserve the source material and map every substantive section.
2. Choose a primary page for each distinct reader need.
3. Split only where the mix harms usability; short context or a small example may remain.
4. Replace duplication with purposeful cross-links.
5. Keep landing pages and READMEs as routing surfaces. They may summarize several types without pretending to be one of them.
6. Verify that no claims or operational steps were lost.

## Write by type

### Tutorial

- Own the learner's success.
- Provide one reliable path with an early visible result.
- Use concrete steps, expected observations, and a coherent learning sequence.
- Minimize branching, alternatives, and extended theory.
- Test commands and examples when the repository permits it.

### How-to guide

- Start from a specific real-world goal.
- Assume a competent practitioner and omit foundational teaching.
- Use ordered actions and conditionals only where the task requires them.
- Include prerequisites and success checks.
- Link to reference facts instead of reproducing exhaustive option lists.

### Reference

- Describe the machinery accurately, completely, and consistently.
- Mirror the product or API structure.
- Prefer stable headings, tables, signatures, defaults, constraints, and edge cases.
- Keep instruction and rationale subordinate; link outward for tasks and concepts.
- Generate from authoritative interfaces where possible, then verify the result.

### Explanation

- Explain why the subject exists and how its parts relate.
- Discuss constraints, history, alternatives, and tradeoffs.
- Connect the topic to adjacent concepts.
- Avoid turning the page into a numbered procedure or an exhaustive field catalog.

## Respect repository context

- Follow existing terminology, style, navigation, and contribution rules.
- Treat plans, decision records, research notes, release notes, and issue backlogs as valid genres outside the four product-documentation types.
- Keep a README focused on orientation, first success, status, and routes to deeper documentation.
- Preserve existing document frontmatter; Diátaxis classification does not authorize removing or rewriting repository metadata conventions.
- Treat `index.md` files as navigation surfaces. Do not flag their purposeful links and short descriptions as duplicated human-facing documentation.
- Prefer gradual improvement over a repository-wide rewrite without evidence.
- Do not sacrifice accuracy, runnable examples, accessibility, or source attribution for quadrant purity.

## Final check

- Identify the primary reader need in one sentence.
- Confirm the title signals that need.
- Confirm the page behaves like its chosen type.
- Split or link only where another need would interrupt the page's flow.
- Verify facts and examples against current sources.
- Make the next step discoverable.
- Confirm existing frontmatter remains intact and navigation indexes were not mistaken for duplicate content.
