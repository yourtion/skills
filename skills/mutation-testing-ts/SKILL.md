---
name: mutation-testing-ts
description: 为 TypeScript/JavaScript 项目接入、修复或评审 StrykerJS 变异测试及 CI，涵盖 Vitest/Jest 适配、执行频率与成本、main 自动加手动触发、合并门禁迁移、可信基线及语义输入失效。当用户提到变异测试、mutation testing、Stryker、增量变异测试或变异测试 CI 优化时使用。仅用于 TypeScript/JavaScript 变异测试，不用于普通覆盖率、常规 CI 或数据库 mutation 操作。
metadata:
  version: "0.4.0"
  short-description: TypeScript 变异测试调度与语义输入基线保护
---

# TypeScript 变异测试与 CI

沿用项目的包管理器、Node、测试运行器及协作约定。缓存发现和变异结果有效性是两道判断：能恢复报告不等于能复用结果。默认保护正确性，只复用相同语义输入；未经影响分析的源码、测试变化保守重测。

## 1. 检查项目与边界

- 阅读适用 AGENTS.md、README、贡献指南，检查分支与未提交修改；先确定目标项目，不在无关目录生成配置。
- 确认真实默认分支、workspace、packageManager、Node engines、runner与锁定版本、源码和测试范围、已有mutation接入。
- 检查仓库可见性、runner类型、首次全量与重复执行耗时、提交频率、并发及报告存储预算；读取现有required checks、rulesets和聚合作业依赖，无法读取时明确记录未核实。
- 查询对应版本官方兼容要求，core/runner版本匹配；不要把案例版本当通用要求。Vitest从[配置模板](assets/stryker.vitest.config.json)适配，Jest/monorepo等先读[适配说明](references/adaptation.md)。
- 区分被测产品依赖与测试工具依赖；dependencies、devDependencies、peer/optional、overrides、patch、锁文件、setup/config都可能改变变异结果，不能仅哈希prod依赖或排除整个package.json。
- 不自动设置分数门禁、保护规则、外部服务或Secret，不擅自发布或合并。

## 2. 配置 Stryker 与统一入口

安装当前runner所需开发依赖并更新项目原有锁文件。确认原始测试通过，再启用独立报告：

```json
{
  "incremental": true,
  "incrementalFile": "reports/stryker-incremental.json"
}
```

将 `reports/`、`.stryker-tmp/` 和非输入的生成产物加入忽略列表。mutate指向业务源码，排除声明/生成代码；不要为分数任意删除业务分支或忽略静态变异。

复制[baseline-inputs.mjs](scripts/baseline-inputs.mjs)、[run-mutation.mjs](scripts/run-mutation.mjs)到项目 `.github/scripts/`，复制[策略模板](assets/mutation-cache-inputs.json)到 `.github/mutation-cache-inputs.json`。脚本无npm依赖，要求Git与Node22.20+；不得依赖agent安装目录。

本地和CI均调用guard入口，避免仅CI换key而本地仍直接复用旧报告：

```json
{
  "scripts": {
    "mutation": "node .github/scripts/run-mutation.mjs .github/mutation-cache-inputs.json reports/stryker-incremental.json -- node node_modules/@stryker-mutator/core/bin/stryker.js run",
    "mutation:full": "npm run mutation -- --force"
  }
}
```

按项目包管理器调整full命令。已有多项目动态报告路径时用小型Node launcher调用 `runMutation` export，显式校验project与报告路径。保留必要环境（如ISLIB），使计算key与执行时一致。不要让日常入口覆盖报告路径或关闭incremental；不同作用域用独立报告和配置。

## 3. 审核输入与 CI

先读[CI基线设计](references/ci-baseline.md)，从[工作流模板](assets/mutation.yml)适配分支、Node、包管理器、namespace和工作目录。

- 默认建议仅push main自动执行，加workflow_dispatch手动触发；PR保留已有lint、类型检查、普通测试、覆盖率和合约测试。结合项目风险、预算与用户选择调整：需要合前结果的项目可保留PR执行，高频main可另议定时执行；不把默认建议当成所有项目的硬性要求。
- 将required mutation移出PR前先完成门禁迁移检查，给出精确检查名和待维护者执行的变更；不能仅删除触发、留下永久Pending的required check，也不能用跳过或伪造成功掩盖未执行。手动运行不自动满足PR门禁，细节见基线设计。
- 高风险PR可在同仓库分支手动运行，核对实际checkout SHA，必要时full；分支结果只供合前审查，不写共享main基线。main失败必须明确负责人和修复/重跑方式，不能以普通CI通过当作mutation通过。
- 默认纳入Git跟踪文件和未忽略的untracked文件；新本地helper尚未git add也影响摘要。被忽略但参与测试的输入必须显式建模或强制full。
- `nonSemanticFiles`只列精确路径及审核理由，不允许宽泛glob。文档/发布说明只有不被测试、构建或运行代码读取时才可忽略；不要全局忽略Markdown。
- `packageVersionFiles`只在验证自身version不会影响被测行为后使用；其余所有字段继续哈希。CLI版本输出、npm_package_version、构建注入版本均需保守。锁文件默认完整哈希；npm root版本的窄规范化见基线设计，不支持的格式不可猜测过滤。
- `trackedByStryker`只影响兼容性键清单，不能授权任意源码/测试结果复用。guard的semanticHash始终包括这些文件，变化仍full；Stryker对跨函数影响和静态变异存在限制。
- runtime含真实Node完整版本、OS/arch/kernel、runner image、受控环境及实际安装的直接依赖manifest；锁文件负责完整解析图。外部服务/生成物/其他环境输入需额外明确建模。
- 用 `node .github/scripts/baseline-inputs.mjs .github/mutation-cache-inputs.json --list`审阅清单。策略与实现自身必须参与摘要。
- 分离restore/save；仅成功的main push或main手动运行保存报告及`.inputs.json`配对文件。其他分支手动运行只读；显式保留PR执行时使用普通pull_request，PR也只读。默认contents:read，checkout不保留凭据，不使用pull_request_target运行PR代码。
- 升级namespace到v3，只恢复完整相同前缀，不fallback旧namespace/跨依赖前缀；唯一key追加run-id+attempt。首次main需要完整重建，PR产物不是共享基线。
- 保留手动full与失败报告；main不主动取消，但不能承诺FIFO或每个提交都执行。

## 4. 真实验证

先读[运行器有效性与隔离](references/runner-validation.md)。dry run成功、配置可加载、字段测试通过都不能代替真实变异执行。

1. 执行项目要求的相关lint、类型检查、普通测试和工作流校验；GitHub优先actionlint。原分支已有失败需归因，不能借机删测试。
   核对事件矩阵：PR不自动执行mutation但原有检查仍运行；main push和手动均可执行；分支手动与失败main不save，成功main才save。核实required checks与聚合依赖不会等待已移除的PR作业。
2. 验证dep/devDep/peer/optional、脚本/exports/engines、overrides/patch、锁文件、setup/helper、fixture内容及新增删除、快照、runtime/environment均使语义输入失效。实际安装依赖新版本后再做至少一组真实变异对照，不能把修改package字段称为已验证依赖升级。
3. 在有真实覆盖的小范围、独立报告上做无基线、同语义再次执行、强制full；确认真实执行、同输入复用和force不复用，并逐mutant比较fresh结果。
4. 注入能杀死或复活变异的helper/fixture或依赖变化，确认guard重测与fresh一致；同时验证旧/损坏报告、缺sidecar、失败/中断、命令或作用域变化不能误用。
5. 文档/纯version排除必须有审核依据和实测；遇到源码跨函数影响、静态变异新增测试等，不以原生增量日志代替fresh正确性验证。
6. 小范围验证不等于全项目全量通过；核对成功main的cache-save日志才可声称可信共享基线已建立。记录实际版本、SHA、范围、时间、复用数与未验证项。

smoke使用独立配置（内容需纳入输入清单）设置小mutate范围及 `reports/smoke/incremental.json`，再调用同guard指向该报告。不要把局部报告保存为主分支完整基线；CLI的incrementalFile覆盖被guard禁止。

## 5. 交付与维护

交付配置、锁文件、统一命令、策略清单、CI和简洁维护说明。分开说明作业成功与评分门禁；Survived、NoCoverage、RuntimeError分别报告，不能把变异分数称代码覆盖率或把全部存活称业务缺陷。

复用项目贡献/开发文档，或独立mutation指南；不默认扩写主README、添加分数表或徽章。长期指南保留命令、范围、执行频率、手动分支验证、门禁迁移、main失败跟进及基线读写/失效/重建规则；逐轮得分、日志、耗时与调试过程放交付报告/PR/CI artifact。声明本地修改、提交/推送、验证范围及剩余边界；不把未完成CI或局部冒烟称为全量成功。
