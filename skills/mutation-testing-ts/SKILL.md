---
name: mutation-testing-ts
description: 为 TypeScript/JavaScript 项目接入、修复或评审 StrykerJS 变异测试及 CI，涵盖 Vitest/Jest 适配、首次全量基线、PR 复用主分支基线增量执行、主分支更新基线、缓存失效和强制重建。当用户提到变异测试、mutation testing、Stryker、增量变异测试或变异测试 CI 时使用。仅用于 TypeScript/JavaScript 变异测试，不用于普通覆盖率、常规 CI 或数据库 mutation 操作。
metadata:
  version: "0.1.0"
  short-description: TypeScript 变异测试接入与 CI 增量基线
---

# TypeScript 变异测试与 CI

将变异测试变成可重复执行的工程流程。默认采用 StrykerJS，在现有测试运行器上接入，沿用项目的包管理器、Node 版本、CI 平台和开发约定。

## 交付内容

1. 与项目兼容的 Stryker 配置和依赖锁文件。
2. 增量命令 `mutation` 和强制重建命令 `mutation:full`，沿用已有同义命令也可。
3. CI 工作流：首次全量、PR 读取主分支基线、主分支成功后保存基线。
4. 使用说明：报告位置、缓存失效、手动重建、评分门禁和验证范围。

## 1. 检查项目

- 阅读适用的 AGENTS.md，检查工作区变更、当前分支和用户指定分支。保留用户未提交的工作。
- 无法从当前工作区定位目标项目或 package.json 时，先询问项目路径或仓库链接，不在无关目录生成配置。可从现有配置推断的信息不重复询问。
- 确认实际主分支名称、包管理器及其固定版本、Node engines、测试运行器及版本、源码与测试目录、模块类型、现有 CI。
- 检查已有 Stryker 配置、脚本和锁文件，优先扩展已有接入。
- 安装前查阅当前 StrykerJS 与对应 runner 的官方兼容性说明。core 和 runner 使用互相兼容的版本，检查 Node 要求；不要永久照抄本案例的版本号。
- Vitest 读取 [配置模板](assets/stryker.vitest.config.json)；Jest、自定义运行器、monorepo 或特殊运行环境先读取 [适配说明](references/adaptation.md)。

## 2. 接入本地命令

使用项目既定的包管理器安装开发依赖并更新对应锁文件。Vitest 使用 `@stryker-mutator/core` 和 `@stryker-mutator/vitest-runner`；Jest 使用对应的 jest-runner，按官方说明配置。

增量模式需显式启用：

```json
{
  "incremental": true,
  "incrementalFile": "reports/stryker-incremental.json"
}
```

增加或复用以下 package.json scripts：

```json
{
  "mutation": "stryker run",
  "mutation:full": "stryker run --force"
}
```

- 将 `.stryker-tmp/` 和 `reports/` 加入忽略列表；已有报告目录另有用途时用独立子目录。
- mutate 指向业务源码，排除声明文件、生成代码及构建产物。不要为了提高分数随意排除业务分支、忽略静态变异或扩大超时。
- 增量模式没有历史文件时会在本次完整 mutate 范围内全量执行；`--force` 忽略已有结果并重建基线。
- 保留现有测试行为，先确认原始测试通过。依赖隔离、原生运行时等问题按适配说明处理。

## 3. 接入 CI 基线

先读取 [CI 基线设计](references/ci-baseline.md)。GitHub Actions 可从 [工作流模板](assets/mutation.yml) 开始适配；模板默认 main、Node 22、pnpm、根目录单包和 TypeScript 测试文件，复制后必须检查这些假设。

| 场景 | 执行 | 基线写入 |
| --- | --- | --- |
| 首次接入、缓存缺失或不兼容 | 全量 | 仅可信主分支成功后保存 |
| 面向主分支的 PR | 读取主分支基线，增量 | 不保存共享基线 |
| 推送或合并到主分支 | 增量 | 成功后保存新基线 |
| 手动 full | 强制全量 | 在主分支成功后保存 |

实现必须满足：

- 使用分离的缓存 restore/save 操作，PR 不写共享基线。
- 兼容性前缀包含系统、Node 和影响结果的非源码/非测试输入；每次保存追加唯一运行 ID 与 attempt。不可变缓存不能用固定 key 更新。
- restore fallback 只匹配兼容性前缀，不退回跨依赖或配置版本的宽泛前缀。
- 主分支运行不主动互相取消；同一 PR 的新提交可取消旧运行。旧基线只影响性能，仍须由 Stryker 检查内容差异。
- 允许手动 full，缓存缺失时自然退回全量，失败不覆盖基线。保留失败时可用的报告。
- GitHub Actions 使用普通 `pull_request`，不要在 `pull_request_target` 的特权上下文运行 PR 代码。默认 `contents: read`，不额外引入外部服务或 Secret。
- 其他 CI 平台沿用相同读写边界，按其缓存作用域和覆盖规则实现，不能直接套用 GitHub 的默认分支缓存行为。

## 4. 验证

使用现有检查验证交付；配置修改通常无需新增测试文件。

1. 运行项目要求的 lint、类型检查和相关测试；发现原分支已有失败时明确归因，必要的格式修复保持最小范围。
2. 校验工作流语法。GitHub Actions 优先使用 actionlint，单纯 YAML 解析不能验证表达式与权限语义。
3. 在有真实测试覆盖的小型源码文件上，用独立的临时 incrementalFile 做三次验证：无基线生成、同样输入再次运行、带 `--force` 强制运行。
4. 确认第二次确实记录 `result(s) are reused`，第三次不复用结果；只看到文件存在或命令成功不足以证明增量生效。
5. 说明首次主分支 CI 负责建立完整范围的共享基线。单文件冒烟不能宣称全项目变异测试通过。

示例（使用项目包管理器执行）：

```bash
pnpm mutation --mutate src/example.ts --incrementalFile /tmp/project-mutation-smoke.json
pnpm mutation --mutate src/example.ts --incrementalFile /tmp/project-mutation-smoke.json
pnpm mutation:full --mutate src/example.ts --incrementalFile /tmp/project-mutation-smoke.json
```

`src/example.ts` 是占位路径，必须替换为真实、具有有效测试覆盖且变异数量较少的源码文件；临时基线也要使用本次任务独立路径。不要将局部冒烟结果发布为主分支完整基线。

## 5. 分数与交付说明

- 首次接入先生成可信全量报告。没有用户要求或既有规则时，不凭空设置 `thresholds.break`，也不修改已有阈值。
- 分开说明“作业运行成功”和“达到评分门禁”。CI 接入本身不会自动设置分支保护或 required status check。
- 写清首次合并前没有主分支基线，PR 可能全量运行；依赖、配置、快照、辅助文件变化也可能全量重建。
- 增量运行仍需先执行原始测试以收集测试和覆盖信息，并非仅运行 git diff 对应测试。
- 静态变异及未跟踪输入存在限制，按需强制全量，见基线设计。不要把复用当作环境变化下的正确性保证。
- 最终报告配置位置、执行策略、测试证据、验证范围、实际安装/提交/推送状态，以及首次完整基线是否已经建立。
