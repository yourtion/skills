# 认证与项目适配

## npm OIDC

- [Trusted Publishers 官方文档](https://docs.npmjs.com/trusted-publishers/) 是认证要求的依据；核对当前支持的 CI runner 和 npm 版本，不能仅依据旧项目注释。
- npm CLI >=11.5.1 支持 Trusted Publishing；GitHub job 需要 `id-token: write`。模板使用 GitHub 托管 `ubuntu-latest` 和 Node 24，不全局安装浮动最新版 npm。
- npm 后台为每个包添加 GitHub Actions publisher：owner、repo、workflow filename（例如 `release.yml`，不是 display name 或完整路径）、可选 environment，大小写准确。没声明 job environment 就留空。
- npm Trusted Publisher 无需 NPM_TOKEN；模板不向 setup-node 传 registry-url，避免生成 token 占位配置。查询和发布显式使用 npmjs.org。审查项目自带 .npmrc、publishConfig 和其他认证配置，避免发布到错误 registry 或遗留 token 干扰。不要删除或打印用户凭据。
- 新包没有设置页面时，按当下官方支持的首次创建方式引导；不要承诺仅靠 workflow 能创建并自动绑定。已有 token 流程迁移时先验证 OIDC，再按用户授权管理旧凭据。
- 公开仓库通过 npm OIDC 发布通常自动获得 provenance；不要把 `id-token: write`、`--provenance` 或本地 dry-run 当作已验证的 npm 认证。
- 自托管 runner、私有包或非 npmjs.org registry 必须先验证官方支持。不要自动退回长期 token；必要配置缺失时准备可审查改动并说明阻塞。

## monorepo

先列出待发布包的 name、version、private、路径、内部依赖和公开入口，确认统一或独立版本策略。不强迫用户采用统一版本；已有 Changesets/release-please 等工具优先保留。

统一版本项目：

1. 校验 tag 对应全部**待发布**包，不盲目匹配 packages/* 把 private 工具也发布出去。
2. 由内部依赖图计算发布顺序，依赖先于消费者。禁止照抄其他项目的目录列表。
3. 使用包管理器的 workspace-aware pack 处理 `workspace:` 协议，再验证每个 tarball 里的 package.json。不能把只读外层清单的 npm 单包 helper 原封不动套上去。
4. 核对转换后的内部依赖范围与目标版本相容、产物入口存在、依赖可以按最终包名解析。需要时在临时消费者中安装本次全部 tarball 测试。
5. 逐包查询精确版本并发布：A 成功、B 失败时，重跑跳过 A 后继续 B。每个包分别配置 Trusted Publisher。查询到非 404 错误立即停止，避免污染后续包。
6. 全部必需包完成后才完成 GitHub Release。没有自动回滚已发布 npm 版本；修复需新版本。

独立版本项目：确认 tag 如何选择包及版本，只校验本次发布集；内部依赖改版时遵循已有工具。不要凭空给所有包写相同 version。

## Obsidian 与附件

- tag 可能不带 v，需按该项目约定同时检查 manifest.json 和 package.json；不要照抄模板的 v 前缀。
- 校验实际必需的 main.js、manifest.json、styles.css，再附加到 Release。已有 Release 不代表附件齐全；重跑列出 assets 后补缺失项。只有确定允许替换资产时才使用 `gh release upload --clobber`。
- 需要 GitHub build attestation 才增加 `attestations: write` 和 provenance action；npm 的 provenance 无需用该 action 生成。
- 有 CLI 与插件双通道时，说明 npm 和 GitHub 任一已完成后的重跑顺序。npm 全部完成再公开最终 GitHub Release；可用 draft 暂存附件，但失败时不提前公开成功状态。

## 评审现有 workflow

| 发现 | 改进 |
| --- | --- |
| `npm view ... 2>/dev/null` 后直接 publish | 解析结构化 E404；认证、限流与网络失败中止 |
| `gh release view` 任意错误都视为不存在 | 成功分页查询列表后判断 tag；API 错误传播 |
| 发 npm 前公开 GitHub Release | 全部必需包完成后再公开 Release |
| 构建后重新运行不可控 lifecycle | 明确执行必要生命周期，校验并发布同一 tarball |
| beta/rc 没有显式 dist-tag | next/指定渠道，并设置 GitHub prerelease |
| 硬编码另一项目的包名、版本或目录 | 从目标 manifest / workspace 读取并校验 |
| `pnpm publish` 直接假定支持 OIDC | 核对实际 pnpm/npm 支持；可让 npm CLI 发布已转换的 tarball |
| 用 tag filter 代替版本校验 | 严格校验版本和发布分支归属 |
| 只有 release 作业测试 helper | 将发布 helper 测试也加入普通 PR CI |

## 参考案例与依据

以下仓库用于分析实际需求与故障模式，模板及 helper 为独立编写，未复制其源码；应用时检查最新实现。

- [obsidian-feishu-diary release.yml](https://github.com/yourtion/obsidian-feishu-diary/blob/main/.github/workflows/release.yml)：Obsidian 附件、manifest 与 npm 同版本、OIDC。
- [mcp-knot publish.yml](https://github.com/yourtion/mcp-knot/blob/main/.github/workflows/publish.yml)：多包校验、tarball、依赖顺序、发布后完成 Release、可选 GHCR。
- [dsh-decision release.yml](https://github.com/yourtion/dsh-decision/blob/main/.github/workflows/release.yml)：多包同版本、逐包重跑和 pnpm 版本适配。
- [lynx-html-renderer](https://github.com/yourtion/lynx-html-renderer)：源码 TSX 导出、生成 CSS 的单包案例。
- [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)：并发组、pending 限制与不保证顺序。
- [npm pack](https://docs.npmjs.com/cli/commands/npm-pack)、[npm publish](https://docs.npmjs.com/cli/commands/npm-publish)：打包、生命周期与发布参数。
