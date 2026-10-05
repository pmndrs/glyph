import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ClaudeSyncConflict, synchronizeClaudeProject } from './sync-agent-config.ts';

async function fixture(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'pmndrs-glyph-claude-sync-')));
}

async function createSkill(root: string, name: string): Promise<string> {
  const skill = join(root, '.agents', 'skills', name);
  await mkdir(join(skill, 'references'), { recursive: true });
  await writeFile(join(skill, 'SKILL.md'), `# ${name}\n\nRead references/guide.md.\n`);
  await writeFile(join(skill, 'references', 'guide.md'), 'guide\n');
  return skill;
}

function removeFixture(testContext: test.TestContext, root: string): void {
  testContext.after(() => rm(root, { recursive: true, force: true }));
}

test('configures a cross-platform startup hook without a shell command', async () => {
  const hookDirectory = dirname(fileURLToPath(import.meta.url));
  const settings = JSON.parse(await readFile(join(hookDirectory, '..', 'settings.json'), 'utf8')) as unknown;

  assert.deepEqual(settings, {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup',
          hooks: [
            {
              type: 'command',
              command: 'node',
              args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/sync-agent-config.ts'],
              timeout: 10,
            },
          ],
        },
      ],
    },
  });
});

test('links complete skill directories and leaves AGENTS.md to Claude Code', async (testContext) => {
  const root = await fixture();
  removeFixture(testContext, root);
  const nested = join(root, 'packages', 'example');
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, 'AGENTS.md'), '# Nested agents\n');
  const sourceSkill = await createSkill(root, 'example');

  const result = await synchronizeClaudeProject(root);

  assert.equal(await realpath(join(root, '.claude', 'skills', 'example')), await realpath(sourceSkill));
  assert.equal(await readFile(join(root, '.claude', 'skills', 'example', 'references', 'guide.md'), 'utf8'), 'guide\n');
  await assert.rejects(readFile(join(nested, 'CLAUDE.md'), 'utf8'), { code: 'ENOENT' });
  assert.equal(result.createdSkillLinks.length, 1);
});

test('repairs generated links and removes stale links into the agent skill root', async (testContext) => {
  const root = await fixture();
  removeFixture(testContext, root);
  const sourceSkill = await createSkill(root, 'current');
  const staleSkill = await createSkill(root, 'stale');
  const claudeSkills = join(root, '.claude', 'skills');
  await mkdir(claudeSkills, { recursive: true });
  await symlink(staleSkill, join(claudeSkills, 'current'), 'dir');
  await symlink(staleSkill, join(claudeSkills, 'removed'), 'dir');
  await symlink(root, join(claudeSkills, 'claude-only'), 'dir');

  const result = await synchronizeClaudeProject(root);

  assert.equal(await realpath(join(claudeSkills, 'current')), await realpath(sourceSkill));
  assert.equal(await realpath(join(claudeSkills, 'claude-only')), await realpath(root));
  assert.deepEqual(result.repairedSkillLinks, [join(claudeSkills, 'current')]);
  assert.deepEqual(result.removedSkillLinks, [join(claudeSkills, 'removed')]);
});

test('rejects a non-generated Claude skill collision', async (testContext) => {
  const root = await fixture();
  removeFixture(testContext, root);
  await createSkill(root, 'example');
  await mkdir(join(root, '.claude', 'skills', 'example'), { recursive: true });

  await assert.rejects(synchronizeClaudeProject(root), ClaudeSyncConflict);
});
