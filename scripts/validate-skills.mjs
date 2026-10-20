import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const knownFields = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const isMap = (value) => value instanceof Map;
const length = (value) => [...value].length;

export function isSkillName(value) {
  return typeof value === 'string' && length(value) <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function validateSkill(source, directoryName, path = `${directoryName}/SKILL.md`) {
  const errors = [];
  const warnings = [];
  const error = (message) => errors.push({ path, message });
  const warn = (message) => warnings.push({ path, message });
  const normalized = source.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) {
    error('缺少完整 YAML frontmatter，必须以独立的 --- 行开头和结束。');
    return { errors, warnings };
  }
  let data;
  try {
    const document = parseDocument(match[1], { uniqueKeys: true, prettyErrors: false });
    if (document.errors.length || document.warnings.length) {
      throw new Error([...document.errors, ...document.warnings].map((item) => item.message).join('; '));
    }
    data = document.toJS({ mapAsMap: true, maxAliasCount: 50 });
  } catch (cause) {
    error(`YAML 无效：${cause.message}`);
    return { errors, warnings };
  }
  if (!isMap(data)) {
    error('frontmatter 必须是键值映射。');
    return { errors, warnings };
  }
  if (!isSkillName(data.get('name'))) error('仓库约定：name 须为 1–64 个小写英文字母、数字或单个连字符，且不能以连字符开头或结尾。');
  if (data.get('name') !== directoryName) error('name 必须与所在目录名一致。');
  if (typeof data.get('description') !== 'string' || !data.get('description').trim() || length(data.get('description')) > 1024) {
    error('description 须为非空字符串，最多 1024 个字符。');
  }
  if (data.has('license') && (typeof data.get('license') !== 'string' || !data.get('license').trim())) {
    error('仓库约定：license 若提供，须为非空字符串。');
  }
  if (data.has('compatibility') && (typeof data.get('compatibility') !== 'string' || !data.get('compatibility').trim() || length(data.get('compatibility')) > 500)) {
    error('compatibility 须为非空字符串，最多 500 个字符。');
  }
  if (data.has('metadata') && (!isMap(data.get('metadata')) || [...data.get('metadata')].some(([key, value]) => typeof key !== 'string' || typeof value !== 'string'))) {
    error('metadata 须为字符串键到字符串值的映射；版本号请加引号。');
  }
  if (data.has('allowed-tools') && (typeof data.get('allowed-tools') !== 'string' || !data.get('allowed-tools').trim())) {
    error('仓库约定：allowed-tools 若提供，须为空格分隔的非空字符串；这是实验性字段。');
  }
  for (const key of data.keys()) {
    if (typeof key !== 'string') error('frontmatter 的键必须是字符串。');
    if (!knownFields.has(key)) warn(`扩展字段 ${key} 不在通用规范中，请确认目标 agent 支持。`);
  }
  // These checks are repository conventions or recommendations, not spec limits.
  if (!match[2].trim()) error('仓库约定：SKILL.md 正文不能为空。');
  if (match[2].trim().split('\n').length > 500) warn('正文超过 500 行，建议将细节拆到 references/，按需读取。');
  if (/TODO|__SKILL_NAME__/.test(source)) warn('仍有模板占位内容，提交前请人工确认。');
  return { errors, warnings };
}

export async function validateRepository(root = repositoryRoot) {
  root = resolve(root);
  const errors = [];
  const warnings = [];
  let count = 0;
  const skillsRoot = resolve(root, 'skills');
  const report = (path, message) => errors.push({ path: relative(root, path), message });

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        report(path, '仓库约定：不允许符号链接，以避免技能安装后引用仓库外文件。');
      } else if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.name === 'SKILL.md' && dirname(dirname(path)) !== skillsRoot) {
        report(path, '仓库约定：可分发入口只能位于 skills/<name>/SKILL.md，模板请使用 .template 后缀。');
      }
    }
  }

  try {
    if (!(await lstat(skillsRoot)).isDirectory()) throw new Error('skills 不是普通目录。');
    for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
      const path = resolve(skillsRoot, entry.name);
      if (!entry.isDirectory()) {
        if (entry.name !== 'README.md' && entry.name !== '.gitkeep') report(path, '仓库约定：skills/ 只存放技能目录及目录说明。');
        continue;
      }
      const skillPath = resolve(path, 'SKILL.md');
      try {
        if (!(await lstat(skillPath)).isFile()) {
          report(skillPath, 'SKILL.md 必须是普通文件。');
          continue;
        }
        const result = validateSkill(await readFile(skillPath, 'utf8'), entry.name, relative(root, skillPath));
        errors.push(...result.errors);
        warnings.push(...result.warnings);
        count += 1;
      } catch (cause) {
        if (cause.code !== 'ENOENT') throw cause;
        report(skillPath, '技能目录缺少 SKILL.md。');
      }
    }
    await walk(root);
  } catch (cause) {
    report(root, `无法校验目录：${cause.message}`);
  }
  return { count, errors, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) {
    console.error('用法：pnpm validate [repository-path]');
    process.exitCode = 1;
  } else {
    const result = await validateRepository(process.argv[2] || repositoryRoot);
    for (const item of result.errors) console.error(`ERROR ${item.path}: ${item.message}`);
    for (const item of result.warnings) console.warn(`WARN ${item.path}: ${item.message}`);
    console.log(`已检查 ${result.count} 个 skill，${result.errors.length} 个错误，${result.warnings.length} 个提醒。`);
    process.exitCode = result.errors.length ? 1 : 0;
  }
}
