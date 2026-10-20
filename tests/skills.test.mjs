import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseDocument } from 'yaml';
import { scaffoldSkill } from '../scripts/scaffold-skill.mjs';
import { isSkillName, validateRepository, validateSkill } from '../scripts/validate-skills.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = (frontmatter = 'name: example\ndescription: "Run a repeatable task. Use when asked to test."', body = '# Steps\n\n1. Check input.\n2. Return the result.') => `---\n${frontmatter}\n---\n${body}\n`;

async function temporaryRepository(t) {
  // Keep generated SKILL.md fixtures outside this repo so installers cannot discover them.
  const directory = await mkdtemp(resolve(tmpdir(), 'yourtion-skills-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(resolve(directory, 'skills'));
  return directory;
}

async function addSkill(directory, name = 'example', content = source()) {
  await mkdir(resolve(directory, 'skills', name));
  await writeFile(resolve(directory, 'skills', name, 'SKILL.md'), content);
}

test('valid YAML accepts folded descriptions, quoted colons, optional fields, BOM and CRLF', () => {
  const document = source('name: example\ndescription: >-\n  Explain a task: safely.\n  Use when asked.\nlicense: MIT\ncompatibility: Requires Node.js\nmetadata:\n  author: yourtion\n  version: "1.0"\nallowed-tools: Bash Read');
  assert.deepEqual(validateSkill(`\uFEFF${document.replaceAll('\n', '\r\n')}`, 'example'), { errors: [], warnings: [] });
});

test('length boundaries are accepted', () => {
  const name = 'a'.repeat(64);
  assert.equal(validateSkill(source(`name: ${name}\ndescription: ${'d'.repeat(1024)}\ncompatibility: ${'c'.repeat(500)}`), name).errors.length, 0);
});

const invalidDocuments = [
  ['missing frontmatter', '# Just a heading', /frontmatter/],
  ['unclosed frontmatter', '---\nname: example\ndescription: test', /frontmatter/],
  ['malformed YAML', source('name: example\ndescription: [unclosed'), /YAML/],
  ['duplicate YAML keys', source('name: example\nname: example\ndescription: test'), /YAML/],
  ['content after YAML document end', source('name: example\ndescription: test\n...\nname: other'), /YAML/],
  ['unknown YAML tag', source('name: example\ndescription: !unsafe test'), /YAML/],
  ['scalar frontmatter', source('just-a-string'), /映射/],
  ['list frontmatter', source('- example'), /映射/],
  ['null frontmatter', source('null'), /映射/],
  ['missing name', source('description: test'), /name/],
  ['missing description', source('name: example'), /description/],
  ['numeric description', source('name: example\ndescription: 123'), /description/],
  ['boolean description', source('name: example\ndescription: true'), /description/],
  ['blank description', source('name: example\ndescription: "  "'), /description/],
  ['long description', source(`name: example\ndescription: ${'d'.repeat(1025)}`), /description/],
  ['long compatibility', source(`name: example\ndescription: test\ncompatibility: ${'c'.repeat(501)}`), /compatibility/],
  ['blank compatibility', source('name: example\ndescription: test\ncompatibility: ""'), /compatibility/],
  ['non-string compatibility', source('name: example\ndescription: test\ncompatibility: 123'), /compatibility/],
  ['invalid license', source('name: example\ndescription: test\nlicense: false'), /license/],
  ['metadata list', source('name: example\ndescription: test\nmetadata: [a]'), /metadata/],
  ['metadata set', source('name: example\ndescription: test\nmetadata: !!set\n  key: null'), /metadata/],
  ['aliased non-string metadata key', source('name: example\ndescription: test\nother: &meta\n  123: "value"\nmetadata: *meta'), /metadata/],
  ['metadata null', source('name: example\ndescription: test\nmetadata: null'), /metadata/],
  ['non-string metadata value', source('name: example\ndescription: test\nmetadata:\n  version: 1'), /metadata/],
  ['non-string metadata key', source('name: example\ndescription: test\nmetadata:\n  123: "value"'), /metadata/],
  ['non-string allowed-tools', source('name: example\ndescription: test\nallowed-tools: [Read]'), /allowed-tools/],
  ['empty body', source(undefined, '  '), /正文/],
  ['mismatched directory', source('name: another\ndescription: test'), /目录名/],
];
for (const [label, document, pattern] of invalidDocuments) {
  test(`rejects ${label}`, () => {
    assert.match(validateSkill(document, 'example').errors.map((item) => item.message).join('\n'), pattern);
  });
}

for (const name of ['', 'UPPER', '-start', 'end-', 'two--hyphens', 'space name', '../escape', 'a/b', 'a'.repeat(65), '中文', 123, null]) {
  test(`repository ASCII slug policy rejects ${JSON.stringify(name)}`, () => {
    assert.equal(isSkillName(name), false);
  });
}

test('guidance and extension fields produce warnings, not spec errors', () => {
  const result = validateSkill(source('name: example\ndescription: test\ndisable-model-invocation: true', 'line\n'.repeat(501)), 'example');
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 2);
});

test('an empty skills directory and a .template starter pass with zero skills', async (t) => {
  const directory = await temporaryRepository(t);
  await mkdir(resolve(directory, 'templates/skill'), { recursive: true });
  await writeFile(resolve(directory, 'templates/skill/SKILL.md.template'), source());
  assert.deepEqual(await validateRepository(directory), { count: 0, errors: [], warnings: [] });
});

test('valid real skills are counted', async (t) => {
  const directory = await temporaryRepository(t);
  await addSkill(directory);
  assert.deepEqual(await validateRepository(directory), { count: 1, errors: [], warnings: [] });
});

test('missing entry points fail', async (t) => {
  const directory = await temporaryRepository(t);
  await mkdir(resolve(directory, 'skills/broken'));
  assert.match((await validateRepository(directory)).errors[0].message, /缺少 SKILL.md/);
});

test('SKILL.md outside skills/<name> fails to protect installer discovery', async (t) => {
  const directory = await temporaryRepository(t);
  await mkdir(resolve(directory, 'templates/skill'), { recursive: true });
  await writeFile(resolve(directory, 'templates/skill/SKILL.md'), source());
  assert.match((await validateRepository(directory)).errors[0].message, /可分发入口/);
});

test('symlink entry points fail without reading their target', async (t) => {
  const directory = await temporaryRepository(t);
  await mkdir(resolve(directory, 'skills/example'));
  await symlink(resolve(directory, 'nonexistent'), resolve(directory, 'skills/example/SKILL.md'));
  assert.match((await validateRepository(directory)).errors.map((item) => item.message).join('\n'), /普通文件|符号链接/);
});

test('unexpected files in skills/ fail', async (t) => {
  const directory = await temporaryRepository(t);
  await writeFile(resolve(directory, 'skills/draft.md'), 'draft');
  assert.match((await validateRepository(directory)).errors[0].message, /只存放技能目录/);
});

test('CLI returns nonzero for invalid input and zero for a valid empty repository', async (t) => {
  const directory = await temporaryRepository(t);
  const script = resolve(root, 'scripts/validate-skills.mjs');
  assert.equal(spawnSync(process.execPath, [script, directory]).status, 0);
  await addSkill(directory, 'example', source('name: example\ndescription: false'));
  const invalid = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /description/);
});

test('fallback scaffold copies a named template without overwriting existing work', async (t) => {
  const directory = await temporaryRepository(t);
  await mkdir(resolve(directory, 'templates/skill'), { recursive: true });
  await writeFile(resolve(directory, 'templates/skill/SKILL.md.template'), await readFile(resolve(root, 'templates/skill/SKILL.md.template')));
  await scaffoldSkill('new-skill', directory);
  const target = resolve(directory, 'skills/new-skill/SKILL.md');
  assert.match(await readFile(target, 'utf8'), /name: new-skill/);
  assert.equal((await validateRepository(directory)).errors.length, 0);
  await writeFile(target, 'keep this');
  await assert.rejects(scaffoldSkill('new-skill', directory), { code: 'EEXIST' });
  assert.equal(await readFile(target, 'utf8'), 'keep this');
  await assert.rejects(scaffoldSkill('../escape', directory), /名称/);
  assert.deepEqual(await readdir(resolve(directory, 'skills')), ['new-skill']);
});

test('committed template uses an undiscoverable filename', async () => {
  assert.ok((await readFile(resolve(root, 'templates/skill/SKILL.md.template'), 'utf8')).includes('__SKILL_NAME__'));
  assert.deepEqual(await readdir(resolve(root, 'templates/skill')), ['SKILL.md.template']);
});


test('fallback scaffold refuses a symlinked skills parent without creating anything in its target', async (t) => {
  const directory = await temporaryRepository(t);
  const outside = await temporaryRepository(t);
  await rm(resolve(directory, 'skills'), { recursive: true });
  await symlink(resolve(outside, 'skills'), resolve(directory, 'skills'));
  await mkdir(resolve(directory, 'templates/skill'), { recursive: true });
  await writeFile(resolve(directory, 'templates/skill/SKILL.md.template'), source());
  await assert.rejects(scaffoldSkill('example', directory), /普通目录/);
  assert.deepEqual(await readdir(resolve(outside, 'skills')), []);
});


test('valid YAML aliases retain metadata string types', () => {
  const result = validateSkill(source('name: example\ndescription: test\nlicense: &license MIT\nmetadata:\n  license: *license'), 'example');
  assert.deepEqual(result, { errors: [], warnings: [] });
});

for (const path of ['SKILL.md', 'skills/category/example/SKILL.md']) {
  test(`rejects unexpected entry point ${path}`, async (t) => {
    const directory = await temporaryRepository(t);
    await mkdir(dirname(resolve(directory, path)), { recursive: true });
    await writeFile(resolve(directory, path), source());
    assert.ok((await validateRepository(directory)).errors.some((item) => /可分发入口/.test(item.message)));
  });
}

test('symlinked skill directories and resources are rejected', async (t) => {
  const directory = await temporaryRepository(t);
  await addSkill(directory);
  await symlink(resolve(directory, 'skills/example'), resolve(directory, 'skills/alias'));
  await symlink(resolve(directory, 'missing.md'), resolve(directory, 'skills/example/reference.md'));
  assert.equal((await validateRepository(directory)).errors.filter((item) => /符号链接/.test(item.message)).length, 2);
});


test('CI uses read-only permissions and runs the same aggregate check', async () => {
  const document = parseDocument(await readFile(resolve(root, '.github/workflows/validate.yml'), 'utf8'));
  assert.equal(document.errors.length, 0);
  const workflow = document.toJS();
  assert.ok('pull_request' in workflow.on);
  assert.equal(workflow.permissions.contents, 'read');
  assert.ok(workflow.jobs.validate.steps.some((step) => step.run === 'pnpm install --frozen-lockfile'));
  assert.ok(workflow.jobs.validate.steps.some((step) => step.run === 'pnpm check'));
});


test('fallback scaffold CLI explains its command and rejects invalid names', () => {
  const script = resolve(root, 'scripts/scaffold-skill.mjs');
  const usage = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /pnpm scaffold <skill-name>/);
  const invalid = spawnSync(process.execPath, [script, '../escape'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /名称/);
});
