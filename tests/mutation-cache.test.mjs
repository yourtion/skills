import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';
import { baselineInputs } from '../skills/mutation-testing-ts/scripts/baseline-inputs.mjs';
import { runMutation } from '../skills/mutation-testing-ts/scripts/run-mutation.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = resolve(root, 'skills/mutation-testing-ts');
const policy = '.github/mutation-cache-inputs.json';
const defaults = JSON.parse(await readFile(resolve(skill, 'assets/mutation-cache-inputs.json')));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
async function put(cwd, file, contents) { await mkdir(dirname(resolve(cwd, file)), { recursive: true }); await writeFile(resolve(cwd, file), typeof contents === 'string' ? contents : JSON.stringify(contents)); }
async function fixture(t, changes = {}) {
 const cwd = await mkdtemp(resolve(tmpdir(), 'mutation-cache-v3-')); t.after(() => rm(cwd, { recursive: true, force: true })); git(cwd, 'init', '-q');
 const config = { ...defaults, ...changes }; await put(cwd, policy, config);
 await put(cwd, '.gitignore', 'reports/\nnode_modules/\n');
 await put(cwd, 'package.json', { name: 'lab', version: '1.0.0', type: 'module', dependencies: { dep: '1.0.0' }, devDependencies: { tool: '1.0.0' } });
 for (const file of ['pnpm-lock.yaml', 'src/api.ts', 'test/api.test.ts', 'test/helper.ts', 'test/a.snap', 'fixtures/a.json', 'README.md']) await put(cwd, file, `input ${file}`);
 git(cwd, 'add', '-A');
 return { cwd, config, read: () => baselineInputs({ cwd, configFile: policy }) };
}
test('v3 default preserves every tracked input; all dependency classes and unknown manifest fields invalidate', async t => {
 const { cwd, read } = await fixture(t); const first = read(); assert.deepEqual(first.strykerTrackedFiles, []);
 const original = JSON.parse(await readFile(resolve(cwd, 'package.json')));
 for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides', 'resolutions', 'pnpm', 'scripts', 'exports', 'engines', 'packageManager', 'custom']) {
  await put(cwd, 'package.json', { ...original, [field]: { changed: true } }); assert.notEqual(read().hash, first.hash, field);
 }
 await put(cwd, 'package.json', original);
 for (const file of first.hashedFiles.filter(f => f !== policy && f !== 'package.json')) { const bytes = await readFile(resolve(cwd, file)); await put(cwd, file, 'changed'); assert.notEqual(read().semanticHash, first.semanticHash, file); await writeFile(resolve(cwd, file), bytes); }
});
test('reviewed exact docs and version exemptions leave other metadata/dependencies intact', async t => {
 const { cwd, read } = await fixture(t, { nonSemanticFiles: [{ path: 'README.md', reason: 'not read by tests' }], packageVersionFiles: [{ path: 'package.json', reason: 'runtime does not read own version' }] });
 const a = read(), pkg = JSON.parse(await readFile(resolve(cwd, 'package.json')));
 await put(cwd, 'README.md', 'new docs'); await put(cwd, 'package.json', { ...pkg, version: '1.0.1' }); assert.equal(read().semanticHash, a.semanticHash);
 await put(cwd, 'package.json', { ...pkg, version: '1.0.1', devDependencies: { tool: '2.0.0' } }); assert.notEqual(read().semanticHash, a.semanticHash);
});
test('native source exclusion affects discovery only; semantic hash still catches cross-function/test changes', async t => {
 const { cwd, read } = await fixture(t, { trackedByStryker: ['src/*.ts', 'test/*.test.ts'] }); const a = read();
 for (const file of ['src/api.ts', 'test/api.test.ts']) { await put(cwd, file, 'semantic change'); const b = read(); assert.equal(b.hash, a.hash); assert.notEqual(b.semanticHash, a.semanticHash); }
});
test('new helper/fixture, removal and mode change are hashed', async t => {
 const { cwd, read } = await fixture(t); const a = read(); await put(cwd, 'new-dir/helper.js', 'new helper'); const untracked = read().hash; assert.notEqual(untracked, a.hash); git(cwd, 'add', '-A'); assert.equal(read().hash, untracked);
 await rm(resolve(cwd, 'new-dir/helper.js')); git(cwd, 'add', '-A'); assert.equal(read().hash, a.hash);
 await chmod(resolve(cwd, 'test/helper.ts'), 0o755); assert.notEqual(read().hash, a.hash);
 await rm(resolve(cwd, 'fixtures/a.json')); const deleted = read().hash; assert.notEqual(deleted, a.hash); git(cwd, 'add', '-A'); assert.equal(read().hash, deleted);
 await rm(resolve(cwd, 'package.json')); const deletedPackage = read().hash; assert.notEqual(deletedPackage, deleted); git(cwd, 'add', '-A'); assert.equal(read().hash, deletedPackage);
});
test('actual installed direct runtime/dev dependency manifests and environment participate', async t => {
 const { cwd, read } = await fixture(t); const a = read(); await put(cwd, 'node_modules/dep/package.json', { name: 'dep', version: '1.0.0' }); const b = read(); assert.notEqual(a.hash, b.hash);
 await put(cwd, 'node_modules/dep/package.json', { name: 'dep', version: '2.0.0' }); const c = read(); assert.notEqual(b.hash, c.hash);
 await put(cwd, 'node_modules/tool/package.json', { name: 'tool', version: '2.0.0' }); assert.notEqual(read().hash, c.hash);
 const old = process.env.MUTATION_ENV_ID; process.env.MUTATION_ENV_ID = 'changed-test-environment'; try { assert.notEqual(read().hash, c.hash); } finally { if (old === undefined) delete process.env.MUTATION_ENV_ID; else process.env.MUTATION_ENV_ID = old; }
});
test('reviewed workspace package version is normalized through its actual installed symlink only', async t => {
 const { cwd, read } = await fixture(t, { packageVersionFiles: [{ path: 'package.json', reason: 'reviewed runtime does not read own version' }] });
 const pkg = JSON.parse(await readFile(resolve(cwd, 'package.json'))); pkg.dependencies.lab = 'workspace:*'; await put(cwd, 'package.json', pkg);
 await mkdir(resolve(cwd, 'node_modules'), { recursive: true }); await symlink('..', resolve(cwd, 'node_modules/lab'));
 const a = read(); pkg.version = '1.0.1'; await put(cwd, 'package.json', pkg); assert.equal(read().hash, a.hash);
 pkg.devDependencies.tool = '2.0.0'; await put(cwd, 'package.json', pkg); assert.notEqual(read().hash, a.hash);
});
test('npm normalization is root-only, strict v3, and retains transitive integrity/version', async t => {
 const { cwd, read } = await fixture(t, { packageVersionFiles: [{ path: 'package.json', reason: 'reviewed' }], npmLockVersionFiles: [{ path: 'package-lock.json', reason: 'root metadata only' }] });
 const lock = { lockfileVersion: 3, version: '1.0.0', packages: { '': { version: '1.0.0' }, 'node_modules/dep': { version: '1.0.0', integrity: 'abc' } } };
 await put(cwd, 'package-lock.json', lock); git(cwd, 'add', '-A'); const a = read();
 const pkg = JSON.parse(await readFile(resolve(cwd, 'package.json'))); await put(cwd, 'package.json', { ...pkg, version: '1.0.1' }); lock.version = '1.0.1'; lock.packages[''].version = '1.0.1'; await put(cwd, 'package-lock.json', lock); assert.equal(read().hash, a.hash);
 lock.packages['node_modules/dep'].integrity = 'changed'; await put(cwd, 'package-lock.json', lock); assert.notEqual(read().hash, a.hash);
 lock.version = 'mismatch'; await put(cwd, 'package-lock.json', lock); assert.throws(read, /lockfile v3/);
});
for (const extra of [{ schema: 2 }, { typo: true }, { trackedByStryker: ['../outside'] }, { trackedByStryker: ['!src/**'] }, { nonSemanticFiles: [{ path: '**/*.md', reason: 'broad' }] }, { nonSemanticFiles: [{ path: 'README.md' }] }, { environment: ['API_TOKEN'] }, { packageVersionFiles: [{ path: 'other.json', reason: 'bad' }] }]) {
 test(`invalid policy fails closed ${JSON.stringify(extra)}`, async t => { const { read } = await fixture(t, extra); assert.throws(read); });
}
test('policy/helper, protected files, symlinks and invalid UTF8 paths fail closed', async t => {
 const { cwd, read, config } = await fixture(t); await put(cwd, policy, { ...config, nonSemanticFiles: [{ path: 'package.json', reason: 'unsafe' }] }); assert.throws(read, /受保护/); await put(cwd, policy, config);
 await rm(resolve(cwd, 'src/api.ts')); await symlink('../test/helper.ts', resolve(cwd, 'src/api.ts')); assert.throws(read, /普通文件/);
 await rm(resolve(cwd, 'src/api.ts')); await put(cwd, 'src/api.ts', 'restore'); const invalid = Buffer.concat([Buffer.from(resolve(cwd, 'invalid-')), Buffer.from([0x80])]); await writeFile(invalid, 'x'); git(cwd, 'add', '-A'); assert.throws(read, /encoded data|UTF-8/i);
});
test('exact audited documentation symlink can be ignored, including an absent target', async t => {
 const { cwd, read } = await fixture(t, { nonSemanticFiles: [{ path: 'CLAUDE.md', reason: 'agent instructions are not loaded by the runner' }] }); const a = read();
 await symlink('missing-agent-document.md', resolve(cwd, 'CLAUDE.md')); assert.equal(read().hash, a.hash);
});
test('guard rejects legacy/corrupt report, semantic changes, changed invocation and failure; same inputs reuse', async t => {
 const { cwd } = await fixture(t, { trackedByStryker: ['src/*.ts'] });
 const code = `const fs=require('fs');fs.mkdirSync('reports',{recursive:true});const reused=fs.existsSync('reports/incremental.json');fs.writeFileSync('reports/observed.json',JSON.stringify({reused}));fs.writeFileSync('reports/incremental.json',JSON.stringify({files:{'src/api.ts':{mutants:[]}}}));`;
 const args = ['-e', code], run = more => runMutation({ cwd, configFile: policy, reportFile: 'reports/incremental.json', args, ...more });
 const observed = async () => JSON.parse(await readFile(resolve(cwd, 'reports/observed.json'))).reused;
 assert.equal(run(), 0); assert.equal(await observed(), false); assert.equal(run(), 0); assert.equal(await observed(), true);
 await put(cwd, 'src/api.ts', 'changed dependency behavior'); assert.equal(run(), 0); assert.equal(await observed(), false);
 assert.equal(run({ args: [...args, 'changed-scope'] }), 0); assert.equal(await observed(), false);
 assert.equal(run({ args: ['-e', 'process.exit(9)'] }), 9);
 assert.equal(run(), 0); assert.equal(await observed(), false);
 await put(cwd, 'reports/incremental.json', { files: { stale: { mutants: [] } } }); assert.equal(run(), 0); assert.equal(await observed(), false);
 assert.throws(() => run({ args: [...args, '--incrementalFile=other.json'] }), /CLI覆盖/);
 assert.throws(() => run({ reportFile: 'package.json' }), /Git跟踪/);
 assert.throws(() => run({ reportFile: '../outside.json' }), /Git工作区/);
});
test('guard detects inputs changed during execution and rejects symlink report parents', async t => {
 const { cwd } = await fixture(t); const args = ['-e', `const fs=require('fs');fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/x.json','{"files":{}}');fs.writeFileSync('src/api.ts','changed');`];
 assert.throws(() => runMutation({ cwd, configFile: policy, reportFile: 'reports/x.json', args }), /运行期间/);
 await symlink(tmpdir(), resolve(cwd, 'output')); assert.throws(() => runMutation({ cwd, configFile: policy, reportFile: 'output/x.json', args }), /符号链接/);
});
test('CLI accepts only known arguments and emits digest or manifest', async t => {
 const { cwd, read } = await fixture(t); const script = resolve(skill, 'scripts/baseline-inputs.mjs'); const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
 assert.equal(run(policy).stdout.trim(), read().hash); assert.deepEqual(JSON.parse(run(policy, '--list').stdout), read());
 for (const args of [[], [policy, '--typo'], ['../outside.json']]) { const result = run(...args); assert.equal(result.status, 1); assert.equal(result.stdout, ''); }
});
test('workflow preserves main-only writes and caches paired authorization metadata', async () => {
 const workflow = parse(await readFile(resolve(skill, 'assets/mutation.yml'), 'utf8')); const steps = workflow.jobs.mutation.steps;
 const restore = steps.find(s => s.uses?.startsWith('actions/cache/restore@')); const save = steps.find(s => s.uses?.startsWith('actions/cache/save@'));
 assert.equal(restore.with['restore-keys'].trim(), '${{ steps.baseline-key.outputs.prefix }}-'); assert.match(restore.with.path, /\.inputs\.json/); assert.equal(save.with.path, restore.with.path);
 assert.equal(save.if, "success() && github.ref == 'refs/heads/main' && github.event_name != 'pull_request'"); assert.match(steps.find(s => s.id === 'baseline-key').run, /v3/);
});
