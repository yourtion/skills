# CI 增量基线设计

## 基线的含义

基线是 Stryker incremental report，包含可复用的变异结果、源码、测试内容及测试关联信息，不是覆盖率文件，也不是分数门槛。增量运行仍需执行 dry run，发现当前测试和覆盖关系，再决定哪些结果可复用。

Stryker 会比较变异源码和运行器提供的测试内容。测试内容/位置跟踪能力取决于运行器及版本，接入前核对官方支持表；不支持时不得声称测试变化能够被完整识别，应扩大失效范围或改用全量。

## 缓存键

建议结构：

```text
mutation-<baseline-namespace>-v1-<OS>-node<Node>-<compatibility-hash>-<run-id>-<attempt>
```

- namespace 区分包、工作目录和共享基线；单包可以使用 default，monorepo 每个包必须独立。
- 兼容性 hash 覆盖依赖锁文件、package.json、workspace/包管理器配置、Stryker 配置、测试运行器配置、tsconfig、快照、测试辅助文件与 fixture。按实际导入补充脚本、全局 setup、非变异源码、资源文件等。
- 环境变量、外部服务数据等不能由 hashFiles 自动覆盖。配置稳定的环境标识或禁用复用，不把凭据值放进 key。
- 普通变异源码与可被 Stryker 正确跟踪的测试文件不纳入 hash，否则每次改测试都会失效。声明文件并不被 mutate 跟踪，必要时纳入兼容性 hash。
- 排除测试文件时精确匹配扩展名；`!**/*.test.*` 还可能排除 `.test.ts.snap`，造成快照变更被漏掉。
- GitHub cache 不可变，`run-id + attempt` 确保同一提交重跑、手动 full 都能保存新结果。restore 仅使用兼容性前缀，取该作用域下最近创建的匹配缓存。
- 如果 CI 的 Node 使用浮动大版本，日常补丁升级通常不改变 namespace；遇到运行时语义变化必须更换环境版本标识或强制重建。要求严格复现时固定完整 Node 版本并加入 key。

## 读写权限与并发

GitHub 的 `actions/cache/restore` 可以读取当前分支、PR 基分支或默认分支允许访问的缓存。使用 main 作为 PR 基分支时，可复用 main 的兼容基线。模板仅允许指定主分支保存缓存，不在 PR 保存；主分支不能依赖 PR 缓存。不要将其他工作流写入的非可信缓存混用同一 namespace。

主分支采用不主动取消运行的 concurrency 组，避免每次提交都中断首次全量建立。GitHub 默认并不保证 pending 运行 FIFO，pending 任务也可能被较新任务替换；不要宣称每个主分支提交一定执行或缓存一定对应最新提交。即使读取稍旧基线，Stryker 仍比较当前源码/测试，正确处理变更。

工作流先运行测试，再以成功条件保存基线。报告用 `always()` 上传。失败的报告可供诊断，不能覆盖共享基线；首次失败后下一次依旧全量。

## 重建策略

缓存缺失、被淘汰、依赖或配置变化时，自动全量是预期行为。首次工作流还未合入主分支时，PR 没有可复用基线；合并后第一次主分支运行会建立它。

手动 full 用 `--force`，保留 incremental 开启状态，从而既重跑全部范围又写出新基线。在主分支执行后，成功结果才发布为共享基线。非主分支手动运行只上传报告。

Stryker 对静态变异、非变异辅助输入和运行环境的变化检测有限。必要时强制全量。只有用户要求时才增加定时全量任务；不能假设每次增量结果都等价于在任意变化环境中全量重跑。

## 分数与门禁

沿用现有 thresholds 配置。没有最低分规则时，作业可以成功完成但仍有 surviving mutants。后续根据完整报告制定评分门槛；“对比主分支分数不下降”需要额外比较与异常处理逻辑，不等同于共享增量基线，也不是 Stryker 默认门禁。

required status check、分支保护、外部 dashboard 和 Secret 均是独立设置，按用户实际要求处理，不作为接入必要前提。

## 官方资料

- [StrykerJS incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/)
- [StrykerJS configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)
- [GitHub cache restore/save](https://github.com/actions/cache)
- [GitHub cache scope](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)

使用时核对当前文档与已安装版本；链接不替代对项目实际配置的检查。
