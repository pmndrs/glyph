#!/usr/bin/env node

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
const listedLimit = 40;

/** Validation findings with repository-relative paths, ready to show a contributor. */
export async function docsFindings(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const result = await validateOkf(path.join(root, '.agents/docs'), { workspaceRoot: root });
  return [...result.conformance, ...result.profile].map((finding) => finding.replaceAll(`${root}${path.sep}`, ''));
}

/** The pull-request comment: one row per changed package, attested at this head or not, plus findings. */
export function renderDocsReport({ rows, findings, base }) {
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
      const claim =
        row.attestation === undefined ? 'none' : `${row.attestation.author}: ${clip(row.attestation.note, 120)}`;
      const stale =
        row.status === 'stale'
          ? ` (made at \`${short(row.attestation.source)}\`, source now \`${short(row.current)}\`)`
          : '';
      const icon = { attested: '✅', stale: '⚠️', unattested: '❌' }[row.status];
      out.push(`| \`${row.package}\` | ${row.conceptEdited ? 'edited' : 'not edited'} | ${claim}${stale} | ${icon} |`);
    }
    out.push('', '✅ attested at this head · ⚠️ stale: source changed after attesting · ❌ unattested');
    if (open.length > 0) {
      out.push(
        '',
        'After your last source change, update the concept if it is now wrong, then record what you changed and checked:',
        '',
        ...open.map((row) => `- ${run(`docs:attest -- ${row.package} "<what you changed and checked>"`)}`),
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
    '## Resolve',
    '',
    "1. For each attestation, check its claim against that pull request's diff and correct the concept where the claim is",
    '   wrong or incomplete. For each gap, review that change and bring the concept up to date from it.',
    `2. Run ${run('docs:verify -- <slug>')}. It writes one verification log entry and removes the consumed attestations.`,
    '3. In that entry, set each `verdict` (`confirmed` or `corrected` for an attestation, `documented` or `no-change` for a',
    `   gap) and replace the summary, then run ${run('docs:check')} and open one pull request.`,
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
 * The commit-time reminder, shown once per package per branch so an agent is told what to do without
 * being nagged into a loop. Empty when there is nothing new to say; it never blocks the commit.
 */
export function renderCommitReport({ packages, findings }) {
  if (packages.length === 0 && findings.length === 0) return '';
  const out = ['docs: advisory report (never blocks; shown once per package per branch)'];
  if (packages.length > 0) {
    out.push('', 'You changed package source. Before you push, after your last source change:');
    for (const entry of packages) {
      out.push(
        `  ${entry.name}: update ${entry.concept} if it is now wrong, then`,
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
      const rows = await pullRequestAttestations(root, base, option('--head') ?? 'HEAD');
      const body = renderDocsReport({ rows, findings, base });
      if (markdownPath !== undefined) await writeFile(markdownPath, body);
      process.stdout.write(body);
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
