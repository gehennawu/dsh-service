// 客户端半分片：版本/重启流子系统——恢复(recovery)·重启流·运行环境·已装版本四组共享状态机、
// 版本快照拉取、进程身份同步、升级在途闸、semver 工具与 Service/Restart 覆盖层、RestartSection。
// 分片不是模块——按 scripts/client-source.mjs 清单拼接成同一个 factory 作用域；正文与拆分前
// 逐字节一致。upgradeInFlight/runtimeEnvState 两个 let 的区域外读写经访问器暴露
// （isUpgradeInFlight/setUpgradeInFlight/getRuntimeEnvState），let 本体留在厂内保持单事实源。
function createVersionRestartFlow({ ctx, rpcCall, t, useTranslation, restartNavToggle }) {
  const { useState, useEffect } = React
      const recoveryListeners = new Set()
      let recoveryState = { status: 'idle', elapsedMs: 0 }
      let recoveryGeneration = 0

      const setRecoveryState = (next) => {
        recoveryState = next
        for (const listener of recoveryListeners) listener(next)
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
      // 磁盘已安装版本（与 runtimeEnv 同随 version RPC 返回）：运行中的 pluginVersion 要等进程
      // 重启才变，磁盘版本升级落地即变——两者不一致 = 「已装好、待重启生效」。null = 旧宿主
      // 未返回该字段或尚未拉取，一律静默退回现状。
      const installedVersionListeners = new Set()
      let installedVersionState = null
      const setInstalledVersionState = (next) => {
        installedVersionState = next
        for (const listener of installedVersionListeners) listener(next)
      }
      const useInstalledVersion = () => {
        const [snapshot, setSnapshot] = useState(installedVersionState)
        useEffect(() => {
          installedVersionListeners.add(setSnapshot)
          setSnapshot(installedVersionState)
          return () => installedVersionListeners.delete(setSnapshot)
        }, [])
        return snapshot
      }
      // 形状校验后才入库（非空字符串、无空白、长度上限）：坏值视同旧宿主，
      // 绝不让坏值把界面误判成「已装好待重启」而收起升级按钮。
      const applyInstalledVersion = (value) => {
        const raw = value ? value.installedVersion : undefined
        const next = typeof raw === 'string' && raw.length > 0 && raw.length <= 64 && !/\s/.test(raw) ? raw : null
        if (next !== installedVersionState) setInstalledVersionState(next)
      }
      // version 快照全插件只取一次：ServicePanel 与左列入口无论谁先挂载都共享同一请求，
      // 升级前取 instanceId/运行环境也复用它。失败清缓存，下一个消费者重试。
      let versionSnapshotPromise = null
      const fetchVersionSnapshot = () => {
        if (versionSnapshotPromise === null) {
          versionSnapshotPromise = rpcCall('version', {})
            .then((res) => {
              if (res && res.ok) {
                applyVersionRuntimeEnv(res.value)
                applyInstalledVersion(res.value)
              }
              return res
            })
            .catch(() => {
              versionSnapshotPromise = null
              return null
            })
        }
        return versionSnapshotPromise
      }
      // 升级落地后必须重取：缓存快照里的 installedVersion 还是升级前那份，不刷新就还会
      // 显示升级按钮（用户报的「以为没升级成功」，2026-09-12）。
      const refreshVersionSnapshot = () => {
        versionSnapshotPromise = null
        return fetchVersionSnapshot()
      }
      // 页面加载时的进程身份基线：/restart 是**宿主命令**（commands.register → exit(42)），
      // 不经过客户端「重启」按钮，客户端拿不到 previousInstanceId；于是每个连接世代建立时
      // 重取一次 instanceId，与基线比对——不同即新进程已起，照按钮那条路刷新页面。
      // 基线不能懒取：用户在对话里敲 /restart 时设置面板通常从未打开过，那时也必须已有基线。
      // 判据仍然只有一条：instanceId 变化 = 新进程；断线重连本身绝不触发刷新（AGENTS.md 不变量）。
      let bootInstanceId = null
      const syncProcessIdentity = async (fresh) => {
        // 重连时必须实拉（缓存里那份还是老进程的），首次建立基线则可以复用共享快照，
        // 避免与设置面板的首帧请求重复一次。
        const res = await (fresh === true ? refreshVersionSnapshot() : fetchVersionSnapshot())
        const nextInstanceId = res && res.ok ? res.value && res.value.instanceId : undefined
        if (typeof nextInstanceId !== 'string' || nextInstanceId.length === 0) return
        if (bootInstanceId === null) {
          bootInstanceId = nextInstanceId
          return
        }
        if (nextInstanceId !== bootInstanceId) window.location.reload()
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
      }, 'dsh-service recovery')

      // 宿主命令重启（对话里的 /restart）没有客户端发起方：新进程上线时 connection 会起一个
      // 新世代并广播 connection/reset，这里借此比对 instanceId 完成「自动刷新」——
      // 与「重启」按钮的恢复轮询同判据、同结果（按钮路径仍走轮询，两条路互不干扰）。
      ctx.effect(() => {
        const dispose = ctx.on('connection/reset', () => { syncProcessIdentity(true).catch(() => {}) })
        syncProcessIdentity(false).catch(() => {})
        return dispose
      }, 'dsh-service process identity')

      // 正式/预览/Alpha 通道行：版本号后跟 npmjs（版本页）与 npmmirror（镜像版本页）两个文字链接。
      // 版本串嵌进 URL 前过安全字符集校验，不过校验的标签降级为纯文本。供版本卡行内展开使用。
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

      // 版本支持边界（v1.4.12/0.1.6 适配轮）：0.1.3-alpha.1 起旧 sessionPersistence seam 移除、
      // 0.1.5 起 layout Details 列移除 + 会话格式 V3、0.1.6-alpha.1 起 announce 改异步串行
      // 与 Sh0Q9G_ 类哈希漂移——本版已全部完成适配（docs/research/dsh-v0.1.6-alpha.1-plugin-impact.md）。
      // 边界钉在 0.1.6-alpha.3：其后的版本尚未验证，运行版本越界时版本卡声明行转红警示；
      // 无法解析的版本串（如 unknown）按不支持判空、中性展示。
      const DSH_NOT_SUPPORTED_FROM = '0.1.6-alpha.3'
      const parseSemver = (value) => {
        if (typeof value !== 'string') return null
        const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value)
        if (!match) return null
        return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ? match[4].split('.') : null }
      }
      const semverIdentifier = (id) => (/^\d+$/.test(id) ? Number(id) : id)
      const compareSemver = (a, b) => {
        const pa = parseSemver(a)
        const pb = parseSemver(b)
        if (!pa || !pb) return null
        for (const key of ['major', 'minor', 'patch']) {
          if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1
        }
        if (pa.pre === null && pb.pre === null) return 0
        if (pa.pre === null) return 1
        if (pb.pre === null) return -1
        const length = Math.min(pa.pre.length, pb.pre.length)
        for (let i = 0; i < length; i += 1) {
          const ia = semverIdentifier(pa.pre[i])
          const ib = semverIdentifier(pb.pre[i])
          if (ia === ib) continue
          if (typeof ia === 'number' && typeof ib === 'number') return ia < ib ? -1 : 1
          if (typeof ia === 'string' && typeof ib === 'string') return ia < ib ? -1 : 1
          return typeof ia === 'number' ? -1 : 1
        }
        return pa.pre.length < pb.pre.length ? -1 : pa.pre.length === pb.pre.length ? 0 : 1
      }
      const isDshUnsupported = (current) => {
        const cmp = compareSemver(current, DSH_NOT_SUPPORTED_FROM)
        return cmp !== null && cmp >= 0
      }

      function ServiceOverlay() {
        const recovery = useRecoveryState()
        const translate = useTranslation()
        if (recovery.status === 'idle') return null

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
                    style: { width: '34px', height: '20px', ...fullRound('10px'), padding: 0, flexShrink: 0, position: 'relative', border: `1px solid ${navEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'}`, background: navEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: 'pointer', lineHeight: 0 },
                  }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: navEnabled ? '15px' : '1px', width: '16px', height: '16px', ...fullRound('50%'), background: navEnabled ? '#fff' : 'var(--dsw-alias-label-tertiary)' } })))
              : null)
        )
      }
  // 区域外读写 upgradeInFlight/runtimeEnvState 两个 let 的访问器：let 本体留在厂内单事实源，
  // ServicePanel 升级两段式与健康快照经此跨界（原裸赋值/裸读的等价替换）。
  const isUpgradeInFlight = () => upgradeInFlight
  const setUpgradeInFlight = (value) => { upgradeInFlight = value }
  const getRuntimeEnvState = () => runtimeEnvState
  return { DSH_NOT_SUPPORTED_FROM, RestartOverlay, RestartSection, channelLines, compareSemver, fetchVersionSnapshot, isDshUnsupported, refreshVersionSnapshot, startRecovery, useInstalledVersion, useRestartFlow, useRuntimeEnv, isUpgradeInFlight, setUpgradeInFlight, getRuntimeEnvState }
}
