// 额度查询（quota）的 RPC 端点：从 apply 的端点表按功能域拆出。
// 依赖显式注入（工厂解构名单即本模块完整依赖面）；handler 体与拆分前逐字一致。
// 注意：客户端半有单产物约束，宿主半无此约束——兄弟 ESM 模块是本仓库既有惯例
// （quota-adapters.js / backup-integrity.js / plugin-health.js / plugin-compat.js）。

import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { prepareQuotaAdapterConfig, quotaAdapterUsageUrl } from './quota-adapters.js'

export function createQuotaRoutes({
  ctx,
  kickQuotaRefresh,
  quotaThrottle,
  refreshQuotaConfigCache,
  serializeQuotaConfigWrite,
  MAX_QUOTA_PROVIDER_NAME,
  MAX_QUOTA_RESET_CARDS,
  MAX_QUOTA_RESET_CARDS_PER_PROVIDER,
  MAX_QUOTA_RESET_CARD_ACCOUNT,
  canonicalResetCardExpiresAt,
  QUOTA_ADAPTER_BY_KIND,
  name,
  quotaCredentialConfigured,
  quotaCredentialEndpoint,
  quotaCredentialHintNames,
  readQuotaProfiles,
  resolveQuotaKind,
  rpcTechnicalFailure,
}) {
  return {
    'quota': { feature: 'quotaLookup', handle: async (payload, rpcEndpoint) => {
      try {
        const providers = readQuotaProfiles(ctx.get('settings'), ctx.get('llm'))
        quotaThrottle.prune(new Set(providers.map((profile) => profile.name)))
        const config = await refreshQuotaConfigCache()
        const allResetCards = Array.isArray(config.resetCards) ? config.resetCards : []
        const resetCardsByProvider = new Map()
        for (const card of allResetCards) {
          const bucket = resetCardsByProvider.get(card.provider) ?? []
          bucket.push(card)
          resetCardsByProvider.set(card.provider, bucket)
        }
        const requestedProviders = Array.isArray(payload?.providers)
          ? new Set(payload.providers.filter((provider) => typeof provider === 'string' && provider.length <= MAX_QUOTA_PROVIDER_NAME))
          : null
        const refreshAll = payload?.scope === 'all' || requestedProviders === null
        const rows = []
        for (const profile of providers) {
          // kind 解析优先序：配置显式 kind > 配置 null（手动停用，永不外呼）> baseURL 自动推断。
          const { adapter, kind, kindSource } = resolveQuotaKind(config, profile)
          if (adapter === undefined || kind === undefined) {
            // 未适配（无 kind/已停用/白名单外且不可推断）：灰色行，宿主绝不主动外呼。
            rows.push({ provider: profile.name, displayName: profile.displayName, adapted: false })
            continue
          }
          // 某些自动识别 Adapter 在凭据未配置时应整行静默隐藏；可见性属于 Adapter 凭据策略，
          // index.js 只消费统一 policy，不再按 kind 写特例。显式适配仍照常显示填写入口。
          const credentialPolicy = adapter.credentialPolicy(profile)
          if (kindSource === 'auto' && credentialPolicy.autoVisibility === 'credential-gated'
            && !(await quotaCredentialConfigured(ctx, kind, profile))) continue
          if (refreshAll || requestedProviders.has(profile.name)) kickQuotaRefresh(profile, adapter, config)
          const view = quotaThrottle.view(profile.name)
          const windows = Array.isArray(view.windows) ? view.windows : []
          // 「凭据类」错误 = 填/换一份凭据就能恢复的状态，客户端按 unconfigured 渲染填写表单。
          // credential-rejected（v0.29 修复）：Cookie/key 被上游拒绝时恰恰最需要重新填入——
          // 漏掉它会把卡片锁死在错误态，用户找不到任何入口（GUI 反馈「失效后无法再次填入」）。
          const credentialClass = view.lastError === 'credential-missing' || view.lastError === 'no-base-url' || view.lastError === 'credentials-unavailable' || view.lastError === 'credential-rejected'
          const providerResetCards = resetCardsByProvider.get(profile.name) ?? []
          // 凭据填写窗口的数据源：仅对「缺凭据」的未配置行附带候选线索名的配置状态（describe 只回
          // 配置与否/来源/可写，绝不带值）；凭据服务缺席时省略字段——客户端隐藏窗口退回文案指引。
          let credentialHints
          if (credentialClass && !view.refreshing && view.lastError !== 'no-base-url') {
            const credentials = ctx.get('credentials')
            if (credentials !== undefined && typeof credentials.describe === 'function') {
              const described = []
              for (const name of quotaCredentialHintNames(kind, profile)) {
                try {
                  const info = await Promise.resolve(credentials.describe(name))
                  described.push({
                    name,
                    configured: info?.configured === true,
                    ...(typeof info?.source === 'string' ? { source: info.source } : {}),
                    ...(info?.writable === false ? { writable: false } : {}),
                  })
                } catch (_) {
                  described.push({ name, configured: false })
                }
              }
              credentialHints = described
            }
          }
          rows.push({
            provider: profile.name,
            displayName: profile.displayName,
            adapted: true,
            kind,
            ...(kindSource !== undefined ? { kindSource } : {}),
            refreshing: view.refreshing,
            status: credentialClass && !view.refreshing ? 'unconfigured' : view.lastError !== undefined && windows.length === 0 ? 'error' : 'ok',
            ...(windows.length > 0 ? { windows, fetchedAt: view.fetchedAt } : {}),
            ...(view.lastError !== undefined ? { errorCode: view.lastError } : {}),
            ...(view.lastErrorDetail !== undefined ? { errorDetail: view.lastErrorDetail } : {}),
            ...(view.lastErrorEndpoint !== undefined ? { errorEndpoint: view.lastErrorEndpoint } : {}),
            ...(view.lastErrorAccount !== undefined ? { errorAccount: view.lastErrorAccount } : {}),
            nextAllowedAt: view.nextAllowedAt,
            ...(providerResetCards.length > 0 ? { resetCards: providerResetCards } : {}),
            ...(credentialHints !== undefined ? { credentialHints } : {}),
            // 凭据入口语义由 Adapter policy 下发稳定键，客户端只负责本地化，不再对 kind 重复分支。
            credentialEntryKey: adapter.credentialPolicy(profile).entryKey,
            // 官网用户页余额网址由具体 Adapter 持有（宿主常量白名单；无则缺省）。
            ...(typeof quotaAdapterUsageUrl(adapter) === 'string' && quotaAdapterUsageUrl(adapter) !== '' ? { usageUrl: quotaAdapterUsageUrl(adapter) } : {}),
          })
        }
        return { ok: true, value: { providers: rows, serverTime: Date.now() } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'quota-refresh': { feature: 'quotaLookup', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        // 手动刷新入口：provider 过白名单且 kind 已适配；清掉节流闸后立即 kick。
        // 单飞仍生效（在途时本次点击为 no-op）；上游结果经后续 quota 快照带出，不在此等待。
        const providerName = typeof payload?.provider === 'string' ? payload.provider : ''
        const profile = readQuotaProfiles(ctx.get('settings'), ctx.get('llm')).find((candidate) => candidate.name === providerName)
        if (profile === undefined) return { ok: false, error: 'unknown-provider' }
        const config = await refreshQuotaConfigCache()
        const { adapter } = resolveQuotaKind(config, profile)
        if (adapter === undefined) return { ok: false, error: 'not-adapted' }
        const forced = quotaThrottle.force(providerName)
        if (!forced.ok) {
          if (forced.reason === 'inflight') return { ok: true }
          return { ok: false, error: forced.reason === 'cooldown' ? 'refresh-cooldown' : 'refresh-backoff', nextAllowedAt: forced.nextAllowedAt }
        }
        kickQuotaRefresh(profile, adapter, config)
        return { ok: true }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'quota-config': { feature: 'quotaLookup', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        const providerName = typeof payload?.provider === 'string' ? payload.provider : ''
        // 三种写法，语义对齐配置文件解析（显式 kind > 显式 null 停用 > 自动推断）：
        // {clear:true} 删掉覆盖键回退自动推断；{kind:null} 存显式停用（baseURL 可推断也不外呼）；{kind:<name>} 指定适配。
        const profileForProvider = readQuotaProfiles(ctx.get('settings'), ctx.get('llm')).find((candidate) => candidate.name === providerName)
        if (profileForProvider === undefined) return { ok: false, error: 'unknown-provider' }
        return await serializeQuotaConfigWrite(async (config) => {
          if (payload?.clear === true) {
            delete config.kinds[providerName]
            delete config.allowedHosts[providerName]
          } else {
            const kind = payload?.kind
            const adapter = kind === null ? undefined : QUOTA_ADAPTER_BY_KIND.get(kind)
            if (kind !== null && adapter === undefined) return { save: false, value: { ok: false, error: 'unknown-kind' } }
            if (adapter === undefined) {
              // 显式停用不保留任何 Adapter 私有安全状态。
              delete config.allowedHosts[providerName]
            } else {
              // 配置校验/钉住派生由具体 Adapter 决定；index.js 只应用统一结果。
              const prepared = prepareQuotaAdapterConfig(adapter, profileForProvider)
              if (prepared.ok !== true) return { save: false, value: { ok: false, error: prepared.error } }
              if (Array.isArray(prepared.allowedHosts) && prepared.allowedHosts.length > 0) {
                config.allowedHosts[providerName] = [...prepared.allowedHosts]
              } else {
                delete config.allowedHosts[providerName]
              }
            }
            config.kinds[providerName] = kind
          }
          // 适配变更即清闸（v0.29 用户反馈：填完凭据/改完类型就该立刻重试，不继承旧失败的退避）。
          quotaThrottle.resetGates(providerName)
          return { value: { ok: true } }
        })
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'quota-credential-set': { feature: 'quotaLookup', audit: true, handle: (payload, rpcEndpoint) => quotaCredentialEndpoint(ctx, refreshQuotaConfigCache, quotaThrottle, payload, rpcEndpoint) },
    'quota-credential-unset': { feature: 'quotaLookup', audit: true, handle: (payload, rpcEndpoint) => quotaCredentialEndpoint(ctx, refreshQuotaConfigCache, quotaThrottle, payload, rpcEndpoint) },
    'quota-reset-card': { feature: 'quotaLookup', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        // 手录重置卡（v0.19 过渡方案；v0.20 免次数、每 provider 可多条）的面板写入口：
        // provider 过宿主清单白名单；{remove:true,id} 删除宿主下发 id 对应的那一条，
        // 其余载荷为追加一条（label/expiresAt 截断限长），单 provider 上限 10 条防配置膨胀。
        // v1.9.1：可带 account（CLIProxyAPI 多账号细分）——同一 provider 下按账号分别记事。
        // 与 label 同等对待：只是随卡存下的展示标识，截断限长，绝不进命令/路径/URL，
        // 因而无需（也不能）对着上游清单做白名单校验——那会在写路径上引入一次外呼。
        const providerName = typeof payload?.provider === 'string' ? payload.provider : ''
        if (!readQuotaProfiles(ctx.get('settings'), ctx.get('llm')).some((candidate) => candidate.name === providerName)) {
          return { ok: false, error: 'unknown-provider' }
        }
        const accountName = typeof payload?.account === 'string' && payload.account.trim() !== ''
          ? payload.account.trim().slice(0, MAX_QUOTA_RESET_CARD_ACCOUNT)
          : ''
        return await serializeQuotaConfigWrite(async (config) => {
          const allCards = Array.isArray(config.resetCards) ? config.resetCards : []
          if (payload?.remove === true) {
            const cardId = typeof payload?.id === 'string' ? payload.id : ''
            // 删除按 id 精确定位（同 provider 下 id 唯一），account 不参与匹配。
            config.resetCards = allCards.filter((card) => !(card.provider === providerName && card.id === cardId))
          } else {
            if (allCards.length >= MAX_QUOTA_RESET_CARDS || allCards.filter((card) => card.provider === providerName).length >= MAX_QUOTA_RESET_CARDS_PER_PROVIDER) {
              return { save: false, value: { ok: false, error: 'too-many-cards' } }
            }
            const card = { id: `rc-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`, provider: providerName }
            if (accountName !== '') card.account = accountName
            if (typeof payload?.label === 'string' && payload.label.trim() !== '') card.label = payload.label.trim().slice(0, 40)
            // 面板 datetime-local 是无时区串：落盘即固化成绝对时刻，之后任何时区读到的都是同一时刻。
            // 拿不到客户端偏移时保留原文（由读路径按当时的偏移解释），不无依据地改写。
            if (typeof payload?.expiresAt === 'string' && payload.expiresAt.trim() !== '') {
              card.expiresAt = String(canonicalResetCardExpiresAt(
                payload.expiresAt.trim(),
                payload?.timezoneOffsetMinutes,
              )).slice(0, 32)
            }
            config.resetCards = [...allCards, card]
          }
          return { value: { ok: true } }
        })
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
  }
}
