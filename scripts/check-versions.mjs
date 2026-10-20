import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import semver from 'semver';
import { isSkillVersion, parseSkill, validateSkill } from './validate-skills.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const zeroSha = /^(?:0{40}|0{64})$/;

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} 失败：${result.stderr?.toString('utf8').trim() || result.error?.message || '未知错误'}`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
  } catch {
    throw new Error('Git 输出不是有效 UTF-8，无法可靠比较文件路径或技能入口。');
  }
}

function commit(root, ref) {
  if (!ref) throw new Error('必须提供 base 和 head，不能跳过版本比较。');
  return git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
}

function skillsAt(root, sha) {
  const skills = new Map();
  if (!sha) return skills;
  for (const entry of git(root, ['ls-tree', '-r', '-z', sha, '--', 'skills/']).split('\0').filter(Boolean)) {
    const match = entry.match(/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/);
    if (!match) throw new Error('无法读取 Git tree，版本比较已中止。');
    const [, mode, type, oid, path] = match;
    const parts = path.split('/');
    if (parts.length < 3) continue; // skills/README.md is an index, not a skill.
    const name = parts[1];
    if (!skills.has(name)) skills.set(name, new Map());
    skills.get(name).set(parts.slice(2).join('/'), { mode, type, oid });
  }
  return skills;
}

function versionAt(root, files) {
  const entry = files?.get('SKILL.md');
  if (!entry || entry.type !== 'blob' || entry.mode === '120000') throw new Error('技能入口缺失或不是普通文件。');
  const source = git(root, ['cat-file', 'blob', entry.oid]);
  const { data } = parseSkill(source);
  const metadata = data.get('metadata');
  return { source, version: metadata instanceof Map ? metadata.get('version') : undefined };
}

function sameFiles(before, after) {
  return before.size === after.size && [...before].every(([path, item]) => {
    const other = after.get(path);
    return other && other.mode === item.mode && other.type === item.type && other.oid === item.oid;
  });
}

export function checkVersions({ root = repositoryRoot, base, head = 'HEAD', mergeBase = false }) {
  if (git(root, ['rev-parse', '--is-shallow-repository']).trim() !== 'false') {
    throw new Error('浅克隆无法可靠比较历史，请先完整 fetch（CI 使用 fetch-depth: 0）。');
  }
  const headSha = commit(root, head);
  if (!base) throw new Error('必须提供 base，不能跳过版本比较。');
  let baseSha = zeroSha.test(base) ? null : commit(root, base);
  if (mergeBase) {
    if (!baseSha) throw new Error('PR 比较不接受全零 base。');
    baseSha = git(root, ['merge-base', baseSha, headSha]).trim();
    if (!baseSha) throw new Error('找不到共同祖先，不能跳过版本比较。');
  }
  const before = skillsAt(root, baseSha);
  const after = skillsAt(root, headSha);
  const errors = [];
  const changes = [];
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const oldFiles = before.get(name);
    const newFiles = after.get(name);
    if (!newFiles) {
      changes.push({ name, kind: 'removed' });
      continue;
    }
    try {
      const current = versionAt(root, newFiles);
      const validation = validateSkill(current.source, name);
      if (validation.errors.length) throw new Error(validation.errors.map((item) => item.message).join('; '));
      if (!oldFiles) {
        changes.push({ name, kind: 'added', version: current.version });
        continue;
      }
      if (sameFiles(oldFiles, newFiles)) continue;
      const previous = versionAt(root, oldFiles).version;
      if (previous === undefined) {
        changes.push({ name, kind: 'initialized', version: current.version });
      } else if (!isSkillVersion(previous)) {
        throw new Error('基线 metadata.version 无效，无法安全比较。');
      } else if (!semver.gt(current.version, previous)) {
        throw new Error(`技能目录内容已变化，metadata.version 必须严格递增：${previous} → ${current.version}。仅修改 build metadata 不算升级。`);
      } else {
        changes.push({ name, kind: 'updated', previous, version: current.version });
      }
    } catch (cause) {
      errors.push({ name, message: cause.message });
    }
  }
  return { base: baseSha, head: headSha, changes, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { positionals, values } = parseArgs({ allowPositionals: true, options: { 'merge-base': { type: 'boolean', default: false } } });
    if (positionals.length < 1 || positionals.length > 2) throw new Error('用法：pnpm check:versions <base> [head] [--merge-base]');
    const result = checkVersions({ base: positionals[0], head: positionals.length === 1 ? 'HEAD' : positionals[1], mergeBase: values['merge-base'] });
    for (const item of result.changes) console.log(`${item.kind} ${item.name}${item.version ? ` ${item.previous ? `${item.previous} → ` : ''}${item.version}` : ''}`);
    for (const item of result.errors) console.error(`ERROR ${item.name}: ${item.message}`);
    console.log(`版本检查：${result.changes.length} 个有效变更，${result.errors.length} 个错误。重命名按删除旧身份和新增技能处理。`);
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (cause) {
    console.error(`ERROR ${cause.message}`);
    process.exitCode = 1;
  }
}
