import { lstat, mkdir, opendir, readFile, readlink, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLAUDE_IMPORT = '@AGENTS.md';
const CLAUDE_SKILL_IGNORES = new Set(['claude-review']);
const SKIPPED_DIRECTORIES = new Set(['.git', '.claude', 'coverage', 'dist', 'node_modules', 'target']);

export type SyncResult = {
  createdClaudeFiles: string[];
  updatedClaudeFiles: string[];
  createdSkillLinks: string[];
  repairedSkillLinks: string[];
  removedSkillLinks: string[];
};

type ProjectInventory = {
  agentsFiles: string[];
  skillRoots: string[];
};

type SyncOptions = {
  platform?: NodeJS.Platform;
};

export class ClaudeSyncConflict extends Error {
  constructor(path: string, expectation: string) {
    super(`Cannot synchronize ${path}: ${expectation}`);
    this.name = 'ClaudeSyncConflict';
  }
}

function emptyResult(): SyncResult {
  return {
    createdClaudeFiles: [],
    updatedClaudeFiles: [],
    createdSkillLinks: [],
    repairedSkillLinks: [],
    removedSkillLinks: [],
  };
}

function hasAgentsImport(contents: string): boolean {
  return contents.split(/\r?\n/u).some((line) => /^\s*@(?:\.\/)?AGENTS\.md\s*$/u.test(line));
}

function isWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent === '' ||
    (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..' && !isAbsolute(pathFromParent))
  );
}

async function pathKind(path: string): Promise<'missing' | 'symlink' | 'directory' | 'file' | 'other'> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) return 'symlink';
    if (stats.isDirectory()) return 'directory';
    if (stats.isFile()) return 'file';
    return 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

async function discoverProject(root: string): Promise<ProjectInventory> {
  const inventory: ProjectInventory = { agentsFiles: [], skillRoots: [] };

  async function visit(directory: string): Promise<void> {
    const entries = [];
    for await (const entry of await opendir(directory)) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isFile() && entry.name === 'AGENTS.md') inventory.agentsFiles.push(path);
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name === '.agents') {
        const skills = join(path, 'skills');
        if ((await pathKind(skills)) === 'directory') inventory.skillRoots.push(skills);
      }
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await visit(path);
    }
  }

  await visit(root);
  return inventory;
}

async function synchronizeClaudeFile(agentsPath: string, result: SyncResult): Promise<void> {
  const claudePath = join(dirname(agentsPath), 'CLAUDE.md');
  const kind = await pathKind(claudePath);

  if (kind === 'missing') {
    await writeFile(claudePath, `${CLAUDE_IMPORT}\n`, 'utf8');
    result.createdClaudeFiles.push(claudePath);
    return;
  }

  if (kind === 'symlink') {
    const linkedPath = resolve(dirname(claudePath), await readlink(claudePath));
    if (linkedPath === agentsPath) return;
    throw new ClaudeSyncConflict(claudePath, 'the existing symlink does not target the sibling AGENTS.md');
  }

  if (kind !== 'file') throw new ClaudeSyncConflict(claudePath, 'the path must be a regular file or AGENTS.md symlink');

  const contents = await readFile(claudePath, 'utf8');
  if (hasAgentsImport(contents)) return;
  await writeFile(claudePath, contents.length === 0 ? `${CLAUDE_IMPORT}\n` : `${CLAUDE_IMPORT}\n${contents}`, 'utf8');
  result.updatedClaudeFiles.push(claudePath);
}

async function verifyRootClaudeFile(projectRoot: string): Promise<void> {
  const claudePath = join(projectRoot, 'CLAUDE.md');
  if ((await pathKind(claudePath)) !== 'file') {
    throw new ClaudeSyncConflict(claudePath, 'the checked-in root bootstrap must be a regular file');
  }
  const contents = await readFile(claudePath, 'utf8');
  if (!hasAgentsImport(contents)) {
    throw new ClaudeSyncConflict(claudePath, 'the checked-in root bootstrap must import @AGENTS.md');
  }
}

async function directSkillDirectories(skillRoot: string): Promise<string[]> {
  const skills = [];
  for await (const entry of await opendir(skillRoot)) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || CLAUDE_SKILL_IGNORES.has(entry.name)) continue;
    const skillPath = join(skillRoot, entry.name);
    if ((await pathKind(join(skillPath, 'SKILL.md'))) === 'file') skills.push(skillPath);
  }
  return skills.sort((left, right) => left.localeCompare(right));
}

async function resolveLink(linkPath: string): Promise<string> {
  const target = await readlink(linkPath);
  return resolve(dirname(linkPath), target);
}

async function createDirectoryLink(source: string, destination: string, platform: NodeJS.Platform): Promise<void> {
  const target = platform === 'win32' ? source : relative(dirname(destination), source);
  await symlink(target, destination, platform === 'win32' ? 'junction' : 'dir');
}

async function synchronizeSkillRoot(skillRoot: string, result: SyncResult, platform: NodeJS.Platform): Promise<void> {
  const projectDirectory = dirname(dirname(skillRoot));
  const claudeSkillRoot = join(projectDirectory, '.claude', 'skills');
  await mkdir(claudeSkillRoot, { recursive: true });

  const sourceSkills = await directSkillDirectories(skillRoot);
  const expectedNames = new Set(sourceSkills.map((skill) => skill.slice(skillRoot.length + 1)));

  for await (const entry of await opendir(claudeSkillRoot)) {
    if (expectedNames.has(entry.name) || !entry.isSymbolicLink()) continue;
    const destination = join(claudeSkillRoot, entry.name);
    const target = await resolveLink(destination);
    if (!isWithin(skillRoot, target)) continue;
    await unlink(destination);
    result.removedSkillLinks.push(destination);
  }

  for (const source of sourceSkills) {
    const destination = join(claudeSkillRoot, source.slice(skillRoot.length + 1));
    const kind = await pathKind(destination);
    if (kind === 'missing') {
      await createDirectoryLink(source, destination, platform);
      result.createdSkillLinks.push(destination);
      continue;
    }
    if (kind !== 'symlink') {
      throw new ClaudeSyncConflict(destination, 'the generated Claude skill path is not a directory link');
    }

    let currentTarget: string;
    try {
      currentTarget = await realpath(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      currentTarget = await resolveLink(destination);
    }
    if (currentTarget === (await realpath(source))) continue;
    await unlink(destination);
    await createDirectoryLink(source, destination, platform);
    result.repairedSkillLinks.push(destination);
  }
}

export async function synchronizeClaudeProject(root: string, options: SyncOptions = {}): Promise<SyncResult> {
  const projectRoot = await realpath(root);
  const inventory = await discoverProject(projectRoot);
  const result = emptyResult();

  await verifyRootClaudeFile(projectRoot);
  for (const agentsPath of inventory.agentsFiles) {
    if (dirname(agentsPath) !== projectRoot) await synchronizeClaudeFile(agentsPath, result);
  }
  for (const skillRoot of inventory.skillRoots)
    await synchronizeSkillRoot(skillRoot, result, options.platform ?? process.platform);
  return result;
}

function changedPaths(result: SyncResult): string[] {
  return [
    ...result.createdClaudeFiles,
    ...result.updatedClaudeFiles,
    ...result.createdSkillLinks,
    ...result.repairedSkillLinks,
    ...result.removedSkillLinks,
  ];
}

async function main(): Promise<void> {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const result = await synchronizeClaudeProject(projectRoot);
  if (process.argv.includes('--verbose')) {
    const paths = changedPaths(result).map((path) => relative(projectRoot, path));
    process.stdout.write(
      paths.length === 0 ? 'Claude agent compatibility is synchronized.\n' : `${paths.join('\n')}\n`,
    );
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
