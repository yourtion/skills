import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkVersions } from '../scripts/check-versions.mjs';
import { isSkillVersion, validateSkill } from '../scripts/validate-skills.mjs';

const zero = '0'.repeat(40);
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const skill = (name = 'example', version = '1.0.0', body = '# Steps\n\nReturn a result.') => `---\nname: ${name}\ndescription: Run a repeatable task when requested.\n${version === undefined ? '' : `metadata:\n  version: ${JSON.stringify(version)}\n`}---\n${body}\n`;

async function put(root, path, content) {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), content);
}

function commit(root) {
  git(root, 'add', '-A');
  git(root, 'commit', '--allow-empty', '-m', 'Test fixture');
  return git(root, 'rev-parse', 'HEAD');
}

async function repository(t, { initialSkill = true, version = '1.0.0' } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'yourtion-skill-versions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Skill version tests');
  git(root, 'config', 'user.email', 'tests@example.invalid');
  await put(root, 'README.md', 'Repository fixture');
  if (initialSkill) await put(root, 'skills/example/SKILL.md', skill('example', version));
  return { root, base: commit(root) };
}

for (const version of ['0.1.0', '1.2.3', '2.0.0-alpha.1', '2.0.0-rc.2+build.42', '1.0.0+001']) {
  test(`accepts strict version ${version}`, () => assert.equal(isSkillVersion(version), true));
}
for (const version of [undefined, 1, '', '1.0', 'v1.0.0', '=1.0.0', ' 1.0.0', '1.0.0\n', '01.0.0', '1.0.0-01', '1.0.0-', '1.0.0+', '9007199254740992.0.0', '1.0.0-9007199254740992']) {
  test(`rejects invalid or unsupported version ${JSON.stringify(version)}`, () => assert.equal(isSkillVersion(version), false));
}

test('format validator requires a version string', () => {
  for (const document of [skill('example', 123), skill().replace('  version: "1.0.0"', '  version: "1.0"'), skill().replace('metadata:\n  version: "1.0.0"\n', '')]) {
    assert.ok(validateSkill(document, 'example').errors.some((item) => /metadata.version/.test(item.message)));
  }
});

for (const path of ['SKILL.md', 'scripts/run.js', 'references/guide.md', 'assets/template.txt', 'notes/file\nwith-newline.txt']) {
  test(`changed skill file ${JSON.stringify(path)} requires a bump`, async (t) => {
    const { root, base } = await repository(t);
    await put(root, `skills/example/${path}`, path === 'SKILL.md' ? skill('example', '1.0.0', '# Changed instructions') : 'new resource');
    const unchangedVersion = checkVersions({ root, base, head: commit(root) });
    assert.equal(unchangedVersion.errors.length, 1);
    assert.match(unchangedVersion.errors[0].message, /严格递增/);
    await put(root, 'skills/example/SKILL.md', skill('example', '1.0.1', '# Changed instructions'));
    const bumped = checkVersions({ root, base, head: commit(root) });
    assert.equal(bumped.errors.length, 0);
    assert.equal(bumped.changes[0].kind, 'updated');
  });
}

test('deleting a resource or changing its executable bit also requires a bump', async (t) => {
  const { root } = await repository(t);
  await put(root, 'skills/example/scripts/run.sh', '#!/bin/sh\necho fixture\n');
  const base = commit(root);
  await chmod(resolve(root, 'skills/example/scripts/run.sh'), 0o755);
  assert.equal(checkVersions({ root, base, head: commit(root) }).errors.length, 1);
  await rm(resolve(root, 'skills/example/scripts/run.sh'));
  assert.equal(checkVersions({ root, base, head: commit(root) }).errors.length, 1);
});

for (const version of ['0.9.9', '1.0.0', '1.0.0+newbuild', '1.0.0-alpha.1']) {
  test(`same, lower or build-only version ${version} fails`, async (t) => {
    const { root, base } = await repository(t);
    await put(root, 'skills/example/SKILL.md', skill('example', version, '# Changed'));
    assert.equal(checkVersions({ root, base, head: commit(root) }).errors.length, 1);
  });
}

for (const [before, after] of [['1.0.0-alpha.1', '1.0.0-alpha.2'], ['1.0.0-alpha.2', '1.0.0-alpha.beta'], ['1.0.0-rc.1', '1.0.0'], ['1.0.0', '1.1.0-beta.1']]) {
  test(`SemVer precedence accepts ${before} → ${after}`, async (t) => {
    const { root, base } = await repository(t, { version: before });
    await put(root, 'skills/example/SKILL.md', skill('example', after));
    assert.equal(checkVersions({ root, base, head: commit(root) }).errors.length, 0);
  });
}

test('root documentation, tooling and skills index changes do not require skill bumps', async (t) => {
  const { root, base } = await repository(t);
  await put(root, 'README.md', 'updated docs');
  await put(root, 'scripts/tool.mjs', 'tool fixture');
  await put(root, 'skills/README.md', 'updated index');
  assert.deepEqual(checkVersions({ root, base, head: commit(root) }).changes, []);
});

test('new skills need a valid version and can start at 0.1.0', async (t) => {
  const { root, base } = await repository(t, { initialSkill: false });
  await put(root, 'skills/example/SKILL.md', skill('example', '0.1.0'));
  const result = checkVersions({ root, base, head: commit(root) });
  assert.equal(result.errors.length, 0);
  assert.equal(result.changes[0].kind, 'added');
  await put(root, 'skills/example/SKILL.md', skill('example', '0.1'));
  assert.equal(checkVersions({ root, base, head: commit(root) }).errors.length, 1);
});

test('whole skill removal needs no replacement version', async (t) => {
  const { root, base } = await repository(t);
  await rm(resolve(root, 'skills/example'), { recursive: true });
  const result = checkVersions({ root, base, head: commit(root) });
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.changes, [{ name: 'example', kind: 'removed' }]);
});

test('deleting only SKILL.md while resources remain is an error', async (t) => {
  const { root } = await repository(t);
  await put(root, 'skills/example/assets/resource.txt', 'keep');
  const base = commit(root);
  await rm(resolve(root, 'skills/example/SKILL.md'));
  assert.match(checkVersions({ root, base, head: commit(root) }).errors[0].message, /入口缺失/);
});

test('renaming is explicitly old identity removed plus new identity added', async (t) => {
  const { root, base } = await repository(t);
  await rename(resolve(root, 'skills/example'), resolve(root, 'skills/renamed'));
  await put(root, 'skills/renamed/SKILL.md', skill('renamed', '1.0.0'));
  const result = checkVersions({ root, base, head: commit(root) });
  assert.equal(result.errors.length, 0);
  assert.deepEqual(new Set(result.changes.map((item) => item.kind)), new Set(['removed', 'added']));
});

test('a legacy skill may initialize a version, but a present version cannot be removed', async (t) => {
  const { root } = await repository(t);
  await put(root, 'skills/example/SKILL.md', skill().replace('metadata:\n  version: "1.0.0"\n', ''));
  const base = commit(root);
  await put(root, 'skills/example/SKILL.md', skill('example', '0.1.0'));
  const withVersion = commit(root);
  assert.equal(checkVersions({ root, base, head: withVersion }).changes[0].kind, 'initialized');
  await put(root, 'skills/example/SKILL.md', skill().replace('metadata:\n  version: "1.0.0"\n', ''));
  assert.match(checkVersions({ root, base: withVersion, head: commit(root) }).errors[0].message, /metadata.version/);
});

test('all-zero main push before explicitly compares against an empty tree', async (t) => {
  const { root, base: head } = await repository(t);
  assert.equal(checkVersions({ root, base: zero, head }).changes[0].kind, 'added');
  assert.throws(() => checkVersions({ root, base: zero, head, mergeBase: true }), /全零/);
});

test('missing base/head and shallow history fail closed', async (t) => {
  const { root, base } = await repository(t);
  assert.throws(() => checkVersions({ root }), /必须提供 base/);
  assert.throws(() => checkVersions({ root, base: 'missing-ref' }), /失败/);
  assert.throws(() => checkVersions({ root, base, head: 'missing-ref' }), /失败/);
  const shallow = resolve(root, 'shallow-clone');
  execFileSync('git', ['clone', '--depth=1', `file://${root}`, shallow], { stdio: 'pipe' });
  assert.throws(() => checkVersions({ root: shallow, base }), /浅克隆/);
});

test('PR comparison uses the merge base, not unrelated updates on latest main', async (t) => {
  const { root, base } = await repository(t);
  git(root, 'checkout', '-b', 'feature');
  await put(root, 'skills/example/SKILL.md', skill('example', '1.0.1'));
  const head = commit(root);
  git(root, 'checkout', 'main');
  await put(root, 'skills/example/SKILL.md', skill('example', '1.1.0'));
  const latestMain = commit(root);
  const result = checkVersions({ root, base: latestMain, head, mergeBase: true });
  assert.equal(result.base, base);
  assert.equal(result.errors.length, 0);
  assert.equal(checkVersions({ root, base: latestMain, head }).errors.length, 1);
});

test('unrelated histories fail closed for PR comparison', async (t) => {
  const { root, base } = await repository(t);
  git(root, 'checkout', '--orphan', 'unrelated');
  git(root, 'rm', '-rf', '.');
  await put(root, 'README.md', 'unrelated root');
  const head = commit(root);
  assert.throws(() => checkVersions({ root, base, head, mergeBase: true }), /失败|共同祖先/);
});


test('version CLI fails for an explicitly empty head instead of using HEAD', () => {
  const script = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/check-versions.mjs');
  const result = spawnSync(process.execPath, [script, 'HEAD', ''], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /必须提供 base 和 head/);
});


test('invalid UTF-8 Git paths fail closed instead of collapsing distinct filenames', async (t) => {
  const { root } = await repository(t);
  const prefix = Buffer.from(resolve(root, 'skills/example/resource-'));
  const first = Buffer.concat([prefix, Buffer.from([0x80])]);
  const second = Buffer.concat([prefix, Buffer.from([0x81])]);
  await writeFile(first, 'same content');
  const base = commit(root);
  await rename(first, second);
  const head = commit(root);
  assert.throws(() => checkVersions({ root, base, head }), /UTF-8/);
});

test('an invalid present baseline version cannot silently initialize again', async (t) => {
  const { root, base } = await repository(t, { version: '1.0' });
  await put(root, 'skills/example/SKILL.md', skill('example', '1.0.1'));
  assert.match(checkVersions({ root, base, head: commit(root) }).errors[0].message, /基线 metadata.version 无效/);
});
