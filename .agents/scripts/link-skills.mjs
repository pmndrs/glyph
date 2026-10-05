#!/usr/bin/env node
/* @workflow { "name": "skills:link", "summary": "Link every .agents/skills/<name> into the directory an agent harness reads skills from: `-- <skills-dir>`, for example `.claude/skills`. Safe to repeat.", "requirements": "Node.js.", "writes": "Directory links in the given skills directory." } */

import { execFileSync } from 'node:child_process';
import { lstat, mkdir, opendir, readlink, realpath, symlink, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Harnesses read skills from different directories, while the repository keeps one cross-tool source in
 * `.agents/skills`. An agent that cannot see the repository skills names its own skills directory and this
 * links each skill there. Links are owned by this tool only when they point into `.agents/skills`: it
 * creates missing ones, repairs moved ones, and removes ones whose skill was deleted, but never replaces
 * a real directory or a link the harness or a person put there.
 */

export class SkillLinkConflict extends Error {
  /** @param {string} path @param {string} expectation */
  constructor(path, expectation) {
    super(`Cannot link ${path}: ${expectation}`);
    this.name = 'SkillLinkConflict';
  }
}

/**
 * @param {{ repositoryRoot: string, target: string, platform?: NodeJS.Platform }} options
 * @returns {Promise<{ created: string[], repaired: string[], removed: string[] }>}
 */
export async function linkSkills({ repositoryRoot, target, platform = process.platform }) {
  const root = await realpath(repositoryRoot);
  const skillRoot = join(root, '.agents', 'skills');
  const destinationRoot = resolve(root, target);
  if (isWithin(skillRoot, destinationRoot)) {
    throw new SkillLinkConflict(destinationRoot, 'the target must be outside .agents/skills');
  }
  await mkdir(destinationRoot, { recursive: true });
  const result = { created: [], repaired: [], removed: [] };

  const skills = await skillDirectories(skillRoot);
  const names = new Set(skills.map((skill) => skill.slice(skillRoot.length + 1)));

  for await (const entry of await opendir(destinationRoot)) {
    if (names.has(entry.name) || !entry.isSymbolicLink()) continue;
    const destination = join(destinationRoot, entry.name);
    if (!isWithin(skillRoot, await linkTarget(destination))) continue;
    await unlink(destination);
    result.removed.push(destination);
  }

  for (const source of skills) {
    const destination = join(destinationRoot, source.slice(skillRoot.length + 1));
    const kind = await pathKind(destination);
    if (kind === 'missing') {
      await createLink(source, destination, platform);
      result.created.push(destination);
      continue;
    }
    if (kind !== 'symlink') throw new SkillLinkConflict(destination, 'a non-link already uses this skill name');
    let current;
    try {
      current = await realpath(destination);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      current = await linkTarget(destination);
    }
    if (current === (await realpath(source))) continue;
    await unlink(destination);
    await createLink(source, destination, platform);
    result.repaired.push(destination);
  }
  return result;
}

/** @param {string} skillRoot */
async function skillDirectories(skillRoot) {
  const skills = [];
  for await (const entry of await opendir(skillRoot)) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const skill = join(skillRoot, entry.name);
    if ((await pathKind(join(skill, 'SKILL.md'))) === 'file') skills.push(skill);
  }
  return skills.sort((left, right) => left.localeCompare(right));
}

/** @param {string} path */
async function pathKind(path) {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) return 'symlink';
    if (stats.isDirectory()) return 'directory';
    return stats.isFile() ? 'file' : 'other';
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing';
    throw error;
  }
}

/** @param {string} link */
async function linkTarget(link) {
  return resolve(dirname(link), await readlink(link));
}

/** @param {string} source @param {string} destination @param {NodeJS.Platform} platform */
async function createLink(source, destination, platform) {
  // Relative links survive moving the checkout; Windows junctions require absolute targets.
  const target = platform === 'win32' ? source : relative(dirname(destination), source);
  await symlink(target, destination, platform === 'win32' ? 'junction' : 'dir');
}

/** @param {string} parent @param {string} child */
function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

/** Links inside the checkout must stay untracked; reports the ones git would pick up. */
function unignored(root, paths) {
  const inside = paths.filter((path) => isWithin(root, path)).map((path) => relative(root, path));
  if (inside.length === 0) return [];
  try {
    const ignored = execFileSync('git', ['check-ignore', '--', ...inside], { cwd: root, encoding: 'utf8' });
    const set = new Set(ignored.split('\n').filter(Boolean));
    return inside.filter((path) => !set.has(path));
  } catch (error) {
    // `git check-ignore` exits 1 when nothing is ignored; any other failure means git is unavailable.
    return error?.status === 1 ? inside : [];
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const target = process.argv.slice(2).find((argument) => argument !== '--');
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  try {
    if (target === undefined) throw new Error('usage: link-skills.mjs <skills-dir>   (for example .claude/skills)');
    const result = await linkSkills({ repositoryRoot, target });
    const changed = [...result.created, ...result.repaired, ...result.removed];
    const root = await realpath(repositoryRoot);
    process.stdout.write(
      changed.length === 0
        ? `Repository skills are linked in ${target}.\n`
        : `${changed.map((path) => relative(root, path)).join('\n')}\n`,
    );
    const tracked = unignored(root, [...result.created, ...result.repaired]);
    if (tracked.length > 0) {
      process.stderr.write(`Add these links to .gitignore so they are never committed:\n${tracked.join('\n')}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
