import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ClaudeSyncConflict, synchronizeClaudeProject } from './sync-agent-config.ts';

const ROOT_CLAUDE =
  'When the startup hook did not run—such as in Claude Desktop, after resuming a session, or after adding `.agents/skills`—run `node .claude/hooks/sync-agent-config.ts` to synchronize your Claude skills and scoped agent context.\n\n@AGENTS.md\n';

async function fixture(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'pmndrs-text-claude-sync-')));
}

async function createSkill(root: string, name: string): Promise<string> {
  const skill = join(root, '.agents', 'skills', name);
  await mkdir(join(skill, 'references'), { recursive: true });
  await writeFile(join(skill, 'SKILL.md'), `# ${name}\n\nRead references/guide.md.\n`);
  await writeFile(join(skill, 'references', 'guide.md'), 'guide\n');
  return skill;
}

async function createRootInstructions(root: string): Promise<void> {
  await writeFile(join(root, 'AGENTS.md'), '# Root agents\n');
  await writeFile(join(root, 'CLAUDE.md'), ROOT_CLAUDE);
}

function removeFixture(testContext: test.TestContext, root: string): void {
  testContext.after(() => rm(root, { recursive: true, force: true }));
}

test('configures a cross-platform startup hook without a shell command', async () => {
  const hookDirectory = dirname(fileURLToPath(import.meta.url));
  const settings = JSON.parse(await readFile(join(hookDirectory, '..', 'settings.json'), 'utf8')) as unknown;
  const rootClaude = await readFile(join(hookDirectory, '..', '..', 'CLAUDE.md'), 'utf8');

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
  assert.equal(rootClaude, ROOT_CLAUDE);
});

test('creates Claude imports and complete skill directory links', async (testContext) => {
  const root = await fixture();
  removeFixture(testContext, root);
  await createRootInstructions(root);
  const nested = join(root, 'packages', 'example');
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, 'AGENTS.md'), '# Nested agents\n');
  const sourceSkill = await createSkill(root, 'example');
  await createSkill(root, 'claude-review');

  const result = await synchronizeClaudeProject(root);

  assert.equal(await readFile(join(root, 'CLAUDE.md'), 'utf8'), ROOT_CLAUDE);
  assert.equal(await readFile(join(nested, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.equal(await realpath(join(root, '.claude', 'skills', 'example')), await realpath(sourceSkill));
  assert.equal(await readFile(join(root, '.claude', 'skills', 'example', 'references', 'guide.md'), 'utf8'), 'guide\n');
  await assert.rejects(realpath(join(root, '.claude', 'skills', 'claude-review')), { code: 'ENOENT' });
  assert.equal(result.createdClaudeFiles.length, 1);
  assert.equal(result.createdSkillLinks.length, 1);
});

test('preserves nested Claude-specific instructions while adding the AGENTS import once', async (testContext) => {
  const root = await fixture();
  removeFixture(testContext, root);
  await createRootInstructions(root);
  const nested = join(root, 'packages', 'example');
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, 'AGENTS.md'), '# Agents\n');
  await writeFile(join(nested, 'CLAUDE.md'), '# Local Claude guidance\n');

  await synchronizeClaudeProject(root);
  await synchronizeClaudeProject(root);

  assert.equal(await readFile(join(nested, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n# Local Claude guidance\n');
});

test('rejects a missing checked-in root bootstrap', async (testContext) => {
  const root = await fixture();
  removeFixture(testContext, root);
  await writeFile(join(root, 'AGENTS.md'), '# Root agents\n');

  await assert.rejects(synchronizeClaudeProject(root), ClaudeSyncConflict);
});

test('repairs generated links and removes stale links into the agent skill root', async (testContext) => {
  const root = await fixture();
  removeFixture(testContext, root);
  await createRootInstructions(root);
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
  await createRootInstructions(root);
  await createSkill(root, 'example');
  await mkdir(join(root, '.claude', 'skills', 'example'), { recursive: true });

  await assert.rejects(synchronizeClaudeProject(root), ClaudeSyncConflict);
});
