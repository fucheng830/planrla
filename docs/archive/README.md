# 早期设计归档（2026-06）

本目录保留 CloudCLI / nomad 在**设计阶段**（2026-06-26 ~ 27）的原始设计与实施计划文档。

这些文档记录的是「为什么这么做」的决策推理与分步实施 TODO，**对应的实施成果已落地**，并已沉淀为 `docs/` 下的正式文档。保留它们仅作设计史追溯，**不应作为当前实现的依据**——请以下方「现对应正式文档」为准。

## 文档清单

| 归档文档 | 内容 | 现对应正式文档 / 状态 |
|---|---|---|
| [`2026-06-26-design.md`](./2026-06-26-design.md) | 总体商业化设计：C 方案 / Electron / 自建账号 / 商业模式 A / Open-core / 用户自备 Claude Code | [`../product/V1_PRODUCT_ROADMAP.md`](../product/V1_PRODUCT_ROADMAP.md)（核心决策已吸收） |
| [`plans/2026-06-26-1-cloud-backend.md`](./plans/2026-06-26-1-cloud-backend.md) | relay Worker 加账号体系（注册/登录/JWT + D1 设备注册表）实施计划 | [`../architecture/API_CONTRACT.md`](../architecture/API_CONTRACT.md)；账号化已在 `cloudcli-relay` 落地 |
| [`plans/2026-06-26-3-android-account.md`](./plans/2026-06-26-3-android-account.md) | Android 端账号登录 + 设备列表 + 一键连接实施计划 | [`../product/ANDROID_WORKSPACE.md`](../product/ANDROID_WORKSPACE.md)；Android 已迁入 `apps/android` |
| [`plans/2026-06-27-2-desktop.md`](./plans/2026-06-27-2-desktop.md) | fork `siteboon/claudecodeui` 补 `electron/` 外壳实施计划 | 已实现 —— 即本仓库 `cloudcli-desktop-fork` 本身 |

## 说明

- 当时项目代号 **CloudCLI**（含 `cc.brainmate.cc` 中继域名），后统一更名为 **nomad**，包名随之从 `com.archie.cloudcli` 改为 `cc.nomad.android`。文档中的旧名称保留原貌，未做改写。
- 实施类计划文档里的 `- [ ]` 任务勾选状态**已过时**，仅反映写作当时的进度，不代表当前真实状态。
