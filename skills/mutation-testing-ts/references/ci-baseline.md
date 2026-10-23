# CI与本地基线有效性

## 两道判断与保守边界

GitHub cache key负责发现文件；Stryker incremental report负责记录旧变异与测试。恢复成功不代表结果有效，`cache-hit=false`也可能是restore-key前缀恢复；检查cache-matched-key和报告文件。

Stryker原生增量比较mutant/测试的位置与内容，并使用旧killing test和覆盖关系；它不是完整语义依赖分析。同文件中另一函数改变可以让位置不变的mutant复活，静态变异新增测试也可能继续复用Survived。helpers、fixtures、snapshot、依赖、环境本就不自动被Stryker完整跟踪。

因此随附guard只允许相同semanticHash直接增量；源码/测试语义输入变化保守full，不提供未经证明的全仓native开关。`trackedByStryker`仍可稳定发现前缀，但不能绕过semanticHash检查。若未来引入可靠影响分析，应独立设计/验证，不把本实现称为最小重测算法。

## 输入策略 schema 3

策略路径和glob从Git根目录解析。默认处理所有tracked及未忽略untracked；未stage删除与已stage删除按相同的路径缺失状态处理。报告、node_modules与无关生成物应忽略。必要的被忽略产物要显式建模，外部服务等变化则禁用复用或更换环境epoch。

- `trackedByStryker`：正向JS/TS glob，只从发现摘要省略；semanticHash仍包含它们。默认空。
- `alwaysHash`：覆盖上项；保留setup/helper、未变异跨包等输入。
- `nonSemanticFiles`：精确 `{ "path": "README.md", "reason": "经审核未作为测试/构建输入" }`数组，无glob。不要忽略整个package或lockfile。经审核的纯工具说明symlink可精确排除，其余symlink/submodule拒绝。
- `packageVersionFiles`：精确package.json路径与理由，只去掉version，其余未知字段也完整保留。自身版本输出、构建version注入或npm_package_version影响测试时不得使用。
- `npmLockVersionFiles`：仅支持npm lockv3 root版本，必须对应已审核的相邻package.json，且两个root版本都与package匹配。仅删除这两个root版本字段；所有transitive version/integrity/resolved保留。不支持的格式失败，pnpm/yarn默认原字节哈希。
- `environment`：额外非秘密环境变量名数组。不要包含令牌或密码。

依赖影响包括dependencies、devDependencies、peerDependencies、optionalDependencies、overrides/resolutions、pnpm patch等；不要只取字段白名单。完整manifest与lockfile共同约束声明/解析图，实际安装的各workspace直接依赖manifest也入摘要，捕获本地安装/卸载或实际版本变化。若installed manifest的realpath恰好指向已审核的packageVersionFiles，应用同一version窄规范化，避免workspace自引用把纯版本重新纳入；不能按包名或glob忽略已安装包版本。CI必须使用frozen/immutable安装，不能用摘要证明node_modules任意人工改动或未知全局工具已受保护。

运行指纹自动含实际Node版本、platform/arch/kernel、CI/NODE_ENV/NODE_OPTIONS/TZ/LANG/LC_ALL/ISLIB/MUTATION_PROJECT/MUTATION_ENV_ID及ImageOS/ImageVersion；只输出摘要，不打印值。需要的其他测试环境或数据版本显式加入。输入路径、执行权限、策略与实现也影响摘要。

## guard与本地命令

`run-mutation.mjs <策略> <报告> -- <命令> [参数]`，或调用export `runMutation({cwd, configFile, reportFile, command, args, force})`。命令应使用实际固定安装的Stryker，incremental开启，配置中的incrementalFile与参数一致。不得通过CLI覆盖incrementalFile/禁用incremental；不同作用域用独立报告/配置。

报告与 `<report>.inputs.json` 配对；sidecar绑定semanticHash、报告内容digest、wrapper digest及命令/参数（仅force不改变调用身份）。缺失、损坏、旧schema、输入变化、命令/scope变化或手动full都会丢弃旧报告。执行前移除旧授权，失败或中断不留下有效sidecar；成功且输入未在执行中变化，才原子写入新sidecar。报告不得覆盖Git跟踪输入，不能通过symlink写到工作区外。

即使本地直接执行过stryker留下新报告，原sidecar的digest不匹配也会重建，避免只修CI却继续误用本地旧结果。非零退出/没有有效增量报告不会生成新授权。

## CI权限与迁移

key形如 `mutation-<project>-v3-<OS>-node<Node>-<hash>-<run-id>-<attempt>`。Node实际完整版本已在hash内；工作流上的大版本标签不是兼容性保证。

分离cache restore/save，成对缓存report与sidecar，restore只使用完整兼容前缀。旧v1/v2没有有效新sidecar，不迁移为可信结果，也不使用宽泛fallback。首次main完整运行成功后保存；PR只读取main兼容基线，不保存共享namespace。手动full在main成功后也生成唯一key；失败报告可上传但不能save。缓存不可变，不能用固定key更新内容。

使用普通pull_request，不在pull_request_target特权上下文运行PR代码。默认contents:read，checkout persist-credentials:false，避免与其他不可信工作流共用namespace。GitHub按分支作用域隔离缓存；PR自己的缓存不能作为main基线。main concurrency不主动取消，仍不保证pending FIFO或最新提交必然完成；读取旧基线仍须guard校验。

Monorepo为每project设置namespace/report/工作目录与环境。对跨包源、共享配置、build产物来源保守；在key计算与run中保持相同MUTATION_PROJECT、ISLIB等。不能把一个package的局部冒烟报告当全workspace基线。

## 验收与官方依据

核对实际main SHA、push/manual运行、save步骤及cache保存日志；PR报告或本地文件不证明共享基线存在。每次安装/runner/patch变化重新验证真实变异行为，不只检查peer range/dry run。

- [Stryker incremental说明与限制](https://stryker-mutator.io/docs/stryker-js/incremental/)
- [Stryker配置](https://stryker-mutator.io/docs/stryker-js/configuration/)
- [Stryker10增量实现](https://github.com/stryker-mutator/stryker-js/blob/v10.0.0/packages/core/src/mutants/incremental-differ.ts)
- [GitHub缓存作用域与匹配](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)

本地新增且未被 Git 忽略的文件也参与摘要；未 stage 删除按路径已不存在处理，与 stage 后删除一致。安装包摘要记录直接依赖的实际 manifest，并不检测 `node_modules` 内同版本代码被手工改写；应使用受控、frozen lockfile 安装，无法保证时使用 `mutation:full`。
