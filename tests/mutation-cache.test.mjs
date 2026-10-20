import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';
import { baselineInputs } from '../skills/mutation-testing-ts/scripts/baseline-inputs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = resolve(root, 'skills/mutation-testing-ts');
const script = resolve(skillRoot, 'scripts/baseline-inputs.mjs');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
const policy = '.github/mutation-cache-inputs.json';
const trackedByStryker = ['src/lib/**/*.ts', 'src/test/test*.ts'];

async function put(cwd, path, content) {
  await mkdir(dirname(resolve(cwd, path)), { recursive: true });
  await writeFile(resolve(cwd, path), content);
}

async function fixture(t, config = { trackedByStryker, alwaysHash: [] }) {
  const cwd = await mkdtemp(resolve(tmpdir(), 'mutation-cache-inputs-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '--initial-branch=main');
  await put(cwd, policy, JSON.stringify(config));
  for (const file of [
    'package.json', 'pnpm-lock.yaml', 'vitest.config.ts', 'src/lib/api.ts',
    'src/lib/types.d.ts', 'src/test/test-api.ts', 'src/test/test-api.ts.snap',
    'src/test/setup.ts', 'src/test/helper.ts', 'src/test/utils/assert.ts',
    'packages/adapter/src/index.ts', 'fixtures/response.json',
  ]) await put(cwd, file, `fixture: ${file}`);
  git(cwd, 'add', '-A');
  return { cwd, read: () => baselineInputs({ cwd, configFile: policy }) };
}

test('node-erest layout: omit only verified source/tests; retain helpers, adapters, declarations and snapshots', async (t) => {
  const { cwd, read } = await fixture(t);
  const result = read();
  assert.deepEqual(result.strykerTrackedFiles, ['src/lib/api.ts', 'src/test/test-api.ts']);
  assert.deepEqual(result.hashedFiles, [
    policy, 'fixtures/response.json', 'package.json', 'packages/adapter/src/index.ts',
    'pnpm-lock.yaml', 'src/lib/types.d.ts', 'src/test/helper.ts', 'src/test/setup.ts',
    'src/test/test-api.ts.snap', 'src/test/utils/assert.ts', 'vitest.config.ts',
  ].sort());
  assert.match(result.hash, /^[a-f0-9]{64}$/);
  assert.equal(read().hash, result.hash);
  assert.equal(baselineInputs({ cwd: resolve(cwd, 'src/test'), configFile: policy }).hash, result.hash);
  // Every non-Stryker input must change the key; no staging is needed for edits.
  for (const file of result.hashedFiles.filter((file) => file !== policy)) {
    const original = await readFile(resolve(cwd, file));
    await put(cwd, file, 'changed');
    assert.notEqual(read().hash, result.hash, file);
    await put(cwd, file, original);
  }
  for (const file of result.strykerTrackedFiles) {
    await put(cwd, file, 'changed tracked source/test');
    assert.equal(read().hash, result.hash, file);
  }
});

test('default policy is conservative, including source/test changes until explicitly reviewed', async (t) => {
  const config = JSON.parse(await readFile(resolve(skillRoot, 'assets/mutation-cache-inputs.json'), 'utf8'));
  const { cwd, read } = await fixture(t, config);
  const before = read();
  assert.deepEqual(before.strykerTrackedFiles, []);
  await put(cwd, 'src/test/test-api.ts', 'changed');
  assert.notEqual(read().hash, before.hash);
});

test('new directories, deletions, renames and executable mode invalidate the key', async (t) => {
  const { cwd, read } = await fixture(t);
  const first = read().hash;
  await put(cwd, 'new-support/response.json', 'fixture');
  // CI sees committed inputs; unrelated untracked outputs are not hashed.
  assert.equal(read().hash, first);
  git(cwd, 'add', 'new-support/response.json');
  const added = read().hash;
  assert.notEqual(added, first);
  await rename(resolve(cwd, 'new-support/response.json'), resolve(cwd, 'new-support/renamed.json'));
  git(cwd, 'add', '-A');
  const renamed = read().hash;
  assert.notEqual(renamed, added);
  await chmod(resolve(cwd, 'new-support/renamed.json'), 0o755);
  assert.notEqual(read().hash, renamed);
  await rm(resolve(cwd, 'new-support'), { recursive: true });
  git(cwd, 'add', '-A');
  assert.equal(read().hash, first);
});

test('alwaysHash overrides source exclusions; snapshots and declarations cannot be omitted by broad globs', async (t) => {
  const { read } = await fixture(t, { trackedByStryker: ['**'], alwaysHash: ['src/test/helper.ts'] });
  const result = read();
  for (const file of [policy, 'package.json', 'src/lib/types.d.ts', 'src/test/test-api.ts.snap', 'src/test/helper.ts']) {
    assert.ok(result.hashedFiles.includes(file), file);
  }
  assert.ok(result.strykerTrackedFiles.includes('src/lib/api.ts'));
});

test('policy and copied implementation changes invalidate the key even when the helper matches an exclusion', async (t) => {
  const { cwd, read } = await fixture(t);
  const initial = read().hash;
  await put(cwd, policy, JSON.stringify({ trackedByStryker, alwaysHash: ['src/lib/api.ts'] }));
  assert.notEqual(read().hash, initial);
  const copied = resolve(cwd, '.github/baseline-inputs.mjs');
  await copyFile(script, copied);
  const run = () => execFileSync(process.execPath, [copied, policy], { cwd, encoding: 'utf8' }).trim();
  const before = run();
  await writeFile(copied, `${await readFile(copied, 'utf8')}\n// version changed\n`);
  assert.notEqual(run(), before);
});

for (const config of [null, [], {}, { trackedByStryker: '**' }, { trackedByStryker: [null] },
  { trackedByStryker: [''] }, { trackedByStryker: ['!src/**'] }, { trackedByStryker: ['/src/**'] },
  { trackedByStryker: ['../outside'] }, { trackedByStryker: ['src\\**'] },
  { trackedByStryker: [], alwaysHash: false }, { trackedByStryker: [], alwaysHash: null },
  { trackedByStryker: [], typo: [] }]) {
  test(`invalid policy fails instead of generating a reusable key: ${JSON.stringify(config)}`, async (t) => {
    const { read } = await fixture(t, config);
    assert.throws(read, /缓存输入配置|glob 数组/);
  });
}

test('malformed/missing/outside config and missing tracked inputs fail closed', async (t) => {
  const { cwd, read } = await fixture(t);
  await put(cwd, policy, '{broken');
  assert.throws(read, SyntaxError);
  assert.throws(() => baselineInputs({ cwd }), /必须提供/);
  assert.throws(() => baselineInputs({ cwd, configFile: '../outside.json' }), /目标 Git 仓库内/);
  await rm(resolve(cwd, policy));
  assert.throws(read, { code: 'ENOENT' });
  await put(cwd, policy, JSON.stringify({ trackedByStryker: [] }));
  await rm(resolve(cwd, 'src/test/setup.ts'));
  assert.throws(read, { code: 'ENOENT' });
});

test('symlinks are rejected even if their names match trackedByStryker', async (t) => {
  const { cwd, read } = await fixture(t);
  await rm(resolve(cwd, 'src/lib/api.ts'));
  await symlink('../test/helper.ts', resolve(cwd, 'src/lib/api.ts'));
  assert.throws(read, /符号链接或子模块/);
  await rm(resolve(cwd, policy));
  await symlink('../package.json', resolve(cwd, policy));
  assert.throws(read, /普通文件/);
});

test('paths containing newlines and spaces have unambiguous manifests and content hashes', async (t) => {
  const { cwd, read } = await fixture(t);
  const first = read().hash;
  await put(cwd, 'fixtures/file\nwith spaces.json', 'fixture');
  git(cwd, 'add', '-A');
  assert.ok(read().hashedFiles.includes('fixtures/file\nwith spaces.json'));
  assert.notEqual(read().hash, first);
});

test('invalid UTF-8 Git paths and an empty tracked input set fail closed', async (t) => {
  const { cwd, read } = await fixture(t);
  const invalid = Buffer.concat([Buffer.from(resolve(cwd, 'fixtures/invalid-')), Buffer.from([0x80])]);
  await writeFile(invalid, 'fixture');
  git(cwd, 'add', '-A');
  assert.throws(read, /encoded data|encoding|UTF-8/i);
  await rm(invalid);
  git(cwd, 'rm', '-r', '--cached', '.');
  assert.throws(read, /清单为空/);
});

test('CLI prints only a digest or JSON manifest, rejects bad arguments, and returns nonzero on failure', async (t) => {
  const { cwd, read } = await fixture(t);
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  assert.equal(run(policy).stdout.trim(), read().hash);
  assert.deepEqual(JSON.parse(run(policy, '--list').stdout), read());
  for (const args of [[], [policy, '--typo'], [policy, '--list', 'extra'], ['missing.json']]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.length > 0);
  }
});

test('workflow consumes the helper policy and retains trusted-main-only baseline writes', async () => {
  const workflow = parse(await readFile(resolve(skillRoot, 'assets/mutation.yml'), 'utf8'));
  const steps = workflow.jobs.mutation.steps;
  assert.ok(steps.some((step) => step.run?.includes('mutation-cache-inputs.json --list')));
  const key = steps.find((step) => step.id === 'baseline-key');
  assert.match(key.run, /node \.github\/scripts\/baseline-inputs\.mjs \.github\/mutation-cache-inputs\.json/);
  assert.ok(!JSON.stringify(workflow).includes('hashFiles('));
  const restore = steps.find((step) => step.uses?.startsWith('actions/cache/restore@'));
  const save = steps.find((step) => step.uses?.startsWith('actions/cache/save@'));
  assert.equal(restore.with['restore-keys'].trim(), '${{ steps.baseline-key.outputs.prefix }}-');
  assert.equal(save.if, "success() && github.ref == 'refs/heads/main' && github.event_name != 'pull_request'");
});
