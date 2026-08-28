# 设置页左侧栏排序功能调研

> 调研问题：`@gehennawu/dsh-service` 是否可以增加“调整设置页左侧栏排序”功能。
>
> 调研范围：当前仓库代码、本机安装的 DSH `@deepseek-ai/dsh@0.1.1-rc.2` 产物，以及 DSH 官方仓库当前公开的一手源码/README。本文只做调研，不修改功能实现。
>
> 说明：当前工作区已有未提交的 `client.js` 改动，本文未触碰该文件。

## 结论摘要

**可以增加，但要先区分两个“排序”目标：**

1. **本插件“服务控制”面板内部的页签排序**：已经可以由本插件自己控制，不需要修改 DSH 外壳。当前顺序是本插件代码里的常量，属于插件内部 UI。
2. **整个 DSH 设置模态左侧栏的顶层 section 排序**（包括「通用、模型、插件、预设、插件市场、服务控制、Side card」以及其他第三方页）：外壳已经提供了可用的 `order` 排序输入，第三方插件可以决定**自己注册的 section**放在什么位置；但是当前没有一个公开能力让某个插件在不替换外壳的情况下，按用户配置重新排列**其他插件已经注册的 section**。

因此，如果需求是“让用户拖拽/选择整个设置左栏的顺序”，最稳妥的结论是：

- **短期可实现的兼容方案**：本插件新增一个“设置导航排序”界面，只管理本插件拥有的入口（例如 `dsh-service`、可选的 `dsh-service-quota`、`dsh-service-sessions`、`dsh-service-restart`），通过注销并按新的 `order` 重新注册来改变它们相互之间的位置；顺序持久化在本插件 namespace 或浏览器本地存储，热生效。
- **不能承诺的部分**：不能仅依靠公开 slot API，把官方 section 或其他插件 section 的排序改写为用户指定顺序。直接重注册同一个 `id`、劫持已有条目或替换 `root`/`sidebar.settings` 都会进入外壳替换/冲突风险，不应作为普通功能实现。
- **完整的全局重排**：需要 DSH 官方新增“导航顺序/排序服务”或可配置的 navigation projection；或者用一个替代 `ui-settings-general` 的外壳插件重新渲染所有 section。后者可行但属于高侵入 fork/替换方案，兼容性和维护成本明显更高。

## 1. DSH 外壳的真实排序机制

### 1.1 `settings.section` 是有序 list slot

本机 Inspect 的 `settings.section` 完整契约显示：

- slot 类型是 `list`；
- 注册字段是 `id`（必填）、`order`（可选 number）、`label`（可选 string 或 thunk）；
- `order` 的语义是“entries 之间按升序排列”。

本机 Inspect 结果（通过 `cordis_inspect_query` 查询 `client / Slots / listSubTree({root: "settings.section"})`）还显示当前活动 occupants：

- `general`, `order: 0`
- `models`, `order: 10`
- `plugins`, `order: 15`
- `agent-presets`, `order: 20`
- `market`, `order: 40`
- `dsh-service`, `order: 99`
- `better-sidebar`, `order: 100`
- `dsh-service-sessions`, `order: 495`
- `dsh-service-quota`, `order: 498`
- `dsh-service-restart`, `order: 499`

其中 `dsh-service` 与三个快捷 section 的顺序来自本插件当前代码：`client.js:1670-1672` 与 `client.js:5919-5937`。例如：

```js
{ name: 'settings.section', id: 'dsh-service', order: 99, ... }
{ name: 'settings.section', id: 'dsh-service-sessions', order: 495, ... }
{ name: 'settings.section', id: 'dsh-service-quota', order: 498, ... }
{ name: 'settings.section', id: 'dsh-service-restart', order: 499, ... }
```

**一手依据：**

- 官方 slot contract：[`packages/client/ui-settings/src/client/contract/slots.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-settings/src/client/contract/slots.ts) 的 `settings.section` 注释明确说注册项带有 `id`、`order`、`label`。
- 官方设置外壳实现：[`packages/client/ui-settings-general/src/client/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-settings-general/src/client/index.ts) 把 `ctx.slots.entries('settings.section')` 映射为 `{id, order, label}`，然后 `.sort((a, b) => a.order - b.order)`。
- 同一排序逻辑可直接在本机产物 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:489-509` 看到；本机 `0.1.1-rc.2` 的外壳实现与上述官方源码一致。

### 1.2 外壳只投影排序结果，不读取用户排序配置

官方 `SettingsRoot` 的渲染路径是：

```tsx
{rows.map(row => (
  <button key={row.id} ... onClick={() => { onSelect(row.id) }}>
    {navIcon(row.id)}
    <span>{row.label}</span>
  </button>
))}
```

见官方 [`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-settings-general/src/client/SettingsRoot.tsx)。本机产物对应 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:124-144`。

外壳的 `SettingsSectionRow` 只有三个字段：`id`、`order`、`label`，见本机类型文件 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/types/client/shell-contract.d.ts:10-15`；官方源码对应 [`shell-contract.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-settings-general/src/client/shell-contract.ts)。没有用户排序 store、没有排序 RPC，也没有“导航管理”服务。

这意味着排序发生在“每个注册方提交的 `order` + 外壳统一升序投影”这一层，而不是一个客户端插件可调用的独立 reorder API。

## 2. 第三方插件能做什么

### 2.1 新增自己的 section，并选择自己的位置：可以

任何插件可以向已声明的 `settings.section` 注册一页，设置自己的 `id`、`order` 和 `label`。例如官方 shell README 说明功能包通过 `settings.section` 贡献页面，设置外壳只投影这些条目：

- [`ui-settings-general/README.md`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-settings-general/README.md)
- [`ui-settings/README.md`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-settings/README.md)

社区插件 `dsh-better-sidebar` 也是实证：其源码 `/home/node/.dsh/profiles/web/node_modules/dsh-better-sidebar/src/client/index.tsx:413-419` 注册：

```ts
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'better-sidebar',
  order: 100,
  label: () => t('settingsNav'),
}, SideCardSection))
```

社区插件 `dshmarket` 的源码 `/home/node/.dsh/profiles/web/node_modules/dshmarket/src/client/index.ts:105-121` 以 `order: 40` 注册 `market`，说明第三方确实可以通过静态 `order` 把自己的页放到某个相对位置。

### 2.2 改变本插件自己的多个 section：可以

本插件已经采用“按开关注销/重注册”的方式管理三个快捷入口：

- `createNavEntryToggle` 在 `client.js:1620-1666` 中按当前状态调用 `ctx.slots.register`；
- 关闭时执行保存的 disposer，条目从导航消失；
- 开启时重新注册；
- 当前固定 order 为 `sessions: 495`、`quota: 498`、`restart: 499`，见 `client.js:1670-1672`；
- `settings.section` 外壳通过 ledger 订阅，在条目变更后重新投影，见本机外壳 `lib/client.js:497-517`。

所以若用户想调整“服务控制、会话管理、额度查询、重启”之间的顺序，可以在本插件里新增持久化顺序，并把这些固定 `order` 改成由当前设置推导，再通过同样的注销/重注册机制热更新。不能在同一次注册中修改 option；需要先 dispose 旧条目再 register 新条目。

### 2.3 只调整本插件内部页签：现成可行

本插件“服务控制”页面本身的顶层页签顺序不是 DSH 外壳的 `settings.section`，而是本插件自己的数组：

- `client.js:1517-1522`：`PRIMARY_TAB_ORDER = ['overview', 'usage', 'quota', 'diagnostics', 'maintenance', 'configuration']`；
- `client.js:1525-1529`：`MAINTENANCE_TAB_ORDER = ['sessions', 'skills', 'subagent', 'backup', 'restart']`；
- `client.js:1537-1540`：配置子页 `features`, `notifications`。

这里可做用户排序，但要同时处理：

- 默认顺序与非法/缺失值的回退；
- 功能关闭后的可见白名单与回退；
- 当前激活页在排序或功能开关变化时保持有效；
- localStorage 或 `settingsScope` 的持久化；
- zh/en 文案仅通过 locale 词典；
- 桌面和窄屏横向 tab 的溢出显示。

当前代码已经对维护子页做了 `normalizeMaintenanceTab` 回退（`client.js:1531-1535`），这是实现用户自定义顺序时应沿用的模式，而不是直接把未经校验的字符串当 tab id。

## 3. 为什么不能直接重排所有官方/第三方 section

### 3.1 `settings.section` 没有公开“读取后改 order”的控制面

`settings.section` 的注册协议只有 `id/order/label`。官方 contract 没有 `setOrder`、`reorder`、用户偏好字段或 coordinator 服务；官方外壳只对 ledger snapshot 做排序。

本机完整 Inspect 选中的 `settings.section` contract 还特别说明：

- `id` 是 section key，复用已有 id 会进入“那个 cell”；
- `order` 是注册条目间的位置；
- `label` 是注册方提供的显示文本。

这支持“注册自己的 entry”，不支持“对任意已有 entry 写入新的 order”。

### 3.2 复用官方/他人 id 不是安全的排序接口

SlotCore 的设计是“声明 = 渲染授权”，官方 slot README 明确指出：

- list slot 的注册是组合入口；
- 同一个 cell 的 identity 由 key/id 等字段决定；
- 条目注销有生命周期级联；
- 声明未声明 slot、重复声明 child 等会在加载时失败。

参见官方 [`packages/client/ui-slots/README.md`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-slots/README.md) 与中文版本 [`README.zh.md`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-slots/README.zh.md)。本机 `SlotRegistry` 也明确将核心的 `register` 暴露为唯一注册 API，见 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/slots.d.ts:58-65` 与产物 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:242-263`。

实际影响：

- 用官方 `id` 再注册，不能理解为“给官方条目改 order”；可能形成同 cell 竞争/替换，且可能丢失原组件或 props；
- 假定能拿到别的插件 disposer 并重注册，违反插件所有权和 Fiber 生命周期；
- 直接替换 `sidebar.settings` 或 `root` 会替换整个设置外壳/应用骨架，不是一个低风险的排序扩展。

本机 Inspect 也把 `root` 和 `sidebar.settings` 标为 `replaceRisk: "shadows-shipped-ui"`，而 `settings.section` 标为 `replaceRisk: "none"`。因此正常插件应只使用 `settings.section` 的 additive list，不应接管外壳。

### 3.3 DOM/CSS 改顺序不宜作为正式方案

通过 `MutationObserver` 找到 `[role="dialog"] nav button` 再 `insertBefore`，理论上能改变当前 DOM 的视觉顺序，但它不改变 React 的 `rows` 顺序/active state，也会被以下动作重建：

- section 注册或注销；
- locale 切换触发重新投影；
- 设置弹窗关闭后再次打开；
- 外壳升级、更换 DOM 结构。

本机已有 `dsh-better-sidebar` 的设置导航图标权宜方案，源码 `/home/node/.dsh/profiles/web/node_modules/dsh-better-sidebar/src/client/settings-nav-icon.ts:21-45` 通过 `MutationObserver` 仅给自己的按钮加标记，并明确注释这是因为当前 icon contract 不足的临时适配。它没有移动按钮顺序；其经验不能当作正式的 reorder API。把同一类 DOM hack 用于排序会比图标 hack 更脆弱，因为顺序还会影响 React 的 active row 和内容投影。

## 4. 可行实现分级

### 方案 A：本插件自有 section 排序（推荐，低风险）

**适用需求**：只想调整 dsh-service 及其快捷入口之间的顺序，或只调整本插件内部页签。

实现要点：

1. 在本插件 Client 增加顺序设置模型，例如 `settings.sectionOrder`，只允许本插件白名单 id。
2. 读取时过滤未知、重复、缺失 id；用默认顺序补齐，不能让用户输入任意 id 直接进入注册。
3. 生成单调、稳定的 `order`（例如 490 起的整数，或固定基础值 + index）；不要把用户数据直接当作任意超大数，避免与其他插件产生不可预测冲突。
4. 更新时注销本插件旧条目，再按新 order 注册；同一 Fiber 内通过一个注入回调返回多个 disposer，遵循本仓库 AGENTS.md 中“同一 fiber 一个 list slot 注入多条目”的规则。
5. 使用 `ctx.settingsScope` 持久化时，字段属于本插件 namespace；非 loopback 页面没有 durable settings，应展示不可用/回退状态。若只接受当前浏览器偏好，也可以用 localStorage，但应明确这是浏览器级而非 DSH 用户配置。
6. 重新排序时修正当前 active section：若 active id 仍在，保留；若条目被隐藏/关闭，回退到本插件首个有效条目。
7. 测试默认顺序、乱序持久化、坏数据、热切换、关闭/卸载、语言切换，以及与现有 `order: 495/498/499` 的兼容。

**不能做到**：把 `general/models/plugins/market/better-sidebar` 等外部条目插入任意用户位置。

### 方案 B：本插件提供“服务控制内部页签排序”（推荐，最低风险）

直接把 `PRIMARY_TAB_ORDER`、`MAINTENANCE_TAB_ORDER`、`CONFIG_TABS` 抽成可持久化、可校验的顺序模型。这里不碰 DSH 外壳，影响面最小，也是最容易先交付的版本。

### 方案 C：替换 DSH 设置外壳（不推荐，仅在必须全局重排时考虑）

参考社区 `dsh-ui-settings-icons` 的做法：该插件的 README 说明它通过 `cordis.patch.yml` 禁用官方 `ui-settings-general`，再安装自己的 settings shell，以避免重复 slot declaration；其 patch 文件是：

```yaml
- id: ui-settings-general
  disabled: true

- insert:
    - id: ui-settings-icons
      name: 'dsh-ui-settings-icons'
```

一手来源：[`dsh-ui-settings-icons/README.md`](https://raw.githubusercontent.com/suntianc/dsh-ui-settings-icons/main/README.md) 与 [`cordis.patch.yml`](https://raw.githubusercontent.com/suntianc/dsh-ui-settings-icons/main/cordis.patch.yml)。这证明“替换外壳后全局改变投影”在组合层面可以做，但代价是：

- 要完整复制 trigger、dialog、focus、Escape、ARIA、native config action、onboarding 等外壳行为；
- 要跟随 DSH 版本更新；
- 与其他替换 `ui-settings-general` 的插件互斥；
- 一旦官方 slot contract 或 DOM/renderer 改变，替代外壳可能失配；
- 这不是本插件增加一个普通设置项，而是改变整个 Web composition。

不建议把 C 作为 `dsh-service` 的普通功能开关。若产品明确要全局自定义设置导航，应单独做“设置外壳/导航管理”插件，或推动 DSH 官方提供服务。

## 5. 持久化与安全边界建议

- 排序配置必须是本插件固定白名单的 id 数组，不能接受浏览器传来的路径、代码或任意插件 id 后转成注册参数。
- 未知 id、重复 id、空数组、超长数组、非数组等均回退默认，不影响设置页启动。
- 只把本插件自己注册的条目纳入可排序集合；外部条目可以只读展示（如果产品需要），不能假装能修改。
- 如果要调整的是快捷入口的显示/隐藏，继续采用现有“注销条目 = 隐藏”的模式，不要让 section 返回 `null` 企图隐藏左栏行；外壳按钮由外壳渲染。
- 所有 register/dispose、订阅、MutationObserver（若未来仅用于观测）必须归当前 Fiber；热更新和禁用后不得残留。
- 本功能属于浏览器 UI 偏好，不需要 Host RPC 或命令执行；优先复用 `ctx.settingsScope`，避免为简单排序增加 Host 文件写入和 loopback endpoint。

## 6. 推荐产品决策

建议把需求拆成两个候选版本，先向用户确认目标：

1. **“服务控制页内排序”**：用户调整概览、用量、额度、诊断、维护、配置及维护子页的顺序；不影响 DSH 其他设置页。可直接在本插件落地，风险低。
2. **“整个设置左栏排序”**：用户调整 DSH 所有顶层 section；当前公开 API 不足。若坚持实现，应先做独立的替代设置外壳/官方 API 方案评审，不应把 DOM 重排当正式能力。

在没有进一步澄清前，不建议立刻改代码，因为两者的实现边界、持久化模型和升级风险完全不同。

## 一手来源索引

### 本地源码与运行时

- `/workspace/projects/dsh-service/client.js:1515-1539`：本插件内部导航顺序常量。
- `/workspace/projects/dsh-service/client.js:1620-1672`：本插件快捷 section 的注销/重注册与固定 order。
- `/workspace/projects/dsh-service/client.js:5919-5937`：本插件 `settings.section` 注册与生命周期。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:489-517`：外壳按 `ctx.slots.entries(...).sort(order)` 生成 rows，并订阅 ledger/locale。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:124-144`：外壳按 rows 顺序绘制 nav button。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/types/client/shell-contract.d.ts:10-15`：外壳 row 形状只有 `id/order/label`。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/slots.d.ts:58-65`、`lib/client.js:242-263`：SlotRegistry 的唯一 register/disposer 入口和生命周期说明。
- `/home/node/.dsh/profiles/web/node_modules/dsh-better-sidebar/src/client/index.tsx:398-419`：第三方 section 注册和 DOM 图标权宜方案说明。
- `/home/node/.dsh/profiles/web/node_modules/dshmarket/src/client/index.ts:105-124`：第三方 section 以 `order: 40` 注册。
- `/home/node/.dsh/profiles/web/node_modules/dsh-better-sidebar/src/client/settings-nav-icon.ts:21-45`：MutationObserver 只标记自己的导航行，未提供顺序改写。
- 本机 `cordis_inspect_query(client, Slots, listSubTree({root: "settings.section"}))`：当前 slot contract、replaceRisk 和 occupants。

### 公开一手网页来源

- [`ui-settings-general/README.md`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-settings-general/README.md)
- [`ui-settings-general/README.zh.md`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-settings-general/README.zh.md)
- [`ui-settings-general/src/client/SettingsRoot.tsx`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-settings-general/src/client/SettingsRoot.tsx)
- [`ui-settings-general/src/client/index.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-settings-general/src/client/index.ts)
- [`ui-settings-general/src/client/shell-contract.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-settings-general/src/client/shell-contract.ts)
- [`ui-settings/src/client/contract/slots.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-settings/src/client/contract/slots.ts)
- [`ui-settings/README.md`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-settings/README.md)
- [`ui-slots/README.md`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-slots/README.md)
- [`dsh-ui-settings-icons/README.md`](https://raw.githubusercontent.com/suntianc/dsh-ui-settings-icons/main/README.md)
- [`dsh-ui-settings-icons/cordis.patch.yml`](https://raw.githubusercontent.com/suntianc/dsh-ui-settings-icons/main/cordis.patch.yml)

## 未证实事项

- 本文没有在真实 GUI 中拖拽或修改设置导航；结论基于源码、类型、运行时 Inspect 与现有第三方实现。
- 没有发现官方公开的导航排序服务或 `openSection` 之外的设置导航 API；官方源码中 `openSection` 是 onboarding 回调，用于打开一个已知 id，不是排序能力。
- 本文没有验证未来 DSH 版本是否会增加 `settings.section` 的 `priority`/用户排序 service；升级后应重新 Inspect `settings.section` contract 和 `ui-settings-general` projection。
