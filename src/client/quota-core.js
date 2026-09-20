// 客户端半分片：额度核心——卡片排序/显隐后端、轮询分钟档、快照合并去重、额度循环
// （acquire/release/settle/cycle）、窗口文案与时间格式化工具。
// 分片不是模块——按 scripts/client-source.mjs 清单拼接成同一个 factory 作用域。
// 卡片配置经订阅/提交/重置接口访问，监听器与写入协议留在核心内部。
function createQuotaCore({ ctx, rpcCall, featureEnabled, getModelDirectories, sessionActivity, createSectionBackendSync, SETTINGS_NAV_MAX_ITEMS, formatCompactCount }) {
  const { useState, useEffect } = React
      // 适配类型下拉选项：与宿主 QUOTA_KINDS 白名单保持一致（词典键 quota.kind.<kind>）。
      const QUOTA_KIND_OPTIONS = ['opencode-go', 'zai-coding-cn', 'openrouter', 'kimi', 'siliconflow', 'deepseek', 'stepfun', 'stepfun-step-plan', 'xiaomi-token-plan-cn', 'cliproxy', 'command-goat']
      const QUOTA_CARD_ORDER_KEY = 'dsh-service-quota-card-order'
      const QUOTA_CARD_HIDDEN_KEY = 'dsh-service-quota-card-hidden'
      // 供应商名由 settings / llm 渠道清单派生，可能含中文、空格、`@`（用户自定义键），
      // 不套设置栏的 ID 字符集；只约束类型、非空与长度，真实内容白名单是「快照里存在的
      // provider」——不在快照里的名字既不渲染、也不参与排序。
      const QUOTA_CARD_NAME_MAX = 128
      const readQuotaCardNameList = (storageKey, fallback) => {
        try {
          const raw = localStorage.getItem(storageKey)
          if (!raw) return fallback
          const parsed = JSON.parse(raw)
          if (!Array.isArray(parsed) || parsed.length > SETTINGS_NAV_MAX_ITEMS) return fallback
          if (!parsed.every((name) => typeof name === 'string' && name.trim() !== '' && name.trim().length <= QUOTA_CARD_NAME_MAX)) return fallback
          return parsed.map((name) => name.trim())
        } catch (_) {
          return fallback
        }
      }
      // 卡片手动排序与显隐：localStorage 只存 provider 名单；坏形状/超限整体回退快照序。
      const readQuotaCardOrder = () => readQuotaCardNameList(QUOTA_CARD_ORDER_KEY, [])
      const readQuotaCardHidden = () => readQuotaCardNameList(QUOTA_CARD_HIDDEN_KEY, [])
      const writeQuotaCardOrder = (order) => {
        try {
          if (order === null) localStorage.removeItem(QUOTA_CARD_ORDER_KEY)
          else localStorage.setItem(QUOTA_CARD_ORDER_KEY, JSON.stringify(order.slice(0, SETTINGS_NAV_MAX_ITEMS)))
        } catch (_) {}
      }
      const writeQuotaCardHidden = (hidden) => {
        try {
          if (hidden === null || hidden.length === 0) localStorage.removeItem(QUOTA_CARD_HIDDEN_KEY)
          else localStorage.setItem(QUOTA_CARD_HIDDEN_KEY, JSON.stringify(hidden.slice(0, SETTINGS_NAV_MAX_ITEMS)))
        } catch (_) {}
      }
      const quotaCardListeners = new Set()
      const notifyQuotaCardsChanged = () => {
        for (const listener of quotaCardListeners) {
          try { listener() } catch (_) {}
        }
      }
      // 与设置栏标签同款的多端同步（同一份 createSectionBackendSync 实现）。
      const quotaCardsBackend = createSectionBackendSync({
        section: 'quotaCards',
        readOrder: () => readQuotaCardOrder(),
        readHidden: () => readQuotaCardHidden(),
        writeLocal: (order, hidden) => {
          writeQuotaCardOrder(order)
          writeQuotaCardHidden(hidden)
          notifyQuotaCardsChanged()
        },
      })
      // 卡片配置的写入协议由核心持有，调用方不接触监听器集合或后端同步对象。
      const subscribeQuotaCards = (listener) => {
        quotaCardListeners.add(listener)
        return () => quotaCardListeners.delete(listener)
      }
      const commitQuotaCards = (order, hidden) => {
        writeQuotaCardOrder(order)
        writeQuotaCardHidden(hidden)
        notifyQuotaCardsChanged()
        quotaCardsBackend.persist(order, hidden)
      }
      const resetQuotaCards = () => {
        writeQuotaCardOrder(null)
        writeQuotaCardHidden(null)
        notifyQuotaCardsChanged()
        quotaCardsBackend.persistReset()
      }
      const ensureQuotaCardsSynced = () => quotaCardsBackend.ensureSynced()
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
      // 直到上游落定或用尽轮次——否则首次打开只会看到「刷新中…」，要再次点开才能看到更新时间。
      // 这是唯一残留的自动补拉（无周期轮询），仍走普通 quota RPC，宿主节流闸
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
      const quotaLoop = { refs: 0, allRefs: 0, running: false }
      function runQuotaCycle() {
        if (!featureEnabled('quotaLookup') || quotaLoop.refs === 0 || quotaLoop.running === true) return
        // 额度页打开时全量；圆环表面只刷新 running 会话供应商。手动刷新入口与
        // 落定补拉直接走 fetchQuotaSnapshot，不经过这里。
        const payload = quotaLoop.allRefs > 0 ? { scope: 'all' } : { providers: runningQuotaProviders() }
        if (payload.scope !== 'all' && payload.providers.length === 0) return
        quotaLoop.running = true
        Promise.resolve(fetchQuotaSnapshot(payload)).catch(() => false).then(() => {
          quotaLoop.running = false
        })
      }
      function acquireQuotaLoop(options = {}) {
        if (!featureEnabled('quotaLookup')) return
        quotaLoop.refs += 1
        if (options.all === true) quotaLoop.allRefs += 1
        // 无自动轮询：挂载即拉一次当前口径的快照，之后完全由手动刷新/交互触发。
        if (options.all === true) fetchQuotaSnapshot({ scope: 'all' })
        else runQuotaCycle()
      }
      function releaseQuotaLoop(options = {}) {
        if (!featureEnabled('quotaLookup') && quotaLoop.refs === 0) return
        quotaLoop.refs = Math.max(0, quotaLoop.refs - 1)
        if (options.all === true) quotaLoop.allRefs = Math.max(0, quotaLoop.allRefs - 1)
        if (quotaLoop.refs > 0) return
        if (quotaSettle.dispose !== null) {
          quotaSettle.dispose()
          quotaSettle.dispose = null
        }
      }
      ctx.effect(() => () => {
        if (quotaSettle.dispose !== null) quotaSettle.dispose()
      }, 'dsh-service quota snapshot disposal')

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
       * 与控制台「{{used}} / {{limit}}」口径一致——只有比例没有绝对数会丢掉最关键的剩余信息。
       * `unit`（宿主声明的量纲）决定绝对数的呈现：`usd` 是金额（两位小数 + `$`），
       * 缺省按 token 数缩写（K/M/B）——token 数与金额要用两套格式，不能共用一种缩写。 */
      function quotaWindowValueText(window) {
        const percent = `${window.percent}%`
        const used = Number(window.used)
        const limit = Number(window.limit)
        if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return percent
        if (window.unit === 'usd') {
          return `${percent} · $${used.toFixed(2)} / $${limit.toFixed(2)}`
        }
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

      // ─── 余额型油表基准管理与状态计算（#todo-77）───────────────
      const QUOTA_BALANCE_BASELINE_KEY = 'dsh-service-quota-balance-baseline'

      function readQuotaBalanceBaselines() {
        try {
          const raw = localStorage.getItem(QUOTA_BALANCE_BASELINE_KEY)
          if (!raw) return {}
          const parsed = JSON.parse(raw)
          return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
        } catch (_) {
          return {}
        }
      }

      function writeQuotaBalanceBaselines(data) {
        try {
          if (!data || Object.keys(data).length === 0) {
            localStorage.removeItem(QUOTA_BALANCE_BASELINE_KEY)
          } else {
            localStorage.setItem(QUOTA_BALANCE_BASELINE_KEY, JSON.stringify(data))
          }
        } catch (_) {}
      }

      /**
       * 提取余额窗口的主要金额与币种信息。
       * 纯文本窗口（DeepSeek/Kimi/硅基流动/StepFun 等）且无百分比窗口时使用。
       */
      function quotaExtractBalance(windows) {
        if (!Array.isArray(windows) || windows.length === 0) return null
        const candidate = windows.find((w) => w.kindKey === 'balance')
          || windows.find((w) => typeof w.id === 'string' && w.id.startsWith('balance'))
          || windows.find((w) => typeof w.text === 'string' && /^[¥$€£]|\b(CNY|USD|EUR|GBP)\b/.test(w.text))
        if (!candidate || typeof candidate.text !== 'string') return null
        const text = candidate.text.trim()
        let currency = 'CNY'
        let symbol = '¥'
        if (text.startsWith('$') || candidate.label === 'USD' || text.toUpperCase().includes('USD')) {
          currency = 'USD'
          symbol = '$'
        } else if (text.startsWith('€') || candidate.label === 'EUR' || text.toUpperCase().includes('EUR')) {
          currency = 'EUR'
          symbol = '€'
        } else if (text.startsWith('£') || candidate.label === 'GBP' || text.toUpperCase().includes('GBP')) {
          currency = 'GBP'
          symbol = '£'
        }
        const numStr = text.replace(/[^0-9.]/g, '')
        const amount = Number(numStr)
        if (!Number.isFinite(amount)) return null
        return { amount, currency, symbol, rawText: text, window: candidate }
      }

      /**
       * 获取或更新特定 provider 的动态满额基准。
       * - 保底基准：USD 为 5，其他（CNY）为 20。
       * - 首次读取：Math.max(currentAmount, floor)。
       * - 充值判定：当前金额明显大于上次记录余额（> lastBalance + 0.5）或超过基准时，更新基准为当前金额与保底值之较大者。
       */
      function resolveBalanceBaseline(provider, currentAmount, currency) {
        if (typeof provider !== 'string' || provider === '' || !Number.isFinite(currentAmount)) return null
        const floor = currency === 'USD' ? 5 : 20
        const baselines = readQuotaBalanceBaselines()
        const record = baselines[provider]
        let baseline = floor

        if (!record || typeof record.baseline !== 'number' || !Number.isFinite(record.baseline)) {
          baseline = Math.max(currentAmount, floor)
          baselines[provider] = { baseline, lastBalance: currentAmount, updatedAt: Date.now() }
          writeQuotaBalanceBaselines(baselines)
        } else {
          baseline = record.baseline
          const prevLast = typeof record.lastBalance === 'number' ? record.lastBalance : baseline
          if (currentAmount > baseline || currentAmount > prevLast + 0.5) {
            baseline = Math.max(currentAmount, floor)
            baselines[provider] = { baseline, lastBalance: currentAmount, updatedAt: Date.now() }
            writeQuotaBalanceBaselines(baselines)
          } else if (Math.abs(currentAmount - prevLast) > 0.001) {
            baselines[provider] = { ...record, lastBalance: currentAmount, updatedAt: Date.now() }
            writeQuotaBalanceBaselines(baselines)
          }
        }

        return baseline
      }

      /**
       * 手动将当前金额标定为满额基准。
       * 人工显式标定时以当前数值为准（仅防非正数），不强制叠加自动保底，确保点击即生效。
       */
      function setManualBalanceBaseline(provider, manualAmount, currency) {
        if (typeof provider !== 'string' || provider === '' || !Number.isFinite(manualAmount) || manualAmount <= 0) return null
        const baseline = Math.round(manualAmount * 100) / 100
        const baselines = readQuotaBalanceBaselines()
        baselines[provider] = { baseline, lastBalance: manualAmount, updatedAt: Date.now() }
        writeQuotaBalanceBaselines(baselines)
        return baseline
      }

      /**
       * 计算油表状态（比例、档位、颜色、角度）。
       */
      function computeBalanceGaugeState(amount, baseline, currency) {
        const safeBaseline = Number.isFinite(baseline) && baseline > 0 ? baseline : (currency === 'USD' ? 5 : 20)
        const rawRatio = (amount / safeBaseline) * 100
        const ratio = Math.min(100, Math.max(0, Math.round(rawRatio)))
        const isExtremeLow = currency === 'USD' ? amount <= 0.5 : amount <= 2.0
        const isComfortableHigh = currency === 'USD' ? amount >= 10.0 : amount >= 50.0

        let gear = 'high'
        let color = 'var(--dsw-alias-state-success-primary)'

        if (amount <= 0 || isExtremeLow) {
          gear = 'low'
          color = 'var(--dsw-alias-state-error-primary)'
        } else if (ratio < 20) {
          if (isComfortableHigh) {
            gear = 'mid'
            color = 'var(--dsw-alias-state-warn-primary)'
          } else {
            gear = 'low'
            color = 'var(--dsw-alias-state-error-primary)'
          }
        } else if (ratio < 50) {
          gear = 'mid'
          color = 'var(--dsw-alias-state-warn-primary)'
        } else {
          gear = 'high'
          color = 'var(--dsw-alias-state-success-primary)'
        }

        const needleAngle = -90 + (ratio / 100) * 180

        return { ratio, gear, color, needleAngle, baseline: safeBaseline, isExtremeLow, isComfortableHigh }
      }
  return { QUOTA_KIND_OPTIONS, acquireQuotaLoop, applyQuotaCardOrder, formatClockTime, formatShortDate, humanizeDuration, subscribeQuotaCards, commitQuotaCards, resetQuotaCards, ensureQuotaCardsSynced, quotaWindowDisplayLabel, quotaWindowValueText, readQuotaCardHidden, readQuotaCardOrder, releaseQuotaLoop, quotaExtractBalance, resolveBalanceBaseline, setManualBalanceBaseline, computeBalanceGaugeState, fetchQuotaSnapshot }
}
