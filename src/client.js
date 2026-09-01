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
      'features.cardHint': '控制可选功能和外部能力。开关立即生效，无需重启。',
      'features.external': '外部能力',
      'features.healthDiagnostics': '健康诊断',
      'features.modelUsage': '模型统计',
      'features.quotaLookup': '额度查询',
      'features.backupMaintenance': '备份维护',
      'features.taskNotifications': '任务通知',
      'features.healthz': '/healthz 探活端点',
      'features.skillManager': '技能管理',
      'features.readOnly': '当前设置不可写。',
      'tabs.skills': '技能',
      'tabs.subagent': '子代理',
      'tabs.sessions': '会话管理',
      'features.subagentRoute': '子代理模型',
      'features.mobileAdaptation': '移动端适配',
      'features.sessionManager': '会话管理',
      'sessions.title': '会话管理',
      'sessions.hint': '查看、导出、归档与会话搜索；删除仅限已归档。',
      'sessions.filter.all': '全部',
      'sessions.filter.archived': '仅归档',
      'sessions.filter.deleted': '已删除',
      'sessions.refresh': '刷新',
      'sessions.batch.enter': '批量选择',
      'sessions.batch.exit': '退出批量',
      'sessions.batch.selectAll': '全选',
      'sessions.batch.clearAll': '取消全选',
      'sessions.batch.selected': '已选择 {count} 项',
      'sessions.batch.selectRow': '选择会话：{title}',
      'sessions.batch.export': '导出 ({count})',
      'sessions.batch.archive': '归档 ({count})',
      'sessions.batch.delete': '删除 ({count})',
      'sessions.batch.completed': '已完成{action}：{count} 项',
      'sessions.batch.failed': '{action}完成 {done}/{total} 项；{error}',
      'sessions.batch.deleteTitle': '删除 {count} 个会话',
      'sessions.batch.deleteBody': '将永久删除以下已归档会话的日志文件，删除后不可恢复。',
      'sessions.batch.deleteItem': '{title}（{bytes}）',
      'sessions.status.loading': '加载中…',
      'sessions.status.working': '处理中…',
      'sessions.status.unavailableTime': '时间未知',
      'sessions.glyph.expand': '▸',
      'sessions.glyph.collapse': '▾',
      'sessions.glyph.back': '←',
      'sessions.search.placeholder': '搜索对话内容…',
      'sessions.search.archivedOnly': '仅搜归档',
      'sessions.sort.createdDesc': '创建时间倒序',
      'sessions.sort.createdAsc': '创建时间正序',
      'sessions.sort.title': '按标题',
      'sessions.row.live': '运行中',
      'sessions.row.archived': '已归档',
      'sessions.row.deleted': '已删除',
      'sessions.row.events': '{count} 条事件',
      'sessions.row.noTitle': '（无标题）',
      'sessions.action.view': '查看',
      'sessions.action.export': '导出',
      'sessions.action.archive': '归档',
      'sessions.action.delete': '删除',
      'sessions.empty.all': '没有会话',
      'sessions.empty.archived': '没有归档会话',
      'sessions.empty.deleted': '暂无删除记录',
      'sessions.empty.search': '没有命中「{query}」',
      'sessions.error.load': '加载失败：{error}',
      'sessions.error.feature-disabled': '会话管理功能已在设置中关闭',
      'sessions.error.network': '网络错误：无法连接宿主',
      'sessions.error.session-not-found': '会话不存在或已被删除',
      'sessions.error.live-session-rejected': '会话正在运行，无法删除',
      'sessions.error.session-not-archived': '仅已归档会话可以删除',
      'sessions.error.unknown-delete-plan': '删除请求已失效，请重新发起',
      'sessions.error.export-failed': '导出失败：{error}',
      'sessions.detail.back': '返回列表',
      'sessions.detail.open': '在官方会话中打开',
      'sessions.detail.archiveDisabled': '归档会话/空白会话无法在官方界面打开',
      'sessions.detail.exportAll': '导出全部 ZIP',
      'sessions.detail.exporting': '正在导出…',
      'sessions.detail.loadMore': '加载更多（{remaining}）',
      'sessions.detail.noMore': '已加载全部 {total} 条事件',
      'sessions.detail.noise': '系统事件',
      'sessions.detail.noiseBlock': '{count} 条系统事件',
      'sessions.detail.noiseExpand': '展开全部',
      'sessions.detail.noiseCollapse': '收起',
      'sessions.detail.cwd': '{cwd}',
      'sessions.detail.created': '创建于 {time}',
      'sessions.hit.title': '命中 {count} 条',
      'sessions.hit.return': '返回搜索结果',
      'sessions.hit.badge': '命中',
      'sessions.hit.prev': '◀ 上一个',
      'sessions.hit.next': '下一个 ▶',
      'sessions.hit.inSession': '本会话 {count} 处命中',
      'sessions.delete.title': '删除会话',
      'sessions.delete.body': '将永久删除以下会话的日志文件，删除后不可恢复。',
      'sessions.delete.consequence.log': '删除会话日志（{bytes}）',
      'sessions.delete.consequence.sidebar': '会话从官方侧栏隐藏',
      'sessions.delete.confirm': '确认删除',
      'sessions.delete.cancel': '取消',
      'sessions.delete.done': '已删除',
      'sessions.export.includes': '含子代理与附件',
      'sessions.navToggle': '设置页左列显示「会话管理」入口',
      'sessions.navToggleHint': '默认关闭；开启后在设置页左侧标签列显示会话管理入口',
      'sessions.oneWay': '归档不可恢复',
      'sessions.oneWayHint': '归档后会话从官方侧栏隐藏；官方不支持恢复归档，只能通过本面板删除。',
      'mobile.fab.label': '打开侧栏菜单',
      'mobile.debug.title': '移动端诊断',
      'mobile.debug.viewport': '视口',
      'mobile.debug.drawer': '抽屉',
      'mobile.debug.details': '预览列',
      'mobile.debug.errors': 'JS 错误',
      'mobile.debug.stateOn': '开',
      'mobile.debug.stateOff': '关',
      'mobile.immersive.hide': '收起头部与输入框',
      'mobile.immersive.show': '展开头部与输入框',
      'mobile.debug.immersive': '沉浸',
      'conversation.jump.previousReply': '上一条用户回复',
      'subagent.title': '子代理模型',
      'subagent.hint': '控制未显式指定模型的子代理所用模型；显式指定的不受影响。',
      'subagent.mode.label': '模式',
      'subagent.mode.inherit': '初始（不干预）',
      'subagent.mode.inherit.desc': '不注入任何路由，保持宿主原生继承行为：子代理使用会话创建时烘焙的默认模型。',
      'subagent.mode.follow': '跟随主模型',
      'subagent.mode.follow.desc': '每次派生时读取主对话当前实际使用的模型（最近一次请求的渠道）并注入。',
      'subagent.mode.custom': '自定义',
      'subagent.mode.custom.desc': '所有未显式指定模型的子代理固定使用下方选择的模型。',
      'subagent.provider': '供应商',
      'subagent.model': '模型',
      'subagent.reasoningEffort': '思考等级',
      'subagent.reasoningEffort.default': '使用模型默认（不指定）',
      'subagent.reasoningEffort.unavailable': '该模型未声明可选思考等级',
      'subagent.modelsEmpty': '模型清单为空：无法解析宿主 LLM 渠道。',
      'subagent.save': '保存',
      'subagent.saved': '已保存',
      'subagent.reset': '重置回初始配置',
      'subagent.saving': '保存中…',
      'subagent.unavailable': '宿主未提供子代理注册表（subagents 服务缺席），配置不会生效。',
      'subagent.error': '操作失败：{error}',
      'subagent.error.feature-disabled': '子代理模型功能已在设置中关闭',
      'subagent.error.llm-unavailable': '宿主 LLM 服务不可用',
      'subagent.error.unknown-mode': '未知模式',
      'subagent.error.invalid-model-route': '供应商或模型不在宿主清单内',
      'subagent.error.invalid-reasoning-effort': '思考等级不受该模型支持，请重新选择',
      'subagent.error.network': '网络错误：无法连接宿主',
      'subagent.fallback.title': '回退模型（按顺序）',
      'subagent.fallback.item': '回退 {index}',
      'subagent.fallback.hint': '第一路由不可用时（渠道已卸载、额度查询判定不可服务）依次尝试回退；全部不可用则回落原生继承，不让派生失败。',
      'subagent.fallback.add': '添加回退',
      'subagent.fallback.sort': '调整排序',
      'subagent.fallback.sort.done': '完成排序',
      'subagent.fallback.remove': '移除',
      'subagent.fallback.up': '上移',
      'subagent.fallback.down': '下移',
      'subagent.fallback.empty': '未添加回退：第一路由不可用时子代理回落到原生继承。',
      'subagent.fallback.limit': '已达上限（{max} 个）',
      'subagent.error.invalid-fallback-route': '回退条目不在宿主清单内，请重新选择',
      'subagent.turnTail.label': '子代理模型：',
      'subagent.turnTail.countOne': '子代理 ×1',
      'subagent.turnTail.countMany': '子代理 ×{count}',
      'subagent.turnTail.unknown': '（模型未记录）',
      'subagent.dock.title': '输入框底部显示子代理信息',
      'subagent.dock.desc': '在对话页输入框下方常驻一行本会话子代理实际使用的模型（20 秒刷新，不受事件折叠影响）。关闭后仅保留回合尾部小字行。',
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
      'skills.error.annotated-confirm-required': '已注释技能需再次确认后才能被覆盖',
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
      'skills.batch.title': '批量补全技能说明',
      'skills.batch.hint': '逐条调用所选模型为未注释或正文有变的技能生成说明；已注释技能在计划中单列，再次确认后才会被覆盖。结果仅存插件内并展示在条目下方。',
      'skills.batch.plan': '生成计划',
      'skills.batch.candidates': '候选 {count} 项',
      'skills.batch.estBytes': '约发送 {size} 内容',
      'skills.batch.skipped': '跳过 {count} 项（无效 / 被遮蔽）',
      'skills.batch.annotated': '已注释将覆盖 {count} 项',
      'skills.batch.annotatedList': '将覆盖清单',
      'skills.batch.forceConfirm': '确认强制补全（覆盖 {count} 项已注释）',
      'skills.skippedList': '跳过清单',
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
      // v0.39：技能/子代理的左列入口撤销，相关开关文案随之移除。
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
      // v0.39 概览六段式：状态摘要/可行动项/核心操作文案。
      'overview.status.normal': '所有系统运行正常',
      'overview.status.info': '有 {count} 条提示',
      'overview.status.warning': '有 {count} 项需要注意',
      'overview.status.error': '有 {count} 项需要处理',
      'overview.quotaCritical': '存在使用量已达 80% 的额度窗口',
      'overview.backupEmpty': '还没有备份，建议创建一份',
      'overview.updateAvailable': '检测到新版本可用',
      'overview.action.health': '健康检查',
      'tabs.backup': '备份维护',
      'tabs.restart': '重启',
      // v0.39 六页信息架构：顶层 维护/配置 聚合页 + 配置页两个子页 + 功能分组标题。
      'tabs.maintenance': '维护',
      'tabs.configuration': '配置',
      'tabs.features': '功能',
      'tabs.notifications': '通知',
      'maintenance.empty': '所有维护子页均已关闭。可在「配置 → 功能」中开启备份、技能、子代理或会话管理。',
      'config.notificationsDisabled': '任务通知功能已在「功能」页关闭，以下设置仅作展示；重新开启后通知才会生效。',
      'features.group.runtime': '运行与观测',
      'features.group.maintenance': '维护',
      'features.group.interaction': '交互',
      // v0.39 页面头部描述（标题复用 tabs.*）。
      'page.quota.desc': '查询各供应商额度、余额与重置时间；额度圆环跟随会话模型供应商，查询由宿主节流。',
      'page.diagnostics.desc': '健康检查与运行环境诊断，异常时给出处理建议。',
      'page.configuration.desc': '功能开关与任务通知设置。',
      'tabs.alert.title': '服务控制提醒',
      'tabs.alert.body': '以下功能需要处理：{tabs}',
      'tabs.alert.join': '、',
      'tabs.alert.dot': '此标签存在故障提醒',
      'permissions.title': '文件权限',
      'permissions.description': '检查 Agent 能否读写并进入 DSH_HOME 与工作区。深检跳过 .git；修复补充当前用户所需权限并保留执行位。',
      'permissions.target': '目标属主：{owner}',
      'permissions.repair': '修复权限',
      'permissions.repairing': '修复中…',
      'permissions.confirm': '确认修复',
      'permissions.confirmHint': '跳过 .git，递归恢复当前用户属主并补充 Agent 读写权限，保留已有执行位。',
      'permissions.cancel': '取消',
      // v0.39 折叠区开关文案。
      'permissions.show': '权限与修复',
      'permissions.hide': '收起',
      'permissions.error': '权限操作失败',
      'permissions.summary.ok': '{count} 个根目录检查正常',
      'permissions.summary.warning': '发现 {count} 个根目录异常',
      'permissions.showDetails': '查看详情',
      'permissions.hideDetails': '隐藏详情',
      'permissions.deep': '深度检查',
      'permissions.deepChecking': '扫描中…',
      'permissions.deepSummary': '扫描 {scanned} 项，用时 {duration} ms；目录不可编辑 {directories}，文件不可编辑 {files}，无法读取 {unreadable}。',
      'backup.title': '备份管理',
      'backup.description': '备份会话、配置与插件 profile 清单，不含 node_modules 与凭据；不自动清理。',
      'backup.create': '创建备份',
      'backup.creating': '创建中…',
      'backup.progress.copy': '正在复制会话数据（{current}/{total}）…',
      'backup.progress.archive': '正在打包归档（{current}/{total}）…',
      'backup.progress.validate': '正在校验归档（{current}/{total}）…',
      'backup.progress.publish': '正在发布备份（{current}/{total}）…',
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
      'backup.inspecting': '检查中…',
      'backup.restoreConfirm': '确认恢复',
      'backup.restoreHint': '完整性检查通过。确认后会按下方计划覆盖数据；提交前宿主会再次检查归档和当前目标是否发生变化。',
      'backup.restoreError': '备份恢复失败',
      'backup.integrity.ok': '完整性检查通过',
      'backup.integrity.invalid': '归档不可恢复',
      'backup.integrity.summary': '共 {entries} 个条目，解压后 {size}；会话文件 {sessions}，配置文件 {config}，profile 清单 {profiles}。',
      'backup.plan.sessions': '会话目录将整体替换',
      'backup.plan.config': '配置覆盖 {replace} 项，移除 {remove} 项',
      'backup.plan.profiles': '覆盖 {count} 个 profile 的 package.json，保留 node_modules 与其他文件',
      'backup.plan.expires': '恢复计划有效至 {time}',
      'backup.manualRestartTitle': '恢复完成，需要手动重启',
      'backup.manualRestartBody': '数据已恢复，但当前进程仍在运行旧状态。请在运行 dsh 的终端按 Ctrl+C，然后重新启动 dsh。',
      'backup.error.backup-gzip-invalid': '归档不是有效的 gzip 文件或已损坏。',
      'backup.error.backup-tar-invalid': 'tar 结构或校验和无效。',
      'backup.error.backup-entry-traversal': '归档含越界或不安全路径。',
      'backup.error.backup-entry-absolute': '归档含绝对路径。',
      'backup.error.backup-entry-link': '归档含符号链接或硬链接。',
      'backup.error.backup-entry-type': '归档含不支持的特殊条目。',
       'backup.error.backup-entry-platform': '归档包含其他系统不兼容的文件名。',
      'backup.error.backup-entry-unexpected': '归档含备份范围外的文件。',
      'backup.error.backup-profile-invalid': 'profile package.json 无效。',
      'backup.error.backup-section-missing': '归档缺少必要分区。',
      'backup.error.backup-size-limit': '归档超过安全大小或条目限制。',
      'backup.error.backup-archive-invalid': '归档未通过完整性检查。',
       'backup.error.backup-source-changed': '会话正在写入，备份未完成，请稍后重试。',
       'backup.error.backup-source-unsafe': '备份源含符号链接或特殊文件，已拒绝创建。',
       'backup.error.tar-failed': '归档工具执行失败，请检查 tar/gzip 是否可用。',
      'backup.error.active-work': '检测到运行中的工作，暂不能恢复。',
      'backup.error.restore-plan-expired': '恢复计划已过期，请重新检查。',
      'backup.error.restore-source-changed': '备份归档在确认前发生变化，请重新检查。',
      'backup.error.restore-target-changed': '当前数据在确认前发生变化，请重新检查。',
      'backup.error.restore-target-unsafe': '当前目标含不安全的链接或特殊文件。',
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
      'update.channelAlpha': 'Alpha 版',
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
      'update.manualConfirm': '未检测到进程管理器。升级完成后 DSH 不会自动重启。',
      'update.manualProceed': '仍要升级',
      'update.manualRestartTitle': '升级完成，需要手动重启',
      'update.manualRestartBody': '新版本已安装，但当前进程仍在运行旧版本。请在运行 dsh 的终端窗口按 Ctrl+C（或直接关闭窗口），然后重新启动 dsh。',
      'restart.title': '服务重启',
      'restart.description': '重启 dsh web 进程。运行中的工作会中断，持久化会话可恢复。',
      'restart.button': '重启 dsh web',
      'restart.sending': '发送中…',
      'restart.confirm': '确认重启',
      'restart.force': '仍要重启',
      'restart.cancel': '取消',
      'restart.sent': '重启指令已发出。',
      'restart.sentHint': '页面连接即将断开，服务恢复后将自动刷新。',
      'restart.idleHint': '当前没有检测到运行中的工作。确认后将断开连接，等待服务自动重启。',
      'restart.manualWarn': '当前疑似终端手动启动环境：确认后进程将退出且不会自动拉起，需要你手动重新运行 dsh。',
      'restart.sentManualHint': '当前为手动启动环境，服务不会自动拉起；请在原终端重新运行 dsh 后刷新。',
      'restart.navToggle': '设置页左列显示「重启」入口',
      'restart.navToggleHint': '默认关闭；开启后在设置页左侧标签列底部显示快捷重启入口',
      'activity.agent': 'Agent',
      'activity.job': '后台任务',
      'activity.terminal': '终端',
      'activity.warning': '检测到 {count} 项运行中的工作，重启将中断。',
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
      'usage.chartSummary': '七天内累计用量 {total} token',
      'usage.barDay': '{day} 总用量 {total} token',
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
      'notification.description': '主会话任务结束，或会话需要授权、抉择时发送浏览器通知；子代理完成任务不通知。',
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
      'notification.bellShow': '显示输入框旁的铃铛图标',
      'quota.cardTitle': '额度查询',
      'quota.navToggle': '设置页左列显示「额度查询」入口',
      'quota.navToggleHint': '默认关闭；开启后在设置页左侧标签列底部显示「额度查询」快捷入口',
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
      // v0.39 卡片分区：最紧窗口徽标 / 高级配置折叠 / 重置区标题。
      'quota.advanced': '高级配置',
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
      'quota.kind.stepfun': 'StepFun 余额',
      'quota.kind.stepfun-step-plan': 'StepFun Step Plan 订阅',
      'quota.kind.cliproxy': 'CLIProxyAPI 账号额度',
      'quota.kind.xiaomi-token-plan-cn': '小米 MiMo Token Plan',
      'quota.window.total_token': '套餐总额度',
      'quota.window.compensation_total_token': '补偿积分',
      'quota.window.plan-name': '订阅套餐',
      'quota.window.credit-pool': '月度 Credit 池',
      'quota.window.topup-credit': '加油包 Credit',
      'quota.window.five-hour': '5 小时额度',
      'quota.error.no-subscription': '当前账号没有生效中的订阅额度',
      'quota.error.credential-rejected': '控制台登录态已失效，请重新从浏览器复制',
      'quota.credential.editCookie': '填写控制台 Cookie（网页登录态）',
      'quota.credential.editToken': '填写控制台令牌（Oasis-Token，浏览器登录态）',
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
      'features.cardHint': 'Controls optional features and external capabilities. Switches apply instantly without restart.',
      'features.external': 'External capabilities',
      'features.healthDiagnostics': 'Health diagnostics',
      'features.modelUsage': 'Model statistics',
      'features.quotaLookup': 'Quota lookup',
      'features.backupMaintenance': 'Backup maintenance',
      'features.taskNotifications': 'Task notifications',
      'features.healthz': '/healthz liveness endpoint',
      'features.skillManager': 'Skill manager',
      'features.readOnly': 'These settings are read-only.',
      'tabs.skills': 'Skills',
      'tabs.subagent': 'Subagents',
      'tabs.sessions': 'Sessions',
      'features.subagentRoute': 'Subagent model',
      'features.mobileAdaptation': 'Mobile adaptation',
      'features.sessionManager': 'Session manager',
      'sessions.title': 'Session manager',
      'sessions.hint': 'View, export, archive, and search sessions; deletion is limited to archived ones.',
      'sessions.filter.all': 'All',
      'sessions.filter.archived': 'Archived',
      'sessions.filter.deleted': 'Deleted',
      'sessions.refresh': 'Refresh',
      'sessions.batch.enter': 'Select multiple',
      'sessions.batch.exit': 'Exit selection',
      'sessions.batch.selectAll': 'Select all',
      'sessions.batch.clearAll': 'Clear all',
      'sessions.batch.selected': '{count} selected',
      'sessions.batch.selectRow': 'Select session: {title}',
      'sessions.batch.export': 'Export ({count})',
      'sessions.batch.archive': 'Archive ({count})',
      'sessions.batch.delete': 'Delete ({count})',
      'sessions.batch.completed': '{action} completed for {count}',
      'sessions.batch.failed': '{action} completed for {done}/{total}; {error}',
      'sessions.batch.deleteTitle': 'Delete {count} sessions',
      'sessions.batch.deleteBody': 'This permanently deletes the logs of the archived sessions below. This cannot be undone.',
      'sessions.batch.deleteItem': '{title} ({bytes})',
      'sessions.status.loading': 'Loading…',
      'sessions.status.working': 'Working…',
      'sessions.status.unavailableTime': 'Time unavailable',
      'sessions.glyph.expand': '▸',
      'sessions.glyph.collapse': '▾',
      'sessions.glyph.back': '←',
      'sessions.search.placeholder': 'Search conversation content…',
      'sessions.search.archivedOnly': 'Search archived only',
      'sessions.sort.createdDesc': 'Created (newest first)',
      'sessions.sort.createdAsc': 'Created (oldest first)',
      'sessions.sort.title': 'By title',
      'sessions.row.live': 'Running',
      'sessions.row.archived': 'Archived',
      'sessions.row.deleted': 'Deleted',
      'sessions.row.events': '{count} events',
      'sessions.row.noTitle': '（No title）',
      'sessions.action.view': 'View',
      'sessions.action.export': 'Export',
      'sessions.action.archive': 'Archive',
      'sessions.action.delete': 'Delete',
      'sessions.empty.all': 'No sessions',
      'sessions.empty.archived': 'No archived sessions',
      'sessions.empty.deleted': 'No deleted sessions yet',
      'sessions.empty.search': 'No matches for “{query}”',
      'sessions.error.load': 'Load failed: {error}',
      'sessions.error.feature-disabled': 'Session manager is disabled in settings',
      'sessions.error.network': 'Network error: cannot reach the host',
      'sessions.error.session-not-found': 'Session not found or already deleted',
      'sessions.error.live-session-rejected': 'Session is running and cannot be deleted',
      'sessions.error.session-not-archived': 'Only archived sessions can be deleted',
      'sessions.error.unknown-delete-plan': 'Delete request expired, please retry',
      'sessions.error.export-failed': 'Export failed: {error}',
      'sessions.detail.back': 'Back to list',
      'sessions.detail.open': 'Open in official view',
      'sessions.detail.archiveDisabled': 'Archived or blank sessions cannot be opened in the official view',
      'sessions.detail.exportAll': 'Export full ZIP',
      'sessions.detail.exporting': 'Exporting…',
      'sessions.detail.loadMore': 'Load more ({remaining})',
      'sessions.detail.noMore': 'All {total} events loaded',
      'sessions.detail.noise': 'System events',
      'sessions.detail.noiseBlock': '{count} system events',
      'sessions.detail.noiseExpand': 'Expand all',
      'sessions.detail.noiseCollapse': 'Collapse',
      'sessions.detail.cwd': '{cwd}',
      'sessions.detail.created': 'Created {time}',
      'sessions.hit.title': '{count} hits',
      'sessions.hit.return': 'Back to search results',
      'sessions.hit.badge': 'HIT',
      'sessions.hit.prev': '◀ Prev',
      'sessions.hit.next': 'Next ▶',
      'sessions.hit.inSession': '{count} matches in this session',
      'sessions.delete.title': 'Delete session',
      'sessions.delete.body': 'This permanently deletes the session log below. This cannot be undone.',
      'sessions.delete.consequence.log': 'Delete session log ({bytes})',
      'sessions.delete.consequence.sidebar': 'Session disappears from the official sidebar',
      'sessions.delete.confirm': 'Delete',
      'sessions.delete.cancel': 'Cancel',
      'sessions.delete.done': 'Deleted',
      'sessions.export.includes': 'Includes subagents and attachments',
      'sessions.navToggle': 'Show “Sessions” entry in the settings sidebar',
      'sessions.navToggleHint': 'Disabled by default; shows the session manager entry at the bottom of the settings sidebar when enabled',
      'sessions.oneWay': 'Archiving cannot be undone',
      'sessions.oneWayHint': 'Archived sessions are hidden from the official sidebar; the official UI cannot unarchive, deletion here is the only way out.',
      'mobile.fab.label': 'Open sidebar menu',
      'mobile.debug.title': 'Mobile diagnostics',
      'mobile.debug.viewport': 'Viewport',
      'mobile.debug.drawer': 'Drawer',
      'mobile.debug.details': 'Details',
      'mobile.debug.errors': 'JS errors',
      'mobile.debug.stateOn': 'on',
      'mobile.debug.stateOff': 'off',
      'mobile.immersive.hide': 'Hide header and composer',
      'mobile.immersive.show': 'Show header and composer',
      'mobile.debug.immersive': 'Immersive',
      'conversation.jump.previousReply': 'Previous user message',
      'subagent.title': 'Subagent model',
      'subagent.hint': 'Controls the model used by subagents without an explicit model; explicitly specified ones are unaffected.',
      'subagent.mode.label': 'Mode',
      'subagent.mode.inherit': 'Default (no override)',
      'subagent.mode.inherit.desc': 'Injects nothing and keeps the native inheritance: subagents use the model baked in when the session was created.',
      'subagent.mode.follow': 'Follow main model',
      'subagent.mode.follow.desc': 'Each delegation reads the model the main conversation actually uses right now (route of its latest request) and injects it.',
      'subagent.mode.custom': 'Custom',
      'subagent.mode.custom.desc': 'Every delegation without an explicit model uses the model selected below.',
      'subagent.provider': 'Provider',
      'subagent.model': 'Model',
      'subagent.reasoningEffort': 'Reasoning effort',
      'subagent.reasoningEffort.default': 'Use model default (unspecified)',
      'subagent.reasoningEffort.unavailable': 'This model does not declare selectable reasoning levels',
      'subagent.modelsEmpty': 'Model list is empty: host LLM channels cannot be resolved.',
      'subagent.save': 'Save',
      'subagent.saved': 'Saved',
      'subagent.reset': 'Reset to default',
      'subagent.saving': 'Saving…',
      'subagent.unavailable': 'The host exposes no subagents registry (service missing); this configuration has no effect.',
      'subagent.error': 'Operation failed: {error}',
      'subagent.error.feature-disabled': 'Subagent model is switched off in settings',
      'subagent.error.llm-unavailable': 'Host LLM service is unavailable',
      'subagent.error.unknown-mode': 'Unknown mode',
      'subagent.error.invalid-model-route': 'Provider or model is not in the host catalog',
      'subagent.error.invalid-reasoning-effort': 'This reasoning effort is not supported by the selected model; choose another',
      'subagent.error.network': 'Network error: cannot reach the host',
      'subagent.fallback.title': 'Fallback models (in order)',
      'subagent.fallback.item': 'Fallback {index}',
      'subagent.fallback.hint': 'When the primary route is unavailable (channel unloaded, or quota state marks it unserviceable), try fallbacks in order; if none works, fall back to native inheritance instead of failing the delegation.',
      'subagent.fallback.add': 'Add fallback',
      'subagent.fallback.sort': 'Reorder',
      'subagent.fallback.sort.done': 'Done',
      'subagent.fallback.remove': 'Remove',
      'subagent.fallback.up': 'Move up',
      'subagent.fallback.down': 'Move down',
      'subagent.fallback.empty': 'No fallbacks: delegations fall back to native inheritance when the primary route is unavailable.',
      'subagent.fallback.limit': 'Limit reached ({max})',
      'subagent.error.invalid-fallback-route': 'Fallback entry is not in the host catalog, please choose again',
      'subagent.turnTail.label': 'Subagent models: ',
      'subagent.turnTail.countOne': '1 subagent',
      'subagent.turnTail.countMany': '{count} subagents',
      'subagent.turnTail.unknown': ' (models not recorded)',
      'subagent.dock.title': 'Show subagent info under the composer',
      'subagent.dock.desc': 'Keeps a session-level line under the composer listing the models your subagents actually used (20s refresh, unaffected by compaction). When off, only the per-turn tail line remains.',
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
      'skills.error.annotated-confirm-required': 'Annotated skills need an explicit confirm before being overwritten',
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
      'skills.batch.title': 'Batch-fill skill descriptions',
      'skills.batch.hint': 'Call the selected model per skill to draft explanations for uncommented or changed skills; annotated skills are listed separately and are only overwritten after an explicit confirm. Results stay in the plugin and render below the entry.',
      'skills.batch.plan': 'Plan batch',
      'skills.batch.candidates': '{count} candidates',
      'skills.batch.estBytes': '~{size} of content will be sent',
      'skills.batch.skipped': '{count} skipped (invalid / shadowed)',
      'skills.batch.annotated': '{count} annotated will be overwritten',
      'skills.batch.annotatedList': 'To be overwritten',
      'skills.batch.forceConfirm': 'Confirm forced refill ({count} annotated)',
      'skills.skippedList': 'Skipped',
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
      'overview.status.normal': 'All systems nominal',
      'overview.status.info': 'You have {count} note(s)',
      'overview.status.warning': 'You have {count} item(s) to review',
      'overview.status.error': 'You have {count} item(s) needing attention',
      'overview.quotaCritical': 'A quota window has reached 80% usage',
      'overview.backupEmpty': 'No backups yet — consider creating one',
      'overview.updateAvailable': 'A new version is available',
      'overview.action.health': 'Health check',
      'tabs.backup': 'Backup',
      'tabs.restart': 'Restart',
      'tabs.maintenance': 'Maintenance',
      'tabs.configuration': 'Configuration',
      'tabs.features': 'Features',
      'tabs.notifications': 'Notifications',
      'maintenance.empty': 'All maintenance pages are disabled. Enable backup, skills, subagents, or session management under “Configuration → Features”.',
      'config.notificationsDisabled': 'Task notifications are turned off on the Features page; these settings are shown for reference only until re-enabled.',
      'features.group.runtime': 'Runtime and observation',
      'features.group.maintenance': 'Maintenance',
      'features.group.interaction': 'Interaction',
      'page.quota.desc': 'Quota, balance, and reset times across providers; the ring follows the session provider and queries are host-throttled.',
      'page.diagnostics.desc': 'Health checks and runtime environment diagnostics.',
      'page.configuration.desc': 'Feature switches and task notification settings.',
      'tabs.alert.title': 'Service control alert',
      'tabs.alert.body': 'These areas need attention: {tabs}',
      'tabs.alert.join': ', ',
      'tabs.alert.dot': 'Alert on this tab',
      'permissions.title': 'File permissions',
      'permissions.description': 'Checks whether the Agent can read, write, and enter DSH_HOME and workspaces. Deep scans skip .git; repair adds only the needed permissions and keeps execute bits.',
      'permissions.target': 'Target owner: {owner}',
      'permissions.repair': 'Repair permissions',
      'permissions.repairing': 'Repairing…',
      'permissions.confirm': 'Confirm repair',
      'permissions.confirmHint': 'Skips .git, restores ownership to the current user, adds Agent read/write access, and keeps existing execute bits.',
      'permissions.cancel': 'Cancel',
      'permissions.show': 'Permissions & repair',
      'permissions.hide': 'Collapse',
      'permissions.error': 'Permission operation failed',
      'permissions.summary.ok': '{count} root path(s) passed the check',
      'permissions.summary.warning': '{count} root path(s) need attention',
      'permissions.showDetails': 'Show details',
      'permissions.hideDetails': 'Hide details',
      'permissions.deep': 'Deep check',
      'permissions.deepChecking': 'Scanning…',
      'permissions.deepSummary': 'Scanned {scanned} entries in {duration} ms; non-editable directories {directories}, non-editable files {files}, unreadable {unreadable}.',
      'backup.title': 'Backup management',
      'backup.description': 'Backs up sessions, config, and plugin profiles — no node_modules or credentials; never auto-pruned.',
      'backup.create': 'Create backup',
      'backup.creating': 'Creating…',
      'backup.progress.copy': 'Copying session data ({current}/{total})…',
      'backup.progress.archive': 'Packing archive ({current}/{total})…',
      'backup.progress.validate': 'Verifying archive ({current}/{total})…',
      'backup.progress.publish': 'Publishing backup ({current}/{total})…',
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
      'backup.inspecting': 'Inspecting…',
      'backup.restoreConfirm': 'Confirm restore',
      'backup.restoreHint': 'The integrity check passed. Confirm to apply the plan below; the host will recheck the archive and current targets immediately before committing.',
      'backup.restoreError': 'Backup restore failed',
      'backup.integrity.ok': 'Integrity check passed',
      'backup.integrity.invalid': 'Archive cannot be restored',
      'backup.integrity.summary': '{entries} entries, {size} expanded; {sessions} session file(s), {config} config file(s), {profiles} profile manifest(s).',
      'backup.plan.sessions': 'The sessions directory will be replaced in full',
      'backup.plan.config': 'Replace {replace} config file(s), remove {remove}',
      'backup.plan.profiles': 'Replace package.json for {count} profile(s); keep node_modules and all other files',
      'backup.plan.expires': 'Restore plan expires at {time}',
      'backup.manualRestartTitle': 'Restore completed — manual restart required',
      'backup.manualRestartBody': 'The data is restored, but the current process is still running its old state. Press Ctrl+C in the terminal running dsh, then start dsh again.',
      'backup.error.backup-gzip-invalid': 'The archive is not a valid gzip file or is damaged.',
      'backup.error.backup-tar-invalid': 'The tar structure or checksum is invalid.',
      'backup.error.backup-entry-traversal': 'The archive contains an unsafe path traversal.',
      'backup.error.backup-entry-absolute': 'The archive contains an absolute path.',
      'backup.error.backup-entry-link': 'The archive contains a symbolic or hard link.',
      'backup.error.backup-entry-type': 'The archive contains an unsupported special entry.',
       'backup.error.backup-entry-platform': 'The archive contains a filename incompatible with another platform.',
      'backup.error.backup-entry-unexpected': 'The archive contains files outside the backup scope.',
      'backup.error.backup-profile-invalid': 'A profile package.json is invalid.',
      'backup.error.backup-section-missing': 'The archive is missing a required section.',
      'backup.error.backup-size-limit': 'The archive exceeds a safe size or entry limit.',
      'backup.error.backup-archive-invalid': 'The archive failed its integrity check.',
       'backup.error.backup-source-changed': 'A session is being written; the backup was not completed. Try again shortly.',
       'backup.error.backup-source-unsafe': 'The backup source contains a link or special file, so creation was refused.',
       'backup.error.tar-failed': 'The archive tool failed. Check that tar and gzip are available.',
      'backup.error.active-work': 'Running work was detected; restore is blocked for now.',
      'backup.error.restore-plan-expired': 'The restore plan expired. Inspect the backup again.',
      'backup.error.restore-source-changed': 'The backup changed before confirmation. Inspect it again.',
      'backup.error.restore-target-changed': 'Current data changed before confirmation. Inspect it again.',
      'backup.error.restore-target-unsafe': 'A restore target contains an unsafe link or special file.',
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
      'update.channelAlpha': 'Alpha',
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
      'update.manualConfirm': 'No process manager detected. DSH will not restart automatically after the upgrade.',
      'update.manualProceed': 'Upgrade anyway',
      'update.manualRestartTitle': 'Upgrade finished — manual restart required',
      'update.manualRestartBody': 'The new version is installed, but the current process still runs the old one. Press Ctrl+C in the terminal running dsh (or simply close the window), then start dsh again.',
      'restart.title': 'Service restart',
      'restart.description': 'Restarts the dsh web process. Running work is interrupted; persisted sessions recover.',
      'restart.button': 'Restart dsh web',
      'restart.sending': 'Sending…',
      'restart.confirm': 'Confirm restart',
      'restart.force': 'Force restart',
      'restart.cancel': 'Cancel',
      'restart.sent': 'Restart request sent.',
      'restart.sentHint': 'The connection will close shortly. The page will reload automatically after recovery.',
      'restart.idleHint': 'No active work was detected. Confirm to disconnect and wait for the service to restart.',
      'restart.manualWarn': 'This looks like a manual terminal launch: once confirmed the process exits and nothing restarts it — you must run dsh again yourself.',
      'restart.sentManualHint': 'Manual start detected — the service will not relaunch itself. Rerun dsh in the original terminal, then refresh.',
      'restart.navToggle': 'Show "Restart" entry in settings left nav',
      'restart.navToggleHint': 'Off by default; when enabled, a quick-restart entry appears at the bottom of the settings left navigation',
      'activity.agent': 'Agent',
      'activity.job': 'Background job',
      'activity.terminal': 'Terminal',
      'activity.warning': 'Detected {count} active items; restart interrupts them.',
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
      'usage.chartSummary': 'Total usage over seven days: {total} tokens',
      'usage.barDay': '{day} total {total} tokens',
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
      'notification.description': 'Browser notifications when a root task finishes or approval/choice is needed; subagent completion stays silent.',
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
      'notification.bellShow': 'Show composer bell icon',
      'quota.cardTitle': 'Quota lookup',
      'quota.navToggle': 'Show "Quota lookup" entry in settings left nav',
      'quota.navToggleHint': 'Off by default; when enabled, a "Quota lookup" entry appears at the bottom of the settings left navigation',
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
      'quota.advanced': 'Advanced',
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
      'quota.kind.stepfun': 'StepFun Balance',
      'quota.kind.stepfun-step-plan': 'StepFun Step Plan',
      'quota.kind.xiaomi-token-plan-cn': 'Xiaomi MiMo Token Plan',
      'quota.window.total_token': 'Plan total quota',
      'quota.window.compensation_total_token': 'Compensation credits',
      'quota.window.plan-name': 'Subscription plan',
      'quota.window.credit-pool': 'Monthly credit pool',
      'quota.window.topup-credit': 'Top-up credit',
      'quota.window.five-hour': '5-hour quota',
      'quota.error.no-subscription': 'No active quota subscription on this account',
      'quota.error.credential-rejected': 'Console session expired; copy it from the browser again',
      'quota.credential.editCookie': 'Set console cookie (web session)',
      'quota.credential.editToken': 'Set console token (Oasis-Token, browser session)',
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
    // 线性图标单一事实源（v0.31 用户点名：顶部标签胶囊复用既有 SVG）：每枚 = [tag, attrs]
    // 元素清单，两处消费——① 顶栏胶囊内联 React SVG；② 左列导航 mask 的 data URI 序列化。
    // 换图标只改这一处，两处永远同步。风格统一 lucide：24 viewBox、stroke 2、圆角线帽。
    const SVG_ICONS = {
      // 服务控制（左列 mask 专用）= 滑杆组
      service: [['path', { d: 'M4 8h16' }], ['path', { d: 'M4 16h16' }], ['circle', { cx: '9', cy: '8', r: '2.5', fill: 'black' }], ['circle', { cx: '15', cy: '16', r: '2.5', fill: 'black' }]],
      // 概览 = 仪表盘四宫格
      overview: [['rect', { x: '3', y: '3', width: '7', height: '9', rx: '1' }], ['rect', { x: '14', y: '3', width: '7', height: '5', rx: '1' }], ['rect', { x: '14', y: '12', width: '7', height: '9', rx: '1' }], ['rect', { x: '3', y: '16', width: '7', height: '5', rx: '1' }]],
      // 通知 = 铃铛（取 BellIcon 铃体三笔，不带对钩/斜线变体）
      notify: [['path', { d: 'M10.268 21a2 2 0 0 0 3.464 0' }], ['path', { d: 'M16.8607 4.4824A6 6 0 0 0 6 8C6 12.499 4.589 13.956 3.262 15.326' }], ['path', { d: 'M3.262 15.326A1 1 0 0 0 4 17H20A1 1 0 0 0 20.74 15.327C20.209 14.779 19.665 14.218 19.203 13.454' }]],
      // 健康诊断 = 盾牌 + 对钩
      health: [['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }], ['path', { d: 'm9 12 2 2 4-4' }]],
      // 模型统计 = 坐标轴 + 三根柱
      usage: [['path', { d: 'M3 3v16a2 2 0 0 0 2 2h16' }], ['path', { d: 'M18 17V9' }], ['path', { d: 'M13 17V5' }], ['path', { d: 'M8 17v-3' }]],
      // 额度查询 = 仪表弧 + 指针
      quota: [['path', { d: 'm12 14 4-4' }], ['path', { d: 'M3.34 19a10 10 0 1 1 17.32 0' }]],
      // 备份维护 = 归档箱
      backup: [['rect', { x: '2', y: '3', width: '20', height: '5', rx: '1' }], ['path', { d: 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8' }], ['path', { d: 'M10 12h4' }]],
      // 技能 = 书本轮廓
      skills: [['path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }], ['path', { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' }]],
      // 子代理 = 机器人头
      subagent: [['path', { d: 'M12 8V4H8' }], ['rect', { width: '16', height: '12', x: '4', y: '8', rx: '2' }], ['path', { d: 'M2 14h2' }], ['path', { d: 'M20 14h2' }], ['path', { d: 'M15 13v2' }], ['path', { d: 'M9 13v2' }]],
      // 会话管理 = 对话气泡 + 对钩（查/导出/归档的管理语义）
      sessions: [['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }], ['path', { d: 'm9 10 2 2 4-4' }]],
      // 重启 = 电源符号
      restart: [['path', { d: 'M12 2v10' }], ['path', { d: 'M18.4 6.6a9 9 0 1 1-12.77.04' }]],
      // 维护 = 扳手（v0.39 六页导航新 id）
      maintenance: [['path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' }]],
      // 配置 = settings-2 双滑杆组（区别于「服务控制」的横杆滑杆组）
      configuration: [['path', { d: 'M20 7h-9' }], ['path', { d: 'M14 17H5' }], ['circle', { cx: '17', cy: '17', r: '3' }], ['circle', { cx: '7', cy: '7', r: '3' }]],
    }
    // 左列 mask 的 data URI 体序列化：`<tag attr='val'/>` → %3Ctag%20attr=%27val%27/%3E。
    // 输出 byte 级等于历史上手写的常量（属性分隔用原始空格），外观零漂移。
    const iconMaskBody = (icon) => icon.map(([tag, attrs]) =>
      '%3C' + tag + Object.entries(attrs).map(([k, v]) => ` ${k}=%27${v}%27`).join('') + '/%3E').join('')
    const NAV_ICON_BODY_SERVICE = iconMaskBody(SVG_ICONS.service)
    const NAV_ICON_BODY_QUOTA = iconMaskBody(SVG_ICONS.quota)
    const NAV_ICON_BODY_RESTART = iconMaskBody(SVG_ICONS.restart)
    // 会话管理 = 对话气泡 + 对钩（lucide message-circle check，16px 下可读）
    const NAV_ICON_BODY_SESSIONS = iconMaskBody(SVG_ICONS.sessions)
    /** 顶栏胶囊的内联 SVG 图标：跟随 currentColor，尺寸 13px，随文字基线居中。 */
    function TabIcon({ name }) {
      const elements = SVG_ICONS[name]
      if (elements === undefined) return null
      return React.createElement('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13, fill: 'none', stroke: 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
        style: { flexShrink: 0, display: 'block' },
      }, elements.map(([tag, attrs], index) => React.createElement(tag, Object.assign({ key: index }, attrs))))
    }
    // v0.34 顶栏分段条激活段实底色。v0.34.2 用户复核定稿——**按主题分流**：
    // 浅色主题 = 品牌原色实底 + 白字（黑/深底白字，用户点名）；暗色主题 = 提亮品牌色块
    // 激活块底色与文字色均由插件样式表的双主题变量决定（写死中性固定色，见 v0.34.2 注释）：
    // 组件只引用变量，React 内联样式无需感知当前主题。不支持变量的极老内核回退到浅色深块白字。
    const CHIP_ACTIVE_TEXT = 'var(--dsh-svc-tab-active-text)'

    function markSettingsNavRows(rows) {
      if (typeof document === 'undefined' || !document.body) return () => {}
      let disposed = false
      let frame = null
      let nav = null
      let navObserver = null
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
      const sync = () => {
        if (disposed) return
        const nextNav = typeof document.querySelector === 'function'
          ? document.querySelector('[role="dialog"] nav')
          : null
        if (nextNav !== nav) {
          if (navObserver !== null) navObserver.disconnect()
          navObserver = null
          nav = nextNav
          // 语言切换可能原地改 text node，所以 characterData 只保留在小范围 nav 子树；
          // body 级观察器只负责发现 dialog/nav 的挂载和卸载，不再被聊天流式 token 唤醒。
          if (nav !== null) {
            navObserver = new MutationObserver(scheduleSync)
            navObserver.observe(nav, { childList: true, subtree: true, characterData: true })
          }
        }
        if (nav === null) return
        const buttons = typeof nav.querySelectorAll === 'function'
          ? nav.querySelectorAll('button')
          : document.querySelectorAll('[role="dialog"] nav button')
        for (const button of buttons) {
          const text = (button.textContent || '').trim()
          for (const row of rows) {
            const label = String(row.label() || '').trim()
            if (label && text === label) button.setAttribute(row.attr, '')
            else button.removeAttribute(row.attr)
          }
        }
      }
      sync()
      const bodyObserver = new MutationObserver(scheduleSync)
      bodyObserver.observe(document.body, { childList: true, subtree: true })
      return () => {
        disposed = true
        bodyObserver.disconnect()
        if (navObserver !== null) navObserver.disconnect()
        navObserver = null
        nav = null
        if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        frame = null
        for (const row of rows) {
          for (const el of document.querySelectorAll('[' + row.attr + ']')) el.removeAttribute(row.attr)
        }
      }
    }

    const inject = ['slots', 'connection', 'timer', 'locale', 'sessions', 'settingsScope']

    // ── v1.2 子代理模型可见性：回合尾行的纯逻辑（模块级便于单测）──────────────
    // selector 只读官方 turn-process 数据（编码签名串 `turn|…|subagentCount`，第 9 段是
    // subagentCount、第 1 段是 turn），subagentCount>0 才认领回合——避免在无子代理的回合
    // 抢占链槽（better-sidebar 的 produced-files 行 priority -1 先到先得，本条目让位）。
    function selectSubagentModelsTurnTail(owner) {
      const signature = owner?.turn?.data?.get?.('turn-process')
      if (typeof signature !== 'string') return null
      const parts = signature.split('|')
      // 空首段（畸形签名）视为不可信：Number('')===0 会误认领 turn 0。
      if (parts[0] === '') return null
      const turn = Number(parts[0])
      const subagentCount = Number(parts[8])
      if (!Number.isFinite(turn) || !Number.isFinite(subagentCount) || subagentCount <= 0) return null
      return { turn, subagentCount }
    }

    /** 按 provider/model/effort 聚合记录为展示条目（保持首个出现的顺序，同名路由计数）。 */
    function aggregateSubagentRoutes(records) {
      if (!Array.isArray(records)) return []
      const entries = []
      const index = new Map()
      for (const record of records) {
        if (record === null || typeof record !== 'object') continue
        const provider = typeof record.provider === 'string' && record.provider !== '' ? record.provider : undefined
        const model = typeof record.model === 'string' && record.model !== '' ? record.model : undefined
        if (provider === undefined || model === undefined) continue
        const effort = typeof record.reasoningEffort === 'string' && record.reasoningEffort !== '' ? record.reasoningEffort : undefined
        const key = provider + '\u0000' + model + '\u0000' + (effort ?? '')
        let entry = index.get(key)
        if (entry === undefined) {
          entry = { provider, model, ...(effort !== undefined ? { reasoningEffort: effort } : {}), count: 0 }
          index.set(key, entry)
          entries.push(entry)
        }
        entry.count += 1
      }
      return entries
    }

    /** 条目 → 一行文本：`provider/model (effort)`，计数>1 才带 ` ×n`，条目间 ` · `。 */
    function subagentRouteListText(entries) {
      return (Array.isArray(entries) ? entries : []).map((entry) => {
        if (entry === null || typeof entry !== 'object') return ''
        const provider = typeof entry.provider === 'string' ? entry.provider : ''
        const model = typeof entry.model === 'string' ? entry.model : ''
        const effort = typeof entry.reasoningEffort === 'string' && entry.reasoningEffort !== '' ? entry.reasoningEffort : undefined
        const count = Number.isFinite(entry.count) && entry.count > 1 ? ` ×${entry.count}` : ''
        return `${provider}/${model}${effort !== undefined ? ` (${effort})` : ''}${count}`
      }).filter((part) => part !== '').join(' · ')
    }

    function normalizeRpcResult(result) {
      if (!result || result.ok !== false || typeof result.error !== 'object' || result.error === null) return result
      const detail = typeof result.error.details?.detail === 'string' ? result.error.details.detail : result.detail
      const message = typeof result.error.message === 'string' ? result.error.message : result.error.code
      return { ...result, error: message || 'unknown', ...(detail !== undefined ? { detail } : {}) }
    }

    function apply(ctx) {
      const { useState, useEffect, useRef } = React
      const rpcCall = (endpoint, payload) => Promise.resolve(ctx.connection.rpc.call('/dsh-service', endpoint, payload))

      // ── v1.2 子代理派发记录缓存：按父会话聚合、turn 索引；TTL 10s 按会话单飞去重 ──
      // 宿主记录在宿主内存（进程重启即清、页面刷新不丢）；拉取失败进冷却并保留旧缓存（fail-open，
      // 渲染已有行不闪断）。同一会话连续回合尾行共享一次请求。
      const DISPATCH_TTL_MS = 10 * 1000
      // 与宿主 SUBAGENT_DISPATCH_PAGE_MAX 同步（= 环形容量）：一次请求取回环内全部记录。
      const SUBAGENT_DISPATCH_LIMIT = 400
      const dispatchByParent = new Map()
      const dispatchFetchedAt = new Map()
      const dispatchInflight = new Map()
      // 缓存条目 = { byTurn: Map<turn, records[]>, records: 原始记录全量 }。records 保留
      // 无 turn 的派发（宿主允许记录缺 turn）：回合尾行按 turn 索引取用，会话级累计行聚合全量。
      const dispatchRecordsFor = (sessionId) => {
        const entry = dispatchByParent.get(sessionId)
        return entry === undefined ? new Map() : entry.byTurn
      }
      const refreshSubagentDispatches = (sessionId, force = false) => {
        if (typeof sessionId !== 'string' || sessionId === '') return Promise.resolve(new Map())
        const now = Date.now()
        // force：会话级累计行的轮询刷新（绕过 TTL 去重，保证轮值总是实拉；回合尾行的
        // 挂载首拉不受影响——第二次拉取仍受 TTL 保护）。
        if (!force && now - (dispatchFetchedAt.get(sessionId) ?? 0) < DISPATCH_TTL_MS) return Promise.resolve(dispatchRecordsFor(sessionId))
        let inflight = dispatchInflight.get(sessionId)
        if (inflight === undefined) {
          // limit = 宿主单次上限（= 环形容量）一次性取回：累计行按此拉全量，回合尾行按 turn 过滤。
          inflight = rpcCall('subagent-dispatches', { parentId: sessionId, limit: SUBAGENT_DISPATCH_LIMIT }).then((result) => {
            const records = result && result.ok === true && Array.isArray(result.value?.records) ? result.value.records : []
            const byTurn = new Map()
            const raw = []
            for (const record of records) {
              if (record === null || typeof record !== 'object') continue
              raw.push(record)
              const turn = typeof record.turn === 'number' && Number.isFinite(record.turn) ? record.turn : undefined
              if (turn === undefined) continue
              let list = byTurn.get(turn)
              if (list === undefined) {
                list = []
                byTurn.set(turn, list)
              }
              list.push(record)
            }
            dispatchByParent.set(sessionId, { byTurn, records: raw })
            dispatchFetchedAt.set(sessionId, Date.now())
            return byTurn
          }).catch(() => {
            // 失败进冷却：避免一回合内同一会话渲染风暴；旧缓存原样保留。返回 null 区分「失败」，
            // 会话级累计行的首拉据此决定是否启动轮询链（宿主不可用时静默、不常驻定时器）。
            dispatchFetchedAt.set(sessionId, Date.now())
            return null
          })
          dispatchInflight.set(sessionId, inflight)
          inflight.finally(() => dispatchInflight.delete(sessionId)).catch(() => {})
        }
        return inflight
      }
      // 对话页回合尾行组件：matched 由链槽裁决注入（{turn, subagentCount}），
      // 标准 props 含 sessionId；数据按 (sessionId, turn) 拉取后渲染一行小字。
      function SubagentModelsTurnTail(props) {
        const translate = useTranslation()
        const [text, setText] = useState('')
        useEffect(() => {
          let cancelled = false
          const turn = props.matched && typeof props.matched.turn === 'number' ? props.matched.turn : undefined
          const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
          if (turn === undefined || sessionId === undefined) {
            setText('')
            return undefined
          }
          refreshSubagentDispatches(sessionId).then((byTurn) => {
            if (cancelled) return
            // 拉取失败（null）沿用旧缓存：瞬时失败不把已正确的行替换成兜底文案；
            // 从未成功过（无缓存条目）按设计静默（RPC 失败渲染 null），不编造计数。
            const staleEntry = dispatchByParent.get(sessionId)
            const byTurnSafe = byTurn === null
              ? (staleEntry === undefined ? new Map() : staleEntry.byTurn)
              : byTurn
            const turnRecords = byTurnSafe.get(turn)
            const entries = aggregateSubagentRoutes(turnRecords)
            if (entries.length === 0) {
              if (byTurn === null && staleEntry === undefined) {
                setText('')
                return
              }
              const count = Number.isFinite(props.matched.subagentCount) && props.matched.subagentCount > 0 ? String(props.matched.subagentCount) : String(turnRecords?.length ?? 1)
              const countKey = count === '1' ? 'subagent.turnTail.countOne' : 'subagent.turnTail.countMany'
              setText(`${translate(countKey, { count })}${translate('subagent.turnTail.unknown')}`)
              return
            }
            setText(`${translate('subagent.turnTail.label')}${subagentRouteListText(entries)}`)
          }).catch(() => {
            if (!cancelled) setText('')
          })
          return () => {
            cancelled = true
          }
        }, [props.matched && props.matched.turn, props.sessionId])
        if (text === '') return null
        return React.createElement('div', {
          'data-testid': 'subagent-models-turn-tail',
          'data-dsh-service-subagent-models': true,
          style: {
            fontSize: '12px',
            lineHeight: '18px',
            color: 'var(--dsh-svc-text-muted, var(--dsw-alias-label-secondary, #6b7280))',
            padding: '2px 0',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          },
        }, text)
      }

      // 会话级累计行（v1.2 补）：composer 下方常驻「本会话子代理模型」。
      // 回合尾行依赖官方 turn-process 计数触发，compaction 折叠子代理工具调用后
      // （官方自身也不再显示计数）回合尾行会静默消失——累计行由宿主派发记录驱动，
      // 不受事件流折叠影响，任何视图/任意回合都能看到。轮询走 ctx.timer 自续链
      // （20s，测试桩可推进、卸载即断）；与回合尾行共享同一份记录缓存。
      const SUBAGENT_DOCK_POLL_MS = 20 * 1000
      function SubagentModelsDock(props) {
        const translate = useTranslation()
        const [text, setText] = useState('')
        useEffect(() => {
          let cancelled = false
          let pollDispose = undefined
          const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
          if (sessionId === undefined) {
            setText('')
            return undefined
          }
          // 展示一律从缓存条目读取（成功=新数据，失败=旧缓存原样）：瞬时 RPC 失败不闪断。
          // 聚合用原始全量记录（含无 turn 的派发）——累计行就是「不依赖回合数据、任何视图
          // 可见」的兜底面，不能把缺 turn 的记录丢掉。
          const setFromCache = () => {
            const entry = dispatchByParent.get(sessionId)
            const records = entry === undefined ? [] : entry.records
            const entries = aggregateSubagentRoutes(records)
            setText(entries.length === 0 ? '' : `${translate('subagent.turnTail.label')}${subagentRouteListText(entries)}`)
          }
          const refresh = () => refreshSubagentDispatches(sessionId).then((byTurn) => {
            if (cancelled) return false
            setFromCache()
            return byTurn !== null
          }).catch(() => {
            if (!cancelled) setText('')
            return false
          })
          refresh()
          // 首拉成功才启动轮询链：宿主不可用/RPC 失败时静默且不常驻定时器
          // （重进会话或页面刷新后自愈）。轮询轮内失败保留链，下轮再试。
          const tick = () => {
            if (cancelled) return
            refreshSubagentDispatches(sessionId, true).then((byTurn) => {
              if (cancelled) return
              setFromCache()
            }).catch(() => {
              if (!cancelled) setText('')
            })
            pollChain = ctx.timer?.timeout?.(tick, SUBAGENT_DOCK_POLL_MS)
          }
          let pollChain = undefined
          Promise.resolve(refresh()).then((ok) => {
            if (cancelled || !ok) return
            pollChain = ctx.timer?.timeout?.(tick, SUBAGENT_DOCK_POLL_MS)
          })
          return () => {
            cancelled = true
            if (typeof pollChain === 'function') pollChain()
          }
        }, [props.sessionId])
        if (text === '') return null
        return React.createElement('div', {
          'data-testid': 'subagent-models-dock',
          'data-dsh-service-subagent-models-dock': true,
          style: {
            fontSize: '12px',
            lineHeight: '18px',
            color: 'var(--dsh-svc-text-muted, var(--dsw-alias-label-secondary, #6b7280))',
            padding: '2px 4px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          },
        }, text)
      }

      let svcStyle
      if (typeof document !== 'undefined' && document.head) {
        svcStyle = document.createElement('style')
        svcStyle.textContent = [
          // ── 统一视觉语言令牌（v0.39）：--dsh-svc-* 单一事实源──
          // 铁律一：恒为 var(--dsw-alias-*, <兜底>)，暗色块只换兜底叶值，不覆盖别名解析。
          // 铁律二：主题相关令牌（含别名链）一律声明在 body 而非 :root——var() 在声明元素上求值，
          // :root 上声明会先于 body[data-ds-dark-theme] 定格，暗色覆盖永远赶不上（真机实证）。
          'body{--dsh-svc-page-bg:#f4f5f7;--dsh-svc-content-bg:var(--dsw-alias-bg-layer-2,#ffffff);--dsh-svc-raised-bg:var(--dsw-alias-bg-layer-3,#ffffff);--dsh-svc-text:var(--dsw-alias-label-primary,#202124);--dsh-svc-text-muted:var(--dsw-alias-label-secondary,#6b7280);--dsh-svc-border:var(--dsw-alias-border-l1,#e5e7eb);--dsh-svc-brand:var(--dsw-alias-brand-primary,#2563eb);--dsh-svc-brand-text:var(--dsw-alias-label-primary-foreground,#ffffff);--dsh-svc-info:#2563eb;--dsh-svc-success:var(--dsw-alias-state-success-primary,#16a34a);--dsh-svc-warning:var(--dsw-alias-state-warn-primary,#d97706);--dsh-svc-danger:var(--dsw-alias-state-error-primary,#dc2626)}',
          // 卡片底写死浅灰（外壳 bg-layer-2 可能就是白，别名优先会隐形）；深色走 bg-layer-2 链。
          'body{--dsh-svc-card-bg:#eceef1}',
          // 加强边框只用于按钮描边：浅色深灰、深色亮灰。
          'body{--dsh-svc-border-strong:#b9c0ca}',
          'body[data-ds-dark-theme]{--dsh-svc-border-strong:#52565f}',
          'body[data-ds-dark-theme]{--dsh-svc-card-bg:var(--dsw-alias-bg-layer-2,#202126)}',
          'body[data-ds-dark-theme]{--dsh-svc-page-bg:var(--dsw-alias-bg-layer-1,#17181c);--dsh-svc-content-bg:var(--dsw-alias-bg-layer-2,#202126);--dsh-svc-raised-bg:var(--dsw-alias-bg-layer-3,#292a31);--dsh-svc-text:var(--dsw-alias-label-primary,#f3f4f6);--dsh-svc-text-muted:var(--dsw-alias-label-secondary,#a1a1aa);--dsh-svc-border:var(--dsw-alias-border-l1,#3f414a)}',
          // 品牌实底按钮（v0.42.2）：深色下 brand-primary 是近白，文字走 label-primary-foreground
          // （浅=白、深=近黑），外壳缺席回落 #fff、暗色叶值 #111318 兜底。
          'body[data-ds-dark-theme]{--dsh-svc-brand-text:#111318}',
          // 几何与密度令牌（与主题无关，:root 即可）：间距 4/8/12/16/20/24/32；圆角 控件8/卡片12/面板16/胶囊999；控件高 紧凑32/默认36/主操作40。
          ':root{--dsh-svc-space-1:4px;--dsh-svc-space-2:8px;--dsh-svc-space-3:12px;--dsh-svc-space-4:16px;--dsh-svc-space-5:20px;--dsh-svc-space-6:24px;--dsh-svc-space-8:32px;--dsh-svc-radius-control:8px;--dsh-svc-radius-card:12px;--dsh-svc-radius-panel:16px;--dsh-svc-radius-pill:999px;--dsh-svc-control-h:36px;--dsh-svc-control-h-compact:32px;--dsh-svc-control-h-primary:40px;--dsh-svc-content-max:800px;--dsh-svc-dur-fast:120ms;--dsh-svc-dur-view:170ms;--dsh-svc-font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
          // 兼容别名：展示面底=卡片底；分段条激活块=文字反色块（铁律二同样适用，暗色只改叶值）。
          'body{--dsh-svc-surface-bg:var(--dsh-svc-card-bg);--dsh-svc-tab-active-bg:var(--dsh-svc-text);--dsh-svc-tab-active-danger:var(--dsh-svc-text);--dsh-svc-tab-active-text:#ffffff}',
          'body[data-ds-dark-theme]{--dsh-svc-tab-active-text:#111318}',
          // 设置页导航行图标：外壳按 id 硬编码（第三方一律兜底齿轮）且协议无 icon 字段；
          // markSettingsNavRows 打的 data 标记接住——藏齿轮 SVG、mask SVG 画图标、currentColor 跟主题。
          '[data-dsh-service-nav]>svg:first-child,[data-dsh-service-quota-nav]>svg:first-child,[data-dsh-service-restart-nav]>svg:first-child,[data-dsh-service-sessions-nav]>svg:first-child{display:none}',
          '[data-dsh-service-nav]::before,[data-dsh-service-quota-nav]::before,[data-dsh-service-restart-nav]::before,[data-dsh-service-sessions-nav]::before{content:\'\';flex:none;width:16px;height:16px;background:currentColor}',
          '[data-dsh-service-nav]::before{' + navIconMask(NAV_ICON_BODY_SERVICE) + '}',
          '[data-dsh-service-quota-nav]::before{' + navIconMask(NAV_ICON_BODY_QUOTA) + '}',
          '[data-dsh-service-sessions-nav]::before{' + navIconMask(NAV_ICON_BODY_SESSIONS) + '}',
          '[data-dsh-service-restart-nav]::before{' + navIconMask(NAV_ICON_BODY_RESTART) + '}',
          // 窄面板主导航（v0.39）：≤640px 六页单行横滑——本插件自己的面板 UI，不挂 data-dshsvc-mobile。
          '@media (max-width:640px){',
          '[data-dshsvc-root] .dshsvc-tabs{flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:3px}',
          '[data-dshsvc-root] .dshsvc-tabs::-webkit-scrollbar{display:none}',
          '[data-dshsvc-root] .dshsvc-tab{padding:9px 13px;min-height:36px;box-sizing:border-box;font-size:13px;white-space:nowrap;flex:none}',
          '[data-dshsvc-root] .dshsvc-tab svg{flex:none}',
          '}',
          // 搜索命中定位闪烁（jumpScrollToHit）。
          '@keyframes dshsv-locate-flash{0%,100%{background-color:rgba(198,128,0,0.10)}30%,70%{background-color:rgba(198,128,0,0.45)}}.dshsv-locate-flash{animation:dshsv-locate-flash 2s ease}',
          // ── 统一视觉语言基础层（v0.39）：.dshsvc-* 命名空间类，锚在 data-dshsvc-root 不外溢 ──
          // 线宽主、阴影次；动效 120/170ms；reduced-motion 归零；内容区灰画布 + 卡片分层。
          '[data-dshsvc-root]{color:var(--dsh-svc-text);font-size:14px;line-height:1.55;background:var(--dsh-svc-page-bg);border-radius:var(--dsh-svc-radius-card);padding:2px}',
          '[data-dshsvc-root] .dshsvc-page{width:100%;max-width:var(--dsh-svc-content-max);margin:0 auto}',
          '[data-dshsvc-root] button:focus-visible,[data-dshsvc-root] [role="switch"]:focus-visible,[data-dshsvc-root] select:focus-visible,[data-dshsvc-root] input:focus-visible{outline:2px solid var(--dsh-svc-brand);outline-offset:2px;border-radius:var(--dsh-svc-radius-control)}',
          '@media (prefers-reduced-motion:reduce){[data-dshsvc-root] *,[data-dshsvc-root] *::before,[data-dshsvc-root] *::after{transition-duration:0.01ms !important;animation-duration:0.01ms !important}}',
          // 主导航条：单行连续分段条；激活段=文字反色块（tab-active 别名）。
          '[data-dshsvc-root] .dshsvc-tabs{display:flex;align-items:center;flex-wrap:wrap;gap:2px;width:100%;box-sizing:border-box;border:0.5px solid var(--dsh-svc-border);border-radius:var(--dsh-svc-radius-card);overflow:hidden}',
          '[data-dshsvc-root] .dshsvc-tab{position:relative;display:inline-flex;align-items:center;gap:5px;padding:8px 12px;margin:0;border:0;border-radius:0;background:transparent;color:var(--dsh-svc-text-muted);font:inherit;font-size:12px;font-weight:550;line-height:16px;cursor:pointer;transition:color var(--dsh-svc-dur-fast) ease,background var(--dsh-svc-dur-fast) ease}',
          '[data-dshsvc-root] .dshsvc-tab[aria-selected="true"]{background:var(--dsh-svc-tab-active-bg);color:var(--dsh-svc-tab-active-text);font-weight:650;border-radius:8px}',
          // 二级子标签：下划线标签语言，与模型列表内联标签同源。
          '[data-dshsvc-root] .dshsvc-subtabs{display:flex;flex-wrap:wrap;gap:2px;margin:10px 0 0;border-bottom:1px solid var(--dsh-svc-border)}',
          '[data-dshsvc-root] .dshsvc-subtab{appearance:none;background:transparent;border:0;border-bottom:2px solid transparent;border-radius:0;padding:8px 10px;font:inherit;font-size:13px;font-weight:550;color:var(--dsh-svc-text-muted);cursor:pointer;transition:color var(--dsh-svc-dur-fast) ease,border-color var(--dsh-svc-dur-fast) ease}',
          '[data-dshsvc-root] .dshsvc-subtab[aria-selected="true"]{color:var(--dsh-svc-brand);border-bottom-color:var(--dsh-svc-brand);font-weight:700}',
          // 页面头部：非吸附标题行（标题 + 主操作/次级组换行共处）+ 一行描述。
          '[data-dshsvc-root] .dshsvc-page-header{margin:14px 2px 2px}',
          '[data-dshsvc-root] .dshsvc-page-header-row{display:flex;align-items:center;justify-content:space-between;gap:var(--dsh-svc-space-3);flex-wrap:wrap}',
        ].join('')
        document.head.appendChild(svcStyle)
      }
      ctx.effect(() => () => { if (svcStyle) svcStyle.remove() }, 'dsh-service theme styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-service dictionaries')
      const t = ctx.locale.bind(NS)
      // 当前生效界面语言（显式设置 > 浏览器语言 > en 兜底，locale 快照已折算）：'zh' | 'en'。
      // 供 AI 补全等宿主侧语言相关动作取用；宿主只收枚举，不收自由文本。
      const currentUiLocale = () => ((ctx.locale?.getSnapshot?.()?.active) === 'zh' ? 'zh' : 'en')
      /** 十进制数量缩写共用实现：模型统计沿用 K/M，额度绝对数可额外启用 B；非法值由调用方指定兜底。 */
      const formatCompactCount = (value, options = {}) => {
        const number = Number(value)
        if (!Number.isFinite(number)) return options.invalid ?? ''
        if (options.billions === true && number >= 1e9) return `${Math.round(number / 1e8) / 10}B`
        if (number >= 1e6) return `${Math.round(number / 1e5) / 10}M`
        if (number >= 1e3) return `${Math.round(number / 1e2) / 10}K`
        return number.toLocaleString()
      }
      // mobileAdaptation 默认关闭（v0.31 用户点名）：宿主与客户端默认值必须一致。
      const DEFAULT_FEATURES = { healthDiagnostics: true, modelUsage: true, quotaLookup: true, backupMaintenance: true, taskNotifications: true, healthz: true, skillManager: true, subagentRoute: true, subagentModelsDock: true, mobileAdaptation: false, sessionManager: true }
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
          { attr: 'data-dsh-service-sessions-nav', label: () => t('tabs.sessions') },
        ]),
        'dsh-service settings nav icons',
      )
      const useTranslation = () => {
        const [, setSnapshot] = useState(ctx.locale.getSnapshot())
        useEffect(() => ctx.locale.subscribe(() => setSnapshot(ctx.locale.getSnapshot())), [])
        return t
      }
      // ── Svc 视觉基元（统一视觉语言 v0.39）：按钮/展示面样式单一事实源 ────
      // ServicePanel 与 RestartSection 曾各自声明同名样式常量并已漂移，现收敛到工厂级。
      // variant 语义（安全教义对齐）：dangerGhost 危险描边 = 破坏动作初次出现；
      // danger 危险实底 = 仅最终确认；brandGhost 低饱和品牌描边 = 非破坏主操作
      // （创建备份等）；primary 品牌实底 = 唯一主操作；neutral 弱化；ghost 取消类。
      const SVC_BTN_BASE = { minHeight: 'var(--dsh-svc-control-h, 36px)', padding: '6px 14px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid transparent', cursor: 'pointer', fontSize: '13px', fontWeight: 550, transition: 'border-color 120ms ease, color 120ms ease, background 120ms ease', lineHeight: '20px' }
      const svcButtonStyle = (variant) => {
        if (variant === 'primary') return { ...SVC_BTN_BASE, background: 'var(--dsh-svc-brand)', borderColor: 'var(--dsh-svc-brand)', color: 'var(--dsh-svc-brand-text)' }
        if (variant === 'danger') return { ...SVC_BTN_BASE, background: 'var(--dsh-svc-danger)', borderColor: 'var(--dsh-svc-danger)', color: 'var(--dsh-svc-brand-text)' }
        if (variant === 'dangerGhost') return { ...SVC_BTN_BASE, background: 'transparent', color: 'var(--dsh-svc-danger)', borderColor: 'var(--dsh-svc-danger)' }
        if (variant === 'brandGhost') return { ...SVC_BTN_BASE, background: 'transparent', color: 'var(--dsh-svc-brand)', borderColor: 'var(--dsh-svc-brand)' }
        if (variant === 'ghost') return { ...SVC_BTN_BASE, background: 'transparent', color: 'var(--dsh-svc-text)', borderColor: 'var(--dsh-svc-border-strong)' }
        // v0.39 用户复核：中性操作钮也要可辨——边框用加强令牌，不再与卡片/画布同色。
        if (variant === 'neutral') return { ...SVC_BTN_BASE, background: 'var(--dsh-svc-page-bg)', color: 'var(--dsh-svc-text)', borderColor: 'var(--dsh-svc-border-strong)' }
        return { ...SVC_BTN_BASE, background: 'var(--dsh-svc-content-bg)', color: 'var(--dsh-svc-text)', borderColor: 'var(--dsh-svc-border-strong)' }
      }
      // v0.39 行尾上下文动作（查看/导出/归档/恢复…）：统一幽灵底 + 加强描边 + 紧凑尺寸。
      const svcRowActionStyle = (overrides) => Object.assign({}, SVC_BTN_BASE, { background: 'transparent', color: 'var(--dsh-svc-text)', borderColor: 'var(--dsh-svc-border-strong)', minHeight: '28px', padding: '4px 10px', fontSize: '12px', borderRadius: 'var(--dsh-svc-radius-control)' }, overrides)
      // v0.39 徽标工厂：状态/标签统一 pill 语言（10px 字 + 语义淡色底 + 语义文字）——
      // 一处改动 = 全面板徽章联动（此前会话标签/额度 auto/技能徽章各写各的 rgba）。
      const svcBadgeStyle = (tone, extra) => Object.assign({
        display: 'inline-flex',
        alignItems: 'center',
        flex: 'none',
        fontSize: '10px',
        lineHeight: '16px',
        padding: '1px 6px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        ...({
          success: { background: 'rgba(16,185,129,0.16)', color: 'var(--dsh-svc-success)' },
          warning: { background: 'rgba(198,128,0,0.14)', color: 'var(--dsh-svc-warning)' },
          danger: { background: 'rgba(220,38,38,0.12)', color: 'var(--dsh-svc-danger)' },
          info: { background: 'rgba(37,99,235,0.10)', color: 'var(--dsh-svc-info)' },
          neutral: { background: 'var(--dsh-svc-page-bg)', color: 'var(--dsh-svc-text-muted)' },
        }[tone] || {}),
      }, extra)
      // 展示面（只读信息容器）：页面级浅底 + 细边框，与操作卡片区分。
      const svcSurfaceStyle = (extra) => Object.assign({ background: 'var(--dsh-svc-surface-bg)', color: 'var(--dsh-svc-text)', border: '1px solid var(--dsh-svc-border)', borderRadius: 'var(--dsh-svc-radius-control)', padding: '10px' }, extra)
      // ── 导航纯函数（v0.39 六页信息架构）────────────────────────────────
      // 可见性/顺序/回退全部收敛为纯函数（可独立测试）；ServicePanel 只持状态与业务块。
      const PRIMARY_TAB_ORDER = ['overview', 'usage', 'quota', 'diagnostics', 'maintenance', 'configuration']
      const PRIMARY_TAB_LABELS = { overview: 'tabs.overview', usage: 'tabs.usage', quota: 'tabs.quota', diagnostics: 'tabs.health', maintenance: 'tabs.maintenance', configuration: 'tabs.configuration' }
      const PRIMARY_TAB_FEATURES = { usage: 'modelUsage', quota: 'quotaLookup', diagnostics: 'healthDiagnostics' }
      const getVisiblePrimaryTabs = (features, warnings) => PRIMARY_TAB_ORDER
        .filter((id) => PRIMARY_TAB_FEATURES[id] === undefined || features[PRIMARY_TAB_FEATURES[id]] !== false)
        .map((id) => ({ id, labelKey: PRIMARY_TAB_LABELS[id], warning: warnings !== undefined && warnings[id] === true }))
      // 维护子页顺序（用户点名）：sessions → skills → subagent → backup → restart；
      // restart 不受功能门控（重启永远可用），维护页实际恒可达。
      const MAINTENANCE_TAB_ORDER = ['sessions', 'skills', 'subagent', 'backup', 'restart']
      const MAINTENANCE_TAB_LABELS = { sessions: 'tabs.sessions', skills: 'tabs.skills', subagent: 'tabs.subagent', backup: 'tabs.backup', restart: 'tabs.restart' }
      const MAINTENANCE_TAB_FEATURES = { sessions: 'sessionManager', skills: 'skillManager', subagent: 'subagentRoute', backup: 'backupMaintenance' }
      const getVisibleMaintenanceTabs = (features) => MAINTENANCE_TAB_ORDER
        .filter((id) => MAINTENANCE_TAB_FEATURES[id] === undefined || features[MAINTENANCE_TAB_FEATURES[id]] !== false)
        .map((id) => ({ id, labelKey: MAINTENANCE_TAB_LABELS[id] }))
      // 维护子页记忆规整：值必须在当前可见白名单内，否则回退到首个可用页；全关返回 null。
      const normalizeMaintenanceTab = (value, features) => {
        const visible = getVisibleMaintenanceTabs(features)
        if (visible.length === 0) return null
        return visible.some((item) => item.id === value) ? value : visible[0].id
      }
      const CONFIG_TABS = [
        { id: 'features', labelKey: 'tabs.features' },
        { id: 'notifications', labelKey: 'tabs.notifications' },
      ]
      // v0.39 页面元数据：每页一行描述（标题复用 tabs.* 词条）。
      // 用户复核：概览/模型统计/维护 的描述取消（undefined = 不渲染）；额度描述并入圆环/节流说明。
      const PAGE_DESCRIPTIONS = {
        quota: 'page.quota.desc',
        diagnostics: 'page.diagnostics.desc',
        configuration: 'page.configuration.desc',
      }
      /** 页面头部基元：非吸附轻量标题 + 一行描述；主操作位由各页逐步接入（action prop）。 */
      function SvcPageHeader({ title, description, action, secondary }) {
        return React.createElement('header', { 'data-testid': 'svc-page-header', className: 'dshsvc-page-header' },
          React.createElement('div', { className: 'dshsvc-page-header-row' },
            React.createElement('h2', { className: 'dshsvc-page-title', style: { margin: 0, fontSize: '18px', fontWeight: 700, lineHeight: 1.4, color: 'var(--dsh-svc-text)' } }, title),
            action !== undefined && action !== null ? action : null,
            secondary !== undefined && secondary !== null ? React.createElement('div', { className: 'dshsvc-page-secondary', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, secondary) : null),
          description ? React.createElement('p', { className: 'dshsvc-page-desc', style: { margin: '2px 0 0', fontSize: '12px', color: 'var(--dsh-svc-text-muted)', lineHeight: 1.5 } }, description) : null)
      }
      /** 导航条基元：variant 'primary' = 分段条（激活=反色块），'sub' = 下划线子标签。
       * items=[{id,label,icon?,warning?,badge?}]；role=tablist/tab + aria-selected，
       * 状态点只做视觉补充，语义由 aria-label 文字承载。 */
      function SvcTabs({ items, activeId, onChange, testIdPrefix, variant, dotLabel, ariaLabel }) {
        const isSub = variant === 'sub'
        return React.createElement('div', { role: 'tablist', 'aria-label': ariaLabel, className: isSub ? 'dshsvc-subtabs' : 'dshsvc-tabs', 'data-testid': testIdPrefix + '-list' },
          items.map((item) => {
            const isActive = item.id === activeId
            const style = isSub
              ? (isActive ? { color: 'var(--dsh-svc-brand)', borderBottom: '2px solid var(--dsh-svc-brand)', fontWeight: 700 } : null)
              : (isActive ? { background: 'var(--dsh-svc-tab-active-bg)', color: CHIP_ACTIVE_TEXT, fontWeight: 650, borderRadius: '8px' } : null)
            return React.createElement('button', {
              key: item.id,
              type: 'button',
              role: 'tab',
              'aria-selected': String(isActive),
              'data-testid': testIdPrefix + '-' + item.id,
              className: isSub ? 'dshsvc-subtab' : 'dshsvc-tab',
              style,
              onClick: () => onChange(item.id),
            },
              item.icon !== undefined ? React.createElement(TabIcon, { name: item.icon }) : null,
              item.label,
              item.warning ? React.createElement('span', { 'data-testid': 'tab-dot-' + item.id, 'aria-label': dotLabel, style: { position: 'absolute', top: '-3px', right: '-3px', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--dsw-alias-state-warn-primary)', boxShadow: '0 0 0 2px var(--dsw-alias-bg-layer-1)' } }) : null,
              item.badge ? React.createElement('span', { 'data-testid': item.badge.testid, style: { position: 'absolute', top: '-7px', right: '-10px', fontSize: '9px', lineHeight: '14px', padding: '0 4px', borderRadius: '999px', background: 'var(--dsw-alias-state-warn-primary)', color: 'var(--dsh-svc-brand-text)', fontWeight: 700 } }, item.badge.text) : null)
          }))
      }
      // 全局通知：任务结束 + 需要授权/选择答案，两个独立子开关受总开关管辖
      let notifyEnabled = false
      let notifyDone = true
      let notifyInput = true
      // 输入框铃铛图标的显隐（v0.31 用户点名）：默认显示，独立于通知行为开关——
      // 藏掉铃铛只是收起快捷入口，通知照常按既有三档工作。
      let notifyBellVisible = true
      try { notifyEnabled = localStorage.getItem('dsh-service-notify') === 'true' } catch (_) {}
      try { notifyDone = localStorage.getItem('dsh-service-notify-done') !== 'false' } catch (_) {}
      try { notifyInput = localStorage.getItem('dsh-service-notify-input') !== 'false' } catch (_) {}
      try { notifyBellVisible = localStorage.getItem('dsh-service-notify-bell') !== 'false' } catch (_) {}
      const notifyListeners = new Set()
      const bellListeners = new Set()
      const persistNotify = (key, value) => { try { localStorage.setItem(key, value ? 'true' : 'false') } catch (_) {} }
      const publishNotify = () => { for (const listener of notifyListeners) listener() }
      const publishBell = () => { for (const listener of bellListeners) listener() }
      const setNotifyEnabled = (value) => { notifyEnabled = value; persistNotify('dsh-service-notify', value); publishNotify() }
      const setNotifyDone = (value) => { notifyDone = value; persistNotify('dsh-service-notify-done', value); publishNotify() }
      const setNotifyInput = (value) => { notifyInput = value; persistNotify('dsh-service-notify-input', value); publishNotify() }
      const setNotifyBellVisible = (value) => {
        notifyBellVisible = value === true
        persistNotify('dsh-service-notify-bell', notifyBellVisible)
        publishBell()
      }
      /** 槽位注入回调用：铃铛显隐变化时重挂 conversation.input.left 条目。 */
      const subscribeBellVisible = (listener) => { bellListeners.add(listener); return () => bellListeners.delete(listener) }
      const useNotifyState = () => {
        const [, setTick] = useState(0)
        const [enabled, setEnabled] = useState(notifyEnabled)
        const [done, setDone] = useState(notifyDone)
        const [input, setInput] = useState(notifyInput)
        const [bell, setBell] = useState(notifyBellVisible)
        React.useEffect(() => {
          const update = () => { setEnabled(notifyEnabled); setDone(notifyDone); setInput(notifyInput); setBell(notifyBellVisible); setTick((t) => t + 1) }
          notifyListeners.add(update)
          bellListeners.add(update)
          return () => { notifyListeners.delete(update); bellListeners.delete(update) }
        }, [])
        return { enabled, done, input, bell, setEnabled: (v) => setNotifyEnabled(v), setDone: (v) => setNotifyDone(v), setInput: (v) => setNotifyInput(v), setBell: setNotifyBellVisible }
      }
      // 设置页左列入口开关的通用实现（重启/额度/技能三个入口共用，不再三套复制）：
      // localStorage 持久化、默认关；开启才注册 settings.section 条目、关闭即注销——
      // 导航列单元格由外壳渲染，null 内容不能隐藏导航项。feature 可选：功能关闭时同样注销。
      const createNavEntryToggle = ({ storageKey, legacyStorageKey, sectionId, order, labelKey, feature, renderContent }) => {
        let enabled = false
        try {
          let raw = localStorage.getItem(storageKey)
          // v0.39 快捷入口键更名（用户点名）：旧键只读一次、迁移写入新键，此后只认新键。
          if (raw === null && legacyStorageKey !== undefined) {
            const legacy = localStorage.getItem(legacyStorageKey)
            if (legacy !== null) {
              try { localStorage.setItem(storageKey, legacy) } catch (_) {}
              raw = legacy
            }
          }
          enabled = raw === 'true'
        } catch (_) {}
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
      // v0.39 快捷入口收敛为三个（用户点名）：重启/额度查询/会话管理，各自独立开关、默认关。
      // 技能与子代理的左列入口撤销（维护页内仍有完整功能）；存储键统一迁到 shortcut-* 命名。
      const restartNavToggle = createNavEntryToggle({ storageKey: 'dsh-service-shortcut-restart', legacyStorageKey: 'dsh-service-restart-nav', sectionId: 'dsh-service-restart', order: 499, labelKey: 'nav.restart', renderContent: () => React.createElement(RestartSection, null) })
      const quotaNavToggle = createNavEntryToggle({ storageKey: 'dsh-service-shortcut-quota', legacyStorageKey: 'dsh-service-quota-nav', sectionId: 'dsh-service-quota', order: 498, labelKey: 'tabs.quota', feature: 'quotaLookup', renderContent: () => React.createElement(QuotaSection, null) })
      const sessionsNavToggle = createNavEntryToggle({ storageKey: 'dsh-service-shortcut-sessions', legacyStorageKey: 'dsh-service-sessions-nav', sectionId: 'dsh-service-sessions', order: 495, labelKey: 'tabs.sessions', feature: 'sessionManager', renderContent: () => React.createElement(SessionsSection, null) })
      // ── 批量补全共享状态：跨标签/设置面板开关存活（宿主任务本身不随 UI 停止）──
      let skillsBatchState = null       // 宿主状态快照
      let skillsBatchPlan = null        // 本端计划（含所选模型）
      let skillsBatchModels = null      // 模型清单缓存（null=未拉取，[]=不可用）
      let skillsBatchModelItem = null   // 批量选中的模型
      let skillsBatchError = ''
      let skillsBatchListDirty = false  // 落定后请挂载中的列表自刷新
      let skillsBatchPollHandle = null
      let skillsBatchAdoptPromise = null
      let skillsBatchStatusChecked = false
      const SKILLS_BATCH_PENDING_STORAGE_KEY = 'dsh-service-skills-batch-pending'
      const skillsBatchListeners = new Set()
      const publishSkillsBatch = () => { for (const listener of skillsBatchListeners) listener() }
      const setSkillsBatchPending = (pending) => {
        try {
          if (pending) localStorage.setItem(SKILLS_BATCH_PENDING_STORAGE_KEY, 'true')
          else localStorage.removeItem(SKILLS_BATCH_PENDING_STORAGE_KEY)
        } catch (_) {}
      }
      const hasSkillsBatchPendingMarker = () => {
        try { return localStorage.getItem(SKILLS_BATCH_PENDING_STORAGE_KEY) === 'true' } catch (_) { return false }
      }
      const rememberSkillsBatchPhase = (phase) => {
        setSkillsBatchPending(phase === 'planned' || phase === 'running')
      }
      const skillsBatchPollStop = () => {
        if (skillsBatchPollHandle !== null) { clearInterval(skillsBatchPollHandle); skillsBatchPollHandle = null }
      }
      const syncSkillsBatchPolling = (immediate = true) => {
        // 功能关闭时不轮询（宿主也会拒绝 skill-* RPC）；重开后由下一次交互重新拉起。
        const shouldPoll = skillsBatchState !== null && skillsBatchState.phase === 'running' && featureEnabled('skillManager')
        if (shouldPoll && skillsBatchPollHandle === null) {
          const tick = async () => {
            try {
              const res = await rpcCall('skills-batch-status', {})
              if (!res.ok) return
              const previousPhase = skillsBatchState !== null ? skillsBatchState.phase : null
              skillsBatchState = res.value
              rememberSkillsBatchPhase(res.value.phase)
              if (previousPhase === 'running' && res.value.phase !== 'running') {
                // 落定：停止轮询，请挂载中的列表刷新 annotated 标记。
                skillsBatchPollStop()
                skillsBatchListDirty = true
              }
              publishSkillsBatch()
            } catch (_) {}
          }
          if (immediate) void tick()
          skillsBatchPollHandle = setInterval(() => void tick(), 2000)
        }
      }
      const fetchSkillsBatchModels = async () => {
        if (skillsBatchModels !== null) return skillsBatchModels
        try {
          const res = await rpcCall('skills-models', {})
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
      const adoptSkillsBatchStatus = () => {
        if (skillsBatchStatusChecked) return Promise.resolve(skillsBatchState)
        if (skillsBatchAdoptPromise !== null) return skillsBatchAdoptPromise
        skillsBatchAdoptPromise = (async () => {
          try {
            const res = await rpcCall('skills-batch-status', {})
            if (res.ok) {
              skillsBatchStatusChecked = true
              rememberSkillsBatchPhase(res.value.phase)
              if (res.value.phase !== 'idle') {
                skillsBatchState = res.value
                syncSkillsBatchPolling(false)
                publishSkillsBatch()
              }
            }
          } catch (_) {}
          return skillsBatchState
        })().finally(() => { skillsBatchAdoptPromise = null })
        return skillsBatchAdoptPromise
      }
      const planSkillsBatchShared = async () => {
        skillsBatchError = ''
        publishSkillsBatch()
        const models = await fetchSkillsBatchModels()
        if (models.length === 0 || skillsBatchModelItem === null) { skillsBatchError = 'models-empty'; publishSkillsBatch(); return false }
        try { localStorage.setItem(SKILLS_MODEL_STORAGE_KEY, JSON.stringify({ provider: skillsBatchModelItem.provider, model: skillsBatchModelItem.id })) } catch (_) {}
        const res = await rpcCall('skills-batch-plan', { provider: skillsBatchModelItem.provider, model: skillsBatchModelItem.id })
        if (!res.ok) { skillsBatchError = res.error || 'unknown'; publishSkillsBatch(); return false }
        skillsBatchPlan = { ...res.value, modelItem: skillsBatchModelItem }
        const annotatedCount = Array.isArray(res.value.annotated) ? res.value.annotated.length : 0
        skillsBatchState = { phase: 'planned', total: res.value.candidates.length + annotatedCount, done: 0, failures: [], current: null, estBytes: res.value.estBytes, logs: [] }
        rememberSkillsBatchPhase('planned')
        syncSkillsBatchPolling()
        publishSkillsBatch()
        return true
      }
      const startSkillsBatchShared = async (forceAnnotated = false) => {
        if (skillsBatchPlan === null || skillsBatchState === null) return false
        // 计划含已注释条目时宿主要求显式确认（annotated-confirm-required 兜底），客户端只在
        // 两段式武装确认后传 forceAnnotated: true。
        const res = await rpcCall('skills-batch-run', {
          planId: skillsBatchPlan.planId,
          lang: currentUiLocale(),
          ...(forceAnnotated === true ? { forceAnnotated: true } : {}),
        })
        if (!res.ok) { skillsBatchError = res.error || 'unknown'; publishSkillsBatch(); return false }
        skillsBatchState = { ...skillsBatchState, phase: 'running' }
        rememberSkillsBatchPhase('running')
        syncSkillsBatchPolling()
        publishSkillsBatch()
        return true
      }
      const cancelSkillsBatchShared = async () => {
        try {
          await rpcCall('skills-batch-cancel', {})
          setSkillsBatchPending(false)
        } catch (_) {}
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
      // 只有本页曾启动过未落定批量任务时才在刷新后恢复：普通页面启动零 RPC；
      // 计划/运行阶段落本地 marker，落定/取消即清除。技能页首次进入仍会主动核对一次宿主状态。
      if (hasSkillsBatchPendingMarker()) void adoptSkillsBatchStatus()
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
              if (prev.running && !next.running && summary.origin !== 'subagent' && featureEnabled('taskNotifications') && notifyEnabled && notifyDone) {
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
          versionSnapshotPromise = rpcCall('version', {})
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
          const res = await rpcCall('activity', {})
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
          const res = await rpcCall('web', { force: force === true })
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
            const res = await rpcCall('version', {})
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
          style: { margin: '4px', padding: '5px 8px', borderRadius: '999px', border: 0, background: 'var(--dsh-svc-warning)', color: 'var(--dsh-svc-brand-text)', cursor: 'pointer', fontSize: '11px', fontWeight: 600 },
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
        kind === 'latest' ? translate('update.channelStable') : kind === 'next' ? translate('update.channelPreview') : translate('update.channelAlpha'),
        ' ', React.createElement('span', { 'data-testid': `version-dsh-channel-${kind}`, style: { marginLeft: '4px' } }, version || '—'),
        siteLabelLink(kind, 'npmjs', packageVersionHref(`https://www.npmjs.com/package/${NPM_DSH_PACKAGE}/v/`, version)),
        siteLabelLink(kind, 'npmmirror', packageVersionHref(`https://www.npmmirror.com/package/${NPM_DSH_PACKAGE}/home?version=`, version)))
      const channelLines = (translate, tags) => React.createElement('div', { style: { margin: '4px 0', fontSize: '12px', lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' } },
        channelLine(translate, 'latest', tags && tags.latest),
        channelLine(translate, 'next', tags && tags.next),
         ...(tags && Object.prototype.hasOwnProperty.call(tags, 'alpha') ? [channelLine(translate, 'alpha', tags.alpha)] : []))

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
          React.createElement('button', { style: Object.assign({}, svcRowActionStyle(), { marginTop: '16px', padding: '7px 16px' }), onClick: () => setUpdateDetailsOpen(false) }, translate('update.details.close'))))
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
              style: Object.assign({}, svcRowActionStyle(), { marginTop: '16px', padding: '7px 16px' }),
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
        // 样式常量统一取自工厂级 svcButtonStyle/svcSurfaceStyle（v0.39 视觉语言收敛）。
        const danger = svcButtonStyle('danger')
        const dangerGhost = svcButtonStyle('dangerGhost')
        const ghost = svcButtonStyle('ghost')
        const row = { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }
        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const card = { padding: '4px 0 14px', marginBottom: '12px', color: 'var(--dsw-alias-label-primary)' }
        const displaySurface = svcSurfaceStyle()
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
                ? React.createElement('button', { style: dangerGhost, 'data-variant': 'dangerGhost', onClick: checkRestart, disabled: flow.busy }, translate(flow.busy ? 'update.checking' : 'restart.button'))
                : flow.stage === 1
                  ? [
                      React.createElement('button', { key: 'confirm', style: danger, 'data-variant': 'danger', onClick: () => restartWeb(false), disabled: flow.busy }, translate(flow.busy ? 'restart.sending' : 'restart.confirm')),
                      React.createElement('button', { key: 'cancel', style: ghost, onClick: () => setRestartFlow({ ...restartFlow, activity: null, stage: 0, busy: false, error: null }), disabled: flow.busy }, translate('restart.cancel')),
                    ]
                  : flow.stage === 3
                    ? [
                        React.createElement('button', { key: 'force', style: danger, 'data-variant': 'danger', onClick: () => restartWeb(true), disabled: flow.busy }, translate(flow.busy ? 'restart.sending' : 'restart.force')),
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
      const QUOTA_KIND_OPTIONS = ['opencode-go', 'zai-coding-cn', 'openrouter', 'kimi', 'siliconflow', 'deepseek', 'stepfun', 'stepfun-step-plan', 'xiaomi-token-plan-cn', 'cliproxy']
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
            const res = await rpcCall('quota', requested)
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
      /** 百分比窗口的数值文本：percent 必显；窗口带 used/limit（原始数值）时追加「已用 / 总量」figure，
       * 与控制台「{{used}} / {{limit}}」口径一致——只有比例没有绝对数会丢掉最关键的剩余信息。 */
      function quotaWindowValueText(window) {
        const percent = `${window.percent}%`
        const used = Number(window.used)
        const limit = Number(window.limit)
        if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return percent
        return `${percent} · ${formatCompactCount(used, { billions: true })} / ${formatCompactCount(limit, { billions: true })}`
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
          React.createElement('span', { style: valueStyle }, quotaWindowValueText(window))),
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

      /** 移动视口判定：与 v0.30 整体适配共用 1023px 断点；matchMedia 优先，
       * 缺席时 innerWidth 兜底。无 window（SSR/测试）一律宽视口，维持圆环上方锚定。 */
      function quotaNarrowViewport() {
        if (typeof window === 'undefined' || window === null) return false
        if (typeof window.matchMedia === 'function') {
          const query = window.matchMedia('(max-width: 1023px)')
          return typeof query.matches === 'boolean' ? query.matches : false
        }
        return typeof window.innerWidth === 'number' && window.innerWidth <= 1023
      }

      function QuotaRing(props) {
        const translate = useTranslation()
        const [quota, setQuota] = useState(quotaStore.getSnapshot())
        useEffect(() => quotaStore.subscribe(() => setQuota(quotaStore.getSnapshot())), [])
        // 自愈（v1.1.2）：真实渲染器把 inject 产物按 (entry,binding) 缓存——刷新/首进
        // 旧会话时 directoryFor 可能因会话作用域尚未热身抛错，空 props 被缓存后圆环静默。
        // 注入失败也携带 sessionId；store 缺席时组件内按 ctx.timer 退避重试解析目录，
        // 成功即接管后续 effect（成功路径零变化，失败路径最多 7 次 ≈30s 后放弃）。
        const propsStore = props && props.directoryStore
        const sessionId = props && typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : undefined
        const [retriedStore, setRetriedStore] = useState(null)
        const store = propsStore !== undefined && propsStore !== null ? propsStore : retriedStore
        useEffect(() => {
          if (propsStore !== undefined && propsStore !== null) return undefined
          if (sessionId === undefined) return undefined
          let stopped = false
          let dispose = null
          const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000, 15000]
          const attempt = (round) => {
            if (stopped) return
            let models = null
            try {
              models = getModelDirectories()
            } catch (_) {
              models = null
            }
            // 服务彻底缺席（老版本 DSH）是永久条件：不重试、不挂定时器。
            if (models === undefined || models === null || typeof models.directoryFor !== 'function') return
            let next = null
            try {
              next = models.directoryFor(sessionId)
            } catch (_) {
              next = null
            }
            if (next !== null && next !== undefined && next.store !== undefined && next.store !== null) {
              setRetriedStore(next.store)
              try {
                const pending = next.load()
                if (pending && typeof pending.catch === 'function') pending.catch(() => {})
              } catch (_) {}
              return
            }
            if (round >= RETRY_DELAYS_MS.length) return
            dispose = ctx.timer.timeout(() => { dispose = null; attempt(round + 1) }, RETRY_DELAYS_MS[round])
          }
          attempt(0)
          return () => { stopped = true; if (dispose !== null) dispose() }
        }, [propsStore, sessionId])
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
        const panelRef = useRef(null)
        // 移动视口：弹层 portal 到 body，在对话区域下半部保持水平居中；宽视口保持圆环上方锚定。
        // matchMedia change 订阅让旋转/拖宽窗口时弹层几何实时迁移，open 态不丢。
        const [narrow, setNarrow] = useState(quotaNarrowViewport)
        useEffect(() => {
          if (typeof window === 'undefined' || window === null || typeof window.matchMedia !== 'function') return undefined
          const query = window.matchMedia('(max-width: 1023px)')
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
        // 面板先构造、再决定挂载方式：移动视口 portal 到 document.body 后 fixed，
        // 水平居中、垂直中心下移到屏幕高度 75%；宽视口或 react-dom 缺席时锚定圆环上方。
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
            ? { position: 'fixed', left: '50%', top: '75%', transform: 'translate(-50%, -50%)', zIndex: 1000, boxSizing: 'border-box', width: 'min(280px, calc(100vw - 32px))', maxHeight: 'min(560px, calc(100dvh - 176px))', overflowY: 'auto', padding: '12px', borderRadius: '12px', background: 'var(--dsw-specific-menu)', border: '1px solid var(--dsw-alias-border-inverted)', boxShadow: 'var(--dsw-shadow-lv3)' }
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
        const { snapshot } = useFeatures()
        const [open, setOpen] = React.useState(false)
        const writable = snapshot.status === 'ready' && snapshot.writable === true
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
          // v0.39：开关体收敛为分组式 FeatureGroups（与面板「配置 → 功能」页同一事实源）。
          React.createElement(FeatureGroups, null),
          !writable ? React.createElement('p', { style: { margin: '6px 0 0', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('features.readOnly')) : null) : null)
      }

      // ─── 功能开关分组（v0.39）：配置页与官方插件卡共用的分组事实源 ──────────
      // 运行/观测 + 维护 + 交互 三组默认展开；外部（/healthz）默认折叠。
      // 两处共用同一分组与同一写入路径（featureScope.set，行级 saving 锁）。
      const FEATURE_GROUPS = [
        ['features.group.runtime', ['healthDiagnostics', 'modelUsage', 'quotaLookup'], true],
        ['features.group.maintenance', ['backupMaintenance', 'skillManager', 'subagentRoute', 'sessionManager'], true],
        ['features.group.interaction', ['taskNotifications', 'mobileAdaptation'], true],
        ['features.external', ['healthz'], false],
      ]
      function FeatureGroups() {
        const translate = useTranslation()
        const { snapshot, value } = useFeatures()
        const [saving, setSaving] = useState('')
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
          disabled: !writable || saving === key,
          onClick: async () => {
            setSaving(key)
            try { await featureScope.set(key, value[key] === false) } catch (_) {}
            setSaving('')
          },
          style: { width: '34px', height: '20px', borderRadius: '10px', padding: 0, flexShrink: 0, position: 'relative', border: '1px solid ' + (value[key] !== false ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'), background: value[key] !== false ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: writable && saving === '' ? 'pointer' : 'default', opacity: writable ? 1 : 0.5, lineHeight: 0 },
        }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: value[key] !== false ? '15px' : '1px', width: '16px', height: '16px', borderRadius: '50%', background: value[key] !== false ? '#fff' : 'var(--dsw-alias-label-tertiary)' } })))
        return React.createElement('div', null, FEATURE_GROUPS.map(([groupKey, keys]) => React.createElement('div', { key: groupKey, style: { marginTop: '10px' } },
          React.createElement('div', { style: { fontSize: '12px', fontWeight: 700, marginBottom: '2px' } }, translate(groupKey)),
          keys.map(row))))
      }

      // ─── 子代理模型（v0.27）：三态路由配置 ────────────────────────────────
      function mapSubagentError(translate, code) {
        if (code === 'feature-disabled') return translate('subagent.error.feature-disabled')
        if (code === 'llm-unavailable') return translate('subagent.error.llm-unavailable')
        if (code === 'unknown-mode') return translate('subagent.error.unknown-mode')
        if (code === 'invalid-model-route') return translate('subagent.error.invalid-model-route')
        if (code === 'invalid-reasoning-effort') return translate('subagent.error.invalid-reasoning-effort')
        if (code === 'network') return translate('subagent.error.network')
        return code
      }

      const SUBAGENT_MODES = ['inherit', 'follow', 'custom']
      function SubagentSection() {
        const translate = useTranslation()
        const { useState, useEffect } = React
        // v1.2：输入框底部累计行独立开关（默认开，存 dsh-service settings，热生效）。
        const features = useFeatures()
        const dockEnabled = features.value.subagentModelsDock !== false
        // v0.39：子代理的设置页左列入口已撤销（维护页内有完整功能），不再有段内入口开关。
        const [snapshot, setSnapshot] = useState(null)
        const [mode, setMode] = useState('inherit')
        const [provider, setProvider] = useState('')
        const [model, setModel] = useState('')
        const [loading, setLoading] = useState(true)
        const [saving, setSaving] = useState(false)
        const [savedTick, setSavedTick] = useState(0)
        const [error, setError] = useState('')
        const [reasoningEffort, setReasoningEffort] = useState('')
        const [fallbacks, setFallbacks] = useState([])
        const [reorderMode, setReorderMode] = useState(false)
        const hintStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const selectStyle = { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', maxWidth: '100%' }

        const load = async () => {
          setLoading(true)
          try {
            const res = await rpcCall('subagent-route', {})
            if (res.ok) {
              setSnapshot(res.value)
              setMode(res.value.mode)
              setFallbacks(Array.isArray(res.value.fallbacks) ? res.value.fallbacks : [])
              if (res.value.mode === 'custom') {
                setProvider(typeof res.value.provider === 'string' ? res.value.provider : '')
                setModel(typeof res.value.model === 'string' ? res.value.model : '')
                setReasoningEffort(typeof res.value.reasoningEffort === 'string' ? res.value.reasoningEffort : '')
              } else {
                setReasoningEffort('')
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
        const modelsFor = (providerId) => models.filter((item) => item.provider === providerId)
        // 精确模型及其 adapter 声明的可选思考等级（host 已裁剪；此处再做防御性过滤/去重）。
        const effortsFor = (modelEntry) => {
          const options = []
          const seenIds = new Set()
          for (const entry of (modelEntry?.reasoning?.efforts ?? [])) {
            if (entry === null || typeof entry !== 'object') continue
            const id = typeof entry.id === 'string' ? entry.id : ''
            if (id === '' || seenIds.has(id)) continue
            seenIds.add(id)
            options.push({ id, name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : id, description: typeof entry.description === 'string' && entry.description !== '' ? entry.description : undefined })
          }
          return options
        }
        const providerModels = modelsFor(provider)
        // 当前精确模型及其 adapter 声明的可选思考等级（host 已裁剪；此处再做防御性过滤/去重）。
        const selectedModel = providerModels.find((item) => item.id === model) ?? null
        const effortOptions = effortsFor(selectedModel)
        // 换供应商/模型后，若已选等级不再被新模型支持，立即重置为空，避免把旧等级发给新模型。
        useEffect(() => {
          if (reasoningEffort !== '' && !effortOptions.some((option) => option.id === reasoningEffort)) setReasoningEffort('')
        }, [provider, model])
        // 换供应商时若当前模型不属于它，回落到该供应商首个模型。
        useEffect(() => {
          if (provider !== '' && !providerModels.some((item) => item.id === model)) {
            setModel(providerModels[0]?.id ?? '')
          }
        }, [provider])
        const effectiveProvider = providers.includes(provider) ? provider : providers[0] ?? ''
        useEffect(() => { if (provider !== effectiveProvider) setProvider(effectiveProvider) }, [effectiveProvider, provider])

        // 回退模型（v1.1）：有序候选列表，custom/follow 共用；上限与宿主常量一致。
        const FALLBACK_MAX = 10
        const updateFallback = (index, patch) => {
          setFallbacks((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
        }
        const removeFallback = (index) => {
          setFallbacks((rows) => rows.filter((_, i) => i !== index))
        }
        const moveFallback = (index, delta) => {
          setFallbacks((rows) => {
            const target = index + delta
            if (target < 0 || target >= rows.length) return rows
            const next = [...rows]
            const moving = next.splice(index, 1)[0]
            next.splice(target, 0, moving)
            return next
          })
        }
        const addFallback = () => {
          setFallbacks((rows) => {
            if (rows.length >= FALLBACK_MAX) return rows
            const firstProvider = providers[0] ?? ''
            return [...rows, { provider: firstProvider, model: modelsFor(firstProvider)[0]?.id ?? '' }]
          })
        }
        // 排序模式只对 ≥2 条有意义：删到只剩一条时自动退出。
        useEffect(() => {
          if (reorderMode && fallbacks.length < 2) setReorderMode(false)
        }, [fallbacks.length])

        const save = async (nextMode) => {
          setSaving(true)
          setError('')
          try {
            const withFallbacks = (nextMode === 'custom' || nextMode === 'follow') && fallbacks.length > 0 ? { fallbacks } : {}
            const payload = nextMode === 'custom'
              ? { mode: 'custom', provider: effectiveProvider, model, ...(reasoningEffort !== '' ? { reasoningEffort } : {}), ...withFallbacks }
              : { mode: nextMode, ...withFallbacks }
            const res = await rpcCall('subagent-route-save', payload)
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
          style: Object.assign({}, svcRowActionStyle(), {
            cursor: loading ? 'default' : 'pointer',
            background: mode === candidate ? 'var(--dsh-svc-tab-active-bg)' : 'transparent',
            color: mode === candidate ? 'var(--dsh-svc-tab-active-text)' : 'var(--dsh-svc-text)',
            opacity: loading ? 0.55 : 1,
          })
        }, translate('subagent.mode.' + candidate))

        const fallbackIconButton = (testId, disabled, onClick, label, danger = false) => React.createElement('button', {
          type: 'button',
          'data-testid': testId,
          disabled: disabled || saving,
          onClick,
          style: {
            fontSize: '12px',
            padding: '3px 8px',
            borderRadius: '6px',
            border: '1px solid ' + (danger ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsh-svc-border-strong)'),
            background: 'transparent',
            color: danger ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsh-svc-text)',
            cursor: disabled || saving ? 'default' : 'pointer',
            opacity: disabled || saving ? 0.55 : 1,
          },
        }, label)
        // 排序箭头：仅图标（▲/▼），无文字。
        const fallbackArrowButton = (testId, disabled, onClick, glyph) => React.createElement('button', {
          type: 'button',
          'data-testid': testId,
          disabled: disabled || saving,
          onClick,
          style: {
            fontSize: '12px',
            lineHeight: '14px',
            width: '24px',
            height: '24px',
            padding: 0,
            borderRadius: '6px',
            border: '1px solid var(--dsh-svc-border-strong)',
            background: 'transparent',
            color: 'var(--dsh-svc-text)',
            cursor: disabled || saving ? 'default' : 'pointer',
            opacity: disabled || saving ? 0.55 : 1,
          },
        }, glyph)

        // 字段行标签（定宽对齐）：供应商 / 模型 / 思考等级。
        const fieldLabelStyle = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', width: '88px', flexShrink: 0 }

        return React.createElement('div', { 'data-testid': 'subagent-section', style: cardStyle },
          React.createElement('div', { style: { fontSize: '14px', fontWeight: 700 } }, translate('subagent.title')),
          React.createElement('p', { style: hintStyle }, translate('subagent.hint')),
          // v1.2：输入框底部累计行开关（独立于路由配置，feature 热生效；关闭仅隐藏累计行，
          // 回合尾行不受影响）。
          React.createElement('div', { 'data-testid': 'subagent-dock-toggle-row', style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', padding: '10px 12px', border: '1px solid var(--dsh-svc-border)', borderRadius: '8px', background: 'var(--dsh-svc-raised-bg)' } },
            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
              React.createElement('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, translate('subagent.dock.title')),
              React.createElement('p', { style: { ...hintStyle, marginTop: '2px', marginBottom: 0 } }, translate('subagent.dock.desc'))),
            React.createElement('button', { type: 'button', role: 'switch', 'aria-checked': String(dockEnabled), 'data-testid': 'subagent-dock-toggle', onClick: () => { featureScope.set('subagentModelsDock', !dockEnabled).catch(() => {}) }, style: { width: '34px', height: '20px', borderRadius: '10px', padding: 0, flexShrink: 0, position: 'relative', border: '1px solid ' + (dockEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'), background: dockEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: 'pointer', lineHeight: 0 } },
              React.createElement('span', { style: { position: 'absolute', top: '1px', left: dockEnabled ? '15px' : '1px', width: '16px', height: '16px', borderRadius: '50%', background: dockEnabled ? '#fff' : 'var(--dsw-alias-label-tertiary)', transition: 'left 150ms ease' } }))),
          snapshot !== null && snapshot.available === false ? React.createElement('p', { 'data-testid': 'subagent-unavailable', style: { ...hintStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, translate('subagent.unavailable')) : null,
          React.createElement('div', { 'data-testid': 'subagent-modes', style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
            SUBAGENT_MODES.map(modeButton)),
          React.createElement('p', { 'data-testid': 'subagent-mode-desc', style: { ...hintStyle, marginTop: '8px' } }, translate('subagent.mode.' + mode + '.desc')),
          mode === 'custom' ? React.createElement('div', { 'data-testid': 'subagent-custom', style: { marginTop: '8px' } },
            // 供应商行
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
              React.createElement('span', { style: fieldLabelStyle }, translate('subagent.provider')),
              React.createElement('select', { 'data-testid': 'subagent-provider', value: effectiveProvider, disabled: providers.length === 0 || saving, onChange: (event) => setProvider(event.target.value), style: selectStyle },
                providers.map((id) => React.createElement('option', { key: id, value: id }, providerName[id] ?? id)))),
            // 模型行
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
              React.createElement('span', { style: fieldLabelStyle }, translate('subagent.model')),
              React.createElement('select', { 'data-testid': 'subagent-model', value: model, disabled: providerModels.length === 0 || saving, onChange: (event) => setModel(event.target.value), style: selectStyle },
                providerModels.map((item) => React.createElement('option', { key: item.id, value: item.id }, item.name ?? item.id)))),
            // 思考等级行：选模型后出现；无等级信息时给提示。
            model !== '' ? React.createElement('div', { 'data-testid': 'subagent-reasoning-row', style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', flexWrap: 'wrap' } },
              React.createElement('span', { style: fieldLabelStyle }, translate('subagent.reasoningEffort')),
              React.createElement('select', { 'data-testid': 'subagent-reasoning-effort', value: reasoningEffort, disabled: saving || effortOptions.length === 0, onChange: (event) => setReasoningEffort(event.target.value), style: selectStyle },
                React.createElement('option', { value: '' }, translate('subagent.reasoningEffort.default')),
                ...effortOptions.map((option) => React.createElement('option', { key: option.id, value: option.id, ...(option.description !== undefined ? { title: option.description } : {}) }, option.name))),
              effortOptions.length === 0 ? React.createElement('span', { 'data-testid': 'subagent-reasoning-effort-unavailable', style: { fontSize: '12px', color: 'var(--dsw-alias-state-warn-primary)' } }, translate('subagent.reasoningEffort.unavailable')) : null) : null) : null,
          mode === 'custom' && models.length === 0 && !loading ? React.createElement('p', { 'data-testid': 'subagent-models-empty', style: { ...hintStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, translate('subagent.modelsEmpty')) : null,
          mode === 'custom' || mode === 'follow' ? React.createElement('div', { 'data-testid': 'subagent-fallback-block', style: { marginTop: '14px', borderTop: '1px solid var(--dsh-svc-border)', paddingTop: '12px' } },
            React.createElement('div', { style: { fontSize: '13px', fontWeight: 700 } }, translate('subagent.fallback.title')),
            React.createElement('p', { style: hintStyle }, translate('subagent.fallback.hint')),
            fallbacks.length === 0 ? React.createElement('p', { 'data-testid': 'subagent-fallback-empty', style: { ...hintStyle, color: 'var(--dsw-alias-label-secondary)' } }, translate('subagent.fallback.empty')) : null,
            fallbacks.map((fallback, index) => {
              const rowKnownProvider = providers.includes(fallback.provider)
              const rowProviderModels = rowKnownProvider ? modelsFor(fallback.provider) : []
              const rowModelEntry = rowProviderModels.find((item) => item.id === fallback.model) ?? null
              const rowEffortOptions = effortsFor(rowModelEntry)
              const rowEffortIds = rowEffortOptions.map((option) => option.id)
              return React.createElement('div', { key: index, 'data-testid': 'subagent-fallback-row', style: { marginTop: '8px', border: '1px solid var(--dsh-svc-border)', borderRadius: '8px', padding: '7px 10px 8px' } },
                // 标题行：序号 + 右侧操作（移除 / 排序箭头）。
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' } },
                  React.createElement('span', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, translate('subagent.fallback.item', { index: String(index + 1) })),
                  React.createElement('span', { style: { marginLeft: 'auto' } }),
                  fallbackIconButton('subagent-fallback-remove-' + index, false, () => removeFallback(index), translate('subagent.fallback.remove'), true),
                  reorderMode ? fallbackArrowButton('subagent-fallback-up-' + index, index === 0, () => moveFallback(index, -1), '▲') : null,
                  reorderMode ? fallbackArrowButton('subagent-fallback-down-' + index, index === fallbacks.length - 1, () => moveFallback(index, 1), '▼') : null),
                // 供应商行
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
                  React.createElement('span', { style: fieldLabelStyle }, translate('subagent.provider')),
                  React.createElement('select', { 'data-testid': 'subagent-fallback-provider-' + index, value: rowKnownProvider ? fallback.provider : '', disabled: saving, onChange: (event) => { const nextProvider = event.target.value; updateFallback(index, { provider: nextProvider, model: modelsFor(nextProvider)[0]?.id ?? '' }) }, style: selectStyle },
                    React.createElement('option', { value: '' }, ''),
                    providers.map((id) => React.createElement('option', { key: id, value: id }, providerName[id] ?? id)))),
                // 模型行
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
                  React.createElement('span', { style: fieldLabelStyle }, translate('subagent.model')),
                  React.createElement('select', { 'data-testid': 'subagent-fallback-model-' + index, value: rowProviderModels.some((item) => item.id === fallback.model) ? fallback.model : '', disabled: rowProviderModels.length === 0 || saving, onChange: (event) => { const nextModel = event.target.value; const nextEntry = rowProviderModels.find((item) => item.id === nextModel) ?? null; const nextIds = effortsFor(nextEntry).map((option) => option.id); updateFallback(index, { model: nextModel, ...(typeof fallback.reasoningEffort === 'string' && fallback.reasoningEffort !== '' && !nextIds.includes(fallback.reasoningEffort) ? { reasoningEffort: undefined } : {}) }) }, style: selectStyle },
                    rowProviderModels.map((item) => React.createElement('option', { key: item.id, value: item.id }, item.name ?? item.id)))),
                // 思考等级行：模型无等级信息时给提示。
                rowEffortOptions.length > 0
                  ? React.createElement('div', { 'data-testid': 'subagent-fallback-reasoning-row', style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
                    React.createElement('span', { style: fieldLabelStyle }, translate('subagent.reasoningEffort')),
                    React.createElement('select', { 'data-testid': 'subagent-fallback-effort-' + index, value: rowEffortIds.includes(fallback.reasoningEffort) ? fallback.reasoningEffort : '', disabled: saving, onChange: (event) => updateFallback(index, { reasoningEffort: event.target.value === '' ? undefined : event.target.value }), style: selectStyle },
                      React.createElement('option', { value: '' }, translate('subagent.reasoningEffort.default')),
                      ...rowEffortOptions.map((option) => React.createElement('option', { key: option.id, value: option.id, ...(option.description !== undefined ? { title: option.description } : {}) }, option.name))))
                  : React.createElement('span', { 'data-testid': 'subagent-fallback-effort-unavailable-' + index, style: { display: 'inline-block', marginTop: '4px', fontSize: '12px', color: 'var(--dsw-alias-state-warn-primary)' } }, translate('subagent.reasoningEffort.unavailable')))
            }),
            fallbacks.length >= FALLBACK_MAX
              ? React.createElement('p', { 'data-testid': 'subagent-fallback-limit', style: { ...hintStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, translate('subagent.fallback.limit', { max: String(FALLBACK_MAX) }))
              : React.createElement('div', { style: { display: 'flex', gap: '10px', marginTop: '8px', flexWrap: 'wrap' } },
                  React.createElement('button', { type: 'button', 'data-testid': 'subagent-fallback-add', disabled: saving || providers.length === 0, onClick: () => addFallback(), style: { fontSize: '12px', padding: '5px 12px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px dashed var(--dsh-svc-border-strong)', background: 'transparent', color: 'var(--dsh-svc-text)', cursor: saving || providers.length === 0 ? 'default' : 'pointer', opacity: saving || providers.length === 0 ? 0.55 : 1 } }, translate('subagent.fallback.add')),
                  fallbacks.length > 1 ? React.createElement('button', { type: 'button', 'data-testid': 'subagent-fallback-sort', disabled: saving, onClick: () => setReorderMode((value) => !value), style: { fontSize: '12px', padding: '5px 12px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsh-svc-border-strong)', background: reorderMode ? 'var(--dsh-svc-tab-active-bg)' : 'transparent', color: reorderMode ? 'var(--dsh-svc-tab-active-text)' : 'var(--dsh-svc-text)', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.55 : 1 } }, translate(reorderMode ? 'subagent.fallback.sort.done' : 'subagent.fallback.sort')) : null))
              : null,
          error !== '' ? React.createElement('p', { 'data-testid': 'subagent-error', style: { ...hintStyle, color: 'var(--dsw-alias-state-error-primary)' } }, mapSubagentError(translate, error)) : null,
          savedTick > 0 && error === '' ? React.createElement('p', { 'data-testid': 'subagent-saved', style: { ...hintStyle, color: 'var(--dsw-alias-state-success-primary)' } }, '✓ ' + translate('subagent.saved')) : null,
          React.createElement('div', { style: { display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' } },
            React.createElement('button', { type: 'button', 'data-testid': 'subagent-save', disabled: saving || loading || (mode === 'custom' && (effectiveProvider === '' || model === '')), onClick: () => void save(mode), style: { fontSize: '12px', padding: '6px 16px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid transparent', background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsh-svc-brand-text)', cursor: saving ? 'default' : 'pointer', opacity: saving || loading || (mode === 'custom' && (effectiveProvider === '' || model === '')) ? 0.55 : 1 } }, saving ? translate('subagent.saving') : translate('subagent.save')),
            mode !== 'inherit' ? React.createElement('button', { type: 'button', 'data-testid': 'subagent-reset', disabled: saving || loading, onClick: () => { setMode('inherit'); void save('inherit') }, style: { fontSize: '12px', padding: '6px 14px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsw-alias-state-error-primary)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', cursor: saving ? 'default' : 'pointer', opacity: saving || loading ? 0.55 : 1 } }, translate('subagent.reset')) : null))
      }

      // ─── 技能管理（v0.22）：三区列表 / 启停 / AI 补全 / 批量 ────────────────
      const SKILLS_MODEL_STORAGE_KEY = 'dsh-service-skills-model'
      const SKILL_RPC = (endpoint, payload) => rpcCall(endpoint, payload)
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

      // 宿主下发的日志条目是结构化 {at, name?, code, params}：时间戳按本机时区格式化（用户点名：
      // 原先 toISOString 出 UTC 时刻，看日志对不上本地钟）、文案词典渲染，词典没有的 code 原样透出。
      const formatSkillLogLine = (translate, entry) => {
        if (entry === null || typeof entry !== 'object') return String(entry)
        const date = new Date(entry.at)
        const pad = (value) => String(value).padStart(2, '0')
        const time = Number.isFinite(date.getTime())
          ? pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
          : '--:--:--'
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
        if (code === 'annotated-confirm-required') return translate('skills.error.annotated-confirm-required')
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
        // 计划含已注释条目时的强制覆盖确认：第一击只武装（3 秒自动复位），第二击才真正启动。
        const [batchAnnotatedArmed, setBatchAnnotatedArmed] = useState(false)
        // 将覆盖清单（已注释条目）：默认折叠，点开看被覆盖的技能名。
        const [annotatedListOpen, setAnnotatedListOpen] = useState(false)
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
        // 强制覆盖确认同样 3 秒自动复位；批量相位/计划变化（落定、重新计划）时武装状态作废。
        useEffect(() => {
          if (!batchAnnotatedArmed) return undefined
          const handle = setTimeout(() => setBatchAnnotatedArmed(false), 3000)
          return () => clearTimeout(handle)
        }, [batchAnnotatedArmed])
        useEffect(() => { setBatchAnnotatedArmed(false) }, [batchPhaseForLog, batchPlan])
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
          // 计划含已注释条目：第一击只武装「确认强制补全」，第二击（3 秒内）才真正启动并携带
          // forceAnnotated；无已注释条目时行为与原来一致，单击即启。
          const annotatedCount = Array.isArray(batchPlan?.annotated) ? batchPlan.annotated.length : 0
          if (annotatedCount > 0 && !batchAnnotatedArmed) { setBatchAnnotatedArmed(true); return }
          setBatchAnnotatedArmed(false)
          setBatchBusy(true)
          try { await startSkillsBatchShared(annotatedCount > 0) } finally { setBatchBusy(false) }
        }
        const cancelBatch = async () => { await cancelSkillsBatchShared() }

        // ── 渲染 ──
        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const badge = (text, tone) => React.createElement('span', { key: text, style: svcBadgeStyle(tone === 'warn' ? 'warning' : tone === 'danger' ? 'danger' : 'neutral', { marginLeft: '6px', padding: '1px 7px', verticalAlign: 'middle' }) }, text)
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
        // v0.31 用户点名两连修：AI 注释块独占整行占满技能展示区；技能自带的描述/用法行
        // 回到「文本 | 开关」双栏的左列原宽度，给右侧胶囊开关列留位。头部行 = 名称 +
        // 自带描述/用法/无效行（左列）+ 右侧开关列，注释块铺满全宽垫底。
        const entryCard = { border: '1px solid var(--dsh-alias-border-l2)', borderRadius: '10px', padding: '11px 13px', marginBottom: '8px', background: 'var(--dsh-svc-card-bg)' }

        const renderEntry = (entry) => {
          const invalidLegacy = typeof entry.invalid === 'string' && entry.invalid.startsWith('legacy-invocation-key:')
          const nameLine = React.createElement('div', { style: { fontSize: '14px', fontWeight: 650, color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' } },
            entry.name,
            badge(translate('skills.source.' + entry.source) === 'skills.source.' + entry.source ? entry.source : translate('skills.source.' + entry.source)),
            entry.shadowed ? badge(translate('skills.badge.shadowed'), 'warn') : null,
            !entry.writable ? badge(translate('skills.badge.readonly'), 'danger') : null,
            entry.annotated ? badge(translate('skills.badge.annotated')) : null)
          const descLine = React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginTop: '3px', lineHeight: 1.45, overflowWrap: 'anywhere' } }, entry.description)
          // 原文无 whenToUse 就不渲染该行，不放占位文案。
          const usageLine = entry.usage === '' ? null : React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '2px', lineHeight: 1.45, overflowWrap: 'anywhere' } },
            translate('skills.apply.usage') + '：' + entry.usage)
          // AI 注释块：只存插件侧车索引、只在面板展示；正文变更后自动标记过期。
          const noteLine = entry.note !== undefined ? React.createElement('div', { 'data-testid': 'skill-note-' + entry.name, style: { marginTop: '5px', padding: '6px 9px', borderRadius: '7px', background: 'var(--dsh-svc-raised-bg)', border: '1px solid var(--dsw-alias-border-l2)', fontSize: '11.5px', lineHeight: 1.55, color: 'var(--dsw-alias-label-secondary)', display: 'flex', gap: '8px', alignItems: 'flex-start' } },
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
            invalidLegacy && entry.writable ? React.createElement('button', { type: 'button', 'data-testid': 'skill-fix-' + entry.name, onClick: () => void fixLegacyKeys(entry), title: confirmingKey === entry.id + ':fix' ? translate('skills.switch.confirm') : undefined, style: { fontSize: '11px', padding: '2px 9px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsw-alias-state-warn-primary)', background: confirmingKey === entry.id + ':fix' ? 'rgba(198,128,0,0.14)' : 'transparent', color: 'var(--dsw-alias-state-warn-primary)', cursor: 'pointer' } }, confirmingKey === entry.id + ':fix' ? translate('skills.switch.confirm') : translate('skills.fix.legacy')) : null) : null
          const switches = entry.invalid === undefined ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', alignItems: 'flex-end', flexShrink: 0 } },
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.switch.model'),
              pillSwitch(entry.invocation.model, { testid: 'skill-switch-model-' + entry.name, disabled: !entry.writable, armed: confirmingKey === entry.id + ':model', title: confirmingKey === entry.id + ':model' ? translate('skills.switch.confirm') : undefined, onClick: () => void toggleSkill(entry, 'model') })),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.switch.user'),
              pillSwitch(entry.invocation.user, { testid: 'skill-switch-user-' + entry.name, disabled: !entry.writable, armed: confirmingKey === entry.id + ':user', title: confirmingKey === entry.id + ':user' ? translate('skills.switch.confirm') : undefined, onClick: () => void toggleSkill(entry, 'user') })),
            data !== null && data.llmAvailable ? React.createElement('button', { type: 'button', 'data-testid': 'skill-describe-' + entry.name, onClick: () => void openDescribe(entry), style: Object.assign({}, svcRowActionStyle(), { fontSize: '11px', padding: '3px 10px' }) }, '✨ ' + translate('skills.describe.button')) : null) : null
          return React.createElement('div', { key: entry.id, 'data-testid': 'skill-entry-' + entry.name, style: entryCard },
            React.createElement('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start', justifyContent: 'space-between' } },
              React.createElement('div', { style: { minWidth: 0, flex: 1 } }, nameLine, descLine, usageLine, invalidLine),
              switches),
            noteLine)
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
          return React.createElement('div', { 'data-testid': 'skill-describe-dialog', style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '12px', padding: '14px 16px', marginBottom: '14px', background: 'var(--dsh-svc-raised-bg)' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
              React.createElement('div', { style: { fontSize: '14px', fontWeight: 700 } }, translate('skills.describe.title', { name: entry.name })),
              React.createElement('button', { type: 'button', onClick: () => setDescribe(null), style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '15px' } }, '✕')),
            models === null && error === '' ? React.createElement('p', { style: hint }, translate('skills.describe.models.loading')) : null,
            models !== null && models.length === 0 ? React.createElement('p', { style: hint }, translate('skills.describe.models.empty')) : null,
            models !== null && models.length > 0 ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
              React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.describe.model')),
              React.createElement('select', { 'data-testid': 'skill-describe-model', value: modelItem === null ? '' : skillModelKey(modelItem), onChange: (event) => setDescribe((prev) => prev === null ? prev : { ...prev, modelItem: models.find((item) => skillModelKey(item) === event.target.value) ?? null }), style: inputStyle },
                models.map((item) => React.createElement('option', { key: skillModelKey(item), value: skillModelKey(item) }, item.providerName + ' / ' + item.name))),
              draft === null ? React.createElement('button', { type: 'button', 'data-testid': 'skill-describe-run', disabled: busy || modelItem === null, onClick: () => void runDescribe(), style: Object.assign({}, svcButtonStyle('neutral'), { fontSize: '12px', minHeight: '28px', padding: '4px 12px', cursor: busy ? 'default' : 'pointer', opacity: busy || modelItem === null ? 0.55 : 1 }) }, busy ? translate('skills.describe.running') : translate('skills.describe.run')) : null) : null,
            error !== '' ? React.createElement('p', { 'data-testid': 'skill-describe-error', style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, mapSkillErrorMessage(translate, error)) : null,
            renderLogBox('skill-describe-log', describeLogs.map((line) => formatSkillLogLine(translate, line))),
            diffRows,
            applied ? React.createElement('p', { 'data-testid': 'skill-apply-done', style: { ...hint, color: 'var(--dsw-alias-state-success-primary)' } }, '✓ ' + translate('skills.apply.done')) : null,
            draft !== null && !applied ? React.createElement('p', { 'data-testid': 'skill-note-disclaimer', style: { ...hint, fontSize: '11px' } }, translate('skills.note.panelOnly')) : null,
            draft !== null && !applied ? React.createElement('button', { type: 'button', 'data-testid': 'skill-apply-confirm', disabled: busy, onClick: () => void applyDraft(), style: { fontSize: '12px', padding: '6px 16px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid transparent', background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsh-svc-brand-text)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1 } }, translate('skills.apply.confirm')) : null)
        }

        // 跳过原因 → 本地化标签：已知原因走词典，未知原因原样透出（已注释条目不再进跳过清单，
        // 而是单列「将覆盖」候选，见 renderBatchCard）。
        const skipReasonLabel = (reason) => {
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
          const batchAnnotatedCount = Array.isArray(batchPlan?.annotated) ? batchPlan.annotated.length : 0
          return React.createElement('div', { 'data-testid': 'skills-batch-card', style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', padding: '13px 15px', margin: '14px 0' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
              React.createElement('div', { style: { fontSize: '13.5px', fontWeight: 700 } }, translate('skills.batch.title')),
              React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-collapse', onClick: () => setBatchCardOpen(false), style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '12px' } }, translate('skills.batch.collapse') + ' ▴')),
            React.createElement('p', { style: { ...hint, marginTop: '4px' } }, translate('skills.batch.hint')),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '9px', flexWrap: 'wrap' } },
              batchModels !== null && batchModels.length > 0 ? React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.batch.model'),
                React.createElement('select', { 'data-testid': 'skills-batch-model', value: batchModelItem === null ? '' : skillModelKey(batchModelItem), disabled: batchBusy || (batch !== null && batch.phase === 'running'), onChange: (event) => changeSkillsBatchModel(event.target.value), style: { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', maxWidth: '100%' } },
                  batchModels.map((item) => React.createElement('option', { key: skillModelKey(item), value: skillModelKey(item) }, item.providerName + ' / ' + item.name)))) : null,
              effectivePhase === 'idle' || effectivePhase === 'done' || effectivePhase === 'cancelled' ? React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-plan', disabled: batchBusy, onClick: () => void planBatch(), style: Object.assign({}, svcButtonStyle('neutral'), { cursor: batchBusy ? 'default' : 'pointer', opacity: batchBusy ? 0.55 : 1 }) }, translate('skills.batch.plan')) : null,
              batchPlan !== null ? React.createElement('span', { 'data-testid': 'skills-batch-candidates', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                translate('skills.batch.candidates', { count: batchPlan.candidates.length }) + (batchPlan.estBytes > 0 ? ' · ' + translate('skills.batch.estBytes', { size: formatSkillBytes(batchPlan.estBytes) }) : '') + (batchAnnotatedCount > 0 ? ' · ' + translate('skills.batch.annotated', { count: batchAnnotatedCount }) : '') + ' · ' + translate('skills.batch.skipped', { count: batchPlan.skipped.length })) : null,
              batchPlan !== null && effectivePhase === 'planned' ? React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-start', disabled: batchBusy || (batchPlan.candidates.length === 0 && batchAnnotatedCount === 0), onClick: () => void startBatch(), title: batchAnnotatedArmed ? translate('skills.switch.confirm') : undefined, style: { fontSize: '12px', padding: '5px 14px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid transparent', background: batchAnnotatedArmed ? 'var(--dsh-svc-warning)' : 'var(--dsw-alias-brand-primary)', color: 'var(--dsh-svc-brand-text)', cursor: batchBusy ? 'default' : 'pointer', opacity: batchBusy ? 0.55 : 1 } }, batchAnnotatedArmed && batchAnnotatedCount > 0 ? translate('skills.batch.forceConfirm', { count: batchAnnotatedCount }) : translate('skills.batch.start')) : null,
              batch !== null && batch.phase === 'running' ? React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-cancel', onClick: () => void cancelBatch(), style: { fontSize: '12px', padding: '4px 12px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsw-alias-state-error-primary)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer' } }, translate('skills.batch.cancel')) : null,
              batch !== null ? React.createElement('span', { 'data-testid': 'skills-batch-phase', style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('skills.batch.phase.' + phaseLabel)) : null),
            batchPlan !== null && batchPlan.candidates.length === 0 && batchAnnotatedCount === 0 ? React.createElement('p', { style: hint }, translate('skills.batch.no-candidates')) : null,
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
            // 将覆盖清单：已注释条目单列，展开看名称（强制覆盖前先看后果清单，两段式确认具象化）。
            (() => {
              const annotatedItems = Array.isArray(batchPlan?.annotated) ? batchPlan.annotated : []
              if (batchPlan === null || annotatedItems.length === 0) return null
              return React.createElement('div', { 'data-testid': 'skills-batch-annotated', style: { marginTop: '6px' } },
                React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-annotated-toggle', onClick: () => setAnnotatedListOpen((value) => !value), style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '11.5px', padding: 0 } },
                  (annotatedListOpen ? '▾ ' : '▸ ') + translate('skills.batch.annotatedList') + '（' + annotatedItems.length + '）'),
                annotatedListOpen ? React.createElement('div', { style: { marginTop: '4px', fontSize: '11.5px', lineHeight: 1.6, color: 'var(--dsh-svc-warning)' } },
                  annotatedItems.map((item, index) => React.createElement('div', { key: item.id ?? index, 'data-testid': 'skills-batch-annotated-item' },
                    (item.name === '' ? item.id : item.name)))) : null)
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

        // 批量注释默认折叠成单个入口按钮；有任务在途（运行/待开始）时自动展开。
        const [batchCardOpen, setBatchCardOpen] = useState(false)
        useEffect(() => {
          if (batch !== null && (batch.phase === 'running' || batch.phase === 'planned')) setBatchCardOpen(true)
        }, [batch !== null && batch.phase])
        return React.createElement('div', { 'data-testid': 'skills-section' },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
            React.createElement('input', { 'data-testid': 'skills-filter', value: filterText, placeholder: translate('skills.filter'), onChange: (event) => setFilterText(event.target.value), style: { fontSize: '12px', padding: '6px 10px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', width: '200px' } }),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
              // v0.39：技能的设置页左列入口已撤销（维护页内有完整功能），只剩刷新按钮。
              // v0.39 统一：刷新钮三胞胎（usage/skills/sessions）同一紧凑 neutral 视觉。
              React.createElement('button', { type: 'button', 'data-testid': 'skills-refresh', 'data-variant': 'neutral', style: Object.assign({}, svcButtonStyle('neutral'), { minHeight: '28px', padding: '4px 10px', fontSize: '12px' }), onClick: () => void load() }, '↻'))),
          loading && data === null ? React.createElement('p', { style: hint }, '…') : null,
          (error !== '' || batchError !== '') ? React.createElement('p', { 'data-testid': 'skills-error', style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, mapSkillErrorMessage(translate, error !== '' ? error : batchError)) : null,
          data !== null && data.llmAvailable ? React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-toggle', 'aria-expanded': String(batchCardOpen), onClick: () => setBatchCardOpen((value) => !value), style: { margin: '0 0 12px', fontSize: '12px', padding: '6px 14px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid ' + (batchCardOpen ? 'var(--dsw-alias-label-dimmed)' : 'var(--dsh-svc-border-strong)'), background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' } }, (batchCardOpen ? '▾ ' : '▸ ') + translate('skills.batch.toggle')) : null,
          batchCardOpen && data !== null && data.llmAvailable ? renderBatchCard() : null,
          renderDescribeDialog(),
          renderGroups())
      }

      function QuotaSection() {
        return React.createElement(RemoteQuotaCard, null)
      }

      // ─── 会话管理（v0.35）：列表/搜索/详情/导出/归档/删除 ──────────────────
      // v0.36：体积不在列表下发，行内懒加载（sessions-bytes）；非正数不渲染占位符。
      function formatBytes(value) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return ''
        if (value === 0) return '0 B'
        const units = ['B', 'KB', 'MB', 'GB']
        let size = value
        let unit = 0
        while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
        return (unit === 0 ? String(size) : size.toFixed(1)) + ' ' + units[unit]
      }
      function formatSessionTime(value, translate) {
        if (typeof value !== 'number' || value <= 0) return translate('sessions.status.unavailableTime')
        try { return new Date(value).toLocaleString() } catch (_) { return String(value) }
      }
      function highlightSessionSnippet(text, query, keyPrefix) {
        const source = typeof text === 'string' ? text : ''
        const tokens = typeof query === 'string' ? query.trim().split(/\s+/).filter(Boolean) : []
        if (source === '' || tokens.length === 0) return source
        let pattern
        try {
          pattern = new RegExp(tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'gi')
        } catch (_) {
          return source
        }
        const children = []
        let cursor = 0
        let match
        let index = 0
        while ((match = pattern.exec(source)) !== null) {
          if (match.index > cursor) children.push(source.slice(cursor, match.index))
          children.push(React.createElement('mark', { key: keyPrefix + '-' + index, 'data-testid': keyPrefix + '-' + index, style: { background: 'rgba(198,128,0,0.24)', color: 'inherit', borderRadius: '3px', padding: '0 1px' } }, match[0]))
          cursor = match.index + match[0].length
          index += 1
        }
        if (children.length === 0) return source
        if (cursor < source.length) children.push(source.slice(cursor))
        return children
      }
      function mapSessionError(translate, code) {
        if (code === 'feature-disabled') return translate('sessions.error.feature-disabled')
        if (code === 'session-not-found') return translate('sessions.error.session-not-found')
        if (code === 'live-session-rejected') return translate('sessions.error.live-session-rejected')
        if (code === 'session-not-archived') return translate('sessions.error.session-not-archived')
        if (code === 'unknown-delete-plan') return translate('sessions.error.unknown-delete-plan')
        if (code === 'network') return translate('sessions.error.network')
        return code
      }
      // v0.36（用户点名「查看渲染优化」）：连续的系统事件合并为一块（DOM/视觉噪音双降），
      // 点击展开显示明细。普通事件原样保留。返回 [{_noiseBlock:true, count, firstSeq, lastSeq} | event]
      function collapseEventItems(items) {
        const out = []
        for (const item of Array.isArray(items) ? items : []) {
          if (item.noise === true) {
            const last = out[out.length - 1]
            if (last !== undefined && last._noiseBlock === true) {
              last.count += 1
              last.lastSeq = item.seq
            } else {
              out.push({ _noiseBlock: true, count: 1, firstSeq: item.seq, lastSeq: item.seq })
            }
          } else {
            out.push(item)
          }
        }
        return out
      }

      // v0.37 用户点名「查看详情后返回列表维持原位置」：进详情前记录列表滚动位置，返回时恢复。
      // 滚动容器不是本插件的 DOM——官方设置面板的内容列（.VOzbGW_options，overflow-y:auto）在
      // panel > content 里，跨列表⇄详情切换一直挂载（哈希类名跨版本会漂，故不按类名找）。
      // 从点击行的 DOM 祖先链向上找第一个「真的能滚」的滚动祖先（computed overflowY；测试替身
      // 无 document 时回落 inline style）。找不到容器（宽度撑不满/异常布局）= 无需恢复，静默降级。
      function findSessionScrollContainer(event) {
        let node = event !== null && event !== undefined && event.currentTarget ? event.currentTarget : null
        const doc = typeof document !== 'undefined' ? document : null
        while (node !== null && node !== undefined && node.nodeType === 1) {
          let overflowY = ''
          if (doc !== null && doc.defaultView && typeof doc.defaultView.getComputedStyle === 'function') {
            try {
              const style = doc.defaultView.getComputedStyle(node)
              overflowY = style ? String(style.overflowY || '') : ''
            } catch (_) { /* 个别节点 computed style 抛错：当无样式处理 */ }
          } else if (node.style) {
            overflowY = String(node.style.overflowY || node.style.overflow || '')
          }
          if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
            && typeof node.scrollHeight === 'number' && typeof node.clientHeight === 'number'
            && node.scrollHeight > node.clientHeight + 1) {
            return node
          }
          node = node.parentNode
        }
        return null
      }

      // v0.37 搜索命中定位（参考 dsh-session-kb 的 Locate）：命中窗口渲染完成后把详情滚动到
      // 目标命中行并闪烁高亮 2s。行按 testid sessions-jump-target-<seq> 找（seq 来自宿主可信
      // 清单，非用户输入）；滚动为 best-effort——测试替身无真实 DOM/行未渲染时静默跳过。
      function jumpScrollToHit(seq) {
        if (typeof document === 'undefined' || document === null) return () => {}
        try {
          const element = document.querySelector('[data-testid="sessions-jump-target-' + seq + '"]')
          if (element === null || element === undefined) return () => {}
          try {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' })
          } catch (_) {
            try { element.scrollIntoView() } catch (_) {}
          }
          if (element.classList && typeof element.classList.add === 'function') {
            element.classList.add('dshsv-locate-flash')
            const disposeTimer = ctx.timer.timeout(() => {
              try {
                if (element.classList && typeof element.classList.remove === 'function') element.classList.remove('dshsv-locate-flash')
              } catch (_) {}
            }, 2000)
            return () => {
              disposeTimer()
              try {
                if (element.classList && typeof element.classList.remove === 'function') element.classList.remove('dshsv-locate-flash')
              } catch (_) {}
            }
          }
        } catch (_) {
          // 定位滚动失败不影响查看：保持现状
        }
        return () => {}
      }

      // v0.36 用户反馈「关掉面板再打开又要重新加载」：列表/体积缓存从组件 state 提升到
      // **模块级**（页面加载期间一直存活，设置面板关闭只是组件卸载、数据保留；刷新页面才清零）。
      // 测试替代环境的 ?test= 查询串让每个 renderer 独立评估本模块，互不污染。
      const sessionPanelListCache = { all: undefined, archived: undefined, deleted: undefined }
      const sessionPanelBytesCache = new Map()
      // v0.36 详情正文 markdown：复用官方渲染器 @deepseek-ai/dsh-client-ui-primitives 的
      // MarkdownText（untrusted 安全设计，老 DSH 缺席时 try/catch 回落纯文本）。
      // 官方导出是 React.memo 返回对象（keys=[$$typeof,type,compare]），createElement 直通——
      // 判「可渲染组件」认 function 或 exotic $$typeof（memo/forwardRef/lazy），
      // {default: fn} 互操作形态作第二候选解包（把 memo 对象当不可用是当初误判的根源）。
      const EXOTIC_COMPONENT_TYPES = [Symbol.for('react.memo'), Symbol.for('react.forward_ref'), Symbol.for('react.lazy')]
      const isRenderableComponent = (value) => {
        if (typeof value === 'function') return true
        if (value !== null && typeof value === 'object' && typeof value.$$typeof === 'symbol') {
          return EXOTIC_COMPONENT_TYPES.includes(value.$$typeof)
        }
        return false
      }
      let sessionMarkdownText = null
      try {
        const uiPrimitives = require('@deepseek-ai/dsh-client-ui-primitives')
        let candidate = uiPrimitives === null || uiPrimitives === undefined ? null : uiPrimitives.MarkdownText
        // 直通判定：函数 / memo / forwardRef / lazy。
        if (isRenderableComponent(candidate)) {
          sessionMarkdownText = candidate
        } else if (candidate !== null && typeof candidate === 'object') {
          // 互操作命名空间包裹 {default: fn}：解包后再判定。
          const unwrapped = typeof candidate.default === 'function' ? candidate.default
            : typeof candidate.MarkdownText === 'function' ? candidate.MarkdownText
              : null
          candidate = unwrapped
          if (isRenderableComponent(candidate)) {
            sessionMarkdownText = candidate
          } else {
            let shape = String(typeof candidate)
            try { shape += ' keys=[' + Object.keys(candidate).join(',') + ']' } catch (_) {}
            console.warn('[dsh-service-md] MarkdownText is an unexpected value (' + shape + ') — falling back to plain text')
          }
        } else {
          // v0.36 排查埋点（[dsh-service-md] tag）：seed 拿到了但 MarkdownText 缺席——
          // 之前静默吞掉导致「不渲染却无原因」。打开 DevTools Console 即可看到。
          console.warn('[dsh-service-md] ui-primitives seed present, but MarkdownText unavailable (' + typeof candidate + ') — falling back to plain text')
        }
      } catch (error) {
        // v0.36 排查埋点：老外壳 seed 缺席 require 抛错——warn 一次让「为何回落」可见。
        console.warn('[dsh-service-md] ui-primitives require failed: ' + (error && error.message ? error.message : String(error)))
      }
      if (sessionMarkdownText !== null) console.info('[dsh-service-md] session detail markdown renderer ready')

      function SessionsSection() {
        const translate = useTranslation()
        const { useState, useEffect, useRef } = React
        const [navEnabled, setNavEnabled] = sessionsNavToggle.useEnabled()
        // 列表状态
        // 测试替身 React 的 useState 只接受直接值（不接受初始化函数），模块缓存读取放表达式里。
        const cachedArchivedList = sessionPanelListCache.archived
        const [list, setList] = useState(cachedArchivedList !== undefined ? cachedArchivedList : null)
        // v0.36：列表/体积为模块级缓存——面板关闭再打开直接复用（零 RPC 秒开），
        // 切换筛选走同一缓存；「刷新」按钮强制重拉（用户反馈：关闭再打开不该重新加载）。
        const [loading, setLoading] = useState(cachedArchivedList === undefined)
        const [error, setError] = useState('')
        // v0.36：行体积懒加载——bytesById 初始自模块级缓存，跨面板关闭复用
        //（刷新浏览器/宿主重启后宿主另有内存缓存接管 sessions-bytes 秒回）。
        const [bytesById, setBytesById] = useState(Object.fromEntries(sessionPanelBytesCache))
        const bytesInFlight = useRef(new Set())
        // v0.35 用户反馈：默认停在「仅归档」——不再每次打开都全量拉全部会话（过得快）。
        const [filter, setFilter] = useState('archived')      // all | archived | deleted
        const [sort, setSort] = useState('createdDesc')      // createdDesc | createdAsc | title
        // 批量选择只作用于当前普通列表视图：进入后可点击整行（复选框仍可单独操作）或全选当前筛选结果；
        // 搜索结果/已删除记录不进入批量模式，切换筛选或进入详情时自动退出，避免把隐藏行带进选择集。
        const [batchMode, setBatchMode] = useState(false)
        const [selectedIds, setSelectedIds] = useState([])
        const [search, setSearch] = useState('')
        const [searchScopeArchived, setSearchScopeArchived] = useState(false)
        const [searchRunning, setSearchRunning] = useState(false)
        const [searchResult, setSearchResult] = useState(null)
        // 详情状态
        const [detail, setDetail] = useState(null)            // {sessionId, title, view: 'events'|'search', cursor, items, total, hitItems}
        const [detailLoading, setDetailLoading] = useState(false)
        const [detailError, setDetailError] = useState('')
        // v0.36：系统事件块的展开态（key=块首条 seq），默认折叠。
        const [noiseOpen, setNoiseOpen] = useState({})
        const toggleNoiseBlock = (firstSeq) => setNoiseOpen((current) => ({ ...current, [firstSeq]: !current[firstSeq] }))
        // v0.37 详情返回保持列表滚动位置：进详情时保存一次、回列表时恢复一次。记录当下列表
        // 上下文（筛选/排序/搜索），返回时上下文一致才回写 scrollTop——在详情里切了筛选/
        // 搜了新词，列表内容已换，不恢复旧位置（避免冲到别的视图上）。
        const savedListScroll = useRef(null)
        const listScrollKey = () => filter + '\u0000' + sort + '\u0000' + search + '\u0000' + (searchScopeArchived ? 1 : 0)
        // 导出状态
        const [exportingId, setExportingId] = useState('')
        const [exportError, setExportError] = useState('')
        // 批量操作状态：按钮只处理当前选择中符合各动作边界的行（归档排除 live/已归档，
        // 删除只含非 live 的已归档行）；删除仍逐项向宿主申请 plan，并合并到一次确认中。
        const [batchWorking, setBatchWorking] = useState('')
        const [batchResult, setBatchResult] = useState('')
        const [batchError, setBatchError] = useState('')
        // 删除确认状态
        const [deletePlan, setDeletePlan] = useState(null)
        const [deleting, setDeleting] = useState(false)
        const [deleteError, setDeleteError] = useState('')
        const [doneTick, setDoneTick] = useState(0)
        // 归档状态
        const [archivingId, setArchivingId] = useState('')
        const [archiveError, setArchiveError] = useState('')

        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const sectionTitle = { fontSize: '14px', fontWeight: 700, margin: '0 0 8px', color: 'var(--dsw-alias-label-primary)' }
        const chipButton = svcRowActionStyle()
        // v0.39 按钮语义（安全教义）：删除初次出现 = 危险描边，实底红只留给最终确认。
        const dangerOutlineButton = Object.assign({}, chipButton, { background: 'transparent', borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' })
        const dangerSolidButton = Object.assign({}, chipButton, { background: 'var(--dsw-alias-state-error-primary)', borderColor: 'transparent', color: 'var(--dsh-svc-brand-text)' })
        const inputStyle = { fontSize: '12px', padding: '6px 10px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', width: '100%', boxSizing: 'border-box' }
        const selectStyle = { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', maxWidth: '100%' }

        // 当前筛选对应的宿主 scope：archived/deleted 只在宿主侧拉对应子集，
        // 避免每次打开/切换都全量拉取全部会话（v0.35 用户反馈：全量刷新多余）。
        const scopeForFilter = (key) => key === 'archived' ? 'archived' : key === 'deleted' ? 'deleted' : 'all'
        // v0.36 用户选定「秒显 + 后台静默刷新」：打开面板先渲染缓存，再无感 re-fetch 一次。
        // filterRef 每次渲染同步当前筛选——loadList 响应回来时若视图已切走，不应用 setList（防竞态覆盖）。
        const filterRef = useRef(filter)
        filterRef.current = filter
        const loadList = async (scope, options = {}) => {
          const target = scope !== undefined ? scope : scopeForFilter(filter)
          const cached = sessionPanelListCache[target]
          const reuse = !options.force && cached !== undefined
          if (reuse) {
            setList(cached)
            setError('')
            setLoading(false)
            // 打开面板（组件重挂载）走 silent：秒显缓存后再后台静默刷新一次——
            // 不置 loading、失败保留缓存视图；普通缓存命中（切换筛选）零 RPC 直接返回。
            if (options.silent !== true) return
          } else {
            setLoading(true)
          }
          try {
            const res = await rpcCall('sessions-list', { scope: target })
            if (res.ok) {
              sessionPanelListCache[target] = res.value
              // 竞态防护：静默/普通刷新响应回来时用户可能已切到别的 scope——缓存照写、
              // 视图只在仍处于该 scope 时原地更新（filterRef 是发起后最新值）。
              if (scopeForFilter(filterRef.current) === target) {
                setList(res.value)
                setError('')
              }
            } else if (!(reuse && options.silent)) {
              setError(mapSessionError(translate, res.error || 'unknown'))
            }
          } catch (_) {
            if (!(reuse && options.silent)) setError(translate('sessions.error.network'))
          } finally {
            if (!(reuse && options.silent)) setLoading(false)
          }
        }
        const refreshList = () => void loadList(undefined, { force: true })
        const changeFilter = (key) => {
          if (key === filter) return
          setFilter(key)
          setBatchMode(false)
          setSelectedIds([])
          setBatchResult('')
          setBatchError('')
          setSearch('')
          setSearchResult(null)
          setDetail(null)
          void loadList(key)
        }
        useEffect(() => { void loadList('archived', { silent: true }) }, [])

        // v0.36：体积懒加载——列表落地后只对缺体积的行发起一次 sessions-bytes 批量请求
        // （分片防超宿主上限）；请求失败留在缺失集，下次列表变更自动重试；筛选切换时
        // bytesById 已在组件状态里，同一面板内不重复请求。
        useEffect(() => {
          if (list === null) return
          const items = Array.isArray(list.items) ? list.items : []
          const missing = []
          for (const item of items) {
            const id = item.id
            if (bytesById[id] !== undefined || bytesInFlight.current.has(id)) continue
            bytesInFlight.current.add(id)
            missing.push(id)
          }
          if (missing.length === 0) return
          let cancelled = false
          const MAX_PER_REQUEST = 100
          const fetchSlice = async (sliceIds) => {
            try {
              const res = await rpcCall('sessions-bytes', { ids: sliceIds })
              if (cancelled) return
              const map = res && res.ok && res.value && typeof res.value.bytes === 'object' ? res.value.bytes : {}
              if (Object.keys(map).length > 0) {
                for (const id of sliceIds) {
                  if (map[id] !== undefined) sessionPanelBytesCache.set(id, map[id])
                }
                setBytesById((current) => {
                  const next = { ...current }
                  for (const id of sliceIds) {
                    if (map[id] !== undefined) next[id] = map[id]
                  }
                  return next
                })
              }
            } catch (_) {
              // 网络失败：保持缺失，下次列表变更重试
            } finally {
              if (!cancelled) {
                for (const id of sliceIds) bytesInFlight.current.delete(id)
              }
            }
          }
          for (let index = 0; index < missing.length; index += MAX_PER_REQUEST) {
            void fetchSlice(missing.slice(index, index + MAX_PER_REQUEST))
          }
          return () => {
            cancelled = true
            for (const id of missing) bytesInFlight.current.delete(id)
          }
        }, [list])

        const runSearch = async (query) => {
          if (query.trim() === '') { setSearchResult(null); return }
          setSearchRunning(true)
          try {
            const res = await rpcCall('sessions-search', {
              query: query.trim(),
              scope: searchScopeArchived ? 'archived' : 'all',
            })
            if (res.ok) setSearchResult(res.value)
            else setSearchResult({ available: true, query, scope: 'all', hits: [], error: res.error })
          } catch (_) {
            setSearchResult({ available: true, query, scope: searchScopeArchived ? 'archived' : 'all', hits: [], error: 'network' })
          } finally {
            setSearchRunning(false)
          }
        }
        // 防抖 300ms
        useEffect(() => {
          if (filter === 'deleted') return
          if (search.trim() === '') { setSearchResult(null); return }
          return ctx.timer.timeout(() => { void runSearch(search) }, 300)
        }, [search, searchScopeArchived, filter])

        const openDetail = (sessionId, view, hitItems, event, targetSeq) => {
          setBatchMode(false)
          setSelectedIds([])
          setBatchResult('')
          setBatchError('')
          // v0.37：进详情前沿点击行的 DOM 祖先链找官方面板内容滚动容器（.VOzbGW_options），
          // 记下列表位置；找不到容器（宽度撑不满/异常布局/无点击事件）→ 不保存，返回时保持现状。
          const scrollContainer = findSessionScrollContainer(event)
          if (scrollContainer !== null) {
            savedListScroll.current = { key: listScrollKey(), container: scrollContainer, scrollTop: scrollContainer.scrollTop }
          }
          setNoiseOpen({})
          setDetail({ sessionId, view: view || 'events', cursor: undefined, items: [], total: 0, hitItems: hitItems || null, loadedTitle: '', centerSeq: undefined })
          setDetailError('')
          setDetailLoading(false)
          if ((view || 'events') === 'search' && Array.isArray(hitItems) && hitItems.length > 0) {
            // v0.37 搜索命中不再从头分页（旧实现浪费一次拉取且看不到上下文）：
            // 直接进命中窗口视图，围绕首个命中（或点击的 seq 芯片）拉上下文窗口。
            const seq = Number.isSafeInteger(targetSeq) ? Number(targetSeq) : Number(hitItems[0].seq)
            void loadJumpWindow(sessionId, Number.isSafeInteger(seq) ? seq : 0)
          } else {
            void loadDetailPage(sessionId, undefined, view || 'events')
          }
        }
        const loadDetailPage = async (sessionId, cursor, view) => {
          setDetailLoading(true)
          try {
            const res = await rpcCall('sessions-view', { id: sessionId, cursor })
            if (res.ok) {
              setDetail((current) => {
                const merged = current === null ? {} : current
                const appended = cursor === undefined ? (res.value.items || []) : [...(merged.items || []), ...(res.value.items || [])]
                return {
                  ...merged,
                  sessionId,
                  view: view || merged.view || 'events',
                  cursor: res.value.nextCursor,
                  items: appended,
                  total: res.value.total,
                  loadedTitle: merged.loadedTitle || (res.value.session && res.value.session.id !== undefined ? '' : ''),
                }
              })
              setDetailError('')
            } else {
              setDetailError(mapSessionError(translate, res.error || 'unknown'))
            }
          } catch (_) {
            setDetailError(translate('sessions.error.network'))
          } finally {
            setDetailLoading(false)
          }
        }
        // v0.37 命中窗口视图：围绕命中 seq 拉上下文窗口（宿主端快照缓存切片，无额外读取）。
        const loadJumpWindow = async (sessionId, seq) => {
          setDetailLoading(true)
          setDetailError('')
          try {
            const res = await rpcCall('sessions-view', { id: sessionId, center: seq })
            if (res.ok) {
              setDetail((current) => {
                const merged = current === null ? {} : current
                return {
                  ...merged,
                  sessionId,
                  view: 'search',
                  cursor: res.value.nextCursor,
                  items: res.value.items || [],
                  total: res.value.total,
                  // 命中行不一定是窗口几何中心（窗口两端被行首/行尾裁剪），以宿主回传为准。
                  centerSeq: Number.isSafeInteger(res.value.centerSeq) ? res.value.centerSeq : seq,
                  loadedTitle: merged.loadedTitle || '',
                }
              })
              setDetailError('')
            } else {
              setDetailError(mapSessionError(translate, res.error || 'unknown'))
            }
          } catch (_) {
            setDetailError(translate('sessions.error.network'))
          } finally {
            setDetailLoading(false)
          }
        }

        const downloadSessionExport = async (sessionId) => {
          try {
            const res = await rpcCall('sessions-export', { id: sessionId })
            if (!res.ok) return { ok: false, error: mapSessionError(translate, res.error || 'unknown') }
            // 复用官方 ZIP 下载：HEAD 探测 → 触发浏览器下载（同源 loopback）。
            const url = res.value.url
            const head = await fetch(url, { method: 'HEAD' })
            if (!head.ok) return { ok: false, error: translate('sessions.error.export-failed', { error: 'HTTP ' + head.status }) }
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = 'dsh-session-' + sessionId.replace(/[^A-Za-z0-9_-]/g, '_') + '.zip'
            anchor.click()
            return { ok: true }
          } catch (_) {
            return { ok: false, error: translate('sessions.error.network') }
          }
        }
        const doExport = async (sessionId) => {
          setExportingId(sessionId)
          setExportError('')
          const result = await downloadSessionExport(sessionId)
          if (!result.ok) setExportError(result.error)
          setExportingId('')
          return result
        }

        const applyArchivedSession = (sessionId) => {
          // 本地同步模块级缓存（不重拉）：all/archived 缓存里该行标 archived，
          // archived 缓存缺此行则补入（切「仅归档」/重开面板直接命中新行）。
          const currentAll = sessionPanelListCache.all
          if (currentAll !== undefined && Array.isArray(currentAll.items)) {
            sessionPanelListCache.all = { ...currentAll, items: currentAll.items.map((item) => item.id === sessionId ? { ...item, archived: true } : item) }
          }
          const archived = sessionPanelListCache.archived
          if (archived !== undefined && Array.isArray(archived.items)) {
            const exists = archived.items.some((item) => item.id === sessionId)
            const sourceRow = currentAll?.items?.find((item) => item.id === sessionId)
            sessionPanelListCache.archived = exists
              ? { ...archived, items: archived.items.map((item) => item.id === sessionId ? { ...item, archived: true } : item) }
              : sourceRow !== undefined
                ? { ...archived, items: [{ ...sourceRow, archived: true }, ...archived.items] }
                : archived
          }
          setList((current) => {
            if (current === null || !Array.isArray(current.items)) return current
            return { ...current, items: current.items.map((item) => item.id === sessionId ? { ...item, archived: true } : item) }
          })
        }
        const archiveSession = async (sessionId) => {
          try {
            const res = await rpcCall('sessions-archive', { id: sessionId })
            if (!res.ok) return { ok: false, error: mapSessionError(translate, res.error || 'unknown') }
            applyArchivedSession(sessionId)
            return { ok: true }
          } catch (_) {
            return { ok: false, error: translate('sessions.error.network') }
          }
        }
        const doArchive = async (sessionId) => {
          setArchivingId(sessionId)
          setArchiveError('')
          const result = await archiveSession(sessionId)
          if (!result.ok) setArchiveError(result.error)
          setArchivingId('')
          return result
        }

        const requestDelete = async (sessionId) => {
          // 在途防重：确认模态已开时不重复发起 plan。
          if (deletePlan !== null || deleting) return
          setDeleteError('')
          try {
            const res = await rpcCall('sessions-delete-plan', { id: sessionId })
            if (res.ok) {
              setDeletePlan(res.value)
            } else {
              setDeleteError(mapSessionError(translate, res.error || 'unknown'))
            }
          } catch (_) {
            setDeleteError(translate('sessions.error.network'))
          }
        }
        const applyDeletedSession = (session) => {
          const removedId = session?.id ?? ''
          if (removedId === '') return
          // v0.36：删除同步模块级缓存（all/archived 移除行、deleted 缓存补记录）——
          // 切回已加载过的视图/关掉面板再打开都不再重拉；deleted 缓存从未加载时首次切换仍按 scope 拉一次。
          const removedRow = list !== null && Array.isArray(list.items) ? list.items.find((item) => item.id === removedId) : undefined
          const deletedRecord = {
            id: removedId,
            title: typeof session?.title === 'string' ? session.title : (removedRow?.title ?? ''),
            cwd: session?.cwd ?? removedRow?.cwd ?? null,
            deletedAt: Date.now(),
          }
          for (const scope of ['all', 'archived']) {
            const value = sessionPanelListCache[scope]
            if (value !== undefined && Array.isArray(value.items)) {
              sessionPanelListCache[scope] = { ...value, items: value.items.filter((item) => item.id !== removedId) }
            }
          }
          const deletedValue = sessionPanelListCache.deleted
          if (deletedValue !== undefined) {
            sessionPanelListCache.deleted = {
              ...deletedValue,
              deleted: [
                deletedRecord,
                ...(Array.isArray(deletedValue.deleted) ? deletedValue.deleted : []).filter((item) => item.id !== removedId),
              ],
            }
          }
          sessionPanelBytesCache.delete(removedId)
          setList((current) => {
            if (current === null) return current
            const items = Array.isArray(current.items) ? current.items : []
            return {
              ...current,
              items: items.filter((item) => item.id !== removedId),
              deleted: [
                deletedRecord,
                ...(Array.isArray(current.deleted) ? current.deleted : []).filter((item) => item.id !== removedId),
              ],
            }
          })
          setBytesById((current) => {
            const next = { ...current }
            delete next[removedId]
            return next
          })
          bytesInFlight.current.delete(removedId)
        }
        const confirmDelete = async () => {
          if (deletePlan === null || deleting) return
          setDeleting(true)
          setDeleteError('')
          const plans = deletePlan.batch === true && Array.isArray(deletePlan.plans) ? deletePlan.plans : [deletePlan]
          let completed = 0
          let failure = ''
          for (const plan of plans) {
            try {
              const res = await rpcCall('sessions-delete', { planId: plan.planId })
              if (res.ok) {
                completed += 1
                applyDeletedSession(plan.session)
              } else if (failure === '') {
                failure = mapSessionError(translate, res.error || 'unknown')
              }
            } catch (_) {
              if (failure === '') failure = translate('sessions.error.network')
            }
          }
          if (deletePlan.batch === true) {
            setDeletePlan(null)
            setDoneTick((tick) => tick + 1)
            if (failure === '') {
              setBatchResult(translate('sessions.batch.completed', { action: translate('sessions.action.delete'), count: completed }))
              setBatchError('')
            } else {
              setBatchResult('')
              setBatchError(translate('sessions.batch.failed', { action: translate('sessions.action.delete'), done: completed, total: plans.length, error: failure }))
            }
          } else if (failure === '') {
            setDeletePlan(null)
            setDoneTick((tick) => tick + 1)
          } else {
            // 保持单项确认框与旧行为一致：失败原因仍在模态内可见，用户可取消后重新发起计划。
            setDeleteError(failure)
          }
          setDeleting(false)
        }
        // 删除完成自动刷新一次列表（loadList 已做，doneTick 仅用于复位列表外的状态）
        useEffect(() => { if (doneTick > 0) setDetail(null) }, [doneTick])
        // v0.37（用户点名「返回列表不要回到顶部」）：离开详情回到列表时恢复原滚动位置。
        // effect 在列表重新渲染进 DOM 后运行——此时回写 scrollTop 才不会被详情内容的高度
        // 把值裁掉（连详情内滚到深处的场景也一并纠正）。保存的上下文与当前不一致则放弃。
        useEffect(() => {
          if (detail !== null) return
          const saved = savedListScroll.current
          savedListScroll.current = null
          if (saved === null) return
          if (saved.key !== listScrollKey()) return
          if (saved.container === null || saved.container === undefined) return
          const top = typeof saved.scrollTop === 'number' ? saved.scrollTop : 0
          try {
            if (typeof saved.container.scrollTop === 'number') saved.container.scrollTop = top
          } catch (_) {
            // 容器已脱离文档（面板被关）：忽略——下次打开自然从顶部开始
          }
        }, [detail])

        // v0.37 命中窗口自动定位：窗口落地（centerSeq 或 items.length 变化）后滚动到目标命中
        // 行并闪烁高亮——第一次打开与「上一个/下一个命中」翻跳共用，滚动为 best-effort。
        const jumpCenterSeq = detail !== null && detail.view === 'search' ? detail.centerSeq : null
        const jumpItemsLen = detail !== null && detail.view === 'search' && Array.isArray(detail.items) ? detail.items.length : 0
        useEffect(() => {
          if (jumpCenterSeq === null || typeof jumpCenterSeq !== 'number') return
          return jumpScrollToHit(jumpCenterSeq)
        }, [jumpCenterSeq, jumpItemsLen])

        const computeVisibleItems = () => {
          if (list === null) return []
          if (filter === 'deleted') {
            const items = Array.isArray(list.deleted) ? list.deleted : []
            return items.slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)).map((item) => ({ ...item, _deleted: true, archived: true }))
          }
          // 宿主按 scope 已过滤（archived 只回归档条目、all 全量）；本地只要排序。
          let items = (Array.isArray(list.items) ? list.items : []).slice()
          if (sort === 'createdAsc') items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
          else if (sort === 'title') items.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
          else items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          return items
        }
        const visibleItems = computeVisibleItems()
        const visibleSelectableIds = filter === 'deleted' || search.trim() !== ''
          ? []
          : visibleItems.filter((item) => item._deleted !== true).map((item) => item.id)
        const selectedSet = new Set(selectedIds)
        const selectedItems = visibleItems.filter((item) => selectedSet.has(item.id))
        const batchExportItems = selectedItems.filter((item) => item._deleted !== true)
        const batchArchiveItems = selectedItems.filter((item) => item._deleted !== true && item.live !== true && item.archived !== true)
        const batchDeleteItems = selectedItems.filter((item) => item._deleted !== true && item.live !== true && item.archived === true)
        const allVisibleSelected = visibleSelectableIds.length > 0 && visibleSelectableIds.every((id) => selectedSet.has(id))
        useEffect(() => {
          if (!batchMode) return
          const allowed = new Set(visibleSelectableIds)
          setSelectedIds((current) => {
            const next = current.filter((id) => allowed.has(id))
            return next.length === current.length ? current : next
          })
        }, [list, filter, batchMode])
        const enterBatchMode = () => {
          setBatchMode(true)
          setSelectedIds([])
          setBatchResult('')
          setBatchError('')
        }
        const exitBatchMode = () => {
          setBatchMode(false)
          setSelectedIds([])
          setBatchResult('')
          setBatchError('')
        }
        const toggleSelected = (id) => {
          setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
        }
        const toggleSelectAll = () => {
          if (allVisibleSelected) {
            setSelectedIds([])
          } else {
            setSelectedIds(visibleSelectableIds.slice())
          }
        }
        const runBatchExport = async () => {
          if (batchWorking !== '' || batchExportItems.length === 0) return
          setBatchWorking('export')
          setBatchResult('')
          setBatchError('')
          let completed = 0
          let failure = ''
          for (const item of batchExportItems) {
            const result = await downloadSessionExport(item.id)
            if (result.ok) completed += 1
            else if (failure === '') failure = result.error
          }
          if (failure === '') setBatchResult(translate('sessions.batch.completed', { action: translate('sessions.action.export'), count: completed }))
          else setBatchError(translate('sessions.batch.failed', { action: translate('sessions.action.export'), done: completed, total: batchExportItems.length, error: failure }))
          setBatchWorking('')
        }
        const runBatchArchive = async () => {
          if (batchWorking !== '' || batchArchiveItems.length === 0) return
          setBatchWorking('archive')
          setBatchResult('')
          setBatchError('')
          let completed = 0
          let failure = ''
          const ids = batchArchiveItems.map((item) => item.id)
          const completedIds = []
          for (const id of ids) {
            const result = await archiveSession(id)
            if (result.ok) {
              completed += 1
              completedIds.push(id)
            } else if (failure === '') failure = result.error
          }
          if (completedIds.length > 0) setSelectedIds((current) => current.filter((id) => !completedIds.includes(id)))
          if (failure === '') setBatchResult(translate('sessions.batch.completed', { action: translate('sessions.action.archive'), count: completed }))
          else setBatchError(translate('sessions.batch.failed', { action: translate('sessions.action.archive'), done: completed, total: ids.length, error: failure }))
          setBatchWorking('')
        }
        const requestBatchDelete = async () => {
          if (batchWorking !== '' || deletePlan !== null || batchDeleteItems.length === 0) return
          setBatchWorking('delete-plan')
          setBatchResult('')
          setBatchError('')
          const plans = []
          let failure = ''
          for (const item of batchDeleteItems) {
            try {
              const res = await rpcCall('sessions-delete-plan', { id: item.id })
              if (res.ok) plans.push(res.value)
              else if (failure === '') failure = mapSessionError(translate, res.error || 'unknown')
            } catch (_) {
              if (failure === '') failure = translate('sessions.error.network')
            }
          }
          setBatchWorking('')
          if (failure !== '' || plans.length !== batchDeleteItems.length) {
            setBatchError(translate('sessions.batch.failed', { action: translate('sessions.action.delete'), done: plans.length, total: batchDeleteItems.length, error: failure || translate('sessions.error.network') }))
            return
          }
          setDeletePlan({
            batch: true,
            plans,
            sessions: plans.map((plan) => plan.session),
            consequences: ['deletes-session-log'],
          })
        }

        const listRow = (item) => {
          const isDeleted = item._deleted === true
          const id = item.id
          const title = isDeleted ? (item.title || translate('sessions.row.noTitle')) : (item.title !== '' ? item.title : translate('sessions.row.noTitle'))
          const live = item.live === true
          const archived = isDeleted || item.archived === true
          const selected = selectedSet.has(id)
          // v0.36：体积懒加载——未返回前不占位（无「—」），返回后行内显示。
          const sizeBit = (() => {
            const value = bytesById[id]
            return typeof value === 'number' && value > 0 ? formatBytes(value) : null
          })()
          const metaBits = [
            live ? translate('sessions.row.live') : (archived ? translate('sessions.row.archived') : null),
            isDeleted ? translate('sessions.row.deleted') : null,
            item.cwd ? translate('sessions.detail.cwd', { cwd: item.cwd }) : null,
            isDeleted ? (item.deletedAt ? formatSessionTime(item.deletedAt, translate) : null) : sizeBit,
          ].filter(Boolean)
          const actions = []
          if (!isDeleted) {
            actions.push(React.createElement('button', { key: 'view', type: 'button', 'data-testid': 'sessions-row-view-' + id, style: chipButton, onClick: (event) => openDetail(id, 'events', null, event) }, translate('sessions.action.view')))
            actions.push(React.createElement('button', { key: 'export', type: 'button', 'data-testid': 'sessions-row-export-' + id, style: chipButton, disabled: exportingId === id, onClick: () => void doExport(id) }, exportingId === id ? translate('sessions.detail.exporting') : translate('sessions.action.export')))
            if (!live && !archived) {
              actions.push(React.createElement('button', { key: 'archive', type: 'button', 'data-testid': 'sessions-row-archive-' + id, style: chipButton, disabled: archivingId === id, onClick: () => void doArchive(id) }, archivingId === id ? translate('sessions.status.working') : translate('sessions.action.archive')))
            }
            if (!live && archived) {
              actions.push(React.createElement('button', { key: 'delete', type: 'button', 'data-testid': 'sessions-row-delete-' + id, style: dangerOutlineButton, onClick: () => void requestDelete(id) }, translate('sessions.action.delete')))
            }
          }
          return React.createElement('div', {
            key: id,
            'data-testid': 'sessions-row-' + id,
            'data-selected': batchMode && selected ? 'true' : undefined,
            onClick: batchMode && !isDeleted ? () => toggleSelected(id) : undefined,
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: batchMode ? '9px 2px 9px 8px' : '9px 2px', borderBottom: '1px solid var(--dsh-svc-border)', background: 'transparent', borderRadius: '4px', boxShadow: batchMode && selected ? 'inset 3px 0 0 var(--dsw-alias-brand-primary)' : 'none', cursor: batchMode && !isDeleted ? 'pointer' : 'default' },
          },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0, flex: '1 1 auto' } },
              batchMode && !isDeleted ? React.createElement('input', {
                type: 'checkbox',
                'data-testid': 'sessions-select-' + id,
                'aria-label': translate('sessions.batch.selectRow', { title }),
                checked: selected,
                onClick: (event) => event.stopPropagation(),
                onChange: () => toggleSelected(id),
                style: { width: '16px', height: '16px', flexShrink: 0, accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' },
              }) : null,
              React.createElement('div', { style: { minWidth: 0 } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
                  React.createElement('span', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
                  live ? React.createElement('span', { 'data-testid': 'sessions-tag-live-' + id, style: svcBadgeStyle('success') }, translate('sessions.row.live')) : null,
                  archived ? React.createElement('span', { 'data-testid': 'sessions-tag-archived-' + id, style: svcBadgeStyle('warning') }, translate('sessions.row.archived')) : null,
                  isDeleted ? React.createElement('span', { style: svcBadgeStyle('danger') }, translate('sessions.row.deleted')) : null),
                React.createElement('div', { 'data-testid': 'sessions-meta-' + id, style: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '3px' } }, metaBits.join(' · ')))),
            !batchMode ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' } }, ...actions) : null)
        }

        const eventCard = (event, index) => {
          const noise = event.noise === true
          // v0.36 用户点名：正文用官方 MarkdownText 渲染（与官方聊天观感一致、主题 token 同源、
          // 默认拒原始 HTML/危险链接）；官方 seed 缺席的老外壳自动回落纯文本（pre-wrap）。
          const body = typeof event.text === 'string' && event.text !== ''
            ? React.createElement('div', { 'data-testid': 'sessions-event-text-' + event.seq, style: { marginTop: '4px' } },
                sessionMarkdownText !== null
                  ? React.createElement(sessionMarkdownText, { text: event.text })
                  : React.createElement('div', { style: { fontSize: '12px', lineHeight: 1.55, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, event.text))
            : null
          return React.createElement('div', { key: String(event.seq), 'data-testid': 'sessions-event-' + event.seq, style: { padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: noise ? 'transparent' : 'var(--dsw-alias-bg-layer-3)', marginBottom: '5px' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } },
              React.createElement('span', { 'data-testid': 'sessions-event-type-' + event.seq, style: { fontWeight: 600, color: noise ? 'inherit' : 'var(--dsw-alias-label-secondary)' } }, noise ? translate('sessions.detail.noise') : event.type),
              event.time ? React.createElement('span', null, formatSessionTime(event.time, translate)) : null),
            body)
        }

        const renderListBody = () => {
          if (loading) return React.createElement('p', { style: hint }, translate('sessions.status.loading'))
          if (error !== '') return React.createElement('p', { 'data-testid': 'sessions-error', style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, error)
          if (search.trim() !== '' && filter !== 'deleted') {
            if (searchResult === null) return React.createElement('p', { style: hint }, searchRunning ? translate('sessions.status.loading') : translate('sessions.search.placeholder'))
            if (searchResult.error) return React.createElement('p', { style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, mapSessionError(translate, searchResult.error))
            if (searchResult.hits.length === 0) return React.createElement('p', { style: hint }, translate('sessions.empty.search', { query: search }))
            return searchResult.hits.map((hit) => React.createElement('div', { key: hit.sessionId, 'data-testid': 'sessions-hit-' + hit.sessionId, style: { padding: '9px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-3)', marginBottom: '6px' } },
              React.createElement('button', { type: 'button', 'data-testid': 'sessions-hit-open-' + hit.sessionId, style: { ...chipButton, border: 0, padding: 0, textAlign: 'left', display: 'inline', maxWidth: '100%' }, onClick: (event) => openDetail(hit.sessionId, 'search', hit.items, event) },
                React.createElement('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, hit.title !== '' ? hit.title : translate('sessions.row.noTitle')),
                React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)', marginLeft: '6px', fontSize: '11.5px' } }, translate('sessions.hit.title', { count: hit.items.length }))),
              // v0.37：命中位置直接可见可点——点 seq 芯片直达该命中（不绕一次「打开→翻跳」）。
              hit.items.length > 1 ? React.createElement('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '5px' } },
                hit.items.map((item) => React.createElement('button', { key: item.seq, type: 'button', 'data-testid': 'sessions-hit-seq-' + hit.sessionId + '-' + item.seq, style: { ...chipButton, padding: '1px 8px', fontSize: '11px', borderRadius: '999px', color: 'var(--dsw-alias-label-tertiary)' }, onClick: (event) => openDetail(hit.sessionId, 'search', hit.items, event, Number(item.seq)) }, '#' + item.seq))) : null,
              hit.items.slice(0, 1).map((item, index) => React.createElement('div', { key: index, 'data-testid': 'sessions-hit-snippet-' + hit.sessionId, style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginTop: '5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, highlightSessionSnippet(item.snippet, searchResult.query || search, 'sessions-hit-highlight-' + hit.sessionId)))))
          }
          if (visibleItems.length === 0) {
            const emptyKey = filter === 'archived' ? 'sessions.empty.archived' : filter === 'deleted' ? 'sessions.empty.deleted' : 'sessions.empty.all'
            return React.createElement('p', { style: hint }, translate(emptyKey))
          }
          return visibleItems.map(listRow)
        }

        const renderDetail = () => {
          if (detail === null) return null
          const target = list !== null && Array.isArray(list.items) ? list.items.find((item) => item.id === detail.sessionId) : undefined
          const targetTitle = search !== '' && detail.view === 'search' && searchResult !== null
            ? (searchResult.hits.find((hit) => hit.sessionId === detail.sessionId)?.title || '')
            : (target !== undefined && target.title !== '' ? target.title : '')
          const mineRow = list !== null && Array.isArray(list.items) ? list.items.find((item) => item.id === detail.sessionId) : undefined
          // v0.37 命中导航：seq 芯片 + 上一个/下一个——翻跳只在详情内换窗口中心，不重载整个会话。
          const hitSeqList = detail.view === 'search' && Array.isArray(detail.hitItems)
            ? detail.hitItems.map((item) => Number(item.seq)).filter((seq) => Number.isSafeInteger(seq))
            : []
          const hitIndex = detail.view === 'search' && typeof detail.centerSeq === 'number' ? hitSeqList.indexOf(detail.centerSeq) : -1
          const jumpPrevSeq = hitIndex > 0 ? hitSeqList[hitIndex - 1] : undefined
          const jumpNextSeq = hitIndex >= 0 && hitIndex < hitSeqList.length - 1 ? hitSeqList[hitIndex + 1] : undefined
          const hitSet = new Set(hitSeqList)
          // 详情事件列表渲染（v0.36 噪音折叠 + v0.37 命中高亮共用）：命中行套命中徽章/强调框，
          // 带 sessions-jump-target-<seq> 定位 testid（jumpScrollToHit 按它滚）。
          const renderEventList = (items, matchSet) => collapseEventItems(items).map((item, index) => {
            if (item._noiseBlock === true) {
              const open = noiseOpen[item.firstSeq] === true
              const blockEvents = open && Array.isArray(items)
                ? items.filter((event) => event.noise === true && event.seq >= item.firstSeq && event.seq <= item.lastSeq)
                : []
              return React.createElement('div', { key: 'noise-' + item.firstSeq, 'data-testid': 'sessions-noisewall-' + item.firstSeq, style: { padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', marginBottom: '5px' } },
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-noisewall-toggle-' + item.firstSeq, style: { ...chipButton, border: 0, padding: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px' }, onClick: () => toggleNoiseBlock(item.firstSeq) },
                  translate(open ? 'sessions.glyph.collapse' : 'sessions.glyph.expand') + ' ' + translate(open ? 'sessions.detail.noiseCollapse' : 'sessions.detail.noiseBlock', { count: item.count })),
                open && blockEvents.length > 0 ? React.createElement('div', { style: { marginTop: '6px' } }, blockEvents.map((event) => eventCard(event, index))) : null)
            }
            if (matchSet !== null && matchSet.has(Number(item.seq))) {
              return React.createElement('div', { key: 'jump-' + item.seq, 'data-testid': 'sessions-jump-target-' + item.seq, style: { borderRadius: '8px', border: '1px solid rgba(198,128,0,0.55)', background: 'rgba(198,128,0,0.10)', padding: '6px 8px', marginBottom: '6px' } },
                React.createElement('div', { 'data-testid': 'sessions-jump-badge-' + item.seq, style: { fontSize: '10.5px', fontWeight: 700, color: 'var(--dsw-alias-state-warn-primary)', marginBottom: '3px' } }, translate('sessions.hit.badge')),
                eventCard(item, index))
            }
            return eventCard(item, index)
          })
          return React.createElement('div', { 'data-testid': 'sessions-detail' },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } },
              React.createElement('button', { type: 'button', 'data-testid': 'sessions-detail-back', style: chipButton, onClick: () => setDetail(null) }, translate('sessions.glyph.back') + ' ' + translate('sessions.detail.back')),
              React.createElement('span', { style: { fontSize: '14px', fontWeight: 700, color: 'var(--dsw-alias-label-primary)', minWidth: 0 } }, targetTitle !== '' ? targetTitle : translate('sessions.row.noTitle')),
              !mineRow?.archived ? React.createElement('button', { type: 'button', 'data-testid': 'sessions-detail-open', style: chipButton, onClick: () => { try { ctx.sessions?.open?.(detail.sessionId) } catch (_) {} } }, translate('sessions.detail.open')) : React.createElement('span', { title: translate('sessions.detail.archiveDisabled'), style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('sessions.detail.archiveDisabled')),
              React.createElement('button', { type: 'button', 'data-testid': 'sessions-detail-export', style: chipButton, disabled: exportingId === detail.sessionId, onClick: () => void doExport(detail.sessionId) }, exportingId === detail.sessionId ? translate('sessions.detail.exporting') : translate('sessions.detail.exportAll'))),
            detail.view === 'search' && detail.hitItems !== null ? React.createElement('div', { 'data-testid': 'sessions-jump-view', style: { marginBottom: '10px' } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' } },
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-detail-return-search', style: chipButton, onClick: () => setDetail(null) }, translate('sessions.glyph.back') + ' ' + translate('sessions.hit.return')),
                React.createElement('span', { style: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('sessions.hit.inSession', { count: Array.isArray(detail.hitItems) ? detail.hitItems.length : 0 })),
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-jump-prev', style: chipButton, disabled: jumpPrevSeq === undefined || detailLoading, onClick: () => { if (jumpPrevSeq !== undefined) void loadJumpWindow(detail.sessionId, jumpPrevSeq) } }, translate('sessions.hit.prev')),
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-jump-next', style: chipButton, disabled: jumpNextSeq === undefined || detailLoading, onClick: () => { if (jumpNextSeq !== undefined) void loadJumpWindow(detail.sessionId, jumpNextSeq) } }, translate('sessions.hit.next'))),
              React.createElement('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' } },
                hitSeqList.map((seq) => React.createElement('button', { key: seq, type: 'button', 'data-testid': 'sessions-jump-chip-' + seq, style: { ...chipButton, padding: '1px 8px', fontSize: '11px', borderRadius: '999px', background: seq === detail.centerSeq ? 'var(--dsh-svc-tab-active-bg)' : 'transparent', color: seq === detail.centerSeq ? 'var(--dsh-svc-tab-active-text)' : 'var(--dsw-alias-label-secondary)' }, onClick: () => void loadJumpWindow(detail.sessionId, seq) }, '#' + seq))),
              detailLoading && detail.items.length === 0 ? React.createElement('p', { style: hint }, translate('sessions.status.loading')) : null,
              renderEventList(detail.items, hitSet),
              detail.cursor !== undefined && detail.items.length > 0 ? React.createElement('button', { type: 'button', 'data-testid': 'sessions-detail-more', style: chipButton, disabled: detailLoading, onClick: () => void loadDetailPage(detail.sessionId, detail.cursor, detail.view) }, translate('sessions.detail.loadMore', { remaining: Math.max(0, detail.total - detail.items.length) })) : null,
              detail.cursor === undefined && detail.items.length > 0 ? React.createElement('p', { style: hint }, translate('sessions.detail.noMore', { total: detail.total })) : null) : null,
            detailError !== '' ? React.createElement('p', { style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, detailError) : null,
            detail.view !== 'search' ? renderEventList(detail.items, null) : null,
            detail.view !== 'search' && detail.cursor !== undefined ? React.createElement('button', { type: 'button', 'data-testid': 'sessions-detail-more', style: chipButton, disabled: detailLoading, onClick: () => void loadDetailPage(detail.sessionId, detail.cursor, detail.view) }, translate('sessions.detail.loadMore', { remaining: Math.max(0, detail.total - detail.items.length) })) : null,
            detail.view !== 'search' && detail.cursor === undefined && detail.items.length > 0 ? React.createElement('p', { style: hint }, translate('sessions.detail.noMore', { total: detail.total })) : null)
        }

        const renderDeleteModal = () => {
          if (deletePlan === null) return null
          const batchSessions = deletePlan.batch === true && Array.isArray(deletePlan.sessions) ? deletePlan.sessions : null
          const session = batchSessions === null ? (deletePlan.session || {}) : {}
          return React.createElement('div', { 'data-testid': 'sessions-delete-modal', style: { position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' } },
            React.createElement('div', { style: { width: 'min(480px, calc(100vw - 32px))', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '14px', padding: '18px', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' } },
              React.createElement('div', { style: { fontSize: '15px', fontWeight: 700, color: 'var(--dsw-alias-label-primary)', marginBottom: '8px' } }, batchSessions === null ? translate('sessions.delete.title') : translate('sessions.batch.deleteTitle', { count: batchSessions.length })),
              React.createElement('p', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5, margin: '0 0 10px' } }, batchSessions === null ? translate('sessions.delete.body') : translate('sessions.batch.deleteBody')),
              batchSessions === null
                ? React.createElement('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: '6px' } }, session.title || translate('sessions.row.noTitle'))
                : React.createElement('ul', { 'data-testid': 'sessions-batch-delete-list', style: { margin: '0 0 12px', paddingLeft: '18px', maxHeight: '220px', overflowY: 'auto', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.7 } },
                    batchSessions.map((item) => React.createElement('li', { key: item.id }, translate('sessions.batch.deleteItem', { title: item.title || translate('sessions.row.noTitle'), bytes: formatBytes(item.bytes) })))),
              batchSessions === null ? React.createElement('ul', { style: { margin: '0 0 12px', paddingLeft: '18px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.7 } },
                React.createElement('li', null, translate('sessions.delete.consequence.log', { bytes: formatBytes(session.bytes) })),
                deletePlan.consequences && deletePlan.consequences.includes('hides-from-official-sidebar') ? React.createElement('li', null, translate('sessions.delete.consequence.sidebar')) : null) : null,
              deleteError !== '' ? React.createElement('p', { style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, deleteError) : null,
              React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-delete-cancel', style: chipButton, disabled: deleting, onClick: () => { setDeletePlan(null); setDeleteError('') } }, translate('sessions.delete.cancel')),
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-delete-confirm', style: dangerSolidButton, disabled: deleting, onClick: () => void confirmDelete() }, deleting ? translate('sessions.status.working') : translate('sessions.delete.confirm')))))
        }

        return React.createElement('div', null,
          React.createElement('div', { style: sectionTitle }, translate('sessions.title')),
          React.createElement('p', { style: hint }, translate('sessions.hint')),
          // v0.35 用户点名：设置页左列入口开关放在面板靠上、筛选标签之前。
          // v0.39 统一：与重启/额度同款胶囊开关（此前是复选框，与其他入口开关不一致）。
          React.createElement('div', { 'data-testid': 'sessions-nav-toggle', style: { margin: '2px 0 8px' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                React.createElement('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } }, translate('sessions.navToggle')),
                React.createElement('span', { style: hint }, translate('sessions.navToggleHint'))),
              React.createElement('button', {
                type: 'button',
                role: 'switch',
                'data-testid': 'sessions-nav-switch',
                'aria-checked': String(navEnabled),
                onClick: () => setNavEnabled(!navEnabled),
                style: { width: '34px', height: '20px', borderRadius: '10px', padding: 0, flexShrink: 0, position: 'relative', border: `1px solid ${navEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'}`, background: navEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: 'pointer', lineHeight: 0 },
              }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: navEnabled ? '15px' : '1px', width: '16px', height: '16px', borderRadius: '50%', background: navEnabled ? '#fff' : 'var(--dsw-alias-label-tertiary)' } })))),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '0 0 10px' } },
            (['all', 'archived', 'deleted']).map((key) => React.createElement('button', { key, type: 'button', 'data-testid': 'sessions-filter-' + key, style: { ...chipButton, background: filter === key ? 'var(--dsh-svc-tab-active-bg)' : 'transparent', color: filter === key ? 'var(--dsh-svc-tab-active-text)' : 'var(--dsw-alias-label-primary)', fontWeight: filter === key ? 650 : 400 }, onClick: () => changeFilter(key) }, translate('sessions.filter.' + key))),
            React.createElement('select', { 'data-testid': 'sessions-sort', style: selectStyle, value: sort, onChange: (event) => setSort(event.target.value) },
              React.createElement('option', { value: 'createdDesc' }, translate('sessions.sort.createdDesc')),
              React.createElement('option', { value: 'createdAsc' }, translate('sessions.sort.createdAsc')),
              React.createElement('option', { value: 'title' }, translate('sessions.sort.title'))),
            // v0.36：切换筛选复用已取过的 scope 缓存；「刷新」才强制重拉当前 scope。
            React.createElement('button', { type: 'button', 'data-testid': 'sessions-refresh', 'data-variant': 'neutral', style: Object.assign({}, svcButtonStyle('neutral'), { minHeight: '28px', padding: '4px 10px', fontSize: '12px' }), onClick: () => refreshList() }, translate('sessions.refresh')),
            detail === null && filter !== 'deleted' && search.trim() === '' ? React.createElement('button', {
              type: 'button',
              'data-testid': 'sessions-batch-toggle',
              'data-variant': batchMode ? 'primary' : 'neutral',
              style: Object.assign({}, svcButtonStyle(batchMode ? 'primary' : 'neutral'), { minHeight: '28px', padding: '4px 10px', fontSize: '12px' }),
              onClick: batchMode ? exitBatchMode : enterBatchMode,
            }, translate(batchMode ? 'sessions.batch.exit' : 'sessions.batch.enter')) : null),
          detail === null && batchMode ? React.createElement('div', { 'data-testid': 'sessions-batch-bar', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '0 0 10px', padding: '8px 10px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-3)' } },
            React.createElement('button', { type: 'button', 'data-testid': 'sessions-select-all', style: chipButton, disabled: visibleSelectableIds.length === 0 || batchWorking !== '' || deleting, onClick: toggleSelectAll }, translate(allVisibleSelected ? 'sessions.batch.clearAll' : 'sessions.batch.selectAll')),
            React.createElement('span', { 'data-testid': 'sessions-selected-count', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginRight: 'auto' } }, translate('sessions.batch.selected', { count: selectedIds.length })),
            React.createElement('button', { type: 'button', 'data-testid': 'sessions-batch-export', style: chipButton, disabled: batchExportItems.length === 0 || batchWorking !== '' || deleting, onClick: () => void runBatchExport() }, batchWorking === 'export' ? translate('sessions.status.working') : translate('sessions.batch.export', { count: batchExportItems.length })),
            React.createElement('button', { type: 'button', 'data-testid': 'sessions-batch-archive', style: chipButton, disabled: batchArchiveItems.length === 0 || batchWorking !== '' || deleting, onClick: () => void runBatchArchive() }, batchWorking === 'archive' ? translate('sessions.status.working') : translate('sessions.batch.archive', { count: batchArchiveItems.length })),
            React.createElement('button', { type: 'button', 'data-testid': 'sessions-batch-delete', style: dangerOutlineButton, disabled: batchDeleteItems.length === 0 || batchWorking !== '' || deleting, onClick: () => void requestBatchDelete() }, batchWorking === 'delete-plan' ? translate('sessions.status.working') : translate('sessions.batch.delete', { count: batchDeleteItems.length }))) : null,
          detail === null && filter !== 'deleted' ? React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' } },
            React.createElement('input', { 'data-testid': 'sessions-search-input', type: 'text', placeholder: translate('sessions.search.placeholder'), value: search, onChange: (event) => { if (batchMode) exitBatchMode(); setSearch(event.target.value) }, style: inputStyle }),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } },
              React.createElement('input', { type: 'checkbox', 'data-testid': 'sessions-search-archived', checked: searchScopeArchived, onChange: (event) => setSearchScopeArchived(event.target.checked) }),
              translate('sessions.search.archivedOnly'))) : null,
          archiveError !== '' ? React.createElement('p', { style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, archiveError + ' · ' + translate('sessions.oneWayHint')) : null,
          exportError !== '' ? React.createElement('p', { style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, exportError) : null,
          batchResult !== '' ? React.createElement('p', { 'data-testid': 'sessions-batch-result', style: { ...hint, color: 'var(--dsw-alias-state-success-primary)' } }, batchResult) : null,
          batchError !== '' ? React.createElement('p', { 'data-testid': 'sessions-batch-error', style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, batchError) : null,
          renderDetail() ?? renderListBody(),
          renderDeleteModal())
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
        // v0.39 卡片分区（确认规格：身份 → 核心余额 → 最紧窗口 → 重置 → 折叠高级配置）。
        // 高级配置（凭据入口/类型切换/手动重置录入）按卡折叠，一次只开一张。
        const [advancedOpen, setAdvancedOpen] = useState(null)
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
            const res = await rpcCall('quota-credential-set', { provider: providerName, name: credDraft.name, value: credDraft.value })
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
            const res = await rpcCall('quota-credential-unset', { provider: providerName, name })
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
            const res = await rpcCall('quota-reset-card', payload)
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
            await rpcCall('quota-reset-card', { provider: providerName, remove: true, id: cardId })
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
            const res = await rpcCall('quota-refresh', { provider: providerName })
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
            const res = await rpcCall('quota-config', payload)
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
                  style: { fontSize: '12px', lineHeight: '20px', padding: '2px 12px', borderRadius: 999, border: `1px solid ${reorderMode ? 'var(--dsw-alias-brand-primary)' : 'var(--dsh-svc-border-strong)'}`, background: 'transparent', color: reorderMode ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
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
                          style: svcBadgeStyle('neutral', { marginLeft: '6px', verticalAlign: 'middle' }),
                        }, translate('quota.kindAuto'))
                      : null)
                  const windows = Array.isArray(row.windows) ? row.windows : []
                  const isAdvanced = advancedOpen === row.provider
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
                  return React.createElement('div', { key: row.provider, 'data-testid': `quota-provider-card-${row.provider}`, style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsh-svc-card-bg)' } },
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
                    // 高级配置折叠钮（凭据/类型切换/手录重置都收进折叠区）。
                    React.createElement('div', { key: 'advanced-toggle-row', style: { display: 'flex', marginTop: '2px' } },
                      React.createElement('button', {
                        type: 'button',
                        'data-testid': `quota-advanced-toggle-${row.provider}`,
                        'aria-expanded': String(isAdvanced),
                        onClick: () => setAdvancedOpen(isAdvanced ? null : row.provider),
                        style: { fontSize: '11px', lineHeight: '20px', padding: '2px 10px', borderRadius: 999, border: '1px solid var(--dsh-svc-border-strong)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
                      }, `${isAdvanced ? '▾' : '▸'} ${translate('quota.advanced')}`)),
                    ...(isAdvanced && row.status === 'unconfigured' && Array.isArray(row.credentialHints) && row.credentialHints.length > 0
                      ? (() => {
                          const editingCred = credEditor !== null && credEditor.provider === row.provider
                          const hints = row.credentialHints
                          const selectedName = hints.some((hint) => hint.name === credDraft.name) ? credDraft.name : (hints[0]?.name ?? '')
                          const selectedHint = hints.find((hint) => hint.name === selectedName)
                          return [editingCred
                            ? React.createElement('div', { key: 'cred-editor', 'data-testid': `quota-cred-editor-${row.provider}`, style: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsh-svc-raised-bg)' } },
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
                                React.createElement('button', { type: 'button', 'data-testid': 'quota-cred-save', onClick: () => saveCredential(row.provider), disabled: credDraft.value.trim() === '', style: { minHeight: '28px', padding: '4px 12px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsw-alias-brand-primary)', background: credDraft.value.trim() === '' ? 'transparent' : 'var(--dsw-alias-brand-primary)', color: credDraft.value.trim() === '' ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsh-svc-brand-text)', cursor: credDraft.value.trim() === '' ? 'default' : 'pointer', fontSize: '12px' } }, translate('quota.credential.save')),
                                ...(selectedHint?.configured === true && selectedHint?.writable !== false ? [React.createElement('button', { type: 'button', key: 'cred-clear', 'data-testid': 'quota-cred-clear', title: credClearArmed ? translate('quota.credential.clearConfirm') : undefined, onClick: () => { if (!credClearArmed) { setCredClearArmed(true); return } setCredClearArmed(false); void clearCredential(row.provider, selectedName) }, style: { minHeight: '28px', padding: '4px 12px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsw-alias-state-error-primary)', background: credClearArmed ? 'var(--dsw-alias-state-error-primary)' : 'transparent', color: credClearArmed ? 'var(--dsh-svc-brand-text)' : 'var(--dsw-alias-state-error-primary)', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' } }, translate(credClearArmed ? 'quota.credential.clearConfirm' : 'quota.credential.clear'))] : []),
                                React.createElement('button', { type: 'button', 'data-testid': 'quota-cred-cancel', onClick: closeCredEditor, style: svcRowActionStyle() }, translate('quota.resetCard.cancel')),
                              )
                            : React.createElement('div', { key: 'cred-entry', style: { display: 'flex' } },
                                React.createElement('button', {
                                  type: 'button',
                                  'data-testid': `quota-cred-edit-${row.provider}`,
                                  onClick: () => openCredEditor(row),
                                  style: { fontSize: '12px', lineHeight: '20px', padding: '4px 14px', borderRadius: 999, border: '1px solid var(--dsw-alias-brand-primary)', background: 'transparent', color: 'var(--dsw-alias-brand-primary)', cursor: 'pointer', width: 'auto', minWidth: 0, overflow: 'visible', flex: '0 0 auto', whiteSpace: 'nowrap' },
                                // 宿主按 kind registry 下发凭据入口语义键；客户端只本地化，避免新增 kind 时复制分支。
                                }, translate(`quota.credential.${typeof row.credentialEntryKey === 'string' && row.credentialEntryKey !== '' ? row.credentialEntryKey : 'edit'}`)))]
                        })()
                      : []),
                    ...resetCardNodes,
                    ...(isAdvanced && editingThis ? [React.createElement('div', { key: 'reset-editor', 'data-testid': `quota-reset-editor-${row.provider}`, style: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsh-svc-raised-bg)' } },
                      resetField(translate('quota.resetCard.dateLabel'), 'quota-reset-input-date', 'datetime-local', 'expiresAt'),
                      resetField(translate('quota.resetCard.nameLabel'), 'quota-reset-input-name', 'text', 'label'),
                      React.createElement('button', { type: 'button', 'data-testid': 'quota-reset-card-save', onClick: saveResetCard, style: { minHeight: '28px', padding: '4px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsh-svc-brand-text)', cursor: 'pointer', fontSize: '12px' } }, translate('quota.resetCard.add')),
                      React.createElement('button', { type: 'button', 'data-testid': 'quota-reset-cancel', onClick: () => setCardEditor(null), style: svcRowActionStyle() }, translate('quota.resetCard.cancel')),
                    )] : []),
                    // 卡片脚部（高级配置区）：类型下拉（当前选中 / 跟随自动识别 / 停用查询）+ 重置卡录入入口。
                    ...(isAdvanced ? [
                      React.createElement('div', { key: 'advanced-footer', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
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
                        style: { fontSize: '12px', lineHeight: '20px', padding: '4px 14px', borderRadius: 999, border: '1px solid var(--dsh-svc-border-strong)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', width: 'auto', minWidth: 0, overflow: 'visible', flex: '0 0 auto', whiteSpace: 'nowrap' },
                      }, translate('quota.resetCard.edit')))] : []),
                    ] : []))
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
              style: { fontSize: '12px', padding: '3px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-brand-primary)', background: addProvider === '' || addKind === '' ? 'transparent' : 'var(--dsw-alias-brand-primary)', color: addProvider === '' || addKind === '' ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsh-svc-brand-text)', cursor: addProvider === '' || addKind === '' ? 'default' : 'pointer' },
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
        // v0.39：权限与修复默认折叠（确认规格：汇总 → 两行检查清单 → 折叠权限/深检/修复区）。
        const [permissionOpen, setPermissionOpen] = useState(false)
        const [permissionDeep, setPermissionDeep] = useState(null)
        const [permissionDeepBusy, setPermissionDeepBusy] = useState(false)
        const [backups, setBackups] = useState({ items: [], totalBytes: 0 })
        const [backupBusy, setBackupBusy] = useState(false)
        const [backupProgress, setBackupProgress] = useState(null)
        // v0.45.1 单调守卫：总进度只进不退（重试/异常快照不回退条幅）。
        const backupProgressPercentRef = useRef(0)
        const [backupError, setBackupError] = useState(null)
        const [backupDeleteId, setBackupDeleteId] = useState(null)
        const [backupRestoreId, setBackupRestoreId] = useState(null)
        const [backupRestoreReport, setBackupRestoreReport] = useState(null)
        const [backupRestorePlan, setBackupRestorePlan] = useState(null)
        const [backupManualRestart, setBackupManualRestart] = useState(false)
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
        // 模型列表口径：today=仅今日（默认，v0.31 用户点名）/ week=近 7 天 / all=宿主索引内全部日期累计。
        const [modelScope, setModelScope] = useState('today')
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
          rpcCall('check-update', {}).then((res) => {
            if (!active || !res || res.ok === false) { if (active) setUpdateError(translate('update.unavailable')); return }
            setUpdateInfo(res.value)
            setUpdateError(null)
            setAvailableUpdate(res.value.dsh && !res.value.dsh.upToDate ? res.value.dsh : null)
          }).catch(() => { if (active) setUpdateError(translate('update.unavailable')) })
          return () => { active = false }
        }, [])
        useEffect(() => {
          // 健康诊断开关关闭时权限浅检查属于被门禁功能：不发起请求，也不落错误态。
          if (!featureEnabled('healthDiagnostics')) return () => {}
          let active = true
          rpcCall('permissions-plan', {}).then((res) => {
            if (!active) return
            if (!res || res.ok === false) setPermissionError(translate('permissions.error'))
            else setPermissions(res.value)
          }).catch(() => {
            if (active) setPermissionError(translate('permissions.error'))
          })
          return () => { active = false }
        }, [features.healthDiagnostics])
        useEffect(() => {
          if (!featureEnabled('modelUsage')) return () => {}
          let active = true
          rpcCall('usage', usageRequestPayload).then(async (res) => {
            if (!active) return
            if (!res || res.ok === false) { setUsageError(translate('usage.error')); return }
            setUsage(res.value)
            if (res.value.updatedAt > 0 && Date.now() - res.value.updatedAt <= 300000) return
            try {
              const refreshed = await rpcCall('usage-refresh', usageRequestPayload)
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
          rpcCall('backup-list', {}).then((res) => {
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
              const res = await rpcCall('health', {})
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
          if (!featureEnabled('healthDiagnostics')) return
          if (!force && diagnosticsLoadedAt > 0 && Date.now() - diagnosticsLoadedAt <= 30000) return
          setDiagnosticsBusy(true)
          try {
            const res = await rpcCall('diagnostics', {})
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
            const res = await rpcCall('usage-refresh', usageRequestPayload)
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
            const res = await rpcCall('permissions-deep', { planId: permissions.planId })
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
            const res = await rpcCall('permissions-repair', { planId: permissions.planId })
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
          setBackupProgress(null)
          backupProgressPercentRef.current = 0
          // v0.45 进度轮询：创建期间每 400ms 拉一次 backup-progress；完成/失败即停链并清快照。
          let stopped = false
          let cancelNext = () => {}
          const poll = async () => {
            if (stopped) return
            try {
              const res = await rpcCall('backup-progress', {})
              if (!stopped && res && res.ok) setBackupProgress(res.value?.active === true ? res.value : null)
            } catch (_) {}
            if (!stopped) cancelNext = ctx.timer.timeout(poll, 400)
          }
          poll()
          try {
            const res = await rpcCall('backup-create', {})
            if (!res || res.ok === false) throw Object.assign(new Error('backup failed'), { code: res?.error })
            setBackups({ items: res.value.items, totalBytes: res.value.totalBytes })
          } catch (error) {
            setBackupError(mapBackupRestoreError(error?.code))
          } finally {
            stopped = true
            cancelNext()
            setBackupProgress(null)
            setBackupBusy(false)
          }
        }

        const deleteBackup = async (id) => {
          setBackupBusy(true)
          setBackupError(null)
          try {
            const res = await rpcCall('backup-delete', { id })
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
            const res = await rpcCall('backup-export', { id })
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

        const mapBackupRestoreError = (code) => {
          const key = 'backup.error.' + String(code || '')
          const translated = translate(key)
          return translated === key ? translate('backup.restoreError') : translated
        }

        const prepareBackupRestore = async (id) => {
          setBackupBusy(true)
          setBackupError(null)
          setBackupManualRestart(false)
          setBackupRestoreReport(null)
          setBackupRestorePlan(null)
          setBackupRestoreId(id)
          try {
            const inspected = await rpcCall('backup-inspect', { id })
            if (!inspected || inspected.ok === false) throw Object.assign(new Error('backup inspect failed'), { code: inspected?.error })
            setBackupRestoreReport(inspected.value)
            if (inspected.value.validForRestore !== true) return
            const prepared = await rpcCall('backup-restore-prepare', { id })
            if (!prepared || prepared.ok === false) throw Object.assign(new Error('backup prepare failed'), { code: prepared?.error })
            setBackupRestorePlan(prepared.value)
          } catch (error) {
            setBackupError(mapBackupRestoreError(error?.code))
          } finally {
            setBackupBusy(false)
          }
        }

        const commitBackupRestore = async () => {
          if (!backupRestorePlan || backupBusy) return
          setBackupBusy(true)
          setBackupError(null)
          try {
            const res = await rpcCall('backup-restore-commit', { planId: backupRestorePlan.planId })
            if (!res || res.ok === false) throw Object.assign(new Error('backup restore failed'), { code: res?.error })
            setBackupRestoreId(null)
            setBackupRestoreReport(null)
            setBackupRestorePlan(null)
            if (res.value?.restart?.requiresManualRestart === true) {
              setBackupManualRestart(true)
            } else {
              const previousInstanceId = res.value?.restart?.previousInstanceId || res.value?.previousInstanceId
              if (typeof previousInstanceId === 'string' && previousInstanceId.length > 0) startRecovery(previousInstanceId).catch(() => {})
            }
          } catch (error) {
            setBackupRestorePlan(null)
            setBackupError(mapBackupRestoreError(error?.code))
          } finally {
            setBackupBusy(false)
          }
        }

        const cancelBackupRestore = () => {
          if (backupBusy) return
          setBackupRestoreId(null)
          setBackupRestoreReport(null)
          setBackupRestorePlan(null)
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
               const res = await rpcCall('backup-import', { name: file.name, data: btoa(binary) })
               if (!res || res.ok === false) throw Object.assign(new Error('backup import failed'), { code: res?.error })
               setBackups(res.value)
             } catch (error) {
               setBackupError(error?.code ? mapBackupRestoreError(error.code) : translate('backup.error'))
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
            const res = await rpcCall('upgrade', {})
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

        // 样式（v0.39 收敛：按钮/展示面统一取自工厂级 svcButtonStyle/svcSurfaceStyle，
        // 本地只保留布局类常量；variant 语义见工厂处注释——破坏动作初次=dangerGhost 描边、
        // 最终确认=danger 实底，非破坏主操作=brandGhost 品牌描边）。
        const btn = svcButtonStyle()
        const primary      = svcButtonStyle('primary')
        const secondary    = svcButtonStyle('brandGhost')
        const neutral      = svcButtonStyle('neutral')
        const danger       = svcButtonStyle('danger')
        const dangerGhost  = svcButtonStyle('dangerGhost')
        const ghost        = svcButtonStyle('ghost')
        const toggle = Object.assign({}, btn, { background: 'transparent', color: 'var(--dsw-alias-label-primary)', border: 0, borderTop: '1px solid var(--dsw-alias-border-l1)', borderRadius: 0, padding: '10px 2px', width: '100%', textAlign: 'left', fontWeight: 600 })
        const row = { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }
        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const card = { padding: '4px 0 14px', marginBottom: '12px', color: 'var(--dsw-alias-label-primary)' }
        const displaySurface = svcSurfaceStyle()
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
          style: { padding: '8px 10px', borderRadius: '6px', background: 'var(--dsh-svc-raised-bg)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)' },
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
        const formatTokenValue = (value) => formatCompactCount(value, { invalid: '0' })
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
                // v0.39 头部行统一：图例（输入/输出/缓存）+ 刷新钮收进统计区头部，不再散落图下与列表尾。
                React.createElement('div', { 'data-testid': 'usage-region-header', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' } },
                  React.createElement('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '11px' } },
                    usageSegments.map(([, label, color]) => React.createElement('span', { key: label, style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } },
                      React.createElement('span', { style: { width: '9px', height: '9px', borderRadius: '2px', background: color } }),
                      translate(label)))),
                  React.createElement('button', { type: 'button', 'data-testid': 'usage-refresh', 'data-variant': 'neutral', style: neutral, onClick: refreshUsage, disabled: usageBusy }, translate(usageBusy ? 'usage.refreshing' : 'usage.refresh'))),
                React.createElement('div', { 'data-testid': 'usage-chart', style: { position: 'relative', display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr)', height: '180px', padding: '12px 10px 4px', borderRadius: '8px', background: 'var(--dsh-svc-raised-bg)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
                  React.createElement('div', { 'data-testid': 'usage-y-axis', 'aria-label': translate('usage.axis'), style: { position: 'relative', height: '144px', fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } },
                    chartTicks.map((tick, index) => React.createElement('span', { key: index, style: { position: 'absolute', right: '7px', top: `${index * 25}%`, transform: index === 4 ? 'translateY(-100%)' : 'translateY(-50%)' } }, formatTokenValue(tick)))),
                  React.createElement('div', { 'data-testid': 'usage-plot', style: { position: 'relative', height: '164px' } },
                    React.createElement('div', { style: { position: 'absolute', inset: '0 0 20px', display: 'flex', alignItems: 'end', gap: '8px', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
                      chartTicks.map((_, index) => React.createElement('div', { key: index, 'data-testid': `usage-grid-${index}`, style: { position: 'absolute', left: 0, right: 0, top: `${index * 25}%`, borderTop: '1px solid var(--dsw-alias-border-l1)', pointerEvents: 'none' } })),
                      usageDays.map((day, index) => React.createElement('div', { key: day.key, 'aria-label': translate('usage.barDay', { day: day.label, total: formatTokenValue(chartValues[index]) }), style: { position: 'relative', zIndex: 1, flex: 1, minWidth: 0, alignSelf: 'end' } },
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

                // 可访问的文本图表摘要：视觉上不可见，屏幕阅读器可见（v0.39 确认规格）。
                React.createElement('div', { 'data-testid': 'usage-chart-summary', style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } },
                  translate('usage.chartSummary', { total: formatTokenValue(chartValues.reduce((a, b) => a + b, 0)) })),
                hoveredUsageSegment ? React.createElement('div', { 'data-testid': 'usage-tooltip', style: { position: 'fixed', left: `${hoveredUsageSegment.x + 12}px`, top: `${hoveredUsageSegment.y + 12}px`, zIndex: 1000, pointerEvents: 'none', padding: '7px 9px', borderRadius: '6px', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontSize: '12px', fontWeight: 600, whiteSpace: 'pre-line', textAlign: 'left' } }, `${translate('usage.tooltip.date', { date: hoveredUsageSegment.date })}\n${translate('usage.tooltip.input', { value: Number(hoveredUsageSegment.totals.inputTokens || 0).toLocaleString() })}\n${translate('usage.tooltip.output', { value: Number(hoveredUsageSegment.totals.outputTokens || 0).toLocaleString() })}\n${translate('usage.tooltip.cache', { value: Number((hoveredUsageSegment.totals.cacheReadTokens || 0) + (hoveredUsageSegment.totals.cacheWriteTokens || 0)).toLocaleString() })}`) : null,
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', marginTop: '10px' } },
                  summaryBlock('today', 'usage.today', todayTotals),
                  summaryBlock('seven', 'usage.sevenDays', sevenTotals)),
                React.createElement('div', { 'data-testid': 'usage-model-list', style: { marginTop: '10px', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsh-svc-raised-bg)', border: '1px solid var(--dsw-alias-border-l1)' } },
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
          ...(usage && usage.indexedSessions > 0 ? [] : [React.createElement('div', { key: 'usage-refresh-fallback', style: row }, React.createElement('button', { style: neutral, 'data-variant': 'neutral', onClick: refreshUsage, disabled: usageBusy }, translate(usageBusy ? 'usage.refreshing' : 'usage.refresh')))]))

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
          // v0.39 用户复核：重新诊断按钮移入页面头右侧（SvcPageHeader action 位），此处不再独占一行。
          diagnostics && diagnostics.status !== 'ok'
            ? React.createElement('div', { style: { marginTop: '10px', padding: '9px 11px', borderRadius: '7px', background: diagnostics.status === 'error' ? 'rgba(211,51,51,0.1)' : 'rgba(198,128,0,0.12)', border: '1px solid ' + (diagnostics.status === 'error' ? 'rgba(211,51,51,0.3)' : 'rgba(198,128,0,0.3)') } },
                React.createElement('div', { style: { fontSize: '12px', fontWeight: 700 } }, translate('health.alert.title')),
                React.createElement('div', { style: hint }, translate('health.alert.diagnostics', { status: translate('health.overall.' + diagnostics.status) })))
            : null,
          diagnostics
            ? React.createElement('div', { 'data-testid': 'health-check-list', style: Object.assign({}, displaySurface, { marginTop: '10px', padding: '8px 10px' }) },
                // v0.39 两行检查清单：主行=检查名+状态点，次行=详情；异常行（error/非 advisory warning）
                // 局部淡染强调，正常行低对比。
                diagnostics.checks.map((check, index) => {
                  const abnormal = check.status === 'error' || (check.status === 'warning' && check.advisory !== true)
                  const dotColor = check.status === 'ok' ? 'var(--dsh-svc-success)' : check.status === 'warning' ? 'var(--dsh-svc-warning)' : check.status === 'info' ? 'var(--dsh-svc-info)' : 'var(--dsh-svc-danger)'
                  return React.createElement('div', { key: check.id, style: { display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '9px 10px', borderRadius: '6px', borderTop: index === 0 ? 0 : '1px solid var(--dsh-svc-border)', background: abnormal ? (check.status === 'error' ? 'rgba(211,51,51,0.08)' : 'rgba(198,128,0,0.10)') : 'transparent' } },
                    React.createElement('span', { 'aria-hidden': 'true', style: { flex: 'none', width: '7px', height: '7px', borderRadius: '50%', marginTop: '5px', background: dotColor } }),
                    React.createElement('div', { style: { minWidth: 0, flex: 1 } },
                      React.createElement('div', { style: { fontSize: '12px', fontWeight: abnormal ? 650 : 550, color: 'var(--dsh-svc-text)' } }, translate('health.check.' + check.id)),
                      React.createElement('div', { style: { fontSize: '11px', lineHeight: 1.5, marginTop: '2px', color: check.status === 'ok' ? 'var(--dsh-svc-text-muted)' : abnormal ? (check.status === 'error' ? 'var(--dsh-svc-danger)' : 'var(--dsh-svc-warning)') : 'var(--dsh-svc-text-muted)' } }, diagnosticDetail(check))))
                }))
            : null)
        const permissionAbnormal = permissions && permissions.supported === true
          ? permissions.items.filter((item) => item.writable === false).length
          : 0
        const permissionNeedsRepair = permissionAbnormal > 0 || (permissionDeep && (permissionDeep.ownerIssues > 0 || permissionDeep.directoryModeIssues > 0 || permissionDeep.fileModeIssues > 0 || permissionDeep.unreadable > 0))
        const permissionBlock = permissions && permissions.supported === true
          ? React.createElement('div', { key: 'permissions-section', style: { marginTop: '18px' } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' } },
                React.createElement('div', { style: sectionTitle }, translate('permissions.title')),
                React.createElement('button', {
                  type: 'button',
                  'data-testid': 'permissions-toggle',
                  'aria-expanded': String(permissionOpen),
                  onClick: () => setPermissionOpen((value) => !value),
                  style: { fontSize: '12px', lineHeight: '20px', padding: '2px 12px', borderRadius: 999, border: '1px solid var(--dsh-svc-border-strong)', background: 'transparent', color: permissionAbnormal > 0 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
                }, `${permissionOpen ? '▾' : '▸'} ${translate(permissionOpen ? 'permissions.hide' : 'permissions.show')}${permissionAbnormal > 0 ? ` · ${permissionAbnormal}` : ''}`)),
              permissionOpen
                ? React.createElement('div', { style: Object.assign({}, displaySurface, { marginTop: '4px' }) },
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
                  style: { padding: '9px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsh-svc-raised-bg)', color: 'var(--dsw-alias-label-primary)' },
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
                   ? React.createElement('button', { style: Object.assign({}, dangerGhost, { marginTop: '10px' }), 'data-variant': 'dangerGhost', disabled: permissionBusy, onClick: () => setPermissionConfirm(true) }, translate('permissions.repair'))
                   : null,
              permissionError ? React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)' }) }, permissionError) : null)
              : null)
          : null

        const healthBlock = React.createElement('div', { key: 'health-section', 'data-testid': 'health-card', style: card },
          // v0.39 省空间：页头标题即「健康诊断」，去掉内容区重复区块标题。
          healthSummaryBlock,
          permissionBlock)

        // v0.45 进度显示：一根连续不清零的总进度条，按阶段加权映射——
        // 复制 0–30%（真实字节）、打包 30–70%（已写入归档字节 ÷ 源字节估算）、校验 70–95%（无细分信号，保持段起点）、发布 95–100%。
        // 校验/发布段的 95/100 差值在发布完成瞬间补满，避免打包估算误差导致条回退。
        const BACKUP_PHASE_STEP = { copy: 1, archive: 2, validate: 3, publish: 4 }
        const backupProgressActive = backupBusy && backupProgress?.active === true
        const backupProgressPhase = backupProgressActive ? (backupProgress.phase || 'copy') : 'copy'
        const backupProgressStep = BACKUP_PHASE_STEP[backupProgressPhase] || 1
        const backupProgressPercent = (() => {
          if (!backupProgressActive) return 0
          const total = Number(backupProgress.totalBytes) || 0
          let raw
          if (backupProgressPhase === 'copy') raw = total > 0 ? Math.min(30, Math.floor(backupProgress.copiedBytes / total * 30)) : 0
          else if (backupProgressPhase === 'archive') {
            const ratio = total > 0 ? Math.min(1, Number(backupProgress.archiveBytes) / total) : 0
            raw = Math.min(70, 30 + Math.floor(ratio * 40))
          } else if (backupProgressPhase === 'validate') raw = 70
          else raw = 100
          // 单调守卫：只进不退（重试从 0 重跑或异常快照不回退条幅）。
          const shown = Math.max(backupProgressPercentRef.current, raw)
          backupProgressPercentRef.current = shown
          return shown
        })()
        const backupProgressDetail = !backupProgressActive ? ''
          : backupProgressPhase === 'copy'
            ? `${formatSize(backupProgress.copiedBytes)} / ${formatSize(backupProgress.totalBytes)}`
            : (backupProgress.archiveBytes > 0 ? formatSize(backupProgress.archiveBytes) : '')

        const backupBlock = React.createElement('div', { key: 'backup-section' },
          React.createElement('div', { style: sectionTitle }, translate('backup.title')),
          React.createElement('div', { style: Object.assign({}, displaySurface, { marginTop: '4px' }) },
          React.createElement('p', { style: hint }, translate('backup.description')),
          React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
            React.createElement('button', { style: Object.assign({}, secondary, { flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }), 'data-variant': 'brandGhost', onClick: createBackup, disabled: backupBusy }, translate(backupBusy ? 'backup.creating' : 'backup.create')),
            React.createElement('label', { style: Object.assign({}, neutral, { flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: backupImportBusy ? 'default' : 'pointer' }) },
              translate(backupImportBusy ? 'backup.importing' : 'backup.import'),
              React.createElement('input', { type: 'file', accept: '.tar.gz,application/gzip', disabled: backupImportBusy, onChange: importBackup, style: { display: 'none' } }))),
          backupBusy && backupProgress?.active === true
            ? React.createElement('div', { 'data-testid': 'backup-progress', style: { marginTop: '10px' } },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                  React.createElement('span', null, translate('backup.progress.' + backupProgressPhase, { current: backupProgressStep, total: 4 })),
                  React.createElement('span', null, backupProgressDetail)),
                React.createElement('div', { style: { marginTop: '5px', height: '6px', borderRadius: '999px', background: 'var(--dsh-svc-raised-bg)', border: '1px solid var(--dsw-alias-border-l1)', overflow: 'hidden' } },
                  React.createElement('div', { style: { height: '100%', width: backupProgressPercent + '%', background: 'var(--dsw-alias-brand-primary)', transition: 'width 240ms ease' } })))
            : null,
          React.createElement('p', { style: hint }, translate('backup.total', { size: formatSize(backups.totalBytes) })),
          backupManualRestart ? React.createElement('div', { 'data-testid': 'backup-manual-restart', style: { marginTop: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-state-warn-primary)', background: 'rgba(198,128,0,0.10)' } },
            React.createElement('div', { style: { fontWeight: 650, color: 'var(--dsw-alias-state-warn-primary)' } }, translate('backup.manualRestartTitle')),
            React.createElement('p', { style: Object.assign({}, hint, { margin: '4px 0 0' }) }, translate('backup.manualRestartBody'))) : null,
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
                  // v0.39 轻行：分隔线代替独立卡片底；主行=文件名，次行=体积 · 时间，行尾上下文操作。
                  style: { padding: '9px 2px', borderBottom: '1px solid var(--dsh-svc-border)', color: 'var(--dsw-alias-label-primary)' },
                },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' } },
                  React.createElement('div', null,
                    React.createElement('div', { style: { fontFamily: 'monospace', fontSize: '12px', overflowWrap: 'anywhere' } }, item.name),
                    React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', marginTop: '3px' } }, `${formatSize(item.sizeBytes)} · ${new Date(item.createdAt).toLocaleString()}`)),
                  React.createElement('div', { style: { display: 'flex', gap: '6px', flexShrink: 0 } },
                    backupDeleteId === item.id || backupRestoreId === item.id
                      ? null
                      : React.createElement('button', { style: svcRowActionStyle(), disabled: backupExportBusy || backupBusy, onClick: () => exportBackup(item.id) }, translate(backupExportBusy ? 'backup.exporting' : 'backup.export')),
                    backupDeleteId === item.id || backupRestoreId === item.id
                      ? null
                      : React.createElement('button', { style: svcRowActionStyle(), disabled: backupBusy, onClick: () => prepareBackupRestore(item.id) }, translate(backupBusy && backupRestoreId === item.id ? 'backup.inspecting' : 'backup.restore')),
                    backupDeleteId === item.id || backupRestoreId === item.id
                      ? null
                      : React.createElement('button', { style: Object.assign({}, dangerGhost, { minHeight: '28px', padding: '4px 9px' }), 'data-variant': 'dangerGhost', disabled: backupBusy, onClick: () => setBackupDeleteId(item.id) }, translate('backup.delete')),
                  )),
                backupDeleteId === item.id
                  ? React.createElement('div', { style: { marginTop: '8px' } },
                      React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)', margin: '0 0 6px' }) }, translate('backup.confirmHint')),
                      React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                        React.createElement('button', { style: danger, disabled: backupBusy, onClick: () => deleteBackup(item.id) }, translate('backup.confirm')),
                        React.createElement('button', { style: ghost, disabled: backupBusy, onClick: () => setBackupDeleteId(null) }, translate('backup.cancel'))))
                  : backupRestoreId === item.id
                    ? React.createElement('div', { 'data-testid': 'backup-restore-preflight', style: { marginTop: '8px', padding: '10px', borderRadius: '8px', border: '1px solid var(--dsh-svc-border)', background: 'var(--dsh-svc-raised-bg)' } },
                        backupBusy && backupRestoreReport === null
                          ? React.createElement('p', { style: hint }, translate('backup.inspecting'))
                          : backupRestoreReport !== null
                            ? React.createElement('div', null,
                                React.createElement('div', { style: { fontWeight: 650, color: backupRestoreReport.validForRestore ? 'var(--dsh-svc-success)' : 'var(--dsh-svc-danger)' } }, translate(backupRestoreReport.validForRestore ? 'backup.integrity.ok' : 'backup.integrity.invalid')),
                                React.createElement('p', { style: Object.assign({}, hint, { margin: '4px 0 0' }) }, translate('backup.integrity.summary', {
                                  entries: backupRestoreReport.archive?.entryCount || 0,
                                  size: formatSize(backupRestoreReport.archive?.logicalBytes || 0),
                                  sessions: backupRestoreReport.sections?.sessions?.files || 0,
                                  config: backupRestoreReport.sections?.config?.files?.length || 0,
                                  profiles: backupRestoreReport.sections?.profiles?.count || 0,
                                })),
                                backupRestoreReport.validForRestore !== true
                                  ? React.createElement('ul', { style: Object.assign({}, hint, { margin: '6px 0 0', paddingLeft: '18px', color: 'var(--dsh-svc-danger)' }) }, (backupRestoreReport.issues || []).map((issue, index) => React.createElement('li', { key: index }, mapBackupRestoreError(issue.code))))
                                  : null)
                            : null,
                        backupRestorePlan !== null ? React.createElement('div', { style: { marginTop: '8px' } },
                          React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-warn-primary)', margin: '0 0 6px' }) }, translate('backup.restoreHint')),
                          React.createElement('ul', { style: Object.assign({}, hint, { margin: '0 0 8px', paddingLeft: '18px' }) },
                            React.createElement('li', null, translate('backup.plan.sessions')),
                            React.createElement('li', null, translate('backup.plan.config', { replace: backupRestorePlan.targets?.config?.replace?.length || 0, remove: backupRestorePlan.targets?.config?.remove?.length || 0 })),
                            React.createElement('li', null, translate('backup.plan.profiles', { count: backupRestorePlan.targets?.profiles?.upsert?.length || 0 }))),
                          React.createElement('p', { style: Object.assign({}, hint, { margin: '0 0 8px' }) }, translate('backup.plan.expires', { time: new Date(backupRestorePlan.expiresAt).toLocaleTimeString() })),
                          React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                            React.createElement('button', { style: danger, disabled: backupBusy, onClick: commitBackupRestore }, translate('backup.restoreConfirm')),
                            React.createElement('button', { style: ghost, disabled: backupBusy, onClick: cancelBackupRestore }, translate('backup.cancel'))))
                          : React.createElement('button', { style: ghost, disabled: backupBusy, onClick: cancelBackupRestore }, translate('backup.cancel')))
                    : null)))
            : null))

        // 正式/预览/Alpha 通道信息在版本卡内下拉展开（不弹浮层：弹层会被设置模态盖住）。
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
                    React.createElement('button', { style: dangerGhost, 'data-variant': 'dangerGhost', disabled: upgradeBusy, onClick: upgradePlugin }, translate(upgradeBusy ? 'update.upgrading' : 'update.manualProceed')),
                    React.createElement('button', { style: ghost, disabled: upgradeBusy, onClick: () => setUpgradeManualConfirm(false) }, translate('restart.cancel'))))
              : null,
            upgradeManualPending
              ? React.createElement('div', { 'data-testid': 'upgrade-manual-pending', style: { marginTop: '10px', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--dsw-alias-state-warn-primary)', background: 'var(--dsh-svc-raised-bg)' } },
                  React.createElement('p', { style: { margin: '0 0 4px', color: 'var(--dsw-alias-state-warn-primary)', fontSize: '13px', fontWeight: 650 } }, translate('update.manualRestartTitle')),
                  React.createElement('p', { style: Object.assign({}, hint, { margin: 0 }) }, translate('update.manualRestartBody')))
              : null,
            upgradeError ? React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)', margin: '4px 0 0' }) }, upgradeError) : null))

        // 重启区块复用共享组件（「重启」标签还承载设置页左列入口的显示开关；左侧入口默认关闭）
        const restartBlock = React.createElement(RestartSection, { showNavToggle: true })

        const { enabled: notifyOn, done: notifyDoneOn, input: notifyInputOn, bell: notifyBellOn, setEnabled: setNotifyOn, setDone: setNotifyDoneOn, setInput: setNotifyInputOn, setBell: setNotifyBellOn } = useNotifyState()
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
                      notifyRow('notify-row-input', translate('notification.input'), null, notifyInputOn, setNotifyInputOn, !notifyOn),
                      // 铃铛显隐独立于通知总开关：藏掉只是收起输入框旁的快捷入口（v0.31 用户点名）。
                      notifyRow('notify-row-bell', translate('notification.bellShow'), null, notifyBellOn, setNotifyBellOn, false))))
        // ── 概览状态聚合与六段式布局（v0.39 确认规格）──────────────────────
        // 状态摘要 → 可行动项（仅在存在时）→ 版本/运行时 → 指标格 → 核心操作 → 近期错误。
        // 严重度 error > warning > info > normal：error=RPC/健康/诊断/备份/统计/额度/重启错误；
        // warning=权限异常/非 advisory 诊断警告/额度窗口 ≥80%；info=可更新/运行环境提示/无备份。
        const quotaSnapshot = quotaStore.getSnapshot()
        const quotaCritical = Array.isArray(quotaSnapshot.providers)
          ? quotaSnapshot.providers.some((row) => Array.isArray(row.windows) && row.windows.some((window) => typeof window.percent === 'number' && window.percent >= 80))
          : false
        const updateOutdated = updateInfo !== null && updateInfo !== undefined &&
          ((updateInfo.dsh && updateInfo.dsh.upToDate === false) || (updateInfo.plugin && updateInfo.plugin.upToDate === false))
        const backupLoaded = backups !== null && !backupBusy && !backupError
        const failingChecks = (diagnostics?.checks || []).filter((check) => check.status === 'error' || (check.status === 'warning' && check.advisory !== true && check.id !== 'permissions'))
        const statusItems = []
        if (healthError) statusItems.push({ level: 'error', text: healthError })
        if (usageError) statusItems.push({ level: 'error', text: usageError })
        if (backupError) statusItems.push({ level: 'error', text: backupError })
        if (restartFlowState.error) statusItems.push({ level: 'error', text: String(restartFlowState.error) })
        if (permissionError) statusItems.push({ level: 'error', text: permissionError })
        for (const check of failingChecks) {
          statusItems.push({ level: check.status === 'error' ? 'error' : 'warning', text: translate(`health.check.${check.id}`) + '：' + diagnosticDetail(check) })
        }
        if (permissionAbnormal > 0) statusItems.push({ level: 'warning', text: translate('permissions.summary.warning', { count: permissionAbnormal }) })
        if (quotaCritical) statusItems.push({ level: 'warning', text: translate('overview.quotaCritical') })
        if (updateOutdated) statusItems.push({ level: 'info', text: translate('overview.updateAvailable') })
        if (runtimeEnv !== null && runtimeEnv.manualStartLikely === true) statusItems.push({ level: 'info', text: translate('health.detail.runtime-env.manual') })
        if (backupLoaded && backups.items.length === 0) statusItems.push({ level: 'info', text: translate('overview.backupEmpty') })
        const statusLevel = statusItems.some((item) => item.level === 'error') ? 'error'
          : statusItems.some((item) => item.level === 'warning') ? 'warning'
            : statusItems.some((item) => item.level === 'info') ? 'info' : 'normal'
        const statusText = statusLevel === 'normal'
          ? translate('overview.status.normal')
          : translate(`overview.status.${statusLevel}`, { count: statusItems.length })
        const overviewStatusBlock = React.createElement('div', { 'data-testid': 'overview-status', style: Object.assign({}, displaySurface, { display: 'flex', alignItems: 'center', gap: '10px' }) },
          React.createElement('span', { 'aria-hidden': 'true', style: { flex: 'none', width: '10px', height: '10px', borderRadius: '50%', background: statusLevel === 'normal' ? 'var(--dsh-svc-success)' : statusLevel === 'warning' ? 'var(--dsh-svc-warning)' : statusLevel === 'error' ? 'var(--dsh-svc-danger)' : 'var(--dsh-svc-info)' } }),
          React.createElement('span', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsh-svc-text)' } }, statusText))
        const overviewActionablesBlock = statusItems.length === 0
          ? null
          : React.createElement('div', { 'data-testid': 'overview-actionables', style: Object.assign({}, displaySurface, { marginTop: '10px', padding: '4px 10px' }) },
              statusItems.map((item, index) => React.createElement('div', { key: `${item.level}-${index}`, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 2px', fontSize: '12px', borderTop: index === 0 ? 0 : '1px solid var(--dsh-svc-border)' } },
                React.createElement('span', { 'aria-hidden': 'true', style: { flex: 'none', width: '7px', height: '7px', borderRadius: '50%', background: item.level === 'error' ? 'var(--dsh-svc-danger)' : item.level === 'warning' ? 'var(--dsh-svc-warning)' : 'var(--dsh-svc-info)' } }),
                React.createElement('span', { style: { color: 'var(--dsh-svc-text)' } }, item.text))))
        // 固定核心操作：健康检查 / 额度查询 / 创建备份（导航型快捷入口，非破坏主操作）。
        // v0.39 用户复核：品牌描边（brandGhost）与中性钮区分，直观可辨为按钮。
        // 各按钮随对应功能开关门控；全关时整行不渲染。
        const overviewActions = [
          features.healthDiagnostics !== false ? React.createElement('button', { key: 'health', type: 'button', 'data-testid': 'overview-action-health', 'data-variant': 'brandGhost', style: secondary, onClick: () => { setActiveTab('diagnostics'); runDiagnostics(false) } }, translate('overview.action.health')) : null,
          features.quotaLookup !== false ? React.createElement('button', { key: 'quota', type: 'button', 'data-testid': 'overview-action-quota', 'data-variant': 'brandGhost', style: secondary, onClick: () => setActiveTab('quota') }, translate('tabs.quota')) : null,
          features.backupMaintenance !== false ? React.createElement('button', { key: 'backup', type: 'button', 'data-testid': 'overview-action-backup', 'data-variant': 'brandGhost', style: secondary, onClick: () => { setActiveTab('maintenance'); selectMaintenanceTab('backup') } }, translate('backup.create')) : null,
        ].filter((node) => node !== null)
        const overviewActionsBlock = overviewActions.length === 0
          ? null
          : React.createElement('div', { 'data-testid': 'overview-core-actions', style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '18px' } }, overviewActions)
        // 近期错误只在非空时渲染（模型/工具报错默认折叠）。
        const overviewBlock = React.createElement('div', null,
          overviewStatusBlock,
          overviewActionablesBlock,
          versionBlock,
          containerInfoBlock,
          overviewActionsBlock,
          modelErrors.length > 0 || toolErrors.length > 0 ? overviewErrorsBlock : null)
        const maintenanceBlock = React.createElement('div', { key: 'maintenance-card', 'data-testid': 'maintenance-card', style: card }, backupBlock)
        // advisory 警告（如手动启动环境的黄色提示）只做行内呈现，不点亮标签 ⚠ 与顶部服务控制提醒。
        const diagnosticFailure = diagnostics?.checks?.some((check) => check.status === 'error' || (check.status === 'warning' && check.advisory !== true)) === true
        // 批量进行中在「维护」标签右上角显示进度计数角标（done/total）。
        const { batch: skillsBadgeBatch } = useSkillsBatch()
        // v0.39 六页信息架构：顶层 overview→usage→quota→diagnostics→maintenance→configuration。
        // 通知不再是顶层页：归入 配置→通知（功能关闭时页面保留、置灰标注）。
        const tabWarnings = {
          overview: false,
          usage: Boolean(usageError),
          quota: false,
          diagnostics: Boolean(healthError || permissionError || diagnosticFailure || permissionAbnormal > 0),
          maintenance: Boolean(backupError || restartFlowState.error),
          configuration: false,
        }
        // 维护子页记忆：首次开面板默认「子代理」（用户点名），此后读写 localStorage；
        // 非法/被功能关闭的值按 sessions→skills→subagent→backup→restart 回退到首个可用页。
        // 配置页恒开在 features，无子页记忆（用户点名）。
        const [maintenanceTab, setMaintenanceTab] = useState('subagent')
        const [configTab, setConfigTab] = useState('features')
        useEffect(() => {
          let stored = null
          try { stored = localStorage.getItem('dsh-service-maintenance-tab') } catch (_) {}
          // 无记忆键 = 首次进入：保留「子代理」默认值（不可用时由渲染期 normalize 回退）；
          // 有键但非法/被关 = 回退白名单首项。
          setMaintenanceTab(stored === null ? 'subagent' : normalizeMaintenanceTab(stored, features))
        }, [])
        const selectMaintenanceTab = (id) => {
          setMaintenanceTab(id)
          try { localStorage.setItem('dsh-service-maintenance-tab', id) } catch (_) {}
        }
        const primaryTabs = getVisiblePrimaryTabs(features, tabWarnings)
        const maintenanceTabs = getVisibleMaintenanceTabs(features)
        const warningTabs = primaryTabs.filter((item) => item.warning).map((item) => translate(item.labelKey))
        const visiblePrimaryTab = primaryTabs.some((item) => item.id === activeTab) ? activeTab : 'overview'
        const visibleMaintenanceTab = normalizeMaintenanceTab(maintenanceTab, features)
        const tabContent = visiblePrimaryTab === 'overview'
          ? overviewBlock
          : visiblePrimaryTab === 'usage'
            ? usageBlock
            : visiblePrimaryTab === 'quota'
              ? React.createElement(RemoteQuotaCard, null)
            : visiblePrimaryTab === 'diagnostics'
              ? healthBlock
            : visiblePrimaryTab === 'maintenance'
              ? (visibleMaintenanceTab === null
                  ? React.createElement('div', { 'data-testid': 'maintenance-empty', style: displaySurface }, translate('maintenance.empty'))
                  : visibleMaintenanceTab === 'restart'
                    ? restartBlock
                    : visibleMaintenanceTab === 'backup'
                      ? maintenanceBlock
                      : visibleMaintenanceTab === 'skills'
                        ? React.createElement(SkillsSection, null)
                        : visibleMaintenanceTab === 'subagent'
                          ? React.createElement(SubagentSection, null)
                          : React.createElement(SessionsSection, null))
            : configTab === 'notifications'
              ? React.createElement('div', { 'data-testid': 'config-notifications-page', style: features.taskNotifications === false ? { opacity: 0.55 } : undefined },
                  notificationBlock,
                  ...(features.taskNotifications === false ? [React.createElement('p', { key: 'notify-off-hint', style: Object.assign({}, hint, { marginTop: '8px' }) }, translate('config.notificationsDisabled'))] : []))
              : React.createElement(FeatureGroups, null)
        // v0.39：根节点带 data-dshsvc-root 作用域锚（焦点环/降动效/reduced-motion 都挂在它下）、
        // data-dshsvc-page 记录当前内部页、dshsvc-page 类收 800px 内容宽。导航渲染收敛到
        // SvcTabs 基元（role=tablist/tab + aria-selected）；旧 group/tray/top-tab 结构已移除。
        return React.createElement('div', { 'data-testid': 'service-panel-root', 'data-dshsvc-root': '', 'data-dshsvc-page': visiblePrimaryTab, className: 'dshsvc-page' },
          warningTabs.length > 0 ? React.createElement('div', { role: 'alert', style: { marginBottom: '12px', padding: '11px 13px', borderRadius: '8px', background: 'rgba(198,128,0,0.16)', border: '1px solid rgba(198,128,0,0.48)' } },
            React.createElement('div', { style: { fontSize: '13px', fontWeight: 700 } }, translate('tabs.alert.title')),
            React.createElement('div', { style: Object.assign({}, hint, { marginTop: '3px' }) }, translate('tabs.alert.body', { tabs: warningTabs.join(translate('tabs.alert.join')) }))) : null,
          React.createElement(SvcTabs, {
            items: primaryTabs.map((item) => ({
              id: item.id,
              label: translate(item.labelKey),
              icon: item.id === 'diagnostics' ? 'health' : item.id,
              warning: item.warning,
              badge: item.id === 'maintenance' && skillsBadgeBatch !== null && skillsBadgeBatch.phase === 'running'
                ? { testid: 'skills-tab-badge', text: skillsBadgeBatch.done + '/' + skillsBadgeBatch.total }
                : null,
            })),
            activeId: visiblePrimaryTab,
            onChange: (id) => { setActiveTab(id); if (id === 'diagnostics') runDiagnostics(false) },
            testIdPrefix: 'service-tab',
            dotLabel: translate('tabs.alert.dot'),
            ariaLabel: translate('nav.label'),
          }),
          // v0.39 页面头部：标题随当前页切换（标签词条复用），描述见 PAGE_DESCRIPTIONS；
          // 诊断页的「重新诊断」按钮驻留头部右缘（用户复核点名），内容区不再独占一行。
          React.createElement(SvcPageHeader, {
            title: translate(PRIMARY_TAB_LABELS[visiblePrimaryTab]),
            description: PAGE_DESCRIPTIONS[visiblePrimaryTab] !== undefined ? translate(PAGE_DESCRIPTIONS[visiblePrimaryTab]) : null,
            action: visiblePrimaryTab === 'diagnostics'
              ? React.createElement('button', { type: 'button', 'data-testid': 'diagnostics-recheck', 'data-variant': 'neutral', style: neutral, onClick: () => runDiagnostics(true), disabled: diagnosticsBusy }, translate(diagnosticsBusy ? 'health.checking' : diagnostics ? 'health.recheck' : 'health.check'))
              : null,
          }),
          visiblePrimaryTab === 'maintenance' && maintenanceTabs.length > 0
            ? React.createElement(SvcTabs, {
                items: maintenanceTabs.map((item) => ({ id: item.id, label: translate(item.labelKey) })),
                activeId: visibleMaintenanceTab,
                onChange: selectMaintenanceTab,
                testIdPrefix: 'maintenance-tab',
                variant: 'sub',
                ariaLabel: translate('tabs.maintenance'),
              })
            : null,
          visiblePrimaryTab === 'configuration'
            ? React.createElement(SvcTabs, {
                items: CONFIG_TABS.map((item) => ({ id: item.id, label: translate(item.labelKey) })),
                activeId: configTab,
                onChange: setConfigTab,
                testIdPrefix: 'config-tab',
                variant: 'sub',
                ariaLabel: translate('tabs.configuration'),
              })
            : null,
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
          // 铃铛显隐开关关闭时整条注销（v0.31 用户点名），通知行为不受影响。
          if (!featureEnabled('taskNotifications') || !notifyBellVisible) return
          dispose = ctx.slots.register(
            { name: 'conversation.input.left', id: 'dsh-service-notify', order: 90, label: () => t('notification.bellOn') },
            () => React.createElement(InlineNotifyBell, null),
          )
        }
        sync()
        const unsubscribe = featureScope.subscribe(sync)
        const unsubscribeBell = subscribeBellVisible(sync)
        return () => { unsubscribe(); unsubscribeBell(); if (dispose !== null) dispose() }
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
        // 左列「重启」「额度查询」「会话管理」入口由各自页内的开关控制，默认不注册
        restartNavToggle.sync()
        quotaNavToggle.sync()
        sessionsNavToggle.sync()
        const unsubscribeFeatures = featureScope.subscribe(quotaNavToggle.sync)
        const unsubscribeFeaturesSessions = featureScope.subscribe(sessionsNavToggle.sync)
        return () => {
          unsubscribeFeatures()
          unsubscribeFeaturesSessions()
          disposePanel()
          restartNavToggle.disposeEntry()
          quotaNavToggle.disposeEntry()
          sessionsNavToggle.disposeEntry()
        }
      })
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-service-restart', order: 100, label: () => t('overlay.label') },
        () => React.createElement(RestartOverlay, null),
      ))

      // 额度查询圆环：跟随当前会话所选模型的供应商。modelDirectories 是可选服务
      // （老版本 DSH 没有）。槽位条目无条件注册，服务在条目渲染时（inject(sessionId)）
      // 经 ctx.get 惰性解析——此时会话已渲染、model-selection 必然已挂载，不受注入时序影响。
      // 真实渲染器按 (entry,binding) 缓存注入产物（v1.1.2 教训）：目录未热身时 inject
      // 只带 sessionId，QuotaRing 组件内按 ctx.timer 退避重试自愈，不能指望重渲染重算 inject；
      // 老版本 DSH 无该服务时 props 同样只带 sessionId，重试永远落空即静默，其他功能零影响。
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
                if (models === undefined || typeof models.directoryFor !== 'function') return { sessionId }
                const directory = models.directoryFor(sessionId)
                return {
                  sessionId,
                  directoryStore: directory.store,
                  loadDirectory: () => {
                    try {
                      const pending = directory.load()
                      if (pending && typeof pending.catch === 'function') pending.catch(() => {})
                    } catch (_) {}
                  },
                }
              } catch (_) {
                // 渲染器按 (entry,binding) 缓存注入产物：这里绝不能返回空对象——
                // 带上 sessionId 让 QuotaRing 组件内退避重试自愈（刷新/首进旧会话时
                // 会话作用域可能尚未热身，directoryFor 会暂时抛错）。
                return { sessionId }
              }
            },
          }, (props) => React.createElement(QuotaRing, props))
        }
        sync()
        const unsubscribe = featureScope.subscribe(sync)
        return () => { unsubscribe(); if (dispose !== null) dispose() }
      })

      // ─── v1.2 子代理模型可见性：对话页回合尾模型行 ─────────────────────────
      // chain 槽（conversation.chat.turnTail）priority 0：selector 只在官方 turn-process
      // 数据声明 subagentCount>0 时认领，无子代理回合零开销；better-sidebar 的 produced-files
      // 行（priority -1）同回合先到先得，模型行让位不冲突。条目随 subagentRoute 开关热注销。
      ctx.slots.inject('conversation.chat.turnTail', () => {
        let dispose = null
        const sync = () => {
          if (dispose !== null) { dispose(); dispose = null }
          if (!featureEnabled('subagentRoute')) return
          dispose = ctx.slots.register(
            { name: 'conversation.chat.turnTail', id: 'dsh-service-subagent-models', select: selectSubagentModelsTurnTail },
            (props) => React.createElement(SubagentModelsTurnTail, props),
          )
        }
        sync()
        const unsubscribe = featureScope.subscribe(sync)
        return () => { unsubscribe(); if (dispose !== null) dispose() }
      })

      // 会话级累计行（composer 下方）：与回合尾行同 feature 门控；不依赖回合数据，
      // compaction 折叠导致回合尾行缺席时兜底可见。顺序后置（order 60）不打扰官方内容。
      ctx.slots.inject('conversation.composer.dock', () => {
        let dispose = null
        const sync = () => {
          if (dispose !== null) { dispose(); dispose = null }
          // 双门控：v1.2 独立开关（子代理页可关）+ 路由功能总门。
          if (!featureEnabled('subagentRoute') || !featureEnabled('subagentModelsDock')) return
          dispose = ctx.slots.register({
            name: 'conversation.composer.dock',
            id: 'dsh-service-subagent-models-dock',
            order: 60,
            label: () => t('subagent.turnTail.label'),
            inject: (sessionId) => ({ sessionId }),
          }, (props) => React.createElement(SubagentModelsDock, props))
        }
        sync()
        const unsubscribe = featureScope.subscribe(sync)
        return () => { unsubscribe(); if (dispose !== null) dispose() }
      })

      // ─── 移动端适配引擎（v0.30）─────────────────────────────────────────
      // 断点与官方外壳一致取 <1024px（AppFrame 的 SIDEBAR_AUTO_COLLAPSE）。
      // 全部规则作用域于 html[data-dshsvc-mobile] 属性下；抽屉开合走官方
      // ctx.layout 服务，不重挂宿主 DOM。桌面 ≥1024px 或功能关闭时零效果。
      const MOBILE_ACTIVE_QUERY = '(max-width: 1023px)'
      const MOBILE_DEBUG_PARAM = 'dshsvc-mobile-debug'
      // —— 滑动沉浸（v0.36）：方向手势藏「会话头部 + composer 座」，把手/上滑/到底回显。
      // 全部走官方属性钩子（[data-conversation-scroll]、[data-composer-seat]、[data-phase]），
      // 不依赖类哈希，外壳升级零漂移。
      const IMMERSIVE_HIDE_PX = 64        // 累计下滑越过此值 → 隐藏（位移按手势窗口内连续累加）
      const IMMERSIVE_SHOW_PX = 24        // 上滑回显阈值：更小的迟滞带，避免阅读翻页闪烁
      const IMMERSIVE_BOTTOM_PX = 80      // 距底小于此值且是用户手势 → 强制回显
      const IMMERSIVE_DELTA_CAP_PX = 200  // 单事件位移上限：scrollTo 跳变不算手势
      const IMMERSIVE_ACC_CLAMP_PX = 240  // 累加器饱和界：防止极端长滑程数值无意义膨胀
      const IMMERSIVE_MIN_SCROLLABLE_PX = 24
      const GESTURE_WINDOW_MS = 800       // touchstart/move/wheel 后的有效窗口；窗口外一律视为程序化滚动
      const MOBILE_CSS = `
/* 侧栏/详情列改 absolute 后会退出 grid 排版流，中列会被自动放置进第 1 轨
   （0px）而整屏变黑 —— 三列必须用 grid-column 显式钉位，绝不依赖子元素顺序。 */
html[data-dshsvc-mobile] [data-dshsvc-frame] { grid-template-columns: 0px minmax(0, 1fr) 0px !important; }
html[data-dshsvc-mobile] [data-dshsvc-sidebar] { grid-column: 1 !important; grid-row: 1 !important; }
html[data-dshsvc-mobile] [data-dshsvc-center] { grid-column: 2 !important; grid-row: 1 !important; }
html[data-dshsvc-mobile] [data-dshsvc-details] { grid-column: 3 !important; grid-row: 1 !important; }
/* 侧栏/详情列 → overlay 抽屉。两条铁律：
   ① 隐藏禁用 transform —— 设置模态（未 portal）长在本列子树里，
      transform 会成为其 fixed 定位的包含块；
   ② 离屏偏移必须用 vw 长度而非百分比 —— 这些列带显式 grid-column 钉位
      （修中列黑屏所需），绝对定位子项的包含块会变成那格 grid area（0px 宽），
      百分比对 0 取值全变 0，元素被超约束解算推回屏内盖住会话。 */
html[data-dshsvc-mobile] [data-dshsvc-sidebar] {
  position: absolute !important;
  top: 0 !important;
  bottom: 0 !important;
  left: calc(-100vw - 24px) !important;
  /* 外壳 sidebar slot 的原生展开内容固定 280px；外层也必须同宽，否则右侧
     会露出一条只有 sidebarCol 背景、没有内容的空带。窄于 280px 时按视口裁切。 */
  width: min(100vw, 280px) !important;
  border-right: none !important;
  z-index: 32;
  transition: left var(--ds-transition-duration-slow, .25s) var(--ds-ease-in-out, ease);
}
html[data-dshsvc-mobile] [data-dshsvc-frame]:not([data-sidebar-collapsed]) [data-dshsvc-sidebar] {
  left: 0 !important;
  box-shadow: 8px 0 32px rgba(0, 0, 0, .22);
}
/* 详情列（预览/文件树）→ 移动端永久离屏。官方 computeColumns 在窄视口恒为
   0 宽（原生手机本就不显示该列），抽屉化只会用空态盖住会话且关闭路径
   与 backdrop/抽屉状态纠缠（真机反馈）。引擎在激活与属性观察时会自愈式
   closeDetails()，保证 store 也是干净的关闭态。 */
html[data-dshsvc-mobile] [data-dshsvc-details] {
  position: absolute !important;
  top: 0 !important;
  bottom: 0 !important;
  right: calc(-100vw - 24px) !important;
  width: min(92vw, 420px) !important;
  z-index: 30;
}
/* 模态 → 全屏面板：外壳 portal 根是 fixed inset:0 flex 容器（无 transform，
   无 containing-block 陷阱），dialog 改 absolute 四边拉满即可。
   真机反馈：底部 sheet 顶部留空难看 → 顶部贴顶、圆角归零；
   刘海/home 条遮挡由 dialog 自身 env() padding 补回。 */
html[data-dshsvc-mobile] div[role="presentation"]:has(> [role="dialog"][aria-modal="true"]) {
  padding: 0 !important;
}
html[data-dshsvc-mobile] [role="dialog"][aria-modal="true"] {
  position: absolute !important;
  top: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  left: 0 !important;
  margin: 0 !important;
  width: 100% !important;
  max-width: none !important;
  max-height: none !important;
  height: 100% !important;
  border-radius: 0 !important;
  overflow: hidden auto !important;
  flex-direction: column !important;
  padding-top: env(safe-area-inset-top, 0px) !important;
  padding-bottom: env(safe-area-inset-bottom, 0px) !important;
}
/* 插件市场（dshmarket）在 ≤560px 媒体查询里把设置导航 display:none 藏掉
   独占面板（其自有 CSS：[role=dialog]:has([data-dsh-market-root])>nav），
   手机上会把用户困在市场分区 —— 用更高优先级把横滑标签条顶回来。 */
html[data-dshsvc-mobile] [role="dialog"]:has([data-dsh-market-root]) > nav { display: flex !important; }
/* 设置页标签条：nav 从 188px 竖列变顶部横滑条（宽度与列向必须显式推翻）。
   右侧留 52px 给钉到角落的关闭钮。 */
html[data-dshsvc-mobile] [role="dialog"] nav {
  flex-direction: row !important;
  align-items: center !important;
  gap: 6px !important;
  width: auto !important;
  flex: none !important;
  padding: 8px 52px 0 12px !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  border-right: none !important;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
html[data-dshsvc-mobile] [role="dialog"] nav > div { flex: none !important; }
html[data-dshsvc-mobile] [role="dialog"] [class*="navList"] { flex-direction: row !important; }
html[data-dshsvc-mobile] [role="dialog"] [class*="navCell"] { white-space: nowrap !important; flex: none !important; }
/* 关闭钮钉到设置页右上角并压到面板顶层（原生在内容区头行、导航条下方，
   会被横滑条/内容重叠遮挡——用户点名要顶层）；加不透明圆形底衬保证任何
   内容上都可辨识，底衬与钮同节点、随之置顶。类哈希 VOzbGW_ 取自
   dsh-client-ui-settings-general SettingsRoot.module.css（rc.2），升级需复核 */
html[data-dshsvc-mobile] [role="dialog"][aria-modal="true"] [class*="VOzbGW_close"] {
  position: absolute !important;
  top: calc(env(safe-area-inset-top, 0px) + 9px) !important;
  right: 10px !important;
  z-index: 60;
  background-color: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1)) !important;
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: 999px !important;
  box-shadow: var(--dsw-shadow-lv2, 0 4px 12px rgba(0, 0, 0, .12)) !important;
}
/* 设置/任意模态打开时藏抽屉钮与沉浸把手：抽屉列自带 z-index:32 层叠上下文会把模态的
   z1000 封顶在 32，body 级 z33 的钮反而浮在设置页上（真机实测）。:has 不支持时
   退化为旧行为（钮仍显示），无副作用。 */
html[data-dshsvc-mobile] body:has([role="dialog"][aria-modal="true"]) [data-dshsvc-fab],
html[data-dshsvc-mobile] body:has([role="dialog"][aria-modal="true"]) [data-dshsvc-handle] {
  display: none !important;
}
/* composer 底行单行紧凑：外壳原生 flex-wrap:wrap 在窄屏把图标/模型名折成两行。
   收紧间距 + 禁换行 + 最宽触发钮限宽省略。类哈希 uV2eYG_/Sh0Q9G_/pXSMma_ 取自
   dsh-client-ui-conversation composer（rc.2），升级需复核。 */
html[data-dshsvc-mobile] [class*="uV2eYG_row"] {
  flex-wrap: nowrap !important;
  column-gap: 4px !important;
  padding-left: 10px !important;
  padding-right: 10px !important;
}
html[data-dshsvc-mobile] [class*="uV2eYG_row"] > * { min-width: 0 !important; }
html[data-dshsvc-mobile] [class*="uV2eYG_tools"],
html[data-dshsvc-mobile] [class*="uV2eYG_modes"],
html[data-dshsvc-mobile] [class*="uV2eYG_trailing"] { gap: 6px !important; min-width: 0 !important; }
html[data-dshsvc-mobile] [class*="uV2eYG_trailing"] { margin-left: auto !important; }
html[data-dshsvc-mobile] [class*="Sh0Q9G_trigger"] { max-width: 38vw !important; }
html[data-dshsvc-mobile] [class*="pXSMma_workspace"] { max-width: 30vw !important; }
/* 工作区侧板（fixed z25 层内的 nArs4W_panel z40）开屏后会盖住它自己的外部
   开关钮（tab bar 行 nArs4W_toggleButton）——手机上抽屉一开就再没有任何
   可点的关闭入口（真机反馈「关不上」本体）。把开关钮提到面板之上，
   恢复「同一颗钮开/关」语义。 */
html[data-dshsvc-mobile] [class*="nArs4W_toggleButton"] {
  position: relative !important;
  z-index: 45 !important;
}
/* 会话底部统计条：外壳原生 white-space:nowrap + ellipsis 截断（StatsLine），
   改横向滑动查看全文。哈希前缀随包拆分漂移：0.1.1-rc.2 在 dsh-client-ui-conversation
   （FJxK0a_），0.1.2-alpha.2 迁入 dsh-client-ui-chat（-NDN2W_root，前缀带横线）；按
   稳定的词干后缀 *_root 无法区分行（同名冲突风险），退化为按当前哈希复核。 */
html[data-dshsvc-mobile] [class*="NDN2W_root"] {
  overflow-x: auto !important;
  overflow-y: hidden !important;
  text-overflow: clip !important;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none !important;
}
html[data-dshsvc-mobile] [class*="NDN2W_root"]::-webkit-scrollbar { display: none !important; }
/* Assistant 回合尾部的运行元信息行（MessageIconActions）使用官方目录属性
   data-chat-flow-kind="turn-tail" 定位，内层兜底走回合尾节点自带的稳定
   data-turn-tail（0.1.2-alpha.2 起 data-time-hover-root 已删除）：
   「带 data-turn-tail 的节点」的最后一个子项 = actions 行，其最后一个 span =
   end-clock 时间文本（bundle 源码核实：clock:"end" 渲染在 children 末位）。
   行容器 min-width:0、时间文本可收缩并省略，以免移动端时间信息把复制/分支
   按钮挤出可视区域。 */
html[data-dshsvc-mobile] [data-chat-flow-kind="turn-tail"] [data-turn-tail] > :last-child {
  min-width: 0 !important;
  max-width: 100% !important;
}
html[data-dshsvc-mobile] [data-chat-flow-kind="turn-tail"] [data-turn-tail] > :last-child > span:last-child {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  padding-inline: 2px !important;
}
/* 回到底部按钮簇（官方 *_toBottom 词干后缀，rc.2 Md3f7G_ → 0.1.2-alpha.2 EvIC1a_，
   自有上箭头 data-dshsvc-user-jump）：
   移动端右侧还有约一行留白（scroll 的 --dsh-composer-side-clearance 侧清理），
   纯位移右移贴边（transform 只动绘制不动布局，sticky 定位不受影响）。
   :not([class*="Slot"]) 排除命名含 Slot 的 sticky 槽层，只移按钮本体。
   方向：正 translateX 向右；位移量 = 侧清理 +16（scroll 右 padding）再留 4px 缓冲。 */
html[data-dshsvc-mobile] [class*="_toBottom"]:not([class*="Slot"]),
html[data-dshsvc-mobile] [data-dshsvc-user-jump] {
  transform: translateX(calc(var(--dsh-composer-side-clearance, 16px) + 16px - 4px)) !important;
}
/* 左上角抽屉钮：悬停/按压用外壳交互底色；会话头部预留按钮位防遮面包屑 */
html[data-dshsvc-mobile] [data-dshsvc-fab]:hover,
html[data-dshsvc-mobile] [data-dshsvc-fab]:active { background: var(--dsw-alias-interactive-bg-hover) !important; }
html[data-dshsvc-mobile] [data-dshsvc-frame] > :nth-child(2) header { padding-left: 46px !important; }
/* 刘海安全区：viewport-fit=cover 后由 env() 补回遮挡区 */
html[data-dshsvc-mobile] body {
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-sizing: border-box;
}
/* 双击缩放与 iOS 聚焦放大 */
html[data-dshsvc-mobile] button,
html[data-dshsvc-mobile] a,
html[data-dshsvc-mobile] [role="button"],
html[data-dshsvc-mobile] input,
html[data-dshsvc-mobile] textarea,
html[data-dshsvc-mobile] select { touch-action: manipulation; }
html[data-dshsvc-mobile] input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]),
html[data-dshsvc-mobile] textarea { font-size: max(16px, 1em) !important; }
/* composer 防挤压：保守规则，真机反馈后迭代 */
html[data-dshsvc-mobile] [class*="toolbar" i] { flex-wrap: wrap !important; min-width: 0 !important; max-width: 100% !important; }
html[data-dshsvc-mobile] [class*="composer" i] { min-width: 0 !important; max-width: 100% !important; }
html[data-dshsvc-mobile] [class*="inputTriggers" i] > *,
html[data-dshsvc-mobile] [class*="toolbar" i] button { flex: none !important; }
/* —— 滑动沉浸（v0.36）——
   composer 座是滚动体内的 sticky 子项：transform 滑出后由滚动体自身 overflow:hidden
   裁掉，布局零变化、scrollTop 不跳、外壳 ResizeObserver 维护的 --dsh-composer-height
   与「回到底部」浮钮偏移不受任何影响。容器包含块陷阱不触发：composer 工具行本就带
   container-type:inline-size（fixed 后代已被圈在里面，圆环才在移动端 portal 出去）。 */
html[data-dshsvc-mobile] [data-composer-seat] {
  transition: transform var(--ds-transition-duration-slow, .25s) var(--ds-ease-in-out, ease) !important;
}
html[data-dshsvc-mobile][data-dshsvc-immersive] [data-composer-seat] {
  transform: translateY(115%) !important;
}
/* 会话头部（面包屑+视图标签）在滚动体外面，藏在根列里：translateY(-100%) 上滑出
   data-phase=active 根的 overflow:hidden 裁剪区，负 margin-top 用引擎测得的高度
   （--dshsvc-header-h，ResizeObserver 实时校正；老内核无 RO 时回退常量）补位，
   否则留一条空带。 */
html[data-dshsvc-mobile] [data-dshsvc-chat-header] {
  transition: transform var(--ds-transition-duration-slow, .25s) var(--ds-ease-in-out, ease),
    margin-top var(--ds-transition-duration-slow, .25s) var(--ds-ease-in-out, ease);
}
html[data-dshsvc-mobile][data-dshsvc-immersive] [data-dshsvc-chat-header] {
  transform: translateY(-100%) !important;
  margin-top: calc(0px - var(--dshsvc-header-h, 76px)) !important;
}
@media (prefers-reduced-motion: reduce) {
  html[data-dshsvc-mobile][data-dshsvc-immersive] [data-composer-seat],
  html[data-dshsvc-mobile][data-dshsvc-immersive] [data-dshsvc-chat-header],
  html[data-dshsvc-mobile] [data-dshsvc-chat-header] { transition: none !important; }
}
/* 常驻底部小把手：沉浸态点它展开头部与输入框，未沉浸态也可先收起再读。
   真机反馈改半透明磨砂（悬停/按压复原不透明），触摸目标不打折。
   z-index 30 低于 backdrop 31——抽屉/设置打开时被自然盖住，无需额外互斥。 */
html[data-dshsvc-mobile] [data-dshsvc-handle]:hover,
html[data-dshsvc-mobile] [data-dshsvc-handle]:active {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .2)) !important;
  color: var(--dsw-alias-label-primary) !important;
  opacity: 1 !important;
}
`

      function createMobileAdaptation() {
        const state = {
          active: false,
          mq: null,
          mqHandler: null,
          frameObserver: null,
          mountObserver: null,
          workspaceObserver: null,
          errorHandler: null,
          resizeHandler: null,
          styleTag: null,
          backdrop: null,
          fab: null,
          debugChip: null,
          debugEnabled: false,
          errorCount: 0,
          drawerOpen: false,
          detailsOpen: false,
          workspaceOpen: false,
          lastFabDisplay: null,
          lastBackdropDisplay: null,
          // —— 滑动沉浸（v0.36）状态 ——
          immersive: false,
          handle: null,
          lastHandleDisplay: null,
          chatAvailable: false,
          chatScrollLastY: null,
          gestureAt: 0,
          immersiveAcc: 0,
          immersiveLockDir: null,
          zoneArmed: null,
          arrivalDone: false,
          headerEl: null,
          headerRO: null,
        }

        const layoutService = () => {
          try { return typeof ctx.get === 'function' ? ctx.get('layout') : undefined } catch (_) { return undefined }
        }

        const syncSurfaces = () => {
          // 详情列移动端永久离屏（CSS），backdrop 只服务侧栏抽屉；
          // 若外部把详情打开（openDetails），这里自愈式收掉，避免空态盖屏。
          if (state.detailsOpen) {
            const layout = layoutService()
            if (layout !== undefined) {
              try { layout.closeDetails() } catch (_) {}
            }
            state.detailsOpen = false
          }
          // 抽屉开启时收起 FAB：关闭走外壳原生侧栏钮或外侧遮罩，绝不在
          // 抽屉面板上叠画第二套关闭件（真机反馈：
          // 那只会变成糊在侧栏 logo 上的不明物）。工作区侧板同理互斥。
          // 变化才写：innerHTML/display 若无条件重写会喂活 body 级观察器死循环。
          const nextDisplay = (state.drawerOpen || state.workspaceOpen) ? 'none' : 'flex'
          if (state.fab !== null && state.lastFabDisplay !== nextDisplay) {
            state.lastFabDisplay = nextDisplay
            state.fab.style.display = nextDisplay
          }
          const backdropNext = state.drawerOpen ? 'block' : 'none'
          if (state.backdrop !== null && state.lastBackdropDisplay !== backdropNext) {
            state.lastBackdropDisplay = backdropNext
            state.backdrop.style.display = backdropNext
          }
          syncHandleVisibility()
          if (state.debugEnabled && state.debugChip !== null) updateDebugChip()
        }

        /** body 级监听的节流入口：同帧多次变更合并为一次读改（脏标记 + 单发调度），
            回调内严格「无变化不写 DOM」，杜绝 观察器→写DOM→再触发 的自激循环。 */
        let syncScheduled = false
        const scheduleSync = () => {
          if (syncScheduled || !state.active) return
          syncScheduled = true
          // 定时器可能活过宿主环境/测试清理期——回调整体兜底，绝不外抛
          setTimeout(() => {
            syncScheduled = false
            if (!state.active) return
            try {
              readOverlayState()
              syncSurfaces()
            } catch (_) {}
          }, 50)
          // 追踪采样：外壳的显隐走过渡动画，50ms 那次读到的可能是动画前旧值；
          // 动画落定后再校准两次，否则 UI 僵在旧状态、要再碰一下屏幕才刷新。
          for (const delay of [400, 900]) {
            setTimeout(() => {
              if (!state.active) return
              try { readOverlayState(); syncSurfaces() } catch (_) {}
            }, delay)
          }
        }

        const readOverlayState = () => {
          const frame = document.querySelector('[data-dshsvc-frame]')
          state.drawerOpen = frame !== null && !frame.hasAttribute('data-sidebar-collapsed')
          state.detailsOpen = frame !== null && !frame.hasAttribute('data-details-collapsed')
          // 工作区侧板（外壳 tab 系统 nArs4W_panel）：可见 = 任一匹配节点解除
          // PanelHidden 且进入视口。注意 panelBody 等 同哈希同名 子串节点会混入
          // querySelector 匹配，必须逐个甄别取「或」，否则状态时对时错。
          state.workspaceOpen = false
          try {
            for (const el of document.querySelectorAll('[class*="nArs4W_panel"]')) {
              const cls = typeof el.className === 'string' ? el.className : ''
              if (/nArs4W_panelHidden/.test(cls)) continue
              const rect = el.getBoundingClientRect()
              if (rect.width > 0 && rect.left < window.innerWidth - 2 && getComputedStyle(el).visibility !== 'hidden') {
                state.workspaceOpen = true
                break
              }
            }
          } catch (_) { state.workspaceOpen = false }
          refreshImmersiveAvailability()
        }

        // ===== 滑动沉浸（v0.36）：方向手势藏「头部+composer」，三路回显 =====
        // 范围=整套、回显=上滑方向+常驻底部小把手、开关并入 mobileAdaptation（用户三问选型）。
        // 手势可信度是命门：流式贴底 scrollTo / 跳转 scrollIntoView 等程序化滚动必须无视——
        // 判据=800ms 手势窗口（touchstart/move/wheel 刷新时间戳），窗口外的 scroll 只更新基线、
        // 绝不翻转状态（贴底强制回显同样只认手势窗口内）。

        const cssVarSupported = (styleEl) => typeof styleEl.setProperty === 'function'

        const setHeaderHeightVar = (px) => {
          const styleEl = document.documentElement.style
          if (cssVarSupported(styleEl)) styleEl.setProperty('--dshsvc-header-h', `${Math.max(0, Math.round(px))}px`)
        }

        /** 会话骨架三要素定位：全部官方属性钩子 + parentNode 走树，无类哈希。
         *  0.1.2-alpha.2：官方把 scrollBody 包进新的 body 包裹层（.wSkVaW_body），
         *  data-phase 落在根上（scroller 的祖父）；旧版则直接在父节点上。上溯
         *  最多两层找 data-phase，命中即采纳该节点作 rootEl —— 两代形状通吃。 */
        const chatContext = () => {
          let scroller = null
          try { scroller = document.querySelector('[data-conversation-scroll]') } catch (_) { return null }
          if (scroller === null || scroller.isConnected === false) return null
          let rootEl = scroller.parentNode
          if (rootEl === null || rootEl === document.documentElement) return null
          let phase = null
          try { phase = rootEl.getAttribute('data-phase') } catch (_) {}
          let cursor = rootEl
          for (let depth = 0; phase === null && depth < 2; depth += 1) {
            cursor = cursor === null || cursor === undefined ? null : cursor.parentNode
            if (cursor === null || cursor === document.documentElement) break
            try { phase = cursor.getAttribute('data-phase') } catch (_) { break }
            if (phase !== null) rootEl = cursor
          }
          return { scroller, rootEl, phase }
        }

        /** 在某节点的子树里找第一个 HEADER 节点（限深，不依赖 querySelector，假桩环境全兼容）。 */
        const findHeaderNodeIn = (node, depthLeft) => {
          if (depthLeft <= 0 || node === null || typeof node.children === 'undefined' || node.children === null) return null
          for (const c of node.children || []) {
            const t = typeof c.tagName === 'string' ? c.tagName.toUpperCase() : ''
            if (t === 'HEADER') return c
            const deeper = findHeaderNodeIn(c, depthLeft - 1)
            if (deeper !== null) return deeper
          }
          return null
        }

        /**
         * 给会话头部打自有标记属性。
         * v0.36.1 真机取证两连修正（puppeteer29/30）：
         * ① rc.2 的 header 不是 root 直接子元素——官方把槽位内容包在一层
         *    <div data-slot="conversation.session.header"> 里，直接子扫描永远扑空；
         * ② 该包裹层是 display:contents（不产生盒子、getBoundingClientRect 恒 0），
         *    真正的布局占位者是内层 header 本人——transform/负 margin 必须落在它
         *    身上才有效果。因此双层穿透最终定位到【HEADER 节点】打标，RO 同步测其
         *    高度；找到后停止向上传递，兼容未来官方去掉包裹层的直渲染形态。
         */
        const tagChatHeader = (ctx) => {
          const rootEl = ctx !== null ? ctx.rootEl : null
          if (rootEl === null || typeof rootEl.children === 'undefined') return state.headerEl
          if (state.headerEl !== null && state.headerEl.isConnected) {
            try { state.headerEl.setAttribute('data-dshsvc-chat-header', '') } catch (_) {}
            return state.headerEl
          }
          let target = null
          for (const child of rootEl.children || []) {
            const tagName = typeof child.tagName === 'string' ? child.tagName.toUpperCase() : ''
            if (tagName === 'HEADER') { target = child; break }
          }
          if (target === null) {
            for (const child of rootEl.children || []) {
              const found = findHeaderNodeIn(child, 3)
              if (found !== null) { target = found; break }
            }
          }
          if (target !== null) {
            target.setAttribute('data-dshsvc-chat-header', '')
            state.headerEl = target
            measureChatHeader(target)
            return target
          }
          return null
        }

        /** 头部高度测量 → --dshsvc-header-h。无 ResizeObserver 的环境保持 CSS 常量兜底。 */
        const measureChatHeader = (headerEl) => {
          if (typeof ResizeObserver !== 'function') return
          if (state.headerRO !== null && state.headerRO.__el === headerEl) return
          if (state.headerRO !== null) { try { state.headerRO.disconnect() } catch (_) {} }
          try {
            const observer = new ResizeObserver(() => {
              try {
                const height = headerEl.offsetHeight
                if (typeof height === 'number' && height > 0) setHeaderHeightVar(height)
              } catch (_) {}
            })
            observer.__el = headerEl
            observer.observe(headerEl)
            state.headerRO = observer
            const initial = headerEl.offsetHeight
            if (typeof initial === 'number' && initial > 0) setHeaderHeightVar(initial)
          } catch (_) {
            state.headerRO = null
          }
        }

        const nodeContains = (ancestor, node) => {
          let cursor = node
          while (cursor !== null && cursor !== undefined) {
            if (cursor === ancestor) return true
            cursor = cursor.parentNode
          }
          return false
        }

        const setImmersive = (hidden) => {
          if (!state.active || !state.chatAvailable) hidden = false
          if (state.immersive === hidden) return
          state.immersive = hidden
          const htmlEl = document.documentElement
          try {
            if (hidden) htmlEl.setAttribute('data-dshsvc-immersive', '')
            else htmlEl.removeAttribute('data-dshsvc-immersive')
          } catch (_) {}
          syncHandleFace()
          if (state.debugEnabled) updateDebugChip()
        }

        /** 清掉沉浸态与手势基线（阶段切换/不可滚/卸载共用）。 */
        const resetImmersive = () => {
          state.chatScrollLastY = null
          state.immersiveAcc = 0
          state.immersiveLockDir = null
          state.zoneArmed = null
          state.arrivalDone = false
          setImmersive(false)
        }

        /** 会话可用性门控：无会话/hero/settling/内容不可滚时整体禁用并复位。 */
        const refreshImmersiveAvailability = () => {
          const ctx = chatContext()
          let available = false
          if (ctx !== null && ctx.phase === 'active') {
            tagChatHeader(ctx)
            const seat = (() => { try { return document.querySelector('[data-composer-seat]') } catch (_) { return null } })()
            if (seat !== null && nodeContains(ctx.scroller, seat)) {
              let scrollTop = NaN; let scrollHeight = NaN; let clientHeight = NaN
              try {
                scrollTop = Number(ctx.scroller.scrollTop)
                scrollHeight = Number(ctx.scroller.scrollHeight)
                clientHeight = Number(ctx.scroller.clientHeight)
              } catch (_) {}
              available = Number.isFinite(scrollTop) && Number.isFinite(scrollHeight) && Number.isFinite(clientHeight) &&
                scrollHeight - clientHeight > IMMERSIVE_MIN_SCROLLABLE_PX
            }
          }
          state.chatAvailable = available
          if (!available) resetImmersive()
        }

        const gestureFresh = () => {
          const now = Date.now()
          return state.gestureAt > 0 && now - state.gestureAt <= GESTURE_WINDOW_MS
        }

        /** scroll 捕获监听的主判定（v0.36.1 真机返工）。
            首版拿「单次 scroll 事件的位移」比阈值：测试桩一步跳 70px 必中，真机拖拽
            每帧只产生几像素的高频增量，单个事件永远摸不到 64px —— 表现即「下滑几乎
            不触发」。现改为**方向累加器**：手势窗口内的位移连续求和（反向滚动自然
            抵消），越过阈值立即翻转并清零；窗口外/大跳变只重基线与累加器，绝不翻转
            （流式贴底 scrollTo、scrollIntoView 跳转全部免疫）。
            聚焦硬阻断同步移除（首版只要焦点在输入框里就压住一切方向判定——打完字
            去读历史是常态操作，表现为整个功能失灵）：获焦仅保留「立即回显」一次，
            之后滑动照常生效。 */
        const evaluateImmersiveScroll = (scroller) => {
          if (!state.active || !state.chatAvailable) return
          let scrollTop = NaN; let scrollHeight = NaN; let clientHeight = NaN
          try {
            scrollTop = Number(scroller.scrollTop)
            scrollHeight = Number(scroller.scrollHeight)
            clientHeight = Number(scroller.clientHeight)
          } catch (_) { return }
          if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return
          syncHandleVisibility()
          const lastY = state.chatScrollLastY === null ? scrollTop : state.chatScrollLastY
          const delta = scrollTop - lastY
          state.chatScrollLastY = scrollTop
          // 免疫层：程序化滚动（无手势窗口）或单事件大跳变 → 只重基线与累加器。
          // 窗口一过再到达的事件一律视为外壳自驱（贴底锚定），顺手把残留累加清零，
          // 保证下一次真实触摸从干净状态起算。
          if (!gestureFresh() || Math.abs(delta) > IMMERSIVE_DELTA_CAP_PX) {
            state.immersiveAcc = 0
            return
          }
          // 到底回显：仅认「本手势起点在底部区之外、正向下滑跨入边界」的到达；
          // 程序化贴底进不了手势层。起点就在区内的新手势不得触发（否则区内每次
          // 下拉都会被抢着掀开，沉浸根本无法维持）；向上经过底部区也不得进入本分支
          // （与累加器的向上回显打架：前一事件刚显示、下一事件又被藏回）。
          const inBottomZone = scrollTop + clientHeight >= scrollHeight - IMMERSIVE_BOTTOM_PX
          if (state.zoneArmed === null) state.zoneArmed = inBottomZone
          if (
            state.zoneArmed === false && inBottomZone && !state.arrivalDone &&
            state.immersive && delta > 0
          ) {
            state.arrivalDone = true
            state.immersiveAcc = 0
            state.immersiveLockDir = 1
            setImmersive(false)
            return
          }
          // 同方向手势段内只翻转一次（方向锁）：到底回显后继续滑入底部的剩余动量
          // 不允许把刚回显的界面再次藏起（真机三连教训）。反向滚动或下一次触摸解锁。
          const dirSign = Math.sign(delta)
          if (dirSign !== 0 && state.immersiveLockDir !== null) {
            if (dirSign === -state.immersiveLockDir) state.immersiveLockDir = null
            else { state.immersiveAcc = 0; return }
          }
          // 方向段语义：手势一反转就清零重来——隐藏触发后的下滑残量不允许
          // 吃掉下一次上滑的前几像素，否则回显也会「感觉失灵」（真机二连教训）。
          if (state.immersiveAcc > 0 && delta < 0) state.immersiveAcc = 0
          else if (state.immersiveAcc < 0 && delta > 0) state.immersiveAcc = 0
          state.immersiveAcc += delta
          if (state.immersiveAcc > IMMERSIVE_ACC_CLAMP_PX) state.immersiveAcc = IMMERSIVE_ACC_CLAMP_PX
          else if (state.immersiveAcc < -IMMERSIVE_ACC_CLAMP_PX) state.immersiveAcc = -IMMERSIVE_ACC_CLAMP_PX
          if (state.immersiveAcc >= IMMERSIVE_HIDE_PX) {
            state.immersiveAcc = 0
            state.immersiveLockDir = 1
            setImmersive(true)
          } else if (state.immersiveAcc <= -IMMERSIVE_SHOW_PX) {
            state.immersiveAcc = 0
            state.immersiveLockDir = -1
            setImmersive(false)
          }
        }

        /** 捕获式 scroll 监听挂在根元素上：scroll 事件不冒泡但捕获可达，
            会话切换/视图重建换节点也无需重绑。 */
        const onDocumentScroll = (event) => {
          if (!state.active) return
          let el = event && event.target
          for (let depth = 0; el !== null && el !== undefined && depth < 6; depth += 1) {
            if (typeof el.hasAttribute === 'function') {
              try { if (el.hasAttribute('data-conversation-scroll')) { evaluateImmersiveScroll(el); return } } catch (_) {}
            }
            el = el.parentNode
          }
        }

        const markGesture = () => {
          state.gestureAt = Date.now()
          state.immersiveLockDir = null // 新触摸开始：同方向段锁作废
          state.zoneArmed = null        // 底部区基线待首个事件采样
          state.arrivalDone = false
        }

        const onFocusIn = (event) => {
          if (!state.active || state.handle === null) return
          let seat = null
          try { seat = document.querySelector('[data-composer-seat]') } catch (_) { return }
          if (seat === null) return
          // v0.36.1：聚焦只负责「立即回显」；此后滑动照常生效（首版的
          // 聚焦硬阻断把「打完字读历史」这一常态场景整个压死，已撤）。
          if (nodeContains(seat, event?.target)) {
            state.immersiveAcc = 0
            if (state.immersive) setImmersive(false)
          }
        }

        /** 把手正反面：向上箭头=点开（当前沉浸），向下箭头=点收（当前展开）。 */
        const HANDLE_ICON_UP =
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
          '<path d="M3.5 10.5 8 6l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        const HANDLE_ICON_DOWN =
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
          '<path d="M3.5 5.5 8 10l4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

        const syncHandleFace = () => {
          const handle = state.handle
          if (handle === null) return
          const face = state.immersive ? HANDLE_ICON_UP : HANDLE_ICON_DOWN
          if (handle.__face !== face) {
            handle.__face = face
            handle.innerHTML = face
          }
          const labelKey = state.immersive ? 'mobile.immersive.show' : 'mobile.immersive.hide'
          const nextLabel = t(labelKey)
          if (handle.__label !== nextLabel) {
            handle.__label = nextLabel
            handle.setAttribute('aria-label', nextLabel)
            handle.title = nextLabel
          }
          try { handle.setAttribute('aria-expanded', String(!state.immersive)) } catch (_) {}
        }

        const syncHandleVisibility = () => {
          // 常驻把手仅在可沉浸会话里出现；抽屉/工作区侧板开着时让位（模态由 :has CSS 兜底）。
          const blocked = state.drawerOpen || state.workspaceOpen
          const nextDisplay = state.chatAvailable && !blocked ? 'flex' : 'none'
          if (state.handle !== null && state.lastHandleDisplay !== nextDisplay) {
            state.lastHandleDisplay = nextDisplay
            state.handle.style.display = nextDisplay
          }
        }

        const buildHandle = () => {
          if (state.handle !== null) return
          const handle = document.createElement('button')
          handle.type = 'button'
          handle.setAttribute('data-dshsvc-handle', '')
          Object.assign(handle.style, {
            position: 'fixed',
            left: '50%',
            marginLeft: '-32px',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
            width: '64px', height: '20px', borderRadius: '11px',
            zIndex: '30', display: 'none',
            alignItems: 'center', justifyContent: 'center',
            background: 'var(--dshsvc-handle-bg, rgba(127, 127, 127, .16))',
            border: '1px solid var(--dsw-alias-border-l2)',
            boxShadow: 'var(--dsw-shadow-lv1, 0 1px 4px rgba(0, 0, 0, .18))',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            opacity: '.72',
            transition: 'opacity var(--ds-transition-duration-fast, .15s) ease',
            color: 'var(--dsw-alias-label-secondary)', padding: '0',
            cursor: 'pointer', touchAction: 'manipulation',
          })
          // 标准 click 是唯一激活路径（v0.30 第九轮教训：一次触屏手势浏览器归一为一个 click）
          handle.addEventListener('click', () => {
            if (!state.active || !state.chatAvailable) return
            markGesture()
            // 手动翻转后基线与累加器作废，下一次手势重新计量
            state.chatScrollLastY = null
            state.immersiveAcc = 0
            setImmersive(!state.immersive)
          })
          document.body.appendChild(handle)
          state.handle = handle
          state.lastHandleDisplay = null
          syncHandleFace()
        }

        const immersiveListeners = [
          ['scroll', onDocumentScroll, { capture: true, passive: true }],
          ['touchstart', markGesture, { capture: true, passive: true }],
          ['touchmove', markGesture, { capture: true, passive: true }],
          ['wheel', markGesture, { capture: true, passive: true }],
          ['focusin', onFocusIn, { capture: true }],
        ]
        let immersiveBound = false

        const attachImmersiveListeners = () => {
          if (immersiveBound) return
          immersiveBound = true
          for (const [type, handler, opts] of immersiveListeners) {
            try { document.documentElement.addEventListener(type, handler, opts) } catch (_) {}
          }
        }

        const detachImmersiveListeners = () => {
          if (!immersiveBound) return
          immersiveBound = false
          for (const [type, handler, opts] of immersiveListeners) {
            try { document.documentElement.removeEventListener(type, handler, opts) } catch (_) {}
          }
        }

        const FAB_OPEN_ICON =
          '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
          '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" stroke="currentColor" stroke-width="1.5"/>' +
          '<line x1="6.25" y1="3.5" x2="6.25" y2="12.5" stroke="currentColor" stroke-width="1.5"/></svg>'

        const updateDebugChip = () => {
          const chip = state.debugChip
          if (chip === null) return
          const onOff = (value) => (value ? t('mobile.debug.stateOn') : t('mobile.debug.stateOff'))
          chip.textContent = [
            `${t('mobile.debug.viewport')} ${window.innerWidth}×${window.innerHeight}`,
            `≤1023 ${onOff(state.active)}`,
            `${t('mobile.debug.drawer')} ${onOff(state.drawerOpen)}`,
            `${t('mobile.debug.details')} ${onOff(state.detailsOpen)}`,
            `${t('mobile.debug.immersive')} ${onOff(state.immersive)}`,
            `${t('mobile.debug.errors')} ${state.errorCount}`,
          ].join(' · ')
        }

        /** 给外壳三栏骨架打自有标记属性；找不到骨架（异常布局）时返回 false 跳过抽屉件。 */
        const tagShellFrame = () => {
          // overlayLayer 是 frame 的子元素且带官方 data-shell-overlay 属性（源码核实）
          const overlayLayer = document.querySelector('[data-shell-overlay]')
          const frame = overlayLayer !== null ? overlayLayer.parentNode : null
          if (frame === null || frame === document.documentElement) return false
          frame.setAttribute('data-dshsvc-frame', '')
          let sawSidebar = false
          let sawCenter = false
          let sawDetails = false
          for (const child of frame.children) {
            const className = typeof child.className === 'string' ? child.className : ''
            if (!sawSidebar && /sidebarCol/.test(className)) {
              child.setAttribute('data-dshsvc-sidebar', '')
              sawSidebar = true
            } else if (!sawCenter && /centerCol/.test(className)) {
              child.setAttribute('data-dshsvc-center', '')
              sawCenter = true
            } else if (!sawDetails && /detailsCol/.test(className)) {
              child.setAttribute('data-dshsvc-details', '')
              sawDetails = true
            }
          }
          return true
        }

        /** 建 backdrop/FAB 并接上抽屉状态观察。外壳骨架就绪才算成功；
            手机直接窄屏冷加载时骨架往往还没挂载（真机反馈：抽屉钮缺失 +
            官方 rail 残留，就是这个竞态），失败则由 watchForShell 重试。 */
        const buildSurfaces = () => {
          if (state.fab !== null) return true
          if (!tagShellFrame()) return false
          state.backdrop = document.createElement('div')
          state.backdrop.setAttribute('data-dshsvc-backdrop', '')
          state.backdrop.setAttribute('aria-hidden', 'true')
          Object.assign(state.backdrop.style, {
            position: 'fixed', inset: '0', zIndex: '31', display: 'none',
            background: 'rgba(0,0,0,.42)', backdropFilter: 'blur(1px)',
          })
          state.backdrop.addEventListener('click', () => {
            const layout = layoutService()
            if (layout === undefined) return
            if (state.drawerOpen) layout.toggleSidebar()
          })
          document.body.appendChild(state.backdrop)

          state.fab = document.createElement('button')
          state.fab.type = 'button'
          state.fab.setAttribute('data-dshsvc-fab', '')
          state.fab.setAttribute('aria-label', t('mobile.fab.label'))
          // 样式对齐外壳幽灵图标钮（设置关闭钮同族：28px 圆形、透明底、主题色），
          // 位置钉会话头部左上角（safe-area 感知），图标为侧栏面板开关。
          Object.assign(state.fab.style, {
            position: 'fixed',
            left: 'calc(env(safe-area-inset-left, 0px) + 10px)',
            top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
            width: '32px', height: '32px', borderRadius: '16px', zIndex: '33', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-primary)',
            padding: '0', cursor: 'pointer', touchAction: 'manipulation',
          })
          state.fab.innerHTML =
            '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
            '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" stroke="currentColor" stroke-width="1.5"/>' +
            '<line x1="6.25" y1="3.5" x2="6.25" y2="12.5" stroke="currentColor" stroke-width="1.5"/></svg>'
          // 标准 click 是唯一激活路径：浏览器会把一次触屏手势归一为一个 click，
          // 同时保留鼠标、键盘与辅助技术支持。不得在 pointerdown 提前翻转再按时间窗
          // 吞合成 click——主线程忙时 click 可晚到时间窗外，导致同一短按开后又关，
          // 表现成「必须长按才能打开」。touch-action:manipulation 已消除旧式点按延迟。
          state.fab.addEventListener('click', () => {
            const layout = layoutService()
            if (layout !== undefined) layout.toggleSidebar()
          })
          document.body.appendChild(state.fab)
          buildHandle()
          readOverlayState()

          // 不在 sidebarCol 上代理关闭：侧栏右上角已有外壳原生 toggle。若祖先再监听
          // click，同一事件会先由按钮关闭、再冒泡触发第二次 toggle，结果立即重新打开。
          // 抽屉关闭路径只保留原生 toggle 与外侧 backdrop，两者职责互不重叠。

          // 工作区侧板（nArs4W_panel，fixed z25 层）不受三栏属性驱动；
          // body 级监听只置脏标记、单发调度处理（绝不在回调里同步写 DOM，
          // 否则 写DOM→再触发→再写 的自激循环会打满主线程，页面永久转圈）
          try {
            state.workspaceObserver = new MutationObserver(() => { scheduleSync() })
            state.workspaceObserver.observe(document.body, { attributes: true, childList: true, subtree: true })
          } catch (_) {
            state.workspaceObserver = null
          }

          // frame 属性观察是抽屉状态主驱动：同步处理（监听范围受控、无自激风险）
          state.frameObserver = new MutationObserver(() => {
            readOverlayState()
            syncSurfaces()
          })
          const frame = document.querySelector('[data-dshsvc-frame]')
          if (frame !== null) state.frameObserver.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-details-collapsed'] })

          if (state.mountObserver !== null) { state.mountObserver.disconnect(); state.mountObserver = null }
          syncSurfaces()
          return true
        }

        /** 外壳骨架晚挂载的重试观察：AppFrame 一进 DOM 就补建抽屉件。 */
        const watchForShell = () => {
          if (state.mountObserver !== null || typeof MutationObserver !== 'function') return
          try {
            state.mountObserver = new MutationObserver(() => { buildSurfaces() })
            state.mountObserver.observe(document.documentElement, { childList: true, subtree: true })
          } catch (_) {
            state.mountObserver = null
          }
        }

        const ensureViewportCover = () => {
          for (const meta of document.querySelectorAll('meta[name="viewport"]')) {
            const content = meta.getAttribute('content') || ''
            if (/(^|,)\s*viewport-fit\s*=/.test(content)) continue
            meta.setAttribute('content', content.trim() === '' ? 'viewport-fit=cover' : content.trim() + ', viewport-fit=cover')
          }
        }

        const activate = () => {
          if (state.active) return
          if (layoutService() === undefined) return // 无官方 layout 服务时不出交互件，避免不可收起的抽屉
          state.active = true
          // 全部规则的作用域开关：CSS 与 DOM 标记都以它为门
          document.documentElement.setAttribute('data-dshsvc-mobile', '')
          ensureViewportCover()
          state.styleTag = document.createElement('style')
          state.styleTag.dataset.plugin = '@gehennawu/dsh-service'
          state.styleTag.dataset.pluginCss = '@gehennawu/dsh-service/mobile.css'
          state.styleTag.textContent = MOBILE_CSS
          document.head.appendChild(state.styleTag)
          if (!buildSurfaces()) watchForShell()
          attachImmersiveListeners()
          refreshImmersiveAvailability()

          let debugRequested = false
          try { debugRequested = new URLSearchParams(window.location.search).has(MOBILE_DEBUG_PARAM) } catch (_) {}
          if (debugRequested) {
            state.debugEnabled = true
            state.errorHandler = () => {
              state.errorCount += 1
              updateDebugChip()
            }
            window.addEventListener('error', state.errorHandler)
            state.resizeHandler = () => updateDebugChip()
            window.addEventListener('resize', state.resizeHandler)
            state.debugChip = document.createElement('div')
            state.debugChip.setAttribute('data-dshsvc-debug', '')
            Object.assign(state.debugChip.style, {
              position: 'fixed', left: '8px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
              zIndex: '60', maxWidth: '94vw', padding: '4px 8px', borderRadius: '8px',
              font: '11px/1.5 var(--ds-font-family-code, monospace)',
              background: 'var(--dsw-alias-bg-layer-2, #333)', color: 'var(--dsw-alias-label-primary, #eee)',
              pointerEvents: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            })
            state.debugChip.title = t('mobile.debug.title')
            document.body.appendChild(state.debugChip)
            updateDebugChip()
          }
          syncSurfaces()
        }

        const deactivate = () => {
          if (!state.active) return
          state.active = false
          state.drawerOpen = false
          state.detailsOpen = false
          detachImmersiveListeners()
          document.documentElement.removeAttribute('data-dshsvc-mobile')
          document.documentElement.removeAttribute('data-dshsvc-immersive')
          if (state.headerRO !== null) {
            try { state.headerRO.disconnect() } catch (_) {}
            state.headerRO = null
          }
          state.headerEl = null
          if (state.frameObserver !== null) { state.frameObserver.disconnect(); state.frameObserver = null }
          if (state.workspaceObserver !== null) { state.workspaceObserver.disconnect(); state.workspaceObserver = null }
          if (state.mountObserver !== null) { state.mountObserver.disconnect(); state.mountObserver = null }
          if (state.errorHandler !== null) window.removeEventListener('error', state.errorHandler)
          if (state.resizeHandler !== null) window.removeEventListener('resize', state.resizeHandler)
          state.errorHandler = null
          state.resizeHandler = null
          for (const el of [state.styleTag, state.backdrop, state.fab, state.handle, state.debugChip]) {
            if (el !== null && el.isConnected) el.remove()
          }
          for (const el of document.querySelectorAll('[data-dshsvc-frame],[data-dshsvc-sidebar],[data-dshsvc-center],[data-dshsvc-details],[data-dshsvc-chat-header]')) {
            el.removeAttribute('data-dshsvc-frame')
            el.removeAttribute('data-dshsvc-sidebar')
            el.removeAttribute('data-dshsvc-center')
            el.removeAttribute('data-dshsvc-details')
            el.removeAttribute('data-dshsvc-chat-header')
          }
          const headerStyle = (() => { try { return document.documentElement.style } catch (_) { return null } })()
          if (headerStyle !== null) {
            try { headerStyle.removeProperty('--dshsvc-header-h') } catch (_) { headerStyle['--dshsvc-header-h'] = '' }
          }
          state.styleTag = null
          state.backdrop = null
          state.fab = null
          state.handle = null
          state.lastHandleDisplay = null
          state.debugChip = null
          state.debugEnabled = false
          resetImmersive()
        }

        const evaluate = () => {
          const want = featureEnabled('mobileAdaptation') && state.mmqMatches()
          if (want) activate()
          else deactivate()
        }

        const dispose = () => {
          deactivate()
          if (state.mq !== null && state.mqHandler !== null) {
            if (typeof state.mq.removeEventListener === 'function') state.mq.removeEventListener('change', state.mqHandler)
            else if (typeof state.mq.removeListener === 'function') state.mq.removeListener('change', state.mqHandler)
          }
          state.mqHandler = null
        }

        // matchMedia 惰性创建：测试环境可能只提供最小桩
        try {
          state.mq = window.matchMedia(MOBILE_ACTIVE_QUERY)
        } catch (_) {
          state.mq = null
        }
        state.mmqMatches = () => {
          try { return state.mq !== null && state.mq.matches === true } catch (_) { return false }
        }
        if (state.mq !== null) {
          state.mqHandler = () => evaluate()
          if (typeof state.mq.addEventListener === 'function') state.mq.addEventListener('change', state.mqHandler)
          else if (typeof state.mq.addListener === 'function') state.mq.addListener(state.mqHandler)
        }

        return { evaluate, dispose }
      }

      /**
       * 会话导航适配层：本文件里唯一允许知道官方外壳 DOM 结构（类哈希、
       * data 属性、滚动参照系）的地方。「跳上一条用户回复」引擎只跟这里的
       * 语义操作对话；外壳升级导致结构或类哈希漂移时只改本层，引擎零改动。
       * 全部方法吞异常，找不到一律回 null / 空数组，调用方按「不存在」处理。
       */
      const createConversationNav = () => {
        const hasScrollAttr = (el) => {
          if (typeof el.hasAttribute === 'function') {
            try { return el.hasAttribute('data-conversation-scroll') } catch (_) { return false }
          }
          // 真实 DOM 的 attributes 是 NamedNodeMap（没有 .has），不得假设 Map 风格方法。
          try {
            return el.attributes !== null && typeof el.attributes.getNamedItem === 'function' &&
              el.attributes.getNamedItem('data-conversation-scroll') !== null
          } catch (_) { return false }
        }
        return {
          /** 官方「回到底部」sticky 槽位。
           *  哈希前缀随包拆分漂移（rc.2 Md3f7G_ → 0.1.2-alpha.2 EvIC1a_，聊天视图
           *  迁进 dsh-client-ui-chat）：按稳定的可读词干后缀匹配，跨版本兼容。 */
          toBottomSlot: () => {
            try { return document.querySelector('[class*="_toBottomSlot"]') } catch (_) { return null }
          },
          /** 官方回到底部按钮本体（:not 排除命名含 Slot 的槽层）。 */
          toBottomButton: (slot) => {
            try { return slot.querySelector('[class*="_toBottom"]:not([class*="Slot"])') } catch (_) { return null }
          },
          /** 从槽位向上找会话滚动容器（官方 [data-conversation-scroll]）；走不通时回退槽位父节点。 */
          scrollportOf: (slot) => {
            try {
              let node = slot
              while (node !== null && node !== document.documentElement && !hasScrollAttr(node)) {
                node = node.parentNode
              }
              return node !== null && node !== document.documentElement ? node : slot.parentNode
            } catch (_) { return null }
          },
          /** 官方回合导航条（0.1.2-alpha.2 新增 TurnNavigator，聊天右缘 rail）。
           *  官方双门控：已加载回合 <2 不渲染 + @container (width<=900px) 整条隐藏
           *  ——移动端/窄窗永远没有官方导航。v1.1.1 曾做过「rail 可见时上箭头让位」，
           *  用户实测反馈否决：官方 rail 是回合级跳转（仅桌面宽窗），上箭头是
           *  「上一条用户回复」逐条步进（全平台），语义不同、位置垂直错开，共存不冲突。
           *  保留探测能力仅供调试/未来参考，不再参与显隐。 */
          officialTurnNavigatorVisible: (scroll) => {
            try {
              if (typeof getComputedStyle !== 'function') return false
              if (scroll === null || typeof scroll.querySelector !== 'function') return false
              const rail = scroll.querySelector('[class*="_rail"]')
              if (rail === null) return false
              return getComputedStyle(rail).display !== 'none'
            } catch (_) { return false }
          },
          /** 已渲染的用户回复行快照（官方 data-chat-flow-kind="user"）。 */
          userRows: (scroll) => {
            const rows = []
            try {
              if (typeof scroll.querySelectorAll !== 'function') return rows
              for (const row of scroll.querySelectorAll('[data-chat-flow-kind="user"]')) rows.push(row)
            } catch (_) {}
            return rows
          },
          /** 行的滚动视口坐标（0=视口顶、负=已滚出上方，与官方 pagingAnchor 同系）。 */
          flowTopOf: (scroll, row) => {
            try { return row.getBoundingClientRect().top - scroll.getBoundingClientRect().top } catch (_) { return 0 }
          },
          /** 官方「加载更早」分页按钮（历史加载完即从 DOM 消失）。 */
          loadOlderButton: (scroll) => {
            try {
              return typeof scroll.querySelector === 'function' ? scroll.querySelector('[class*="_older"] button') : null
            } catch (_) { return null }
          },
        }
      }

      /**
       * 全平台「跳上一条用户回复」引擎：
       * 在官方「回到底部」按钮（to-bottom 槽位，哈希后缀 _toBottomSlot 匹配，
       * rc.2 Md3f7G_ / 0.1.2-alpha.2 EvIC1a_）内注入
       * 同款圆形上箭头按钮（absolute bottom:42px → 稳居官方按钮上方 8px），
       * 随该按钮成组显隐（离开底部才渲染）、跟随 composer 高度偏移。
       * 点击按官方 data-chat-flow-kind="user" 行定位上一条用户回复（流程坐标
       * flowTop = rect.top - scrollport.rect.top，与官方 pagingAnchor 同系），
       * 逐击向上步进；程序化滚动天然受沉浸引擎 800ms 手势窗口免疫。
       * 0.1.2-alpha.2 官方自带回合导航条（TurnNavigator rail，桌面宽窗可见）：
       * 它是回合级跳转，本按钮是「上一条用户回复」逐条步进——语义位置都不同，
       * 历来共存；曾试过「rail 可见即让位」，用户实测否决后回退共存。
       * 与 mobileAdaptation 无关：不依赖 matchMedia、不引用 any 移动属性。
       * v0.36.4 三处真机反馈修正：
       *  ① 图标严格克隆官方按钮内 svg（旋转 180°），不再手绘近似；
       *  ② 桌面 right 对齐实测「slot 右缘 − 官方按钮右缘」（slot 的 padding-right
       *     会把 absolute right:0 推到内容区之外，桌面差一整个侧清理）；
       *  ③ 目标不存在时自动点击「加载更早」（older 分页按钮）并短窗重试，
       *     直到新历史里找到目标或按钮消失/重试耗尽。
       * v0.36.6 iPhone 白屏修复：跳转一律瞬时 scrollTop 直接赋值，绝不
       *   scrollTo({behavior:'smooth'})——真机排查（2026-08-27）：iOS WebKit 上
       *   smooth 滚动 + sticky composer/transform 变换层会让合成层不重绘（点按
       *   上箭头 → 视口白屏，再触发一次滚动才恢复）；Android/桌面 Blink 均无此
       *   问题，官方全应用滚动也从来只用瞬时赋值。别把动画加回来。
       */
      const createUserJump = (labelOf) => {
        const state = { observer: null, btn: null, styleTag: null, retryTimer: null, retryLeft: 0, scrollHandler: null, rafId: null, slotRO: null }
        const nav = createConversationNav()
        const cancelRetryTimer = () => {
          if (state.retryTimer === null) return
          try { state.retryTimer() } catch (_) {}
          state.retryTimer = null
        }
        const UP_SVG_FALLBACK =
          '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
          '<path d="M7 10.5V3.5M3.5 7 7 3.5 10.5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

        /**
         * 按钮显隐（v0.36.5 用户点名：达到最顶部后隐藏）：
         * 还有「可跳的上一条」（flowTop<4 的 user 行）或还有官方「加载更早」
         * （点了能加载出更早目标）→ 显示；两者皆无（真正到顶且历史已加载完）→ 隐藏。
         * v1.1.1 曾加「官方回合导航条可见即让位」：实测被用户否决——官方 rail 是
         * 回合级跳转（≤900px 容器整条隐藏，移动端永远没有），上箭头是「上一条
         * 用户回复」逐条步进，语义与位置都不同，两代共存，显隐只由可达目标驱动。
         */
        const updateVisibility = () => {
          if (state.btn === null || !state.btn.isConnected) return
          try {
            const slot = nav.toBottomSlot()
            if (slot === null) return
            const scroll = nav.scrollportOf(slot)
            if (scroll === null || typeof scroll.querySelectorAll !== 'function') return
            let hasTarget = false
            for (const row of nav.userRows(scroll)) {
              if (nav.flowTopOf(scroll, row) < 4) { hasTarget = true; break }
            }
            const hasOlder = nav.loadOlderButton(scroll) !== null
            state.btn.style.display = hasTarget || hasOlder ? 'flex' : 'none'
            syncPosition()
          } catch (_) {}
        }

        /** 克隆官方回到底部按钮内的 svg 并旋转 180° → 图标与官方严格一致。 */
        const officialUpSvg = (slot) => {
          try {
            const source = nav.toBottomButton(slot)
            const svg = source !== null ? source.querySelector('svg') : null
            if (svg !== null && typeof svg.outerHTML === 'string') {
              return svg.outerHTML.replace(/<svg/i, '<svg style="transform:rotate(180deg)"')
            }
          } catch (_) {}
          return UP_SVG_FALLBACK
        }

        /** 实时重测右缘对齐（v1.1.1）：官方 WidthHandle 拖动会改 --dsh-chat-content-width
         *  → 槽位 padding-right 变化 → 官方按钮右移；absolute right 是挂载时量的一次性
         *  偏移，不会跟随。ResizeObserver 观察槽位 content-box（padding 变化即触发）
         *  重测「slot 右缘 − 官方按钮右缘」；滚动驱动的 updateVisibility 顺带再校一次。 */
        const syncPosition = () => {
          if (state.btn === null || !state.btn.isConnected) return
          try {
            const slot = nav.toBottomSlot()
            if (slot === null || typeof slot.querySelector !== 'function') return
            const official = nav.toBottomButton(slot)
            let rightGap = 0
            if (official !== null) {
              const slotRight = slot.getBoundingClientRect().right
              const officialRight = official.getBoundingClientRect().right
              rightGap = Math.max(0, Math.round(slotRight - officialRight))
            }
            const next = `${rightGap}px`
            if (state.btn.style.right !== next) state.btn.style.right = next
          } catch (_) {}
        }

        /** 槽位 content-box 尺寸变化的观察：只挂当前槽位，重建即重挂。 */
        const attachSlotRO = () => {
          if (typeof ResizeObserver !== 'function') return
          if (state.slotRO !== null) {
            try { state.slotRO.disconnect() } catch (_) {}
            state.slotRO = null
          }
          try {
            const slot = nav.toBottomSlot()
            if (slot === null) return
            const ro = new ResizeObserver(() => { syncPosition() })
            ro.observe(slot)
            state.slotRO = ro
          } catch (_) {
            state.slotRO = null
          }
        }

        const mount = () => {
          if (state.btn !== null && state.btn.isConnected) return
          try {
            const slot = nav.toBottomSlot()
            if (slot === null || typeof slot.appendChild !== 'function' || typeof slot.querySelector !== 'function') return
            const official = nav.toBottomButton(slot)
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.setAttribute('data-dshsvc-user-jump', '')
            btn.setAttribute('aria-label', labelOf())
            // 桌面 slot 有 padding-right（内容区居中垫白）→ absolute right:0 会比
            // 官方按钮偏右一整个 padding；实测「slot 右缘 − 官方按钮右缘」对齐。
            // 拖动调宽后由 attachSlotRO → syncPosition 持续跟随官方按钮右缘。
            let rightGap = 0
            try {
              if (official !== null) {
                const slotRight = slot.getBoundingClientRect().right
                const officialRight = official.getBoundingClientRect().right
                rightGap = Math.max(0, Math.round(slotRight - officialRight))
              }
            } catch (_) {}
            Object.assign(btn.style, {
              position: 'absolute', right: `${rightGap}px`, bottom: '42px', zIndex: '1',
              width: '34px', height: '34px', padding: '0', cursor: 'pointer',
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-button-floating-fill)',
              color: 'var(--dsw-alias-label-primary)',
              boxShadow: 'var(--dsw-shadow-lv2)',
              borderRadius: '100px', display: 'flex', alignItems: 'center',
              justifyContent: 'center', pointerEvents: 'auto',
            })
            btn.innerHTML = officialUpSvg(slot)
            btn.addEventListener('click', () => {
              const scroll = nav.scrollportOf(slot)
              if (scroll === null || typeof scroll.querySelectorAll !== 'function') return
              const baseScrollTop = Number(scroll.scrollTop) || 0
              // flowTop 与 scrollTop 不同系：flowTop 是相对滚动视口的坐标（0=视口顶，
              // 负=上方）。「上一条用户回复」= flowTop<4（已滚出视口顶之上）的最后一行；
              // 目标文档坐标 = scrollTop + flowTop − 顶部留白。
              const jumpOnce = () => {
                state.retryTimer = null
                // 官方 loadOlderAnchored 加载后会按锚点移动视口（常把视口拉去别处）——
                // 以点击时的基准视口为准即时拉回，避免跳转目标被劫持。
                const now = Number(scroll.scrollTop) || 0
                if (Math.abs(now - baseScrollTop) > 40) {
                  try { scroll.scrollTop = baseScrollTop } catch (_) {}
                }
                const rows = nav.userRows(scroll)
                let target = null
                for (let i = rows.length - 1; i >= 0; i -= 1) {
                  if (nav.flowTopOf(scroll, rows[i]) < 4) { target = rows[i]; break }
                }
                if (target !== null) {
                  const top = Math.max(0, baseScrollTop + nav.flowTopOf(scroll, target) - 12)
                  try { scroll.scrollTop = top } catch (_) {}
                  return
                }
                // 目标不在已加载历史里：官方「加载更早」分页按钮还在 → 持续加载直到
                // 目标出现或历史尽头（按钮消失）。每个 220ms 窗口都消耗一次配额，
                // disabled 只是不重复点击，绝不能因此把约 4.4s 上限变成无限等待。
                if (state.retryLeft <= 0) return
                state.retryLeft -= 1
                const older = nav.loadOlderButton(scroll)
                if (older === null) return // 历史已全部加载且无目标 → 停（按钮随显隐规则隐藏）
                if (older.disabled !== true) {
                  try { older.click() } catch (_) { /* 官方 loading 态下点击无害 */ }
                }
                state.retryTimer = ctx.timer.timeout(jumpOnce, 220)
              }
              cancelRetryTimer()
              state.retryLeft = 20 // 最多约 4.4s 的加载重试窗（多批分页），防无限加载
              jumpOnce()
            })
            slot.appendChild(btn)
            state.btn = btn
            attachSlotRO()
            updateVisibility()
          } catch (_) { /* 外壳结构变化期间探不到槽位时静默等待下轮 */ }
        }

        const start = () => {
          try {
            if (state.styleTag === null) {
              const tag = document.createElement('style')
              tag.dataset.plugin = '@gehennawu/dsh-service'
              tag.dataset.pluginCss = '@gehennawu/dsh-service/user-jump.css'
              tag.textContent =
                '[data-dshsvc-user-jump]:hover,[data-dshsvc-user-jump]:active{background:var(--dsw-alias-button-floating-hover)!important}'
              document.head.appendChild(tag)
              state.styleTag = tag
            }
          } catch (_) {}
          mount()
          if (state.observer !== null) return
          try {
            state.observer = new MutationObserver(() => { mount(); updateVisibility() })
            state.observer.observe(document.documentElement, { childList: true, subtree: true })
          } catch (_) {
            state.observer = null
          }
          if (state.scrollHandler === null) {
            try {
              state.scrollHandler = () => {
                if (typeof requestAnimationFrame === 'function') {
                  if (state.rafId !== null) return
                  state.rafId = requestAnimationFrame(() => { state.rafId = null; updateVisibility() })
                } else {
                  updateVisibility()
                }
              }
              document.documentElement.addEventListener('scroll', state.scrollHandler, true)
            } catch (_) {
              state.scrollHandler = null
            }
          }
        }

        const stop = () => {
          cancelRetryTimer()
          if (state.slotRO !== null) {
            try { state.slotRO.disconnect() } catch (_) {}
            state.slotRO = null
          }
          if (state.scrollHandler !== null) {
            try { document.documentElement.removeEventListener('scroll', state.scrollHandler, true) } catch (_) {}
            state.scrollHandler = null
          }
          if (state.rafId !== null) {
            try { cancelAnimationFrame(state.rafId) } catch (_) {}
            state.rafId = null
          }
          if (state.observer !== null) {
            try { state.observer.disconnect() } catch (_) {}
            state.observer = null
          }
          if (state.btn !== null) {
            try { state.btn.remove() } catch (_) {}
            state.btn = null
          }
          if (state.styleTag !== null) {
            try { state.styleTag.remove() } catch (_) {}
            state.styleTag = null
          }
        }

        return { start, stop }
      }

      const userJump = createUserJump(() => t('conversation.jump.previousReply'))
      ctx.effect(() => {
        userJump.start()
        return () => userJump.stop()
      }, 'dsh-service user reply jump')

      const mobileEngine = createMobileAdaptation()
      ctx.effect(() => {
        const unsubscribeFeatures = featureScope.subscribe(() => mobileEngine.evaluate())
        mobileEngine.evaluate()
        return () => {
          unsubscribeFeatures()
          mobileEngine.dispose()
        }
      }, 'dsh-service mobile adaptation')
    }

    exports.inject = inject
    exports.apply = apply
    // v1.2 回合尾模型行的纯逻辑出口：仅供自动化测试直达，运行时无消费者。
    exports.subagentTurnTail = { aggregateSubagentRoutes, selectSubagentModelsTurnTail, subagentRouteListText }
    return module.exports
  },
})
