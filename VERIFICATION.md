# 验证记录

验证日期：2026-10-15 至 2026-10-16；最新插件版本：0.1.2；DSH 版本：0.2.0-rc.2。

## 2026-10-16 免重启热更新接线与实测

目标：改插件源码不重启 DSH。方案是稳定外壳 + 可热替换引擎的拆分：

- [hot/guard/index.js](hot/guard/index.js)（稳定外壳，不在监听目录内）持有 Auto owner 身份、pre-execute 拦截、工具注册、提示词段落和 lease 校验；通过 `ctx.get('riskFirstHotEngine')` 按需查找引擎，不做静态 inject，避免引擎重载时外壳被连带处置。
- [src/hot-engine.js](src/hot-engine.js)（被监听目录内）持有审核策略与 reviewer；重载时先 quiesce（停止接受新操作、等待在途操作 settle），再由 HMR 替换模块。
- 外壳在引擎不可用或引擎实例在审批间隙被替换时**拒绝执行**（fail-closed），不会退回 Full access；旧引擎代次上获得的人工批准不会授权新代次执行（lease 绑定引擎实例，`ctx.tools.guard` 在 dispatch 前复核）。
- dev bundle [dev/cordis.patch.yml](dev/cordis.patch.yml)：禁用打包条目 `risk-first-auto-review`（保留为回滚 fallback），配置 `hmr` 只监听本插件 `src/`，插入外壳与引擎两个条目。安装在桌面 profile，见 profile `package.json` 的 `dsh-risk-first-approval-dev`。

实测（pid 96108，全程未重启；诊断流见 `_scratch/hmr-state.json`）：

1. 修改 `src/hot-engine.js` 的 BUILD 常量（hot-a → hot-b），100 ms 防抖后观察到 `engine-stopping` → `engine-ready`，pid 不变——**模块替换在不重启进程的情况下生效**。
2. 同时发现诊断竞态：`ctx.get` 默认 strict，会隐藏 fiber 尚未进入 active 状态的服务提供者，导致 `engine-ready` 快照误报 `engineReady: false`。这也解释了昨晚重启后状态文件只有 `guard-ready` 一条——引擎实际已运行，只是就绪通知在外壳可见性建立前被丢弃。引擎改为等自身 fiber settle 后再上报就绪，并短暂重试等待外壳可见。
3. 二次修改（hot-b → hot-c，含上述修复）后观察到 `engine-ready | engineReady: true | build: risk-first-0.1.2-hot-c | 新 generation`，pid 不变——**热更新链路与诊断均验证通过**。
4. 改动后 78 项测试全部通过（含 hot-guard 的重载空档拒绝、跨代次批准不授权等用例）。

注意：

- 外壳（`hot/guard/`）刻意不在监听目录内；修改外壳代码仍需重启 DSH 才生效。
- 重载窗口内 Auto 调用会被拒绝并要求重试，这是预期 fail-closed 行为，不是故障。
- 当前会话为 Full access / never，热更新期间无存活 Auto 会话；真实 GUI 审批弹窗仍未验收。

## 0.1.2 真实模型兼容验证

- 70 项自动测试全部通过，新增会话档位继承、Codex 隐式 off/none 回退、显式选择不被修改、其他 provider 保持原语义等回归测试。
- 用户切回 Full access 后，通过独立、临时、可移除的诊断插件调用真实 `openai-codex / gpt-6.1-sol`，使用与 0.1.2 **字节一致**的审核核心：
  - 继承当前会话 `high`：2755 ms，返回 `low + allow`；
  - 无显式档位，按模型声明回退到 `low`：2793 ms，返回 `low + allow`。
- 诊断输入只有“返回 hello 常量”的内存样例，没有复制当前会话正文、私有参数或文件内容，也没有执行被评审动作。只在项目 `_scratch` 保存结果报告。
- 临时诊断插件已通过官方管理器移除。最终 profile 只保留 `dsh-risk-first-approval@0.1.2`，用户当前 Full access / never 未改变。
- 样例和诊断构建源码位于 [smoke](smoke/)。第一次尝试跨插件导入新子路径时导入失败且未发出模型请求，失败插件已清理；最终诊断使用独立包内的同字节审核核心，避免跨插件导入/模块缓存干扰。
- 安装器对已有包版本升级返回过 `restart-required`。虽然重新启用 bundle 返回 applied，**仍需重启 DSH 一次，才能保守保证生产审核门使用新的模块图**。上述两次真实请求证明新代码与服务兼容，但不冒充重启后的生产 Auto 链验收。
- 真实 GUI 单次审批弹窗仍未验收，不能声称已通过浏览器端审批测试。

## 0.1.1 已完成的基础验证

- `pnpm run check`：60 项测试全部通过。
- 使用真实 Cordis、DSH ToolRuntime 和 ApprovalService 的合成测试确认：
  - 中、高风险首次拒绝不弹窗，原调用 body 不执行；
  - 显式申请意图本身不执行、不批准；
  - 精确重试重新审核，经人工 `allowed-once` 后仅执行一次；
  - 审批请求携带审核模型理由、执行模型无法降风险理由、必要性和替代方案；
  - 拒绝、取消、无人应答和 `never` 均不执行；
  - 独立工具 guard 即使在人工批准后仍能拒绝执行。
- 通过 DSH 官方插件管理器安装、启用；最终操作返回 `application: applied`，无加载警告。
- 运行时 Inspect 确认：官方 `include:auto-review` 为 inactive；独立 `include:risk-first-auto-review` 已加载；当前 Agent 可见新 `request_risk_approval` 的四个必填字段。
- 检查六个被 DSH 进程持有的存活会话，安装前均不在 Auto；安装前后权限 preset、approval policy 和 sandbox mode 未变。
- 对比安装前后的 SHA-256：应用归档与用户原有 profile patch 层未变。安装只通过官方管理器变更 profile 的包依赖、bundle 选择和派生配置。

## 验证边界

- 当前用户会话仍是 Full access / `never`。没有为测试切换用户权限，也没有在用户会话中人为触发真实审批弹窗。
- 对话框内容通过真实审批请求测试验证；客户端换行样式通过隔离 VM 测试验证。未进行浏览器截图验收。
- 客户端插件需刷新现有 GUI 页面加载；不依赖开发 watcher，不启动替代服务器。刷新后由用户选择 Auto review 才在该会话启用审核。
- 插件按精确 DSH peer 版本进行兼容检查。未来应用更新不受固定应用版本限制，但新 DSH 接口可能需要适配插件，不应以版本豁免强行加载。

## 安装修正说明

初次 0.1.0 包错误地将 patch 的 `name` 视为替换模块的字段；运行时检查发现原条目未被替换，未将“安装成功”误报成“功能生效”。最终 0.1.1 改为禁用官方条目并插入独立条目，重新启用后已验证新工具实际可见。0.1.0 不应使用。

安装前 profile 备份和应用校验和保存在项目 `_scratch/profile-before-install-20261015/`（不进入源码仓库）。
