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
      'features.cardTitle': '服务控制（dsh-service）',
      'features.cardHint': '控制可选功能和外部能力。开关立即生效，无需重启；详细状态与操作位于左侧「服务控制」。',
      'features.optional': '可选功能',
      'features.external': '外部能力',
      'features.modelUsage': '模型统计',
      'features.quotaLookup': '额度查询',
      'features.backupMaintenance': '备份维护',
      'features.taskNotifications': '任务通知',
      'features.healthz': '/healthz 探活端点',
      'features.skillManager': '技能管理',
      'features.readOnly': '当前设置不可写。',
      'tabs.skills': '技能',
      'tabs.subagent': '子代理',
      'features.subagentRoute': '子代理模型',
      'subagent.title': '子代理模型',
      'subagent.hint': '控制「未显式指定模型」的子代理委派使用哪个模型；显式指定了模型的派生（预设钉死、其他插件注入、调用参数携带）不受影响。',
      'subagent.mode.label': '模式',
      'subagent.mode.inherit': '初始（不干预）',
      'subagent.mode.inherit.desc': '不注入任何路由，保持宿主原生继承行为：子代理使用会话创建时烘焙的默认模型。',
      'subagent.mode.follow': '跟随主模型',
      'subagent.mode.follow.desc': '每次派生时读取主对话当前实际使用的模型（最近一次请求的渠道）并注入。',
      'subagent.mode.custom': '自定义',
      'subagent.mode.custom.desc': '所有未显式指定模型的子代理固定使用下方选择的模型。',
      'subagent.provider': '供应商',
      'subagent.model': '模型',
      'subagent.modelsEmpty': '模型清单为空：无法解析宿主 LLM 渠道。',
      'subagent.save': '保存',
      'subagent.saved': '已保存',
      'subagent.reset': '重置回初始配置',
      'subagent.saving': '保存中…',
      'subagent.unavailable': '宿主未提供子代理注册表（subagents 服务缺席），配置不会生效。',
      'subagent.navToggle': '设置页左列显示「子代理」入口',
      'subagent.navToggleHint': '默认关闭；开启后在设置页左侧标签列底部显示子代理模型快捷入口',
      'subagent.error': '操作失败：{error}',
      'subagent.error.feature-disabled': '子代理模型功能已在设置中关闭',
      'subagent.error.llm-unavailable': '宿主 LLM 服务不可用',
      'subagent.error.unknown-mode': '未知模式',
      'subagent.error.invalid-model-route': '供应商或模型不在宿主清单内',
      'subagent.error.network': '网络错误：无法连接宿主',
      'skills.error': '操作失败：{error}',
      'skills.error.feature-disabled': '技能管理功能已在设置中关闭',
      'skills.error.network': '网络错误，请稍后重试',
      'skills.error.read-only-source': '该条目位于只读来源，无法修改',
      'skills.error.unknown-skill': '技能未找到，列表可能已变化，请刷新重试',
      'skills.error.invalid-skill': '条目当前无效：{reason}',
      'skills.error.invalid-field': '开关字段无效',
      'skills.error.invalid-enable': '开关值无效',
      'skills.error.invalid-model-route': '模型路由无效，请重新选择模型',
      'skills.error.invalid-description': '描述不能为空',
      'skills.error.describe-timeout': '模型生成超时（90 秒）',
      'skills.error.empty-output': '模型未产出正文（结束原因：{kind}）',
      'skills.error.batch-cancelled': '已取消',
      'skills.error.entry-changed': '条目在运行中发生变化，已跳过',
      'skills.error.unknown-batch-plan': '批量计划已失效，请重新生成',
      'skills.error.batch-already-done': '该批量计划已完成',
      'skills.error.batch-already-cancelled': '该批量计划已取消',
      'skills.empty': '未发现任何技能',
      'skills.filter': '按名称过滤…',
      'skills.colon': '：',
      'skills.group.auto': '自动加载',
      'skills.group.manual': '仅手动调用',
      'skills.group.disabled': '完全停用',
      'skills.source.project-dsh': '项目 .dsh',
      'skills.source.project-agents': '项目 .agents',
      'skills.source.user-dsh': '用户 DSH',
      'skills.source.user-agents': '用户 .agents',
      'skills.source.bundled': '内置',
      'skills.source.custom': '自定义目录',
      'skills.badge.shadowed': '被同名遮蔽',
      'skills.badge.readonly': '只读',
      'skills.badge.annotated': '已注释',
      'skills.note.stale': '正文已变更，待重新补全',
      'skills.note.remove': '移除 AI 注释',
      'skills.note.panelOnly': '注释仅保存在本面板展示，不写入 SKILL.md。',
      'skills.log.title': '运行日志',
      'skills.log.located': '已定位技能 {name}（文件 {chars} 字符）',
      'skills.log.attempt': '第 {n}/{total} 次生成：调用 {route}',
      'skills.log.received': '输出接收完成（{chars} 字符），解析 JSON…',
      'skills.log.parsed': '解析成功，草稿就绪',
      'skills.log.failed-retry': '失败：{message}，自动重试',
      'skills.log.failed': '失败：{message}',
      'skills.log.wait': '等待模型输出… {secs}s',
      'skills.log.first-delta': '模型已开始返回',
      'skills.log.first-reasoning': '模型已开始返回（先输出推理）',
      'skills.log.progress': '已接收 {chars} 字符',
      'skills.log.finish-reasoning-only': '模型结束：{kind}（仅推理 {chars} 字符，未产出正文）',
      'skills.log.finish-empty': '模型结束：{kind}（无任何输出）',
      'skills.log.block-extract': '从整块输出提取正文（{chars} 字符）',
      'skills.log.item-start': '开始生成注释…',
      'skills.batch.toggle': '批量注释',
      'skills.batch.collapse': '收起',
      'skills.batch.already': '已有批量任务在进行中，请等待完成或先取消',
      'skills.invalid.legacy': '存在旧版调用键，已从模型目录剔除',
      'skills.invalid.other': '无效条目：{reason}',
      'skills.fix.legacy': '一键修复旧键',
      'skills.switch.model': '对模型可见',
      'skills.switch.user': '可被 / 调用',
      'skills.switch.confirm': '再次点击生效',
      'skills.describe.button': 'AI 补全说明',
      'skills.describe.title': 'AI 补全说明 — {name}',
      'skills.describe.model': '模型',
      'skills.describe.models.loading': '获取模型列表…',
      'skills.describe.models.empty': '未发现已配置模型',
      'skills.describe.run': '生成草稿',
      'skills.describe.running': '生成中…',
      'skills.apply.title': '保存 AI 注释 — {name}',
      'skills.apply.description': '描述',
      'skills.apply.usage': '用法',
      'skills.apply.old': '旧',
      'skills.apply.new': '新',
      'skills.apply.confirm': '保存注释',
      'skills.apply.done': '注释已保存',
      'skills.apply.keepusage': '（保留现有）',
      'skills.llm.unavailable': '宿主 LLM 服务不可用，无法 AI 补全。',
      'skills.batch.title': '批量补全未注释技能',
      'skills.batch.hint': '逐条调用所选模型，为未注释或正文有变的技能生成中文描述与用法；结果作为「AI 注释」仅保存在插件内并展示在对应条目下方，不改写 SKILL.md。无效条目与被遮蔽副本自动跳过，单条失败不影响批次，可随时取消。',
      'skills.batch.plan': '生成计划',
      'skills.batch.candidates': '候选 {count} 项',
      'skills.batch.estBytes': '约发送 {size} 内容',
      'skills.batch.skipped': '跳过 {count} 项（无效 / 已注释 / 被遮蔽）',
      'skills.skippedList': '跳过清单',
      'skills.skip.annotated-current': '已注释',
      'skills.skip.shadowed': '被遮蔽',
      'skills.skip.invalid': '无效（{reason}）',
      'skills.skip.reason.missing-frontmatter': '缺 frontmatter',
      'skills.skip.reason.missing-name': '缺 name',
      'skills.skip.reason.invalid-name': 'name 不合法',
      'skills.skip.reason.missing-description': '缺 description',
      'skills.skip.reason.too-large': '文件过大',
      'skills.skip.reason.legacy-invocation-key': '旧版调用键',
      'skills.batch.start': '开始批量补全',
      'skills.batch.progress': '进度 {done}/{total}',
      'skills.batch.current': '当前：{name}',
      'skills.batch.cancel': '取消',
      'skills.batch.phase.idle': '空闲',
      'skills.batch.phase.planned': '待开始（核对候选后点击「开始批量补全」）',
      'skills.batch.phase.running': '进行中',
      'skills.batch.phase.done': '已完成',
      'skills.batch.phase.cancelled': '已取消',
      'skills.batch.failures': '失败 {count} 项',
      'skills.batch.no-candidates': '没有需要补全的候选',
      'skills.batch.model': '模型',
      'skills.nav.toggle': '设置页左列显示「技能」入口',
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
      'usage.modelScope.today': '今日',
      'usage.modelScope.week': '近 7 天',
      'usage.modelScope.all': '累计',
      'usage.modelSortHint.today': '按今日 token 从多到少排列',
      'usage.modelSortHint.week': '按近 7 天 token 从多到少排列',
      'usage.modelSortHint.all': '按累计 token 从多到少排列',
      'usage.modelBar.today': '{model}：今日 {total} token',
      'usage.modelBar.week': '{model}：近 7 天 {total} token',
      'usage.modelBar.all': '{model}：累计 {total} token',
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
      'quota.window.credit-limit': '点数额度',
      'quota.window.credits': '已用额度',
      'quota.window.balance': '余额',
      'quota.window.weekly': '本周',
      'quota.window.monthly': '本月',
      'quota.window.codex-5h': 'Codex 5 小时窗',
      'quota.window.codex-day': 'Codex 日窗口',
      'quota.window.codex-week': 'Codex 本周窗',
      'quota.window.codex-month': 'Codex 本月窗口',
      'quota.panel.title': '额度用量',
      'quota.panel.used': '已用',
      'quota.panel.remaining': '剩余',
      'quota.ring.label': '额度查询',
      'quota.updated': '更新于 {time}',
      'quota.refreshing': '刷新中…',
      'quota.empty': '暂无数据',
      'quota.resetIn': '重置于 {time}',
      'quota.resetCard.title': '重置卡',
      'quota.resetCard.expires': '{date} 到期',
      'quota.resetCard.expired': '已过期',
      'quota.resetCard.edit': '添加重置卡',
      'quota.resetCard.dateLabel': '到期日期',
      'quota.resetCard.nameLabel': '名称（可选）',
      'quota.resetCard.add': '添加',
      'quota.resetCard.cancel': '取消',
      'quota.resetCard.remove': '移除',
      'quota.retryAt': '{time} 后可重试',
      'quota.refresh': '刷新',
      'quota.card.moveUp': '上移',
      'quota.card.moveDown': '下移',
      'quota.reorder': '调整排序',
      'quota.usageLink': '打开官网用量页',
      'quota.adapt': '适配',
      'quota.kind.opencode-go': 'OpenCode Go',
      'quota.kind.zai-coding-cn': '智谱 GLM Coding Plan',
      'quota.kind.openrouter': 'OpenRouter',
      'quota.kind.kimi': 'Kimi / Moonshot',
      'quota.kind.siliconflow': '硅基流动',
      'quota.kind.deepseek': 'DeepSeek 开放平台',
      'quota.kind.cliproxy': 'CLIProxyAPI 账号额度',
      'quota.kindAuto': '自动识别',
      'quota.noAdapted': '暂无已适配的供应商，可在下方手动适配',
      'quota.disable': '停用查询',
      'quota.followAuto': '跟随自动识别',
      'quota.addAdapt': '手动适配：',
      'quota.addPickProvider': '选择供应商',
      'quota.addPickKind': '选择类型',
      'quota.saveFailed': '保存失败：{error}',
      'quota.unknownProvider': '未知供应商',
      'quota.error.credential-missing': '凭据未配置（请在 DSH 凭据中设置对应 API key）',
      'quota.error.no-base-url': '该供应商未配置 baseURL',
      'quota.error.credentials-unavailable': '凭据服务不可用',
      'quota.error.http-status': '上游返回错误状态',
      'quota.error.network': '网络错误',
      'quota.error.network-transient': '网络不稳定（已自动重试）',
      'quota.error.timeout': '请求超时',
      'quota.error.bad-payload': '响应格式异常',
      'quota.error.mgmt-disabled': 'CLIProxyAPI 管理面未启用（未设置 remote-management secret-key）',
      'quota.error.host-not-pinned': 'baseURL 与适配时记录的域名不一致，请重新保存适配',
      'quota.error.upstream-status': '上游官方接口返回错误状态',
      'quota.credential.edit': '填写 API 密钥',
      'quota.credential.editManagement': '填写管理密钥（网页登录的 key）',
      'quota.credential.nameLabel': '凭据名称',
      'quota.credential.valueLabel': '密钥值',
      'quota.credential.save': '保存',
      'quota.credential.primary': '主名（别名存一即可）',
      'quota.credential.clear': '清除已存',
      'quota.credential.clearConfirm': '再次点击清除',
      'quota.credential.configured': '已配置',
      'quota.credential.notConfigured': '未配置',
      'quota.credential.saveFailed': '凭据保存失败：{error}',
      'quota.credential.unknown-hint': '未知凭据名',
      'quota.credential.invalid-value': '密钥值不能为空',
      'quota.credential.credentials-unavailable': '凭据服务不可用',
      'quota.error.unknown': '未知错误',
      'quota.unadapted': '该供应商未适配，请先在下方选择类型',
      'quota.unit.day': '{count} 天',
      'quota.unit.hour': '{count} 小时',
      'quota.unit.minute': '{count} 分钟',
      'quota.window.granted-balance': '赠送余额（未过期）',
      'quota.peak.nowIdle': '当前空闲时段 · 半价计费',
      'quota.peak.nowPeak': '当前高峰时段 · 标准价',
      'quota.peak.untilIdle': '{time} 转空闲（{dur}后）',
      'quota.peak.untilPeak': '{time} 转高峰（{dur}后）',
      'quota.peak.tag.peak': '忙时',
      'quota.peak.tag.idle': '闲时',
      'quota.peak.caption': '空闲时段价格为高峰时段的一半。高峰时段：北京时间周一至周五 09:00–12:00、14:00–18:00；其余时间为空闲时段，周六和周日全天空闲。',
    }
    const en = {
      'nav.label': 'Service Control',
      'nav.restart': 'Restart',
      'features.cardTitle': 'Service control (dsh-service)',
      'features.cardHint': 'Control optional features and external capabilities. Changes take effect immediately without a restart; detailed status and actions remain in Service Control.',
      'features.optional': 'Optional features',
      'features.external': 'External capabilities',
      'features.modelUsage': 'Model statistics',
      'features.quotaLookup': 'Quota lookup',
      'features.backupMaintenance': 'Backup maintenance',
      'features.taskNotifications': 'Task notifications',
      'features.healthz': '/healthz liveness endpoint',
      'features.skillManager': 'Skill manager',
      'features.readOnly': 'These settings are read-only.',
      'tabs.skills': 'Skills',
      'tabs.subagent': 'Subagents',
      'features.subagentRoute': 'Subagent model',
      'subagent.title': 'Subagent model',
      'subagent.hint': 'Controls which model a subagent delegation uses when no model was explicitly specified; delegations with an explicit route (pinned preset, another plugin, call arguments) are unaffected.',
      'subagent.mode.label': 'Mode',
      'subagent.mode.inherit': 'Default (no override)',
      'subagent.mode.inherit.desc': 'Injects nothing and keeps the native inheritance: subagents use the model baked in when the session was created.',
      'subagent.mode.follow': 'Follow main model',
      'subagent.mode.follow.desc': 'Each delegation reads the model the main conversation actually uses right now (route of its latest request) and injects it.',
      'subagent.mode.custom': 'Custom',
      'subagent.mode.custom.desc': 'Every delegation without an explicit model uses the model selected below.',
      'subagent.provider': 'Provider',
      'subagent.model': 'Model',
      'subagent.modelsEmpty': 'Model list is empty: host LLM channels cannot be resolved.',
      'subagent.save': 'Save',
      'subagent.saved': 'Saved',
      'subagent.reset': 'Reset to default',
      'subagent.saving': 'Saving…',
      'subagent.unavailable': 'The host exposes no subagents registry (service missing); this configuration has no effect.',
      'subagent.navToggle': 'Show "Subagents" entry in settings left nav',
      'subagent.navToggleHint': 'Off by default; when enabled, a subagent-model entry appears at the bottom of the settings left navigation',
      'subagent.error': 'Operation failed: {error}',
      'subagent.error.feature-disabled': 'Subagent model is switched off in settings',
      'subagent.error.llm-unavailable': 'Host LLM service is unavailable',
      'subagent.error.unknown-mode': 'Unknown mode',
      'subagent.error.invalid-model-route': 'Provider or model is not in the host catalog',
      'subagent.error.network': 'Network error: cannot reach the host',
      'skills.error': 'Operation failed: {error}',
      'skills.error.feature-disabled': 'Skill manager is switched off in settings',
      'skills.error.network': 'Network error, try again later',
      'skills.error.read-only-source': 'This entry lives in a read-only source',
      'skills.error.unknown-skill': 'Skill not found; the list may have changed, refresh and retry',
      'skills.error.invalid-skill': 'Entry is currently invalid: {reason}',
      'skills.error.invalid-field': 'Invalid switch field',
      'skills.error.invalid-enable': 'Invalid switch value',
      'skills.error.invalid-model-route': 'Invalid model route; pick a model again',
      'skills.error.invalid-description': 'Description cannot be empty',
      'skills.error.describe-timeout': 'Model generation timed out (90s)',
      'skills.error.empty-output': 'Model produced no body output (finish: {kind})',
      'skills.error.batch-cancelled': 'Cancelled',
      'skills.error.entry-changed': 'Entry changed during the run; skipped',
      'skills.error.unknown-batch-plan': 'Batch plan is stale; regenerate it',
      'skills.error.batch-already-done': 'That batch already finished',
      'skills.error.batch-already-cancelled': 'That batch was already cancelled',
      'skills.empty': 'No skills found',
      'skills.filter': 'Filter by name…',
      'skills.colon': ': ',
      'skills.group.auto': 'Auto-loaded',
      'skills.group.manual': 'Manual only',
      'skills.group.disabled': 'Fully disabled',
      'skills.source.project-dsh': 'Project .dsh',
      'skills.source.project-agents': 'Project .agents',
      'skills.source.user-dsh': 'User DSH',
      'skills.source.user-agents': 'User .agents',
      'skills.source.bundled': 'Bundled',
      'skills.source.custom': 'Custom dir',
      'skills.badge.shadowed': 'Shadowed',
      'skills.badge.readonly': 'Read-only',
      'skills.badge.annotated': 'Annotated',
      'skills.note.stale': 'Body changed; refill needed',
      'skills.note.remove': 'Remove AI note',
      'skills.note.panelOnly': 'Notes are stored and shown in this panel only; SKILL.md is never modified.',
      'skills.log.title': 'Run log',
      'skills.log.located': 'Located skill {name} ({chars} chars)',
      'skills.log.attempt': 'Attempt {n}/{total}: calling {route}',
      'skills.log.received': 'Output received ({chars} chars), parsing JSON…',
      'skills.log.parsed': 'Parsed OK, draft ready',
      'skills.log.failed-retry': 'Failed: {message}, retrying',
      'skills.log.failed': 'Failed: {message}',
      'skills.log.wait': 'Waiting for model output… {secs}s',
      'skills.log.first-delta': 'Model started returning',
      'skills.log.first-reasoning': 'Model started returning (reasoning first)',
      'skills.log.progress': 'Received {chars} chars',
      'skills.log.finish-reasoning-only': 'Finished: {kind} (only {chars} reasoning chars, no body)',
      'skills.log.finish-empty': 'Finished: {kind} (no output)',
      'skills.log.block-extract': 'Extracted body from whole block ({chars} chars)',
      'skills.log.item-start': 'Generating note…',
      'skills.batch.toggle': 'Batch annotate',
      'skills.batch.collapse': 'Collapse',
      'skills.batch.already': 'A batch is already running; wait for it or cancel first',
      'skills.invalid.legacy': 'Legacy invocation keys present; excluded from the model catalog',
      'skills.invalid.other': 'Invalid entry: {reason}',
      'skills.fix.legacy': 'Fix legacy keys',
      'skills.switch.model': 'Visible to model',
      'skills.switch.user': 'Invocable via /',
      'skills.switch.confirm': 'Click again to apply',
      'skills.describe.button': 'Fill with AI',
      'skills.describe.title': 'Fill metadata with AI — {name}',
      'skills.describe.model': 'Model',
      'skills.describe.models.loading': 'Loading models…',
      'skills.describe.models.empty': 'No configured models found',
      'skills.describe.run': 'Generate draft',
      'skills.describe.running': 'Generating…',
      'skills.apply.title': 'Save AI note — {name}',
      'skills.apply.description': 'Description',
      'skills.apply.usage': 'Usage',
      'skills.apply.old': 'Old',
      'skills.apply.new': 'New',
      'skills.apply.confirm': 'Save note',
      'skills.apply.done': 'Note saved',
      'skills.apply.keepusage': '(keep existing)',
      'skills.llm.unavailable': 'Host LLM service unavailable; AI fill disabled.',
      'skills.batch.title': 'Batch-fill unannotated skills',
      'skills.batch.hint': 'Fills Simplified-Chinese description & usage for unannotated skills or ones whose body changed, calling the selected model per skill. Results become "AI notes" stored inside the plugin and shown under each entry — SKILL.md files are never modified. Invalid entries and shadowed copies are skipped; single failures never block the batch.',
      'skills.batch.plan': 'Plan batch',
      'skills.batch.candidates': '{count} candidates',
      'skills.batch.estBytes': '~{size} of content will be sent',
      'skills.batch.skipped': '{count} skipped (invalid / annotated / shadowed)',
      'skills.skippedList': 'Skipped',
      'skills.skip.annotated-current': 'annotated',
      'skills.skip.shadowed': 'shadowed',
      'skills.skip.invalid': 'invalid ({reason})',
      'skills.skip.reason.missing-frontmatter': 'no frontmatter',
      'skills.skip.reason.missing-name': 'missing name',
      'skills.skip.reason.invalid-name': 'invalid name',
      'skills.skip.reason.missing-description': 'missing description',
      'skills.skip.reason.too-large': 'file too large',
      'skills.skip.reason.legacy-invocation-key': 'legacy invocation keys',
      'skills.batch.start': 'Start batch',
      'skills.batch.progress': 'Progress {done}/{total}',
      'skills.batch.current': 'Current: {name}',
      'skills.batch.cancel': 'Cancel',
      'skills.batch.phase.idle': 'Idle',
      'skills.batch.phase.planned': 'Planned — review candidates, then press Start',
      'skills.batch.phase.running': 'Running',
      'skills.batch.phase.done': 'Done',
      'skills.batch.phase.cancelled': 'Cancelled',
      'skills.batch.failures': '{count} failed',
      'skills.batch.no-candidates': 'Nothing to fill',
      'skills.batch.model': 'Model',
      'skills.nav.toggle': 'Show Skills entry in the settings sidebar',
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
      'usage.modelScope.today': 'Today',
      'usage.modelScope.week': 'Last 7 days',
      'usage.modelScope.all': 'All time',
      'usage.modelSortHint.today': 'Sorted by tokens used today, largest first',
      'usage.modelSortHint.week': 'Sorted by tokens in the last 7 days, largest first',
      'usage.modelSortHint.all': 'Sorted by all-time tokens, largest first',
      'usage.modelBar.today': '{model}: {total} tokens today',
      'usage.modelBar.week': '{model}: {total} tokens in the last 7 days',
      'usage.modelBar.all': '{model}: {total} tokens in total',
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
      'quota.window.credit-limit': 'Credit quota',
      'quota.window.credits': 'Credits used',
      'quota.window.balance': 'Balance',
      'quota.window.weekly': 'This week',
      'quota.window.monthly': 'This month',
      'quota.window.codex-5h': 'Codex 5-hour window',
      'quota.window.codex-day': 'Codex daily window',
      'quota.window.codex-week': 'Codex weekly window',
      'quota.window.codex-month': 'Codex monthly window',
      'quota.panel.title': 'Quota usage',
      'quota.panel.used': 'Used',
      'quota.panel.remaining': 'Remaining',
      'quota.ring.label': 'Quota lookup',
      'quota.updated': 'Updated {time}',
      'quota.refreshing': 'Refreshing…',
      'quota.empty': 'No data yet',
      'quota.resetIn': 'Resets in {time}',
      'quota.resetCard.title': 'Reset card',
      'quota.resetCard.expires': 'expires {date}',
      'quota.resetCard.expired': 'expired',
      'quota.resetCard.edit': 'Add reset card',
      'quota.resetCard.dateLabel': 'Expiry date',
      'quota.resetCard.nameLabel': 'Name (optional)',
      'quota.resetCard.add': 'Add',
      'quota.resetCard.cancel': 'Cancel',
      'quota.resetCard.remove': 'Remove',
      'quota.retryAt': 'Retry allowed after {time}',
      'quota.refresh': 'Refresh',
      'quota.card.moveUp': 'Move up',
      'quota.card.moveDown': 'Move down',
      'quota.reorder': 'Reorder',
      'quota.usageLink': 'Open the official usage page',
      'quota.adapt': 'Adapt',
      'quota.kind.opencode-go': 'OpenCode Go',
      'quota.kind.zai-coding-cn': 'Zhipu GLM Coding Plan',
      'quota.kind.openrouter': 'OpenRouter',
      'quota.kind.kimi': 'Kimi / Moonshot',
      'quota.kind.siliconflow': 'SiliconFlow',
      'quota.kind.cliproxy': 'CLIProxyAPI accounts',
      'quota.kind.deepseek': 'DeepSeek Platform',
      'quota.kindAuto': 'Auto-detected',
      'quota.noAdapted': 'No adapted providers yet — adapt manually below',
      'quota.disable': 'Disable',
      'quota.followAuto': 'Follow auto-detect',
      'quota.addAdapt': 'Manual adapt:',
      'quota.addPickProvider': 'Pick provider',
      'quota.addPickKind': 'Pick type',
      'quota.saveFailed': 'Save failed: {error}',
      'quota.unknownProvider': 'Unknown provider',
      'quota.error.credential-missing': 'Credential missing (set the API key in DSH credentials)',
      'quota.error.no-base-url': 'This provider has no baseURL configured',
      'quota.error.credentials-unavailable': 'Credential service unavailable',
      'quota.error.http-status': 'Upstream returned an error status',
      'quota.error.network': 'Network error',
      'quota.error.network-transient': 'Unstable network (auto-retried)',
      'quota.error.timeout': 'Request timed out',
      'quota.error.bad-payload': 'Unexpected response format',
      'quota.error.mgmt-disabled': 'CLIProxyAPI management API disabled (remote-management secret-key not set)',
      'quota.error.host-not-pinned': 'baseURL differs from the domain recorded when adapting; save the adapter again',
      'quota.error.upstream-status': 'Upstream official API returned an error status',
      'quota.credential.edit': 'Set API credential',
      'quota.credential.editManagement': 'Set management key (web login key)',
      'quota.credential.nameLabel': 'Credential name',
      'quota.credential.valueLabel': 'Secret value',
      'quota.credential.save': 'Save',
      'quota.credential.primary': 'primary (one alias is enough)',
      'quota.credential.clear': 'Clear stored',
      'quota.credential.clearConfirm': 'Click again to clear',
      'quota.credential.configured': 'configured',
      'quota.credential.notConfigured': 'not set',
      'quota.credential.saveFailed': 'Failed to save credential: {error}',
      'quota.credential.unknown-hint': 'Unknown credential name',
      'quota.credential.invalid-value': 'Secret value must not be empty',
      'quota.credential.credentials-unavailable': 'Credential service unavailable',
      'quota.error.unknown': 'Unknown error',
      'quota.unadapted': 'Not adapted: pick a provider kind below first',
      'quota.unit.day': '{count} d',
      'quota.unit.hour': '{count} h',
      'quota.unit.minute': '{count} min',
      'quota.window.granted-balance': 'Granted balance (unexpired)',
      'quota.peak.nowIdle': 'Off-peak now · half price',
      'quota.peak.nowPeak': 'Peak now · standard price',
      'quota.peak.untilIdle': 'Half price from {time} (in {dur})',
      'quota.peak.untilPeak': 'Peak pricing from {time} (in {dur})',
      'quota.peak.tag.peak': 'Peak',
      'quota.peak.tag.idle': 'Off-peak',
      'quota.peak.caption': 'Off-peak price is half the peak price. Peak hours (GMT+8): Mon–Fri 09:00–12:00 and 14:00–18:00. All other times are off-peak, including all day Saturday and Sunday.',
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
    // 技能 = 书本轮廓（lucide book 风格，16px 下可读）
    const NAV_ICON_BODY_SKILLS = '%3Cpath d=%27M4 19.5A2.5 2.5 0 0 1 6.5 17H20%27/%3E%3Cpath d=%27M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z%27/%3E'
    // 子代理 = 机器人头（lucide bot 风格，16px 下可读）
    const NAV_ICON_BODY_SUBAGENT = '%3Cpath d=%27M12 8V4H8%27/%3E%3Crect width=%2716%27 height=%2712%27 x=%274%27 y=%278%27 rx=%272%27/%3E%3Cpath d=%27M2 14h2%27/%3E%3Cpath d=%27M20 14h2%27/%3E%3Cpath d=%27M15 13v2%27/%3E%3Cpath d=%27M9 13v2%27/%3E'

    function markSettingsNavRows(rows) {
      if (typeof document === 'undefined' || !document.body) return () => {}
      let disposed = false
      const sync = () => {
        if (disposed) return
        // 设置页没开（无 dialog）就没有可标记的行：一次 querySelector 早退。
        // observer 盯的是整个 body（语言切换重挂要靠它），没有这道闸聊天流式输出期间
        // 每批文本突变都会触发一次全文档 querySelectorAll 扫描。
        if (typeof document.querySelector === 'function' && document.querySelector('[role="dialog"]') === null) return
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
      // rAF 合并：突变风暴（流式输出/列表重排）下每帧至多跑一次 sync；无 rAF 环境退化为直跑。
      let frame = null
      const scheduleSync = () => {
        if (disposed || frame !== null) return
        if (typeof requestAnimationFrame !== 'function') {
          sync()
          return
        }
        frame = requestAnimationFrame(() => {
          frame = null
          sync()
        })
      }
      const observer = new MutationObserver(scheduleSync)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      return () => {
        disposed = true
        observer.disconnect()
        if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        frame = null
        for (const row of rows) {
          for (const el of document.querySelectorAll('[' + row.attr + ']')) el.removeAttribute(row.attr)
        }
      }
    }

    const inject = ['slots', 'connection', 'timer', 'locale', 'sessions', 'settingsScope']

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
          '[data-dsh-service-nav]>svg:first-child,[data-dsh-service-quota-nav]>svg:first-child,[data-dsh-service-restart-nav]>svg:first-child,[data-dsh-service-skills-nav]>svg:first-child,[data-dsh-service-subagent-nav]>svg:first-child{display:none}',
          '[data-dsh-service-nav]::before,[data-dsh-service-quota-nav]::before,[data-dsh-service-restart-nav]::before,[data-dsh-service-skills-nav]::before,[data-dsh-service-subagent-nav]::before{content:\'\';flex:none;width:16px;height:16px;background:currentColor}',
          '[data-dsh-service-nav]::before{' + navIconMask(NAV_ICON_BODY_SERVICE) + '}',
          '[data-dsh-service-quota-nav]::before{' + navIconMask(NAV_ICON_BODY_QUOTA) + '}',
          '[data-dsh-service-skills-nav]::before{' + navIconMask(NAV_ICON_BODY_SKILLS) + '}',
          '[data-dsh-service-subagent-nav]::before{' + navIconMask(NAV_ICON_BODY_SUBAGENT) + '}',
          '[data-dsh-service-restart-nav]::before{' + navIconMask(NAV_ICON_BODY_RESTART) + '}',
        ].join('')
        document.head.appendChild(svcStyle)
      }
      ctx.effect(() => () => { if (svcStyle) svcStyle.remove() }, 'dsh-service theme styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-service dictionaries')
      const t = ctx.locale.bind(NS)
      // 当前生效界面语言（显式设置 > 浏览器语言 > en 兜底，locale 快照已折算）：'zh' | 'en'。
      // 供 AI 补全等宿主侧语言相关动作取用；宿主只收枚举，不收自由文本。
      const currentUiLocale = () => ((ctx.locale?.getSnapshot?.()?.active) === 'zh' ? 'zh' : 'en')
      const DEFAULT_FEATURES = { modelUsage: true, quotaLookup: true, backupMaintenance: true, taskNotifications: true, healthz: true, skillManager: true, subagentRoute: true }
      const featureScope = ctx.settingsScope.bind({ namespace: NS })
      const featureSnapshot = () => featureScope.getSnapshot()
      const featureValue = () => Object.assign({}, DEFAULT_FEATURES, featureSnapshot().value || {})
      const featureEnabled = (key) => featureValue()[key] !== false
      const useFeatures = () => {
        const [snapshot, setSnapshot] = React.useState(featureSnapshot())
        React.useEffect(() => featureScope.subscribe(() => setSnapshot(featureSnapshot())), [])
        return { snapshot, value: Object.assign({}, DEFAULT_FEATURES, snapshot.value || {}) }
      }
      // 设置页左列三行打标记，配合上方样式换成各自图标；label 走 locale 绑定值。
      ctx.effect(
        () => markSettingsNavRows([
          { attr: 'data-dsh-service-nav', label: () => t('nav.label') },
          { attr: 'data-dsh-service-quota-nav', label: () => t('tabs.quota') },
          { attr: 'data-dsh-service-restart-nav', label: () => t('nav.restart') },
          { attr: 'data-dsh-service-skills-nav', label: () => t('tabs.skills') },
          { attr: 'data-dsh-service-subagent-nav', label: () => t('tabs.subagent') },
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
      // 设置页左列入口开关的通用实现（重启/额度/技能三个入口共用，不再三套复制）：
      // localStorage 持久化、默认关；开启才注册 settings.section 条目、关闭即注销——
      // 导航列单元格由外壳渲染，null 内容不能隐藏导航项。feature 可选：功能关闭时同样注销。
      const createNavEntryToggle = ({ storageKey, sectionId, order, labelKey, feature, renderContent }) => {
        let enabled = false
        try { enabled = localStorage.getItem(storageKey) === 'true' } catch (_) {}
        let dispose = null
        const listeners = new Set()
        const sync = () => {
          if (dispose) { dispose(); dispose = null }
          if (!enabled || (feature !== undefined && !featureEnabled(feature))) return
          dispose = ctx.slots.register(
            { name: 'settings.section', id: sectionId, order, label: () => t(labelKey) },
            renderContent,
          )
        }
        const setEnabled = (value) => {
          enabled = value === true
          try { localStorage.setItem(storageKey, enabled ? 'true' : 'false') } catch (_) {}
          sync()
          for (const listener of listeners) listener()
        }
        const useEnabled = () => {
          const [state, setState] = useState(enabled)
          useEffect(() => {
            const update = () => setState(enabled)
            listeners.add(update)
            setState(enabled)
            return () => listeners.delete(update)
          }, [])
          return [state, setEnabled]
        }
        const disposeEntry = () => {
          if (dispose) { dispose(); dispose = null }
        }
        return { sync, setEnabled, useEnabled, disposeEntry }
      }
      const restartNavToggle = createNavEntryToggle({ storageKey: 'dsh-service-restart-nav', sectionId: 'dsh-service-restart', order: 499, labelKey: 'nav.restart', renderContent: () => React.createElement(RestartSection, null) })
      const quotaNavToggle = createNavEntryToggle({ storageKey: 'dsh-service-quota-nav', sectionId: 'dsh-service-quota', order: 498, labelKey: 'tabs.quota', feature: 'quotaLookup', renderContent: () => React.createElement(QuotaSection, null) })
      const skillsNavToggle = createNavEntryToggle({ storageKey: 'dsh-service-skills-nav', sectionId: 'dsh-service-skills', order: 497, labelKey: 'tabs.skills', feature: 'skillManager', renderContent: () => React.createElement(SkillsSection, null) })
      const subagentNavToggle = createNavEntryToggle({ storageKey: 'dsh-service-subagent-nav', sectionId: 'dsh-service-subagent', order: 496, labelKey: 'tabs.subagent', feature: 'subagentRoute', renderContent: () => React.createElement(SubagentSection, null) })
      // ── 批量补全共享状态：跨标签/设置面板开关存活（宿主任务本身不随 UI 停止）──
      let skillsBatchState = null       // 宿主状态快照
      let skillsBatchPlan = null        // 本端计划（含所选模型）
      let skillsBatchModels = null      // 模型清单缓存（null=未拉取，[]=不可用）
      let skillsBatchModelItem = null   // 批量选中的模型
      let skillsBatchError = ''
      let skillsBatchListDirty = false  // 落定后请挂载中的列表自刷新
      let skillsBatchPollHandle = null
      const skillsBatchListeners = new Set()
      const publishSkillsBatch = () => { for (const listener of skillsBatchListeners) listener() }
      const skillsBatchPollStop = () => {
        if (skillsBatchPollHandle !== null) { clearInterval(skillsBatchPollHandle); skillsBatchPollHandle = null }
      }
      const syncSkillsBatchPolling = () => {
        // 功能关闭时不轮询（宿主也会拒绝 skill-* RPC）；重开后由下一次交互重新拉起。
        const shouldPoll = skillsBatchState !== null && skillsBatchState.phase === 'running' && featureEnabled('skillManager')
        if (shouldPoll && skillsBatchPollHandle === null) {
          const tick = async () => {
            try {
              const res = await ctx.connection.rpc.call('/dsh-service', 'skills-batch-status', {})
              if (!res.ok) return
              const previousPhase = skillsBatchState !== null ? skillsBatchState.phase : null
              skillsBatchState = res.value
              if (previousPhase === 'running' && res.value.phase !== 'running') {
                // 落定：停止轮询，请挂载中的列表刷新 annotated 标记。
                skillsBatchPollStop()
                skillsBatchListDirty = true
              }
              publishSkillsBatch()
            } catch (_) {}
          }
          void tick()
          skillsBatchPollHandle = setInterval(() => void tick(), 2000)
        }
      }
      const fetchSkillsBatchModels = async () => {
        if (skillsBatchModels !== null) return skillsBatchModels
        try {
          const res = await ctx.connection.rpc.call('/dsh-service', 'skills-models', {})
          if (!res.ok) { skillsBatchModels = []; return skillsBatchModels }
          skillsBatchModels = res.value.models ?? []
          if (skillsBatchModelItem === null) skillsBatchModelItem = resolveSkillModelChoice(skillsBatchModels, res.value.current)
        } catch (_) { skillsBatchModels = [] }
        return skillsBatchModels
      }
      const changeSkillsBatchModel = (key) => {
        const item = (skillsBatchModels ?? []).find((candidate) => skillModelKey(candidate) === key) ?? null
        skillsBatchModelItem = item
        if (item !== null) {
          try { localStorage.setItem(SKILLS_MODEL_STORAGE_KEY, JSON.stringify({ provider: item.provider, model: item.id })) } catch (_) {}
        }
        publishSkillsBatch()
      }
      const adoptSkillsBatchStatus = async () => {
        try {
          const res = await ctx.connection.rpc.call('/dsh-service', 'skills-batch-status', {})
          if (res.ok && res.value.phase !== 'idle') {
            skillsBatchState = res.value
            syncSkillsBatchPolling()
            publishSkillsBatch()
          }
        } catch (_) {}
      }
      const planSkillsBatchShared = async () => {
        skillsBatchError = ''
        publishSkillsBatch()
        const models = await fetchSkillsBatchModels()
        if (models.length === 0 || skillsBatchModelItem === null) { skillsBatchError = 'models-empty'; publishSkillsBatch(); return false }
        try { localStorage.setItem(SKILLS_MODEL_STORAGE_KEY, JSON.stringify({ provider: skillsBatchModelItem.provider, model: skillsBatchModelItem.id })) } catch (_) {}
        const res = await ctx.connection.rpc.call('/dsh-service', 'skills-batch-plan', { provider: skillsBatchModelItem.provider, model: skillsBatchModelItem.id })
        if (!res.ok) { skillsBatchError = res.error || 'unknown'; publishSkillsBatch(); return false }
        skillsBatchPlan = { ...res.value, modelItem: skillsBatchModelItem }
        skillsBatchState = { phase: 'planned', total: res.value.candidates.length, done: 0, failures: [], current: null, estBytes: res.value.estBytes, logs: [] }
        syncSkillsBatchPolling()
        publishSkillsBatch()
        return true
      }
      const startSkillsBatchShared = async () => {
        if (skillsBatchPlan === null || skillsBatchState === null) return false
        const res = await ctx.connection.rpc.call('/dsh-service', 'skills-batch-run', { planId: skillsBatchPlan.planId, lang: currentUiLocale() })
        if (!res.ok) { skillsBatchError = res.error || 'unknown'; publishSkillsBatch(); return false }
        skillsBatchState = { ...skillsBatchState, phase: 'running' }
        syncSkillsBatchPolling()
        publishSkillsBatch()
        return true
      }
      const cancelSkillsBatchShared = async () => {
        try { await ctx.connection.rpc.call('/dsh-service', 'skills-batch-cancel', {}) } catch (_) {}
      }
      const useSkillsBatch = () => {
        const [, bump] = useState(0)
        useEffect(() => {
          const update = () => bump((v) => v + 1)
          skillsBatchListeners.add(update)
          return () => skillsBatchListeners.delete(update)
        }, [])
        return { batch: skillsBatchState, plan: skillsBatchPlan, models: skillsBatchModels, modelItem: skillsBatchModelItem, error: skillsBatchError }
      }
      // 轮询器归属当前 Fiber（AGENTS.md 生命周期不变量）：插件停止即停表；
      // 功能开关关闭也停表。放在 useSkillsBatch 之后——这里引用的函数都已就绪。
      ctx.effect(() => {
        const unsubscribe = featureScope.subscribe(() => {
          if (!featureEnabled('skillManager')) skillsBatchPollStop()
        })
        return () => {
          unsubscribe()
          skillsBatchPollStop()
        }
      }, 'dsh-service skills batch polling lifecycle')
      // 页面刷新/插件重载后自动采纳宿主现存批量任务：不再依赖用户先进入技能页，
      // ⟳ 角标与轮询在工厂启动即恢复（孤儿计划恢复的另一半闭环）。
      void adoptSkillsBatchStatus()
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
      const getModelDirectories = () => {
        try {
          if (typeof ctx.get === 'function') return ctx.get('modelDirectories')
        } catch (_) {}
        return undefined
      }
      // 会话活跃态（sessions.list 快照派生，订阅推送更新）：任务通知和后台额度轮询共享这一事实源。
      // 两项都关闭时彻底摘除订阅；任一重新开启时重新建立当前快照基线，不补发关闭期间的旧边沿。
      const sessionActivity = { anyRunning: false, runningSessionIds: new Set() }
      if (ctx.sessions && typeof ctx.sessions.list?.subscribe === 'function') {
        const observed = new Map()
        let baselined = false
        let sessionsDispose = null
        let resetDispose = null
        const observeSessions = () => {
          const snapshot = ctx.sessions.list.getSnapshot()
          if (!snapshot || !snapshot.byId) return
          sessionActivity.runningSessionIds = new Set(Object.entries(snapshot.byId).filter(([, summary]) => summary.running === true).map(([id]) => id))
          sessionActivity.anyRunning = sessionActivity.runningSessionIds.size > 0
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
              if (prev.running && !next.running && featureEnabled('taskNotifications') && notifyEnabled && notifyDone) {
                fireNotification(t('notification.doneTitle'), t('notification.doneBody', { title: summary.displayTitle || id }))
              }
              if (!prev.pending && next.pending && featureEnabled('taskNotifications') && notifyEnabled && notifyInput) {
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
          // agent 启动时轮询链可能已因「隐藏页跳过周期」而死（runQuotaCycle 跳过即不再排下一轮）：
          // 有活跃会话就重新拉起排程（幂等：已有挂起定时器/refs=0/仅手动时 no-op）。
          if (sessionActivity.anyRunning) scheduleQuotaCycle()
        }
        const stopSessionObservation = () => {
          if (sessionsDispose !== null) { sessionsDispose(); sessionsDispose = null }
          if (resetDispose !== null) { resetDispose(); resetDispose = null }
          observed.clear()
          baselined = false
          sessionActivity.anyRunning = false
          sessionActivity.runningSessionIds = new Set()
        }
        const syncSessionObservation = () => {
          const needed = featureEnabled('taskNotifications') || featureEnabled('quotaLookup')
          if (!needed) { stopSessionObservation(); return }
          if (sessionsDispose !== null) return
          sessionsDispose = ctx.sessions.list.subscribe(() => observeSessions())
          resetDispose = ctx.on('connection/reset', () => { observed.clear(); baselined = false })
          observeSessions()
        }
        syncSessionObservation()
        const unsubscribeFeatures = featureScope.subscribe(syncSessionObservation)
        ctx.effect(() => () => {
          unsubscribeFeatures()
          stopSessionObservation()
        }, 'dsh-service: shared session observation')
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
        const [navEnabled, setNavEnabled] = restartNavToggle.useEnabled()
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
      const QUOTA_KIND_OPTIONS = ['opencode-go', 'zai-coding-cn', 'openrouter', 'kimi', 'siliconflow', 'deepseek', 'cliproxy']
      function readQuotaPollMinutes() {
        try {
          const raw = Number.parseInt(localStorage.getItem(QUOTA_POLL_KEY), 10)
          return QUOTA_POLL_CHOICES.includes(raw) ? raw : 0
        } catch (_) {
          return 0
        }
      }
      function writeQuotaPollMinutes(minutes) {
        try { localStorage.setItem(QUOTA_POLL_KEY, String(minutes)) } catch (_) {}
      }
      const QUOTA_CARD_ORDER_KEY = 'dsh-service-quota-card-order'
      // 卡片手动排序（用户点名）：localStorage 只存 provider 名单；坏形状/超限整体回退快照序。
      function readQuotaCardOrder() {
        try {
          const raw = JSON.parse(localStorage.getItem(QUOTA_CARD_ORDER_KEY) ?? 'null')
          if (!Array.isArray(raw)) return []
          return raw.filter((name) => typeof name === 'string' && name !== '').slice(0, 64)
        } catch (_) {
          return []
        }
      }
      function writeQuotaCardOrder(order) {
        try { localStorage.setItem(QUOTA_CARD_ORDER_KEY, JSON.stringify(order.slice(0, 64))) } catch (_) {}
      }
      /** 快照序 → 记忆序：名单内的按存储位次在前，名单外的保持快照相对顺序追加在后。 */
      function applyQuotaCardOrder(rows, order) {
        const rank = new Map(order.map((name, index) => [name, index]))
        return rows
          .map((row, index) => ({ row, key: rank.has(row.provider) ? rank.get(row.provider) : order.length + index }))
          .sort((a, b) => a.key - b.key)
          .map((entry) => entry.row)
      }
      let quotaSnapshotPromise = null
      let quotaSnapshotQueuedPayload = null
      function normalizedQuotaPayload(payload) {
        if (payload?.scope === 'all') return { scope: 'all' }
        const providers = Array.isArray(payload?.providers) ? [...new Set(payload.providers.filter((provider) => typeof provider === 'string' && provider !== ''))].sort() : []
        return { providers }
      }
      function mergeQuotaPayload(current, next) {
        if (current?.scope === 'all' || next?.scope === 'all') return { scope: 'all' }
        return normalizedQuotaPayload({ providers: [...(current?.providers ?? []), ...(next?.providers ?? [])] })
      }
      async function fetchQuotaSnapshot(payload = { providers: [] }) {
        const requested = normalizedQuotaPayload(payload)
        if (quotaSnapshotPromise !== null) {
          quotaSnapshotQueuedPayload = mergeQuotaPayload(quotaSnapshotQueuedPayload, requested)
          return quotaSnapshotPromise
        }
        quotaSnapshotPromise = Promise.resolve().then(async () => {
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'quota', requested)
            if (res?.ok === true && res.value && typeof res.value === 'object' && Array.isArray(res.value.providers)) {
              quotaStore.publish(res.value)
              scheduleQuotaSettlePull(res.value, requested)
              return true
            }
          } catch (_) {}
          return false
        }).finally(() => {
          quotaSnapshotPromise = null
          const queued = quotaSnapshotQueuedPayload
          quotaSnapshotQueuedPayload = null
          if (queued !== null) fetchQuotaSnapshot(queued)
        })
        return quotaSnapshotPromise
      }
      function runningQuotaProviders() {
        const models = getModelDirectories()
        if (models === undefined || typeof models.directoryFor !== 'function') return []
        const providers = []
        for (const sessionId of sessionActivity.runningSessionIds) {
          try {
            const current = models.directoryFor(sessionId)?.store?.getSnapshot?.()?.current
            if (typeof current?.provider === 'string' && current.provider !== '') providers.push(current.provider)
          } catch (_) {}
        }
        return [...new Set(providers)]
      }
      // 落定接续：快照里仍有「刷新中」的已适配行时，客户端按拉长的间隔自动补拉，
      // 直到上游落定或用尽轮次——否则首次打开只会看到「刷新中…」，要等下一个轮询周期
      // 或再次点开才能看到更新时间。补拉仍是普通 quota RPC，宿主节流闸
      // （单飞/TTL/退避）照常兜底，不会产生额外上游调用。
      const quotaSettle = { pulls: 0, dispose: null }
      const QUOTA_SETTLE_DELAYS_MS = [800, 2400, 4800, 8000, 12000]
      function scheduleQuotaSettlePull(snapshot, payload = { providers: [] }) {
        const pending = Array.isArray(snapshot?.providers)
          && snapshot.providers.some((row) => row.adapted === true && row.refreshing === true)
        if (!pending) {
          quotaSettle.pulls = 0
          return
        }
        // 表面都已卸载（refs=0）或用尽轮次：不再追问；refs 归零时轮次计数同步复位，重挂载从 800ms 重新起算。
        if (quotaLoop.refs === 0) {
          quotaSettle.pulls = 0
          return
        }
        if (quotaSettle.dispose !== null || quotaSettle.pulls >= QUOTA_SETTLE_DELAYS_MS.length) return
        quotaSettle.dispose = ctx.timer.timeout(() => {
          quotaSettle.dispose = null
          fetchQuotaSnapshot(payload)
        }, QUOTA_SETTLE_DELAYS_MS[quotaSettle.pulls])
        quotaSettle.pulls += 1
      }
      const quotaLoop = { refs: 0, allRefs: 0, nextDispose: null, running: false, onVisible: undefined }
      const isTabHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
      function scheduleQuotaCycle() {
        if (!featureEnabled('quotaLookup') || quotaLoop.refs === 0 || quotaLoop.nextDispose !== null || readQuotaPollMinutes() <= 0) return
        const minutes = readQuotaPollMinutes()
        quotaLoop.nextDispose = ctx.timer.timeout(() => {
          quotaLoop.nextDispose = null
          runQuotaCycle()
        }, minutes * 60000)
      }
      function runQuotaCycle() {
        if (!featureEnabled('quotaLookup') || quotaLoop.refs === 0 || quotaLoop.running) return
        // 额度页打开时全量；其余自动/后台轮询只刷新 running 会话供应商。
        const payload = quotaLoop.allRefs > 0 ? { scope: 'all' } : { providers: runningQuotaProviders() }
        if (payload.scope !== 'all' && payload.providers.length === 0) return
        quotaLoop.running = true
        Promise.resolve(fetchQuotaSnapshot(payload)).catch(() => false).then(() => {
          quotaLoop.running = false
          scheduleQuotaCycle()
        })
      }
      function acquireQuotaLoop(options = {}) {
        if (!featureEnabled('quotaLookup')) return
        quotaLoop.refs += 1
        if (options.all === true) quotaLoop.allRefs += 1
        // 额度页显式全量；圆环等其他表面由当前交互/后台活跃集合决定目标。
        if (options.all === true) fetchQuotaSnapshot({ scope: 'all' })
        else runQuotaCycle()
        scheduleQuotaCycle()
        // visibilitychange 只在首个表面挂载时挂一次、最后一个卸载时摘掉——
        // 之前每次挂载都 addEventListener 且只留最后一个引用，先挂的监听器会泄漏到 Fiber 之外。
        if (quotaLoop.refs === 1 && quotaLoop.onVisible === undefined && typeof document !== 'undefined') {
          quotaLoop.onVisible = () => {
            if (!isTabHidden()) runQuotaCycle()
          }
          document.addEventListener('visibilitychange', quotaLoop.onVisible)
        }
      }
      function releaseQuotaLoop(options = {}) {
        if (!featureEnabled('quotaLookup') && quotaLoop.refs === 0) return
        quotaLoop.refs = Math.max(0, quotaLoop.refs - 1)
        if (options.all === true) quotaLoop.allRefs = Math.max(0, quotaLoop.allRefs - 1)
        if (quotaLoop.refs > 0) return
        if (quotaLoop.nextDispose !== null) {
          quotaLoop.nextDispose()
          quotaLoop.nextDispose = null
        }
        if (quotaSettle.dispose !== null) {
          quotaSettle.dispose()
          quotaSettle.dispose = null
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
        if (quotaSettle.dispose !== null) quotaSettle.dispose()
        if (quotaLoop.onVisible !== undefined && typeof document !== 'undefined') document.removeEventListener('visibilitychange', quotaLoop.onVisible)
      }, 'dsh-service quota poller disposal')

      function quotaWindowLabel(id, translate) {
        // 解析链：完整 id（rolling / tokens-limit-u3-n5…）→ 类型前缀（tokens-limit/time-limit/credit-limit）→ 原始 id。
        const exact = translate(`quota.window.${id}`)
        if (exact !== `quota.window.${id}`) return exact
        const parts = String(id).split('-')
        const prefix = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : parts[0]
        const byType = translate(`quota.window.${prefix}`)
        return byType === `quota.window.${prefix}` ? id : byType
      }
      /** 窗口展示文案（v0.24 cliproxy 起支持两段式）：宿主下发 label（账号标识，纯数据）与
       * kindKey（稳定代码），本地化拼接「<账号> · <窗口名>」在客户端完成——宿主不拼用户可见句子
       * （双语教义）。无 kindKey 的旧窗口走 quotaWindowLabel 原解析链；kindKey 未收录时裸用
       * 模型名兜底（比拼凑 id 可读）。 */
      function quotaWindowDisplayLabel(window, translate) {
        const hasKindKey = typeof window.kindKey === 'string' && window.kindKey !== ''
        const kindSource = hasKindKey ? window.kindKey : window.id
        let kindText = translate(`quota.window.${kindSource}`)
        if (kindText === `quota.window.${kindSource}`) {
          if (hasKindKey) {
            const byId = translate(`quota.window.${window.id}`)
            kindText = byId !== `quota.window.${window.id}` ? byId : kindSource
          } else {
            kindText = quotaWindowLabel(window.id, translate)
          }
        }
        const account = typeof window.label === 'string' ? window.label.trim() : ''
        return account !== '' ? `${account} · ${kindText}` : kindText
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

      // ─── DeepSeek 峰谷时段（v0.25）───────────────────────────────────────────
      // 官方计费口径：空闲时段价格为高峰的一半。高峰 = 北京时间周一至周五 9:00–12:00、14:00–18:00；
      // 其余全为空闲（周六日全天空闲）。北京时间固定 UTC+8 无夏令时：nowMs 平移 8h 后读 UTC 字段即得。
      const DEEPSEEK_PEAK_SEGMENTS = [[540, 720], [840, 1080]] // 当日分钟数（北京零点起算）
      const DEEPSEEK_PEAK_COLOR = '#f0952f'
      const DEEPSEEK_IDLE_COLOR = 'var(--dsw-alias-state-success-primary)'
      const DEEPSEEK_PEAK_TICK_MS = 30000
      // 换挡倒计时用数字钟时刻（formatBeijingClockTime），无 boundary 类词典键。
      // 色带无外部刻度：只画两段——当前时段剩余 + 下一个相反时段（可跨天，用户点名隐藏
      // 过去时间），左缘细标线即当前时刻，段内短词「忙时/闲时」过窄自动隐藏。
      function beijingCivilParts(nowMs) {
        const shifted = new Date(nowMs + 8 * 3600 * 1000)
        return { dayIndex: shifted.getUTCDay(), minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() }
      }
      function deepseekIsPeakMinute(dayIndex, minutesOfDay) {
        if (dayIndex === 0 || dayIndex === 6) return false
        return DEEPSEEK_PEAK_SEGMENTS.some(([start, end]) => minutesOfDay >= start && minutesOfDay < end)
      }
      /** 从当前时刻起收集前 count 个峰谷切换时刻（毫秒，升序）。
       * 工作日的四个边界点必为状态翻转；周末无边界。最坏情形（周五 18:00 后）下个翻转在
       * 周一 09:00，扫 7 天必然覆盖（现有调用最多取 2 个）。 */
      function deepseekUpcomingFlips(nowMs, count) {
        const shifted = new Date(nowMs + 8 * 3600 * 1000)
        shifted.setUTCHours(0, 0, 0, 0)
        const beijingDayStart = shifted.getTime() - 8 * 3600 * 1000
        const flips = []
        for (let dayOffset = 0; dayOffset <= 6 && flips.length < count; dayOffset++) {
          const dayStart = beijingDayStart + dayOffset * 86400000
          const dayIndex = new Date(dayStart + 8 * 3600 * 1000).getUTCDay()
          if (dayIndex === 0 || dayIndex === 6) continue
          for (const minute of DEEPSEEK_PEAK_SEGMENTS.flat()) {
            const candidate = dayStart + minute * 60000
            if (candidate <= nowMs) continue
            flips.push(candidate)
            if (flips.length >= count) return flips
          }
        }
        return flips
      }
      function formatBeijingClockTime(ms) {
        const shifted = new Date(ms + 8 * 3600 * 1000)
        const digits = (value) => String(value).padStart(2, '0')
        return `${digits(shifted.getUTCHours())}:${digits(shifted.getUTCMinutes())}`
      }

      /** 峰谷块显隐判定：仅 DeepSeek 行且有窗口数据（额度卡与圆环面板共用一处口径）。 */
      function deepseekPeakVisible(row, windows) {
        return row?.kind === 'deepseek' && Array.isArray(windows) && windows.length > 0
      }

      /** DeepSeek 余额卡专属的峰谷提示块：当前状态徽标 + 数字钟换挡倒计时、两段式峰谷色带
       * （橙=高峰、绿=空闲；当前时段剩余 + 下一个相反时段，可跨天）、左缘细标线即当前时刻，
       * 规则说明行可选。额度卡与圆环面板共用，圆环面板窄所以不渲染说明行（showCaption:false）。
       * 时刻推进用 ctx.timer 自续链而非 setInterval：测试桩里不会留真实定时器挂住进程，卸载即断链。 */
      function QuotaPeakTimeline({ showCaption }) {
        const translate = useTranslation()
        // 测试桩的 useState 不调用函数式初始化器，直接传值（多算一次 Date.now 无副作用）。
        const [now, setNow] = useState(Date.now())
        useEffect(() => {
          let disposed = false
          let disposer = null
          const schedule = () => {
            if (disposed) return
            disposer = ctx.timer.timeout(() => {
              setNow(Date.now())
              schedule()
            }, DEEPSEEK_PEAK_TICK_MS)
          }
          schedule()
          return () => {
            disposed = true
            if (disposer !== null && disposer !== undefined) disposer()
          }
        }, [])
        const civil = beijingCivilParts(now)
        const inPeak = deepseekIsPeakMinute(civil.dayIndex, civil.minutesOfDay)
        const flips = deepseekUpcomingFlips(now, 2)
        const nextFlip = flips[0] ?? null
        const accentColor = inPeak ? DEEPSEEK_PEAK_COLOR : DEEPSEEK_IDLE_COLOR
        // pctOf 复用 /1440 归一：传入「权重占比 ×1440」得到百分比（保留 4 位小数）。
        const pctOf = (minute) => Math.round((minute / 1440) * 1000000) / 10000
        return React.createElement('div', { 'data-testid': 'quota-peak-timeline', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', minHeight: '16px' } },
            React.createElement('span', {
              'data-testid': 'quota-peak-state',
              'data-in-peak': String(inPeak),
              // nowrap + flexShrink:0：容器过窄时整块折行，绝不把文字挤成一列竖排（用户点名）。
              style: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', lineHeight: '16px', color: accentColor, whiteSpace: 'nowrap', flexShrink: 0 },
            },
            React.createElement('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: accentColor, flexShrink: 0 } }),
            translate(inPeak ? 'quota.peak.nowPeak' : 'quota.peak.nowIdle')),
            nextFlip !== null ? React.createElement('span', {
              'data-testid': 'quota-peak-next',
              style: { marginLeft: 'auto', fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' },
            }, translate(inPeak ? 'quota.peak.untilIdle' : 'quota.peak.untilPeak', {
              time: formatBeijingClockTime(nextFlip),
              dur: humanizeDuration(nextFlip - now, translate),
            })) : null),
          React.createElement('div', {
            'data-testid': 'quota-peak-bar',
            style: { position: 'relative', height: '14px', borderRadius: 999, overflow: 'hidden', background: 'var(--dsw-alias-interactive-bg-hover)' },
          },
          // 两段式（用户点名）：第一段 = 当前时段剩余，第二段 = 下一个相反时段（可跨天），
          // 宽度按实际时长比例；段内只标「忙时/闲时」，过窄自动隐藏（精确时刻在倒计时与说明行）。
          (flips.length > 0 ? [
            { peak: inPeak, weight: flips[0] - now },
            ...(flips.length > 1 ? [{ peak: !inPeak, weight: flips[1] - flips[0] }] : []),
          ] : [{ peak: inPeak, weight: 1 }]).map((segment, index, all) => {
            const totalWeight = all.reduce((sum, part) => sum + part.weight, 0)
            const widthPct = pctOf(segment.weight / totalWeight * 1440)
            return React.createElement('span', {
              key: index,
              'data-testid': `quota-peak-segment-${index}`,
              'data-peak': String(segment.peak),
              style: { position: 'absolute', top: 0, bottom: 0, left: `${index === 0 ? 0 : pctOf(all[0].weight / totalWeight * 1440)}%`, width: `${widthPct}%`, background: segment.peak ? DEEPSEEK_PEAK_COLOR : DEEPSEEK_IDLE_COLOR, overflow: 'hidden' },
            },
            widthPct >= 11 ? React.createElement('span', { style: { position: 'absolute', inset: 0, textAlign: 'center', fontSize: '9px', lineHeight: '14px', fontWeight: 500, color: 'rgba(255,255,255,0.95)' } }, translate(segment.peak ? 'quota.peak.tag.peak' : 'quota.peak.tag.idle')) : null)
          }),
          // 左缘细标线即「当前」时刻（原移动圆点在 now 起点域下恒在左缘，退化为标线）。
          React.createElement('span', {
            'data-testid': 'quota-peak-now',
            style: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '3px', borderRadius: '3px', background: 'var(--dsw-specific-menu)' },
          })),
          showCaption === true ? React.createElement('div', {
            'data-testid': 'quota-peak-caption',
            style: { fontSize: '11px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)', marginTop: '2px' },
          }, translate('quota.peak.caption')) : null)
      }

      /** 手录重置卡的统一文案与过期态：卡片行与圆环面板共用。v0.20 起免次数。 */
      function resetCardContent(card, translate) {
        const rawExpiry = typeof card.expiresAt === 'string' && card.expiresAt.trim() !== '' ? card.expiresAt.trim() : ''
        const at = rawExpiry !== '' ? Date.parse(rawExpiry) : NaN
        const expired = Number.isFinite(at) && at < Date.now()
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
          title: `${translate('quota.resetCard.title')}${labelSuffix}`,
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
      /** 窗口行的统一渲染，圆环面板与额度卡共用（此前两处各写一份，配色/倒计时格式容易漂移）：
       * 百分比窗口三段式（标签+百分比 / 独立进度条 / 重置倒计时单独一行）；文本窗口（余额类）单行。
       * testid 约定：面板 quota-text|quota-window-bar|quota-reset-<id>；卡片 quota-card-window|bar|text|reset-<provider>-<id>。 */
      function renderQuotaWindowRow(window, translate, provider) {
        const inCard = provider !== null && provider !== undefined
        // 标签可能很长（cliproxy 是「账号 · 窗口名」两段式）：标签溢出省略，百分比整体不换行、不被挤压。
        const labelStyle = { color: 'var(--dsw-alias-label-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
        const valueStyle = { color: 'var(--dsw-alias-label-primary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0 }
        if (typeof window.text === 'string') {
          return React.createElement('div', {
            key: window.id,
            ...(inCard ? { 'data-testid': `quota-card-window-${provider}-${window.id}` } : {}),
            style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', lineHeight: '18px' },
          },
          React.createElement('span', { style: labelStyle }, quotaWindowDisplayLabel(window, translate)),
          React.createElement('span', {
            'data-testid': inCard ? `quota-card-text-${provider}-${window.id}` : `quota-text-${window.id}`,
            style: valueStyle,
          }, window.text))
        }
        let resetNode = null
        if (typeof window.resetsAt === 'string') {
          const at = Date.parse(window.resetsAt)
          if (Number.isFinite(at) && at > Date.now()) {
            resetNode = React.createElement('div', {
              'data-testid': inCard ? `quota-card-reset-${provider}-${window.id}` : `quota-reset-${window.id}`,
              style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' },
            }, translate('quota.resetIn', { time: humanizeDuration(at - Date.now(), translate) }))
          }
        }
        return React.createElement('div', {
          key: window.id,
          ...(inCard ? { 'data-testid': `quota-card-window-${provider}-${window.id}` } : {}),
        },
        React.createElement('div', { 'data-value': window.percent, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', lineHeight: '18px' } },
          React.createElement('span', { style: labelStyle }, quotaWindowDisplayLabel(window, translate)),
          React.createElement('span', { style: valueStyle }, `${window.percent}%`)),
        quotaBar(inCard ? `quota-card-bar-${provider}-${window.id}` : `quota-window-bar-${window.id}`, window.percent, '4px', window.remaining === true),
        resetNode)
      }

      // v0.21.1 圆环弹窗窄视口居中：宿主事实（别再翻外壳源码）——composer 工具行容器带
      // container-type:inline-size（布局包含：fixed 后代的 containing block 是它而非视口），
      // 外层会话滚动体又是 overflow:hidden auto，挂在 conversation.input.right 的弹层在手机上
      // 必然被裁一半，CSS 覆盖救不了。唯一可靠解法是 portal 到 document.body 后 fixed 视口居中。
      // react-dom 在平台 seed 表内（官方附件插件同源用 createPortal），老外壳可能缺席：
      // 惰性尝试，拿不到就回落原锚定弹层（与 modelDirectories 同款可选依赖哲学）。
      let quotaCreatePortal = null
      try {
        const reactDom = require('react-dom')
        if (reactDom !== null && reactDom !== undefined && typeof reactDom.createPortal === 'function') {
          quotaCreatePortal = reactDom.createPortal
        }
      } catch (_) {
        quotaCreatePortal = null
      }

      /** 窄视口判定：matchMedia 优先（可订阅变化），缺席时 innerWidth 兜底；
       * 无 window（SSR/测试）一律宽视口，维持圆环上方锚定弹层。断点 480px 与外壳窄容器一致。 */
      function quotaNarrowViewport() {
        if (typeof window === 'undefined' || window === null) return false
        if (typeof window.matchMedia === 'function') {
          const query = window.matchMedia('(max-width: 480px)')
          return typeof query.matches === 'boolean' ? query.matches : false
        }
        return typeof window.innerWidth === 'number' && window.innerWidth <= 480
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
          fetchQuotaSnapshot({ providers: [] })
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
        const panelRef = useRef(null)
        // 窄视口（手机竖屏）：弹层 portal 到 body 视口居中；宽视口保持圆环上方锚定。
        // matchMedia change 订阅让旋转/拖宽窗口时弹层几何实时迁移，open 态不丢。
        const [narrow, setNarrow] = useState(quotaNarrowViewport)
        useEffect(() => {
          if (typeof window === 'undefined' || window === null || typeof window.matchMedia !== 'function') return undefined
          const query = window.matchMedia('(max-width: 480px)')
          const sync = () => setNarrow(query.matches)
          sync()
          if (typeof query.addEventListener === 'function') query.addEventListener('change', sync)
          else if (typeof query.addListener === 'function') query.addListener(sync)
          return () => {
            if (typeof query.removeEventListener === 'function') query.removeEventListener('change', sync)
            else if (typeof query.removeListener === 'function') query.removeListener(sync)
          }
        }, [])
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
            fetchQuotaSnapshot({ providers: [provider] })
          }
        }, [provider, quota])
        useEffect(() => {
          if (!open || typeof document === 'undefined') return undefined
          const onPointerDown = (event) => {
            if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return
            // portal 模式下面板挂在 body 下、不在 rootRef 子树内：点面板本体不算外点。
            if (panelRef.current && event.target instanceof Node && panelRef.current.contains(event.target)) return
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
        // 纯文本窗口（余额类：DeepSeek/Kimi/硅基流动）没有百分比可「已用」，头部按剩余口径显示；
        // 百分比窗口仍按方言的 remaining 标记切换已用/剩余。
        const hasPercentWindow = tightest !== null
        const remainingBasis = !hasPercentWindow || tightest.remaining === true
        const usedWord = remainingBasis ? translate('quota.panel.remaining') : translate('quota.panel.used')
        const color = (remainingBasis ? percent <= 20 : percent >= 80) ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)'
        const radius = 5.5
        const circumference = 2 * Math.PI * radius
        const ariaText = hasPercentWindow
          ? `${translate('quota.ring.label')} · ${provider} · ${usedWord} ${percent}%`
          : `${translate('quota.ring.label')} · ${provider}`
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
        // 面板先构造、再决定挂载方式：窄视口 portal 到 document.body 后 fixed 视口居中
        // （根因见 quotaCreatePortal 处注释）；宽视口或 react-dom 缺席时锚定圆环上方（原行为）。
        const centered = open && narrow && quotaCreatePortal !== null
          && typeof document !== 'undefined' && document.body !== null && document.body !== undefined
        const triggerNode = React.createElement('button', {
            type: 'button',
            'data-testid': 'quota-ring-trigger',
            'aria-label': ariaText,
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            title: ariaText,
            onClick: () => {
              // 只在打开时补拉快照；关闭面板的那次请求没有意义（宿主闸门本就会兜住）。
              const next = !open
              setOpen(next)
              if (next) fetchQuotaSnapshot({ providers: provider === null ? [] : [provider] })
            },
            style: { width: '28px', height: '28px', border: 'none', borderRadius: '999px', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0, color: 'var(--dsw-alias-label-secondary)' },
          },
          React.createElement('svg', { viewBox: '0 0 14 14', width: '14', height: '14', 'aria-hidden': true },
            React.createElement('circle', { cx: '7', cy: '7', r: radius, fill: 'none', stroke: 'var(--dsw-alias-border-l3)', strokeWidth: '2' }),
            React.createElement('circle', {
              cx: '7', cy: '7', r: radius, fill: 'none', stroke: color, strokeWidth: '2', strokeLinecap: 'round',
              strokeDasharray: `${(circumference * percent) / 100} ${circumference}`,
              transform: 'rotate(-90 7 7)',
            })))
        const panelNode = open ? React.createElement('div', {
          ref: panelRef,
          role: 'dialog',
          'aria-label': translate('quota.panel.title'),
          'data-testid': 'quota-ring-panel',
          style: centered
            ? { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 1000, boxSizing: 'border-box', width: 'min(280px, calc(100vw - 32px))', maxHeight: 'calc(100dvh - 96px)', overflowY: 'auto', padding: '12px', borderRadius: '12px', background: 'var(--dsw-specific-menu)', border: '1px solid var(--dsw-alias-border-inverted)', boxShadow: 'var(--dsw-shadow-lv3)' }
            : { position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 100, boxSizing: 'border-box', width: '240px', padding: '12px', borderRadius: '12px', background: 'var(--dsw-specific-menu)', border: '1px solid var(--dsw-alias-border-inverted)', boxShadow: 'var(--dsw-shadow-lv3)' },
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '6px' } },
            React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, usedWord),
            React.createElement('span', { style: { marginLeft: 'auto', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, provider)),
          React.createElement('div', { style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' } },
            windows.map((window) => renderQuotaWindowRow(window, translate, null))),
          ...(deepseekPeakVisible(row, windows)
            ? [React.createElement(QuotaPeakTimeline, { key: 'panel-peak-timeline', showCaption: false })]
            : []),
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
          updatedNode) : null
        return React.createElement('span', { ref: rootRef, style: { position: 'relative', display: 'inline-flex' } },
          triggerNode,
          centered ? quotaCreatePortal(panelNode, document.body) : panelNode)
      }

      function FeatureSettingsCard() {
        const translate = useTranslation()
        const { snapshot, value } = useFeatures()
        const [open, setOpen] = React.useState(false)
        const [saving, setSaving] = React.useState('')
        const writable = snapshot.status === 'ready' && snapshot.writable === true
        const row = (key) => React.createElement('div', {
          key,
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', padding: '7px 0' },
        },
        React.createElement('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } }, translate('features.' + key)),
        React.createElement('button', {
          type: 'button',
          role: 'switch',
          'data-testid': 'feature-switch-' + key,
          'aria-checked': String(value[key] !== false),
          disabled: !writable || saving !== '',
          onClick: async () => {
            setSaving(key)
            try { await featureScope.set(key, value[key] === false) } catch (_) {}
            setSaving('')
          },
          style: { width: '34px', height: '20px', borderRadius: '10px', padding: 0, flexShrink: 0, position: 'relative', border: '1px solid ' + (value[key] !== false ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'), background: value[key] !== false ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: writable && saving === '' ? 'pointer' : 'default', opacity: writable ? 1 : 0.5, lineHeight: 0 },
        }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: value[key] !== false ? '15px' : '1px', width: '16px', height: '16px', borderRadius: '50%', background: value[key] !== false ? '#fff' : 'var(--dsw-alias-label-tertiary)' } })))
        return React.createElement('li', {
          style: { listStyle: 'none', border: '1px solid ' + (open ? 'var(--dsw-alias-label-dimmed)' : 'var(--dsw-alias-border-l2)'), borderRadius: '12px', color: 'var(--dsw-alias-label-primary)', background: open ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)' },
        },
        React.createElement('button', {
          type: 'button',
          'data-testid': 'feature-card-toggle',
          'aria-expanded': String(open),
          onClick: () => setOpen(!open),
          style: { appearance: 'none', width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', border: 0, borderRadius: '12px', background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' },
        },
        React.createElement('span', { style: { display: 'flex', minWidth: 0, flex: 1, flexDirection: 'column', gap: '4px' } },
          React.createElement('span', { style: { fontSize: '15px', fontWeight: 600, lineHeight: 1.4 } }, translate('features.cardTitle')),
          React.createElement('span', { style: { fontSize: '13px', lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' } }, translate('features.cardHint'))),
        React.createElement('svg', {
          viewBox: '0 0 14 14',
          width: 14,
          height: 14,
          'aria-hidden': 'true',
          style: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .16s' },
        }, React.createElement('path', { d: 'M3 5.25 7 9l4-3.75', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
        open ? React.createElement('div', { style: { margin: '0 16px', padding: '12px 0 8px', borderTop: '1px solid var(--dsw-alias-border-l2)' } },
          React.createElement('div', { style: { fontSize: '12px', fontWeight: 700 } }, translate('features.optional')),
          ['modelUsage', 'quotaLookup', 'backupMaintenance', 'taskNotifications', 'skillManager', 'subagentRoute'].map(row),
          React.createElement('div', { style: { fontSize: '12px', fontWeight: 700, marginTop: '8px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l1)' } }, translate('features.external')),
          row('healthz'),
          !writable ? React.createElement('p', { style: { margin: '6px 0 0', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('features.readOnly')) : null) : null)
      }

      // ─── 子代理模型（v0.27）：三态路由配置 ────────────────────────────────
      function mapSubagentError(translate, code) {
        if (code === 'feature-disabled') return translate('subagent.error.feature-disabled')
        if (code === 'llm-unavailable') return translate('subagent.error.llm-unavailable')
        if (code === 'unknown-mode') return translate('subagent.error.unknown-mode')
        if (code === 'invalid-model-route') return translate('subagent.error.invalid-model-route')
        if (code === 'network') return translate('subagent.error.network')
        return code
      }

      const SUBAGENT_MODES = ['inherit', 'follow', 'custom']
      function SubagentSection() {
        const translate = useTranslation()
        const { useState, useEffect } = React
        const [navEnabled, setNavEnabled] = subagentNavToggle.useEnabled()
        const [snapshot, setSnapshot] = useState(null)
        const [mode, setMode] = useState('inherit')
        const [provider, setProvider] = useState('')
        const [model, setModel] = useState('')
        const [loading, setLoading] = useState(true)
        const [saving, setSaving] = useState(false)
        const [savedTick, setSavedTick] = useState(0)
        const [error, setError] = useState('')
        const hintStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const selectStyle = { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', maxWidth: '100%' }

        const load = async () => {
          setLoading(true)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'subagent-route', {})
            if (res.ok) {
              setSnapshot(res.value)
              setMode(res.value.mode)
              if (res.value.mode === 'custom') {
                setProvider(typeof res.value.provider === 'string' ? res.value.provider : '')
                setModel(typeof res.value.model === 'string' ? res.value.model : '')
              }
              setError('')
            } else {
              setError(res.error || 'unknown')
            }
          } catch (_) {
            setError('network')
          } finally {
            setLoading(false)
          }
        }
        useEffect(() => { void load() }, [])

        const models = snapshot !== null && Array.isArray(snapshot.models) ? snapshot.models : []
        // 供应商分组：清单顺序去重；模型下拉随供应商切换。
        const providers = []
        const providerName = {}
        for (const item of models) {
          if (providerName[item.provider] === undefined) {
            providerName[item.provider] = item.providerName
            providers.push(item.provider)
          }
        }
        const providerModels = models.filter((item) => item.provider === provider)
        // 换供应商时若当前模型不属于它，回落到该供应商首个模型。
        useEffect(() => {
          if (provider !== '' && !providerModels.some((item) => item.id === model)) {
            setModel(providerModels[0]?.id ?? '')
          }
        }, [provider])
        const effectiveProvider = providers.includes(provider) ? provider : providers[0] ?? ''
        useEffect(() => { if (provider !== effectiveProvider) setProvider(effectiveProvider) }, [effectiveProvider, provider])

        const save = async (nextMode) => {
          setSaving(true)
          setError('')
          try {
            const payload = nextMode === 'custom'
              ? { mode: 'custom', provider: effectiveProvider, model }
              : { mode: nextMode }
            const res = await ctx.connection.rpc.call('/dsh-service', 'subagent-route-save', payload)
            if (res.ok) {
              setSavedTick((tick) => tick + 1)
              await load()
            } else {
              setError(res.error || 'unknown')
            }
          } catch (_) {
            setError('network')
          } finally {
            setSaving(false)
          }
        }

        const cardStyle = { padding: '4px 0 14px', marginBottom: '12px', color: 'var(--dsw-alias-label-primary)' }
        const modeButton = (candidate) => React.createElement('button', {
          type: 'button',
          key: candidate,
          'data-testid': 'subagent-mode-' + candidate,
          'aria-pressed': String(mode === candidate),
          disabled: loading,
          onClick: () => setMode(candidate),
          style: {
            fontSize: '12.5px', padding: '5px 12px', borderRadius: '7px', cursor: loading ? 'default' : 'pointer',
            border: mode === candidate ? '1px solid var(--dsw-alias-state-brand-primary)' : '1px solid var(--dsw-alias-border-l2)',
            background: mode === candidate ? 'var(--dsh-svc-surface-bg)' : 'var(--dsw-alias-bg-layer-3)',
            color: 'var(--dsw-alias-label-primary)',
            opacity: loading ? 0.55 : 1,
          },
        }, translate('subagent.mode.' + candidate))

        return React.createElement('div', { 'data-testid': 'subagent-section', style: cardStyle },
          React.createElement('div', { style: { fontSize: '14px', fontWeight: 700 } }, translate('subagent.title')),
          React.createElement('p', { style: hintStyle }, translate('subagent.hint')),
          snapshot !== null && snapshot.available === false ? React.createElement('p', { 'data-testid': 'subagent-unavailable', style: { ...hintStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, translate('subagent.unavailable')) : null,
          React.createElement('div', { 'data-testid': 'subagent-modes', style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
            SUBAGENT_MODES.map(modeButton)),
          React.createElement('p', { 'data-testid': 'subagent-mode-desc', style: { ...hintStyle, marginTop: '8px' } }, translate('subagent.mode.' + mode + '.desc')),
          mode === 'custom' ? React.createElement('div', { 'data-testid': 'subagent-custom', style: { marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
            React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, translate('subagent.provider')),
            React.createElement('select', { 'data-testid': 'subagent-provider', value: effectiveProvider, disabled: providers.length === 0 || saving, onChange: (event) => setProvider(event.target.value), style: selectStyle },
              providers.map((id) => React.createElement('option', { key: id, value: id }, providerName[id] ?? id))),
            React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, translate('subagent.model')),
            React.createElement('select', { 'data-testid': 'subagent-model', value: model, disabled: providerModels.length === 0 || saving, onChange: (event) => setModel(event.target.value), style: selectStyle },
              providerModels.map((item) => React.createElement('option', { key: item.id, value: item.id }, item.name ?? item.id)))) : null,
          mode === 'custom' && models.length === 0 && !loading ? React.createElement('p', { 'data-testid': 'subagent-models-empty', style: { ...hintStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, translate('subagent.modelsEmpty')) : null,
          error !== '' ? React.createElement('p', { 'data-testid': 'subagent-error', style: { ...hintStyle, color: 'var(--dsw-alias-state-error-primary)' } }, mapSubagentError(translate, error)) : null,
          savedTick > 0 && error === '' ? React.createElement('p', { 'data-testid': 'subagent-saved', style: { ...hintStyle, color: 'var(--dsw-alias-state-success-primary)' } }, '✓ ' + translate('subagent.saved')) : null,
          React.createElement('div', { style: { display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' } },
            React.createElement('button', { type: 'button', 'data-testid': 'subagent-save', disabled: saving || loading || (mode === 'custom' && (effectiveProvider === '' || model === '')), onClick: () => void save(mode), style: { fontSize: '12.5px', padding: '6px 16px', borderRadius: '7px', border: '1px solid transparent', background: 'var(--dsw-alias-state-success-primary)', color: '#fff', cursor: saving ? 'default' : 'pointer', opacity: saving || loading || (mode === 'custom' && (effectiveProvider === '' || model === '')) ? 0.55 : 1 } }, saving ? translate('subagent.saving') : translate('subagent.save')),
            mode !== 'inherit' ? React.createElement('button', { type: 'button', 'data-testid': 'subagent-reset', disabled: saving || loading, onClick: () => { setMode('inherit'); void save('inherit') }, style: { fontSize: '12.5px', padding: '6px 14px', borderRadius: '7px', border: '1px solid var(--dsw-alias-state-error-primary)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', cursor: saving ? 'default' : 'pointer', opacity: saving || loading ? 0.55 : 1 } }, translate('subagent.reset')) : null),
          React.createElement('div', { style: { marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
              React.createElement('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } }, translate('subagent.navToggle')),
              React.createElement('span', { style: hintStyle }, translate('subagent.navToggleHint'))),
            React.createElement('button', {
              type: 'button',
              role: 'switch',
              'data-testid': 'subagent-nav-switch',
              'aria-checked': String(navEnabled),
              onClick: () => setNavEnabled(!navEnabled),
              style: { width: '34px', height: '20px', borderRadius: '10px', padding: 0, flexShrink: 0, position: 'relative', border: `1px solid ${navEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'}`, background: navEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: 'pointer', lineHeight: 0 },
            }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: navEnabled ? '15px' : '1px', width: '16px', height: '16px', borderRadius: '50%', background: navEnabled ? '#fff' : 'var(--dsw-alias-label-tertiary)' } }))))
      }

      // ─── 技能管理（v0.22）：三区列表 / 启停 / AI 补全 / 批量 ────────────────
      const SKILLS_MODEL_STORAGE_KEY = 'dsh-service-skills-model'
      const SKILL_RPC = (endpoint, payload) => ctx.connection.rpc.call('/dsh-service', endpoint, payload)
      function formatSkillBytes(size) {
        return size >= 1024 * 1024 ? (size / 1024 / 1024).toFixed(1) + ' MB' : size >= 1024 ? (size / 1024).toFixed(1) + ' KB' : String(size) + ' B'
      }
      function skillModelKey(item) { return item.provider + '\u0000' + item.id }
      function readStoredSkillModel() {
        try {
          const parsed = JSON.parse(localStorage.getItem(SKILLS_MODEL_STORAGE_KEY) || 'null')
          if (parsed && typeof parsed.provider === 'string' && typeof parsed.model === 'string') return parsed
        } catch (_) {}
        return null
      }
      function pickSkillModel(models, preferred) {
        const current = typeof preferred === 'object' && preferred !== null ? preferred : readStoredSkillModel()
        if (current !== null) {
          const match = models.find((item) => item.provider === current.provider && item.id === current.model)
          if (match !== undefined) return match
        }
        return models[0] ?? null
      }

      // 批量与单条共用的模型预选：localStorage 记忆 > 宿主当前默认 > 清单首个。
      const resolveSkillModelChoice = (models, current) => {
        let item = pickSkillModel(models, readStoredSkillModel())
        if (item === null && current !== undefined) {
          item = models.find((candidate) => candidate.provider === current.provider && candidate.id === current.model) ?? null
        }
        return item
      }

      // 宿主下发的日志条目是结构化 {at, name?, code, params}：时间戳本地拼、文案词典渲染，
      // 词典没有的 code 原样透出（不吞异常事件）。
      const formatSkillLogLine = (translate, entry) => {
        if (entry === null || typeof entry !== 'object') return String(entry)
        const time = new Date(entry.at).toISOString().slice(11, 19)
        const key = 'skills.log.' + entry.code
        const label = translate(key, entry.params ?? {})
        return '[' + time + ']' + (entry.name !== undefined ? ' [' + entry.name + ']' : '') + ' ' + (label === key ? entry.code : label)
      }

      // 错误码 → 本地化文案：translate 必须由调用方传入（本函数所在作用域没有 translate，
      // 此前直接引用自由变量，技能页一出错误就 ReferenceError 整页崩溃）。
      function mapSkillErrorMessage(translate, code) {
        if (code === 'models-empty') return translate('skills.describe.models.empty')
        if (code === 'llm-unavailable') return translate('skills.llm.unavailable')
        if (code === 'batch-already-running') return translate('skills.batch.already')
        if (code === 'feature-disabled') return translate('skills.error.feature-disabled')
        if (code === 'network') return translate('skills.error.network')
        if (code === 'read-only-source') return translate('skills.error.read-only-source')
        if (code === 'unknown-skill') return translate('skills.error.unknown-skill')
        if (code === 'invalid-field') return translate('skills.error.invalid-field')
        if (code === 'invalid-enable') return translate('skills.error.invalid-enable')
        if (code === 'invalid-model-route') return translate('skills.error.invalid-model-route')
        if (code === 'invalid-description') return translate('skills.error.invalid-description')
        if (code === 'describe-timeout') return translate('skills.error.describe-timeout')
        if (code === 'batch-cancelled') return translate('skills.error.batch-cancelled')
        if (code === 'entry-changed') return translate('skills.error.entry-changed')
        if (code === 'unknown-batch-plan') return translate('skills.error.unknown-batch-plan')
        if (code === 'batch-already-done') return translate('skills.error.batch-already-done')
        if (code === 'batch-already-cancelled') return translate('skills.error.batch-already-cancelled')
        if (typeof code === 'string' && code.startsWith('empty-output')) {
          const kind = code.slice('empty-output:'.length)
          return translate('skills.error.empty-output', { kind: kind === '' ? '?' : kind })
        }
        if (typeof code === 'string' && code.startsWith('invalid-skill')) {
          const reason = code.startsWith('invalid-skill:') ? code.slice('invalid-skill:'.length) : ''
          return translate('skills.error.invalid-skill', { reason })
        }
        return translate('skills.error', { error: code })
      }

      function SkillsSection() {
        const translate = useTranslation()
        const [data, setData] = useState(null)
        const [error, setError] = useState('')
        const [loading, setLoading] = useState(true)
        const [filterText, setFilterText] = useState('')
        const [confirmingKey, setConfirmingKey] = useState(null)
        const [describe, setDescribe] = useState(null)   // {entry, models, modelItem, draft, busy, error, applied}
        const [batchBusy, setBatchBusy] = useState(false)
        const [describeLogs, setDescribeLogs] = useState([])
        // 运行日志盒：生成中自动展开；落定自动折叠为一行开关，可手动展开回看。
        // 初值恒为折叠（此时 batch 尚未解构），挂载后的阶段 effect 会立即校正。
        const [batchLogOpen, setBatchLogOpen] = useState(false)
        // 跳过清单：默认折叠，点开看逐条原因。
        const [skippedOpen, setSkippedOpen] = useState(false)
        // 批量进度/计划/模型来自工厂共享作用域：跨标签与设置面板开关存活。
        const { batch, plan: batchPlan, models: batchModels, modelItem: batchModelItem, error: batchError } = useSkillsBatch()
        // 运行日志盒：生成中自动展开；落定自动折叠为一行开关，可手动展开回看。
        const batchPhaseForLog = batch !== null ? batch.phase : null
        useEffect(() => { setBatchLogOpen(batchPhaseForLog === 'running') }, [batchPhaseForLog])

        const load = async () => {
          setLoading(true)
          try {
            const res = await SKILL_RPC('skills-list', {})
            if (res.ok) { setData(res.value); setError('') } else setError(res.error || 'unknown')
          } catch (_) {
            // 断连/传输失败也要落到错误态，而不是静默 unhandled rejection。
            setError('network')
          } finally { setLoading(false) }
        }
        useEffect(() => {
          void load()
          void adoptSkillsBatchStatus()
          void fetchSkillsBatchModels().then(publishSkillsBatch)
        }, [])
        // 落定后刷新列表拿最新注释标记；订阅回调里消费脏标记。
        useEffect(() => {
          if (batch !== null && (batch.phase === 'done' || batch.phase === 'cancelled') && skillsBatchListDirty) {
            skillsBatchListDirty = false
            void load()
          }
        }, [batch !== null && batch.phase])
        // 「生成中」800ms 轮询运行日志；落定后单次补拉，接住最后一条「解析成功/失败原因」。
        // 成功路径不做 alive 门控：完成渲染的清理可能先于在途响应执行，迟到结果正是我们要的尾巴。
        useEffect(() => {
          if (describe === null || !describe.busy) return undefined
          const entryId = describe.entry.id
          let intervalHandle
          const fetchLog = async () => {
            try {
              const res = await SKILL_RPC('skills-describe-log', { id: entryId })
              if (res.ok) setDescribeLogs(res.value.logs ?? [])
            } catch (_) {}
          }
          void fetchLog()
          intervalHandle = setInterval(() => void fetchLog(), 800)
          return () => clearInterval(intervalHandle)
        }, [describe !== null && describe.busy])
        useEffect(() => {
          if (describe === null || describe.busy) return undefined
          const entryId = describe.entry.id
          void (async () => {
            try {
              const res = await SKILL_RPC('skills-describe-log', { id: entryId })
              if (res.ok) setDescribeLogs(res.value.logs ?? [])
            } catch (_) {}
          })()
        }, [describe !== null && describe.busy])

        const patchEntry = (next) => {
          setData((prev) => prev === null ? prev : { ...prev, entries: prev.entries.map((entry) => entry.id === next.id ? next : entry) })
        }
        // 待确认态 3 秒无第二击自动复位（armed 态不再无限滞留）。
        useEffect(() => {
          if (confirmingKey === null) return undefined
          const handle = setTimeout(() => setConfirmingKey(null), 3000)
          return () => clearTimeout(handle)
        }, [confirmingKey])
        const toggleSkill = async (entry, field) => {
          const key = entry.id + ':' + field
          // 两段式：第一击只进入待确认态，3 秒内再击才下发；超时点别处自然复位。
          if (confirmingKey !== key) { setConfirmingKey(key); return }
          setConfirmingKey(null)
          const enable = field === 'model' ? entry.invocation.model !== true : entry.invocation.user !== true
          try {
            const res = await SKILL_RPC('skills-toggle', { id: entry.id, field, enable })
            if (res.ok) patchEntry(res.value.entry)
            else setError(res.error + (res.detail ? ':' + res.detail : '') || 'unknown')
          } catch (_) { setError('network') }
        }
        const fixLegacyKeys = async (entry) => {
          // 与开关同款两段式：一键修复会直接改写 SKILL.md frontmatter，先确认再动手。
          const key = entry.id + ':fix'
          if (confirmingKey !== key) { setConfirmingKey(key); return }
          setConfirmingKey(null)
          try {
            const res = await SKILL_RPC('skills-fix-keys', { id: entry.id })
            if (res.ok) patchEntry(res.value.entry)
            else setError(res.error + (res.detail ? ':' + res.detail : '') || 'unknown')
          } catch (_) { setError('network') }
        }
        const clearNote = async (entry) => {
          const res = await SKILL_RPC('skills-note-clear', { id: entry.id })
          if (res.ok) patchEntry(res.value.entry)
          else setError(res.error || 'unknown')
        }

        const openDescribe = async (entry) => {
          const stored = readStoredSkillModel()
          setDescribe({ entry, models: null, modelItem: null, draft: null, busy: false, error: '', applied: false, preferred: stored })
          setDescribeLogs([])
          const res = await SKILL_RPC('skills-models', {})
          if (!res.ok) { setDescribe((prev) => ({ ...prev, error: res.error || 'unknown' })); return }
          const models = res.value.models ?? []
          setDescribe((prev) => ({ ...prev, models, modelItem: resolveSkillModelChoice(models, res.value.current) }))
        }
        const runDescribe = async () => {
          if (describe === null || describe.modelItem === null) return
          const { entry, modelItem } = describe
          setDescribe((prev) => ({ ...prev, busy: true, error: '' }))
          const res = await SKILL_RPC('skills-describe', { id: entry.id, provider: modelItem.provider, model: modelItem.id, lang: currentUiLocale() })
          if (res.ok) {
            try { localStorage.setItem(SKILLS_MODEL_STORAGE_KEY, JSON.stringify({ provider: modelItem.provider, model: modelItem.id })) } catch (_) {}
            setDescribe((prev) => ({ ...prev, draft: res.value.draft, busy: false }))
          } else {
            setDescribe((prev) => ({ ...prev, busy: false, error: res.error + (res.detail ? ':' + res.detail : '') }))
          }
        }
        const applyDraft = async () => {
          if (describe === null || describe.draft === null || describe.modelItem === null) return
          const { entry, draft, modelItem } = describe
          setDescribe((prev) => ({ ...prev, busy: true }))
          const res = await SKILL_RPC('skills-note-save', { id: entry.id, patch: { description: draft.description, usage: draft.usage }, model: modelItem.provider + '/' + modelItem.id })
          if (res.ok) {
            patchEntry(res.value.entry)
            setDescribe((prev) => ({ ...prev, busy: false, applied: true }))
          } else {
            setDescribe((prev) => ({ ...prev, busy: false, error: res.error || 'unknown' }))
          }
        }

        const planBatch = async () => {
          setBatchBusy(true)
          try { await planSkillsBatchShared() } finally { setBatchBusy(false) }
        }
        const startBatch = async () => {
          setBatchBusy(true)
          try { await startSkillsBatchShared() } finally { setBatchBusy(false) }
        }
        const cancelBatch = async () => { await cancelSkillsBatchShared() }

        // ── 渲染 ──
        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const badge = (text, tone) => React.createElement('span', { key: text, style: { marginLeft: '6px', fontSize: '10px', padding: '1px 7px', borderRadius: 999, verticalAlign: 'middle', background: tone === 'warn' ? 'rgba(198,128,0,0.18)' : tone === 'danger' ? 'rgba(196,64,64,0.16)' : 'var(--dsw-alias-interactive-bg-hover)', color: tone === 'warn' ? 'var(--dsw-alias-state-warn-primary)' : tone === 'danger' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)' } }, text)
        const pillSwitch = (checked, opts) => React.createElement('button', {
          type: 'button',
          role: 'switch',
          'data-testid': opts.testid,
          'aria-checked': String(checked),
          title: opts.title,
          disabled: opts.disabled,
          onClick: opts.onClick,
          style: { width: '34px', height: '20px', borderRadius: '10px', padding: 0, flexShrink: 0, position: 'relative', cursor: opts.disabled ? 'default' : 'pointer', lineHeight: 0, border: '1px solid ' + (opts.armed ? 'var(--dsw-alias-state-warn-primary)' : checked ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'), background: opts.armed ? 'transparent' : checked ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', opacity: opts.disabled ? 0.5 : 1 },
        }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: checked && !opts.armed ? '15px' : '1px', width: '16px', height: '16px', borderRadius: '50%', background: opts.armed ? 'var(--dsw-alias-state-warn-primary)' : checked ? '#fff' : 'var(--dsw-alias-label-tertiary)' } }))
        const entryCard = { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '11px 13px', marginBottom: '8px', display: 'flex', gap: '12px', alignItems: 'flex-start', justifyContent: 'space-between' }

        const renderEntry = (entry) => {
          const invalidLegacy = typeof entry.invalid === 'string' && entry.invalid.startsWith('legacy-invocation-key:')
          const nameLine = React.createElement('div', { style: { fontSize: '14px', fontWeight: 650, color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' } },
            entry.name,
            badge(translate('skills.source.' + entry.source) === 'skills.source.' + entry.source ? entry.source : translate('skills.source.' + entry.source)),
            entry.shadowed ? badge(translate('skills.badge.shadowed'), 'warn') : null,
            !entry.writable ? badge(translate('skills.badge.readonly'), 'danger') : null,
            entry.annotated ? badge(translate('skills.badge.annotated')) : null)
          const descLine = React.createElement('div', { style: { fontSize: '12.5px', color: 'var(--dsw-alias-label-secondary)', marginTop: '3px', lineHeight: 1.45, overflowWrap: 'anywhere' } }, entry.description)
          // 原文无 whenToUse 就不渲染该行，不放占位文案。
          const usageLine = entry.usage === '' ? null : React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '2px', lineHeight: 1.45, overflowWrap: 'anywhere' } },
            translate('skills.apply.usage') + '：' + entry.usage)
          // AI 注释块：只存插件侧车索引、只在面板展示；正文变更后自动标记过期。
          const noteLine = entry.note !== undefined ? React.createElement('div', { 'data-testid': 'skill-note-' + entry.name, style: { marginTop: '5px', padding: '6px 9px', borderRadius: '7px', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l2)', fontSize: '11.5px', lineHeight: 1.55, color: 'var(--dsw-alias-label-secondary)', display: 'flex', gap: '8px', alignItems: 'flex-start' } },
            React.createElement('div', { style: { minWidth: 0, flex: 1 } },
              entry.note.stale === true ? React.createElement('div', { style: { marginBottom: '3px', color: 'var(--dsw-alias-state-warn-primary)' } }, '⚠ ' + translate('skills.note.stale')) : null,
              React.createElement('div', { style: { overflowWrap: 'anywhere' } },
                React.createElement('span', { style: { fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } }, translate('skills.apply.description') + '：'),
                React.createElement('span', null, entry.note.description)),
              entry.note.usage === '' ? null : React.createElement('div', { style: { overflowWrap: 'anywhere', marginTop: '3px' } },
                React.createElement('span', { style: { fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } }, translate('skills.apply.usage') + '：'),
                React.createElement('span', null, entry.note.usage))),
            React.createElement('button', { type: 'button', 'data-testid': 'skill-note-remove-' + entry.name, onClick: () => void clearNote(entry), title: translate('skills.note.remove'), style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '13px', flexShrink: 0, lineHeight: 1 } }, '✕')) : null
          const invalidLine = entry.invalid !== undefined ? React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-state-warn-primary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            '⚠ ', invalidLegacy ? translate('skills.invalid.legacy') : translate('skills.invalid.other', { reason: entry.invalid }),
            invalidLegacy && entry.writable ? React.createElement('button', { type: 'button', 'data-testid': 'skill-fix-' + entry.name, onClick: () => void fixLegacyKeys(entry), title: confirmingKey === entry.id + ':fix' ? translate('skills.switch.confirm') : undefined, style: { fontSize: '11px', padding: '2px 9px', borderRadius: '6px', border: '1px solid var(--dsw-alias-state-warn-primary)', background: confirmingKey === entry.id + ':fix' ? 'rgba(198,128,0,0.14)' : 'transparent', color: 'var(--dsw-alias-state-warn-primary)', cursor: 'pointer' } }, confirmingKey === entry.id + ':fix' ? translate('skills.switch.confirm') : translate('skills.fix.legacy')) : null) : null
          const switches = entry.invalid === undefined ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', alignItems: 'flex-end', flexShrink: 0 } },
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.switch.model'),
              pillSwitch(entry.invocation.model, { testid: 'skill-switch-model-' + entry.name, disabled: !entry.writable, armed: confirmingKey === entry.id + ':model', title: confirmingKey === entry.id + ':model' ? translate('skills.switch.confirm') : undefined, onClick: () => void toggleSkill(entry, 'model') })),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.switch.user'),
              pillSwitch(entry.invocation.user, { testid: 'skill-switch-user-' + entry.name, disabled: !entry.writable, armed: confirmingKey === entry.id + ':user', title: confirmingKey === entry.id + ':user' ? translate('skills.switch.confirm') : undefined, onClick: () => void toggleSkill(entry, 'user') })),
            data !== null && data.llmAvailable ? React.createElement('button', { type: 'button', 'data-testid': 'skill-describe-' + entry.name, onClick: () => void openDescribe(entry), style: { fontSize: '11px', padding: '3px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-interactive-bg-hover)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' } }, '✨ ' + translate('skills.describe.button')) : null) : null
          return React.createElement('div', { key: entry.id, 'data-testid': 'skill-entry-' + entry.name, style: entryCard },
            React.createElement('div', { style: { minWidth: 0, flex: 1 } }, nameLine, descLine, usageLine, noteLine, invalidLine),
            switches)
        }

        const renderLogBox = (testid, lines, showHeader) => lines.length === 0 ? null : React.createElement('div', { 'data-testid': testid, style: { marginTop: '9px', padding: '7px 10px', borderRadius: '7px', background: 'var(--dsw-alias-bg-layer-3)', border: '1px solid var(--dsw-alias-border-l2)', maxHeight: '130px', overflowY: 'auto' } },
          showHeader ? React.createElement('div', { style: { fontSize: '11px', fontWeight: 700, color: 'var(--dsw-alias-label-secondary)', marginBottom: '3px' } }, translate('skills.log.title')) : null,
          ...lines.map((line, index) => React.createElement('div', { key: index, style: { fontSize: '11px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' } }, line)))

        const renderGroups = () => {
          if (data === null || data.entries.length === 0) return React.createElement('p', { style: hint }, translate('skills.empty'))
          const needle = filterText.trim().toLowerCase()
          const visible = needle === '' ? data.entries : data.entries.filter((entry) => entry.name.toLowerCase().includes(needle))
          const invalidEntries = visible.filter((entry) => entry.invalid !== undefined)
          const validEntries = visible.filter((entry) => entry.invalid === undefined)
          const groups = [
            ['skills.group.auto', validEntries.filter((entry) => entry.invocation.model)],
            ['skills.group.manual', validEntries.filter((entry) => !entry.invocation.model && entry.invocation.user)],
            ['skills.group.disabled', validEntries.filter((entry) => !entry.invocation.model && !entry.invocation.user)],
          ]
          return React.createElement('div', null,
            invalidEntries.length > 0 ? React.createElement('div', { 'data-testid': 'skills-invalid-group', style: { marginBottom: '12px' } }, invalidEntries.map(renderEntry)) : null,
            groups.map(([label, items]) => items.length === 0 ? null : React.createElement('div', { key: label, 'data-testid': 'skills-group-' + label.split('.').pop(), style: { marginBottom: '14px' } },
              React.createElement('div', { style: { fontSize: '12px', fontWeight: 700, margin: '0 0 7px', color: 'var(--dsw-alias-label-secondary)' } }, translate(label) + ' · ' + items.length),
              items.map(renderEntry))))
        }

        const renderDescribeDialog = () => {
          if (describe === null) return null
          const { entry, models, modelItem, draft, busy, error, applied } = describe
          const inputStyle = { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', maxWidth: '100%' }
          const diffRows = draft === null ? null : [['description', entry.note !== undefined ? entry.note.description : '', draft.description], ['usage', entry.note !== undefined ? entry.note.usage : '', draft.usage === '' ? null : draft.usage]].map(([field, oldText, newText]) =>
            React.createElement('div', { key: field, 'data-testid': 'skill-diff-' + field, style: { marginBottom: '9px' } },
              React.createElement('div', { style: { fontSize: '12px', fontWeight: 700, marginBottom: '3px' } }, translate('skills.apply.' + field)),
              React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', textDecoration: 'line-through', lineHeight: 1.45 } }, translate('skills.apply.old') + '：' + (oldText === '' ? '—' : oldText)),
              React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', lineHeight: 1.45 } }, translate('skills.apply.new') + '：' + (newText === null ? translate('skills.apply.keepusage') : newText))))
          return React.createElement('div', { 'data-testid': 'skill-describe-dialog', style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '12px', padding: '14px 16px', marginBottom: '14px', background: 'var(--dsw-alias-bg-layer-2)' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
              React.createElement('div', { style: { fontSize: '14px', fontWeight: 700 } }, translate('skills.describe.title', { name: entry.name })),
              React.createElement('button', { type: 'button', onClick: () => setDescribe(null), style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '15px' } }, '✕')),
            models === null && error === '' ? React.createElement('p', { style: hint }, translate('skills.describe.models.loading')) : null,
            models !== null && models.length === 0 ? React.createElement('p', { style: hint }, translate('skills.describe.models.empty')) : null,
            models !== null && models.length > 0 ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
              React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.describe.model')),
              React.createElement('select', { 'data-testid': 'skill-describe-model', value: modelItem === null ? '' : skillModelKey(modelItem), onChange: (event) => setDescribe((prev) => prev === null ? prev : { ...prev, modelItem: models.find((item) => skillModelKey(item) === event.target.value) ?? null }), style: inputStyle },
                models.map((item) => React.createElement('option', { key: skillModelKey(item), value: skillModelKey(item) }, item.providerName + ' / ' + item.name))),
              draft === null ? React.createElement('button', { type: 'button', 'data-testid': 'skill-describe-run', disabled: busy || modelItem === null, onClick: () => void runDescribe(), style: { fontSize: '12px', padding: '4px 12px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', cursor: busy ? 'default' : 'pointer', opacity: busy || modelItem === null ? 0.55 : 1 } }, busy ? translate('skills.describe.running') : translate('skills.describe.run')) : null) : null,
            error !== '' ? React.createElement('p', { 'data-testid': 'skill-describe-error', style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, mapSkillErrorMessage(translate, error)) : null,
            renderLogBox('skill-describe-log', describeLogs.map((line) => formatSkillLogLine(translate, line))),
            diffRows,
            applied ? React.createElement('p', { 'data-testid': 'skill-apply-done', style: { ...hint, color: 'var(--dsw-alias-state-success-primary)' } }, '✓ ' + translate('skills.apply.done')) : null,
            draft !== null && !applied ? React.createElement('p', { 'data-testid': 'skill-note-disclaimer', style: { ...hint, fontSize: '11px' } }, translate('skills.note.panelOnly')) : null,
            draft !== null && !applied ? React.createElement('button', { type: 'button', 'data-testid': 'skill-apply-confirm', disabled: busy, onClick: () => void applyDraft(), style: { fontSize: '12.5px', padding: '6px 16px', borderRadius: '7px', border: '1px solid transparent', background: 'var(--dsw-alias-state-success-primary)', color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1 } }, translate('skills.apply.confirm')) : null)
        }

        // 跳过原因 → 本地化标签：已知原因走词典，未知原因原样透出。
        const skipReasonLabel = (reason) => {
          if (reason === 'annotated-current') return translate('skills.skip.annotated-current')
          if (reason === 'shadowed') return translate('skills.skip.shadowed')
          if (typeof reason === 'string' && reason.startsWith('legacy-invocation-key')) return translate('skills.skip.reason.legacy-invocation-key')
          const mapped = translate('skills.skip.reason.' + reason)
          return mapped === 'skills.skip.reason.' + reason ? reason : mapped
        }

        const renderBatchCard = () => {
          // 页面刷新会丢掉本端计划但宿主仍停在 planned（孤儿状态）：此时按空闲处理，
          // 让「生成计划」按钮回来形成闭环，而不是卡在没有可用按钮的死路里。
          const effectivePhase = batch !== null && batch.phase === 'planned' && batchPlan === null ? 'idle' : batch !== null ? batch.phase : 'idle'
          const phaseLabel = effectivePhase
          const progress = batch !== null && batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0
          return React.createElement('div', { 'data-testid': 'skills-batch-card', style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', padding: '13px 15px', margin: '14px 0' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
              React.createElement('div', { style: { fontSize: '13.5px', fontWeight: 700 } }, translate('skills.batch.title')),
              React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-collapse', onClick: () => setBatchCardOpen(false), style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '12px' } }, translate('skills.batch.collapse') + ' ▴')),
            React.createElement('p', { style: { ...hint, marginTop: '4px' } }, translate('skills.batch.hint')),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '9px', flexWrap: 'wrap' } },
              batchModels !== null && batchModels.length > 0 ? React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.batch.model'),
                React.createElement('select', { 'data-testid': 'skills-batch-model', value: batchModelItem === null ? '' : skillModelKey(batchModelItem), disabled: batchBusy || (batch !== null && batch.phase === 'running'), onChange: (event) => changeSkillsBatchModel(event.target.value), style: { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', maxWidth: '100%' } },
                  batchModels.map((item) => React.createElement('option', { key: skillModelKey(item), value: skillModelKey(item) }, item.providerName + ' / ' + item.name)))) : null,
              effectivePhase === 'idle' || effectivePhase === 'done' || effectivePhase === 'cancelled' ? React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-plan', disabled: batchBusy, onClick: () => void planBatch(), style: { fontSize: '12.5px', padding: '5px 14px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', cursor: batchBusy ? 'default' : 'pointer', opacity: batchBusy ? 0.55 : 1 } }, translate('skills.batch.plan')) : null,
              batchPlan !== null ? React.createElement('span', { 'data-testid': 'skills-batch-candidates', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                translate('skills.batch.candidates', { count: batchPlan.candidates.length }) + (batchPlan.estBytes > 0 ? ' · ' + translate('skills.batch.estBytes', { size: formatSkillBytes(batchPlan.estBytes) }) : '') + ' · ' + translate('skills.batch.skipped', { count: batchPlan.skipped.length })) : null,
              batchPlan !== null && effectivePhase === 'planned' ? React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-start', disabled: batchBusy || batchPlan.candidates.length === 0, onClick: () => void startBatch(), style: { fontSize: '12.5px', padding: '5px 14px', borderRadius: '7px', border: '1px solid transparent', background: 'var(--dsw-alias-state-success-primary)', color: '#fff', cursor: batchBusy ? 'default' : 'pointer', opacity: batchBusy ? 0.55 : 1 } }, translate('skills.batch.start')) : null,
              batch !== null && batch.phase === 'running' ? React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-cancel', onClick: () => void cancelBatch(), style: { fontSize: '12px', padding: '4px 12px', borderRadius: '6px', border: '1px solid var(--dsw-alias-state-error-primary)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer' } }, translate('skills.batch.cancel')) : null,
              batch !== null ? React.createElement('span', { 'data-testid': 'skills-batch-phase', style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('skills.batch.phase.' + phaseLabel)) : null),
            batchPlan !== null && batchPlan.candidates.length === 0 ? React.createElement('p', { style: hint }, translate('skills.batch.no-candidates')) : null,
            // 跳过清单不只报数量：可展开查看每条的名称与原因（宿主本来就下发了 name+reason）。
            (() => {
              if (batchPlan === null || batchPlan.skipped.length === 0) return null
              return React.createElement('div', { 'data-testid': 'skills-batch-skipped', style: { marginTop: '6px' } },
                React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-skipped-toggle', onClick: () => setSkippedOpen((value) => !value), style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '11.5px', padding: 0 } },
                  (skippedOpen ? '▾ ' : '▸ ') + translate('skills.skippedList') + '（' + batchPlan.skipped.length + '）'),
                skippedOpen ? React.createElement('div', { style: { marginTop: '4px', fontSize: '11.5px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' } },
                  batchPlan.skipped.map((item, index) => React.createElement('div', { key: item.id ?? index, 'data-testid': 'skills-batch-skipped-item' },
                    (item.name === '' ? item.id : item.name) + translate('skills.colon') + skipReasonLabel(item.reason)))) : null)
            })(),
            batch !== null && batch.total > 0 && effectivePhase !== 'idle' ? (() => {
              const failuresNode = Array.isArray(batch.failures) && batch.failures.length > 0 ? React.createElement('div', { 'data-testid': 'skills-batch-failures', style: { marginTop: '7px', fontSize: '11.5px', color: 'var(--dsw-alias-state-error-primary)', lineHeight: 1.5 } },
                translate('skills.batch.failures', { count: batch.failures.length }) + '：' + batch.failures.map((failure) => failure.name + '(' + failure.reason + ')').join('、')) : null
              const logLines = Array.isArray(batch.logs) ? batch.logs : []
              const logNode = logLines.length === 0 ? null : React.createElement('div', null,
                React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-log-toggle', onClick: () => setBatchLogOpen((value) => !value), style: { marginTop: '7px', border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '11.5px', padding: 0 } },
                  (batchLogOpen ? '▾ ' : '▸ ') + translate('skills.log.title') + '（' + logLines.length + '）'),
                batchLogOpen ? renderLogBox('skills-batch-log', logLines.slice(-30).map((line) => formatSkillLogLine(translate, line)), false) : null)
              return React.createElement('div', { style: { marginTop: '10px' } },
                React.createElement('div', { 'data-testid': 'skills-batch-progress', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '4px' } },
                  translate('skills.batch.progress', { done: batch.done, total: batch.total }) + (batch.current !== null ? ' · ' + translate('skills.batch.current', { name: batch.current }) : '')),
                React.createElement('div', { style: { height: '6px', borderRadius: '3px', background: 'var(--dsw-alias-bg-layer-3)', overflow: 'hidden' } },
                  React.createElement('div', { style: { height: '100%', width: progress + '%', background: 'var(--dsw-alias-state-success-primary)', transition: 'width .3s' } })),
                failuresNode,
                logNode)
            })() : null)
        }

        const [skillsNav, setSkillsNav] = skillsNavToggle.useEnabled()
        // 批量注释默认折叠成单个入口按钮；有任务在途（运行/待开始）时自动展开。
        const [batchCardOpen, setBatchCardOpen] = useState(false)
        useEffect(() => {
          if (batch !== null && (batch.phase === 'running' || batch.phase === 'planned')) setBatchCardOpen(true)
        }, [batch !== null && batch.phase])
        return React.createElement('div', { 'data-testid': 'skills-section' },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
            React.createElement('input', { 'data-testid': 'skills-filter', value: filterText, placeholder: translate('skills.filter'), onChange: (event) => setFilterText(event.target.value), style: { fontSize: '12.5px', padding: '6px 10px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', width: '200px' } }),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
              React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.nav.toggle'),
                pillSwitch(skillsNav, { testid: 'skills-nav-switch', onClick: () => setSkillsNav(!skillsNav) })),
              React.createElement('button', { type: 'button', 'data-testid': 'skills-refresh', onClick: () => void load(), style: { fontSize: '12px', padding: '5px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' } }, '↻'))),
          loading && data === null ? React.createElement('p', { style: hint }, '…') : null,
          (error !== '' || batchError !== '') ? React.createElement('p', { 'data-testid': 'skills-error', style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, mapSkillErrorMessage(translate, error !== '' ? error : batchError)) : null,
          data !== null && data.llmAvailable ? React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-toggle', 'aria-expanded': String(batchCardOpen), onClick: () => setBatchCardOpen((value) => !value), style: { margin: '0 0 12px', fontSize: '12.5px', padding: '6px 14px', borderRadius: '7px', border: '1px solid ' + (batchCardOpen ? 'var(--dsw-alias-label-dimmed)' : 'var(--dsw-alias-border-l2)'), background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' } }, (batchCardOpen ? '▾ ' : '▸ ') + translate('skills.batch.toggle')) : null,
          batchCardOpen && data !== null && data.llmAvailable ? renderBatchCard() : null,
          renderDescribeDialog(),
          renderGroups())
      }

      function QuotaSection() {
        return React.createElement(RemoteQuotaCard, null)
      }

      function RemoteQuotaCard() {
        const translate = useTranslation()
        const [quotaNav, setQuotaNav] = quotaNavToggle.useEnabled()
        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const sectionTitle = { fontSize: '14px', fontWeight: 700, margin: '0 0 8px', color: 'var(--dsw-alias-label-primary)' }
        const [quota, setQuota] = useState(quotaStore.getSnapshot())
        useEffect(() => quotaStore.subscribe(() => setQuota(quotaStore.getSnapshot())), [])
        useEffect(() => {
          acquireQuotaLoop({ all: true })
          return () => releaseQuotaLoop({ all: true })
        }, [])
        const [pollMinutes, setPollMinutes] = useState(readQuotaPollMinutes())
        const [configError, setConfigError] = useState('')
        const providers = quota.providers || []
        const [cardEditor, setCardEditor] = useState(null)
        // v0.20 免次数：草稿只有到期时间与名称；添加成功后清空并保持打开，方便连续追加多条。
        const [cardDraft, setCardDraft] = useState({ expiresAt: '', label: '' })
        const openCardEditor = (row) => {
          setCardEditor({ provider: row.provider })
          setCardDraft({ expiresAt: '', label: '' })
        }
        // 凭据填写窗口（v0.24）：未配置行的「填写 API 密钥」内联表单；宿主写入凭据库后立即强制
        // 重拉该 provider（清退避闸），密钥值只随保存请求发出、绝不回显。
        const [credEditor, setCredEditor] = useState(null)
        const [credDraft, setCredDraft] = useState({ name: '', value: '' })
        // 清除已存凭据的两段式确认武装态（skill 开关同款）：3 秒无第二击自动复位。
        const [credClearArmed, setCredClearArmed] = useState(false)
        useEffect(() => {
          if (!credClearArmed) return undefined
          const handle = setTimeout(() => setCredClearArmed(false), 3000)
          return () => clearTimeout(handle)
        }, [credClearArmed])
        const closeCredEditor = () => {
          setCredEditor(null)
          setCredDraft({ name: '', value: '' })
          setCredClearArmed(false)
        }
        const openCredEditor = (row) => {
          const hints = Array.isArray(row.credentialHints) ? row.credentialHints : []
          // 默认选中「已配置」的那个槽位（别名链里可能已有生效值）；全空才落回主名。
          setCardEditor(null)
          setCredEditor({ provider: row.provider })
          setCredDraft({ name: (hints.find((hint) => hint.configured === true) ?? hints[0])?.name ?? '', value: '' })
          setCredClearArmed(false)
        }
        const credentialFailCopy = (res) => {
          const code = String(res?.error ?? '')
          const known = ['unknown-hint', 'invalid-value', 'credentials-unavailable']
          const reason = known.includes(code) ? translate(`quota.credential.${code}`) : `${code}${res?.detail ? ` (${res.detail})` : ''}`
          return translate('quota.credential.saveFailed', { error: reason })
        }
        const saveCredential = async (providerName) => {
          setConfigError('')
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'quota-credential-set', { provider: providerName, name: credDraft.name, value: credDraft.value })
            if (res?.ok !== true) {
              setConfigError(credentialFailCopy(res))
              return
            }
            closeCredEditor()
            await refreshProvider(providerName)
          } catch (_) {
            setConfigError(translate('quota.saveFailed', { error: 'network' }))
          }
        }
        const clearCredential = async (providerName, name) => {
          setConfigError('')
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'quota-credential-unset', { provider: providerName, name })
            if (res?.ok !== true) {
              setConfigError(credentialFailCopy(res))
              return
            }
            await refreshProvider(providerName)
          } catch (_) {
            setConfigError(translate('quota.saveFailed', { error: 'network' }))
          }
        }
        const saveResetCard = async () => {
          if (cardEditor === null) return
          setConfigError('')
          try {
            const payload = { provider: cardEditor.provider }
            if (cardDraft.expiresAt !== '') payload.expiresAt = cardDraft.expiresAt
            if (cardDraft.label !== '') payload.label = cardDraft.label
            const res = await ctx.connection.rpc.call('/dsh-service', 'quota-reset-card', payload)
            if (res?.ok !== true) {
              setConfigError(translate('quota.saveFailed', { error: String(res?.error ?? '') }))
              return
            }
            setCardDraft({ expiresAt: '', label: '' })
            await fetchQuotaSnapshot({ scope: 'all' })
          } catch (error) {
            // 不再一律吞成 Network：透出真实错误（unknown endpoint 等），network 仅作兜底。
            const detail = error instanceof Error && typeof error.message === 'string' && error.message.trim() !== '' ? error.message.trim() : 'network'
            setConfigError(translate('quota.saveFailed', { error: detail }))
          }
        }
        // 逐条移除：provider + 宿主下发的卡片 id 定位，不再依赖「每 provider 一张」的旧约束。
        const removeResetCard = async (providerName, cardId) => {
          setConfigError('')
          try {
            await ctx.connection.rpc.call('/dsh-service', 'quota-reset-card', { provider: providerName, remove: true, id: cardId })
            await fetchQuotaSnapshot({ scope: 'all' })
          } catch (_) {
            setConfigError(translate('quota.saveFailed', { error: 'network' }))
          }
        }
        // 手动刷新：宿主清闸后立即 kick（单飞仍生效）；立刻拉一次快照，之后的落定接续
        // （fetchQuotaSnapshot 的 settle 补拉）统一接管，这里不再自建补拉定时器。
        const refreshProvider = async (providerName) => {
          setConfigError('')
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'quota-refresh', { provider: providerName })
            if (res?.ok !== true) {
              setConfigError(res?.error === 'unknown-provider' ? translate('quota.unknownProvider') : res?.error === 'not-adapted' ? translate('quota.unadapted') : translate('quota.saveFailed', { error: String(res?.error ?? '') }))
              return
            }
            await fetchQuotaSnapshot({ scope: 'all' })
          } catch (_) {
            setConfigError(translate('quota.saveFailed', { error: 'network' }))
          }
        }
        const requestQuotaConfig = async (payload) => {
          setConfigError('')
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'quota-config', payload)
            if (res?.ok !== true) {
              setConfigError(res?.error === 'unknown-provider' ? translate('quota.unknownProvider') : translate('quota.saveFailed', { error: String(res?.error ?? '') }))
              return
            }
            await fetchQuotaSnapshot({ scope: 'all' })
          } catch (_) {
            setConfigError(translate('quota.saveFailed', { error: 'network' }))
          }
        }
        // kind 传 null = 显式停用（宿主存 null，baseURL 可推断也不外呼）。
        const adaptProvider = (providerName, kind) => requestQuotaConfig({ provider: providerName, kind })
        // 删掉手动覆盖键，回退 baseURL 自动推断。
        const clearAdaptedKind = (providerName) => requestQuotaConfig({ provider: providerName, clear: true })
        // 卡片手动排序：localStorage 名单驱动展示序（纯客户端，宿主契约不动）；新供应商自然排末尾。
        const [cardOrder, setCardOrder] = useState(readQuotaCardOrder())
        // 排序模式开关（用户点名）：平时不显示 ↑↓，点「调整排序」才出现，避免卡片头部常驻小钮。
        const [reorderMode, setReorderMode] = useState(false)
        // 卡片分区（v0.20）：只展示已适配供应商；未适配/已停用的不渲染灰行，统一收进底部「手动适配」行。
        const adaptedRows = applyQuotaCardOrder(providers.filter((row) => row.adapted === true), cardOrder)
        const candidateRows = providers.filter((row) => row.adapted !== true)
        const quotaSelectStyle = { fontSize: '12px', padding: '3px 6px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' }
        // ↑↓ 换位：以当前可见卡序列表交换相邻项并整体落盘（新见过的供应商一并入册）。
        const moveQuotaCard = (providerName, delta) => {
          const names = adaptedRows.map((row) => row.provider)
          const from = names.indexOf(providerName)
          const to = from + delta
          if (from < 0 || to < 0 || to >= names.length || from === to) return
          names.splice(to, 0, names.splice(from, 1)[0])
          setCardOrder(names)
          writeQuotaCardOrder(names)
        }
        // 手动适配行（未适配/已停用的候选供应商）的选择状态；拆成两个独立 state 避免对象草稿接力更新。
        const [addProvider, setAddProvider] = useState('')
        const [addKind, setAddKind] = useState('')
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
          // 「调整排序」开关（≥2 张卡才有意义）：进入后卡片头部出现 ↑↓，再点一次收起。
          ...(adaptedRows.length >= 2
            ? [React.createElement('div', { key: 'quota-reorder-row', style: { display: 'flex', justifyContent: 'flex-end', margin: '2px 0 8px' } },
                React.createElement('button', {
                  type: 'button',
                  'data-testid': 'quota-reorder-toggle',
                  'aria-pressed': String(reorderMode),
                  title: translate('quota.reorder'),
                  onClick: () => setReorderMode(!reorderMode),
                  style: { fontSize: '12px', lineHeight: '20px', padding: '2px 12px', borderRadius: 999, border: `1px solid ${reorderMode ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`, background: 'transparent', color: reorderMode ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
                }, translate('quota.reorder')))]
            : []),
          adaptedRows.length === 0
            ? React.createElement('p', { style: hint }, translate('quota.noAdapted'))
            : React.createElement('div', { 'data-testid': 'quota-card-list', style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                adaptedRows.map((row, index) => {
                  const nameNode = React.createElement('span', { style: { fontWeight: 600, fontSize: '12px', overflowWrap: 'anywhere' } },
                    // 官网用量页链接（用户点名）：宿主按 kind 下发 usageUrl 时，展示名本身即外链。
                    typeof row.usageUrl === 'string' && row.usageUrl !== ''
                      ? React.createElement('a', {
                          'data-testid': `quota-usage-link-${row.provider}`,
                          href: row.usageUrl,
                          target: '_blank',
                          rel: 'noreferrer',
                          title: translate('quota.usageLink'),
                          style: { color: 'var(--dsw-alias-brand-primary)', textDecoration: 'underline' },
                        }, row.displayName || row.provider)
                      : (row.displayName || row.provider),
                    row.kindSource === 'auto'
                      ? React.createElement('span', {
                          'data-testid': `quota-auto-tag-${row.provider}`,
                          style: { marginLeft: '6px', fontSize: '10px', padding: '1px 6px', borderRadius: 999, background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-tertiary)', verticalAlign: 'middle' },
                        }, translate('quota.kindAuto'))
                      : null)
                  const windows = Array.isArray(row.windows) ? row.windows : []
                  // 每个窗口三段式：标签+百分比 / 进度条 / 重置单独一行；文本窗口（余额）只有一行（renderQuotaWindowRow 统一渲染）。
                  const windowBlocks = windows.map((window) => renderQuotaWindowRow(window, translate, row.provider))
                  let body
                  if (row.refreshing === true && windows.length === 0) {
                    body = React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('quota.refreshing'))
                  } else if (row.errorCode !== undefined && windows.length === 0) {
                    body = React.createElement('span', { 'data-testid': `quota-error-${row.provider}`, style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } },
                      `${quotaErrorMessage(row.errorCode, translate)}${row.errorDetail !== undefined ? ` (${row.errorDetail})` : ''}${typeof row.nextAllowedAt === 'number' && row.nextAllowedAt > Date.now() ? ` · ${translate('quota.retryAt', { time: formatClockTime(row.nextAllowedAt) }) }` : ''}`)
                  } else if (windows.length > 0) {
                    // 窗口块之间的留白由列容器统一控制（14px），进度条吃满整行宽度。
                    body = React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, windowBlocks)
                  } else {
                    body = React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('quota.empty'))
                  }
                  // DeepSeek 余额卡专属：峰谷提示（状态徽标 + 换挡倒计时 + 24h 色带 + 随北京时间移动的圆点）。
                  const peakTimeline = deepseekPeakVisible(row, windows)
                    ? React.createElement(QuotaPeakTimeline, { key: 'peak-timeline', showCaption: true })
                    : null
                                    // 手录重置卡（v0.19 过渡方案；v0.20 免次数、可多条）：每条一行，行尾自带「移除」。
                  const resetCardNodes = Array.isArray(row.resetCards)
                    ? row.resetCards.map((card, cardIndex) => {
                        const content = resetCardContent(card, translate)
                        const cardId = typeof card.id === 'string' && card.id !== '' ? card.id : `idx-${cardIndex}`
                        return React.createElement('div', {
                          key: cardId,
                          'data-testid': `quota-reset-card-${row.provider}-${cardId}`,
                          style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', lineHeight: '16px', color: content.expired ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-tertiary)' },
                        },
                        React.createElement('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                          React.createElement('span', null, content.title),
                          content.expiry !== '' ? React.createElement('span', null, content.expiry) : null),
                        React.createElement('button', {
                          type: 'button',
                          'data-testid': `quota-remove-${row.provider}-${cardId}`,
                          onClick: () => removeResetCard(row.provider, cardId),
                          style: { fontSize: '11px', padding: '2px 10px', borderRadius: 999, border: '1px solid var(--dsw-alias-state-error-primary)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' },
                        }, translate('quota.resetCard.remove')))
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
                  return React.createElement('div', { key: row.provider, 'data-testid': `quota-provider-card-${row.provider}`, style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)' } },
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' } },
                      nameNode,
                      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '5px' } },
                        // 手动排序（用户点名）：仅在「调整排序」模式下出现；↑↓ 与相邻卡换位，
                        // 首/末卡对应方向禁用；顺序存本浏览器。
                        ...(reorderMode ? [
                          React.createElement('button', {
                            type: 'button',
                            'data-testid': `quota-move-up-${row.provider}`,
                            'aria-label': translate('quota.card.moveUp'),
                            title: translate('quota.card.moveUp'),
                            disabled: index === 0,
                            onClick: () => moveQuotaCard(row.provider, -1),
                            style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', padding: 0, border: 'none', background: 'transparent', color: index === 0 ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-secondary)', cursor: index === 0 ? 'default' : 'pointer', opacity: index === 0 ? 0.45 : 1, fontSize: '12px', lineHeight: '16px' },
                          }, '↑'),
                          React.createElement('button', {
                            type: 'button',
                            'data-testid': `quota-move-down-${row.provider}`,
                            'aria-label': translate('quota.card.moveDown'),
                            title: translate('quota.card.moveDown'),
                            disabled: index === adaptedRows.length - 1,
                            onClick: () => moveQuotaCard(row.provider, 1),
                            style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', padding: 0, border: 'none', background: 'transparent', color: index === adaptedRows.length - 1 ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-secondary)', cursor: index === adaptedRows.length - 1 ? 'default' : 'pointer', opacity: index === adaptedRows.length - 1 ? 0.45 : 1, fontSize: '12px', lineHeight: '16px' },
                          }, '↓'),
                        ] : []),
                        // 手动刷新：SVG 图标按钮，点击强制该 provider 重拉上游；在途时置灰防重入。
                        React.createElement('button', {
                          type: 'button',
                          'data-testid': `quota-refresh-${row.provider}`,
                          'aria-label': translate('quota.refresh'),
                          title: translate('quota.refresh'),
                          disabled: row.refreshing === true,
                          onClick: () => refreshProvider(row.provider),
                          style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '2px', border: 'none', background: 'transparent', color: row.refreshing === true ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-secondary)', cursor: row.refreshing === true ? 'default' : 'pointer', opacity: row.refreshing === true ? 0.45 : 1 },
                        }, React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true }, React.createElement('path', { d: 'M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.77L13 11h7V4l-2.35 2.35z' }))),
                        typeof row.fetchedAt === 'number'
                          ? React.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('quota.updated', { time: formatClockTime(row.fetchedAt) }))
                          : null)),
                    body,
                    ...(peakTimeline !== null ? [peakTimeline] : []),
                    ...(row.status === 'unconfigured' && Array.isArray(row.credentialHints) && row.credentialHints.length > 0
                      ? (() => {
                          const editingCred = credEditor !== null && credEditor.provider === row.provider
                          const hints = row.credentialHints
                          const selectedName = hints.some((hint) => hint.name === credDraft.name) ? credDraft.name : (hints[0]?.name ?? '')
                          const selectedHint = hints.find((hint) => hint.name === selectedName)
                          return [editingCred
                            ? React.createElement('div', { key: 'cred-editor', 'data-testid': `quota-cred-editor-${row.provider}`, style: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)' } },
                                hints.length > 1
                                  ? React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                                      translate('quota.credential.nameLabel'),
                                      React.createElement('select', {
                                        'data-testid': 'quota-cred-name-select',
                                        value: selectedName,
                                        onChange: (event) => { setCredDraft({ ...credDraft, name: event.target.value }); setCredClearArmed(false) },
                                        style: quotaSelectStyle,
                                      },
                                      // 别名链说明：多个名字是同一密钥的备用存放槽（发现按序取第一个已配置的值），主名带「主名」标记。
                                      hints.map((hint, hintIndex) => React.createElement('option', { key: hint.name, value: hint.name }, `${hint.name}${hintIndex === 0 ? ` · ${translate('quota.credential.primary')}` : ''} · ${hint.configured === true ? translate('quota.credential.configured') : translate('quota.credential.notConfigured')}`))))
                                  : React.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', alignSelf: 'center' } }, `${selectedName}${selectedHint?.configured === true ? ` · ${translate('quota.credential.configured')}` : ''}`),
                                React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                                  translate('quota.credential.valueLabel'),
                                  React.createElement('input', {
                                    type: 'password',
                                    'data-testid': 'quota-cred-input-value',
                                    value: credDraft.value,
                                    onChange: (event) => setCredDraft({ ...credDraft, value: event.target.value }),
                                    autoComplete: 'off',
                                    style: inputStyle,
                                  })),
                                React.createElement('button', { type: 'button', 'data-testid': 'quota-cred-save', onClick: () => saveCredential(row.provider), disabled: credDraft.value.trim() === '', style: { minHeight: '28px', padding: '4px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-brand-primary)', background: credDraft.value.trim() === '' ? 'transparent' : 'var(--dsw-alias-brand-primary)', color: credDraft.value.trim() === '' ? 'var(--dsw-alias-label-tertiary)' : '#fff', cursor: credDraft.value.trim() === '' ? 'default' : 'pointer', fontSize: '12px' } }, translate('quota.credential.save')),
                                ...(selectedHint?.configured === true && selectedHint?.writable !== false ? [React.createElement('button', { type: 'button', key: 'cred-clear', 'data-testid': 'quota-cred-clear', title: credClearArmed ? translate('quota.credential.clearConfirm') : undefined, onClick: () => { if (!credClearArmed) { setCredClearArmed(true); return } setCredClearArmed(false); void clearCredential(row.provider, selectedName) }, style: { minHeight: '28px', padding: '4px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-state-error-primary)', background: credClearArmed ? 'var(--dsw-alias-state-error-primary)' : 'transparent', color: credClearArmed ? '#fff' : 'var(--dsw-alias-state-error-primary)', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' } }, translate(credClearArmed ? 'quota.credential.clearConfirm' : 'quota.credential.clear'))] : []),
                                React.createElement('button', { type: 'button', 'data-testid': 'quota-cred-cancel', onClick: closeCredEditor, style: { minHeight: '28px', padding: '4px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: '12px' } }, translate('quota.resetCard.cancel')),
                              )
                            : React.createElement('div', { key: 'cred-entry', style: { display: 'flex' } },
                                React.createElement('button', {
                                  type: 'button',
                                  'data-testid': `quota-cred-edit-${row.provider}`,
                                  onClick: () => openCredEditor(row),
                                  style: { fontSize: '12px', lineHeight: '20px', padding: '4px 14px', borderRadius: 999, border: '1px solid var(--dsw-alias-brand-primary)', background: 'transparent', color: 'var(--dsw-alias-brand-primary)', cursor: 'pointer', width: 'auto', minWidth: 0, overflow: 'visible', flex: '0 0 auto', whiteSpace: 'nowrap' },
                                }, translate(row.kind === 'cliproxy' ? 'quota.credential.editManagement' : 'quota.credential.edit')))]
                        })()
                      : []),
                    ...resetCardNodes,
                    ...(editingThis ? [React.createElement('div', { key: 'reset-editor', 'data-testid': `quota-reset-editor-${row.provider}`, style: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)' } },
                      resetField(translate('quota.resetCard.dateLabel'), 'quota-reset-input-date', 'datetime-local', 'expiresAt'),
                      resetField(translate('quota.resetCard.nameLabel'), 'quota-reset-input-name', 'text', 'label'),
                      React.createElement('button', { type: 'button', 'data-testid': 'quota-reset-card-save', onClick: saveResetCard, style: { minHeight: '28px', padding: '4px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)', color: '#fff', cursor: 'pointer', fontSize: '12px' } }, translate('quota.resetCard.add')),
                      React.createElement('button', { type: 'button', 'data-testid': 'quota-reset-cancel', onClick: () => setCardEditor(null), style: { minHeight: '28px', padding: '4px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: '12px' } }, translate('quota.resetCard.cancel')),
                    )] : []),
                    // 卡片脚部：类型下拉（当前选中 / 跟随自动识别 / 停用查询）；重置卡入口独占一行，避免被挤压截断。
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                      React.createElement('select', {
                        'data-testid': `quota-kind-select-${row.provider}`,
                        value: row.kind,
                        'aria-label': `${translate('quota.adapt')} · ${row.displayName || row.provider}`,
                        onChange: (event) => {
                          if (event.target.value === '') adaptProvider(row.provider, null)
                          else if (event.target.value === '__auto__') clearAdaptedKind(row.provider)
                          else adaptProvider(row.provider, event.target.value)
                        },
                        style: quotaSelectStyle,
                      },
                      QUOTA_KIND_OPTIONS.map((kind) => React.createElement('option', { key: kind, value: kind }, translate(`quota.kind.${kind}`))),
                      React.createElement('option', { value: '__auto__' }, translate('quota.followAuto')),
                      React.createElement('option', { value: '' }, translate('quota.disable')))),
                    // 重置卡手动录入目前仅智谱（zai-coding-cn）支持：其余供应商不显示入口。
                    ...(row.kind === 'zai-coding-cn' ? [React.createElement('div', { key: 'reset-add-row', style: { display: 'flex' } },
                      React.createElement('button', {
                        type: 'button',
                        'data-testid': `quota-card-edit-${row.provider}`,
                        onClick: () => openCardEditor(row),
                        style: { fontSize: '12px', lineHeight: '20px', padding: '4px 14px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', width: 'auto', minWidth: 0, overflow: 'visible', flex: '0 0 auto', whiteSpace: 'nowrap' },
                      }, translate('quota.resetCard.edit')))] : []))
                })),
          ...(candidateRows.length > 0 ? [React.createElement('div', { key: 'quota-add-adapt', 'data-testid': 'quota-add-adapt', style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: adaptedRows.length > 0 ? '2px' : '4px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
            React.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('quota.addAdapt')),
            React.createElement('select', { 'data-testid': 'quota-add-provider', value: addProvider, onChange: (event) => setAddProvider(event.target.value), style: quotaSelectStyle },
              React.createElement('option', { value: '' }, translate('quota.addPickProvider')),
              candidateRows.map((row) => React.createElement('option', { key: row.provider, value: row.provider }, row.displayName || row.provider))),
            React.createElement('select', { 'data-testid': 'quota-add-kind', value: addKind, onChange: (event) => setAddKind(event.target.value), style: quotaSelectStyle },
              React.createElement('option', { value: '' }, translate('quota.addPickKind')),
              QUOTA_KIND_OPTIONS.map((kind) => React.createElement('option', { key: kind, value: kind }, translate(`quota.kind.${kind}`)))),
            React.createElement('button', {
              type: 'button',
              'data-testid': 'quota-add-submit',
              disabled: addProvider === '' || addKind === '',
              onClick: () => {
                adaptProvider(addProvider, addKind)
                setAddProvider('')
                setAddKind('')
              },
              style: { fontSize: '12px', padding: '3px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-brand-primary)', background: addProvider === '' || addKind === '' ? 'transparent' : 'var(--dsw-alias-brand-primary)', color: addProvider === '' || addKind === '' ? 'var(--dsw-alias-label-tertiary)' : '#fff', cursor: addProvider === '' || addKind === '' ? 'default' : 'pointer' },
            }, translate('quota.adapt')))] : []))
      }

      function ServicePanel() {
        const translate = useTranslation()
        const { value: features } = useFeatures()
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
        // 模型列表口径：today=仅今日 / week=近 7 天（默认，保持既有视图）/ all=宿主索引内全部日期累计。
        const [modelScope, setModelScope] = useState('week')
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
          if (!featureEnabled('modelUsage')) return () => {}
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
        }, [features.modelUsage])
        useEffect(() => {
          if (!featureEnabled('backupMaintenance')) return () => {}
          let active = true
          ctx.connection.rpc.call('/dsh-service', 'backup-list', {}).then((res) => {
            if (!active) return
            if (!res || res.ok === false) setBackupError(translate('backup.error'))
            else setBackups(res.value)
          }).catch(() => {
            if (active) setBackupError(translate('backup.error'))
          })
          return () => { active = false }
        }, [features.backupMaintenance])
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
        // 模型列表头部的紧凑口径切换：沿用下划线标签语言，但按 11px 行高缩比。
        const compactTab = Object.assign({}, inlineTab, { padding: '3px 6px', fontSize: '11px' })
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
        const emptyModelTotals = (id) => ({ id, steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
        const accumulateModelTotals = (buckets, model) => {
          const existing = buckets.get(model.id) || emptyModelTotals(model.id)
          existing.steps += model.totals.steps || 0
          existing.inputTokens += model.totals.inputTokens || 0
          existing.outputTokens += model.totals.outputTokens || 0
          existing.cacheReadTokens += model.totals.cacheReadTokens || 0
          existing.cacheWriteTokens += model.totals.cacheWriteTokens || 0
          buckets.set(model.id, existing)
        }
        const modelTodayTotals = new Map()
        const modelWeekTotals = new Map()
        const modelAllTotals = new Map()
        const weekDayKeys = new Set(usageDays.map((day) => day.key))
        const todayDayKey = usageDays[usageDays.length - 1].key
        // 累计口径遍历宿主下发的全部日期键（可早于 7 天窗口）；周/今日按窗口命中累积。
        for (const [dayKey, source] of Object.entries(usage?.days || {})) {
          const targets = [modelAllTotals]
          if (weekDayKeys.has(dayKey)) targets.push(modelWeekTotals)
          if (dayKey === todayDayKey) targets.push(modelTodayTotals)
          for (const project of source.projects) {
            if (!selectedProjects.includes(project.id)) continue
            for (const model of project.models) {
              for (const buckets of targets) accumulateModelTotals(buckets, model)
            }
          }
        }
        const scopedModelTotals = modelScope === 'today' ? modelTodayTotals : modelScope === 'all' ? modelAllTotals : modelWeekTotals
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
        const sortedModels = [...scopedModelTotals.values()].sort((a, b) => modelTotalTokens(b) - modelTotalTokens(a) || b.steps - a.steps || a.id.localeCompare(b.id))
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
                  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' } },
                    React.createElement('div', { 'data-testid': 'usage-model-sort-hint', style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, translate(`usage.modelSortHint.${modelScope}`)),
                    React.createElement('div', { 'data-testid': 'usage-model-scope-tabs', style: { display: 'flex', gap: '2px' } },
                      ['today', 'week', 'all'].map((scopeId) => React.createElement('button', {
                        key: scopeId,
                        'data-testid': `usage-model-scope-${scopeId}`,
                        style: Object.assign({}, compactTab, modelScope === scopeId ? inlineTabActive : { color: 'var(--dsw-alias-label-secondary)', borderBottom: '2px solid transparent' }),
                        onClick: () => setModelScope(scopeId),
                      }, translate(`usage.modelScope.${scopeId}`))))),
                  visibleModels.map((model, index) => {
                    const total = modelTotalTokens(model)
                    const fillWidth = `${Math.round(total / maxModelTokens * 10000) / 100}%`
                    return React.createElement('div', { key: model.id, 'data-testid': `usage-model-row-${model.id}`, style: { padding: '8px 2px', borderTop: index === 0 ? 0 : '1px solid var(--dsw-alias-border-l1)' } },
                      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline', fontSize: '12px' } },
                        React.createElement('span', { style: { overflowWrap: 'anywhere' } }, model.id),
                        React.createElement('span', { style: { fontWeight: 650, whiteSpace: 'nowrap' } }, formatTokenValue(total))),
                      React.createElement('div', { 'data-testid': `usage-model-bar-${model.id}`, 'data-value': total, 'aria-label': translate(`usage.modelBar.${modelScope}`, { model: model.id, total: formatTokenValue(total) }), style: { height: '8px', borderRadius: '4px', marginTop: '6px', overflow: 'hidden', background: 'var(--dsw-alias-border-l1)' } },
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
        // 批量进行中在「技能」标签标题上显示进度角标（⟳done/total）。
        const { batch: skillsBadgeBatch } = useSkillsBatch()
        const skillsBadge = skillsBadgeBatch !== null && skillsBadgeBatch.phase === 'running' ? ' ⟳' + skillsBadgeBatch.done + '/' + skillsBadgeBatch.total : ''
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
          ...(features.taskNotifications !== false ? [['notify', 'tabs.notify']] : []),
          ['health', 'tabs.health'],
          ...(features.modelUsage !== false ? [['usage', 'tabs.usage']] : []),
          ...(features.quotaLookup !== false ? [['quota', 'tabs.quota']] : []),
          ...(features.backupMaintenance !== false ? [['backup', 'tabs.backup']] : []),
          ...(features.skillManager !== false ? [['skills', 'tabs.skills']] : []),
          ...(features.subagentRoute !== false ? [['subagent', 'tabs.subagent']] : []),
          ['restart', 'tabs.restart'],
        ]
        const warningTabs = tabs.filter(([id]) => tabWarnings[id]).map(([, label]) => translate(label))
        const visibleActiveTab = tabs.some(([id]) => id === activeTab) ? activeTab : 'overview'
        const tabContent = visibleActiveTab === 'overview'
          ? overviewBlock
          : visibleActiveTab === 'notify'
            ? notifyBlock
            : visibleActiveTab === 'health'
              ? healthBlock
              : visibleActiveTab === 'usage'
                ? usageBlock
                : visibleActiveTab === 'quota'
                  ? React.createElement(RemoteQuotaCard, null)
                : visibleActiveTab === 'backup'
                  ? maintenanceBlock
                : visibleActiveTab === 'skills'
                  ? React.createElement(SkillsSection, null)
                : visibleActiveTab === 'subagent'
                  ? React.createElement(SubagentSection, null)
                  : restartBlock
        return React.createElement('div', null,
          warningTabs.length > 0 ? React.createElement('div', { style: { marginBottom: '12px', padding: '11px 13px', borderRadius: '8px', background: 'rgba(198,128,0,0.16)', border: '1px solid rgba(198,128,0,0.48)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' } },
            React.createElement('div', { style: { fontSize: '13px', fontWeight: 700 } }, translate('tabs.alert.title')),
            React.createElement('div', { style: Object.assign({}, hint, { marginTop: '3px' }) }, translate('tabs.alert.body', { tabs: warningTabs.join('、') }))) : null,
          React.createElement('div', { 'data-testid': 'tab-list', style: { display: 'flex', gap: '10px', flexWrap: 'wrap', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
            tabs.map(([id, label]) => React.createElement('button', { key: id, style: Object.assign({}, inlineTab, visibleActiveTab === id ? inlineTabActive : { color: tabWarnings[id] ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)', borderBottom: '2px solid transparent' }), onClick: () => { setActiveTab(id); if (id === 'health') runDiagnostics(false) } }, `${tabWarnings[id] ? '⚠ ' : ''}${translate(label)}${id === 'skills' ? skillsBadge : ''}`))),
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
      ctx.slots.inject('conversation.input.left', () => {
        let dispose = null
        const sync = () => {
          if (dispose !== null) { dispose(); dispose = null }
          if (!featureEnabled('taskNotifications')) return
          dispose = ctx.slots.register(
            { name: 'conversation.input.left', id: 'dsh-service-notify', order: 90, label: () => t('notification.bellOn') },
            () => React.createElement(InlineNotifyBell, null),
          )
        }
        sync()
        const unsubscribe = featureScope.subscribe(sync)
        return () => { unsubscribe(); if (dispose !== null) dispose() }
      })
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'dsh-service-update', order: 90, label: () => t('update.badge') },
        () => React.createElement(UpdateBadge, null),
      ))
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
        { name: 'settings.plugin.item', id: 'dsh-service', key: 'dsh-service', order: 40 },
        () => React.createElement(FeatureSettingsCard, null),
      ))
      ctx.slots.inject('settings.section', () => {
        const disposePanel = ctx.slots.register(
          { name: 'settings.section', id: 'dsh-service', order: 99, label: () => t('nav.label') },
          () => React.createElement(ServicePanel, null),
        )
        // 左列「重启」「额度查询」「技能」「子代理」入口由各自标签内的开关控制，默认不注册
        restartNavToggle.sync()
        quotaNavToggle.sync()
        skillsNavToggle.sync()
        subagentNavToggle.sync()
        const unsubscribeFeatures = featureScope.subscribe(quotaNavToggle.sync)
        const unsubscribeFeaturesSkills = featureScope.subscribe(skillsNavToggle.sync)
        const unsubscribeFeaturesSubagent = featureScope.subscribe(subagentNavToggle.sync)
        return () => {
          unsubscribeFeatures()
          unsubscribeFeaturesSkills()
          unsubscribeFeaturesSubagent()
          disposePanel()
          restartNavToggle.disposeEntry()
          quotaNavToggle.disposeEntry()
          skillsNavToggle.disposeEntry()
          subagentNavToggle.disposeEntry()
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
      ctx.slots.inject('conversation.input.right', () => {
        let dispose = null
        const sync = () => {
          if (dispose !== null) { dispose(); dispose = null }
          if (!featureEnabled('quotaLookup')) return
          dispose = ctx.slots.register({
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
          }, (props) => React.createElement(QuotaRing, props))
        }
        sync()
        const unsubscribe = featureScope.subscribe(sync)
        return () => { unsubscribe(); if (dispose !== null) dispose() }
      })
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
