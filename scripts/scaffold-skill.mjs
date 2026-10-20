import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSkillName } from './validate-skills.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Fallback only: copy the starter; skill design and authoring belong to skill-creator.
export async function scaffoldSkill(name, root = repositoryRoot) {
  if (!isSkillName(name)) {
    throw new Error('名称须为 1–64 个小写英文字母、数字或单个连字符，且不能以连字符开头或结尾。');
  }
  const template = await readFile(resolve(root, 'templates/skill/SKILL.md.template'), 'utf8');
  const skillsRoot = resolve(root, 'skills');
  if (!(await lstat(skillsRoot)).isDirectory()) {
    throw new Error('skills/ 必须是普通目录，不能是符号链接。');
  }
  const target = resolve(skillsRoot, name);
  // Non-recursive mkdir refuses to overwrite an existing skill, including a symlink.
  await mkdir(target);
  await writeFile(resolve(target, 'SKILL.md'), template.replaceAll('__SKILL_NAME__', name), { flag: 'wx' });
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('用法：pnpm scaffold <skill-name>');
    console.log(`仅生成模板骨架：${await scaffoldSkill(process.argv[2])}。请补全 TODO 后运行 pnpm check。`);
  } catch (error) {
    console.error(error.code === 'EEXIST' ? '该 skill 已存在，未覆盖任何文件。' : error.message);
    process.exitCode = 1;
  }
}
