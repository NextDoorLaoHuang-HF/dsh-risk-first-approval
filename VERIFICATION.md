# 验证记录

验证日期：2026-10-15；插件版本：0.1.1；DSH 版本：0.2.0-rc.2。

## 已完成

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
