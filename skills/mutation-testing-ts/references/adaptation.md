# 项目适配与排障

## 包管理器

尊重 packageManager 与现有锁文件，不使用全局 CLI 的版本替代仓库固定版本。pnpm 优先使用仓库指定版本；受限环境若默认 store 不可写，为该命令配置可写的 store/XDG 目录，不修改 HOME。

CI 模板默认 pnpm/action-setup 读取 packageManager；没有该字段时明确指定版本。npm 项目删除 pnpm setup，setup-node 的 cache 改为 npm，安装用 npm ci，命令用 npm run mutation / npm run mutation:full。Yarn 使用与仓库一致的 Yarn 版本及 immutable/frozen-lockfile 参数；不要一概假设 Corepack 已随 Node 安装。

GitHub setup-node 的 cache 只缓存依赖，不是变异基线缓存；两者需要分别配置。

## Vitest 与 pnpm 解析

先尝试标准插件标识 `@stryker-mutator/vitest-runner`。若 pnpm 隔离布局下确实出现插件解析失败，核查当前 Stryker 的加载机制与 exports，再选择受支持的显式路径或最小范围的 hoist 设置。不要无条件开启 shamefully-hoist。

某些版本可使用明确入口，例如 `./node_modules/@stryker-mutator/vitest-runner/dist/src/index.js`，但内部 dist 路径必须按实际安装版本验证。若必须 hoist，限定为所需插件命名空间，验证其他依赖未受影响，并更新 lockfile/包管理器配置。

模板的 `vitest.related: false` 使原始测试运行覆盖现有套件，适合导入关系复杂的场景。是否改回 related 优化需由项目覆盖范围与实际运行验证决定，具体检查见[运行器有效性与测试隔离](runner-validation.md)。

## 沙箱、符号链接与特殊运行时

Stryker 在沙箱中执行，node_modules 通常链接到真实安装目录。Vitest/Vite 或框架 testing-library 从真实路径加载 setup 文件时，可能遇到开发服务器文件系统 allowlist 限制。

确认错误来自真实路径后，将必要的真实项目路径加入已有 `server.fs.allow`，保留框架默认配置；不要禁用整个文件系统限制。例如以 `realpathSync(node_modules)` 的父目录定位真实项目根，沿用项目已有的合并配置方式。避免把某一框架补丁强加给所有 TypeScript 项目。

原生模块、ESM/CJS、浏览器运行器与专用编译器也需核对 runner 支持。先让未激活变异的 dry run 通过，再排查变异结果。不要为了通过 dry run 删除失败用例或屏蔽行为断言。

## Jest

使用当前受支持的 `@stryker-mutator/jest-runner`，查阅对应版本关于配置文件、项目选择、测试内容/位置跟踪、ESM 和 TypeScript 转换器的说明。复用项目现有的 ts-jest、Babel 或其他转换方式，避免将 Vitest 模板中的 `vitest` 字段复制到 Jest 配置。

## Monorepo

- 明确在哪个工作目录安装依赖、执行 Stryker、读取配置、保存报告。
- 每个包使用独立 namespace、报告路径和 concurrency 组；root lockfile、共享 tsconfig、跨包非变异依赖均纳入失效考虑。
- 调整 cache-dependency-path、缓存输入策略、artifact path 和 baseline path。缓存键脚本从 Git 根目录解析策略 glob，不随 run 的 working-directory 改变；在子目录执行时还需调整脚本和配置参数的位置。
- 默认哈希整个 Git 仓库，包含跨包源码。只将本包实际 mutate 范围与已跟踪测试放入 `trackedByStryker`，不要将整个 workspace 源码排除；共享配置和其他包会自然影响摘要。
- 跨包依赖不能被本包变异报告跟踪时，变化必须触发失效或全量重跑。

## 耗时与资源

根据首次全量的实际耗时、内存和 CI 配额设置 concurrency 与 timeout。增量仍有 dry run 的固定成本；不应承诺接入后每次 PR 都只需几秒。

静态变异可能需要多次重新加载测试环境，耗时明显。先衡量，不默认 ignoreStatic。耗时预算不足时明确记录尚未完成的完整验证范围，保留可复现命令，不能用单文件高分替代项目全量分数。
