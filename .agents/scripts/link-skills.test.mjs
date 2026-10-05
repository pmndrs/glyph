import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { linkSkills, SkillLinkConflict } from './link-skills.mjs';

async function fixture(testContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pmndrs-glyph-link-skills-')));
  testContext.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function createSkill(root, name) {
  const skill = join(root, '.agents', 'skills', name);
  await mkdir(join(skill, 'references'), { recursive: true });
  await writeFile(join(skill, 'SKILL.md'), `# ${name}\n`);
  await writeFile(join(skill, 'references', 'guide.md'), 'guide\n');
  return skill;
}

test('links every skill into any harness directory and is idempotent', async (testContext) => {
  const root = await fixture(testContext);
  const skill = await createSkill(root, 'example');
  await mkdir(join(root, '.agents', 'skills', 'notes'), { recursive: true });

  for (const target of ['.claude/skills', '.other-harness/skills']) {
    const first = await linkSkills({ repositoryRoot: root, target });
    assert.deepEqual(first.created, [join(root, target, 'example')]);
    assert.equal(await realpath(join(root, target, 'example')), await realpath(skill));
    assert.equal(await readFile(join(root, target, 'example', 'references', 'guide.md'), 'utf8'), 'guide\n');
    assert.deepEqual(await linkSkills({ repositoryRoot: root, target }), { created: [], repaired: [], removed: [] });
  }
});

test('repairs moved links and removes links to deleted skills, leaving foreign links alone', async (testContext) => {
  const root = await fixture(testContext);
  const current = await createSkill(root, 'current');
  const other = await createSkill(root, 'other');
  const skills = join(root, '.claude', 'skills');
  await mkdir(skills, { recursive: true });
  await symlink(other, join(skills, 'current'), 'dir');
  await symlink(other, join(skills, 'deleted'), 'dir');
  await symlink(root, join(skills, 'harness-owned'), 'dir');

  const result = await linkSkills({ repositoryRoot: root, target: '.claude/skills' });

  assert.equal(await realpath(join(skills, 'current')), await realpath(current));
  assert.equal(await realpath(join(skills, 'harness-owned')), root);
  assert.deepEqual(result.repaired, [join(skills, 'current')]);
  assert.deepEqual(result.removed, [join(skills, 'deleted')]);
});

test('refuses to replace a real directory or to link into the source', async (testContext) => {
  const root = await fixture(testContext);
  await createSkill(root, 'example');
  await mkdir(join(root, '.claude', 'skills', 'example'), { recursive: true });

  await assert.rejects(linkSkills({ repositoryRoot: root, target: '.claude/skills' }), SkillLinkConflict);
  await assert.rejects(linkSkills({ repositoryRoot: root, target: '.agents/skills/nested' }), SkillLinkConflict);
});
