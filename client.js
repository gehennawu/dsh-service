// Browser half of @gehennawu/dsh-service
// 设置面板「服务控制」：版本信息 + 检查更新 + 一键重启
window.__ModuleLoader__.load({
  id: '@gehennawu/dsh-service',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const NS = 'dsh-service'
    const zh = {
      'nav.label': '服务控制',
      'nav.restart': '重启',
      'overlay.label': '服务重启状态',
      'recovery.waiting.title': '服务重启中…',
      'recovery.waiting.body': '正在等待新的 DSH Web 进程启动，已等待 {seconds} 秒。',
      'recovery.timeout.title': '服务尚未恢复',
      'recovery.timeout.body': '已等待 60 秒。请确认外部进程管理器已正确配置，或手动刷新页面重试。',
      'recovery.manual': '手动刷新',
      'health.title': '运行状况',
      'health.uptime': '运行时间',
      'health.rss': '内存 RSS',
      'health.platform': '平台',
      'health.nodeVersion': 'Node 版本',
      'health.liveSessions': '存活会话',
      'health.persistedSessions': '持久化会话',
      'health.activeAgents': '活跃 Agent',
      'health.activeJobs': '后台任务',
      'health.uptimeValue': '{hours} 小时 {minutes} 分钟',
      'health.error': '无法读取运行状况',
      'health.check': '立即健康检查',
      'health.checking': '检查中…',
      'health.overall.ok': '正常',
      'health.overall.warning': '警告',
      'health.overall.error': '错误',
      'health.alert.title': '健康提醒',
      'health.alert.diagnostics': '检查结果存在{status}，请查看下方异常项。',
      'health.status.ok': '正常',
      'health.status.warning': '警告',
      'health.status.error': '错误',
      'health.status.info': '信息',
      'health.check.session-storage': '会话存储',
      'health.check.workspace-registry': '工作区注册表',
      'health.check.dsh-home': 'DSH_HOME',
      'health.check.backup-storage': '备份存储',
      'health.check.tar': 'tar',
      'health.check.permissions': '文件权限',
      'health.check.runtime-env': '运行环境',
      'health.check.node-version': 'Node 运行时',
      'health.detail.runtime-env.managed': '由{kind}管理，重启后会自动拉起',
      'health.detail.runtime-env.declared': '已通过 DSH_SERVICE_RUNTIME_ENV 声明由外部进程管理器管理',
      'health.detail.runtime-env.manual': '疑似终端手动启动，重启后不会自动拉起；一键升级已改为不自动退出',
      'health.detail.runtime-env.unknown': '未检测到进程管理器，无法确认重启后是否自动拉起；如实际有，可设置 DSH_SERVICE_RUNTIME_ENV=managed 声明',
      'health.detail.node-version.ok': '{version}，满足 ≥{required} 要求',
      'health.detail.node-version.warning': '{version} 低于插件要求的 {required}.x，建议升级 Node',
      'health.detail.session-storage.ok': '可用，共 {count} 个会话快照',
      'health.detail.workspace-registry.ok': '可用，共 {count} 个工作区',
      'health.detail.dsh-home.ok': '目录可访问，权限模式 {mode}',
      'health.detail.backup-storage.empty': '备份目录可用，当前暂无备份',
      'health.detail.backup-storage.ok': '备份目录可用，共 {count} 个备份，占用 {size}',
      'health.detail.tar.ok': 'tar 可执行文件可用',
      'health.detail.permissions.ok': '文件权限检查正常，未发现异常',
      'health.detail.permissions.warning': '发现 {count} 个文件或目录权限异常',
      'health.detail.generic': '{status}',
      'tabs.overview': '概览',
      'tabs.notify': '通知',
      'tabs.health': '健康诊断',
      'tabs.usage': '模型统计',
      'tabs.quota': '额度查询',
      'overview.container': '进程与运行环境',
      'overview.errors': '报错信息',
      'tabs.backup': '备份维护',
      'tabs.restart': '重启',
      'tabs.alert.title': '服务控制提醒',
      'tabs.alert.body': '以下功能需要处理：{tabs}',
      'permissions.title': '文件权限',
      'permissions.description': '检查 Agent 是否能读取、写入并进入 DSH_HOME 和工作区。深检跳过 .git 内部文件；修复只补充当前用户所需权限并保留执行位，DSH 凭据文件固定为 600。',
      'permissions.target': '目标属主：{owner}',
      'permissions.repair': '修复权限',
      'permissions.repairing': '修复中…',
      'permissions.confirm': '确认修复',
      'permissions.confirmHint': '将跳过 .git，递归恢复当前用户属主并补充 Agent 读写权限，保留已有执行位。请确认后继续。',
      'permissions.cancel': '取消',
      'permissions.error': '权限操作失败',
      'permissions.summary.ok': '{count} 个根目录检查正常',
      'permissions.summary.warning': '发现 {count} 个根目录异常',
      'permissions.showDetails': '查看详情',
      'permissions.hideDetails': '隐藏详情',
      'permissions.deep': '深度检查',
      'permissions.deepChecking': '扫描中…',
      'permissions.deepSummary': '扫描 {scanned} 项，用时 {duration} ms；目录不可编辑 {directories}，文件不可编辑 {files}，无法读取 {unreadable}。',
      'backup.title': '备份管理',
      'backup.description': '备份会话、配置和插件 profile 清单；不会包含 node_modules 或凭据。备份不会自动清理，请自行管理磁盘空间。',
      'backup.create': '创建备份',
      'backup.creating': '创建中…',
      'backup.total': '总体积：{size}',
      'backup.empty': '还没有备份。',
      'backup.delete': '删除',
      'backup.confirm': '确认删除',
      'backup.confirmHint': '确认删除这个备份？此操作无法撤销。',
      'backup.cancel': '取消',
      'backup.error': '备份操作失败',
      'backup.export': '导出',
      'backup.exporting': '导出中…',
      'backup.exportError': '备份导出失败',
      'backup.restore': '恢复',
      'backup.restoreConfirm': '确认恢复',
      'backup.restoreHint': '确认恢复此备份？当前会话和配置将被覆盖，恢复后服务将自动重启。',
      'backup.restoreError': '备份恢复失败',
      'backup.import': '导入备份',
      'backup.importing': '导入中…',
      'backup.showRecords': '展开备份记录',
      'backup.hideRecords': '收起备份记录',
      'version.title': '版本信息',
      'version.current': 'DSH：',
      'version.plugin': 'dsh-service：',
      'version.loading': '加载中…',
      'update.check': '检查更新',
      'update.checking': '检查中…',
      'update.current': '已是最新版本',
      'update.available': '有新版本：{version}',
      'update.detailsButton': '查看详情',
      'update.detailsHide': '收起',
      'update.unavailable': '暂时无法检查最新版本',
      'update.unpublished': '尚未发布可检查版本',
      'health.recheck': '重新诊断',
      'update.badge': 'DSH 有更新',
      'update.details.title': 'DSH 更新可用',
      'update.details.current': '当前版本：{version}',
      'update.details.latest': '最新版本：{version}',
      'update.channelStable': '正式版',
      'update.channelPreview': '预览版',
      'update.details.close': '关闭',
      'update.upgrade': '升级插件',
      'update.upgrading': '升级中…',
      'update.upgradeError': '插件升级失败',
      'update.upgradeErrorDetail': '插件升级失败（{detail}）',
      'update.upgradeSuccess': '升级成功，服务重启中…',
      'update.guardActiveWork': '有活动中的会话或后台任务，请处理完毕后再升级',
      'update.guardLinkInstall': '插件通过 link: 安装（开发模式），不能从 registry 一键升级；请更新源码仓库后重启',
      'update.guardFileInstall': '插件通过 file: 安装，不能从 registry 一键升级',
      'update.guardNoNewer': 'registry 最新版不高于当前版本，已拒绝可能回退的升级',
      'update.guardNoProfile': '没有找到安装了本插件的 profile，无法定位升级目标',
      'update.guardAmbiguous': '多个 profile 都安装了本插件且无法确定当前加载的副本，已中止',
      'update.guardStale': '命令报告成功但安装版本没有变化（可能被 pnpm 安全等待期拦下），保持当前版本不重启',
      'update.guardUnreadable': '命令成功但无法确认安装后的版本，已中止重启',
      'update.failPnpmMissing': '找不到 pnpm，无法执行升级；请先安装 pnpm 再重试',
      'update.failNetwork': '拉取依赖时网络临时失败，请稍后重试',
      'update.failFetchTimeout': '下载超时（网络较慢或安装包较大），请稍后重试',
      'update.failReleaseAge': '新版本被 pnpm 安全等待期拦截，已自动放行重试仍失败',
      'update.failHoist': 'profile 的 node_modules 由不同版本的 pnpm 创建，已重建重试仍失败',
      'update.failAddingToRoot': 'pnpm 拒绝在 workspace 根目录安装（缺少 -w）',
      'update.failNotWorkspace': 'profile 不是 pnpm workspace 却传入了 -w',
      'update.failIgnoredBuilds': '依赖构建脚本被 pnpm 默认拦截，无法完成升级',
      'env.kind.docker': 'Docker 容器',
      'env.kind.container': '容器（containerd/Kubernetes）',
      'env.kind.systemd': 'systemd 服务',
      'env.kind.pm2': 'pm2',
      'env.kind.supervisord': 'supervisord',
      'env.kind.kubernetes': 'Kubernetes',
      'env.kind.declared': '外部进程管理器（手动指定）',
      'update.manualConfirmTitle': '升级前请确认：当前疑似手动启动环境',
      'update.manualConfirm': '未检测到 Docker/systemd/pm2 等进程管理器。升级完成后 DSH 不会自动重启——新版本写入磁盘，但当前进程继续运行旧版本；你需要手动关闭并重新运行 dsh 才能启用新版本。',
      'update.manualProceed': '仍要升级',
      'update.manualRestartTitle': '升级完成，需要手动重启',
      'update.manualRestartBody': '新版本已安装，但当前进程仍在运行旧版本。请在运行 dsh 的终端窗口按 Ctrl+C（或直接关闭窗口），然后重新启动 dsh。',
      'restart.title': '服务重启',
      'restart.description': '重启 dsh web 进程。运行中的工作会中断，持久化会话可恢复。也可在对话中输入 /restart。',
      'restart.button': '重启 dsh web',
      'restart.sending': '发送中…',
      'restart.confirm': '确认重启',
      'restart.force': '仍要重启',
      'restart.cancel': '取消',
      'restart.sent': '重启指令已发出。',
      'restart.sentHint': '页面连接即将断开，服务恢复后将自动刷新。',
      'restart.idleHint': '当前没有检测到运行中的工作。确认后将断开连接，等待服务自动重启。',
      'restart.manualWarn': '当前疑似终端手动启动环境：确认后进程将退出且不会自动拉起，需要你手动重新运行 dsh。',
      'restart.sentManualHint': '当前为手动启动环境，服务不会自动拉起。请在原终端重新运行 dsh；服务起来后刷新此页面即可恢复。',
      'restart.navToggle': '设置页左列显示「重启」入口',
      'restart.navToggleHint': '默认关闭；开启后在设置页左侧标签列底部显示快捷重启入口',
      'activity.agent': 'Agent',
      'activity.job': '后台任务',
      'activity.terminal': '终端',
      'activity.warning': '检测到 {count} 项运行中的工作，重启会立即中断它们。',
      'activity.item': '{type}：{label} ({status})',
      'error.update': '检查失败',
      'error.activity': '检查运行状态失败',
      'error.restart': '重启失败',
      'error.instance': '重启响应缺少进程实例标识',
      'usage.title': '模型使用',
      'usage.structure': 'token 结构',
      'usage.structureHint': '按日期展示输入、输出和缓存 token。',
      'usage.tooltip.date': '日期：{date}',
      'usage.tooltip.input': '输入 {value} token',
      'usage.tooltip.output': '输出 {value} token',
      'usage.tooltip.cache': '缓存命中 {value} token',
      'usage.axis': 'token 纵轴',
      'usage.models.more': '展开其余 {count} 个模型',
      'usage.models.less': '收起模型列表',
      'usage.modelSortHint': '按 token 总量从多到少排列',
      'usage.modelBar': '{model}：共 {total} token',
      'usage.refresh': '刷新统计',
      'usage.refreshing': '刷新中…',
      'usage.empty': '尚未建立使用统计索引。点击刷新统计开始只读建立索引。',
      'usage.error': '无法读取模型使用统计',
      'usage.allProjects': '全部项目',
      'usage.total': 'token 总量',
      'usage.steps': '成功模型步骤',
      'usage.stepsValue': '{count} 次',
      'usage.modelLine': '{steps}次 · 缓存命中 {hitRate} · 输入 {input} token · 输出 {output} token',
      'usage.input': '输入 token',
      'usage.output': '输出 token',
      'usage.cache': '缓存 token',
      'usage.hitRate': '缓存命中率',
      'usage.today': '今天',
      'usage.sevenDays': '近 7 天',
      'usage.errors.title': '模型报错',
      'usage.errors.toggle': '模型报错（{count} 类）',
      'usage.errors.recent': '最近 24 小时',
      'usage.errors.empty': '最近 24 小时没有记录到模型报错。',
      'usage.toolErrors.title': '工具报错',
      'usage.toolErrors.toggle': '工具报错（{count} 类）',
      'usage.toolErrors.empty': '最近 24 小时没有记录到工具报错。',
      'usage.errors.count': '{count} 次',
      'notification.title': '通知',
      'notification.description': '任务结束或需要你授权、抉择时发送浏览器通知。需要授权浏览器通知权限。',
      'notification.enable': '开启通知',
      'notification.enabled': '通知已开启',
      'notification.disable': '关闭通知',
      'notification.denied': '通知权限被拒绝',
      'notification.master': '通知总开关',
      'notification.done': '任务结束通知',
      'notification.input': '授权与提问通知',
      'notification.doneTitle': '任务完成',
      'notification.doneBody': '{title} 已完成本轮任务',
      'notification.inputTitle': '需要你的确认',
      'notification.inputBody': '{title}（{kind}）',
      'notification.kind.approval': '等待授权',
      'notification.kind.plan-review': '等待审阅计划',
      'notification.kind.question': '等待选择答案',
      'notification.bellOn': '通知开启',
      'notification.bellOff': '通知关闭',
      'quota.cardTitle': '额度查询',
      'quota.navToggle': '设置页左列显示「额度查询」入口',
      'quota.navToggleHint': '默认关闭；开启后在设置页左侧标签列底部显示「额度查询」快捷入口',
      'quota.hint': '圆环跟随当前会话所选模型的供应商；查询由宿主统一节流，不会频繁请求上游。',
      'quota.poll': '自动查询',
      'quota.poll.manual': '仅手动',
      'quota.poll.minute': '{count} 分钟',
      'quota.window.rolling': '滚动 5 小时',
      'quota.window.tokens-limit-u3-n5': '5 小时 Token',
      'quota.window.tokens-limit-u6-n1': '本周 Token',
      'quota.window.tokens-limit': 'Token 额度',
      'quota.window.time-limit-u5-n1': 'MCP 配额',
      'quota.window.time-limit': 'MCP 配额',
      'quota.window.credits': '已用额度',
      'quota.window.balance': '余额',
      'quota.window.weekly': '本周',
      'quota.window.monthly': '本月',
      'quota.panel.title': '额度用量',
      'quota.panel.used': '已用',
      'quota.panel.remaining': '剩余',
      'quota.ring.label': '额度查询',
      'quota.ring.aria': '额度查询 · {provider} · 已用 {percent}%',
      'quota.updated': '更新于 {time}',
      'quota.refreshing': '刷新中…',
      'quota.empty': '暂无数据',
      'quota.resetIn': '重置于 {time}',
      'quota.resetCard.title': '重置卡',
      'quota.resetCard.remaining': '剩余 {count} 次',
      'quota.resetCard.expires': '{date} 到期',
      'quota.resetCard.expired': '已过期',
      'quota.resetCard.edit': '重置卡…',
      'quota.resetCard.countLabel': '剩余次数',
      'quota.resetCard.dateLabel': '到期日期',
      'quota.resetCard.nameLabel': '名称（可选）',
      'quota.resetCard.save': '保存',
      'quota.resetCard.remove': '移除',
      'quota.resetCard.invalidCount': '请输入有效的剩余次数',
      'quota.retryAt': '{time} 后可重试',
      'quota.unadapted': '未适配',
      'quota.adapt': '适配',
      'quota.kind.opencode-go': 'OpenCode Go',
      'quota.kind.zai-coding-cn': '智谱 GLM Coding Plan',
      'quota.kind.openrouter': 'OpenRouter',
      'quota.kind.kimi': 'Kimi / Moonshot',
      'quota.kind.siliconflow': '硅基流动',
      'quota.kindAuto': '自动识别',
      'quota.saveFailed': '保存失败：{error}',
      'quota.unknownProvider': '未知供应商',
      'quota.error.credential-missing': '凭据未配置（请在 DSH 凭据中设置对应 API key）',
      'quota.error.no-base-url': '该供应商未配置 baseURL',
      'quota.error.credentials-unavailable': '凭据服务不可用',
      'quota.error.http-status': '上游返回错误状态',
      'quota.error.network': '网络错误',
      'quota.error.timeout': '请求超时',
      'quota.error.bad-payload': '响应格式异常',
      'quota.error.unknown': '未知错误',
      'quota.unit.day': '{count} 天',
      'quota.unit.hour': '{count} 小时',
      'quota.unit.minute': '{count} 分钟',
    }
    const en = {
      'nav.label': 'Service Control',
      'nav.restart': 'Restart',
      'overlay.label': 'Service restart status',
      'recovery.waiting.title': 'Restarting service…',
      'recovery.waiting.body': 'Waiting for a new DSH Web process. Elapsed: {seconds} seconds.',
      'recovery.timeout.title': 'Service has not recovered',
      'recovery.timeout.body': 'Waited 60 seconds. Check the external process manager, or refresh the page manually.',
      'recovery.manual': 'Manual reload',
      'health.title': 'Health',
      'health.uptime': 'Uptime',
      'health.rss': 'Memory RSS',
      'health.platform': 'Platform',
      'health.nodeVersion': 'Node version',
      'health.liveSessions': 'Live sessions',
      'health.persistedSessions': 'Persisted sessions',
      'health.activeAgents': 'Active agents',
      'health.activeJobs': 'Background jobs',
      'health.uptimeValue': '{hours} h {minutes} min',
      'health.error': 'Could not read health metrics',
      'health.check': 'Run health check',
      'health.checking': 'Checking…',
      'health.overall.ok': 'Healthy',
      'health.overall.warning': 'Warning',
      'health.overall.error': 'Error',
      'health.alert.title': 'Health alert',
      'health.alert.diagnostics': 'The health check reported {status}. Review the affected items below.',
      'health.status.ok': 'Healthy',
      'health.status.warning': 'Warning',
      'health.status.error': 'Error',
      'health.status.info': 'Info',
      'health.check.session-storage': 'Session storage',
      'health.check.workspace-registry': 'Workspace registry',
      'health.check.dsh-home': 'DSH_HOME',
      'health.check.backup-storage': 'Backup storage',
      'health.check.tar': 'tar',
      'health.check.permissions': 'File permissions',
      'health.check.runtime-env': 'Runtime environment',
      'health.check.node-version': 'Node runtime',
      'health.detail.runtime-env.managed': 'Managed by {kind}; the process restarts automatically after exit',
      'health.detail.runtime-env.declared': 'Declared externally managed via DSH_SERVICE_RUNTIME_ENV',
      'health.detail.runtime-env.manual': 'Likely a manual terminal launch — nothing restarts the process after exit; one-click upgrade already keeps it running',
      'health.detail.runtime-env.unknown': 'No process manager detected, so automatic restart cannot be confirmed; set DSH_SERVICE_RUNTIME_ENV=managed if one exists',
      'health.detail.node-version.ok': '{version}, meets the >={required} requirement',
      'health.detail.node-version.warning': '{version} is below the required {required}.x; upgrading Node is recommended',
      'health.detail.session-storage.ok': 'Available, with {count} session snapshots',
      'health.detail.workspace-registry.ok': 'Available, with {count} workspaces',
      'health.detail.dsh-home.ok': 'Directory is accessible with mode {mode}',
      'health.detail.backup-storage.empty': 'Backup directory is available; no backups exist yet',
      'health.detail.backup-storage.ok': 'Backup directory is available, with {count} backups using {size}',
      'health.detail.tar.ok': 'The tar executable is available',
      'health.detail.permissions.ok': 'Permission check passed with no anomalies',
      'health.detail.permissions.warning': 'Found {count} file or directory permission anomalies',
      'health.detail.generic': '{status}',
      'tabs.overview': 'Overview',
      'tabs.notify': 'Notifications',
      'tabs.health': 'Health',
      'tabs.usage': 'Models',
      'tabs.quota': 'Quota lookup',
      'overview.container': 'Process and runtime',
      'overview.errors': 'Errors',
      'tabs.backup': 'Backup',
      'tabs.restart': 'Restart',
      'tabs.alert.title': 'Service control alert',
      'tabs.alert.body': 'These areas need attention: {tabs}',
      'permissions.title': 'File permissions',
      'permissions.description': 'Checks whether the Agent can read, write, and enter DSH_HOME and workspaces. Deep scans skip internal .git files; repair only adds permissions needed by the current user while preserving execute bits, and keeps the DSH credential file at 600.',
      'permissions.target': 'Target owner: {owner}',
      'permissions.repair': 'Repair permissions',
      'permissions.repairing': 'Repairing…',
      'permissions.confirm': 'Confirm repair',
      'permissions.confirmHint': 'This skips .git, restores ownership to the current user, and adds Agent read/write access while preserving existing execute bits. Confirm to continue.',
      'permissions.cancel': 'Cancel',
      'permissions.error': 'Permission operation failed',
      'permissions.summary.ok': '{count} root path(s) passed the check',
      'permissions.summary.warning': '{count} root path(s) need attention',
      'permissions.showDetails': 'Show details',
      'permissions.hideDetails': 'Hide details',
      'permissions.deep': 'Deep check',
      'permissions.deepChecking': 'Scanning…',
      'permissions.deepSummary': 'Scanned {scanned} entries in {duration} ms; non-editable directories {directories}, non-editable files {files}, unreadable {unreadable}.',
      'backup.title': 'Backup management',
      'backup.description': 'Backs up sessions, configuration, and plugin profile manifests. Credentials and node_modules are excluded. Backups are never auto-pruned; you are responsible for disk usage.',
      'backup.create': 'Create backup',
      'backup.creating': 'Creating…',
      'backup.total': 'Total size: {size}',
      'backup.empty': 'No backups yet.',
      'backup.delete': 'Delete',
      'backup.confirm': 'Confirm delete',
      'backup.confirmHint': 'Delete this backup? This cannot be undone.',
      'backup.cancel': 'Cancel',
      'backup.error': 'Backup operation failed',
      'backup.export': 'Export',
      'backup.exporting': 'Exporting…',
      'backup.exportError': 'Backup export failed',
      'backup.restore': 'Restore',
      'backup.restoreConfirm': 'Confirm restore',
      'backup.restoreHint': 'Restore this backup? Current sessions and configuration will be overwritten. The service will restart automatically after restoration.',
      'backup.restoreError': 'Backup restore failed',
      'backup.import': 'Import backup',
      'backup.importing': 'Importing…',
      'backup.showRecords': 'Show backup records',
      'backup.hideRecords': 'Hide backup records',
      'version.title': 'Version information',
      'version.current': 'DSH: ',
      'version.plugin': 'dsh-service: ',
      'version.loading': 'Loading…',
      'update.check': 'Check for updates',
      'update.checking': 'Checking…',
      'update.current': 'Up to date',
      'update.available': 'New version: {version}',
      'update.detailsButton': 'View details',
      'update.detailsHide': 'Collapse',
      'update.unavailable': 'Latest version is temporarily unavailable',
      'update.unpublished': 'No published version is available to check',
      'health.recheck': 'Run again',
      'update.badge': 'DSH update',
      'update.details.title': 'DSH update available',
      'update.details.current': 'Current version: {version}',
      'update.details.latest': 'Latest version: {version}',
      'update.channelStable': 'Stable',
      'update.channelPreview': 'Preview',
      'update.details.close': 'Close',
      'update.upgrade': 'Upgrade plugin',
      'update.upgrading': 'Upgrading…',
      'update.upgradeError': 'Plugin upgrade failed',
      'update.upgradeErrorDetail': 'Plugin upgrade failed ({detail})',
      'update.upgradeSuccess': 'Upgrade successful, restarting…',
      'update.guardActiveWork': 'Active sessions or background tasks are running; resolve them before upgrading',
      'update.guardLinkInstall': 'Installed via link: (development mode) — cannot one-click upgrade from the registry; update the source checkout and restart',
      'update.guardFileInstall': 'Installed via file: — cannot one-click upgrade from the registry',
      'update.guardNoNewer': 'The registry latest is not higher than the current version; refused a possible downgrade',
      'update.guardNoProfile': 'No profile with this plugin installed was found to target the upgrade at',
      'update.guardAmbiguous': 'Several profiles install this plugin and the loaded copy could not be determined; aborted',
      'update.guardStale': 'The command reported success but the installed version did not change (pnpm safety wait likely blocked it); keeping the current version without restarting',
      'update.guardUnreadable': 'The command succeeded but the installed version could not be confirmed; the restart was cancelled',
      'update.failPnpmMissing': 'pnpm was not found, so the upgrade cannot run; install pnpm first and retry',
      'update.failNetwork': 'A transient network failure occurred while fetching dependencies; please retry shortly',
      'update.failFetchTimeout': 'Download timed out (slow network or large package); please retry later',
      'update.failReleaseAge': 'The new release is blocked by pnpm\'s fresh-release safety wait; one automatic bypass retry also failed',
      'update.failHoist': 'This profile\'s node_modules was created by a different pnpm major; the rebuild retry also failed',
      'update.failAddingToRoot': 'pnpm refused to add at the workspace root (missing -w)',
      'update.failNotWorkspace': '-w was passed but the profile is not a pnpm workspace',
      'update.failIgnoredBuilds': 'Dependency build scripts are blocked by pnpm by default, so the upgrade could not finish',
      'env.kind.docker': 'Docker container',
      'env.kind.container': 'Container (containerd/Kubernetes)',
      'env.kind.systemd': 'systemd service',
      'env.kind.pm2': 'pm2',
      'env.kind.supervisord': 'supervisord',
      'env.kind.kubernetes': 'Kubernetes',
      'env.kind.declared': 'External process manager (declared manually)',
      'update.manualConfirmTitle': 'Confirm before upgrading: manual launch suspected',
      'update.manualConfirm': 'No process manager such as Docker/systemd/pm2 was detected. After the upgrade DSH will NOT restart automatically — the new version is written to disk while the current process keeps running the old one; close and rerun dsh manually to activate it.',
      'update.manualProceed': 'Upgrade anyway',
      'update.manualRestartTitle': 'Upgrade finished — manual restart required',
      'update.manualRestartBody': 'The new version is installed, but the current process still runs the old one. Press Ctrl+C in the terminal running dsh (or simply close the window), then start dsh again.',
      'restart.title': 'Service restart',
      'restart.description': 'Restart the dsh web process. Active work will be interrupted; persisted sessions can be resumed. You can also type /restart in a conversation.',
      'restart.button': 'Restart dsh web',
      'restart.sending': 'Sending…',
      'restart.confirm': 'Confirm restart',
      'restart.force': 'Force restart',
      'restart.cancel': 'Cancel',
      'restart.sent': 'Restart request sent.',
      'restart.sentHint': 'The connection will close shortly. The page will reload automatically after recovery.',
      'restart.idleHint': 'No active work was detected. Confirm to disconnect and wait for the service to restart.',
      'restart.manualWarn': 'This looks like a manual terminal launch: once confirmed the process exits and nothing restarts it — you must run dsh again yourself.',
      'restart.sentManualHint': 'This is a manual-launch environment, so the service will not come back on its own. Run dsh again in the original terminal; refresh this page once the service is up.',
      'restart.navToggle': 'Show "Restart" entry in settings left nav',
      'restart.navToggleHint': 'Off by default; when enabled, a quick-restart entry appears at the bottom of the settings left navigation',
      'activity.agent': 'Agent',
      'activity.job': 'Background job',
      'activity.terminal': 'Terminal',
      'activity.warning': 'Detected {count} active item(s). Restarting will interrupt them immediately.',
      'activity.item': '{type}: {label} ({status})',
      'error.update': 'Update check failed',
      'error.activity': 'Could not check active work',
      'error.restart': 'Restart failed',
      'error.instance': 'Restart response is missing the process instance ID',
      'usage.title': 'Model usage',
      'usage.structure': 'token structure',
      'usage.structureHint': 'Input, output, and cache token by date.',
      'usage.tooltip.date': 'Date: {date}',
      'usage.tooltip.input': 'Input {value} token',
      'usage.tooltip.output': 'Output {value} token',
      'usage.tooltip.cache': 'Cache hit {value} token',
      'usage.axis': 'token vertical axis',
      'usage.models.more': 'Show {count} more models',
      'usage.models.less': 'Collapse model list',
      'usage.modelSortHint': 'Sorted by total tokens, largest first',
      'usage.modelBar': '{model}: {total} tokens in total',
      'usage.refresh': 'Refresh usage',
      'usage.refreshing': 'Refreshing…',
      'usage.empty': 'No usage index yet. Select Refresh usage to build the read-only index.',
      'usage.error': 'Could not read model usage',
      'usage.allProjects': 'All projects',
      'usage.total': 'Total tokens',
      'usage.steps': 'Successful model steps',
      'usage.stepsValue': '{count} times',
      'usage.modelLine': '{steps} times · Cache hit {hitRate} · Input {input} token · Output {output} token',
      'usage.input': 'Input token',
      'usage.output': 'Output token',
      'usage.cache': 'Cache token',
      'usage.hitRate': 'Cache hit rate',
      'usage.today': 'Today',
      'usage.sevenDays': 'Last 7 days',
      'usage.errors.title': 'Model errors',
      'usage.errors.toggle': 'Model errors ({count} types)',
      'usage.errors.recent': 'Last 24 hours',
      'usage.errors.empty': 'No model errors were recorded in the last 24 hours.',
      'usage.toolErrors.title': 'Tool errors',
      'usage.toolErrors.toggle': 'Tool errors ({count} types)',
      'usage.toolErrors.empty': 'No tool errors were recorded in the last 24 hours.',
      'usage.errors.count': '{count} occurrence(s)',
      'notification.title': 'Notifications',
      'notification.description': 'Send a browser notification when a task finishes or when your approval or decision is needed. Requires browser notification permission.',
      'notification.enable': 'Enable notifications',
      'notification.enabled': 'Notifications enabled',
      'notification.disable': 'Disable notifications',
      'notification.denied': 'Notification permission denied',
      'notification.master': 'Master switch',
      'notification.done': 'Task completion',
      'notification.input': 'Approvals & questions',
      'notification.doneTitle': 'Task complete',
      'notification.doneBody': '{title} has finished its turn',
      'notification.inputTitle': 'Your attention needed',
      'notification.inputBody': '{title} — {kind}',
      'notification.kind.approval': 'approval requested',
      'notification.kind.plan-review': 'plan review requested',
      'notification.kind.question': 'answer requested',
      'notification.bellOn': 'Notifications on',
      'notification.bellOff': 'Notifications off',
      'quota.cardTitle': 'Quota lookup',
      'quota.navToggle': 'Show "Quota lookup" entry in settings left nav',
      'quota.navToggleHint': 'Off by default; when enabled, a "Quota lookup" entry appears at the bottom of the settings left navigation',
      'quota.hint': 'The ring follows the provider selected by the current session; queries are throttled by the host and never hammer the upstream.',
      'quota.poll': 'Auto query',
      'quota.poll.manual': 'Manual only',
      'quota.poll.minute': '{count} min',
      'quota.window.rolling': '5h rolling',
      'quota.window.tokens-limit-u3-n5': '5-hour tokens',
      'quota.window.tokens-limit-u6-n1': 'Weekly tokens',
      'quota.window.tokens-limit': 'Token quota',
      'quota.window.time-limit-u5-n1': 'MCP quota',
      'quota.window.time-limit': 'MCP quota',
      'quota.window.credits': 'Credits used',
      'quota.window.balance': 'Balance',
      'quota.window.weekly': 'This week',
      'quota.window.monthly': 'This month',
      'quota.window.tokens-limit-u3-n5': '5-hour tokens',
      'quota.window.tokens-limit-u6-n1': 'Weekly tokens',
      'quota.window.tokens-limit': 'Token quota',
      'quota.window.time-limit-u5-n1': 'MCP quota',
      'quota.window.time-limit': 'MCP quota',
      'quota.window.credits': 'Credits used',
      'quota.window.balance': 'Balance',
      'quota.panel.title': 'Quota usage',
      'quota.panel.used': 'Used',
      'quota.panel.remaining': 'Remaining',
      'quota.ring.label': 'Quota lookup',
      'quota.ring.aria': 'Quota lookup · {provider} · {percent}% used',
      'quota.updated': 'Updated {time}',
      'quota.refreshing': 'Refreshing…',
      'quota.empty': 'No data yet',
      'quota.resetIn': 'Resets in {time}',
      'quota.resetCard.title': 'Reset card',
      'quota.resetCard.remaining': '{count} left',
      'quota.resetCard.expires': 'expires {date}',
      'quota.resetCard.expired': 'expired',
      'quota.resetCard.edit': 'Reset card…',
      'quota.resetCard.countLabel': 'Remaining',
      'quota.resetCard.dateLabel': 'Expiry date',
      'quota.resetCard.nameLabel': 'Name (optional)',
      'quota.resetCard.save': 'Save',
      'quota.resetCard.remove': 'Remove',
      'quota.resetCard.invalidCount': 'Enter a valid remaining count',
      'quota.retryAt': 'Retry allowed after {time}',
      'quota.unadapted': 'Not adapted',
      'quota.adapt': 'Adapt',
      'quota.kind.opencode-go': 'OpenCode Go',
      'quota.kind.zai-coding-cn': 'Zhipu GLM Coding Plan',
      'quota.kind.openrouter': 'OpenRouter',
      'quota.kind.kimi': 'Kimi / Moonshot',
      'quota.kind.siliconflow': 'SiliconFlow',
      'quota.kindAuto': 'Auto-detected',
      'quota.saveFailed': 'Save failed: {error}',
      'quota.unknownProvider': 'Unknown provider',
      'quota.error.credential-missing': 'Credential missing (set the API key in DSH credentials)',
      'quota.error.no-base-url': 'This provider has no baseURL configured',
      'quota.error.credentials-unavailable': 'Credential service unavailable',
      'quota.error.http-status': 'Upstream returned an error status',
      'quota.error.network': 'Network error',
      'quota.error.timeout': 'Request timed out',
      'quota.error.bad-payload': 'Unexpected response format',
      'quota.error.unknown': 'Unknown error',
      'quota.unit.day': '{count} d',
      'quota.unit.hour': '{count} h',
      'quota.unit.minute': '{count} min',
    }

    // 设置页导航自定义图标：settings.section 协议没有 icon 字段，外壳 navIcon(id) 只认
    // models/agent-presets/plugins 三个官方 id，其余一律兜底齿轮。手法学 DSH-better-sidebar：
    // 运行时在设置弹窗 nav 里按本地化文案全文匹配自己的行、打自有 data 属性（不猜 DOM 位置，
    // 切语言靠 characterData 观察自动重挂），CSS 再藏齿轮、mask SVG 画自家图标。
    // disposer 断 observer 并摘光自家标记，随 Fiber 销毁。残余脆弱点：依赖外壳 dialog>nav>button
    // 结构；与其他条目同文案会误标（本插件三个文案足够独特）。
    const NAV_ICON_SVG_OPEN = '%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27black%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E'
    const NAV_ICON_SVG_CLOSE = '%3C/svg%3E'
    const navIconMask = (body) => '-webkit-mask:url("data:image/svg+xml,' + NAV_ICON_SVG_OPEN + body + NAV_ICON_SVG_CLOSE + '") center/contain no-repeat;mask:url("data:image/svg+xml,' + NAV_ICON_SVG_OPEN + body + NAV_ICON_SVG_CLOSE + '") center/contain no-repeat'
    // 三枚图标（16px 下可读）：服务控制=滑杆组、远端额度=仪表弧+指针、重启=电源符号
    const NAV_ICON_BODY_SERVICE = '%3Cpath d=%27M4 8h16%27/%3E%3Cpath d=%27M4 16h16%27/%3E%3Ccircle cx=%279%27 cy=%278%27 r=%272.5%27 fill=%27black%27/%3E%3Ccircle cx=%2715%27 cy=%2716%27 r=%272.5%27 fill=%27black%27/%3E'
    const NAV_ICON_BODY_QUOTA = '%3Cpath d=%27m12 14 4-4%27/%3E%3Cpath d=%27M3.34 19a10 10 0 1 1 17.32 0%27/%3E'
    const NAV_ICON_BODY_RESTART = '%3Cpath d=%27M12 2v10%27/%3E%3Cpath d=%27M18.4 6.6a9 9 0 1 1-12.77.04%27/%3E'

    function markSettingsNavRows(rows) {
      if (typeof document === 'undefined' || !document.body) return () => {}
      let disposed = false
      const sync = () => {
        if (disposed) return
        for (const button of document.querySelectorAll('[role="dialog"] nav button')) {
          const text = (button.textContent || '').trim()
          for (const row of rows) {
            const label = String(row.label() || '').trim()
            if (label && text === label) button.setAttribute(row.attr, '')
            else button.removeAttribute(row.attr)
          }
        }
      }
      sync()
      const observer = new MutationObserver(sync)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      return () => {
        disposed = true
        observer.disconnect()
        for (const row of rows) {
          for (const el of document.querySelectorAll('[' + row.attr + ']')) el.removeAttribute(row.attr)
        }
      }
    }

    const inject = ['slots', 'connection', 'timer', 'locale', 'sessions']

    function apply(ctx) {
      const { useState, useEffect, useRef } = React
      let svcStyle
      if (typeof document !== 'undefined' && document.head) {
        svcStyle = document.createElement('style')
        svcStyle.textContent = [
          ':root{--dsh-svc-surface-bg:#f3f4f6}body[data-ds-dark-theme]{--dsh-svc-surface-bg:#1e1e20}',
          // 设置页导航行图标：外壳按 id 硬编码（第三方一律兜底齿轮）且协议无 icon 字段，
          // 由 markSettingsNavRows 打的 data 标记接住——藏齿轮 SVG、mask SVG 画各自图标，
          // currentColor 跟随主题文字色（hover/active 高亮自动继承）。
          '[data-dsh-service-nav]>svg:first-child,[data-dsh-service-quota-nav]>svg:first-child,[data-dsh-service-restart-nav]>svg:first-child{display:none}',
          '[data-dsh-service-nav]::before,[data-dsh-service-quota-nav]::before,[data-dsh-service-restart-nav]::before{content:\'\';flex:none;width:16px;height:16px;background:currentColor}',
          '[data-dsh-service-nav]::before{' + navIconMask(NAV_ICON_BODY_SERVICE) + '}',
          '[data-dsh-service-quota-nav]::before{' + navIconMask(NAV_ICON_BODY_QUOTA) + '}',
          '[data-dsh-service-restart-nav]::before{' + navIconMask(NAV_ICON_BODY_RESTART) + '}',
        ].join('')
        document.head.appendChild(svcStyle)
      }
      ctx.effect(() => () => { if (svcStyle) svcStyle.remove() }, 'dsh-service theme styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-service dictionaries')
      const t = ctx.locale.bind(NS)
      // 设置页左列三行打标记，配合上方样式换成各自图标；label 走 locale 绑定值。
      ctx.effect(
        () => markSettingsNavRows([
          { attr: 'data-dsh-service-nav', label: () => t('nav.label') },
          { attr: 'data-dsh-service-quota-nav', label: () => t('tabs.quota') },
          { attr: 'data-dsh-service-restart-nav', label: () => t('nav.restart') },
        ]),
        'dsh-service settings nav icons',
      )
      const useTranslation = () => {
        const [, setSnapshot] = useState(ctx.locale.getSnapshot())
        useEffect(() => ctx.locale.subscribe(() => setSnapshot(ctx.locale.getSnapshot())), [])
        return t
      }
      // 全局通知：任务结束 + 需要授权/选择答案，两个独立子开关受总开关管辖
      let notifyEnabled = false
      let notifyDone = true
      let notifyInput = true
      try { notifyEnabled = localStorage.getItem('dsh-service-notify') === 'true' } catch (_) {}
      try { notifyDone = localStorage.getItem('dsh-service-notify-done') !== 'false' } catch (_) {}
      try { notifyInput = localStorage.getItem('dsh-service-notify-input') !== 'false' } catch (_) {}
      const notifyListeners = new Set()
      const persistNotify = (key, value) => { try { localStorage.setItem(key, value ? 'true' : 'false') } catch (_) {} }
      const publishNotify = () => { for (const listener of notifyListeners) listener() }
      const setNotifyEnabled = (value) => { notifyEnabled = value; persistNotify('dsh-service-notify', value); publishNotify() }
      const setNotifyDone = (value) => { notifyDone = value; persistNotify('dsh-service-notify-done', value); publishNotify() }
      const setNotifyInput = (value) => { notifyInput = value; persistNotify('dsh-service-notify-input', value); publishNotify() }
      const useNotifyState = () => {
        const [, setTick] = useState(0)
        const [enabled, setEnabled] = useState(notifyEnabled)
        const [done, setDone] = useState(notifyDone)
        const [input, setInput] = useState(notifyInput)
        React.useEffect(() => {
          const update = () => { setEnabled(notifyEnabled); setDone(notifyDone); setInput(notifyInput); setTick((t) => t + 1) }
          notifyListeners.add(update)
          return () => notifyListeners.delete(update)
        }, [])
        return { enabled, done, input, setEnabled: (v) => setNotifyEnabled(v), setDone: (v) => setNotifyDone(v), setInput: (v) => setNotifyInput(v) }
      }
      // 设置页左列「重启」入口显示开关：默认关闭，localStorage 持久化；
      // 开启时才注册 settings.section 条目（导航列单元格由外壳渲染，开关不生效就不能用 null 内容占位）。
      let restartNavEnabled = false
      try { restartNavEnabled = localStorage.getItem('dsh-service-restart-nav') === 'true' } catch (_) {}
      let restartNavDispose = null
      const syncRestartNavEntry = () => {
        if (restartNavDispose) { restartNavDispose(); restartNavDispose = null }
        if (!restartNavEnabled) return
        restartNavDispose = ctx.slots.register(
          { name: 'settings.section', id: 'dsh-service-restart', order: 499, label: () => t('nav.restart') },
          () => React.createElement(RestartSection, null),
        )
      }
      const restartNavListeners = new Set()
      const setRestartNavEnabled = (value) => {
        restartNavEnabled = value === true
        try { localStorage.setItem('dsh-service-restart-nav', restartNavEnabled ? 'true' : 'false') } catch (_) {}
        syncRestartNavEntry()
        for (const listener of restartNavListeners) listener()
      }
      const useRestartNavEnabled = () => {
        const [enabled, setEnabled] = useState(restartNavEnabled)
        useEffect(() => {
          const update = () => setEnabled(restartNavEnabled)
          restartNavListeners.add(update)
          setEnabled(restartNavEnabled)
          return () => restartNavListeners.delete(update)
        }, [])
        return [enabled, setRestartNavEnabled]
      }
      // 设置页左列「额度查询」入口显示开关：默认关闭，localStorage 持久化；与重启入口同模式。
      let quotaNavEnabled = false
      try { quotaNavEnabled = localStorage.getItem('dsh-service-quota-nav') === 'true' } catch (_) {}
      let quotaNavDispose = null
      const syncQuotaNavEntry = () => {
        if (quotaNavDispose) { quotaNavDispose(); quotaNavDispose = null }
        if (!quotaNavEnabled) return
        quotaNavDispose = ctx.slots.register(
          { name: 'settings.section', id: 'dsh-service-quota', order: 498, label: () => t('tabs.quota') },
          () => React.createElement(QuotaSection, null),
        )
      }
      const quotaNavListeners = new Set()
      const setQuotaNavEnabled = (value) => {
        quotaNavEnabled = value === true
        try { localStorage.setItem('dsh-service-quota-nav', quotaNavEnabled ? 'true' : 'false') } catch (_) {}
        syncQuotaNavEntry()
        for (const listener of quotaNavListeners) listener()
      }
      const useQuotaNavEnabled = () => {
        const [enabled, setEnabled] = useState(quotaNavEnabled)
        useEffect(() => {
          const update = () => setEnabled(quotaNavEnabled)
          quotaNavListeners.add(update)
          setEnabled(quotaNavEnabled)
          return () => quotaNavListeners.delete(update)
        }, [])
        return [enabled, setQuotaNavEnabled]
      }
      // 会话边沿通知：running→idle 记一次任务结束；pendingInteraction 出现记一次需要确认。
      // 数据源是客户端运行时的会话列表快照（订阅推送）；首个快照只建立基线，重连后重建基线，二者都不响铃。
      const NOTIFY_KIND_KEYS = {
        approval: 'notification.kind.approval',
        'plan-review': 'notification.kind.plan-review',
        question: 'notification.kind.question',
      }
      const notifyPermissionGranted = () => typeof Notification !== 'undefined' && Notification.permission === 'granted'
      const fireNotification = (title, body) => {
        if (!notifyPermissionGranted()) return
        try {
          const notification = new Notification(title, { body })
          // 点击系统通知弹窗：聚焦 DSH 页面并关闭该通知（chrome/ff 从通知点击回调
          // 视为用户手势，window.focus() 可把标签页带到前台）
          notification.onclick = () => {
            try { window.focus() } catch (_) {}
            try { notification.close() } catch (_) {}
          }
        } catch (_) {}
      }
      if (ctx.sessions && typeof ctx.sessions.list?.subscribe === 'function') {
        const observed = new Map()
        let baselined = false
        const observeSessions = () => {
          const snapshot = ctx.sessions.list.getSnapshot()
          if (!snapshot || !snapshot.byId) return
          if (!baselined) {
            baselined = true
            for (const [id, summary] of Object.entries(snapshot.byId)) {
              observed.set(id, { running: summary.running === true, pending: summary.pendingInteraction !== undefined })
            }
            return
          }
          for (const [id, summary] of Object.entries(snapshot.byId)) {
            const next = { running: summary.running === true, pending: summary.pendingInteraction !== undefined }
            const prev = observed.get(id)
            if (prev !== undefined) {
              if (prev.running && !next.running && notifyEnabled && notifyDone) {
                fireNotification(t('notification.doneTitle'), t('notification.doneBody', { title: summary.displayTitle || id }))
              }
              if (!prev.pending && next.pending && notifyEnabled && notifyInput) {
                const kindKey = NOTIFY_KIND_KEYS[summary.pendingInteraction]
                const kind = kindKey ? t(kindKey) : String(summary.pendingInteraction)
                fireNotification(t('notification.inputTitle'), t('notification.inputBody', { title: summary.displayTitle || id, kind }))
              }
            }
            observed.set(id, next)
          }
          for (const id of [...observed.keys()]) {
            if (!(id in snapshot.byId)) observed.delete(id)
          }
        }
        ctx.effect(() => ctx.sessions.list.subscribe(() => observeSessions()), 'dsh-service: session notification observation')
        ctx.effect(() => ctx.on('connection/reset', () => { observed.clear(); baselined = false }), 'dsh-service: notification rebaseline on reconnect')
        observeSessions()
      }

      const recoveryListeners = new Set()
      const updateListeners = new Set()
      let recoveryState = { status: 'idle', elapsedMs: 0 }
      let recoveryGeneration = 0
      let availableUpdate = null
      let updateDetailsOpen = false

      const setRecoveryState = (next) => {
        recoveryState = next
        for (const listener of recoveryListeners) listener(next)
      }

      const publishUpdateState = () => {
        const snapshot = { update: availableUpdate, open: updateDetailsOpen }
        for (const listener of updateListeners) listener(snapshot)
      }
      const setAvailableUpdate = (value) => {
        availableUpdate = value
        if (value === null) updateDetailsOpen = false
        publishUpdateState()
      }
      const setUpdateDetailsOpen = (open) => {
        updateDetailsOpen = open === true
        publishUpdateState()
      }
      const useUpdateState = () => {
        const [snapshot, setSnapshot] = useState({ update: availableUpdate, open: updateDetailsOpen })
        useEffect(() => {
          updateListeners.add(setSnapshot)
          setSnapshot({ update: availableUpdate, open: updateDetailsOpen })
          return () => updateListeners.delete(setSnapshot)
        }, [])
        return snapshot
      }

      // 重启流程共享状态：设置面板「重启」标签与专属设置页共用同一份 stage/activity/busy/error，
      // 触发路径（两段式确认、强制重启、恢复浮层）完全一致。
      const restartFlowListeners = new Set()
      let restartFlow = { stage: 0, activity: null, busy: false, error: null }
      const setRestartFlow = (next) => {
        restartFlow = next
        for (const listener of restartFlowListeners) listener(next)
      }
      const useRestartFlow = () => {
        const [snapshot, setSnapshot] = useState(restartFlow)
        useEffect(() => {
          restartFlowListeners.add(setSnapshot)
          setSnapshot(restartFlow)
          return () => restartFlowListeners.delete(setSnapshot)
        }, [])
        return snapshot
      }

      // 运行环境（version RPC 随 instanceId 返回）：概览展示、升级前置确认与重启警告共用。
      // null = 宿主未返回该字段（旧版本）或尚未拉取，一切行为静默退回现状。
      const runtimeEnvListeners = new Set()
      let runtimeEnvState = null
      const setRuntimeEnvState = (next) => {
        runtimeEnvState = next
        for (const listener of runtimeEnvListeners) listener(next)
      }
      const useRuntimeEnv = () => {
        const [snapshot, setSnapshot] = useState(runtimeEnvState)
        useEffect(() => {
          runtimeEnvListeners.add(setSnapshot)
          setSnapshot(runtimeEnvState)
          return () => runtimeEnvListeners.delete(setSnapshot)
        }, [])
        return snapshot
      }
      // 宿主字段按形状校验后才入库：manualStartLikely 必须 boolean、supervisorKind 缺省或 string，
      // 形状不对按「旧宿主无该字段」降级，绝不让坏值悄悄关掉确认门。
      const applyVersionRuntimeEnv = (value) => {
        const env = value ? value.runtimeEnv : undefined
        if (env === null || typeof env !== 'object') return
        if (typeof env.manualStartLikely !== 'boolean') return
        if (env.supervisorKind !== undefined && env.supervisorKind !== null && typeof env.supervisorKind !== 'string') return
        setRuntimeEnvState({ platform: typeof env.platform === 'string' ? env.platform : '', supervisorKind: env.supervisorKind === undefined || env.supervisorKind === null ? null : env.supervisorKind, manualStartLikely: env.manualStartLikely })
      }
      // version 快照全插件只取一次：ServicePanel 与左列入口无论谁先挂载都共享同一请求，
      // 升级前取 instanceId/运行环境也复用它。失败清缓存，下一个消费者重试。
      let versionSnapshotPromise = null
      const fetchVersionSnapshot = () => {
        if (versionSnapshotPromise === null) {
          versionSnapshotPromise = ctx.connection.rpc.call('/dsh-service', 'version', {})
            .then((res) => {
              if (res && res.ok) applyVersionRuntimeEnv(res.value)
              return res
            })
            .catch(() => {
              versionSnapshotPromise = null
              return null
            })
        }
        return versionSnapshotPromise
      }
      // 升级执行中标志放在 factory 作用域：闭包状态挡不住同一 tick 的重入，跨渲染的新闭包
      // 也各自持有独立的 false，只有插件级可变标志能同时覆盖两种情况。
      let upgradeInFlight = false
      const checkRestart = async () => {
        setRestartFlow({ ...restartFlow, busy: true, error: null })
        try {
          const res = await ctx.connection.rpc.call('/dsh-service', 'activity', {})
          if (res && res.ok === false) {
            console.error('dsh-service: activity check failed', res.error)
            throw new Error(t('error.activity'))
          }
          const nextActivity = res && res.value ? res.value : { hasActive: false, items: [] }
          setRestartFlow({ ...restartFlow, activity: nextActivity, stage: nextActivity.hasActive ? 3 : 1, busy: false, error: null })
        } catch (err) {
          setRestartFlow({ ...restartFlow, error: err && err.message ? String(err.message) : String(err), stage: 0, busy: false })
        }
      }
      const restartWeb = async (force) => {
        setRestartFlow({ ...restartFlow, busy: true, error: null })
        try {
          const res = await ctx.connection.rpc.call('/dsh-service', 'web', { force: force === true })
          if (res && res.ok === false) {
            if (res.error === 'active-work' && res.value) {
              setRestartFlow({ ...restartFlow, activity: res.value, stage: 3, busy: false, error: null })
              return
            }
            console.error('dsh-service: restart failed', res.error)
            throw new Error(t('error.restart'))
          }
          const previousInstanceId = res && res.value ? res.value.instanceId : undefined
          if (typeof previousInstanceId !== 'string' || previousInstanceId.length === 0) {
            throw new Error(t('error.instance'))
          }
          setRestartFlow({ ...restartFlow, stage: 2, busy: false, error: null })
          startRecovery(previousInstanceId).catch((err) => console.error('dsh-service: recovery failed', err))
        } catch (err) {
          setRestartFlow({ ...restartFlow, error: err && err.message ? String(err.message) : String(err), stage: 0, busy: false })
        }
      }

      const useRecoveryState = () => {
        const [snapshot, setSnapshot] = useState(recoveryState)
        useEffect(() => {
          recoveryListeners.add(setSnapshot)
          setSnapshot(recoveryState)
          return () => recoveryListeners.delete(setSnapshot)
        }, [])
        return snapshot
      }

      const startRecovery = async (previousInstanceId) => {
        const generation = ++recoveryGeneration
        let elapsedMs = 0
        let delayMs = 1000
        setRecoveryState({ status: 'waiting', elapsedMs })

        while (elapsedMs < 60000 && generation === recoveryGeneration) {
          const waitMs = Math.min(delayMs, 60000 - elapsedMs)
          try {
            await ctx.timer.timeout(waitMs)
          } catch (_) {
            return
          }
          if (generation !== recoveryGeneration) return

          elapsedMs += waitMs
          setRecoveryState({ status: 'waiting', elapsedMs })
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'version', {})
            const nextInstanceId = res && res.ok ? res.value && res.value.instanceId : undefined
            if (typeof nextInstanceId === 'string' && nextInstanceId.length > 0 && nextInstanceId !== previousInstanceId) {
              window.location.reload()
              return
            }
          } catch (_) {}

          if (elapsedMs >= 60000) {
            setRecoveryState({ status: 'timeout', elapsedMs })
            return
          }
          delayMs = Math.min(delayMs * 2, 10000)
        }
      }

      ctx.effect(() => () => {
        recoveryGeneration += 1
        recoveryListeners.clear()
        restartFlowListeners.clear()
        runtimeEnvListeners.clear()
        updateListeners.clear()
      }, 'dsh-service recovery')

      function UpdateBadge() {
        const state = useUpdateState()
        const translate = useTranslation()
        if (state.update === null) return null
        return React.createElement('button', {
          type: 'button',
          onClick: () => setUpdateDetailsOpen(true),
          style: { margin: '4px', padding: '5px 8px', borderRadius: '999px', border: 0, background: '#d80', color: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 600 },
        }, translate('update.badge'))
      }

      // 正式/预览通道行：版本号后跟 npmjs（版本页）与 npmmirror（镜像版本页）两个文字链接。
      // 版本串嵌进 URL 前过安全字符集校验，不过校验的标签降级为纯文本。供更新详情浮层使用。
      const NPM_DSH_PACKAGE = '@deepseek-ai/dsh'
      const packageVersionHref = (base, version) => {
        if (typeof version !== 'string' || version.length === 0 || !/^[0-9A-Za-z.+_-]+$/.test(version)) return null
        return `${base}${version}`
      }
      const siteLabelLink = (kind, label, href) => {
        const testid = `version-dsh-channel-${kind}-${label}`
        if (!href) return React.createElement('span', { 'data-testid': testid, style: { marginLeft: '10px' } }, label)
        return React.createElement('a', { 'data-testid': testid, href, target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-brand-primary)', textDecoration: 'underline', marginLeft: '10px' } }, label)
      }
      const channelLine = (translate, kind, version) => React.createElement('div', { style: { whiteSpace: 'nowrap', lineHeight: 1.7 } },
        kind === 'latest' ? translate('update.channelStable') : translate('update.channelPreview'),
        ' ', React.createElement('span', { 'data-testid': `version-dsh-channel-${kind}`, style: { marginLeft: '4px' } }, version || '—'),
        siteLabelLink(kind, 'npmjs', packageVersionHref(`https://www.npmjs.com/package/${NPM_DSH_PACKAGE}/v/`, version)),
        siteLabelLink(kind, 'npmmirror', packageVersionHref(`https://www.npmmirror.com/package/${NPM_DSH_PACKAGE}/home?version=`, version)))
      const channelLines = (translate, tags) => React.createElement('div', { style: { margin: '4px 0', fontSize: '12px', lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' } },
        channelLine(translate, 'latest', tags && tags.latest),
        channelLine(translate, 'next', tags && tags.next))

      function ServiceOverlay() {
        const recovery = useRecoveryState()
        const updateState = useUpdateState()
        const translate = useTranslation()
        if (recovery.status === 'idle' && !updateState.open) return null
        if (recovery.status === 'idle') {
          const update = updateState.update
          if (update === null) return null
          return React.createElement('div', {
            style: { position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'rgba(12, 14, 20, 0.72)', backdropFilter: 'blur(4px)', pointerEvents: 'auto' },
          }, React.createElement('div', {
            style: { width: 'min(420px, 100%)', padding: '24px', borderRadius: '12px', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', boxShadow: '0 18px 60px rgba(0,0,0,0.35)', textAlign: 'center' },
          },
          React.createElement('div', { style: { fontSize: '18px', fontWeight: 700, marginBottom: '10px' } }, translate('update.details.title')),
          React.createElement('p', { style: { margin: '4px 0', fontSize: '13px' } }, translate('update.details.current', { version: update.current })),
          React.createElement('p', { style: { margin: '4px 0', fontSize: '13px' } }, translate('update.details.latest', { version: update.latest })),
          channelLines(translate, update.tags),
          React.createElement('button', { style: { marginTop: '16px', padding: '7px 16px', borderRadius: '6px', border: 0, background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-button-contrast-fill)', cursor: 'pointer' }, onClick: () => setUpdateDetailsOpen(false) }, translate('update.details.close'))))
        }

        const timedOut = recovery.status === 'timeout'
        return React.createElement('div', {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'rgba(12, 14, 20, 0.72)',
            backdropFilter: 'blur(4px)',
            pointerEvents: 'auto',
          },
        },
        React.createElement('div', {
          style: {
            width: 'min(420px, 100%)',
            padding: '24px',
            borderRadius: '12px',
            background: 'var(--dsw-alias-bg-overlay)',
            color: 'var(--dsw-alias-label-primary)',
            border: '1px solid var(--dsw-alias-border-l2)',
            boxShadow: '0 18px 60px rgba(0,0,0,0.35)',
            textAlign: 'center',
          },
        },
        React.createElement('div', { style: { fontSize: '18px', fontWeight: 700, marginBottom: '10px' } },
          translate(timedOut ? 'recovery.timeout.title' : 'recovery.waiting.title')),
        React.createElement('p', { style: { margin: 0, fontSize: '13px', lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)' } },
          timedOut
            ? translate('recovery.timeout.body')
            : translate('recovery.waiting.body', { seconds: Math.floor(recovery.elapsedMs / 1000) })),
        timedOut
          ? React.createElement('button', {
              style: { marginTop: '16px', padding: '7px 16px', borderRadius: '6px', border: 0, background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-button-contrast-fill)', cursor: 'pointer' },
              onClick: () => window.location.reload(),
            }, translate('recovery.manual'))
          : null))
      }

      function RestartOverlay() {
        return React.createElement(ServiceOverlay, null)
      }

      // 重启区块：设置面板「重启」标签与设置页左列底部的专属入口共用，状态取自共享重启流。
      // showNavToggle 仅「重启」标签传入：控制设置页左列入口是否显示（默认关闭）。
      function RestartSection({ showNavToggle }) {
        const translate = useTranslation()
        const flow = useRestartFlow()
        const runtimeEnv = useRuntimeEnv()
        // 左列专属入口可能先于「服务控制」面板挂载：走共享 version 快照（与面板同一次请求）。
        useEffect(() => {
          fetchVersionSnapshot()
        }, [])
        const [navEnabled, setNavEnabled] = useRestartNavEnabled()
        const btn = { minHeight: '32px', padding: '6px 14px', borderRadius: '7px', border: '1px solid transparent', cursor: 'pointer', fontSize: '13px', fontWeight: 550, transition: 'border-color 120ms ease, color 120ms ease, background 120ms ease', lineHeight: '20px' }
        const danger = { ...btn, background: 'var(--dsw-alias-state-error-primary)', color: '#fff', borderColor: 'var(--dsw-alias-state-error-primary)' }
        const ghost = { ...btn, background: 'transparent', color: 'var(--dsw-alias-label-primary)', borderColor: 'var(--dsw-alias-border-l2)' }
        const row = { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }
        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const card = { padding: '4px 0 14px', marginBottom: '12px', color: 'var(--dsw-alias-label-primary)' }
        const displaySurface = { background: 'var(--dsh-svc-surface-bg)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '10px' }
        const sectionTitle = { fontSize: '14px', fontWeight: 700, margin: '0 0 8px', color: 'var(--dsw-alias-label-primary)' }

        // 重启后提示：手动启动环境不会自动拉起，等待文案换成手动指引。
        if (flow.stage === 2) {
          return React.createElement('div', { 'data-testid': 'restart-card', style: card },
            React.createElement('div', { style: sectionTitle }, translate('restart.title')),
            React.createElement('p', { style: { margin: 0, fontSize: '13px' } }, translate('restart.sent')),
            React.createElement('p', { style: hint }, translate(runtimeEnv !== null && runtimeEnv.manualStartLikely === true ? 'restart.sentManualHint' : 'restart.sentHint')))
        }

        const activityLabels = {
          agent: translate('activity.agent'),
          job: translate('activity.job'),
          terminal: translate('activity.terminal'),
        }
        const activityItems = flow.activity && Array.isArray(flow.activity.items) ? flow.activity.items : []
        // 疑似终端手动启动：确认前就把「退出后无人拉起」讲清楚，两段式确认的后果清单。
        const manualWarn = runtimeEnv !== null && runtimeEnv.manualStartLikely === true
          ? React.createElement('p', { 'data-testid': 'restart-manual-warn', style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-warn-primary)', margin: '6px 0 0' }) }, translate('restart.manualWarn'))
          : null
        const activityWarning = flow.stage === 3
          ? React.createElement('div', { style: { marginTop: '12px', padding: '10px 12px', borderRadius: '6px', background: 'rgba(211,51,51,0.1)', border: '1px solid rgba(211,51,51,0.35)' } },
              React.createElement('p', { style: { margin: '0 0 8px', color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px', fontWeight: 600 } },
                translate('activity.warning', { count: activityItems.length })),
              React.createElement('ul', { style: { margin: 0, paddingLeft: '20px', fontSize: '12px', lineHeight: 1.7 } },
                activityItems.map((item) => React.createElement('li', { key: item.type + ':' + item.id },
                  translate('activity.item', {
                    type: activityLabels[item.type] || item.type,
                    label: item.label,
                    status: item.status,
                  }))))
            )
          : null

        // 重启按钮区块
        return React.createElement('div', { 'data-testid': 'restart-card', style: card },
          React.createElement('div', { style: sectionTitle }, translate('restart.title')),
          React.createElement('div', { 'data-testid': 'restart-region', style: displaySurface },
            React.createElement('p', { style: { margin: 0, fontSize: '13px' } }, translate('restart.description')),
            manualWarn,
            activityWarning,
            React.createElement('div', { style: row },
              flow.stage === 0
                ? React.createElement('button', { style: danger, 'data-variant': 'danger', onClick: checkRestart, disabled: flow.busy }, translate(flow.busy ? 'update.checking' : 'restart.button'))
                : flow.stage === 1
                  ? [
                      React.createElement('button', { key: 'confirm', style: danger, onClick: () => restartWeb(false), disabled: flow.busy }, translate(flow.busy ? 'restart.sending' : 'restart.confirm')),
                      React.createElement('button', { key: 'cancel', style: ghost, onClick: () => setRestartFlow({ ...restartFlow, activity: null, stage: 0, busy: false, error: null }), disabled: flow.busy }, translate('restart.cancel')),
                    ]
                  : flow.stage === 3
                    ? [
                        React.createElement('button', { key: 'force', style: danger, onClick: () => restartWeb(true), disabled: flow.busy }, translate(flow.busy ? 'restart.sending' : 'restart.force')),
                        React.createElement('button', { key: 'cancel', style: ghost, onClick: () => setRestartFlow({ ...restartFlow, activity: null, stage: 0, busy: false, error: null }), disabled: flow.busy }, translate('restart.cancel')),
                      ]
                    : null
            ),
            flow.stage === 1 ? React.createElement('p', { style: hint }, translate('restart.idleHint')) : null,
            flow.error ? React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)' }) }, String(flow.error)) : null,
            showNavToggle
              ? React.createElement('div', { style: { marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
                  React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                    React.createElement('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } }, translate('restart.navToggle')),
                    React.createElement('span', { style: hint }, translate('restart.navToggleHint'))),
                  React.createElement('button', {
                    type: 'button',
                    role: 'switch',
                    'data-testid': 'restart-nav-switch',
                    'aria-checked': String(navEnabled),
                    onClick: () => setNavEnabled(!navEnabled),
                    style: { width: '34px', height: '20px', borderRadius: '10px', padding: 0, flexShrink: 0, position: 'relative', border: `1px solid ${navEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'}`, background: navEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: 'pointer', lineHeight: 0 },
                  }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: navEnabled ? '15px' : '1px', width: '16px', height: '16px', borderRadius: '50%', background: navEnabled ? '#fff' : 'var(--dsw-alias-label-tertiary)' } })))
              : null)
        )
      }

      // ── 额度查询（v0.18）：环与统计卡共用一份快照、一个轮询器；上游节流全部收敛在宿主。 ──
      const quotaStore = {
        snapshot: { providers: [], serverTime: 0 },
        listeners: new Set(),
        subscribe(listener) {
          this.listeners.add(listener)
          return () => this.listeners.delete(listener)
        },
        getSnapshot() {
          return this.snapshot
        },
        publish(next) {
          this.snapshot = next
          for (const listener of [...this.listeners]) {
            try { listener() } catch (_) {}
          }
        },
      }
      const QUOTA_POLL_KEY = 'dsh-service-quota-poll'
      const QUOTA_POLL_CHOICES = [0, 1, 2, 5, 10]
      // 适配类型下拉选项：与宿主 QUOTA_KINDS 白名单保持一致（词典键 quota.kind.<kind>）。
      const QUOTA_KIND_OPTIONS = ['opencode-go', 'zai-coding-cn', 'openrouter', 'kimi', 'siliconflow']
      function readQuotaPollMinutes() {
        try {
          const raw = Number.parseInt(localStorage.getItem(QUOTA_POLL_KEY), 10)
          return QUOTA_POLL_CHOICES.includes(raw) ? raw : 5
        } catch (_) {
          return 5
        }
      }
      function writeQuotaPollMinutes(minutes) {
        try { localStorage.setItem(QUOTA_POLL_KEY, String(minutes)) } catch (_) {}
      }
      async function fetchQuotaSnapshot() {
        try {
          const res = await ctx.connection.rpc.call('/dsh-service', 'quota', {})
          if (res?.ok === true && res.value && typeof res.value === 'object' && Array.isArray(res.value.providers)) {
            quotaStore.publish(res.value)
            return true
          }
        } catch (_) {}
        return false
      }
      const quotaLoop = { refs: 0, nextDispose: null, running: false, onVisible: undefined }
      const isQuotaPageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
      function scheduleQuotaCycle() {
        if (quotaLoop.refs === 0 || quotaLoop.nextDispose !== null || readQuotaPollMinutes() <= 0) return
        const minutes = readQuotaPollMinutes()
        quotaLoop.nextDispose = ctx.timer.timeout(() => {
          quotaLoop.nextDispose = null
          runQuotaCycle()
        }, minutes * 60000)
      }
      function runQuotaCycle() {
        if (quotaLoop.refs === 0 || quotaLoop.running || isQuotaPageHidden()) return
        quotaLoop.running = true
        Promise.resolve(fetchQuotaSnapshot()).catch(() => false).then(() => {
          quotaLoop.running = false
          scheduleQuotaCycle()
        })
      }
      function acquireQuotaLoop() {
        quotaLoop.refs += 1
        // 每个表面（圆环/统计卡）挂载都立即向宿主要一次快照：宿主自行决定回缓存还是打上游，
        // 即使轮询已在跑（refs>1）也补查一次，保证「打开即最新」。
        runQuotaCycle()
        scheduleQuotaCycle()
        if (typeof document !== 'undefined') {
          quotaLoop.onVisible = () => {
            if (!isQuotaPageHidden()) runQuotaCycle()
          }
          document.addEventListener('visibilitychange', quotaLoop.onVisible)
        }
      }
      function releaseQuotaLoop() {
        quotaLoop.refs = Math.max(0, quotaLoop.refs - 1)
        if (quotaLoop.refs > 0) return
        if (quotaLoop.nextDispose !== null) {
          quotaLoop.nextDispose()
          quotaLoop.nextDispose = null
        }
        if (quotaLoop.onVisible !== undefined && typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', quotaLoop.onVisible)
          quotaLoop.onVisible = undefined
        }
      }
      function notifyQuotaPollChanged() {
        if (quotaLoop.nextDispose !== null) {
          quotaLoop.nextDispose()
          quotaLoop.nextDispose = null
        }
        scheduleQuotaCycle()
      }
      ctx.effect(() => () => {
        if (quotaLoop.nextDispose !== null) quotaLoop.nextDispose()
        if (quotaLoop.onVisible !== undefined && typeof document !== 'undefined') document.removeEventListener('visibilitychange', quotaLoop.onVisible)
      }, 'dsh-service quota poller disposal')

      function quotaWindowLabel(id, translate) {
        // 解析链：完整 id（rolling / tokens-limit-u3-n5…）→ 类型前缀（tokens/time）→ 原始 id。
        const exact = translate(`quota.window.${id}`)
        if (exact !== `quota.window.${id}`) return exact
        const prefix = String(id).split('-')[0]
        const byType = translate(`quota.window.${prefix}`)
        return byType === `quota.window.${prefix}` ? id : byType
      }
      function humanizeDuration(ms, translate) {
        // 官网口径：取最显着的两个非零单位（28 天 22 小时 / 4 小时 1 分钟），不足 1 分钟显示 0 分钟。
        const totalMinutes = Math.max(0, Math.floor(ms / 60000))
        const days = Math.floor(totalMinutes / 1440)
        const hours = Math.floor((totalMinutes % 1440) / 60)
        const minutes = totalMinutes % 60
        const parts = []
        if (days > 0) parts.push(translate('quota.unit.day', { count: days }))
        if (hours > 0) parts.push(translate('quota.unit.hour', { count: hours }))
        if (minutes > 0) parts.push(translate('quota.unit.minute', { count: minutes }))
        if (parts.length === 0) parts.push(translate('quota.unit.minute', { count: 0 }))
        return parts.slice(0, 2).join(' ')
      }
      function formatClockTime(timestamp) {
        try {
          return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        } catch (_) {
          return ''
        }
      }
      function formatShortDate(timestamp) {
        const date = new Date(timestamp)
        const digits = (value) => String(value).padStart(2, '0')
        return `${date.getFullYear()}-${digits(date.getMonth() + 1)}-${digits(date.getDate())}`
      }
      /** 手录重置卡的统一文案与过期态：卡片行与圆环面板共用。 */
      function resetCardContent(card, translate) {
        const rawExpiry = typeof card.expiresAt === 'string' && card.expiresAt.trim() !== '' ? card.expiresAt.trim() : ''
        const at = rawExpiry !== '' ? Date.parse(rawExpiry) : NaN
        const expired = Number.isFinite(at) && at < Date.now()
        const remainingPart = translate('quota.resetCard.remaining', { count: card.remaining })
        let expiryPart = ''
        if (rawExpiry !== '') {
          let shown = rawExpiry
          if (Number.isFinite(at)) {
            shown = rawExpiry.length > 10 ? `${formatShortDate(at)} ${formatClockTime(at)}` : formatShortDate(at)
            shown = expired
              ? `${shown} ${translate('quota.resetCard.expired')}`
              : translate('quota.resetCard.expires', { date: shown })
          }
          expiryPart = shown
        }
        const labelSuffix = typeof card.label === 'string' && card.label !== '' ? ` · ${card.label}` : ''
        return {
          expired,
          title: `${translate('quota.resetCard.title')}${labelSuffix} · ${remainingPart}`,
          expiry: expiryPart,
        }
      }
      function quotaErrorMessage(code, translate) {
        const key = `quota.error.${code}`
        const text = translate(key)
        return text === key ? translate('quota.error.unknown') : text
      }
      /** 弹窗/卡片共用的横向进度条。默认已用口径（≥80% 警黄）；remaining 口径数值即剩余%，≤20% 才警黄。 */
      function quotaBar(testId, percent, height, remainingBasis) {
        const warning = remainingBasis === true ? percent <= 20 : percent >= 80
        return React.createElement('div', {
          'data-testid': testId,
          style: { height, borderRadius: 999, background: 'var(--dsw-alias-interactive-bg-hover)', overflow: 'hidden' },
        },
        React.createElement('div', {
          style: { height: '100%', width: `${Math.max(0, Math.min(100, percent))}%`, borderRadius: 999, background: warning ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)' },
        }))
      }

      function QuotaRing(props) {
        const translate = useTranslation()
        const [quota, setQuota] = useState(quotaStore.getSnapshot())
        useEffect(() => quotaStore.subscribe(() => setQuota(quotaStore.getSnapshot())), [])
        const store = props && props.directoryStore
        useEffect(() => {
          // 无 modelDirectories 服务（或条目 props 为空）：不启动轮询、不发 RPC、不渲染内容。
          if (!store) return undefined
          acquireQuotaLoop()
          return releaseQuotaLoop
        }, [store])
        const [directoryState, setDirectoryState] = useState(store ? store.getSnapshot() : null)
        useEffect(() => {
          if (!store) return undefined
          setDirectoryState(store.getSnapshot())
          return store.subscribe(() => setDirectoryState(store.getSnapshot()))
        }, [store])
        useEffect(() => {
          if (store && (directoryState === null || directoryState?.current == null) && props && typeof props.loadDirectory === 'function') props.loadDirectory()
        }, [store, directoryState, props && props.loadDirectory])
        const [open, setOpen] = useState(false)
        const rootRef = useRef(null)
        const provider = directoryState?.current?.provider ?? null
        const row = provider !== null ? (quota.providers || []).find((entry) => entry.provider === provider && entry.adapted === true) : null
        const windows = Array.isArray(row?.windows) ? row.windows : []
        const percentWindows = windows.filter((window) => typeof window.percent === 'number')
        // 最紧约束：已用口径取最高占用；剩余口径取最低余量。两种口径并存时按压力值（贴近耗尽程度）比较。
        const pressureOf = (window) => (window.remaining === true ? 100 - window.percent : window.percent)
        const tightest = percentWindows.length > 0 ? percentWindows.reduce((best, current) => (pressureOf(current) > pressureOf(best) ? current : best), percentWindows[0]) : null

        // 切换会话/模型后，若目标 provider 有适配行但尚无数据（重启后首拉缺失等），
        // 主动补一次快照请求（宿主节流兜底）；Set 防抖避免发布→重渲染死循环。
        const quotaRefetchRequested = useRef(new Set())
        useEffect(() => {
          if (provider === null) return
          const matchedRow = (quota.providers || []).find((entry) => entry.provider === provider && entry.adapted === true)
          const needsData = matchedRow === undefined || (Array.isArray(matchedRow.windows) === false && matchedRow.refreshing !== true && matchedRow.errorCode === undefined)
          if (needsData && !quotaRefetchRequested.current.has(provider)) {
            quotaRefetchRequested.current.add(provider)
            fetchQuotaSnapshot()
          }
        }, [provider, quota])
        useEffect(() => {
          if (!open || typeof document === 'undefined') return undefined
          const onPointerDown = (event) => {
            if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return
            setOpen(false)
          }
          const onKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false)
          }
          document.addEventListener('pointerdown', onPointerDown)
          document.addEventListener('keydown', onKeyDown)
          return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
          }
        }, [open])
        if (row === undefined || row === null) return null
        const percent = tightest === null ? 0 : tightest.percent
        const remainingBasis = tightest !== null && tightest.remaining === true
        const usedWord = remainingBasis ? translate('quota.panel.remaining') : translate('quota.panel.used')
        const color = (remainingBasis ? percent <= 20 : percent >= 80) ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)'
        const radius = 5.5
        const circumference = 2 * Math.PI * radius
        const ariaText = `${translate('quota.ring.label')} · ${provider} · ${usedWord} ${percent}%`
        const retrySuffix = typeof row.nextAllowedAt === 'number' && row.nextAllowedAt > Date.now()
          ? ` · ${translate('quota.retryAt', { time: formatClockTime(row.nextAllowedAt) })}`
          : ''
        const errorNode = row.errorCode !== undefined
          ? React.createElement('div', { style: { marginTop: '8px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' } },
              `${quotaErrorMessage(row.errorCode, translate)}${row.errorDetail !== undefined ? ` (${row.errorDetail})` : ''}${retrySuffix}`)
          : null
        const updatedNode = row.refreshing === true || typeof row.fetchedAt === 'number'
          ? React.createElement('div', { style: { marginTop: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } },
              row.refreshing === true ? translate('quota.refreshing') : translate('quota.updated', { time: formatClockTime(row.fetchedAt) }))
          : null
        return React.createElement('span', { ref: rootRef, style: { position: 'relative', display: 'inline-flex' } },
          React.createElement('button', {
            type: 'button',
            'data-testid': 'quota-ring-trigger',
            'aria-label': ariaText,
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            title: ariaText,
            onClick: () => {
              setOpen(!open)
              fetchQuotaSnapshot()
            },
            style: { width: '28px', height: '28px', border: 'none', borderRadius: '999px', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0, color: 'var(--dsw-alias-label-secondary)' },
          },
          React.createElement('svg', { viewBox: '0 0 14 14', width: '14', height: '14', 'aria-hidden': true },
            React.createElement('circle', { cx: '7', cy: '7', r: radius, fill: 'none', stroke: 'var(--dsw-alias-border-l3)', strokeWidth: '2' }),
            React.createElement('circle', {
              cx: '7', cy: '7', r: radius, fill: 'none', stroke: color, strokeWidth: '2', strokeLinecap: 'round',
              strokeDasharray: `${(circumference * percent) / 100} ${circumference}`,
              transform: 'rotate(-90 7 7)',
            }))),
          open ? React.createElement('div', {
            role: 'dialog',
            'aria-label': translate('quota.panel.title'),
            'data-testid': 'quota-ring-panel',
            style: { position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 100, boxSizing: 'border-box', width: '240px', padding: '12px', borderRadius: '12px', background: 'var(--dsw-specific-menu)', border: '1px solid var(--dsw-alias-border-inverted)', boxShadow: 'var(--dsw-shadow-lv3)' },
          },
          React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '6px' } },
            React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, usedWord),
            React.createElement('span', { style: { marginLeft: 'auto', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, provider)),
          React.createElement('div', { style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' } },
            windows.map((window) => {
              // 文本窗口（余额等）：标签+数值一行，无进度条与重置。
              if (typeof window.text === 'string') {
                return React.createElement('div', { key: window.id, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', lineHeight: '18px' } },
                  React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, quotaWindowLabel(window.id, translate)),
                  React.createElement('span', { 'data-testid': `quota-text-${window.id}`, style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' } }, window.text))
              }
              // 每个窗口：标签+百分比一行 → 独立进度条一行 → 重置倒计时单独一行。
              let resetNode = null
              if (typeof window.resetsAt === 'string') {
                const at = Date.parse(window.resetsAt)
                if (Number.isFinite(at) && at > Date.now()) {
                  resetNode = React.createElement('div', {
                    'data-testid': `quota-reset-${window.id}`,
                    style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' },
                  }, translate('quota.resetIn', { time: humanizeDuration(at - Date.now(), translate) }))
                }
              }
              return React.createElement('div', { key: window.id },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } },
                  React.createElement('span', null, quotaWindowLabel(window.id, translate)),
                  React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' } }, `${window.percent}%`)),
                quotaBar(`quota-window-bar-${window.id}`, window.percent, '4px', window.remaining === true),
                resetNode)
            })),
          ...(Array.isArray(row.resetCards) && row.resetCards.length > 0
            ? [React.createElement('div', { key: 'panel-reset-cards', style: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' } },
                row.resetCards.map((card, cardIndex) => {
                  const content = resetCardContent(card, translate)
                  return React.createElement('div', {
                    key: cardIndex,
                    'data-testid': `quota-panel-reset-card-${cardIndex}`,
                    style: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', lineHeight: '16px', color: content.expired ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-tertiary)' },
                  },
                  React.createElement('span', null, content.title),
                  content.expiry !== '' ? React.createElement('span', null, content.expiry) : null)
                }))]
            : []),
          errorNode,
          updatedNode) : null)
      }

      function QuotaSection() {
        return React.createElement(RemoteQuotaCard, null)
      }

      function RemoteQuotaCard() {
        const translate = useTranslation()
        const [quotaNav, setQuotaNav] = useQuotaNavEnabled()
        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const sectionTitle = { fontSize: '14px', fontWeight: 700, margin: '0 0 8px', color: 'var(--dsw-alias-label-primary)' }
        const [quota, setQuota] = useState(quotaStore.getSnapshot())
        useEffect(() => quotaStore.subscribe(() => setQuota(quotaStore.getSnapshot())), [])
        useEffect(() => {
          acquireQuotaLoop()
          return releaseQuotaLoop
        }, [])
        const [pollMinutes, setPollMinutes] = useState(readQuotaPollMinutes())
        const [configError, setConfigError] = useState('')
        const providers = quota.providers || []
        const [cardEditor, setCardEditor] = useState(null)
        const [cardDraft, setCardDraft] = useState({ remaining: '', expiresAt: '', label: '' })
        const openCardEditor = (row) => {
          const existing = Array.isArray(row.resetCards) && row.resetCards.length > 0 ? row.resetCards[0] : null
          setCardEditor({ provider: row.provider })
          setCardDraft({
            remaining: existing ? String(existing.remaining) : '',
            expiresAt: existing && typeof existing.expiresAt === 'string' ? existing.expiresAt : '',
            label: existing && typeof existing.label === 'string' ? existing.label : '',
          })
        }
        const saveResetCard = async () => {
          if (cardEditor === null) return
          setConfigError('')
          // 空串会被 Number() 静默当 0：必须先显式拦截空白输入。
          const rawCount = typeof cardDraft.remaining === 'string' ? cardDraft.remaining.trim() : cardDraft.remaining
          if (rawCount === '') {
            setConfigError(translate('quota.resetCard.invalidCount'))
            return
          }
          const remaining = Number(rawCount)
          if (!Number.isFinite(remaining) || remaining < 0) {
            setConfigError(translate('quota.resetCard.invalidCount'))
            return
          }
          try {
            const payload = { provider: cardEditor.provider, remaining }
            if (cardDraft.expiresAt !== '') payload.expiresAt = cardDraft.expiresAt
            if (cardDraft.label !== '') payload.label = cardDraft.label
            const res = await ctx.connection.rpc.call('/dsh-service', 'quota-reset-card', payload)
            if (res?.ok !== true) {
              setConfigError(translate('quota.saveFailed', { error: String(res?.error ?? '') }))
              return
            }
            setCardEditor(null)
            await fetchQuotaSnapshot()
          } catch (error) {
            // 不再一律吞成 Network：透出真实错误（unknown endpoint 等），network 仅作兜底。
            const detail = error instanceof Error && typeof error.message === 'string' && error.message.trim() !== '' ? error.message.trim() : 'network'
            setConfigError(translate('quota.saveFailed', { error: detail }))
          }
        }
        const removeResetCard = async () => {
          if (cardEditor === null) return
          setConfigError('')
          try {
            await ctx.connection.rpc.call('/dsh-service', 'quota-reset-card', { provider: cardEditor.provider, remove: true })
            setCardEditor(null)
            await fetchQuotaSnapshot()
          } catch (_) {
            setConfigError(translate('quota.saveFailed', { error: 'network' }))
          }
        }
        const adaptProvider = async (providerName, kind) => {
          setConfigError('')
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'quota-config', { provider: providerName, kind })
            if (res?.ok !== true) {
              setConfigError(res?.error === 'unknown-provider' ? translate('quota.unknownProvider') : translate('quota.saveFailed', { error: String(res?.error ?? '') }))
              return
            }
            await fetchQuotaSnapshot()
          } catch (_) {
            setConfigError(translate('quota.saveFailed', { error: 'network' }))
          }
        }
        return React.createElement('div', { 'data-testid': 'remote-quota-card', style: { marginTop: '18px' } },
          React.createElement('div', { style: sectionTitle }, translate('quota.cardTitle')),
          React.createElement('p', { style: Object.assign({}, hint, { marginTop: '-4px' }) }, translate('quota.hint')),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
            React.createElement('label', { htmlFor: 'dsh-service-quota-poll-select', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, translate('quota.poll')),
            React.createElement('select', {
              id: 'dsh-service-quota-poll-select',
              'data-testid': 'quota-poll-select',
              value: String(pollMinutes),
              onChange: (event) => {
                const value = Number.parseInt(event.target.value, 10)
                if (QUOTA_POLL_CHOICES.includes(value)) {
                  setPollMinutes(value)
                  writeQuotaPollMinutes(value)
                  notifyQuotaPollChanged()
                }
              },
              style: { fontSize: '12px', padding: '3px 6px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
            },
            [{ value: 0, label: translate('quota.poll.manual') }].concat(QUOTA_POLL_CHOICES.filter((choice) => choice > 0).map((choice) => ({ value: choice, label: translate('quota.poll.minute', { count: choice }) }))).map((option) =>
              React.createElement('option', { key: option.value, value: String(option.value) }, option.label)))),
          // 左列入口开关：样式沿用「重启」标签的同款 switch（34×20 胶囊 + 圆点滑块）。
          React.createElement('div', { style: { marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
              React.createElement('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } }, translate('quota.navToggle')),
              React.createElement('span', { style: hint }, translate('quota.navToggleHint'))),
            React.createElement('button', {
              type: 'button',
              role: 'switch',
              'data-testid': 'quota-nav-switch',
              'aria-checked': String(quotaNav),
              onClick: () => setQuotaNav(!quotaNav),
              style: { width: '34px', height: '20px', borderRadius: '10px', padding: 0, flexShrink: 0, position: 'relative', border: `1px solid ${quotaNav ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'}`, background: quotaNav ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: 'pointer', lineHeight: 0 },
            }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: quotaNav ? '15px' : '1px', width: '16px', height: '16px', borderRadius: '50%', background: quotaNav ? '#fff' : 'var(--dsw-alias-label-tertiary)' } }))),
          configError !== '' ? React.createElement('p', { 'data-testid': 'quota-config-error', style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)' }) }, configError) : null,
          providers.length === 0
            ? React.createElement('p', { style: hint }, translate('quota.empty'))
            : React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
                providers.map((row, index) => {
                  const nameNode = React.createElement('span', { style: { fontWeight: 600, fontSize: '12px', overflowWrap: 'anywhere' } },
                    row.displayName || row.provider,
                    row.kindSource === 'auto'
                      ? React.createElement('span', {
                          'data-testid': `quota-auto-tag-${row.provider}`,
                          style: { marginLeft: '6px', fontSize: '10px', padding: '1px 6px', borderRadius: 999, background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-tertiary)', verticalAlign: 'middle' },
                        }, translate('quota.kindAuto'))
                      : null)
                  if (row.adapted !== true) {
                    return React.createElement('div', { key: row.provider, 'data-testid': `quota-row-${row.provider}`, style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 2px', borderTop: index === 0 ? 0 : '1px solid var(--dsw-alias-border-l1)', opacity: 0.62 } },
                      nameNode,
                      React.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginRight: 'auto' } }, translate('quota.unadapted')),
                      React.createElement('select', {
                        'data-testid': `quota-kind-select-${row.provider}`,
                        value: '',
                        'aria-label': `${translate('quota.adapt')} · ${row.displayName || row.provider}`,
                        onChange: (event) => {
                          if (event.target.value !== '') adaptProvider(row.provider, event.target.value)
                        },
                        style: { fontSize: '12px', padding: '3px 6px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
                      },
                      React.createElement('option', { value: '' }, translate('quota.unadapted')),
                      QUOTA_KIND_OPTIONS.map((kind) => React.createElement('option', { key: kind, value: kind }, translate(`quota.kind.${kind}`)))))
                  }
                  const windows = Array.isArray(row.windows) ? row.windows : []
                  // 已适配行：供应商名 + 更新时间一行，下面每个窗口三段式（标签+百分比 / 进度条 / 重置单独一行）。
                  const windowBlocks = windows.map((window) => {
                    if (typeof window.text === 'string') {
                      return React.createElement('div', { key: window.id, 'data-testid': `quota-card-window-${row.provider}-${window.id}`, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', lineHeight: '18px' } },
                        React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, quotaWindowLabel(window.id, translate)),
                        React.createElement('span', { 'data-testid': `quota-card-text-${row.provider}-${window.id}`, style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' } }, window.text))
                    }
                    let resetNode = null
                    if (typeof window.resetsAt === 'string') {
                      const at = Date.parse(window.resetsAt)
                      if (Number.isFinite(at) && at > Date.now()) {
                        resetNode = React.createElement('div', {
                          'data-testid': `quota-card-reset-${row.provider}-${window.id}`,
                          style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' },
                        }, translate('quota.resetIn', { time: humanizeDuration(at - Date.now(), translate) }))
                      }
                    }
                    return React.createElement('div', { key: window.id, 'data-testid': `quota-card-window-${row.provider}-${window.id}` },
                      React.createElement('div', { 'data-value': window.percent, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', lineHeight: '18px' } },
                        React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, quotaWindowLabel(window.id, translate)),
                        React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' } }, `${window.percent}%`)),
                      quotaBar(`quota-card-bar-${row.provider}-${window.id}`, window.percent, '4px', window.remaining === true),
                      resetNode)
                  })
                  let body
                  if (row.refreshing === true && windows.length === 0) {
                    body = React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('quota.refreshing'))
                  } else if (row.errorCode !== undefined && windows.length === 0) {
                    body = React.createElement('span', { 'data-testid': `quota-error-${row.provider}`, style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } },
                      `${quotaErrorMessage(row.errorCode, translate)}${row.errorDetail !== undefined ? ` (${row.errorDetail})` : ''}${typeof row.nextAllowedAt === 'number' && row.nextAllowedAt > Date.now() ? ` · ${translate('quota.retryAt', { time: formatClockTime(row.nextAllowedAt) })}` : ''}`)
                  } else if (windows.length > 0) {
                    // 窗口块之间的留白由列容器统一控制（14px），进度条吃满整行宽度。
                    body = React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, windowBlocks)
                  } else {
                    body = React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('quota.empty'))
                  }
                                    // 手录重置卡（v0.19 过渡方案）：窗口明细下方只读展示剩余次数与到期时间。
                  const resetCardNodes = Array.isArray(row.resetCards)
                    ? row.resetCards.map((card, cardIndex) => {
                        const content = resetCardContent(card, translate)
                        return React.createElement('div', {
                          key: cardIndex,
                          'data-testid': `quota-reset-card-${row.provider}-${cardIndex}`,
                          style: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', lineHeight: '16px', color: content.expired ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-tertiary)' },
                        },
                        React.createElement('span', null, content.title),
                        content.expiry !== '' ? React.createElement('span', null, content.expiry) : null)
                      })
                    : []
                  const editingThis = cardEditor !== null && cardEditor.provider === row.provider
                  const inputStyle = { fontSize: '12px', padding: '3px 6px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', width: '130px' }
                  const resetField = (labelText, testId, type, keyName) => React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                    labelText,
                    React.createElement('input', {
                      type,
                      'data-testid': testId,
                      value: cardDraft[keyName],
                      onChange: (event) => setCardDraft({ ...cardDraft, [keyName]: event.target.value }),
                      style: inputStyle,
                    }))
                  return React.createElement('div', { key: row.provider, 'data-testid': `quota-row-${row.provider}`, style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 2px 12px', borderTop: index === 0 ? 0 : '1px solid var(--dsw-alias-border-l1)' } },
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' } },
                      nameNode,
                      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } },
                        typeof row.fetchedAt === 'number'
                          ? React.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('quota.updated', { time: formatClockTime(row.fetchedAt) }))
                          : null,
                        // 重置卡手动录入目前仅智谱（zai-coding-cn）支持：其余供应商不显示入口。
                        ...(row.kind === 'zai-coding-cn' ? [React.createElement('button', {
                          type: 'button',
                          'data-testid': `quota-card-edit-${row.provider}`,
                          onClick: () => openCardEditor(row),
                          style: { fontSize: '12px', padding: '4px 12px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' },
                        }, translate('quota.resetCard.edit'))] : []))),
                    body,
                    ...resetCardNodes,
                    ...(editingThis ? [React.createElement('div', { key: 'reset-editor', 'data-testid': `quota-reset-editor-${row.provider}`, style: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)' } },
                      resetField(translate('quota.resetCard.countLabel'), 'quota-reset-input-count', 'number', 'remaining'),
                      resetField(translate('quota.resetCard.dateLabel'), 'quota-reset-input-date', 'datetime-local', 'expiresAt'),
                      resetField(translate('quota.resetCard.nameLabel'), 'quota-reset-input-name', 'text', 'label'),
                      React.createElement('button', { type: 'button', 'data-testid': 'quota-reset-card-save', onClick: saveResetCard, style: { minHeight: '28px', padding: '4px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)', color: '#fff', cursor: 'pointer', fontSize: '12px' } }, translate('quota.resetCard.save')),
                      ...(Array.isArray(row.resetCards) && row.resetCards.length > 0 ? [React.createElement('button', { type: 'button', 'data-testid': 'quota-reset-card-remove', onClick: removeResetCard, style: { minHeight: '28px', padding: '4px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-state-error-primary)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer', fontSize: '12px' } }, translate('quota.resetCard.remove'))] : []),
                    )] : []))
                })))
      }

      function ServicePanel() {
        const translate = useTranslation()
        const [health, setHealth] = useState(null)
        const [healthError, setHealthError] = useState(null)
        const [diagnostics, setDiagnostics] = useState(null)
        const [diagnosticsBusy, setDiagnosticsBusy] = useState(false)
        const [diagnosticsLoadedAt, setDiagnosticsLoadedAt] = useState(0)
        const [permissions, setPermissions] = useState(null)
        const [permissionConfirm, setPermissionConfirm] = useState(false)
        const [permissionBusy, setPermissionBusy] = useState(false)
        const [permissionError, setPermissionError] = useState(null)
        const [permissionDetails, setPermissionDetails] = useState(false)
        const [permissionDeep, setPermissionDeep] = useState(null)
        const [permissionDeepBusy, setPermissionDeepBusy] = useState(false)
        const [backups, setBackups] = useState({ items: [], totalBytes: 0 })
        const [backupBusy, setBackupBusy] = useState(false)
        const [backupError, setBackupError] = useState(null)
        const [backupDeleteId, setBackupDeleteId] = useState(null)
        const [backupRestoreId, setBackupRestoreId] = useState(null)
        const [backupExportBusy, setBackupExportBusy] = useState(false)
        const [backupImportBusy, setBackupImportBusy] = useState(false)
        const [backupDetails, setBackupDetails] = useState(false)
        const [version, setVersion] = useState(null)
        const [pluginVersion, setPluginVersion] = useState(null)
        const [updateInfo, setUpdateInfo] = useState(null)
        const [updateError, setUpdateError] = useState(null)
        const [usage, setUsage] = useState(null)
        const [usageBusy, setUsageBusy] = useState(false)
        const [usageError, setUsageError] = useState(null)
        const [upgradeBusy, setUpgradeBusy] = useState(false)
        const [upgradeError, setUpgradeError] = useState(null)
        // 疑似手动启动环境的升级两段式：确认后果 → 仍要升级；成功后不自动退出，改示指引。
        const [upgradeManualConfirm, setUpgradeManualConfirm] = useState(false)
        const [upgradeManualPending, setUpgradeManualPending] = useState(false)
        const [hoveredUsageSegment, setHoveredUsageSegment] = useState(null)
        const [usageProject, setUsageProject] = useState('all')
        const [modelErrorsOpen, setModelErrorsOpen] = useState(false)
        const [toolErrorsOpen, setToolErrorsOpen] = useState(false)
        const [modelsOpen, setModelsOpen] = useState(false)
        const [activeTab, setActiveTab] = useState('overview')
        // 版本详情行内展开（不用浮层：弹层会被设置模态盖住）
        const [channelOpen, setChannelOpen] = useState(false)
        // 重启流程状态来自共享流（与设置页左列底部的专属入口同源）
        const restartFlowState = useRestartFlow()
        const runtimeEnv = useRuntimeEnv()
        const usageRequestPayload = { timezoneOffsetMinutes: new Date().getTimezoneOffset() }

        // 进入面板时拉取当前版本和健康快照；健康数据每 5 秒刷新，卸载即停止。
        // version 走全插件共享的缓存快照：无论哪个挂载点先到，都只有一次请求。
        useEffect(() => {
          fetchVersionSnapshot().then((res) => {
            if (res && res.ok) {
              setVersion(res.value.current)
              setPluginVersion(res.value.pluginVersion || null)
            }
          })
        }, [])
        useEffect(() => {
          let active = true
          ctx.connection.rpc.call('/dsh-service', 'check-update', {}).then((res) => {
            if (!active || !res || res.ok === false) { if (active) setUpdateError(translate('update.unavailable')); return }
            setUpdateInfo(res.value)
            setUpdateError(null)
            setAvailableUpdate(res.value.dsh && !res.value.dsh.upToDate ? res.value.dsh : null)
          }).catch(() => { if (active) setUpdateError(translate('update.unavailable')) })
          return () => { active = false }
        }, [])
        useEffect(() => {
          let active = true
          ctx.connection.rpc.call('/dsh-service', 'permissions-plan', {}).then((res) => {
            if (!active) return
            if (!res || res.ok === false) setPermissionError(translate('permissions.error'))
            else setPermissions(res.value)
          }).catch(() => {
            if (active) setPermissionError(translate('permissions.error'))
          })
          return () => { active = false }
        }, [])
        useEffect(() => {
          let active = true
          ctx.connection.rpc.call('/dsh-service', 'usage', usageRequestPayload).then(async (res) => {
            if (!active) return
            if (!res || res.ok === false) { setUsageError(translate('usage.error')); return }
            setUsage(res.value)
            if (res.value.updatedAt > 0 && Date.now() - res.value.updatedAt <= 300000) return
            try {
              const refreshed = await ctx.connection.rpc.call('/dsh-service', 'usage-refresh', usageRequestPayload)
              if (active && refreshed && refreshed.ok) setUsage(refreshed.value)
            } catch (_) {}
          }).catch(() => {
            if (active) setUsageError(translate('usage.error'))
          })
          return () => { active = false }
        }, [])
        useEffect(() => {
          let active = true
          ctx.connection.rpc.call('/dsh-service', 'backup-list', {}).then((res) => {
            if (!active) return
            if (!res || res.ok === false) setBackupError(translate('backup.error'))
            else setBackups(res.value)
          }).catch(() => {
            if (active) setBackupError(translate('backup.error'))
          })
          return () => { active = false }
        }, [])
        useEffect(() => {
          let active = true
          let cancelNext = () => {}
          const poll = async () => {
            try {
              const res = await ctx.connection.rpc.call('/dsh-service', 'health', {})
              if (!active) return
              if (!res || res.ok === false) throw new Error(res && res.error ? res.error : 'health failed')
              setHealth(res.value)
              setHealthError(null)
            } catch (_) {
              if (!active) return
              setHealthError(translate('health.error'))
            }
            if (active) cancelNext = ctx.timer.timeout(poll, 5000)
          }
          poll()
          return () => {
            active = false
            cancelNext()
          }
        }, [])

        const runDiagnostics = async (force = false) => {
          if (!force && diagnosticsLoadedAt > 0 && Date.now() - diagnosticsLoadedAt <= 30000) return
          setDiagnosticsBusy(true)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'diagnostics', {})
            if (!res || res.ok === false) throw new Error('diagnostics failed')
            setDiagnostics(res.value)
            setDiagnosticsLoadedAt(Date.now())
          } catch (_) {
            setHealthError(translate('health.error'))
          } finally {
            setDiagnosticsBusy(false)
          }
        }

        const refreshUsage = async () => {
          setUsageBusy(true)
          setUsageError(null)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'usage-refresh', usageRequestPayload)
            if (!res || res.ok === false) throw new Error('usage refresh failed')
            setUsage(res.value)
          } catch (_) {
            setUsageError(translate('usage.error'))
          } finally {
            setUsageBusy(false)
          }
        }

        const deepCheckPermissions = async () => {
          if (!permissions || permissions.supported !== true) return
          setPermissionDeepBusy(true)
          setPermissionError(null)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'permissions-deep', { planId: permissions.planId })
            if (!res || res.ok === false) throw new Error('deep permission check failed')
            setPermissionDeep(res.value)
          } catch (_) {
            setPermissionError(translate('permissions.error'))
          } finally {
            setPermissionDeepBusy(false)
          }
        }

        const repairPermissions = async () => {
          if (!permissions || permissions.supported !== true) return
          setPermissionBusy(true)
          setPermissionError(null)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'permissions-repair', { planId: permissions.planId })
            if (!res || res.ok === false) throw new Error('permission repair failed')
            setPermissions(res.value)
            setPermissionConfirm(false)
          } catch (_) {
            setPermissionError(translate('permissions.error'))
          } finally {
            setPermissionBusy(false)
          }
        }

        const createBackup = async () => {
          setBackupBusy(true)
          setBackupError(null)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'backup-create', {})
            if (!res || res.ok === false) throw new Error('backup failed')
            setBackups({ items: res.value.items, totalBytes: res.value.totalBytes })
          } catch (_) {
            setBackupError(translate('backup.error'))
          } finally {
            setBackupBusy(false)
          }
        }

        const deleteBackup = async (id) => {
          setBackupBusy(true)
          setBackupError(null)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'backup-delete', { id })
            if (!res || res.ok === false) throw new Error('backup failed')
            setBackups(res.value)
            setBackupDeleteId(null)
          } catch (_) {
            setBackupError(translate('backup.error'))
          } finally {
            setBackupBusy(false)
          }
        }

        const exportBackup = async (id) => {
          setBackupExportBusy(true)
          setBackupError(null)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'backup-export', { id })
            if (!res || res.ok === false) throw new Error('export failed')
            const a = document.createElement('a')
            a.href = res.value.url
            a.download = res.value.name
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
          } catch (_) {
            setBackupError(translate('backup.exportError'))
          } finally {
            setBackupExportBusy(false)
          }
        }

        const restoreBackup = async (id) => {
          setBackupBusy(true)
          setBackupError(null)
          try {
            const versionRes = await ctx.connection.rpc.call('/dsh-service', 'version', {})
            const previousInstanceId = versionRes && versionRes.ok ? versionRes.value.instanceId : undefined
            const res = await ctx.connection.rpc.call('/dsh-service', 'backup-restore', { id })
            if (!res || res.ok === false) throw new Error('backup restore failed')
            setBackupRestoreId(null)
            if (typeof previousInstanceId === 'string' && previousInstanceId.length > 0) {
              startRecovery(previousInstanceId).catch(() => {})
            }
          } catch (_) {
            setBackupError(translate('backup.restoreError'))
          } finally {
            setBackupBusy(false)
          }
        }

         const importBackup = (event) => {
           const file = event.target.files && event.target.files[0]
           event.target.value = ''
           if (!file) return
           setBackupImportBusy(true)
           setBackupError(null)
           const reader = new FileReader()
           reader.onload = async () => {
             try {
               const bytes = new Uint8Array(reader.result)
               let binary = ''
               for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
               const res = await ctx.connection.rpc.call('/dsh-service', 'backup-import', { name: file.name, data: btoa(binary) })
               if (!res || res.ok === false) throw new Error('backup import failed')
               setBackups(res.value)
             } catch (_) {
               setBackupError(translate('backup.error'))
             } finally {
               setBackupImportBusy(false)
             }
           }
           reader.onerror = () => {
             setBackupImportBusy(false)
             setBackupError(translate('backup.error'))
           }
           reader.readAsArrayBuffer(file)
         }

        // 宿主返回的稳定失败码 → 词典文案；未知错误详情（如 dsh-failed: …）透出原文。
        const UPGRADE_FAILURES = {
          'active-work': 'update.guardActiveWork',
          'link-install': 'update.guardLinkInstall',
          'file-install': 'update.guardFileInstall',
          'no-newer-version': 'update.guardNoNewer',
          'no-profile-found': 'update.guardNoProfile',
          'ambiguous-profile': 'update.guardAmbiguous',
          'upgrade-stale': 'update.guardStale',
          'installed-version-unreadable': 'update.guardUnreadable',
          'pnpm-missing': 'update.failPnpmMissing',
          'transient-network': 'update.failNetwork',
          'fetch-timeout': 'update.failFetchTimeout',
          'release-age-violation': 'update.failReleaseAge',
          'hoist-pattern-diff': 'update.failHoist',
          'adding-to-root': 'update.failAddingToRoot',
          'not-a-workspace': 'update.failNotWorkspace',
          'ignored-builds': 'update.failIgnoredBuilds',
        }
        const upgradePlugin = async () => {
          if (upgradeInFlight) return
          upgradeInFlight = true
          try {
            // check-update 先于 version 返回时按钮可能先出现：env 未知就等共享快照落地再判。
            let env = runtimeEnv
            if (env === null) {
              await fetchVersionSnapshot()
              env = runtimeEnvState
            }
            // 疑似终端手动启动：升级成功不会自动重启，先两段式确认后果再动手（安全教义）。
            if (!upgradeManualConfirm && env !== null && env.manualStartLikely === true) {
              setUpgradeError(null)
              setUpgradeManualConfirm(true)
              return
            }
            setUpgradeManualConfirm(false)
            setUpgradeBusy(true)
            setUpgradeError(null)
            const versionRes = await fetchVersionSnapshot()
            const previousInstanceId = versionRes && versionRes.ok ? versionRes.value.instanceId : undefined
            const res = await ctx.connection.rpc.call('/dsh-service', 'upgrade', {})
            if (!res || res.ok === false) {
              const code = res && typeof res.error === 'string' ? res.error.trim() : ''
              const mapped = typeof code === 'string' && code.length > 0 ? UPGRADE_FAILURES[code] : undefined
              // 已知失败码走双语词典；其余（如 npm-failed: …、dsh-failed: …）随通用文案透出宿主错误详情。
              if (mapped !== undefined) {
                setUpgradeError(translate(mapped))
              } else {
                setUpgradeError(translate('update.upgradeErrorDetail', { detail: code || 'upgrade failed' }))
              }
              return
            }
            if (res.value && res.value.requiresManualRestart === true) {
              // 宿主保持运行（没有 exit，就不会有新实例）：不启动恢复轮询，改示手动重启指引。
              setUpgradeManualPending(true)
              return
            }
            if (typeof previousInstanceId === 'string' && previousInstanceId.length > 0) {
              startRecovery(previousInstanceId).catch(() => {})
            }
          } catch (err) {
            const detail = err instanceof Error && typeof err.message === 'string' && err.message !== 'upgrade failed' ? err.message.trim() : ''
            console.error('dsh-service: upgrade failed', detail || err)
            setUpgradeError(detail ? translate('update.upgradeErrorDetail', { detail }) : translate('update.upgradeError'))
          } finally {
            upgradeInFlight = false
            setUpgradeBusy(false)
          }
        }

        // 样式
        const btn = { minHeight: '32px', padding: '6px 14px', borderRadius: '7px', border: '1px solid transparent', cursor: 'pointer', fontSize: '13px', fontWeight: 550, transition: 'border-color 120ms ease, color 120ms ease, background 120ms ease', lineHeight: '20px' }
        const primary      = { ...btn, background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-button-contrast-fill)', borderColor: 'var(--dsw-alias-brand-primary)' }
        const secondary    = { ...btn, background: 'transparent', color: 'var(--dsw-alias-brand-primary)', borderColor: 'var(--dsw-alias-brand-primary)' }
        const neutral      = { ...btn, background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', borderColor: 'var(--dsw-alias-border-l2)' }
        const danger       = { ...btn, background: 'var(--dsw-alias-state-error-primary)', color: '#fff', borderColor: 'var(--dsw-alias-state-error-primary)' }
        const dangerGhost  = { ...btn, background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' }
        const ghost        = { ...btn, background: 'transparent', color: 'var(--dsw-alias-label-primary)', borderColor: 'var(--dsw-alias-border-l2)' }
        const toggle = Object.assign({}, btn, { background: 'transparent', color: 'var(--dsw-alias-label-primary)', border: 0, borderTop: '1px solid var(--dsw-alias-border-l1)', borderRadius: 0, padding: '10px 2px', width: '100%', textAlign: 'left', fontWeight: 600 })
        const row = { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }
        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const card = { padding: '4px 0 14px', marginBottom: '12px', color: 'var(--dsw-alias-label-primary)' }
        const displaySurface = { background: 'var(--dsh-svc-surface-bg)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '10px' }
        const tabPanel = { padding: '14px 2px 2px', color: 'var(--dsw-alias-label-primary)' }
        const inlineTab = { background: 'transparent', color: 'var(--dsw-alias-label-secondary)', border: 0, borderBottom: '2px solid transparent', padding: '8px 10px', cursor: 'pointer', fontSize: '13px', fontWeight: 550, transition: 'color 120ms, border-color 120ms' }
        const inlineTabActive = { color: 'var(--dsw-alias-brand-primary)', borderBottom: '2px solid var(--dsw-alias-brand-primary)', fontWeight: 700 }
        const sectionTitle = { fontSize: '14px', fontWeight: 700, margin: '0 0 8px', color: 'var(--dsw-alias-label-primary)' }

        const formatSize = (bytes) => {
          const value = Number(bytes)
          if (value < 1024) return value + ' B'
          if (value < 1024 * 1024) return (Math.round(value / 102.4) / 10) + ' KB'
          if (value < 1024 * 1024 * 1024) return (Math.round(value / (1024 * 1024) * 10) / 10) + ' MB'
          return (Math.round(value / (1024 * 1024 * 1024) * 10) / 10) + ' GB'
        }
        const formatUptime = (seconds) => {
          const totalMinutes = Math.floor(Number(seconds) / 60)
          return translate('health.uptimeValue', {
            hours: Math.floor(totalMinutes / 60),
            minutes: totalMinutes % 60,
          })
        }
        const formatBytes = (bytes) => {
          const mb = Number(bytes) / (1024 * 1024)
          return (Math.round(mb * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' MB'
        }
        const metric = (labelKey, value) => React.createElement('div', {
          key: labelKey,
          style: { padding: '8px 10px', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)' },
        },
        React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', marginBottom: '2px' } }, translate(labelKey)),
        React.createElement('div', { style: { fontSize: '14px', fontWeight: 600 } }, value))
        const dateKey = (date) => {
          const digits = (value) => String(value).padStart(2, '0')
          return `${date.getFullYear()}-${digits(date.getMonth() + 1)}-${digits(date.getDate())}`
        }
        const usageDays = []
        for (let offset = 6; offset >= 0; offset -= 1) {
          const date = new Date()
          date.setHours(0, 0, 0, 0)
          date.setDate(date.getDate() - offset)
          usageDays.push({ key: dateKey(date), label: `${date.getMonth() + 1}/${date.getDate()}` })
        }
        const usageSegments = [
          ['inputTokens', 'usage.input', '#79aaf7'],
          ['outputTokens', 'usage.output', '#f1b35b'],
          ['cacheTokens', 'usage.cache', '#48c7b0'],
        ]
        const usageTotalsFor = (day) => {
          const source = usage && usage.days ? usage.days[day] : null
          if (!source) return { steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: 0 }
          if (usageProject === 'all') return source.totals
          const project = source.projects.find((item) => item.id === usageProject)
          return project ? project.totals : { steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: 0 }
        }
        const modelCacheHitRate = (model) => {
           const denominator = Number(model.inputTokens || 0) + Number(model.cacheReadTokens || 0) + Number(model.cacheWriteTokens || 0)
           return denominator === 0 ? 0 : Number(model.cacheReadTokens || 0) / denominator
         }
         const modelTotalTokens = (model) => Number(model.inputTokens || 0) + Number(model.outputTokens || 0) + Number(model.cacheReadTokens || 0) + Number(model.cacheWriteTokens || 0)
         const modelSegmentValue = (model, metric) => metric === 'cacheTokens'
           ? Number(model.cacheReadTokens || 0) + Number(model.cacheWriteTokens || 0)
           : Number(model[metric] || 0)
         const usageValue = (totals, metricName) => metricName === 'cacheTokens'
          ? totals.cacheReadTokens + totals.cacheWriteTokens
          : totals[metricName] || 0
        const formatTokenValue = (value) => {
          const number = Number(value) || 0
          if (number >= 1000000) return `${Math.round(number / 100000) / 10}M`
          if (number >= 1000) return `${Math.round(number / 100) / 10}K`
          return number.toLocaleString()
        }
        const formatUsageValue = (value, metricName) => metricName === 'cacheHitRate'
          ? (Number(value) * 100).toFixed(1) + '%'
          : metricName === 'steps'
            ? translate('usage.stepsValue', { count: Number(value).toLocaleString() })
            : formatTokenValue(value)
        const chartTotals = usageDays.map((day) => usageTotalsFor(day.key))
        const chartValues = chartTotals.map((totals) => usageSegments.reduce((sum, [metricName]) => sum + usageValue(totals, metricName), 0))
        const chartMax = Math.max(1, ...chartValues)
        const chartTicks = [chartMax, chartMax * 0.75, chartMax * 0.5, chartMax * 0.25, 0]
        const todayTotals = usageTotalsFor(usageDays[6].key)
        const sevenTotals = usageDays.reduce((total, day) => {
          const source = usageTotalsFor(day.key)
          total.steps += source.steps || 0
          total.inputTokens += source.inputTokens || 0
          total.outputTokens += source.outputTokens || 0
          total.cacheReadTokens += source.cacheReadTokens || 0
          total.cacheWriteTokens += source.cacheWriteTokens || 0
          return total
        }, { steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
        const sevenDenominator = sevenTotals.inputTokens + sevenTotals.cacheReadTokens + sevenTotals.cacheWriteTokens
        sevenTotals.cacheHitRate = sevenDenominator === 0 ? 0 : sevenTotals.cacheReadTokens / sevenDenominator
        const selectedProjects = usageProject === 'all'
          ? (usage?.projects || []).map((project) => project.id)
          : [usageProject]
        const modelTotals = new Map()
        for (const day of usageDays) {
          const source = usage?.days?.[day.key]
          if (!source) continue
          for (const project of source.projects) {
            if (!selectedProjects.includes(project.id)) continue
            for (const model of project.models) {
              const existing = modelTotals.get(model.id) || { id: model.id, steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
              existing.steps += model.totals.steps || 0
              existing.inputTokens += model.totals.inputTokens || 0
              existing.outputTokens += model.totals.outputTokens || 0
              existing.cacheReadTokens += model.totals.cacheReadTokens || 0
              existing.cacheWriteTokens += model.totals.cacheWriteTokens || 0
              modelTotals.set(model.id, existing)
            }
          }
        }
        const diagnosticDetail = (check) => {
          const detail = String(check.detail ?? '')
          if (check.id === 'session-storage' && check.status === 'ok') return translate('health.detail.session-storage.ok', { count: detail })
          if (check.id === 'workspace-registry' && check.status === 'ok') return translate('health.detail.workspace-registry.ok', { count: detail })
          if (check.id === 'dsh-home' && check.status === 'ok') return translate('health.detail.dsh-home.ok', { mode: detail })
          if (check.id === 'backup-storage') {
            const [count = '0', size = '0'] = detail.split(':')
            return Number(count) === 0
              ? translate('health.detail.backup-storage.empty')
              : translate('health.detail.backup-storage.ok', { count, size: formatSize(size) })
          }
          if (check.id === 'tar' && check.status === 'ok') return translate('health.detail.tar.ok')
          if (check.id === 'permissions') return translate(check.status === 'ok' ? 'health.detail.permissions.ok' : 'health.detail.permissions.warning', { count: detail || '0' })
          if (check.id === 'runtime-env') {
            if (detail === 'manual') return translate('health.detail.runtime-env.manual')
            if (detail === 'declared') return translate('health.detail.runtime-env.declared')
            if (detail === 'unknown') return translate('health.detail.runtime-env.unknown')
            // 已识别的管理器 kind：复用概览运行环境的标签词典。
            return translate('health.detail.runtime-env.managed', { kind: translate(`env.kind.${detail}`) })
          }
          if (check.id === 'node-version') {
            const [version = '', required = ''] = detail.split(':')
            return translate(check.status === 'ok' ? 'health.detail.node-version.ok' : 'health.detail.node-version.warning', { version, required })
          }
          return translate('health.detail.generic', { status: translate(`health.status.${check.status}`) })
        }
        const summaryItems = (totals) => [
          ['usage.total', formatTokenValue(usageValue(totals, 'inputTokens') + usageValue(totals, 'outputTokens') + usageValue(totals, 'cacheTokens'))],
          ...usageSegments.map(([metricName, label]) => [label, formatTokenValue(usageValue(totals, metricName))]),
          ['usage.steps', formatUsageValue(totals.steps, 'steps')],
          ['usage.hitRate', formatUsageValue(totals.cacheHitRate, 'cacheHitRate')],
        ]
        const summaryBlock = (id, title, totals) => React.createElement('div', { style: { padding: '10px', borderRadius: '7px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' } },
          React.createElement('div', { style: { fontSize: '12px', fontWeight: 700, marginBottom: '5px' } }, translate(title)),
          summaryItems(totals).map(([label, value], index) => React.createElement('div', { key: label, 'data-testid': `usage-summary-${id}-${index}`, style: { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '4px 0', fontSize: '12px', borderTop: index === 0 ? 0 : '1px solid var(--dsw-alias-border-l1)' } },
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, translate(label)),
            React.createElement('span', { style: { fontWeight: 650 } }, value)))
        )
        const sortedModels = [...modelTotals.values()].sort((a, b) => modelTotalTokens(b) - modelTotalTokens(a) || b.steps - a.steps || a.id.localeCompare(b.id))
        const visibleModels = modelsOpen ? sortedModels : sortedModels.slice(0, 3)
        const hiddenModelCount = Math.max(0, sortedModels.length - 3)
        const maxModelTokens = Math.max(1, ...visibleModels.map((model) => modelTotalTokens(model)))
        const selectedErrors = (list) => (list || [])
          .filter((error) => usageProject === 'all' || error.projectId === usageProject)
          .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
        const modelErrors = selectedErrors(usage?.errors?.models)
        const toolErrors = selectedErrors(usage?.errors?.tools)
        const errorList = (kind, errors) => React.createElement('div', { key: kind, style: { display: 'grid', gap: '6px', marginTop: '8px' } },
          errors.length === 0
            ? React.createElement('p', { style: hint }, translate(kind === 'model' ? 'usage.errors.empty' : 'usage.toolErrors.empty'))
            : errors.map((failure) => React.createElement('div', { key: `${kind}:${failure.projectId}:${failure.key}`, style: { padding: '8px 10px', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-label-primary)', fontSize: '12px' } },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', fontWeight: 600 } },
                  React.createElement('span', null, kind === 'model'
                    ? `${failure.provider}/${failure.model} · ${failure.code}${failure.status === null ? '' : ` · ${failure.status}`}`
                    : `${failure.tool} · ${failure.code}`),
                  React.createElement('span', null, translate('usage.errors.count', { count: failure.count }))),
                React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginTop: '3px', overflowWrap: 'anywhere' } }, failure.message))))
        const usageBlock = React.createElement('div', { key: 'usage-section', 'data-testid': 'usage-card', style: card },
          React.createElement('div', { style: sectionTitle }, translate('usage.structure')),
          React.createElement('p', { style: Object.assign({}, hint, { marginTop: '-4px' }) }, translate('usage.structureHint')),
          usage && usage.projects.length > 0
            ? React.createElement('div', { 'data-testid': 'usage-project-tabs', style: { display: 'flex', flexWrap: 'wrap', gap: '14px', marginBottom: '12px', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
                React.createElement('button', { style: Object.assign({}, inlineTab, usageProject === 'all' ? inlineTabActive : { color: 'var(--dsw-alias-label-secondary)', borderBottom: '2px solid transparent' }), onClick: () => setUsageProject('all') }, translate('usage.allProjects')),
                usage.projects.map((project) => React.createElement('button', { key: project.id, style: Object.assign({}, inlineTab, usageProject === project.id ? inlineTabActive : { color: 'var(--dsw-alias-label-secondary)', borderBottom: '2px solid transparent' }), onClick: () => setUsageProject(project.id) }, project.title)))
            : null,
          usage && usage.indexedSessions > 0
            ? React.createElement('div', { 'data-testid': 'usage-statistics-region', style: Object.assign({}, displaySurface, { padding: '12px', borderRadius: '9px' }) },
                React.createElement('div', { 'data-testid': 'usage-chart', style: { position: 'relative', display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr)', height: '180px', padding: '12px 10px 4px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
                  React.createElement('div', { 'data-testid': 'usage-y-axis', 'aria-label': translate('usage.axis'), style: { position: 'relative', height: '144px', fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } },
                    chartTicks.map((tick, index) => React.createElement('span', { key: index, style: { position: 'absolute', right: '7px', top: `${index * 25}%`, transform: index === 4 ? 'translateY(-100%)' : 'translateY(-50%)' } }, formatTokenValue(tick)))),
                  React.createElement('div', { 'data-testid': 'usage-plot', style: { position: 'relative', height: '164px' } },
                    React.createElement('div', { style: { position: 'absolute', inset: '0 0 20px', display: 'flex', alignItems: 'end', gap: '8px', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
                      chartTicks.map((_, index) => React.createElement('div', { key: index, 'data-testid': `usage-grid-${index}`, style: { position: 'absolute', left: 0, right: 0, top: `${index * 25}%`, borderTop: '1px solid var(--dsw-alias-border-l1)', pointerEvents: 'none' } })),
                      usageDays.map((day, index) => React.createElement('div', { key: day.key, style: { position: 'relative', zIndex: 1, flex: 1, minWidth: 0, alignSelf: 'end' } },
                        React.createElement('div', { 'data-testid': `usage-bar-${day.key}`, style: { height: `${Math.max(2, chartValues[index] / chartMax * 144)}px`, display: 'flex', flexDirection: 'column-reverse', justifyContent: 'flex-start', borderRadius: '4px 4px 0 0', overflow: 'hidden' } },
                          usageSegments.map(([metricName, label, color]) => {
                            const value = usageValue(chartTotals[index], metricName)
                            const segmentHeight = chartValues[index] === 0 ? 0 : value / chartValues[index] * 100
                            const segmentId = `${day.key}-${metricName}`
                            const active = hoveredUsageSegment && hoveredUsageSegment.id === segmentId
                            return React.createElement('div', {
                              key: metricName,
                              'data-testid': `usage-segment-${segmentId}`,
                              'data-value': value,
                              onMouseEnter: (event) => setHoveredUsageSegment({ id: segmentId, date: day.key, totals: chartTotals[index], x: event.clientX, y: event.clientY }),
                              onMouseMove: (event) => setHoveredUsageSegment((current) => current && current.id === segmentId ? Object.assign({}, current, { x: event.clientX, y: event.clientY }) : current),
                              onMouseLeave: () => setHoveredUsageSegment(null),
                              style: { height: `${segmentHeight}%`, minHeight: value > 0 ? '2px' : 0, background: color, opacity: hoveredUsageSegment && !active ? 0.42 : 1, cursor: value > 0 ? 'pointer' : 'default', transition: 'opacity 120ms ease' },
                            })
                          }))))),
                    React.createElement('div', { 'data-testid': 'usage-x-axis', style: { position: 'absolute', left: 0, right: 0, bottom: '0', height: '20px', display: 'flex', gap: '8px', alignItems: 'end' } },
                      usageDays.map((day) => React.createElement('div', { key: day.key, style: { flex: 1, minWidth: 0, textAlign: 'center', fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } }, day.label))))),
                React.createElement('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '8px', fontSize: '11px' } },
                  usageSegments.map(([, label, color]) => React.createElement('span', { key: label, style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } },
                    React.createElement('span', { style: { width: '9px', height: '9px', borderRadius: '2px', background: color } }),
                    translate(label)))),
                hoveredUsageSegment ? React.createElement('div', { 'data-testid': 'usage-tooltip', style: { position: 'fixed', left: `${hoveredUsageSegment.x + 12}px`, top: `${hoveredUsageSegment.y + 12}px`, zIndex: 1000, pointerEvents: 'none', padding: '7px 9px', borderRadius: '6px', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontSize: '12px', fontWeight: 600, whiteSpace: 'pre-line', textAlign: 'left' } }, `${translate('usage.tooltip.date', { date: hoveredUsageSegment.date })}\n${translate('usage.tooltip.input', { value: Number(hoveredUsageSegment.totals.inputTokens || 0).toLocaleString() })}\n${translate('usage.tooltip.output', { value: Number(hoveredUsageSegment.totals.outputTokens || 0).toLocaleString() })}\n${translate('usage.tooltip.cache', { value: Number((hoveredUsageSegment.totals.cacheReadTokens || 0) + (hoveredUsageSegment.totals.cacheWriteTokens || 0)).toLocaleString() })}`) : null,
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', marginTop: '10px' } },
                  summaryBlock('today', 'usage.today', todayTotals),
                  summaryBlock('seven', 'usage.sevenDays', sevenTotals)),
                React.createElement('div', { 'data-testid': 'usage-model-list', style: { marginTop: '10px', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)' } },
                  React.createElement('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '4px' } }, translate('usage.modelSortHint')),
                  visibleModels.map((model, index) => {
                    const total = modelTotalTokens(model)
                    const fillWidth = `${Math.round(total / maxModelTokens * 10000) / 100}%`
                    return React.createElement('div', { key: model.id, 'data-testid': `usage-model-row-${model.id}`, style: { padding: '8px 2px', borderTop: index === 0 ? 0 : '1px solid var(--dsw-alias-border-l1)' } },
                      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline', fontSize: '12px' } },
                        React.createElement('span', { style: { overflowWrap: 'anywhere' } }, model.id),
                        React.createElement('span', { style: { fontWeight: 650, whiteSpace: 'nowrap' } }, formatTokenValue(total))),
                      React.createElement('div', { 'data-testid': `usage-model-bar-${model.id}`, 'data-value': total, 'aria-label': translate('usage.modelBar', { model: model.id, total: formatTokenValue(total) }), style: { height: '8px', borderRadius: '4px', marginTop: '6px', overflow: 'hidden', background: 'var(--dsw-alias-border-l1)' } },
                        React.createElement('div', { style: { display: 'flex', height: '100%', width: fillWidth } },
                          usageSegments.map(([metricName, , color]) => {
                            const value = modelSegmentValue(model, metricName)
                            return value > 0 ? React.createElement('div', { key: metricName, 'data-testid': `usage-model-segment-${model.id}-${metricName}`, style: { width: `${value / total * 100}%`, background: color } }) : null
                          }))),
                      React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', marginTop: '4px', textAlign: 'right' } }, translate('usage.modelLine', {
                        steps: Number(model.steps || 0).toLocaleString(),
                        hitRate: formatUsageValue(modelCacheHitRate(model), 'cacheHitRate'),
                        input: formatTokenValue(model.inputTokens),
                        output: formatTokenValue(model.outputTokens),
                      })))
                  }),
                  hiddenModelCount > 0 ? React.createElement('button', { style: Object.assign({}, toggle, { borderTop: '1px solid var(--dsw-alias-border-l1)', marginTop: '2px' }), onClick: () => setModelsOpen((value) => !value) }, `${modelsOpen ? '▾' : '▸'} ${translate(modelsOpen ? 'usage.models.less' : 'usage.models.more', { count: hiddenModelCount })}`) : null))
            : React.createElement('p', { style: hint }, usageError || translate('usage.empty')),
          React.createElement('div', { style: row }, React.createElement('button', { style: neutral, 'data-variant': 'neutral', onClick: refreshUsage, disabled: usageBusy }, translate(usageBusy ? 'usage.refreshing' : 'usage.refresh'))))

        // 平台标签：process.platform 映射为常见系统名，arch 跟在后面（均为专有名词，不走词典）。
        const platformNames = { win32: 'Windows', darwin: 'macOS', linux: 'Linux', freebsd: 'FreeBSD', openbsd: 'OpenBSD' }
        const platformLabel = (health && typeof health.platform === 'string' && health.platform)
          ? `${platformNames[health.platform] || health.platform}${typeof health.arch === 'string' && health.arch ? ` · ${health.arch}` : ''}`
          : '—'
        const containerInfoBlock = React.createElement('div', { key: 'container-info', style: { marginTop: '18px' } },
          React.createElement('div', { style: sectionTitle }, translate('overview.container')),
          health
            ? React.createElement('div', { 'data-testid': 'health-display', style: Object.assign({}, displaySurface, { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }) },
                metric('health.platform', platformLabel),
                metric('health.nodeVersion', typeof health.nodeVersion === 'string' && health.nodeVersion ? health.nodeVersion : '—'),
                metric('health.uptime', formatUptime(health.uptimeSeconds)),
                metric('health.rss', formatBytes(health.rssBytes)),
                metric('health.liveSessions', String(health.liveSessions)),
                metric('health.persistedSessions', String(health.persistedSessions)),
                metric('health.activeAgents', String(health.activeAgents)),
                metric('health.activeJobs', String(health.activeJobs)))
            : React.createElement('p', { style: hint }, healthError || translate('version.loading')))
        const overviewErrorsBlock = React.createElement('div', { key: 'overview-errors', style: { marginTop: '18px' } },
          React.createElement('div', { 'data-testid': 'overview-errors-title', style: sectionTitle }, translate('overview.errors')),
          React.createElement('div', { 'data-testid': 'overview-errors-region', style: displaySurface },
            React.createElement('div', { style: Object.assign({}, hint, { margin: '-3px 0 7px' }) }, translate('usage.errors.recent')),
            React.createElement('div', { style: { display: 'grid', gap: '7px' } },
              React.createElement('div', null,
                React.createElement('button', { style: toggle, onClick: () => setModelErrorsOpen((value) => !value) }, `${modelErrorsOpen ? '▾' : '▸'} ${translate('usage.errors.toggle', { count: modelErrors.length })}`),
                modelErrorsOpen ? React.createElement('div', { style: { padding: '0 2px 8px' } }, errorList('model', modelErrors)) : null),
              React.createElement('div', null,
                React.createElement('button', { style: toggle, onClick: () => setToolErrorsOpen((value) => !value) }, `${toolErrorsOpen ? '▾' : '▸'} ${translate('usage.toolErrors.toggle', { count: toolErrors.length })}`),
                toolErrorsOpen ? React.createElement('div', { style: { padding: '0 2px 8px' } }, errorList('tool', toolErrors)) : null))))
        const healthSummaryBlock = React.createElement('div', { 'data-testid': 'health-diagnostics-region', style: displaySurface },
          React.createElement('div', { style: row }, React.createElement('button', { style: neutral, 'data-variant': 'neutral', onClick: () => runDiagnostics(true), disabled: diagnosticsBusy }, translate(diagnosticsBusy ? 'health.checking' : diagnostics ? 'health.recheck' : 'health.check'))),
          diagnostics && diagnostics.status !== 'ok'
            ? React.createElement('div', { style: { marginTop: '10px', padding: '9px 11px', borderRadius: '7px', background: diagnostics.status === 'error' ? 'rgba(211,51,51,0.1)' : 'rgba(198,128,0,0.12)', border: `1px solid ${diagnostics.status === 'error' ? 'rgba(211,51,51,0.3)' : 'rgba(198,128,0,0.3)'}` } },
                React.createElement('div', { style: { fontSize: '12px', fontWeight: 700 } }, translate('health.alert.title')),
                React.createElement('div', { style: hint }, translate('health.alert.diagnostics', { status: translate(`health.overall.${diagnostics.status}`) })))
            : null,
          diagnostics
            ? React.createElement('div', { 'data-testid': 'health-check-list', style: Object.assign({}, displaySurface, { marginTop: '10px', padding: '8px 10px' }) },
                diagnostics.checks.map((check, index) => React.createElement('div', { key: check.id, style: { display: 'flex', justifyContent: 'space-between', gap: '14px', fontSize: '12px', padding: '9px 2px', borderTop: index === 0 ? 0 : '1px solid var(--dsw-alias-border-l1)' } },
                  React.createElement('span', null, translate(`health.check.${check.id}`)),
                  React.createElement('span', { style: { color: check.status === 'ok' ? 'var(--dsw-alias-state-success-primary)' : check.status === 'warning' ? 'var(--dsw-alias-state-warn-primary)' : check.status === 'info' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-error-primary)', textAlign: 'right' } }, diagnosticDetail(check)))))
            : null)

        const permissionAbnormal = permissions && permissions.supported === true
          ? permissions.items.filter((item) => item.writable === false).length
          : 0
        const permissionNeedsRepair = permissionAbnormal > 0 || (permissionDeep && (permissionDeep.ownerIssues > 0 || permissionDeep.directoryModeIssues > 0 || permissionDeep.fileModeIssues > 0 || permissionDeep.unreadable > 0))
        const permissionBlock = permissions && permissions.supported === true
          ? React.createElement('div', { key: 'permissions-section', style: { marginTop: '18px' } },
              React.createElement('div', { style: sectionTitle }, translate('permissions.title')),
              React.createElement('div', { style: Object.assign({}, displaySurface, { marginTop: '4px' }) },
              React.createElement('p', { style: hint }, translate('permissions.description')),
              permissionAbnormal > 0 ? React.createElement('div', { style: { marginTop: '8px', padding: '9px 11px', borderRadius: '7px', background: 'rgba(198,128,0,0.12)', border: '1px solid rgba(198,128,0,0.3)' } },
                React.createElement('div', { style: { fontSize: '12px', fontWeight: 700 } }, translate('health.alert.title')),
                React.createElement('div', { style: hint }, translate('permissions.summary.warning', { count: permissionAbnormal }))) : null,
              React.createElement('p', { style: Object.assign({}, hint, { fontWeight: 600, color: permissionAbnormal > 0 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-primary)' }) }, translate(permissionAbnormal > 0 ? 'permissions.summary.warning' : 'permissions.summary.ok', { count: permissionAbnormal > 0 ? permissionAbnormal : permissions.items.length })),
              React.createElement('p', { style: Object.assign({}, hint, { fontWeight: 600 }) }, translate('permissions.target', { owner: permissions.targetOwner })),
              React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                React.createElement('button', { style: neutral, onClick: () => setPermissionDetails((value) => !value) }, translate(permissionDetails ? 'permissions.hideDetails' : 'permissions.showDetails')),
                React.createElement('button', { style: neutral, 'data-variant': 'neutral', onClick: deepCheckPermissions, disabled: permissionDeepBusy }, translate(permissionDeepBusy ? 'permissions.deepChecking' : 'permissions.deep'))),
              permissionDeep ? React.createElement('p', { style: hint }, translate('permissions.deepSummary', { scanned: permissionDeep.scanned, duration: permissionDeep.durationMs, owner: permissionDeep.ownerIssues, directories: permissionDeep.directoryModeIssues, files: permissionDeep.fileModeIssues, unreadable: permissionDeep.unreadable })) : null,
              permissionDetails ? React.createElement('div', { style: { display: 'grid', gap: '8px', marginTop: '8px' } },
                permissions.items.map((item) => React.createElement('div', {
                  key: item.path,
                  style: { padding: '9px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
                },
                React.createElement('div', { style: { fontSize: '12px', fontWeight: 600 } }, item.label),
                React.createElement('div', { style: { fontFamily: 'monospace', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' } }, item.path),
                React.createElement('div', { style: { fontFamily: 'monospace', fontSize: '12px', marginTop: '3px' } }, `${item.owner} · ${item.mode}`)))) : null,
              permissionConfirm
                ? React.createElement('div', { style: { marginTop: '10px' } },
                    React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)' }) }, translate('permissions.confirmHint')),
                    React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                      React.createElement('button', { style: danger, disabled: permissionBusy, onClick: repairPermissions }, translate(permissionBusy ? 'permissions.repairing' : 'permissions.confirm')),
                      React.createElement('button', { style: ghost, disabled: permissionBusy, onClick: () => setPermissionConfirm(false) }, translate('permissions.cancel'))))
                : permissionNeedsRepair
                   ? React.createElement('button', { style: Object.assign({}, dangerGhost, { marginTop: '10px' }), 'data-variant': 'danger-filled', disabled: permissionBusy, onClick: () => setPermissionConfirm(true) }, translate('permissions.repair'))
                   : null,
              permissionError ? React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)' }) }, permissionError) : null))
          : null

        const healthBlock = React.createElement('div', { key: 'health-section', 'data-testid': 'health-card', style: card },
          React.createElement('div', { style: sectionTitle }, translate('tabs.health')),
          healthSummaryBlock,
          permissionBlock)

        const backupBlock = React.createElement('div', { key: 'backup-section' },
          React.createElement('div', { style: sectionTitle }, translate('backup.title')),
          React.createElement('div', { style: Object.assign({}, displaySurface, { marginTop: '4px' }) },
          React.createElement('p', { style: hint }, translate('backup.description')),
          React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
            React.createElement('button', { style: Object.assign({}, neutral, { flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }), onClick: createBackup, disabled: backupBusy }, translate(backupBusy ? 'backup.creating' : 'backup.create')),
            React.createElement('label', { style: Object.assign({}, neutral, { flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: backupImportBusy ? 'default' : 'pointer' }) },
              translate(backupImportBusy ? 'backup.importing' : 'backup.import'),
              React.createElement('input', { type: 'file', accept: '.tar.gz,application/gzip', disabled: backupImportBusy, onChange: importBackup, style: { display: 'none' } }))),
          React.createElement('p', { style: hint }, translate('backup.total', { size: formatSize(backups.totalBytes) })),
          backupError ? React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)' }) }, backupError) : null,
          backups.items.length === 0
            ? React.createElement('p', { style: hint }, translate('backup.empty'))
            : backups.items.length > 10
              ? React.createElement('button', { style: Object.assign({}, ghost, { marginTop: '8px' }), onClick: () => setBackupDetails((value) => !value) }, translate(backupDetails ? 'backup.hideRecords' : 'backup.showRecords'))
              : null,
          backups.items.length > 0 && (backups.items.length <= 10 || backupDetails)
            ? React.createElement('div', { style: { marginTop: '10px', display: 'grid', gap: '8px' } },
                backups.items.map((item) => React.createElement('div', {
                  key: item.id,
                  style: { padding: '9px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
                },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' } },
                  React.createElement('div', null,
                    React.createElement('div', { style: { fontFamily: 'monospace', fontSize: '12px', overflowWrap: 'anywhere' } }, item.name),
                    React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', marginTop: '3px' } }, `${formatSize(item.sizeBytes)} · ${new Date(item.createdAt).toLocaleString()}`)),
                  React.createElement('div', { style: { display: 'flex', gap: '6px', flexShrink: 0 } },
                    backupDeleteId === item.id || backupRestoreId === item.id
                      ? null
                      : React.createElement('button', { style: Object.assign({}, ghost, { minHeight: '28px', padding: '4px 9px' }), disabled: backupExportBusy || backupBusy, onClick: () => exportBackup(item.id) }, translate(backupExportBusy ? 'backup.exporting' : 'backup.export')),
                    backupDeleteId === item.id || backupRestoreId === item.id
                      ? null
                      : React.createElement('button', { style: Object.assign({}, neutral, { minHeight: '28px', padding: '4px 9px' }), disabled: backupBusy, onClick: () => setBackupRestoreId(item.id) }, translate('backup.restore')),
                    backupDeleteId === item.id || backupRestoreId === item.id
                      ? null
                      : React.createElement('button', { style: Object.assign({}, dangerGhost, { minHeight: '28px', padding: '4px 9px' }), 'data-variant': 'danger-filled', disabled: backupBusy, onClick: () => setBackupDeleteId(item.id) }, translate('backup.delete')),
                  )),
                backupDeleteId === item.id
                  ? React.createElement('div', { style: { marginTop: '8px' } },
                      React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)', margin: '0 0 6px' }) }, translate('backup.confirmHint')),
                      React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                        React.createElement('button', { style: danger, disabled: backupBusy, onClick: () => deleteBackup(item.id) }, translate('backup.confirm')),
                        React.createElement('button', { style: ghost, disabled: backupBusy, onClick: () => setBackupDeleteId(null) }, translate('backup.cancel'))))
                  : backupRestoreId === item.id
                    ? React.createElement('div', { style: { marginTop: '8px' } },
                        React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-warn-primary)', margin: '0 0 6px' }) }, translate('backup.restoreHint')),
                        React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                          React.createElement('button', { style: primary, disabled: backupBusy, onClick: () => restoreBackup(item.id) }, translate('backup.restoreConfirm')),
                          React.createElement('button', { style: ghost, disabled: backupBusy, onClick: () => setBackupRestoreId(null) }, translate('backup.cancel'))))
                    : null)))
            : null))

        // 正式/预览通道两行信息在版本卡内下拉展开（不弹浮层：弹层会被设置模态盖住）。
        // 有更新时状态文本本身可点击：小三角 + 「有新版本：…」整体切换展开/收起。
        const chevronIcon = (open) => React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block', transition: 'transform 150ms ease', transform: open ? 'rotate(90deg)' : 'none' } },
          React.createElement('path', { d: 'M9 6l6 6-6 6' }))
        const versionRow = (id, label, fallbackVersion, state, action, expandable, topBorder) => {
          const statusText = !state
            ? (updateError || translate('update.checking'))
            : state.status === 'unpublished' ? translate('update.unpublished')
              : state.status === 'unavailable' ? translate('update.unavailable')
                : state.upToDate ? translate('update.current')
                  : translate('update.available', { version: state.latest })
          const statusColor = !state ? 'var(--dsw-alias-label-secondary)' : state.upToDate ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)'
          const clickable = expandable && state && state.status !== 'unpublished' && state.status !== 'unavailable' && !state.upToDate
          const rightSide = clickable
            ? React.createElement('button', { type: 'button', title: translate(channelOpen ? 'update.detailsHide' : 'update.detailsButton'), style: { background: 'transparent', border: 0, padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 600, color: statusColor }, onClick: () => setChannelOpen((value) => !value) },
                chevronIcon(channelOpen),
                React.createElement('span', null, statusText))
            : React.createElement('div', { style: { color: statusColor, fontWeight: 600 } }, statusText)
          return React.createElement('div', { key: id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', padding: '10px 2px', borderTop: topBorder ? '1px solid var(--dsw-alias-border-l1)' : 0 } },
            React.createElement('div', { style: { whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '8px' } },
              React.createElement('span', { style: { fontSize: '13px', fontWeight: 650 } }, `${label} `),
              state?.url
                ? React.createElement('a', { 'data-testid': `version-${id}-link`, href: state.url, target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-label-primary)', textDecoration: 'underline', fontSize: '12px', whiteSpace: 'nowrap', marginLeft: '16px' } }, state.current || fallbackVersion || translate('version.loading'))
                : React.createElement('code', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', marginLeft: '16px' } }, state?.current || fallbackVersion || translate('version.loading'))),
            action || null,
            React.createElement('div', { style: { textAlign: 'right', fontSize: '12px' } }, rightSide))
        }
        // 版本信息区块：DSH 行在有更新时状态文本（小三角 + 有新版本）整体可点击，行内下拉展开
        const dshUpdate = updateInfo?.dsh
        const dshExpandable = dshUpdate && dshUpdate.status !== 'unpublished' && dshUpdate.status !== 'unavailable' && !dshUpdate.upToDate
        const pluginUpdate = updateInfo?.plugin && !updateInfo.plugin.upToDate && updateInfo.plugin.status === 'available'
        // 确认后果或已装好待手动重启期间收起升级按钮，避免重复触发或撞 no-newer-version 守卫。
        const pluginAction = pluginUpdate && !upgradeManualConfirm && !upgradeManualPending
          ? React.createElement('button', { style: Object.assign({}, neutral, { minHeight: '24px', padding: '2px 8px', fontSize: '11px' }), disabled: upgradeBusy, onClick: upgradePlugin }, translate(upgradeBusy ? 'update.upgrading' : 'update.upgrade'))
          : null
        // 版本卡只放版本与升级：运行环境信息在健康诊断检查项与重启确认提示中呈现（用户复核口径）。
        const versionBlock = React.createElement('div', { key: 'version-card', 'data-testid': 'version-card', style: card },
          React.createElement('div', { key: 'title', style: sectionTitle }, translate('version.title')),
          React.createElement('div', { style: displaySurface },
            versionRow('plugin', 'dsh-service', pluginVersion, updateInfo?.plugin, pluginAction, false, false),
            versionRow('dsh', 'DSH', version, dshUpdate, null, dshExpandable === true, true),
            channelOpen
              ? React.createElement('div', { 'data-testid': 'version-channel-details', style: { marginTop: '6px', paddingTop: '8px', borderTop: '1px solid var(--dsw-alias-border-l1)', fontSize: '12px', lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' } },
                  React.createElement('div', null, translate('update.details.current', { version: dshUpdate?.current || version || '—' })),
                  React.createElement('div', null, translate('update.details.latest', { version: dshUpdate?.latest || '—' })),
                  channelLines(translate, dshUpdate?.tags))
              : null,
            upgradeManualConfirm
              ? React.createElement('div', { 'data-testid': 'upgrade-manual-confirm', style: { marginTop: '10px', padding: '10px 12px', borderRadius: '6px', background: 'rgba(211,51,51,0.08)', border: '1px solid rgba(211,51,51,0.3)' } },
                  React.createElement('p', { style: { margin: '0 0 6px', color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px', fontWeight: 600 } }, translate('update.manualConfirmTitle')),
                  React.createElement('p', { style: Object.assign({}, hint, { margin: '0 0 8px' }) }, translate('update.manualConfirm')),
                  React.createElement('div', { style: row },
                    React.createElement('button', { style: dangerGhost, 'data-variant': 'danger', disabled: upgradeBusy, onClick: upgradePlugin }, translate(upgradeBusy ? 'update.upgrading' : 'update.manualProceed')),
                    React.createElement('button', { style: ghost, disabled: upgradeBusy, onClick: () => setUpgradeManualConfirm(false) }, translate('restart.cancel'))))
              : null,
            upgradeManualPending
              ? React.createElement('div', { 'data-testid': 'upgrade-manual-pending', style: { marginTop: '10px', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--dsw-alias-state-warn-primary)', background: 'var(--dsw-alias-bg-layer-2)' } },
                  React.createElement('p', { style: { margin: '0 0 4px', color: 'var(--dsw-alias-state-warn-primary)', fontSize: '13px', fontWeight: 650 } }, translate('update.manualRestartTitle')),
                  React.createElement('p', { style: Object.assign({}, hint, { margin: 0 }) }, translate('update.manualRestartBody')))
              : null,
            upgradeError ? React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)', margin: '4px 0 0' }) }, upgradeError) : null))

        // 重启区块复用共享组件（「重启」标签还承载设置页左列入口的显示开关；左侧入口默认关闭）
        const restartBlock = React.createElement(RestartSection, { showNavToggle: true })

        const { enabled: notifyOn, done: notifyDoneOn, input: notifyInputOn, setEnabled: setNotifyOn, setDone: setNotifyDoneOn, setInput: setNotifyInputOn } = useNotifyState()
        const notifSupported = typeof Notification !== 'undefined'
        const notifPermission = notifSupported ? Notification.permission : 'denied'
        const notifySwitch = (on, onChange, disabled) => React.createElement('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': String(on === true),
          'aria-disabled': disabled ? 'true' : undefined,
          onClick: disabled ? undefined : () => onChange(!on),
          style: {
            width: '34px', height: '20px', borderRadius: '10px', padding: 0, flexShrink: 0, position: 'relative',
            border: `1px solid ${on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'}`,
            background: on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)',
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, lineHeight: 0,
          },
        }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: on ? '15px' : '1px', width: '16px', height: '16px', borderRadius: '50%', background: on ? '#fff' : 'var(--dsw-alias-label-tertiary)' } }))
        const notifyRow = (testId, label, labelHint, on, onChange, disabled) => React.createElement('div', { 'data-testid': testId, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '5px 0' } },
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
            React.createElement('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } }, label),
            labelHint ? React.createElement('span', { style: hint }, labelHint) : null),
          notifySwitch(on, onChange, disabled))
        const notificationBlock = !notifSupported ? null
          : React.createElement('div', { style: { marginTop: '18px' } },
              React.createElement('div', { style: sectionTitle }, translate('notification.title')),
              React.createElement('div', { style: Object.assign({}, displaySurface, { marginTop: '4px' }) },
                React.createElement('p', { style: hint }, translate('notification.description')),
                notifPermission !== 'granted'
                  ? React.createElement('div', { style: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' } },
                      React.createElement('button', { style: neutral, onClick: () => { Notification.requestPermission().then((p) => { if (p === 'granted') setNotifyOn(true) }) } }, translate('notification.enable')),
                      React.createElement('span', { style: hint }, notifPermission === 'denied' ? translate('notification.denied') : ''))
                  : React.createElement('div', { style: { marginTop: '8px', display: 'flex', flexDirection: 'column' } },
                      notifyRow('notify-row-master', translate('notification.master'), null, notifyOn, setNotifyOn, false),
                      notifyRow('notify-row-done', translate('notification.done'), null, notifyDoneOn, setNotifyDoneOn, !notifyOn),
                      notifyRow('notify-row-input', translate('notification.input'), null, notifyInputOn, setNotifyInputOn, !notifyOn))))
        const overviewBlock = React.createElement('div', null, versionBlock, containerInfoBlock, overviewErrorsBlock)
        // 任务通知独立成顶部标签（v0.14 起不再混在概览里）
        const notifyBlock = React.createElement('div', null, notificationBlock)
        const maintenanceBlock = React.createElement('div', { key: 'maintenance-card', 'data-testid': 'maintenance-card', style: card }, backupBlock)
        // advisory 警告（如手动启动环境的黄色提示）只做行内呈现，不点亮标签 ⚠ 与顶部服务控制提醒。
        const diagnosticFailure = diagnostics?.checks?.some((check) => check.status === 'error' || (check.status === 'warning' && check.advisory !== true)) === true
        const tabWarnings = {
          overview: false,
          notify: false,
          health: Boolean(healthError || permissionError || diagnosticFailure || permissionAbnormal > 0),
          usage: Boolean(usageError),
          backup: Boolean(backupError),
          restart: Boolean(restartFlowState.error),
        }
        const tabs = [
          ['overview', 'tabs.overview'],
          ['notify', 'tabs.notify'],
          ['health', 'tabs.health'],
          ['usage', 'tabs.usage'],
          ['quota', 'tabs.quota'],
          ['backup', 'tabs.backup'],
          ['restart', 'tabs.restart'],
        ]
        const warningTabs = tabs.filter(([id]) => tabWarnings[id]).map(([, label]) => translate(label))
        const tabContent = activeTab === 'overview'
          ? overviewBlock
          : activeTab === 'notify'
            ? notifyBlock
            : activeTab === 'health'
              ? healthBlock
              : activeTab === 'usage'
                ? usageBlock
                : activeTab === 'quota'
                  ? React.createElement(RemoteQuotaCard, null)
                : activeTab === 'backup'
                  ? maintenanceBlock
                  : restartBlock
        return React.createElement('div', null,
          warningTabs.length > 0 ? React.createElement('div', { style: { marginBottom: '12px', padding: '11px 13px', borderRadius: '8px', background: 'rgba(198,128,0,0.16)', border: '1px solid rgba(198,128,0,0.48)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' } },
            React.createElement('div', { style: { fontSize: '13px', fontWeight: 700 } }, translate('tabs.alert.title')),
            React.createElement('div', { style: Object.assign({}, hint, { marginTop: '3px' }) }, translate('tabs.alert.body', { tabs: warningTabs.join('、') }))) : null,
          React.createElement('div', { 'data-testid': 'tab-list', style: { display: 'flex', gap: '10px', flexWrap: 'wrap', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
            tabs.map(([id, label]) => React.createElement('button', { key: id, style: Object.assign({}, inlineTab, activeTab === id ? inlineTabActive : { color: tabWarnings[id] ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)', borderBottom: '2px solid transparent' }), onClick: () => { setActiveTab(id); if (id === 'health') runDiagnostics(false) } }, `${tabWarnings[id] ? '⚠ ' : ''}${translate(label)}`))),
          React.createElement('div', { 'data-testid': 'tab-panel', style: tabPanel }, tabContent))
      }

      const bellPaths = {
        on: ['M10.268 21a2 2 0 0 0 3.464 0', 'm15 8 2 2 4-4', 'M16.8607 4.4824A6 6 0 0 0 6 8C6 12.499 4.589 13.956 3.262 15.326', 'M3.262 15.326A1 1 0 0 0 4 17H20A1 1 0 0 0 20.74 15.327C20.209 14.779 19.665 14.218 19.203 13.454'],
        off: ['M10.268 21a2 2 0 0 0 3.464 0', 'M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742', 'm2 2 20 20', 'M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05'],
      }
      function BellIcon(on) {
        return React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' } },
          (on ? bellPaths.on : bellPaths.off).map(function (d, i) { return React.createElement('path', { key: i, d: d }) }))
      }
      function InlineNotifyBell() {
        const { enabled, setEnabled } = useNotifyState()
        const translate = useTranslation()
        return React.createElement('button', {
          type: 'button',
          title: translate(enabled ? 'notification.bellOn' : 'notification.bellOff'),
          style: { background: 'transparent', border: 0, cursor: 'pointer', padding: '2px 4px', color: 'inherit', opacity: enabled ? 1 : 0.45, lineHeight: 0 },
          onClick: () => {
            if (typeof Notification === 'undefined') return
            if (Notification.permission !== 'granted') {
              Notification.requestPermission().then((p) => { if (p === 'granted') setEnabled(true) })
              return
            }
            setEnabled(!enabled)
          },
        }, BellIcon(enabled))
      }
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
        { name: 'conversation.input.left', id: 'dsh-service-notify', order: 90, label: () => t('notification.bellOn') },
        () => React.createElement(InlineNotifyBell, null),
      ))
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'dsh-service-update', order: 90, label: () => t('update.badge') },
        () => React.createElement(UpdateBadge, null),
      ))
      ctx.slots.inject('settings.section', () => {
        const disposePanel = ctx.slots.register(
          { name: 'settings.section', id: 'dsh-service', order: 99, label: () => t('nav.label') },
          () => React.createElement(ServicePanel, null),
        )
        // 左列「重启」「额度查询」入口由各自标签内的开关控制，默认不注册
        syncRestartNavEntry()
        syncQuotaNavEntry()
        return () => {
          disposePanel()
          if (restartNavDispose) {
            restartNavDispose()
            restartNavDispose = null
          }
          if (quotaNavDispose) {
            quotaNavDispose()
            quotaNavDispose = null
          }
        }
      })
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-service-restart', order: 100, label: () => t('overlay.label') },
        () => React.createElement(RestartOverlay, null),
      ))

      // 额度查询圆环：跟随当前会话所选模型的供应商。modelDirectories 是可选服务
      // （老版本 DSH 没有）。槽位条目无条件注册，服务在条目渲染时（inject(sessionId)）
      // 经 ctx.get 惰性解析——此时会话已渲染、model-selection 必然已挂载，不受注入时序影响；
      // 拿不到服务时 props 为空，QuotaRing 渲染 null 且不启动轮询，其他功能零影响。
      const getModelDirectories = () => {
        try {
          if (typeof ctx.get === 'function') return ctx.get('modelDirectories')
        } catch (_) {}
        return undefined
      }
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'dsh-service-quota-ring',
        order: 95,
        label: () => t('quota.ring.label'),
        inject: (sessionId) => {
          if (sessionId === undefined || sessionId === null) return {}
          try {
            const models = getModelDirectories()
            if (models === undefined || typeof models.directoryFor !== 'function') return {}
            const directory = models.directoryFor(sessionId)
            return {
              directoryStore: directory.store,
              loadDirectory: () => {
                try {
                  const pending = directory.load()
                  if (pending && typeof pending.catch === 'function') pending.catch(() => {})
                } catch (_) {}
              },
            }
          } catch (_) {
            return {}
          }
        },
      }, (props) => React.createElement(QuotaRing, props)))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
