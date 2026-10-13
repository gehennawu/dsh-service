# 🛠️ dsh-service

[English](./README.en.md)

DeepSeek Harness（DSH）Web 运维插件：重启与升级、健康诊断、模型用量与额度查询、模型配置、备份、技能和会话管理。

[![Version](https://img.shields.io/badge/version-2.0.8-3b82f6.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981.svg)](LICENSE)
[![DSH Compatibility](https://img.shields.io/badge/DSH-%E2%89%A50.1.1--rc.2%20%C2%B7%200.2.1--alpha.2-6366f1.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

![概览](./screenshots/overview.png)

[安装](#安装) · [功能](#功能) · [自动重启](#自动重启) · [注意事项](#注意事项) · [常见问题](#常见问题)

## 安装

要求 Node.js ≥22，DSH `>=0.1.1-rc.2 <0.2.1-alpha.3`。主要验证环境为 **Linux + Docker**，其他平台不承诺兼容。

### 插件管理页（推荐）

1. 打开 DSH「插件」→「添加插件」。
2. 输入 `@gehennawu/dsh-service@2.0.8`，选择安装源并安装。
3. 重启 DSH 并刷新页面，在设置中打开「服务控制」。桌面端请退出应用后重新打开。

也可填入 GitHub 地址 `https://github.com/gehennawu/dsh-service` 或本地插件目录。

### 命令行

```sh
dsh plugin --profile web add @gehennawu/dsh-service@2.0.8
```

GitHub 或本地开发安装：

```sh
dsh plugin --profile web add github:gehennawu/dsh-service
dsh plugin --profile web add link:/path/to/dsh-service
```

安装后重启已有 DSH 进程并刷新页面；不要额外启动一个 Web 实例。

> 建议指定精确版本：pnpm 的发布观察期可能让不带版本号或 `@latest` 的安装退回较旧版本。

## 功能

设置 → 服务控制包含：**概览、模型统计、额度查询、模型配置、健康诊断、维护、配置**。功能开关即时生效；重启、额度查询和会话管理可开启设置栏快捷入口。

### 版本与更新

查看 DSH 与插件版本、更新说明，检查正式版和预览版，一键升级。升级完成后需重启；手动启动环境会保留进程并提示，桌面端请使用应用自带的插件管理页更新。

### 模型统计

![模型统计](./screenshots/model-usage.png)

- 按项目、模型和日期查看输入、输出、缓存 token、缓存命中率及报错统计。
- 提供近 7 天趋势、日历热力图与小时分布；进入页面时自动同步，也可手动刷新。
- 已索引的历史用量不会因删除会话或项目而减少。提供方未上报的用量无法统计；读取失败的会话会提示并在下次同步重试。

### 额度查询

![额度查询](./screenshots/quota-lookup.png)

查看余额、套餐窗口和重置时间；输入框额度入口跟随当前模型渠道。卡片可排序、隐藏或手动选择适配类型。

支持 DeepSeek、智谱 GLM Coding Plan、OpenCode Go、OpenRouter、Kimi、硅基流动、StepFun 余额 / Step Plan、小米 MiMo Token Plan、Command Code、CLIProxyAPI。

在卡片「配置」中填写或修改凭据：普通渠道用 API key，CLIProxyAPI 用**管理密钥**，小米用控制台 Cookie，Step Plan 用 `Oasis-Token`。Command Code 复用推理 key。凭据不回显。

查询在打开额度页、展开输入框额度入口或手动刷新时触发。凭据错误、套餐失效等情况停止自动重试，修改配置后手动重试。

### 模型配置

> **截图待补充：渠道与模型配置。**
<!-- Screenshot placeholder: model-configuration.png / model-configuration_en.png. Add both assets before linking. -->

- 添加和编辑渠道、模型与密钥，启停渠道或模型；模型 ID 可手填，也可显式在线获取。
- 编辑名称、上下文窗口、最大输出、图片输入和思考等级；容量支持 `256K`、`1M` 等写法，未展示的高级配置保持不变。
- 智能填充只提供参数建议，确认后填入草稿，仍需手动保存；资料不等于接口能力验证。
- 基础调用测试**可能计费**，仅验证文本调用，不验证全部能力。
- 删除前核对主对话和子代理引用；删除渠道保留凭据，可恢复配置但不恢复旧密钥值。

旧宿主缺少配置 revision 能力时仅可查看。在线获取仅支持符合安全策略的公网 HTTPS 地址；本地或 HTTP 渠道仍可保存并手填模型。

### 子代理模型

![子代理模型](./screenshots/subagent-model.png)

在「模型配置 → 子代理路由」选择初始、跟随主模型或自定义模式，可设置思考等级和有序回退模型。派生请求显式指定的 provider/model 优先；切换模式不会清除已保存的自定义配置。输入框下方可显示本会话子代理实际使用的模型。

### 健康诊断

![健康诊断](./screenshots/health-diagnostics.png)

检查运行环境、会话存储、备份、使用统计索引、通知权限与文件权限。插件健康检查列出失败或依赖未就绪的插件，失败插件可确认后重新加载；手动停用不算异常，已释放或未知状态仅作信息提示。文件权限修复需二次确认。

### 会话管理

![会话管理](./screenshots/session-manager.png)

- 按项目或时间查看会话，搜索正文并跳转到命中位置；可筛选子代理。
- 单项或批量导出完整 ZIP、归档与恢复归档（恢复归档要求 DSH ≥0.1.6）。
- **仅已归档会话可删除**，运行中会话不可删除；执行前展示确认清单。删除记录不含正文，不能用来恢复会话。

入口：维护 → 会话管理。

### 技能管理

![技能管理](./screenshots/skill-manager.png)

管理自动加载、仅手动调用与停用状态，修复旧版 frontmatter 键。内置技能只读。AI 补全可生成单项或批量说明草稿，确认后保存到插件索引，不改写技能文件正文。

### 备份管理

![备份管理](./screenshots/backup-management.png)

创建、下载、导入、删除及恢复会话、配置与插件 profile 清单的归档；不会自动清理旧备份。

- 文件名带备份时的 DSH 版本（`dsh-backup-YYYYMMDD-HHmmss-dsh…tar.gz`），版本信息也记录在 `meta/backup.json`。
- **完整性检查**通过后才可进入**恢复预检**，先展示会话整体替换、配置覆盖和目标 profile 清单，再确认执行；提交时复核归档 SHA-256 与目标指纹，变化则中止。
- 可选择恢复到本机哪个 profile；跨名恢复默认不覆盖本机插件清单。凭据、附件和 node_modules 不在替换范围内。
- 新版会话格式不能向旧版 DSH 降级恢复。恢复成功后，托管环境自动重启，手动启动或桌面端按提示重启。

### 安全重启

![安全重启](./screenshots/restart.png)

维护 → 重启会列出活跃 Agent、后台任务和终端，确认后执行。对话命令 `/restart` 在有运行中工作时拒绝执行。Web 重启后自动探测进程并刷新页面；桌面端请退出应用后重新打开。

**插件不负责重新拉起进程**，使用前请配置[自动重启](#自动重启)。

### 任务通知与配置

![配置](./screenshots/configuration.png)

- 主会话完成任务、或主会话 / 子代理需要授权、审阅计划、回答问题时发送通知；子代理完成不通知。
- 需开启通知总开关并授予系统权限；输入框铃铛可快速开关。
- 「配置」页集中管理功能开关、通知和设置栏标签排序 / 显隐，偏好支持多设备同步。

### 其他功能

- **移动端适配**：默认关闭，开启后支持窄屏导航、抽屉手势和滑动沉浸阅读。
- **厂家图标**：模型按钮、模型列表和额度卡片显示渠道图标，支持 Cline 等自定义别名；未识别的渠道可按额度页手动适配类型匹配。图标离线可用，完整列表见[图标目录](docs/model-icons.html)。
- **右栏文件编辑**：文件预览中点「编辑」，支持 `Ctrl/Cmd + S`、重新加载与撤销保存；遵循会话沙箱和版本冲突保护，单文件上限 2 MiB。
- **外部探活**：`GET` / `HEAD /healthz` 返回空 200，可接 Uptime Kuma 或容器健康检查。

## 自动重启

Web 重启通过退出进程实现，需外部进程管理器拉起。直接在终端运行 `dsh web` 不会自动恢复。

Docker Compose：

```yaml
services:
  dsh:
    restart: unless-stopped
```

systemd（加入现有服务配置）：

```ini
[Service]
Restart=on-failure
RestartSec=2
```

或使用 pm2：

```sh
pm2 start "dsh web --host 127.0.0.1" --name dsh-web
```

检测不准确时可用 `DSH_SERVICE_RUNTIME_ENV=managed|manual|desktop` 显式声明运行环境；该变量不会替你安装或配置进程管理器。

## 注意事项

- 操作能力仅通过 loopback RPC 提供；`/healthz` 不返回运行信息。
- 密钥保存到 DSH 凭据库，不回显到浏览器；不要公开配置、凭据或未经检查的截图。
- 删除、恢复、换密钥和权限修复等操作先展示后果；配置与文件保存拒绝覆盖并发改动。
- 图标来源：[LobeHub Icons](https://github.com/lobehub/lobe-icons)（MIT）与 [Simple Icons](https://github.com/simple-icons/simple-icons)（CC0）。品牌图形归各厂商所有。

## 常见问题

**安装后还是旧版本？** 指定精确版本 `@gehennawu/dsh-service@2.0.8`，或在服务控制中一键升级；随后重启 DSH 并刷新页面。

**重启后没有恢复？** 检查进程管理器和 restart policy；插件只退出进程，不会自行启动新进程。

**通知不响？** 检查通知总开关与浏览器 / 系统权限。桌面端点击通知可能无法唤回隐藏窗口，请用托盘打开。

**额度凭据被拒绝？** 在卡片「配置」中更新 key 或登录态。CLIProxyAPI 连续认证失败可能封禁出口 IP，等封禁结束或更换出口后重试；管理面封禁不影响模型推理。

## 反馈与许可

问题和建议请提交 [Issue](https://github.com/gehennawu/dsh-service/issues)，欢迎 Pull Request。

[MIT](./LICENSE)
