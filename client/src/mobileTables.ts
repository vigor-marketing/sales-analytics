/**
 * 手机端表格自动「卡片化」
 *
 * 背景：列表页的宽表格（8～14 列）在手机上无法横向完整展示，只能压缩列宽 + 省略号截断，
 *       实测每页有 14～30 个单元格的文字被截断（连订单号、客户名都会被截掉），
 *       而省略号在触屏上没有 hover，用户根本看不到完整数据。
 *
 * 做法：不改动 20 多个表格的 JSX —— 这里在运行时读取每个表格的表头文字，
 *       把表头写到对应单元格的 data-label 上，再由 CSS（≤760px）把每行渲染成
 *       「标签 + 值」的卡片：所有字段完整显示、可换行，不需要横向滚动。
 *
 * 只处理带 thead 的 table.grid；无表头的键值表（如系统信息）保持原样。
 */
const MOBILE_QUERY = '(max-width: 760px)'

const isMobile = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches

/** 取表头文字：多行表头时用单元格最多的那一行作为列标签 */
function headerLabels(table: HTMLTableElement): string[] {
  const rows = Array.from(table.querySelectorAll(':scope > thead > tr'))
  if (!rows.length) return []
  const best = rows.reduce((a, b) => (b.children.length > a.children.length ? b : a), rows[0])
  return Array.from(best.children).map((th) => (th.textContent || '').replace(/\s+/g, ' ').trim())
}

/** 给一个表格打标签（幂等：标签没变就不写属性，避免触发多余的 DOM 变更） */
function stampTable(table: HTMLTableElement): void {
  const labels = headerLabels(table)
  if (!labels.length) return
  if (table.getAttribute('data-cards') !== '1') table.setAttribute('data-cards', '1')
  table.querySelectorAll(':scope > tbody > tr').forEach((tr) => {
    Array.from(tr.children).forEach((cell, i) => {
      const el = cell as HTMLElement
      const span = Number(el.getAttribute('colspan') || 1)
      const label = span > 1 ? '' : labels[i] || ''
      if (label) {
        if (el.getAttribute('data-label') !== label) el.setAttribute('data-label', label)
      } else if (el.hasAttribute('data-label')) {
        el.removeAttribute('data-label')
      }
    })
  })
}

/** 立刻给页面里所有表格打标签（返回处理了几个表） */
export function stampMobileTables(root: ParentNode = document): number {
  if (!isMobile()) return 0
  const tables = Array.from(root.querySelectorAll('table.grid')) as HTMLTableElement[]
  tables.forEach(stampTable)
  return tables.length
}

/**
 * 挂载：首屏打一次，之后用 MutationObserver 跟随 React 的重新渲染（筛选、翻页、搜索都会重建 tbody）。
 * 只观察 childList/subtree（不观察 attributes），因此不会和自身写入的属性互相触发。
 */
export function initMobileTables(): () => void {
  let raf = 0
  const run = () => { raf = 0; stampMobileTables(document) }
  const schedule = () => { if (!raf) raf = window.requestAnimationFrame(run) }
  schedule()
  const mo = new MutationObserver(schedule)
  mo.observe(document.body, { childList: true, subtree: true, characterData: true })
  const mq = window.matchMedia(MOBILE_QUERY)
  const onChange = () => schedule()
  mq.addEventListener?.('change', onChange)
  return () => {
    mo.disconnect()
    mq.removeEventListener?.('change', onChange)
    if (raf) window.cancelAnimationFrame(raf)
  }
}
