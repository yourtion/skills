# CI 增量基线设计

## 基线的含义

基线是 Stryker incremental report，包含可复用的变异结果、源码、测试内容及测试关联信息，不是覆盖率文件，也不是分数门槛。增量运行仍需执行 dry run，发现当前测试和覆盖关系，再决定哪些结果可复用。

Stryker 会比较变异源码和运行器提供的测试内容。测试内容/位置跟踪能力取决于运行器及版本，接入前核对官方支持表；不支持时不得声称测试变化能够被完整识别，应扩大失效范围或改用全量。

## 缓存键

建议结构：

```text
mutation-<baseline-namespace>-v2-<OS>-node<Node>-<compatibility-hash>-<run-id>-<attempt>
```

- namespace 区分包、工作目录和共享基线；单包可以使用 default，monorepo 每个包必须独立。
- 兼容性 hash 覆盖依赖锁文件、package.json、workspace/包管理器配置、Stryker 配置、测试运行器配置、tsconfig、快照、测试辅助文件与 fixture，以及非变异源码、跨包依赖和资源文件。
- 模板默认哈希全部 Git 跟踪文件；确认 Stryker 跟踪能力后，才显式排除普通变异源码与测试。这样新增辅助目录自动失效，不需要不断扩展目录白名单。保守默认下，源码、测试乃至文档变化也会重建；这是尚未审核排除范围时的成本。
- 环境变量、外部服务数据、Git 未跟踪或忽略的生成文件等不能由此脚本自动覆盖。配置稳定的环境标识、将必要输入提交到 Git，或在这些输入变化时禁用复用；不把凭据值放进 key。
- GitHub cache 不可变，`run-id + attempt` 确保同一提交重跑、手动 full 都能保存新结果。restore 仅使用兼容性前缀，取该作用域下最近创建的匹配缓存。
- 如果 CI 的 Node 使用浮动大版本，日常补丁升级通常不改变 namespace；遇到运行时语义变化必须更换环境版本标识或强制重建。要求严格复现时固定完整 Node 版本并加入 key。

## 输入策略与清单验证

把 [baseline-inputs.mjs](../scripts/baseline-inputs.mjs) 复制到目标项目的
`.github/scripts/baseline-inputs.mjs`，把 [策略模板](../assets/mutation-cache-inputs.json) 复制到
`.github/mutation-cache-inputs.json`，与工作流一起提交。脚本使用 Node.js 22.20+ 内置 API 与 Git，
无 npm 依赖，不加载或执行目标项目的 JS 配置。两份文件的内容本身始终参与键计算。

策略只包含两个正向 glob 数组，路径从 Git 根目录开始、使用 `/`，不接受 `!`、绝对路径或 `..`：

- `trackedByStryker`：已验证由 Stryker 跟踪、可从兼容性摘要中省略的源码和测试。默认空数组。
- `alwaysHash`：覆盖上面的排除，例如 mutate 范围内实际被排除的辅助源码或生成代码。

以 `mutate: ["src/lib/**/*.ts", "!src/lib/**/*.d.ts"]`、Vitest `include: ["src/test/test*.ts"]`
为例，确认 runner 能报告测试内容与位置后，可配置：

```json
{
  "trackedByStryker": ["src/lib/**/*.ts", "src/test/test*.ts"],
  "alwaysHash": []
}
```

此时 `src/test/setup.ts`、`src/test/helper.ts`、`src/test/utils/**`、`packages/**/src/**`
和新提交的 fixture 均自动进入哈希；改源码/普通测试可交给 Stryker 增量比较。对于常规
`*.test.ts` / `*.spec.ts` 项目，必须按真实 include 范围填写；不能照抄此处的命名约定。
若只变异 `src/lib` 的一部分，必须缩小 glob 或在 `alwaysHash` 中保留不参与变异的文件。

即使排除 glob 过宽，脚本也只允许省略 JS/TS 源文件；`.d.ts` / `.d.mts` / `.d.cts` 声明、
`.snap`、JSON 等其他输入仍会哈希。但它不会推断 TypeScript 导入图，也无法证明某个 `.ts` 文件
确实由 Stryker 跟踪；误将 setup/helper 归入排除仍然会出错，必须检查清单和运行验证。

```bash
# 在仓库根目录调用；子目录调用需调整脚本路径，配置参数仍从 Git 根目录解析
node .github/scripts/baseline-inputs.mjs .github/mutation-cache-inputs.json --list
node .github/scripts/baseline-inputs.mjs .github/mutation-cache-inputs.json
```

`--list` 输出 JSON，分别列出 `hashedFiles`、`strykerTrackedFiles` 和 `hash`，不输出文件内容。
工作流也打印清单，便于 review。摘要排序后包含路径、执行权限和当前工作区文件内容，新增、删除、
重命名均影响键；不使用 Git index 中的旧内容代替本地编辑。

在临时 Git 工作区逐项验证：

| 改动 | 已适配排除后的预期 |
| --- | --- |
| setup、helper、fixture、快照、锁文件、配置、未变异跨包源码 | 键改变 |
| 新目录中的辅助文件（先 `git add`） | 键改变 |
| 仅变异源码、runner 正确跟踪的测试内容 | 键不变，由 Stryker 比较内容差异 |
| 策略或缓存键脚本自身 | 键改变 |

没有配置排除时，源码和测试变化也应改变键。摘要稳定性和失效验证不能代替 skill 中的三次真实
Stryker 运行。Git 命令失败、配置错误、输入缺失或非普通文件（符号链接/子模块）时脚本直接失败，
不生成可复用键；先明确这些输入如何追踪，必要时移除基线缓存并使用全量流程。

## 读写权限与并发

GitHub 的 `actions/cache/restore` 可以读取当前分支、PR 基分支或默认分支允许访问的缓存。使用 main 作为 PR 基分支时，可复用 main 的兼容基线。模板仅允许指定主分支保存缓存，不在 PR 保存；主分支不能依赖 PR 缓存。不要将其他工作流写入的非可信缓存混用同一 namespace。

主分支采用不主动取消运行的 concurrency 组，避免每次提交都中断首次全量建立。GitHub 默认并不保证 pending 运行 FIFO，pending 任务也可能被较新任务替换；不要宣称每个主分支提交一定执行或缓存一定对应最新提交。即使读取稍旧基线，Stryker 仍比较当前源码/测试，正确处理变更。

工作流先运行测试，再以成功条件保存基线。报告用 `always()` 上传。失败的报告可供诊断，不能覆盖共享基线；首次失败后下一次依旧全量。

核对基线时使用实际 main 提交和对应的 push/manual 运行，检查每个包的保存步骤及缓存日志。
PR 的报告 artifact、开发机上的 incrementalFile，或保存步骤被跳过的成功作业，都不证明共享基线已建立。
更新运行器或仓库内补丁后，确保这些输入参与兼容性摘要，并强制重建已知不可信的旧结果。

## 重建策略

缓存缺失、被淘汰、依赖或配置变化时，自动全量是预期行为。首次工作流还未合入主分支时，PR 没有可复用基线；合并后第一次主分支运行会建立它。

手动 full 用 `--force`，保留 incremental 开启状态，从而既重跑全部范围又写出新基线。在主分支执行后，成功结果才发布为共享基线。非主分支手动运行只上传报告。

Stryker 对静态变异、非变异辅助输入和运行环境的变化检测有限。必要时强制全量。只有用户要求时才增加定时全量任务；不能假设每次增量结果都等价于在任意变化环境中全量重跑。

## 分数与门禁

沿用现有 thresholds 配置。没有最低分规则时，作业可以成功完成但仍有 surviving mutants。后续根据完整报告制定评分门槛；“对比主分支分数不下降”需要额外比较与异常处理逻辑，不等同于共享增量基线，也不是 Stryker 默认门禁。

required status check、分支保护、外部 dashboard 和 Secret 均是独立设置，按用户实际要求处理，不作为接入必要前提。

这些是需要持续维护的执行规则。一次运行的得分、分类计数和验证日志放在对应 PR、CI summary
或 artifact，引用时标明提交与完整/局部范围；不要为记录首轮结果在项目 README 中追加长篇报告。

## 官方资料

- [StrykerJS incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/)
- [StrykerJS configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)
- [GitHub cache restore/save](https://github.com/actions/cache)
- [GitHub cache scope](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)

使用时核对当前文档与已安装版本；链接不替代对项目实际配置的检查。
