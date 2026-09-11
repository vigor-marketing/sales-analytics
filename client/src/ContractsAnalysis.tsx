import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get } from './api'
import { RANGE_LABEL, rangeDates, type RangeKey } from './dateRange'

interface Item { product_name: string; amount: number; currency: string; qty: number | null }
interface OrderRow {
  order_id: string; order_no: string; won_date: string; order_amount: number | null; order_currency: string
  inquiry_no: string; date: string; sales: string; customer_name: string; country?: string | null
  source?: string | null; purchaser?: string | null; customer_country?: string | null; use_location?: string | null
  usdApprox: number; totals: { currency: string; total: number }[]; items: Item[]; cycleDays: number | null; productNames: string
}
interface Stats { contractCount: number; cycleCount: number; avgCycle: number | null; medianCycle: number | null; minCycle: number | null; maxCycle: number | null; usdTotal: number; byProduct: { name: string; count: number; avgCycle: number }[]; bySales: { name: string; count: number; avgCycle: number }[] }
interface MetaLite { sales: { name: string; team: string }[]; winReasons?: string[]; lostReasons?: string[]; fx?: Record<string, number> }
interface ReasonItem { reason: string; count: number; usd: number; share: number; usdShare: number; avgCycle: number | null }
interface ReasonStat { total: number; usdTotal: number; items: ReasonItem[]; missing: number }
interface ReasonData { win: ReasonStat; lost: ReasonStat; reasons: { win: string[]; lost: string[] } }

/** 「按其他维度」可选的分析维度：取值口径与分组成交的销售订单一一对应（每单必落到唯一一个值上） */
interface DimRow { name: string; count: number; usd: number; avgCycle: number | null }
const DIMS: { key: string; label: string; of: (r: OrderRow) => string }[] = [
  { key: 'source', label: '询价来源', of: (r) => String(r.source || '').trim() },
  { key: 'purchaser', label: '采购方', of: (r) => String(r.purchaser || '').trim() },
  { key: 'country', label: '客户国别', of: (r) => String(r.customer_country || r.country || '').trim() },
  { key: 'currency', label: '订单币种', of: (r) => String(r.order_currency || '').trim() },
  { key: 'use_location', label: '使用地点', of: (r) => String(r.use_location || '').trim() },
  { key: 'customer', label: '客户', of: (r) => String(r.customer_name || '').trim() },
  { key: 'sales', label: '销售', of: (r) => String(r.sales || '').trim() },
]
/** 未填写的取值统一显示成「未填写」，避免表格里出现空白行 */
const UNKNOWN = '未填写'

/** 只读表格筛选：时间范围（成单日期）+ 产品名包含 */
function filterPanelRows(all: { won_date?: string | null; productNames?: string }[], f: { range: RangeKey; product: string }) {
  const { from, to } = rangeDates(f.range)
  return all.filter((x) => {
    const d = String(x.won_date || '')
    if (from && d < from) return false
    if (to && d > to) return false
    if (f.product && !String(x.productNames || '').includes(f.product)) return false
    return true
  }) as never[]
}

/** 月度折线数据 */
function buildTrend(rows: OrderRow[], mode: 'year' | 'month', activeYear: string) {
  if (mode === 'year') {
    const m = new Map<string, { usd: number; n: number }>()
    rows.forEach((r) => {
      const k = String(r.won_date).slice(0, 4)
      if (!/^\d{4}$/.test(k)) return
      const a = m.get(k) ?? { usd: 0, n: 0 }; a.usd += r.usdApprox || 0; a.n += 1; m.set(k, a)
    })
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([key, v]) => ({ key, label: `${key}年`, ...v }))
  }
  const arr = Array.from({ length: 12 }, (_, i) => ({ key: `${activeYear}-${String(i + 1).padStart(2, '0')}`, label: `${i + 1}月`, usd: 0, n: 0 }))
  rows.forEach((r) => {
    const dd = String(r.won_date)
    if (!dd.startsWith(activeYear + '-')) return
    const i = Number(dd.slice(5, 7)) - 1
    if (i < 0 || i > 11) return
    arr[i].usd += r.usdApprox || 0; arr[i].n += 1
  })
  return arr
}

/** 一张表所需的全部口径（产品 / 小组业绩 / 组内成员 / 个人 / 客户 / 月度小组） */
function computeAggregate(rows: OrderRow[], ctx: { fx: Record<string, number>; teamOf: Map<string, string>; salesMeta: { name: string; team: string }[]; teamNamesAll: string[] }) {
  const { fx, teamOf, salesMeta, teamNamesAll } = ctx
  const sumUsd = rows.reduce((a, r) => a + (r.usdApprox || 0), 0)
  const cycles = rows.map((r) => r.cycleDays).filter((x): x is number => typeof x === 'number' && x >= 0)
  const avgCycle = cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null

  // 产品维度
  const pm = new Map<string, { count: number; usd: number; cycles: number[] }>()
  rows.forEach((r) => {
    (r.items || []).forEach((it) => {
      const a = pm.get(it.product_name) ?? { count: 0, usd: 0, cycles: [] as number[] }
      a.count += 1
      a.usd += (Number(it.amount) || 0) / (fx[it.currency] || 1)
      if (typeof r.cycleDays === 'number' && r.cycleDays >= 0) a.cycles.push(r.cycleDays)
      pm.set(it.product_name, a)
    })
  })
  const productRows = Array.from(pm.entries()).map(([name, v]) => ({
    name, count: v.count, usd: Math.round(v.usd),
    avgCycle: v.cycles.length ? Math.round(v.cycles.reduce((x, y) => x + y, 0) / v.cycles.length) : null,
  })).sort((a, b) => b.count - a.count || b.usd - a.usd)

  // 其它维度（来源 / 采购方 / 国别 / 币种 / 使用地点 / 客户 / 销售）：与按产品同一口径，供「按其他维度」表切换
  const dimRows: Record<string, DimRow[]> = {}
  DIMS.forEach((dim) => {
    const m = new Map<string, { usd: number; n: number; cycles: number[] }>()
    rows.forEach((r) => {
      const k = dim.of(r) || UNKNOWN
      const a = m.get(k) ?? { usd: 0, n: 0, cycles: [] as number[] }
      a.usd += r.usdApprox || 0; a.n += 1
      if (typeof r.cycleDays === 'number' && r.cycleDays >= 0) a.cycles.push(r.cycleDays)
      m.set(k, a)
    })
    dimRows[dim.key] = Array.from(m.entries()).map(([name, v]) => ({
      name, count: v.n, usd: Math.round(v.usd),
      avgCycle: v.cycles.length ? Math.round(v.cycles.reduce((x, y) => x + y, 0) / v.cycles.length) : null,
    })).sort((a, b) => b.usd - a.usd || a.name.localeCompare(b.name))
  })

  // 月度 × 小组
  const mm = new Map<string, { month: string; total: { usd: number; n: number }; teams: Map<string, { usd: number; n: number }> }>()
  rows.forEach((r) => {
    const month = String(r.won_date).slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) return
    const team = teamOf.get(r.sales) ?? '未分组'
    const cell = mm.get(month) ?? { month, total: { usd: 0, n: 0 }, teams: new Map<string, { usd: number; n: number }>() }
    const t = cell.teams.get(team) ?? { usd: 0, n: 0 }
    t.usd += r.usdApprox || 0; t.n += 1
    cell.teams.set(team, t)
    cell.total.usd += r.usdApprox || 0; cell.total.n += 1
    mm.set(month, cell)
  })
  const monthTeams = Array.from(mm.values()).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 5)  // 与表格统一高度匹配：正好 5 行
  const names = new Set<string>()
  monthTeams.forEach((mo) => mo.teams.forEach((_v, k) => names.add(k)))
  const ordered = salesMeta.map((x) => x.team || '未分组').filter((t, i, a) => a.indexOf(t) === i)
  const activeTeams = ordered.filter((t) => names.has(t)).concat(Array.from(names).filter((n) => !ordered.includes(n)))

  // 客户排行
  const cm = new Map<string, { usd: number; n: number }>()
  rows.forEach((r) => { const a = cm.get(r.customer_name) ?? { usd: 0, n: 0 }; a.usd += r.usdApprox || 0; a.n += 1; cm.set(r.customer_name, a) })
  const topCustomers = Array.from(cm.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.usd - a.usd).slice(0, 10)

  // 小组业绩
  const gm = new Map<string, { n: number; usd: number; cycles: number[]; people: Set<string>; customers: Set<string> }>()
  rows.forEach((r) => {
    const team = teamOf.get(r.sales) ?? '未分组'
    const a = gm.get(team) ?? { n: 0, usd: 0, cycles: [] as number[], people: new Set<string>(), customers: new Set<string>() }
    a.n += 1; a.usd += r.usdApprox || 0; a.people.add(r.sales || '未指定'); a.customers.add(r.customer_name || '未知客户')
    if (typeof r.cycleDays === 'number' && r.cycleDays >= 0) a.cycles.push(r.cycleDays)
    gm.set(team, a)
  })
  teamNamesAll.forEach((t) => { if (!gm.has(t)) gm.set(t, { n: 0, usd: 0, cycles: [], people: new Set(salesMeta.filter((x) => (x.team || '未分组') === t).map((x) => x.name)), customers: new Set<string>() }) })
  const tlist = Array.from(gm.entries()).map(([name, v]) => ({
    name, n: v.n, usd: Math.round(v.usd),
    people: Math.max(v.people.size, salesMeta.filter((x) => (x.team || '未分组') === name).length),
    customerCount: v.customers.size, share: 0,
    perPerson: v.people.size || salesMeta.some((x) => (x.team || '未分组') === name) ? Math.round(v.usd / Math.max(v.people.size, salesMeta.filter((x) => (x.team || '未分组') === name).length)) : null,
    perOrder: v.n ? Math.round(v.usd / v.n) : null,
    perCustomer: v.customers.size ? Math.round(v.usd / v.customers.size) : null,
    avgCycle: v.cycles.length ? Math.round(v.cycles.reduce((x, y) => x + y, 0) / v.cycles.length) : null,
  }))
  const tTotal = tlist.reduce((x, v) => x + v.usd, 0)
  const tCount = tlist.filter((t) => t.n > 0).length || 1
  const tAvg = tTotal / tCount
  const teamRows = tlist.map((t) => ({
    ...t, share: tTotal ? Math.round((t.usd / tTotal) * 1000) / 10 : 0,
    vsAvg: tTotal ? Math.round(((t.usd - tAvg) / tAvg) * 1000) / 10 : 0,
    vsTop: 0, gapTop: 0,
  })).sort((a, b) => b.usd - a.usd).map((t, _i, arr) => ({ ...t, vsTop: arr[0]?.usd ? Math.round((t.usd / arr[0].usd) * 1000) / 10 : 0, gapTop: Math.max(0, (arr[0]?.usd ?? 0) - t.usd) }))

  // 组内成员（按小组分组）
  const bm = new Map<string, { n: number; usd: number; cycles: number[]; customers: Map<string, { usd: number; n: number }> }>()
  rows.forEach((r) => {
    const k = r.sales || '未指定'
    const a = bm.get(k) ?? { n: 0, usd: 0, cycles: [] as number[], customers: new Map<string, { usd: number; n: number }>() }
    a.n += 1; a.usd += r.usdApprox || 0
    const cust = r.customer_name || '未知客户'
    const c = a.customers.get(cust) ?? { usd: 0, n: 0 }
    c.usd += r.usdApprox || 0; c.n += 1
    a.customers.set(cust, c)
    if (typeof r.cycleDays === 'number' && r.cycleDays >= 0) a.cycles.push(r.cycleDays)
    bm.set(k, a)
  })
  const gNames = Array.from(new Set(salesMeta.map((x) => x.team || '未分组')))
  rows.forEach((r) => { const t = teamOf.get(r.sales) ?? '未分组'; if (!gNames.includes(t)) gNames.push(t) })
  const teamMembers = gNames.map((team) => {
    const members = Array.from(new Set(salesMeta.filter((x) => (x.team || '未分组') === team).map((x) => x.name)))
    bm.forEach((_v, k) => { if ((teamOf.get(k) ?? '未分组') === team && !members.includes(k)) members.push(k) })
    const list = members.map((name) => {
      const v = bm.get(name) ?? { n: 0, usd: 0, cycles: [], customers: new Map<string, { usd: number; n: number }>() }
      const customerList = Array.from((v.customers ?? new Map()).entries()).map(([cname, cv]) => ({ name: cname, usd: Math.round(cv.usd), n: cv.n })).sort((a, b) => b.usd - a.usd)
      return {
        name, n: v.n, usd: Math.round(v.usd), customerCount: customerList.length, customers: customerList,
        perOrder: v.n ? Math.round(v.usd / v.n) : null,
        perCustomer: customerList.length ? Math.round(v.usd / customerList.length) : null,
        avgCycle: v.cycles.length ? Math.round(v.cycles.reduce((x, y) => x + y, 0) / v.cycles.length) : null,
      }
    }).sort((a, b) => b.usd - a.usd)
    const total = list.reduce((x, v) => x + v.usd, 0)
    return { team, list, usd: Math.round(total), n: list.reduce((x, v) => x + v.n, 0), rows: list.map((m) => ({ ...m, share: total ? Math.round((m.usd / total) * 1000) / 10 : 0 })) }
  }).filter((t) => t.list.length > 0).sort((a, b) => b.usd - a.usd)

  // 个人（销售）维度
  const sm = new Map<string, { n: number; usd: number; cycles: number[]; customers: Map<string, { usd: number; n: number }> }>()
  rows.forEach((r) => {
    const k = r.sales || '未指定'
    const a = sm.get(k) ?? { n: 0, usd: 0, cycles: [] as number[], customers: new Map<string, { usd: number; n: number }>() }
    a.n += 1; a.usd += r.usdApprox || 0
    if (typeof r.cycleDays === 'number' && r.cycleDays >= 0) a.cycles.push(r.cycleDays)
    const cust = r.customer_name || '未知客户'
    const c = a.customers.get(cust) ?? { usd: 0, n: 0 }
    c.usd += r.usdApprox || 0; c.n += 1
    a.customers.set(cust, c)
    sm.set(k, a)
  })
  salesMeta.forEach((x) => { if (!sm.has(x.name)) sm.set(x.name, { n: 0, usd: 0, cycles: [], customers: new Map() }) })
  const salesRows = Array.from(sm.entries()).map(([name, v]) => {
    const customers = Array.from(v.customers.entries()).map(([cname, cv]) => ({ name: cname, usd: Math.round(cv.usd), n: cv.n })).sort((a, b) => b.usd - a.usd)
    return {
      name, n: v.n, usd: Math.round(v.usd), team: teamOf.get(name) ?? '未分组',
      customerCount: customers.length, customers,
      perCustomer: customers.length ? Math.round(v.usd / customers.length) : null,
      perOrder: v.n ? Math.round(v.usd / v.n) : null,
      customerRows: customers.map((c) => ({ ...c, avgOrder: c.n ? Math.round(c.usd / c.n) : null, share: v.usd ? Math.round((c.usd / v.usd) * 1000) / 10 : 0 })),
      avgCycle: v.cycles.length ? Math.round(v.cycles.reduce((x, y) => x + y, 0) / v.cycles.length) : null,
    }
  }).sort((a, b) => b.usd - a.usd)

  const cycleRange: [number, number] | null = cycles.length ? [Math.min(...cycles), Math.max(...cycles)] : null
  return { rows, sumUsd, avgCycle, cycleRange, productRows, dimRows, monthTeams, activeTeams, topCustomers, teamRows, teamMembers, salesRows }
}

/** 组内对比卡片的主色（每组一条，便于区分） */
const TEAM_TONES = ['#0052d9', '#0f7a45', '#a35c00', '#7c3aed', '#dc2626', '#0e7490']

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
const cycleTone = (d: number | null) => (d == null ? 'var(--sub)' : d <= 30 ? '#059669' : d <= 90 ? '#a35c00' : 'var(--danger)')
const niceMax = (v: number) => {
  if (v <= 0) return 1
  const exp = Math.floor(Math.log10(v)); const base = Math.pow(10, exp); const f = v / base
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * base
}
const compact = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))

/** 每个分析板块统一外壳：标题 + 说明 + 图示 + 明细 */
function Panel({ title, hint, hintTitle, children, extra, style }: { title: string; hint?: string; hintTitle?: string; children: React.ReactNode; extra?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section className="card panel-tight" style={style}>
      <div className="panel-head">
        <h4 className="panel-title" title={hintTitle}>{title}</h4>
        {hint && <span className="hint panel-hint" title={hintTitle} style={hintTitle ? { cursor: 'help' } : undefined}>{hint}</span>}
        <span style={{ flex: 1 }} />
        {extra}
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </section>
  )
}

/** 分区标题：把九个板块按主题分组，便于扫读 */
function Section({ title, note }: { title: string; note?: string }) {
  return (
    <div className="dash-sec">
      <span className="dash-sec-t">{title}</span>
      {note && <span className="hint" style={{ fontSize: 11.5 }}>{note}</span>}
      <span className="dash-sec-line" />
    </div>
  )
}

/** 图文结合：左边名称、中间条形、右边数值与备注 */
/** 纯数据表格：这些分析板块只保留数字，不做条形/色块图 */
function DataTable({ cols, rows, empty = '暂无数据', widths, topCol, topLabel }: { cols: string[]; rows: React.ReactNode[][]; empty?: string; widths?: string[]; topCol?: number; topLabel?: string }) {
  return (
    <div className="tablewrap tbl-fit">
      <table className="grid data-table fixed-table" style={{ fontSize: 12.5 }}>
        {widths && <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>}
        <thead><tr>{cols.map((h, j) => <th key={h} style={{ textAlign: j === 0 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            // 首行即最高值：整行浅蓝底 + 关键数值加粗上色 + TOP 徽标，突出重点
            <tr key={i} className={i === 0 && rows.length > 1 ? 'row-top' : undefined}>
              {r.map((c, j) => (
                <td key={j} style={{ textAlign: j === 0 ? 'left' : 'right' }}
                  className={(j === 0 ? 'ellip ' : '') + (i === 0 && rows.length > 1 && j === (topCol ?? 1) ? 'cell-top' : '')}
                  title={typeof c === 'string' ? c : undefined}>
                  {c}{i === 0 && rows.length > 1 && j === 0 && topLabel ? <span className="top-badge">{topLabel}</span> : null}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={cols.length} className="hint" style={{ textAlign: 'center' }}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function Kpi({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div className="kpi-chip" style={tone ? { borderTopColor: tone } : undefined}>
      <span className="kpi-label">{label}</span>
      <b className="kpi-value" style={{ color: tone ?? 'var(--brand)' }}>{value}</b>
      {note && <span className="kpi-note">{note}</span>}
    </div>
  )
}

/** 金额趋势：平滑折线 + 刻度网格 + 数据点标注 + 悬浮提示 */
function TrendChart({ data }: { data: { key: string; label: string; usd: number; n: number }[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(760)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver((entries) => { const cw = entries[0]?.contentRect.width ?? 0; if (cw > 40) setW(cw) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = 180, padL = 76, padR = 22, padT = 22, padB = 36
  const innerW = Math.max(60, w - padL - padR)
  const innerH = H - padT - padB
  const top = niceMax(Math.max(...data.map((d) => d.usd), 0))
  const step = data.length > 1 ? innerW / (data.length - 1) : 0
  const px = (i: number) => padL + (data.length > 1 ? i * step : innerW / 2)
  const py = (v: number) => padT + innerH - (v / top) * innerH
  const pts = data.map((d, i) => [px(i), py(d.usd)] as const)
  const smooth = pts.reduce((acc, pt, i) => {
    if (i === 0) return `M${pt[0].toFixed(1)},${pt[1].toFixed(1)}`
    const prev = pts[i - 1]; const cx = (prev[0] + pt[0]) / 2
    return `${acc} C${cx.toFixed(1)},${prev[1].toFixed(1)} ${cx.toFixed(1)},${pt[1].toFixed(1)} ${pt[0].toFixed(1)},${pt[1].toFixed(1)}`
  }, '')
  const area = `${smooth} L${pts[pts.length - 1][0].toFixed(1)},${padT + innerH} L${pts[0][0].toFixed(1)},${padT + innerH} Z`
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((r) => ({ v: top * r, y: padT + innerH - r * innerH }))
  const peak = data.reduce((mi, d, i) => (d.usd > data[mi].usd ? i : mi), 0)
  const total = data.reduce((a, b) => a + b.usd, 0)
  const showValue = data.length <= 14 && innerW / Math.max(1, data.length) > 46
  const hv = hover != null ? data[hover] : null
  return (
    <div ref={wrap} className="trend-wrap">
      <svg width={w} height={H} style={{ display: 'block' }} role="img" aria-label="订单金额趋势">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0052d9" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#0052d9" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t.y}>
            <line x1={padL} y1={t.y} x2={padL + innerW} y2={t.y} stroke="#e8ecf3" strokeWidth="1" />
            <text x={padL - 8} y={t.y + 4} textAnchor="end" fontSize="11" fill="#8a94a6">{compact(t.v)}</text>
          </g>
        ))}
        <path d={area} fill="url(#trendFill)" stroke="none" />
        <path d={smooth} fill="none" stroke="#0052d9" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((pt, i) => (
          <g key={data[i].key}>
            <circle cx={pt[0]} cy={pt[1]} r={hover === i ? 6 : i === peak && data[i].usd > 0 ? 5 : 4}
              fill={data[i].usd > 0 ? '#fff' : '#f2f4f8'} stroke={i === peak && data[i].usd > 0 ? '#ef4f0b' : '#0052d9'} strokeWidth={hover === i ? 3 : 2.2} />
            {showValue && data[i].usd > 0 && (() => {
              // 首/末点分别左对齐、右对齐，避免压到左侧刻度或越出右边界
              const anchor = i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'
              return <text x={pt[0]} y={pt[1] - 11} textAnchor={anchor} fontSize="11" fontWeight={700} fill={i === peak ? '#ef4f0b' : '#33405a'}>{compact(data[i].usd)}</text>
            })()}
            <text x={px(i)} y={H - 11} textAnchor="middle" fontSize="11.5" fill={hover === i ? '#0052d9' : '#6b7488'} fontWeight={hover === i ? 700 : 400}>{data[i].label}</text>
            <rect x={px(i) - (step || innerW) / 2} y={padT} width={step || innerW} height={innerH} fill="transparent"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }} />
          </g>
        ))}
        {hover != null && <line x1={px(hover)} y1={padT} x2={px(hover)} y2={padT + innerH} stroke="#0052d9" strokeDasharray="3 3" strokeWidth="1" />}
      </svg>
      {hv && (
        <div className="trend-tip" style={{ left: Math.min(Math.max(px(hover!) - 70, 4), Math.max(4, w - 164)) }}>
          <div style={{ fontWeight: 700 }}>{hv.label}</div>
          <div>金额 <b>{money(hv.usd)}</b> USD</div>
          <div>订单 <b>{hv.n}</b> 单 · 占比 <b>{total ? Math.round((hv.usd / total) * 100) : 0}%</b></div>
          {hv.usd > 0 && hv.label === data[peak].label && <div className="hint">本期最高</div>}
        </div>
      )}
    </div>
  )
}

export default function ContractsAnalysis({ meta }: { meta: MetaLite }) {
  /* ===== 每张表各自筛选（不再有全局筛选）：时间范围 + 可选产品/小组/个人 ===== */
  type PanelF = { range: RangeKey; product: string }
  const [fKpi, setFKpi] = useState<PanelF>({ range: '', product: '' })
  const [fTrend, setFTrend] = useState<PanelF>({ range: '', product: '' })
  const [fProduct, setFProduct] = useState<PanelF>({ range: '', product: '' })
  const [fTeam, setFTeam] = useState<PanelF>({ range: '', product: '' })
  const [fMonth, setFMonth] = useState<PanelF>({ range: '', product: '' })
  const [fReason, setFReason] = useState<PanelF>({ range: '', product: '' })
  const [fCustomer, setFCustomer] = useState<PanelF>({ range: '', product: '' })
  const [fPerson, setFPerson] = useState<PanelF>({ range: '', product: '' })
  const [fCust, setFCust] = useState<PanelF>({ range: '', product: '' })
  const [custPerson, setCustPerson] = useState('')
  const [fGroup, setFGroup] = useState<PanelF>({ range: '', product: '' })
  /** 按其他维度：本表自己的时间范围/产品筛选 + 维度选择（'' 表示自动取当前范围内有数据的第一个维度） */
  const [fDim, setFDim] = useState<PanelF>({ range: '', product: '' })
  const [dimKey, setDimKey] = useState('')

  const [allRows, setAllRows] = useState<OrderRow[]>([])
  const [msg, setMsg] = useState('')
  const [kpiReason, setKpiReason] = useState<ReasonData | null>(null)
  const [reasonData, setReasonData] = useState<ReasonData | null>(null)
  // 按产品分析：产品下拉（取自产品档案）
  const [products, setProducts] = useState<{ id: string; name: string; use_count: number }[]>([])
  useEffect(() => { get<{ id: string; name: string; use_count: number }[]>('/products').then((l) => setProducts(Array.isArray(l) ? l : [])).catch(() => { /* */ }) }, [])
  const [trendMode, setTrendMode] = useState<'year' | 'month'>('year')
  // 分析子页面：拆分查看，避免一屏堆叠混乱；选择记在本地，刷新后保持
  type TabKey = 'all' | 'person' | 'group'
  const TABS: { key: TabKey; label: string; note: string }[] = [
    { key: 'all', label: '整体数据', note: '关键指标、金额趋势、按产品、小组业绩对比与月度小组拆解、成交与丢单原因、客户排行（每张表可单独筛选）' },
    { key: 'person', label: '个人分析', note: '按销售看其名下所有客户的订单：客户单价（每个客户的平均订单金额）与单均价（所有订单的平均金额）' },
    { key: 'group', label: '组内分析', note: '小组内部各成员的成单明细与排名（每个小组一张卡片）' },
  ]
  const [tab, setTab] = useState<TabKey>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('sa:anaTab') : null
    return (TABS.some((t) => t.key === saved) ? saved : 'all') as TabKey   // 旧版「小组」标签已并入整体数据
  })
  useEffect(() => { try { localStorage.setItem('sa:anaTab', tab) } catch { /* */ } }, [tab])
  // 组内子页面：再按小组筛选
  const [teamFilter, setTeamFilter] = useState('')
  // 个人分析子页面：先按小组筛，再按个人筛（默认第一名的销售）
  const [personTeam, setPersonTeam] = useState('')
  const [personSel, setPersonSel] = useState('')
  const [year, setYear] = useState('')

  // 只加载全量订单：各表格用自己的筛选在本地过滤
  const load = useCallback(async () => {
    try { const d = await get<{ rows: OrderRow[] }>('/orders'); setAllRows(d.rows); setMsg('') }
    catch (e) { setMsg((e as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])

  // 成交原因 / 丢单原因：按各自表格的筛选单独请求（这两项依赖丢单询价，需服务端算）
  const reasonQs = useCallback((f: PanelF) => {
    const p = new URLSearchParams(); const { from, to } = rangeDates(f.range)
    if (from) p.set('from', from); if (to) p.set('to', to); if (f.product) p.set('product', f.product)
    return p.toString()
  }, [])
  useEffect(() => { get<ReasonData>(`/analysis/reasons?${reasonQs(fKpi)}`).then(setKpiReason).catch(() => setKpiReason(null)) }, [fKpi, reasonQs])
  useEffect(() => { get<ReasonData>(`/analysis/reasons?${reasonQs(fReason)}`).then(setReasonData).catch(() => setReasonData(null)) }, [fReason, reasonQs])

  const fx = meta.fx ?? { USD: 1, CNY: 7.12, EUR: 0.92 }
  // 小组（团队）维度：销售 → 组别；未匹配到的归入「未分组」
  const teamOf = useMemo(() => {
    const m = new Map<string, string>()
    meta.sales.forEach((x) => m.set(x.name, x.team || '未分组'))
    return m
  }, [meta.sales])
  const teamNamesAll = useMemo(() => Array.from(new Set(meta.sales.map((x) => (x.team || '未分组')))), [meta.sales])

  /** 每张表的数据：按该表自己的筛选过滤后，算出这张表需要的全部口径 */
  const aggregate = useCallback((rowsIn: OrderRow[]) => computeAggregate(rowsIn, { fx, teamOf, salesMeta: meta.sales, teamNamesAll }), [fx, teamOf, meta.sales, teamNamesAll])
  const usePanel = (f: PanelF) => useMemo(() => aggregate(filterPanelRows(allRows, f)), [allRows, f, aggregate])
  const K = usePanel(fKpi)
  const T = usePanel(fTrend)
  const PD = usePanel(fProduct)
  const TM = usePanel(fTeam)
  const MO = usePanel(fMonth)
  const CU = usePanel(fCustomer)
  const PE = usePanel(fPerson)
  /** 客户分析：有自己的筛选（时间范围/产品）与自己的销售选择，不跟随其它表 */
  const CP = usePanel(fCust)
  /** 「占全公司」的分母：同一时间范围内、不叠加产品筛选的全公司口径（产品筛选只影响本表展示范围） */
  const fCustAll = useMemo<PanelF>(() => ({ range: fCust.range, product: '' }), [fCust.range])
  const CPall = usePanel(fCustAll)
  const GR = usePanel(fGroup)
  const DM = usePanel(fDim)
  /** 当前生效维度：手选优先；若手选维度在本表筛选下没有数据，则自动落到第一个有数据的维度，保证表格不空 */
  const activeDim = DIMS.find((d) => d.key === dimKey && (DM.dimRows[d.key]?.length ?? 0) > 0)
    ?? DIMS.find((d) => (DM.dimRows[d.key]?.length ?? 0) > 0) ?? DIMS[0]
  const dimList = DM.dimRows[activeDim.key] ?? []
  const dimSum = dimList.reduce((a, b) => a + b.usd, 0)

  const years = useMemo(() => {
    const set = new Set<string>()
    T.rows.forEach((r) => { const y = String(r.won_date).slice(0, 4); if (/^\d{4}$/.test(y)) set.add(y) })
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [T.rows])
  const curYear = String(new Date().getFullYear())
  const activeYear = year || (years.includes(curYear) ? curYear : (years[0] ?? curYear))
  const trend = useMemo(() => buildTrend(T.rows, trendMode, activeYear), [T.rows, trendMode, activeYear])
  const trendN = trend.reduce((a, b) => a + b.n, 0)

  /** 个人分析：按小组/个人筛选后的销售列表（默认全部） */
  const personRows = useMemo(() => {
    const list = personTeam ? PE.salesRows.filter((p) => p.team === personTeam) : PE.salesRows
    return personSel ? list.filter((p) => p.name === personSel) : list
  }, [PE.salesRows, personTeam, personSel])
  /** 组内子页面当前展示的小组（按小组筛选后） */
  const shownTeams = useMemo(() => (teamFilter ? GR.teamMembers.filter((t) => t.team === teamFilter) : GR.teamMembers), [GR.teamMembers, teamFilter])
  const activeTeams = MO.activeTeams
  const kpiWin = kpiReason?.win
  const kpiLost = kpiReason?.lost
  const winSum = reasonData?.win
  const lostSum = reasonData?.lost
  const stats = { contractCount: K.rows.length, usdTotal: K.sumUsd, avgCycle: K.avgCycle }
  const sumUsd = CU.sumUsd

  /** 表格自己的筛选条：时间范围（+ 可选产品） */
  const rangeSelect = (f: PanelF, set: (v: PanelF) => void) => (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <select className="sa" style={{ width: 122 }} value={f.range} title="本表时间范围（仅影响这张表）"
        onChange={(e) => set({ ...f, range: e.target.value as RangeKey })}>
        {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => <option key={k} value={k}>{RANGE_LABEL[k]}</option>)}
      </select>
      <select className="sa" style={{ width: 150 }} value={f.product} title="本表产品筛选（仅影响这张表）"
        onChange={(e) => set({ ...f, product: e.target.value })}>
        <option value="">全部产品</option>
        {products.map((pr) => <option key={pr.id} value={pr.name}>{pr.name}</option>)}
        {f.product && !products.some((pr) => pr.name === f.product) && <option value={f.product}>{f.product}</option>}
      </select>
    </span>
  )

  return (
    <div className="page-fit scroll ana-page">
      {/* 页头：不再有全局筛选（每张表各自筛选），只保留标题与刷新 */}
      <section className="card panel-tight auto">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>销售订单分析</h3>
          <span className="hint" title="每张表都有自己的筛选条（时间范围 + 产品/小组/个人，视表而定），互不影响；金额均取订单上填写的成交金额折 USD" style={{ flex: 1, minWidth: 220, cursor: 'help' }}>每张表可单独筛选，互不影响；金额＝订单成交金额折 USD</span>
          <button className="btn sm" onClick={() => void load()}>刷新</button>
        </div>
        {msg && <div className="msg err">{msg}</div>}
      </section>

      {/* 子页面切换：每个分析维度单独一页查看，避免堆叠混乱 */}
      <div className="ana-tabs">
        <div className="ana-tabs-l">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)} title={t.note}>{t.label}</button>
          ))}
        </div>
        <span className="hint ana-note">{TABS.find((t) => t.key === tab)?.note}</span>
        {tab === 'group' && (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
            {rangeSelect(fGroup, setFGroup)}
            <select className="sa" style={{ width: 150 }} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} title="按小组筛选（本页）">
              <option value="">全部小组</option>
              {teamNamesAll.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </span>
        )}
      </div>

      {/* 当前子页的关键数字速览 */}
      <div className="ana-sum">
        {tab === 'all' && (<>
          <span className="ana-sum-i"><b>{K.rows.length}</b> 单</span>
          <span className="ana-sum-i"><b>{money(K.sumUsd)}</b> USD</span>
          <span className="ana-sum-i">平均周期 <b>{K.avgCycle == null ? '—' : `${K.avgCycle} 天`}</b></span>
          <span className="ana-sum-i">成交 <b>{kpiWin?.total ?? 0}</b> · 丢单 <b>{kpiLost?.total ?? 0}</b></span>
          <span className="ana-sum-i">客户 <b>{CU.topCustomers.length}</b> 家 · 产品 <b>{PD.productRows.length}</b> 个 · 小组 <b>{TM.teamRows.length}</b> 个 · 销售 <b>{PE.salesRows.length}</b> 名</span>
        </>)}
        {tab === 'person' && (<>
          <span className="ana-sum-i">销售 <b>{personRows.length}</b> 名</span>
          <span className="ana-sum-i">客户 <b>{PE.topCustomers.length}</b> 家</span>
          <span className="ana-sum-i">订单 <b>{PE.rows.length}</b> 单</span>
          <span className="ana-sum-i">金额 <b>{money(PE.sumUsd)}</b> USD</span>
          <span className="ana-sum-i">单均价 <b>{PE.rows.length ? money(Math.round(PE.sumUsd / PE.rows.length)) : '—'}</b></span>
        </>)}
        {tab === 'group' && (<>
          <span className="ana-sum-i">成员 <b>{shownTeams.reduce((a, t) => a + t.list.length, 0)}</b> 人</span>
          <span className="ana-sum-i">其中有成单 <b>{shownTeams.reduce((a, t) => a + t.rows.filter((m) => m.n > 0).length, 0)}</b> 人</span>
          <span className="ana-sum-i">合计 <b>{money(shownTeams.reduce((a, t) => a + t.usd, 0))}</b> USD</span>
          <span className="ana-sum-i">最高成员 <b>{(() => { const all = shownTeams.flatMap((t) => t.rows); const top = [...all].sort((a, b) => b.usd - a.usd)[0]; return top ? `${top.name}（${money(top.usd)}）` : '—' })()}</b></span>
        </>)}
      </div>

      <div className="dash-grid" style={{ marginTop: 10 }}>
        {tab === 'all' && <Section title="概览" />}

        {tab === 'all' && (<>
        <div className="dash-span2 kpi-grid">
          {stats && (<>
            <Kpi label="销售订单数" value={`${K.rows.length} 单`} note={K.rows.length ? `平均单值 ${money(K.sumUsd / K.rows.length)} USD` : ''} />
            <Kpi label="订单金额（折USD）" value={money(K.sumUsd)} tone="var(--brand)" note={`成交 ${kpiWin?.total ?? 0} · 丢单 ${kpiLost?.total ?? 0}`} />
            <Kpi label="平均转化周期" value={K.avgCycle == null ? '—' : `${K.avgCycle} 天`} tone={cycleTone(K.avgCycle)} note={K.cycleRange ? `${K.cycleRange[0]} ~ ${K.cycleRange[1]} 天` : ''} />
            <Kpi label="丢单金额（折USD）" value={money(kpiLost?.usdTotal ?? 0)} tone="var(--danger)" note={kpiWin && kpiWin.usdTotal > 0 && kpiLost ? `占成交 ${Math.round((kpiLost.usdTotal / kpiWin.usdTotal) * 100)}%` : ''} />
          </>)}
        </div>

        <Panel
          style={{ gridColumn: '1 / -1' }}
          title="订单金额趋势（折USD）"
          hint={trendMode === 'year' ? `按年 · 合计 ≈USD ${money(trend.reduce((a, b) => a + b.usd, 0))} · ${trendN} 单` : `${activeYear} 年各月 · 合计 ≈USD ${money(trend.reduce((a, b) => a + b.usd, 0))} · ${trendN} 单`}
          extra={(
            <>
              {rangeSelect(fTrend, setFTrend)}
              <span className="seg">
                <button className={trendMode === 'year' ? 'on' : ''} onClick={() => setTrendMode('year')}>年度</button>
                <button className={trendMode === 'month' ? 'on' : ''} onClick={() => setTrendMode('month')}>月度</button>
              </span>
              {trendMode === 'month' && (
                <select className="sa" style={{ width: 100 }} value={activeYear} onChange={(e) => setYear(e.target.value)}>
                  {(years.length ? years : [curYear]).map((y) => <option key={y} value={y}>{y} 年</option>)}
                </select>
              )}
            </>
          )}
        >
          {trend.length && trendN > 0 ? <TrendChart data={trend} /> : <div className="hint" style={{ fontSize: 12 }}>暂无数据</div>}
        </Panel>

        </>)}

        {tab === 'all' && <Section title="产品与维度" />}

        {tab === 'all' && (
        <Panel title="按产品"
          hint={`${fProduct.product ? `已筛「${fProduct.product}」· ` : ''}${PD.productRows.length} 个产品 · ${money(PD.sumUsd)} USD`}
          hintTitle="口径：只统计成单日期落在本表筛选范围内的销售订单；金额＝订单上填写的成交金额折 USD；平均周期＝该产品所在订单的平均成单周期（天）"
          extra={rangeSelect(fProduct, setFProduct)}>
          <DataTable
            cols={['产品', '成单次数', '金额（折USD）', '金额占比', '平均周期']}
            widths={['34%', '15%', '20%', '15%', '16%']}
            topCol={2} topLabel="最高"
            empty="暂无成单产品"
            rows={PD.productRows.slice(0, 15).map((p) => [
              p.name, `${p.count} 次`, money(p.usd), `${PD.sumUsd ? Math.round((p.usd / PD.sumUsd) * 1000) / 10 : 0}%`,
              p.avgCycle == null ? '—' : `${p.avgCycle} 天`,
            ])}
          />
          {PD.productRows.length > 15 && <div className="hint" style={{ fontSize: 11 }}>仅显示前 15 个</div>}
        </Panel>
        )}

        {/* 按其他维度：与「按产品」并列，维度可切换（来源/采购方/国别/币种/使用地点/客户/销售） */}
        {tab === 'all' && (
        <Panel title={`按${activeDim.label}`}
          hint={`${dimList.length} 个取值 · ${money(dimSum)} USD`}
          hintTitle={`口径与「按产品」一致：只统计成单日期落在本表筛选范围内的销售订单（金额＝订单上填写的成交金额折 USD）；下拉可切换维度（${DIMS.map((d) => d.label).join(' / ')}），未填写的取值计入「${UNKNOWN}」`}
          extra={<span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="sa" style={{ width: 116 }} value={activeDim.key} title="选择分析维度（仅影响这张表）"
              onChange={(e) => setDimKey(e.target.value)}>
              {DIMS.map((d) => {
                const n = DM.dimRows[d.key]?.length ?? 0
                return <option key={d.key} value={d.key} disabled={n === 0}>{n === 0 ? `按${d.label}（无数据）` : `按${d.label}`}</option>
              })}
            </select>
            {rangeSelect(fDim, setFDim)}
          </span>}>
          <DataTable
            cols={[activeDim.label, '成单次数', '金额（折USD）', '金额占比', '平均周期']}
            widths={['34%', '15%', '20%', '15%', '16%']}
            topCol={2} topLabel="最高"
            empty={`本表筛选下「${activeDim.label}」暂无成单数据，可换一个维度或调整时间范围`}
            rows={dimList.slice(0, 15).map((d) => [
              d.name, `${d.count} 次`, money(d.usd), `${dimSum ? Math.round((d.usd / dimSum) * 1000) / 10 : 0}%`,
              d.avgCycle == null ? '—' : `${d.avgCycle} 天`,
            ])}
          />
        </Panel>
        )}

        {tab === 'all' && <Section title="团队" />}

        {tab === 'all' && (
        <Panel title="小组业绩分析对比"
          hint={`${TM.teamRows.filter((t) => t.n > 0).length} 个小组 · ${money(TM.sumUsd)} USD${TM.teamRows[0] ? ` · 第一 ${TM.teamRows[0].name}` : ''}`}
          hintTitle="口径：人数＝该组销售（按人员档案归属，未匹配归「未分组」）；人均＝金额÷人数、单均价＝金额÷订单数、客单价＝金额÷客户数、周期＝平均成单周期（天）；占比＝本组金额÷全部小组金额；金额取订单上填写的成交金额折 USD"
          style={{ gridColumn: '1 / -1' }}
          extra={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            {rangeSelect(fTeam, setFTeam)}
            {TM.teamRows.length > 1 && <span className="hint" style={{ fontSize: 11 }}>组均 {money(Math.round(TM.sumUsd / Math.max(1, TM.teamRows.filter((t) => t.n > 0).length)))} USD</span>}
          </span>}>
          <DataTable
            cols={['排名', '小组', '人数', '订单数', '客户数', '金额（USD）', '占比', '人均', '单均价', '客单价', '周期']}
            widths={['9%', '15%', '6%', '8%', '8%', '12%', '8%', '9%', '8%', '9%', '8%']}
            topCol={5} topLabel="第一"
            empty="本期暂无成单，无法进行小组业绩对比（可调整时间范围或筛选）"
            rows={TM.teamRows.map((t, i) => [
              `${i + 1}`,
              i === 0 && t.n > 0 ? `${t.name}（第一）` : t.name,
              `${t.people} 人`,
              `${t.n} 单`,
              `${t.customerCount} 家`,
              money(t.usd),
              `${t.share}%`,
              t.perPerson == null || t.n === 0 ? '—' : money(t.perPerson),
              t.perOrder == null ? '—' : money(t.perOrder),
              t.perCustomer == null ? '—' : money(t.perCustomer),
              t.avgCycle == null || t.n === 0 ? '—' : `${t.avgCycle} 天`,
            ])}
          />
        </Panel>
        )}

        {/* 组内对比：每个小组一张独立卡片（组间用卡片边框 + 左侧色条区分，不与其它组混在一张表里） */}
        {tab === 'group' && shownTeams.length === 0 && (
          <Panel title="组内对比" hint="本页筛选下暂无数据" style={{ gridColumn: '1 / -1' }}>
            <div className="hint" style={{ fontSize: 12 }}>当前筛选（时间范围/产品/小组）下暂无成单成员，可在页面右上调整。</div>
          </Panel>
        )}
        {tab === 'group' && shownTeams.map((t, ti) => {
          const tone = TEAM_TONES[ti % TEAM_TONES.length]
          const customers = t.list.reduce((a, m) => a + (m.customerCount || 0), 0)
          const membersWithOrders = t.rows.filter((m) => m.n > 0).length
          const top = t.rows.find((m) => m.n > 0)
          return (
            <Panel key={t.team} title={`第 ${ti + 1} 组 · ${t.team}`}
              hint={top ? `组内第一：${top.name}（${money(top.usd)} USD）` : '本期无成单成员'}
              style={{ gridColumn: '1 / -1', borderLeft: `4px solid ${tone}` }}
              extra={<span className="team-badge" style={{ background: tone }}>{t.list.length} 人 · {t.n} 单 · {money(t.usd)} USD</span>}>
              {/* 组内汇总：一眼看清这个组整体表现 */}
              <div className="ana-sum" style={{ margin: '2px 0 8px' }}>
                <span className="ana-sum-i">成员 <b>{t.list.length}</b> 人（有成单 <b>{membersWithOrders}</b> 人）</span>
                <span className="ana-sum-i">订单 <b>{t.n}</b> 单</span>
                <span className="ana-sum-i">客户 <b>{customers}</b> 家</span>
                <span className="ana-sum-i">金额 <b>{money(t.usd)}</b> USD</span>
                <span className="ana-sum-i">组内人均 <b>{t.list.length ? money(Math.round(t.usd / t.list.length)) : '—'}</b></span>
                <span className="ana-sum-i">组内单均价 <b>{t.n ? money(Math.round(t.usd / t.n)) : '—'}</b></span>
                <span className="ana-sum-i">小组客户单价 <b>{customers ? money(Math.round(t.usd / customers)) : '—'}</b></span>
              </div>
              <div className="tablewrap tbl-fit">
                <table className="grid data-table fixed-table" style={{ fontSize: 12.5 }}>
                  <colgroup><col style={{ width: '18%' }} /><col style={{ width: '9%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '13%' }} /><col style={{ width: '9%' }} /><col style={{ width: '9%' }} /><col style={{ width: '9%' }} /><col style={{ width: '9%' }} /><col style={{ width: '8%' }} /></colgroup>
                  <thead><tr>{['成员', '组内排名', '订单数', '客户数', '金额（折USD）', '组内占比', '单均价', '客户单价', '平均周期', '与第一'].map((h, j) => <th key={h} style={{ textAlign: j === 0 ? 'left' : 'right' }} title={h === '客户单价' ? '客户单价＝金额÷客户数' : h === '单均价' ? '单均价＝金额÷订单数' : h === '与第一' ? '本成员金额÷组内第一名金额' : undefined}>{h}</th>)}</tr></thead>
                  <tbody>
                    {t.rows.map((m, i) => (
                      <tr key={t.team + m.name} className={i === 0 && m.n > 0 && t.rows.length > 1 ? 'row-top' : undefined} style={{ borderBottom: '1px solid var(--line2)' }}>
                        <td className="ellip" style={{ padding: '6px 8px' }} title={m.name}>
                          {m.name}
                          {i === 0 && m.n > 0 && t.rows.length > 1 && <span className="top-badge">组内第一</span>}
                          {m.n === 0 && <span className="hint" style={{ marginLeft: 6 }}>本期无成单</span>}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{m.n === 0 ? '—' : `第 ${i + 1} 名`}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{m.n} 单</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }} title={m.customers.length ? `名下客户：${m.customers.map((c) => `${c.name} ${money(c.usd)} USD · ${c.n} 单`).join(' ｜ ')}` : '本期无成单客户'}>{m.customerCount}</td>
                        <td className={'mono' + (i === 0 && m.n > 0 && t.rows.length > 1 ? ' cell-top' : '')} style={{ padding: '6px 8px', textAlign: 'right' }}>{money(m.usd)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{m.n === 0 ? '—' : `${m.share}%`}</td>
                        <td className="mono" style={{ padding: '6px 8px', textAlign: 'right' }}>{m.perOrder == null ? '—' : money(m.perOrder)}</td>
                        <td className="mono" style={{ padding: '6px 8px', textAlign: 'right' }}>{m.perCustomer == null ? '—' : money(m.perCustomer)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{m.avgCycle == null ? '—' : `${m.avgCycle} 天`}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: i === 0 ? 'var(--sub)' : '#a35c00', fontWeight: 600 }}>{i === 0 || m.n === 0 ? '—' : `${t.rows[0]?.usd ? Math.round((m.usd / t.rows[0].usd) * 100) : 0}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )
        })}

        {/* 个人分析（独立标签页）：销售汇总 + 该销售名下每个客户的平均订单金额 */}
        {tab === 'person' && <Section title="销售排名" />}

        {tab === 'person' && (
        <Panel title="个人分析"
          hint={`${personRows.length} 名销售 · ${money(personRows.reduce((a, b) => a + b.usd, 0))} USD`}
          hintTitle="含该销售名下所有客户的订单；客户单价＝金额÷客户数、单均价＝金额÷订单数；本期无成单的销售也会列出（金额 0），便于横向对比"
          style={{ gridColumn: '1 / -1' }}
          extra={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            {rangeSelect(fPerson, setFPerson)}
            <select className="sa" style={{ width: 140 }} value={personTeam} title="先按小组筛选"
              onChange={(e) => { setPersonTeam(e.target.value); setPersonSel('') }}>
              <option value="">全部小组</option>
              {teamNamesAll.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="sa" style={{ width: 170 }} value={personSel} title="再按个人筛选"
              onChange={(e) => setPersonSel(e.target.value)}>
              <option value="">全部销售（{personRows.length} 名）</option>
              {personRows.map((p) => <option key={p.name} value={p.name}>{p.name}（{p.team}）</option>)}
            </select>
            <span className="hint" title="客户单价＝金额÷客户数；单均价＝金额÷订单数" style={{ fontSize: 11, cursor: 'help' }}>客户单价 / 单均价 口径</span>
          </span>}>
          <DataTable
            cols={['销售', '小组', '客户数', '订单数', '金额（折USD）', '金额占比', '客户单价', '单均价', '平均周期']}
            widths={['14%', '10%', '9%', '8%', '14%', '10%', '12%', '12%', '11%']}
            topCol={4} topLabel="第一"
            empty="暂无成单销售（可调整时间范围或筛选）"
            rows={personRows.map((p) => [
              p.name,
              p.team,
              <span title={p.customers.length ? `该销售名下客户（${p.customers.length} 个）：` + p.customers.map((c) => `${c.name} ${money(c.usd)} USD · ${c.n} 单`).join(' ｜ ') : '本期暂无成单客户'}>{p.customerCount} 个</span>,
              `${p.n} 单`,
              money(p.usd),
              `${sumUsd ? Math.round((p.usd / sumUsd) * 1000) / 10 : 0}%`,
              p.perCustomer == null ? '—' : money(p.perCustomer),
              p.perOrder == null ? '—' : money(p.perOrder),
              p.avgCycle == null ? '—' : `${p.avgCycle} 天`,
            ])}
          />
        </Panel>
        )}

        {tab === 'person' && <Section title="客户明细" />}

        {tab === 'person' && (() => {
          const pick = custPerson || (personRows[0]?.name ?? '')
          const cur = CP.salesRows.find((x) => x.name === pick) ?? CP.salesRows[0]
          if (!cur) return (
            <Panel title="客户分析" hint="本表当前筛选下暂无数据" style={{ gridColumn: '1 / -1' }} extra={rangeSelect(fCust, setFCust)}>
              <div className="hint" style={{ fontSize: 12 }}>本表当前筛选（时间范围/产品）下暂无成单客户，可调整筛选条或时间范围。</div>
            </Panel>
          )
          const totalUsd = cur.usd
          return (<>
            <Panel title={`客户分析 · ${cur.name}（${cur.team}）`}
              hint={`名下 ${cur.customerCount} 个客户 · ${cur.n} 单 · ${money(totalUsd)} USD`}
              hintTitle={`每个客户一行：订单数 / 金额 / 占其总额（该客户金额÷该销售总额）/ 该客户平均订单金额（＝金额÷订单数）/ 占全公司（该客户金额÷同一时间范围内全公司 ${money(CPall.sumUsd)} USD，不叠加产品筛选）；金额均取订单上填写的成交金额折 USD`}
              style={{ gridColumn: '1 / -1' }}
              extra={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                {rangeSelect(fCust, setFCust)}
                <select className="sa" style={{ width: 200 }} value={cur.name} title="本表选择销售（仅影响这张表）"
                  onChange={(e) => setCustPerson(e.target.value)}>
                  {CP.salesRows.map((p) => <option key={p.name} value={p.name}>{p.name}（{p.customerCount} 客户 · {p.n} 单）</option>)}
                </select>
              </span>}>
              <div className="ana-sum" style={{ marginBottom: 6 }}>
                <span className="ana-sum-i">客户数 <b>{cur.customerCount}</b> 家</span>
                <span className="ana-sum-i">订单数 <b>{cur.n}</b> 单</span>
                <span className="ana-sum-i">金额 <b>{money(totalUsd)}</b> USD</span>
                <span className="ana-sum-i">客户单价 <b>{cur.perCustomer == null ? '—' : money(cur.perCustomer)}</b>（金额÷客户数）</span>
                <span className="ana-sum-i">单均价 <b>{cur.perOrder == null ? '—' : money(cur.perOrder)}</b>（所有订单平均金额）</span>
                <span className="ana-sum-i">平均周期 <b>{cur.avgCycle == null ? '—' : `${cur.avgCycle} 天`}</b></span>
              </div>
              <DataTable
                cols={['客户', '订单数', '金额（折USD）', '占其总额', '该客户平均订单金额', '占全公司']}
                widths={['30%', '13%', '20%', '14%', '15%', '8%']}
                topCol={2} topLabel="最高"
                empty="该销售本期暂无成单客户"
                rows={cur.customerRows.map((c) => [
                  c.name, `${c.n} 单`, money(c.usd), `${CP.sumUsd ? Math.round((c.usd / CP.sumUsd) * 1000) / 10 : 0}%`,
                  c.avgOrder == null ? '—' : money(c.avgOrder),
                  `${CPall.sumUsd ? Math.round((c.usd / CPall.sumUsd) * 1000) / 10 : 0}%`,
                ])}
              />
            </Panel>
          </>)
        })()}



        {tab === 'all' && (<>
        {/* 月度小组分析：每月各组订单数与金额（跟随筛选） */}
        <Panel
          title="月度小组分析"
          hint={MO.monthTeams.length ? `近 ${MO.monthTeams.length} 个月 · 括号内为订单数` : '按成单月份 × 小组'}
          hintTitle={`每月按小组拆解金额与单数（括号内为订单数）；小组：${MO.activeTeams.join(' · ') || '—'}（未匹配到小组的销售归入「未分组」）`}
          style={{ gridColumn: '1 / -1' }}
          extra={rangeSelect(fMonth, setFMonth)}
        >
          {MO.monthTeams.length === 0 ? <div className="hint" style={{ fontSize: 12 }}>暂无成单数据</div> : (
            <>
              <div className="tablewrap tbl-fit">
                <table className="grid data-table fixed-table" style={{ fontSize: 12.5 }}>
                  <colgroup><col style={{ width: '14%' }} />{[...MO.activeTeams, '合计'].map((t) => <col key={t} style={{ width: `${Math.round(86 / (MO.activeTeams.length + 1))}%` }} />)}</colgroup>
                  <thead><tr>{['月份', ...MO.activeTeams, '合计'].map((h, j) => <th key={h} style={{ textAlign: j === 0 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {MO.monthTeams.map((mo) => {
                      const best = MO.activeTeams.reduce((bi, t, i) => ((mo.teams.get(t)?.usd ?? 0) > (mo.teams.get(MO.activeTeams[bi])?.usd ?? 0) ? i : bi), 0)
                      return (
                        <tr key={mo.month} style={{ borderBottom: '1px solid var(--line2)' }}>
                          <td className="mono" style={{ padding: '6px 8px', fontWeight: 700 }}>{mo.month}</td>
                          {MO.activeTeams.map((t, i) => {
                            const v = mo.teams.get(t)
                            const isBest = i === best && !!v && MO.activeTeams.filter((x) => mo.teams.has(x)).length > 1
                            return (
                              <td key={t} style={{ padding: '6px 8px', whiteSpace: 'nowrap', textAlign: 'right', background: isBest ? '#f2f8ff' : undefined }}>
                                {v ? <>
                                  <span className={isBest ? 'cell-top mono' : 'mono'}>{money(v.usd)}</span>
                                  <span className="hint" style={{ marginLeft: 4 }}>（{v.n} 单）</span>
                                </> : <span className="hint">—</span>}
                              </td>
                            )
                          })}
                          <td className="mono" style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>{money(mo.total.usd)} USD<span className="hint" style={{ marginLeft: 4 }}>（{mo.total.n} 单）</span></td>
                        </tr>
                      )
                    })}
                    <tr style={{ borderTop: '2px solid var(--line)' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 700 }}>合计</td>
                      {MO.activeTeams.map((t) => {
                        const usd = MO.monthTeams.reduce((a, mo) => a + (mo.teams.get(t)?.usd ?? 0), 0)
                        const n = MO.monthTeams.reduce((a, mo) => a + (mo.teams.get(t)?.n ?? 0), 0)
                        return <td key={t} style={{ padding: '6px 8px', whiteSpace: 'nowrap', fontWeight: 700, textAlign: 'right' }}>{money(usd)}<span className="hint" style={{ marginLeft: 4 }}>（{n} 单）</span></td>
                      })}
                      <td className="mono" style={{ padding: '6px 8px', fontWeight: 800, textAlign: 'right' }}>{money(MO.monthTeams.reduce((a, mo) => a + mo.total.usd, 0))} USD<span className="hint" style={{ marginLeft: 4 }}>（{MO.monthTeams.reduce((a, mo) => a + mo.total.n, 0)} 单）</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="hint" style={{ marginTop: 4, fontSize: 11 }}>列＝小组；单元格＝金额（订单数）</div>
            </>
          )}
        </Panel>

        </>)}

        {tab === 'all' && (<>
        {tab === 'all' && <Section title="原因" />}

        <Panel title="成交原因分析" hint={`${winSum?.total ?? 0} 单 · ${money(winSum?.usdTotal ?? 0)} USD`}
          extra={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            {rangeSelect(fReason, setFReason)}
            {winSum && winSum.missing > 0 && <span className="hint" style={{ color: '#a35c00', fontSize: 11 }}>{winSum.missing} 笔未填</span>}
          </span>}>
          <DataTable
            cols={['成交原因', '订单数', '占比', '金额（折USD）', '金额占比', '平均周期']}
            widths={['26%', '13%', '12%', '18%', '13%', '18%']}
            topCol={3} topLabel="最多"
            empty="暂无成交原因（生成/编辑销售订单时填写）"
            rows={(winSum?.items ?? []).map((x) => [x.reason, `${x.count} 单`, `${x.share}%`, money(x.usd), `${x.usdShare}%`, x.avgCycle == null ? '—' : `${x.avgCycle} 天`])}
          />
        </Panel>

        <Panel title="丢单原因分析" hint={`${lostSum?.total ?? 0} 单 · ${money(lostSum?.usdTotal ?? 0)} USD`}
          extra={rangeSelect(fReason, setFReason)}>
          <DataTable
            cols={['丢单原因', '丢单数', '占比', '丢单金额（折USD）', '金额占比', '丢单周期']}
            widths={['26%', '13%', '12%', '18%', '13%', '18%']}
            topCol={3} topLabel="最多"
            empty="暂无丢单记录（在询报价管理里标记未成单）"
            rows={(lostSum?.items ?? []).map((x) => [x.reason, `${x.count} 单`, `${x.share}%`, money(x.usd), `${x.usdShare}%`, x.avgCycle == null ? '—' : `${x.avgCycle} 天`])}
          />
        </Panel>

        </>)}

        {tab === 'all' && <Section title="客户" />}

        {tab === 'all' && (
        <Panel title="客户 Top10" hint={`合计 ${money(CU.sumUsd)} USD`} style={{ gridColumn: '1 / -1' }} extra={rangeSelect(fCustomer, setFCustomer)}>
          <DataTable
            cols={['排名', '客户', '金额（折USD）', '订单数', '金额占比']}
            widths={['7%', '41%', '22%', '14%', '16%']}
            topCol={2} topLabel="第一"
            rows={CU.topCustomers.map((c, i) => [`${i + 1}`, c.name, money(c.usd), `${c.n} 单`, `${CU.sumUsd ? Math.round((c.usd / CU.sumUsd) * 100) : 0}%`])}
          />
        </Panel>
        )}
      </div>
    </div>
  )
}
