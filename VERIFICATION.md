# 验证记录

最新机检：2026-10-28；候选源码版本：0.1.13；在线热引擎仍为 0.1.12。下方保留此前版本的历史记录，旧章节中的“当前”仅指当次验收。

## 2026-10-28 原生问题答复授权证据（隔离分支，未部署）

实现提交：`4081ae3`，分支 `fix/trusted-question-answers`。隔离 worktree 不在在线 HMR 监听路径内；没有改动 profile、Auto owner、审批模式或生产系统。

### 机检证据

- `npm run check`：**177 tests / 177 pass / 0 fail / 0 cancelled**，退出码 0，约 6.6 秒。
- [test/question-answers.test.js](test/question-answers.test.js)：原始可见 native 调用与答复唯一配对、问题前 header/schema、已选说明、custom、拒绝/跳过、后续撤销顺序及项目约束；拒绝普通工具冒充、错误/待定结果、ID/选项不匹配、重复答案/选项/JSON 键、非原始/不可见/继承结果、重复结果与单选越界。
- 同文件真实 **Cordis + Tools + ApprovalService + classifyRisk** 执行链：deterministic reviewer 从冻结请求中读出配对答复后，合成 body=1、prompt=0；pending 对照 body=0、prompt=0。该测试验证数据及执行链，不冒充真实模型的语义判断。
- [test/policy.test.js](test/policy.test.js)：新增 native 问题结果和 continued reply 使旧 ticket/armed intent 失效的四个用例，以及普通输出不改变 intent 的对照；完整回归保留 high 单次人工审批、never、独立 guard、取消、上下文变化及跨引擎 lease 等边界。
- `npm pack --ignore-scripts --dry-run --json --cache ./_scratch/npm-cache`：退出码 0，13 个分发文件，含 `src/question-answers.js`；未执行 install/build scripts。第一次默认 npm cache dry-run 因本机 `~/.npm` 权限返回 EPERM；改用 worktree 自有 cache 后通过，未修改系统目录权限。

### 支持与验证边界

- 只接纳 **native 前台成功答复**。超时 continued reply、PTC 问题答复、继承、压缩/改写后的结果目前不作为授权，仍失败关闭；continued reply 仅保守使旧 intent 失效。
- 只提升经过配对的实际答案，不把普通工具输出、问题措辞或代理记账提升为人类授权。仍由 reviewer 判断每次目标/效果/范围；本版不实现授权 TTL 缓存、自动重试生产写或跨会话授权复用。
- 信任 Session、Host 插件和工具注册；历史事件无工具包签名，不宣称可抵御恶意 Host 替换同名工具。
- 未向真实 provider 发送原会话内容，未对生产环境执行测试，无 UI 改动，也未热替换当前桌面。独立安全复核结论另补。

## 2026-10-19 审查请求内部重试（通过，附验收边界）

实现提交：`2b254a2`。源码新增 [src/reviewer-retry.js](src/reviewer-retry.js)，只包裹 reviewer 的直接 LLM 请求，不包裹 gate、next、审批或原工具体；保留原 policy 和 stable guard 的最终授权检查。

### 机检与独立复核

- `npm run check`：**139 tests / 139 pass / 0 fail / 0 cancelled**，退出码 0，约 6 秒。输出保存在 `_scratch/reviewer-retry-check-20261019.log`。
- [test/reviewer-retry.test.js](test/reviewer-retry.test.js)：五类瞬时故障恢复、准确四次请求上限、±20% 抖动、Retry-After 合法/无效/超限值、真实 deny/协议错误不重试、aborted finish、取消/清理 timer 和 listener、并发独立预算、同一冻结请求、失败 partial 及完整 allow JSON 丢弃、cleanup 异常优先级。
- [test/hot-guard.test.js](test/hot-guard.test.js) 的新增真实 Cordis + ToolRuntime + HotEngine 链：两次 TIMEOUT 后第三次成功，原 body=1、ask=0；持续失败 requests=4、body=0、ask=0，无风险凭据；退避期间取消及 engine fiber dispose 立即停止旧请求；新引擎不复活旧调用；重试期间指令变化后返回 `AUTO_REVIEW_CONTEXT_CHANGED`、body=0。
- [test/llm-runtime-retry.test.js](test/llm-runtime-retry.test.js)：隔离进程中启动只绑定 loopback 临时端口的 HTTP 夹具，使用真实 `LlmRuntime` 及测试 adapter。HTTP 503 两次后成功（3 请求）；HTTP 429 耗尽（4 请求，保留 status 与 providerRetryAfterMs）；HTTP 401 仅一次。测试收尾关闭连接/服务并处置 Cordis 实例，不向外部 provider 发送数据。
- 独立只读子代理亲自运行 reviewer-retry + hot-guard：**58/58 pass**；另以内存实验验证异步 cleanup 完成后才重试、cleanup 失败不能被 TIMEOUT 掩盖、cleanup 期间取消无额外请求、5 种非允许名单码不重试。未发现需返工问题。
- 本机依赖为 DSH `0.2.0-rc.2`；同时 Inspect 当前桌面 `0.2.1-rc.2` 的 `llm.stream`、`llm/stream` 和 `LlmFailure` 契约，确认 terminal error/aborted、结构化 code 与 providerRetryAfterMs 字段一致。隔离运行时验证不冒充所有新版内部接口的测试。
- `npm pack --ignore-scripts --json --pack-destination dist` 退出码 0；[dist/dsh-risk-first-approval-0.1.12.tgz](dist/dsh-risk-first-approval-0.1.12.tgz) 共 12 个文件，实查清单含 `src/reviewer-retry.js`、`src/upstream-review.js` 和新版本 manifest，SHA-1 为 `aefd8c6d87097db85cdf1a292b70eb535aeec3a4`。未重新安装 fallback，也未执行 lifecycle scripts。

### 当前桌面生效证据

- 原有 HMR 实测报告 `_scratch/hmr-state.json`：PID **69655** 未变；`guardId=3d2604fc-d14d-4d2a-8a9b-1fa6c7f50a46` 未变；新 `engineGeneration=6e9fb3d1-7347-466d-8553-97663848d0bf`，`engineBuild=risk-first-0.1.12-hot-retry`，`engineReady=true`、`guardReady=true`，ready 时间 `2026-10-19T01:40:29.900Z`。
- 仍是原有 stable guard + 热引擎接线，没有移除/重装 Auto owner、改权限模式或刷新客户端；引擎重载窗口仍按既有设计失败关闭。本轮发生过一次 `AUTO_REVIEW_RELOADING`，等待就绪后正常继续，未绕过守卫。
- 生产包 fallback 仍为已安装且被 dev 行覆盖的 `0.1.11`；本次源码/打包产物为 `0.1.12`，桌面生效来自原有 source watcher，不宣称 fallback 已升级。

### 未执行项与清场

- 未向在线会话注入真实断网，也未对外部商用 provider 发起故障注入请求。原拟临时安装 Host 诊断 bundle 的操作被 Auto 审查以 profile-wide 范围拒绝；**工具 body 未执行**，随后改用上述隔离 loopback 端到端验证，没有换工具绕过安装或请求人工跳过审查。
- Inspect 查询 `dsh-reviewer-retry-runtime-20261019`：entries=[]、total=0，确认该诊断插件未挂载。候选夹具源码留在项目 `_scratch/retry-runtime-20261019/`，未安装、无新增工具或权限修改。它是一次性测试夹具，省略了图标/本地化资源，不作为正式插件交付。
- 没有 UI 改动，不声称浏览器端故障注入或新 UI 验收；当前验收依据为代码、真实隔离执行链、独立复核与已加载热引擎状态。

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

## 2026-10-16 真实 GUI 审批弹窗验收（通过）

用户在当前会话选择 Auto review 后，以 `sudo -n true`（无密码即失败关闭、零副作用的高风险样本）完成全链路验收：

1. 首次调用：审批模型判风险并给出具体理由，**未弹窗、未执行**，返回 `AUTO_REVIEW_REWORK_REQUIRED` 与待处理凭据；
2. `request_risk_approval` 登记意图：返回 `ready_for_approval`，**未执行、未批准**；
3. 精确重试：重新审核仍判风险，弹出**唯一一次**人工审批对话框。用户确认弹窗同时完整展示：审批模型的需审批理由、执行模型的无法降风险理由、必要性与范围、替代方案。用户批准后命令执行一次（按预期以 `sudo: a password is required` 失败关闭）；
4. 再次相同重试（无新意图）：**未弹窗**——凭据单次消费生效；该次执行来自审批模型独立改判低风险放行（LLM 审核非确定性），不是凭据复用。

至此风险优先流程的浏览器端全链路（拒绝回退 → 显式升级 → 单次弹窗 → 单次执行）验收通过。审核模型为当前会话模型（kimi-coding/k3-256k），与此前 Codex 验证互补。

## 0.1.2 真实模型兼容验证

- 70 项自动测试全部通过，新增会话档位继承、Codex 隐式 off/none 回退、显式选择不被修改、其他 provider 保持原语义等回归测试。
- 用户切回 Full access 后，通过独立、临时、可移除的诊断插件调用真实 `openai-codex / gpt-6.1-sol`，使用与 0.1.2 **字节一致**的审核核心：
  - 继承当前会话 `high`：2755 ms，返回 `low + allow`；
  - 无显式档位，按模型声明回退到 `low`：2793 ms，返回 `low + allow`。
- 诊断输入只有“返回 hello 常量”的内存样例，没有复制当前会话正文、私有参数或文件内容，也没有执行被评审动作。只在项目 `_scratch` 保存结果报告。
- 临时诊断插件已通过官方管理器移除。最终 profile 只保留 `dsh-risk-first-approval@0.1.2`，用户当前 Full access / never 未改变。
- 样例和诊断构建源码位于 [smoke](smoke/)。第一次尝试跨插件导入新子路径时导入失败且未发出模型请求，失败插件已清理；最终诊断使用独立包内的同字节审核核心，避免跨插件导入/模块缓存干扰。
- 安装器对已有包版本升级返回过 `restart-required`。虽然重新启用 bundle 返回 applied，**仍需重启 DSH 一次，才能保守保证生产审核门使用新的模块图**。上述两次真实请求证明新代码与服务兼容，但不冒充重启后的生产 Auto 链验收。
- ~~真实 GUI 单次审批弹窗仍未验收~~ → 已于 2026-10-16 验收通过，见上方对应章节。

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
