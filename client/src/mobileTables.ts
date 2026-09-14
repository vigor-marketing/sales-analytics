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
  const run = () => { raf = 0; stampMobileTables(document); clampHints(document) }
  const schedule = () => { if (!raf) raf = window.requestAnimationFrame(run) }
  schedule()
  const mo = new MutationObserver(schedule)
  mo.observe(document.body, { childList: true, subtree: true, characterData: true })
  const unbind = bindHintToggle()
  const mq = window.matchMedia(MOBILE_QUERY)
  const onChange = () => schedule()
  mq.addEventListener?.('change', onChange)
  return () => {
    mo.disconnect()
    unbind()
    mq.removeEventListener?.('change', onChange)
    if (raf) window.cancelAnimationFrame(raf)
  }
}

/* ===================== 手机端长提示折叠 =====================
   手机上很多说明文字一次占 3~6 行，把表单挤得很长。这里把较长的 .hint 折成 2 行，
   点一下即可展开全文（再点收起）。刻意「不插入任何 DOM 节点」——只用 CSS 伪元素显示
   「展开/收起」，因此不会和 React 的渲染发生冲突。 */
const HINT_MIN_CHARS = 40
const HINT_MIN_LINES = 3

function lineCount(el: HTMLElement): number {
  const cs = getComputedStyle(el)
  const lh = parseFloat(cs.lineHeight) || 16
  return Math.max(1, Math.round(el.getBoundingClientRect().height / lh))
}

/** 卡片/表格里的 .hint 属于数据内容（如「≈USD 12,346」），不折叠；错误消息也不折叠 */
function hintFoldable(el: HTMLElement): boolean {
  if (el.classList.contains('hint-clamp')) return false
  if (el.closest('.msg')) return false
  if (el.closest('table.grid tbody')) return false
  if (el.closest('.rem-empty')) return false
  if (el.closest('.totals')) return false          // 合计区里的提示含金额，不能折叠
  if (el.closest('.proj-kpi')) return false
  return (el.textContent || '').trim().length >= HINT_MIN_CHARS
}

function clampHints(root: ParentNode): void {
  if (!isMobile()) return
  root.querySelectorAll('.hint').forEach((node) => {
    const el = node as HTMLElement
    if (!hintFoldable(el)) return
    if (lineCount(el) < HINT_MIN_LINES) return
    const before = el.getBoundingClientRect().height
    el.classList.add('hint-clamp')
    // 加完类立刻量一次：如果高度没变（说明全文本来就只有两行），说明没有内容被藏起来，
    // 那就把折叠撤掉——不显示没有意义的「展开」。
    const after = el.getBoundingClientRect().height
    if (after >= before - 2) {
      el.classList.remove('hint-clamp')
      return
    }
    el.setAttribute('data-hint-toggle', '1')
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '0')
  })
}

/** 点击/回车切换展开状态（事件委托，只注册一次） */
function bindHintToggle(): () => void {
  const toggle = (e: Event) => {
    const t = e.target as HTMLElement | null
    const host = t?.closest?.('[data-hint-toggle]') as HTMLElement | null
    if (!host) return
    host.classList.toggle('hint-open')
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') toggle(e) }
  document.addEventListener('click', toggle)
  document.addEventListener('keydown', onKey)
  return () => { document.removeEventListener('click', toggle); document.removeEventListener('keydown', onKey) }
}
