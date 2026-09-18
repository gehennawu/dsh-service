// 客户端半分片：全局通知状态服务——四档开关（总开关/任务完成/需要输入/铃铛显隐）、
// localStorage 持久化、监听发布、React 订阅钩子（useNotifyState）与系统通知触发。
// 开关原为 apply 作用域 let，跨段活读改用 { current } 箱体（消费方 notifyState.current.*）。
// 零参数：React 取自工厂作用域，其余皆浏览器 API。分片不是模块——拼接见 scripts/client-source.mjs。

function createNotificationService() {
  const { useState, useEffect } = React
      // 全局通知：任务结束 + 需要授权/选择答案，两个独立子开关受总开关管辖
      const notifyState = { current: { enabled: false, done: true, input: true, bellVisible: true } }
      // 输入框铃铛图标的显隐（v0.31 用户点名）：默认显示，独立于通知行为开关——
      // 藏掉铃铛只是收起快捷入口，通知照常按既有三档工作。
      try { notifyState.current.enabled = localStorage.getItem('dsh-service-notify') === 'true' } catch (_) {}
      try { notifyState.current.done = localStorage.getItem('dsh-service-notify-done') !== 'false' } catch (_) {}
      try { notifyState.current.input = localStorage.getItem('dsh-service-notify-input') !== 'false' } catch (_) {}
      try { notifyState.current.bellVisible = localStorage.getItem('dsh-service-notify-bell') !== 'false' } catch (_) {}
      const notifyListeners = new Set()
      const bellListeners = new Set()
      const persistNotify = (key, value) => { try { localStorage.setItem(key, value ? 'true' : 'false') } catch (_) {} }
      const publishNotify = () => { for (const listener of notifyListeners) listener() }
      const publishBell = () => { for (const listener of bellListeners) listener() }
      const setNotifyEnabled = (value) => { notifyState.current.enabled = value; persistNotify('dsh-service-notify', value); publishNotify() }
      const setNotifyDone = (value) => { notifyState.current.done = value; persistNotify('dsh-service-notify-done', value); publishNotify() }
      const setNotifyInput = (value) => { notifyState.current.input = value; persistNotify('dsh-service-notify-input', value); publishNotify() }
      const setNotifyBellVisible = (value) => {
        notifyState.current.bellVisible = value === true
        persistNotify('dsh-service-notify-bell', notifyState.current.bellVisible)
        publishBell()
      }
      /** 槽位注入回调用：铃铛显隐变化时重挂 conversation.input.left 条目。 */
      const subscribeBellVisible = (listener) => { bellListeners.add(listener); return () => bellListeners.delete(listener) }
      const useNotifyState = () => {
        const [, setTick] = useState(0)
        const [enabled, setEnabled] = useState(notifyState.current.enabled)
        const [done, setDone] = useState(notifyState.current.done)
        const [input, setInput] = useState(notifyState.current.input)
        const [bell, setBell] = useState(notifyState.current.bellVisible)
        React.useEffect(() => {
          const update = () => { setEnabled(notifyState.current.enabled); setDone(notifyState.current.done); setInput(notifyState.current.input); setBell(notifyState.current.bellVisible); setTick((t) => t + 1) }
          notifyListeners.add(update)
          bellListeners.add(update)
          return () => { notifyListeners.delete(update); bellListeners.delete(update) }
        }, [])
        return { enabled, done, input, bell, setEnabled: (v) => setNotifyEnabled(v), setDone: (v) => setNotifyDone(v), setInput: (v) => setNotifyInput(v), setBell: setNotifyBellVisible }
      }
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
  return { notifyState, useNotifyState, NOTIFY_KIND_KEYS, fireNotification, subscribeBellVisible }
}
