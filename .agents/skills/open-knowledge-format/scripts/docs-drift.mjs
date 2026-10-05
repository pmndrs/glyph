#!/usr/bin/env node
/* @workflow {"name": "docs:drift", "args": ["."], "summary": "Audit docs intent and validity: with no flags, the per-package status behind the Sync agent docs issue; `-- --markdown <file>` writes that issue body; `-- --pr <base> [--head <sha>] [--repository <owner/name>] [--annotations]` prints the advisory pull-request report, or GitHub warning annotations for it.", "requirements": "The repository-pinned Node.js runtime and full git history.", "writes": "stdout and the optional --markdown file"} */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { auditDocs, git, pullRequestAttestations, short } from './attestations.mjs';
import { validateOkf } from './validate-okf.mjs';

/**
 * Advisory docs reports. None of them fails anything: they show contributors and reviewers what intent
 * is attested, what is missing, and the one command that fixes each item.
 */

/** Marks the single issue the drift workflow rewrites; never change it without migrating that issue. */
export const driftIssueMarker = '<!-- okf-docs-drift -->';
/** Marks the single pull-request comment the docs report rewrites. */
export const docsReportMarker = '<!-- okf-docs-report -->';

const run = (name) => `\`mise exec -- pnpm scripts run ${name}\``;

/** The review agent's instructions, the one procedure for resolving the tracking issue. */
const reviewPrompt = [
  'Resolve the open "Sync agent docs" issue in pmndrs/glyph with one pull request from a branch off main.',
  'Use full git history (git fetch --unshallow if the clone is shallow). Do not change package source.',
  '1. Run `mise exec -- pnpm scripts run docs:drift` to list the packages that need verification.',
  "2. For each pending attestation, read its claim and that pull request's diff (gh pr diff <number> or",
  '   git show <commit>), then correct the package concept wherever the claim or the concept is wrong or',
  '   incomplete. Find the sections to check with docs:outline and docs:search instead of reading whole files.',
  '3. For each gap, review that change the same way and bring its package concept up to date.',
  '4. Run `mise exec -- pnpm scripts run docs:verify -- verify-<YYYY-MM-DD>`. In the log entry it writes, set',
  '   every verdict (confirmed or corrected for an attestation, documented or no-change for a gap) and replace',
  '   the summary with what you checked and changed. Do not edit or restore the attestations it removes.',
  '5. Run `mise exec -- pnpm scripts run docs:check` until it reports 0 errors, commit with a Conventional',
  '   Commit message, and open the pull request titled "docs: verify agent docs".',
];
const listedLimit = 40;

/** Validation findings with repository-relative paths, ready to show a contributor. */
export async function docsFindings(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const result = await validateOkf(path.join(root, '.agents/docs'), { workspaceRoot: root });
  return [...result.conformance, ...result.profile].map((finding) => finding.replaceAll(`${root}${path.sep}`, ''));
}

/**
 * The pull-request comment: one row per changed package, attested at this head or not, plus findings.
 * With `links` ({ repository, ref }), each concept links to its file at the pull request's head.
 */
export function renderDocsReport({ rows, findings, base, links }) {
  const concept = (row) => {
    const name = `\`${row.concept.replace(/^\.agents\/docs\//u, '')}\``;
    return links === undefined
      ? name
      : `[${name}](https://github.com/${links.repository}/blob/${links.ref}/${row.concept})`;
  };
  const out = [docsReportMarker, '## Docs report 📚', ''];
  const open = rows.filter((row) => row.status !== 'attested');
  if (rows.length === 0 && findings.length === 0) {
    out.push(
      `Nothing to do: this pull request changes no package source, and the bundle validates against \`${base}\`.`,
    );
    return `${out.join('\n')}\n`;
  }
  out.push(
    open.length === 0 && findings.length === 0
      ? 'Every changed package is attested at this head. A reviewer verifies each claim after merge.'
      : 'Advisory only — this never blocks merging. Anything left open is tracked in the `Sync agent docs` issue and verified after merge.',
  );
  if (rows.length > 0) {
    out.push('', '| Package | Concept | Attestation | Status |', '| --- | --- | --- | --- |');
    for (const row of rows) {
      // The pull request already carries authorship, so the claim is the note alone.
      const claim = row.attestation === undefined ? 'none' : clip(row.attestation.note, 120);
      const stale =
        row.status === 'stale'
          ? ` (made at \`${short(row.attestation.source)}\`, source now \`${short(row.current)}\`)`
          : '';
      const icon = { attested: '✅', stale: '⚠️', unattested: '❌' }[row.status];
      out.push(
        `| \`${row.package}\` | ${concept(row)} · ${row.conceptEdited ? 'edited' : 'not edited'} | ${claim}${stale} | ${icon} |`,
      );
    }
    out.push('', '✅ attested · ⚠️ stale · ❌ missing');
    if (open.length > 0) {
      out.push(
        '',
        'After your last source change, update each concept if it is now wrong, then record what you changed and checked:',
        '',
        ...open.map(
          (row) => `- ${concept(row)}: ${run(`docs:attest -- ${row.package} "<what you changed and checked>"`)}`,
        ),
      );
    }
  }
  if (findings.length > 0) {
    out.push('', '### Validation findings', '', `Reproduce with ${run('docs:check')}.`, '');
    out.push(...findings.slice(0, listedLimit).map((finding) => `- ${finding}`));
    if (findings.length > listedLimit) out.push(`- …and ${findings.length - listedLimit} more`);
  }
  return `${out.join('\n')}\n`;
}

/**
 * GitHub workflow commands for the same findings: each missing or stale attestation and each validation
 * finding becomes a warning annotation on its file. Warnings mark the check without failing it, so the
 * pull request stays mergeable while the call-out is visible in the checks list and the run summary.
 */
export function renderAnnotations({ rows, findings }) {
  const property = (value) => escapeCommand(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
  const lines = [];
  for (const row of rows.filter((candidate) => candidate.status !== 'attested')) {
    const title = row.status === 'stale' ? 'Docs attestation stale' : 'Docs attestation missing';
    const message =
      `${row.package} changed ${row.status === 'stale' ? 'after its attestation' : 'without an attestation'}. ` +
      `Update this concept if it is now wrong, then run: mise exec -- pnpm scripts run docs:attest -- ${row.package} "<what you changed and checked>"`;
    lines.push(`::warning file=${property(row.concept)},title=${property(title)}::${escapeCommand(message)}`);
  }
  for (const finding of findings) {
    const [file, ...rest] = finding.split(': ');
    const message = `${rest.join(': ')} (reproduce with mise exec -- pnpm scripts run docs:check)`;
    lines.push(`::warning file=${property(file)},title=${property('Docs validation')}::${escapeCommand(message)}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function escapeCommand(value) {
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

/** The main-branch issue: per package, pending attestations and gaps for the reviewer, plus findings. */
export function renderDriftIssue(audit, options = {}) {
  const findings = options.findings ?? [];
  const head = options.head === undefined ? '' : ` at \`${options.head}\``;
  const open = audit.filter((entry) => entry.status !== 'current');
  const clean = open.length === 0 && findings.length === 0;
  // The workflow closes or reopens the issue from this line, never from the prose around it.
  const out = [driftIssueMarker, `<!-- okf-docs-status: ${clean ? 'clean' : 'open'} -->`, ''];
  if (clean) {
    out.push(
      `Every workspace package concept is verified current and the bundle validates${head}. This issue reopens when either changes.`,
    );
    return `${out.join('\n')}\n`;
  }
  const pending = open.reduce((sum, entry) => sum + entry.pending.length, 0);
  const gaps = open.reduce((sum, entry) => sum + entry.gaps.length, 0);
  out.push(
    `${open.length} of ${audit.length} packages need verification${head}: ${pending} pending ${plural(pending, 'attestation')}, ` +
      `${gaps} ${plural(gaps, 'gap')} (merged without an attestation), ${findings.length} validation ${plural(findings.length, 'finding')}. ` +
      'This issue is rewritten on every push to `main`; fix the docs, not this issue.',
    '',
    '## Agent prompt',
    '',
    'Copy this to the review agent; it covers every item listed below.',
    '',
    '```text',
    ...reviewPrompt,
    '```',
  );
  for (const entry of open) {
    const baseline =
      entry.verified === undefined
        ? 'never verified'
        : `verified at \`${short(entry.verified)}\` in \`${entry.verification}\``;
    out.push(
      '',
      `### \`${entry.package}\``,
      '',
      `Concept \`${entry.concept}\`; ${baseline}; source now \`${short(entry.current)}\`.`,
    );
    if (entry.pending.length > 0) {
      out.push('', '| Attestation | Pull request | Claim |', '| --- | --- | --- |');
      for (const record of entry.pending.slice(0, listedLimit)) {
        out.push(
          `| \`${record.file}\` | ${record.pr ? `#${record.pr}` : (record.commit ?? 'unmerged')} | ${clip(record.note, 160)} |`,
        );
      }
    }
    if (entry.gaps.length > 0) {
      out.push('', '| Gap | Commit | Subject |', '| --- | --- | --- |');
      for (const gap of entry.gaps.slice(0, listedLimit)) {
        out.push(`| ${gap.pr ? `#${gap.pr}` : 'direct push'} | \`${gap.short}\` | ${clip(gap.subject, 120)} |`);
      }
      if (entry.gaps.length > listedLimit) out.push(`| … | | ${entry.gaps.length - listedLimit} more |`);
    }
  }
  if (findings.length > 0) {
    out.push('', '## Validation findings', '', `Reproduce with ${run('docs:check')}.`, '');
    out.push(...findings.slice(0, listedLimit).map((finding) => `- ${finding}`));
    if (findings.length > listedLimit) out.push(`- …and ${findings.length - listedLimit} more`);
  }
  return `${out.join('\n')}\n`;
}

/**
 * The commit-time reminder, repeated on every commit until each package the branch changed is attested
 * at the source about to be committed. Attesting after the last source change silences it, so the
 * reminder can never trap an agent in a loop. Empty when there is nothing to say; it never blocks.
 */
export function renderCommitReport({ packages, findings }) {
  if (packages.length === 0 && findings.length === 0) return '';
  const out = ['docs: advisory report (never blocks; repeats until each changed package is attested)'];
  if (packages.length > 0) {
    out.push('', 'After your last source change, update each concept if it is now wrong, then attest:');
    for (const entry of packages) {
      const icon = entry.status === 'stale' ? '⚠️ stale' : '❌ missing';
      out.push(
        `  ${icon}  ${entry.name} (${entry.concept})`,
        `    mise exec -- pnpm scripts run docs:attest -- ${entry.name} "<what you changed and checked>"`,
      );
    }
  }
  if (findings.length > 0) {
    out.push('', 'Validation findings (reproduce with mise exec -- pnpm scripts run docs:check):');
    out.push(...findings.slice(0, listedLimit).map((finding) => `  ${finding}`));
    if (findings.length > listedLimit) out.push(`  …and ${findings.length - listedLimit} more`);
  }
  return `${out.join('\n')}\n`;
}

function clip(text, length) {
  const flat = String(text ?? '')
    .replace(/\s+/gu, ' ')
    .replaceAll('|', '\\|')
    .trim();
  return flat.length <= length ? flat : `${flat.slice(0, length - 1)}…`;
}

function plural(count, word) {
  return count === 1 ? word : `${word}s`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [workspaceRoot = '.', ...flags] = process.argv.slice(2);
  const option = (name) => {
    const index = flags.indexOf(name);
    if (index === -1) return undefined;
    const value = flags[index + 1];
    if (value === undefined) throw new Error(`${name} requires a value`);
    return value;
  };
  try {
    const root = path.resolve(workspaceRoot);
    const markdownPath = option('--markdown');
    const base = option('--pr');
    const findings = await docsFindings(root);
    if (base !== undefined) {
      // Pull-request mode, judged at the pull request's own head (`--head`), never a merge preview.
      const head = option('--head') ?? 'HEAD';
      const rows = await pullRequestAttestations(root, base, head);
      const repository = option('--repository');
      const body = renderDocsReport({ rows, findings, base, links: repository && { repository, ref: head } });
      if (markdownPath !== undefined) await writeFile(markdownPath, body);
      // In CI, stdout carries workflow commands that GitHub turns into warning annotations.
      process.stdout.write(flags.includes('--annotations') ? renderAnnotations({ rows, findings }) : body);
    } else {
      const audit = await auditDocs(root);
      const head = (await git(root, ['rev-parse', '--short', 'HEAD'])).trim();
      if (markdownPath !== undefined) await writeFile(markdownPath, renderDriftIssue(audit, { head, findings }));
      for (const entry of audit) {
        process.stdout.write(
          `${entry.package}\t${entry.status}\tpending ${entry.pending.length}\tgaps ${entry.gaps.length}\n`,
        );
      }
      for (const finding of findings) process.stdout.write(`finding\t${finding}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
