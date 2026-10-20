# 技能目录

只在技能完成并通过检查后，把它放到 `skills/<name>/SKILL.md`，并在下方添加链接与一句话用途。

| 技能 | 用途 |
| --- | --- |
| [npm-trusted-publish](npm-trusted-publish/SKILL.md) | 接入或优化 GitHub Actions npm OIDC 自动发包，覆盖 tag 校验、产物检查、预发布渠道、monorepo 和失败重跑。 |
| [mutation-testing-ts](mutation-testing-ts/SKILL.md) | 为 TypeScript/JavaScript 项目接入或检查 StrykerJS 变异测试与 CI，实现首次全量、PR 增量及主分支基线更新。 |

创建或改进技能时，优先使用当前 agent 已有、且支持本仓库目标路径的 `skill-creator`；不可用时才用 `pnpm scaffold <skill-name>` 复制最小模板。完成后统一运行 `pnpm check`。详细流程见[仓库说明](../README.md)和[贡献指南](../CONTRIBUTING.md)。
