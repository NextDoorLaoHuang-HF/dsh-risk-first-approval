# DSH Risk-first Approval

独立、可移除的 Auto 审批插件，当前插件版本 `0.1.3`，适配 DSH `0.2.0-rc.2`。

## 审核路由配置（0.1.3 新增）

生产入口与热引擎均暴露三个 Config 字段（插件设置页可见，两处需保持一致）：

- `reviewerProvider` / `reviewerModel`：审核请求的专用供应商与模型，必须成对配置。留空则沿用历史行为——审核跟随当前会话的路由（在 gpt-6.1-sol 会话中审核调用会消耗同一 OpenAI 5 小时窗口）。推荐配成便宜的通道，如 `zai-coding-cn` / `glm-5.3-flash`。
- `reviewerReasoningEffort`：审核请求的固定推理档位（如 `low`）。留空则按目标模型自动解析（沿用会话路由时保留会话显式档位；gpt-6.1-sol 的隐式 off/none 仍会被纠正为 `low`）。配置的档位会先对照模型能力校验，不被支持时审核以明确报错失败关闭，不会发送请求。

注意：当前桌面 profile 同时装有 dev bundle（guard + 热引擎）时，生效的是**热引擎行**（`risk-first-hot-engine`）上的配置；生产行的配置仅在卸载 dev bundle 后生效。

## Codex 审核兼容修复

审核请求不再强制传入 `temperature`。思考档位优先沿用当前会话；未设置时读取模型能力信息。对于已确认不接受 `none` 的 Codex `gpt-6.1-sol`，只将隐式的 off/none 默认值改为该模型声明支持的 `low`；不会修改会话设置或静默替换显式选择。

0.1.2 已通过真实 Codex 审核请求验证：会话 `high` 与隐式回退 `low` 均得到 `low + allow` 的有效审核结果。**从已加载的旧插件版本升级后，请重启一次 DSH 再启用 Auto**；插件管理器对现有包升级会报告 `restart-required`，不要只凭开关重新启用就认定所有模块缓存已更新。

## 开发期免重启热更新

桌面 profile 另装有 dev bundle `dsh-risk-first-approval-dev`（[dev/](dev/)），将 Auto 职责拆成两部分：

- **稳定外壳** [hot/guard/index.js](hot/guard/index.js)：持有 Auto owner、pre-execute 拦截、工具注册和 lease 校验。不在监听目录内，修改它仍需重启 DSH。
- **热替换引擎** [src/hot-engine.js](src/hot-engine.js)：审核策略与 reviewer。`hmr` 条目只监听本插件 `src/`；保存源文件约 100 ms 防抖后自动替换，**无需重启**。

重载窗口内外壳拒绝 Auto 调用并要求重试（fail-closed，不会退回 Full access）；旧引擎代次获得的人工批准不授权新代次。引擎实例、代次和构建号实时写在 `_scratch/hmr-state.json` 供诊断。接线与实测记录见 [VERIFICATION.md](VERIFICATION.md) 的 2026-10-16 节。

## 流程

1. 审批模型判定需要阻止自动执行时，不执行原调用、也不弹窗。将具体风险原因和待处理凭据返回执行模型。
2. 执行模型先缩小目标、只读检查、拆分操作或选择可逆方案；修改后的调用重新审核。
3. 确实无法进一步降低风险时，模型显式调用 `request_risk_approval`，必须填写：
   - `risk_ticket`：当前 Agent 对该精确调用的待处理凭据；
   - `necessity`：操作必要性及范围；
   - `risk_reduction_impossible_reason`：无法进一步降低风险的具体理由；
   - `alternatives_considered`：已考虑或尝试的替代方案。
4. 该工具仅记录申请意图，**不是执行许可**，也不执行原调用。模型随后用相同工具、相同参数重试。
5. 再次审核后，如仍判定中或高风险需审批，进入 **DSH 原有人工审批链**。用户批准仅放行该次原调用；拒绝、取消、无人应答均不执行。

中、高风险均可申请单次人工审批。`high + allow` 仍不是审批模型的合法输出——高风险不能自动放行，但用户可以通过明确的单次审批放行。独立沙箱、工具 guard、其他 pre-execute 权限检查不会被跳过。

`approval=never` 时不会提供可用审批凭据，也不会弹窗或改变用户权限设置。切换 Auto 是用户操作，不由插件自动代选。

## 弹窗内容

弹窗保留原工具/命令详情，另显示：

- 风险等级；
- **审批模型判定需人工审批的理由**（最新一轮审核给出的原文）；
- **执行模型认为无法进一步降低风险的理由**（显式申请时填写的原文）；
- 操作必要性与范围；
- 已考虑的降风险替代方案。

英文和中文均提供相同信息。独立客户端样式仅为原有审批理由保留换行和自动折行，不替换 DSH 对话框、不依赖哈希 CSS 类名。

## 安全与生命周期

- 不因重试次数自动弹窗；没有“失败几次就自动升级”的逻辑。
- 待处理凭据十分钟失效，显式申请意图两分钟失效，且只能用于一次匹配重试。
- 绑定当前 Agent 实例、工具名、精确参数、工具实现和 schema、工作目录及用户/父级/项目指令版本；不能跨会话、重启或恢复后复用。
- 在审批前重新审核、重新检查策略和操作身份；取消和上下文变化均不执行。
- 审批模型技术故障、协议错误、缺失具体拒绝理由与“发现风险”分开处理。技术故障不允许走人工审批来跳过审核。
- 保留官方 reviewer 的历史来源过滤，不把执行模型的自述当成人类授权。
- 移除插件沿用官方 Auto 集成的 teardown 合约。**启用、热替换、停用前应先将所有存活 Auto 会话切离 Auto**，否则官方旧插件卸载会将其迁移到 Full access。安装前用 [预检查脚本](scripts/preflight.mjs) 核实，避免意外降级。

## 安装、启用与撤回

保留官方 Auto review bundle 启用。本 bundle 在 profile 叠加层禁用官方 `auto-review` 条目，并插入独立 `risk-first-auto-review` 条目；移除此 bundle 后官方条目重新启用，不改安装包。

推荐通过 DSH 插件管理器安装打包产物。CLI 等效操作：

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-risk-first-approval-0.1.2.tgz
```

安装后刷新现有 GUI。在会话权限选择器中由用户选择 **Auto review** 后，本流程生效。原来的 Full access、workspace-write 等模式不受本插件的审核流程影响。

当前源码在 [项目目录](.)，流程实现在 [policy.js](src/policy.js)，客户端排版在 [client.js](src/client.js)，引用来源见 [NOTICE.md](NOTICE.md)。

## 不影响 DSH 更新的方式与边界

- 不修改、重打包或重签名应用，不改更新器、应用内依赖或客户端 shell。
- 通过 DSH 官方 profile bundle/patch 机制安装，依赖保存在用户 profile，重启不丢失。
- 不固定 DSH 应用版本，也不覆盖自动更新渠道。
- 声明精确兼容的 DSH peer 版本，不授予版本豁免。未来 DSH 更新若改变接口，插件可能需要适配后才能重新启用；不声称永久兼容任意未来版本。
- 审核核心是注明 MIT 来源的经过检查的版本快照，不是对官方安装目录打补丁。上游更新后需复核会话事件契约和审核策略，并运行测试后发布新插件版本。

## 开发验证

```sh
pnpm install --ignore-scripts
pnpm run check
pnpm pack --pack-destination dist
```

测试含纯策略、严格 reviewer 协议、native/PTC 精确调用快照、客户端换行及真实 Cordis + DSH Tools + ApprovalService 执行链；所有高风险测试使用无主机副作用的合成工具。

[一次性参考抽取脚本](scripts/extract-reference.py) 仅读取应用归档；[初始核心抽取脚本](scripts/prepare-upstream.py) 是一次性 bootstrap，现有核心包含之后人工审查的协议改动，不应使用脚本覆盖维护中的源码。
