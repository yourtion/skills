# Yourtion Skills

用于积累、维护和分发 Yourtion 的 Agent Skills。每个 skill 是一个独立目录，入口为 `SKILL.md`，遵循 [Agent Skills 规范](https://agentskills.io/specification)。

当前先搭好维护骨架，尚未添加可安装的 skill。模板不会被识别成正式技能。

## 安装与发现

有正式 skill 后，在使用技能的项目目录中运行：

```bash
# 只查看仓库可用技能，不安装
npx skills@latest add yourtion/skills --list

# 交互选择技能和 agent，默认安装到当前项目
npx skills@latest add yourtion/skills

# 指定技能与 agent（将 <skill-name> 替换为真实目录名）
npx skills@latest add yourtion/skills --skill <skill-name> -a codex
```

Claude Code 可以将 `codex` 改成 `claude-code`。需要跨项目使用时可显式加 `-g`；安装前先检查技能内容和脚本。支持的 agent、路径与参数以 [官方 CLI 文档](https://github.com/vercel-labs/skills/blob/main/docs/commands.md) 为准。

仓库目前没有正式技能，`--list` 显示 `No valid skills found` 并以非零状态退出属于预期。添加首个技能后应能正常列出。

## 仓库结构

```text
skills/
  README.md                  # 正式技能索引，目前为空
  <skill-name>/
    SKILL.md                 # YAML 元信息 + 工作指令
    references/              # 按需增加的参考资料
    scripts/                 # 按需增加的可执行脚本
    assets/                  # 按需增加的模板或静态资源
templates/skill/
  SKILL.md.template           # 创建模板，不是可安装技能
scripts/
  scaffold-skill.mjs          # 无可用 skill-creator 时复制模板
  validate-skills.mjs         # 格式与仓库约定检查
tests/skills.test.mjs         # 正反例与模板兜底测试
.github/workflows/validate.yml
AGENTS.md                    # 仓库内 agent 协作约定
CONTRIBUTING.md              # 人类贡献流程
```

保持一层 `skills/<name>/` 即可。暂时不需要分类目录、插件清单或 npm 发布流程，实际需求出现后再扩展。

## 开发

维护工具需要 Node.js 22.20+ 和 pnpm 11.25.0（版本记录在 `package.json`）。安装工具链可参考 [Node.js](https://nodejs.org/en/download) 与 [pnpm](https://pnpm.io/installation) 官方说明。使用技能本身不需要安装本仓库的开发依赖。

```bash
git clone https://github.com/yourtion/skills.git
cd skills
pnpm install --frozen-lockfile

```

### 创建或改进技能：优先 skill-creator

先检查当前 agent 是否已提供 `skill-creator`，读取该版本的说明并按其实际调用方式使用。它可以帮助明确使用场景、设计触发描述、选择必要资源、编写指令，再通过验证和实际使用迭代。

给它明确的仓库目标，例如：

> 请使用当前可用的 skill-creator，为本仓库创建 my-skill，目标目录是 skills/my-skill。先结合具体任务确定触发条件、步骤和验收方法，只添加确有需要的资源，完成后运行仓库检查。

`skill-creator` 并非所有 agent 都默认提供，不同版本的调用方式和写入位置也可能不同。仅当当前版本支持在指定仓库路径创建时使用；如果没有、不可用，或只支持个人技能库，使用下方模板兜底。不要为此自动安装它、写入个人技能目录或重新初始化已有技能。

### 兜底：只复制最小模板

```bash
# 仅在当前 skill-creator 不可用于此仓库时使用；拒绝覆盖同名目录
pnpm scaffold my-skill
```

此命令只替换模板中的名称并创建 `skills/my-skill/SKILL.md`，不设计触发条件、不生成技能内容，也不替代 `skill-creator`。手动补全 TODO、确认指令可执行后再提交。

### 统一验证

无论通过 `skill-creator` 还是模板创建，都运行相同的仓库检查：

```bash
pnpm validate
pnpm test

# 提交前和 CI 执行相同的检查
pnpm check
```

若所用 `skill-creator` 提供自己的验证步骤，也按其说明执行；本仓库的校验不依赖它。格式通过后仍需在目标 agent 中验证真实任务。完成后，在 [skills/README.md](skills/README.md) 添加名称、用途和 `SKILL.md` 链接。

### SKILL.md 最小格式

```yaml
---
name: my-skill
description: "说明具体功能与触发场景，例如用户要求审查某类文件时使用。"
---

# my-skill

写清输入、步骤、边界、交付物与验收方法。
```

- `name` 与目录名一致，最长 64 个字符。本仓库进一步约定使用小写英文字母、数字和连字符，不以连字符开头或结尾，不连续使用连字符；通用规范也支持部分 Unicode 名称。
- `description` 是 1–1024 个字符的非空字符串，应同时回答“做什么”和“何时使用”。
- 可选字段包括 `license`、`compatibility`、`metadata` 和实验性的 `allowed-tools`。`metadata` 的键和值均为字符串，版本号如 `"1.0"` 要加引号。`license`、`allowed-tools` 若提供，本仓库要求使用非空字符串。
- `compatibility` 若提供，长度为 1–500 个字符，用于说明必要的工具或环境。
- 正文非空是本仓库的质量要求。少于 500 行是推荐项，超出时仅提醒；较长资料可拆到 `references/` 并从正文链接。
- 未知 frontmatter 字段仅提醒，应确认目标 agent 的支持情况。工具声明不代替运行环境的真实权限和用户确认。

校验会返回具体文件和错误；有错误时退出码为 1。扩展字段、长正文和遗留 TODO 以提醒输出，仍需人工审查。本地资源链接是否有效、指令是否有用，需要另行验证；格式检查不代表行为验证通过。

### 验证安装器发现行为

```bash
# 只列出本地仓库中的技能，不写入 agent 的技能目录
DISABLE_TELEMETRY=1 npx --yes skills@latest add ./ --list --full-depth
```

此命令会下载 CLI 到 npm 缓存，但不会安装技能。空仓库的预期输出同上。模板使用 `.template` 后缀，测试样本只在系统临时目录生成，避免被递归扫描误装。

## 贡献与验证

见 [贡献指南](CONTRIBUTING.md)。CI 使用锁文件安装依赖，再运行 `pnpm check`，只授予仓库内容读取权限。

本项目借鉴 [mattpocock/skills](https://github.com/mattpocock/skills) 的技能独立组织与维护方式，采用 [vercel-labs/skills](https://github.com/vercel-labs/skills) 的通用发现和安装协议。没有复制上游技能正文。当前没有选定仓库开源许可证，公开可见不等于授予使用许可；引入第三方内容时须保留其授权与署名。
