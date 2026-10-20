---
name: npm-trusted-publish
description: 为 npm 包接入、修复或评审 GitHub Actions 自动发包，使用 Trusted Publishing/OIDC，覆盖 tag 与版本校验、发布产物检查、预发布渠道、失败重跑、monorepo 依赖顺序和 GitHub Release。当用户提到 CI 发包、npm 自动发布、Trusted Publisher、OIDC、tag release、发包重跑或 npm provenance 时使用。不用于仅运行测试的 CI、网站部署、Docker/PyPI 等非 npm 发布，或只发布本技能仓库本身。
metadata:
  version: "0.1.2"
---

# npm 自动发布与 Trusted Publishing

优先改进已有发布流程，沿用项目约定。交付 workflow、可验证的发布产物、失败重跑策略和维护者说明；不要为单包强加 monorepo、Changesets 或新的版本管理工具。

## 1. 确定输入

- 阅读适用的 AGENTS.md，检查工作区、远端、默认分支、现有 workflow 和未提交修改。
- 从 package.json、锁文件、文档和现有 CI 确认包管理器及固定版本、Node engines、包名、公开性、测试/构建/lifecycle 命令、导出入口和真实发包文件。
- 确定单包或 workspace、统一或独立版本、tag 格式、稳定与预发布渠道、GitHub Release 附件。默认沿用现有约定；全新 npm 流程可使用 `vX.Y.Z` / `latest` / `next`。
- 无法定位项目时先询问路径或仓库链接；未知 registry、包名、版本策略等会改变发布目标时先澄清，不在猜测的项目生成文件。能从代码推断的信息无需重复询问。
- 检查本项目实际产物约定：Lynx 可能必须发布源码 TSX；不要为了发 npm 就把 exports 改成普通 JS。CLI 要检查 bin、shebang 与权限。

## 2. 选择认证和模板

先读 [认证与项目适配](references/adaptation.md)，核对 npm 当下支持的 runner、Node/npm 版本和 Trusted Publisher 设置。

- GitHub 托管 runner 的公开 npm 包优先使用 OIDC；npm CLI 至少 11.5.1，Node 24 自带符合要求的 npm，但仍须核对运行日志。不因为项目依赖 pnpm 就假设 `pnpm publish` 自动支持 OIDC。
- pnpm 负责安装、检查和构建；npm CLI 负责打包/发布的模板适用于已有 pnpm 项目。npm/yarn 项目替换 setup、缓存和命令，保留原锁文件。
- 单包可复制 [workflow](assets/release.yml)、[发布 helper](scripts/npm-release.mjs) 与 [helper 测试](scripts/npm-release.test.mjs) 到目标项目的 `.github/workflows/release.yml` 和 `scripts/`。先检查文件是否存在，再最小合并，不能直接覆盖。
- 模板假设根目录单包、`main`、`v` 前缀、npmjs.org、公开包、pnpm，以及 `check/typecheck/test/build/test:release` 命令。逐项适配；补充 `test:release: node --test scripts/npm-release.test.mjs`，或改成直接命令，并接入普通 PR CI。
- helper 仅支持无通配符的具体 exports/main/types/bin 入口，含 `*` 时主动失败；复杂 exports、工作区依赖、其他 registry 或独立版本先适配再使用。模板不替代项目已有发布工具。

## 3. 落实发布约束

1. **先验证**：在依赖安装和写操作前验证 tag 是严格版本、与所有待发包 manifest 一致，必要时包括 Obsidian manifest.json。模板拒绝 npm 无法原样保留的 `+build`；不同 tag 策略需显式改校验器。使用完整 Git 历史，检查 tag 提交属于实际发布分支。annotated tag 与轻量 tag 都须定位真实提交。
2. **再检查与打包**：冻结锁文件安装，运行项目必需检查、类型测试、单元测试和构建。用真实 pack 清单核对公开入口、类型、CSS、CLI 及包内依赖。打包成功不等于能被消费者加载；按项目添加必要 smoke test。
3. **发布已检查的文件**：构建后生成 `.tgz`，检查清单，发布同一文件。模板用 `--ignore-scripts` 避免打包/发布 lifecycle 改写产物；先确认已显式执行所需 prepack/prepare/prepublishOnly 工作。不能跳过项目依赖的生命周期。
4. **明确渠道**：正式版本走 `latest`，预发布走 `next` 并设 GitHub prerelease，或沿用指定渠道。不得让 beta/rc 默认覆盖 latest。
5. **严格重跑**：每个包查询精确版本，存在则跳过，只有结构化 npm `E404` 视为缺失；网络、认证、限流、无效响应均终止。不要 `2>/dev/null` 后把任意失败当作未发布，也不要用 `|| true` 吞掉 publish 失败。
6. **最后完成 Release**：全部必需 npm 包成功后才创建或完成 GitHub Release。分页列表查询成功后判断 tag 是否存在，已有 Release 按约定补全，不把认证失败当作不存在。附件缺失时单独补传，不能只跳过整个已有 Release。
7. **控制并发与权限**：发布串行，`cancel-in-progress: false`，避免发到一半被取消；GitHub concurrency 不保证顺序且仅保留一个 pending，多版本积压必须另有队列或逐个发版。默认 `contents: read`，仅发布 job 开 `contents: write` / `id-token: write`，不用 `pull_request_target` 执行 PR 代码发布。

monorepo、Obsidian 附件与已有项目评审按 [适配说明](references/adaptation.md) 处理。第三方示例只作为参考，不代表可以执行其中的发布、复制私密配置或修改其他仓库。

## 4. 写明一次性配置与操作

- 写出准确的 npm Trusted Publisher owner、repository、workflow **文件名**、environment；没有 GitHub environment 时留空，重命名或加入 environment 后同步 npm 设置。每个 npm 包分别绑定。
- 按实际发布模式设置 Trusted Publisher 的 **Allowed actions**：本模板执行 `npm publish`，必须允许直接发布。OIDC 验证身份，动作权限决定能否直接发包；不要把该开关误认成传统 token 发布权限。用户只允许 `npm stage publish` 时，应采用暂存后审批的流程，不能承诺当前模板会自动公开包。详见适配说明。
- 不新增 NPM_TOKEN 来掩盖 OIDC 问题。区分“代码已提交”和“npm 后台已绑定”；只有实际证据才能声称配置完成。首次新包的引导方式按 npm 当下官方支持执行。
- 说明 npm 公开 OIDC 发布的 provenance 与 GitHub 附件 attestation 是两套机制；只有需要附件证明时才添加 attestations 权限和 action。
- 说明改版本、合入发布分支、推送 tag、查看结果、失败后重跑原 tag，以及代码变更须使用新 npm 版本。
- 配置 CI 的授权不自动包含真实发版；只有用户或现有会话已授权实际发布时，才推送发布 tag、改 dist-tag 或执行真实 publish。遵守已有授权，不重复索要确认。

## 5. 验证与交付

1. 使用项目固定的工具链运行所需检查。配置通常无需另加测试；若改发布 helper，则运行成功、失败和重跑测试，禁止测试中访问真实发布 API。
2. 用 actionlint 检查实际 workflow；YAML 解析不能替代表达式和 action 语法检查。
3. 在真实项目构建并 pack，核对精确发包清单和消费者使用方式。直接运行 helper 的配套测试，覆盖 tag 错误、入口缺失、404、认证/网络错误、已发版本、预发布渠道和 GitHub 部分失败。测试与脚本一起维护和复制，可在未安装目标依赖时执行：`node --test <skill-dir>/scripts/npm-release.test.mjs`；本技能仓库的 `pnpm test` 也会直接发现并执行它。
4. 模拟首次发布、npm 成功后 GitHub 失败、部分包失败后重跑；确认 GitHub 完成步骤只在全部必需包成功后运行。mock 验证需明确标注，不能冒充真实 OIDC 发版。
5. 报告改动、命令与结果、pack/运行验证范围、未完成的外部配置、真实发布是否执行、commit/PR 链接。按用户要求创建 PR，未经授权不合并。
