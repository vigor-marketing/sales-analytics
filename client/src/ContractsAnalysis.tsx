import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get } from './api'
import { RANGE_LABEL, rangeDates, type RangeKey } from './dateRange'

interface Item { product_name: string; amount: number; currency: string; qty: number | null }
interface OrderRow {
  order_id: string; order_no: string; won_date: string; order_amount: number | null; order_currency: string
  inquiry_no: string; date: string; sales: string; customer_name: string; country?: string | null
  usdApprox: number; totals: { currency: string; total: number }[]; items: Item[]; cycleDays: number | null; productNames: string
}
interface Stats { contractCount: number; cycleCount: number; avgCycle: number | null; medianCycle: number | null; minCycle: number | null; maxCycle: number | null; usdTotal: number; byProduct: { name: string; count: number; avgCycle: number }[]; bySales: { name: string; count: number; avgCycle: number }[] }
interface MetaLite { sales: { name: string; team: string }[]; winReasons?: string[]; lostReasons?: string[]; fx?: Record<string, number> }
interface ReasonItem { reason: string; count: number; usd: number; share: number; usdShare: number; avgCycle: number | null }
interface ReasonStat { total: number; usdTotal: number; items: ReasonItem[]; missing: number }
interface ReasonData { win: ReasonStat; lost: ReasonStat; reasons: { win: string[]; lost: string[] } }

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
const cycleTone = (d: number | null) => (d == null ? 'var(--sub)' : d <= 30 ? '#059669' : d <= 90 ? '#a35c00' : 'var(--danger)')
const niceMax = (v: number) => {
  if (v <= 0) return 1
  const exp = Math.floor(Math.log10(v)); const base = Math.pow(10, exp); const f = v / base
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * base
}
const compact = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))

/** 每个分析板块统一外壳：标题 + 说明 + 图示 + 明细 */
function Panel({ title, hint, children, extra, style }: { title: string; hint?: string; children: React.ReactNode; extra?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section className="card panel-tight" style={style}>
      <div className="panel-head">
        <h4 className="panel-title">{title}</h4>
        {hint && <span className="hint panel-hint">{hint}</span>}
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
    <div className="tablewrap h240">
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
  const [sales, setSales] = useState(''); const [range, setRange] = useState<RangeKey>(''); const [product, setProduct] = useState('')
  const [rows, setRows] = useState<OrderRow[]>([]); const [stats, setStats] = useState<Stats | null>(null); const [msg, setMsg] = useState('')
  const [reasons, setReasons] = useState<ReasonData | null>(null)
  // 按产品分析：产品下拉（取自产品档案）
  const [products, setProducts] = useState<{ id: string; name: string; use_count: number }[]>([])
  useEffect(() => { get<{ id: string; name: string; use_count: number }[]>('/products').then((l) => setProducts(Array.isArray(l) ? l : [])).catch(() => { /* */ }) }, [])
  const [trendMode, setTrendMode] = useState<'year' | 'month'>('year')
  // 分析子页面：拆分查看，避免一屏堆叠混乱；选择记在本地，刷新后保持
  type TabKey = 'all' | 'team' | 'group'
  const TABS: { key: TabKey; label: string; note: string }[] = [
    { key: 'all', label: '整体数据', note: '关键指标、金额趋势、按产品、小组对比、个人分析、成交与丢单原因、客户排行' },
    { key: 'team', label: '小组', note: '小组汇总与月度小组拆解' },
    { key: 'group', label: '组内', note: '小组内部各成员的成单明细与排名' },
  ]
  const [tab, setTab] = useState<TabKey>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('sa:anaTab') : null
    return (TABS.some((t) => t.key === saved) ? saved : 'all') as TabKey
  })
  useEffect(() => { try { localStorage.setItem('sa:anaTab', tab) } catch { /* */ } }, [tab])
  // 组内子页面：再按小组筛选
  const [teamFilter, setTeamFilter] = useState('')
  const [year, setYear] = useState('')

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      const { from, to } = rangeDates(range)
      if (sales) p.set('sales', sales); if (from) p.set('from', from); if (to) p.set('to', to); if (product) p.set('product', product)
      const d = await get<{ rows: OrderRow[]; stats: Stats }>(`/orders?${p.toString()}`)
      setRows(d.rows); setStats(d.stats)
      try { setReasons(await get<ReasonData>(`/analysis/reasons?${p.toString()}`)) } catch { setReasons(null) }
    } catch (e) { setMsg((e as Error).message) }
  }, [sales, range, product])
  useEffect(() => { void load() }, [load])

  const years = useMemo(() => {
    const s2 = new Set<string>()
    rows.forEach((r) => { const y = String(r.won_date).slice(0, 4); if (/^\d{4}$/.test(y)) s2.add(y) })
    return Array.from(s2).sort((a, b) => b.localeCompare(a))
  }, [rows])
  const curYear = String(new Date().getFullYear())
  const activeYear = year || (years.includes(curYear) ? curYear : (years[0] ?? curYear))

  const trend = useMemo(() => {
    if (trendMode === 'year') {
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
  }, [rows, trendMode, activeYear])
  const trendN = trend.reduce((a, b) => a + b.n, 0)

  // 产品维度（含金额折USD，用于图文结合）
  const fx = meta.fx ?? { USD: 1, CNY: 7.12, EUR: 0.92 }
  const productRows = useMemo(() => {
    const m = new Map<string, { count: number; usd: number; cycles: number[] }>()
    rows.forEach((r) => {
      (r.items || []).forEach((it) => {
        const a = m.get(it.product_name) ?? { count: 0, usd: 0, cycles: [] }
        a.count += 1
        a.usd += (Number(it.amount) || 0) / (fx[it.currency] || 1)
        if (typeof r.cycleDays === 'number' && r.cycleDays >= 0) a.cycles.push(r.cycleDays)
        m.set(it.product_name, a)
      })
    })
    return Array.from(m.entries()).map(([name, v]) => ({
      name, count: v.count, usd: Math.round(v.usd),
      avgCycle: v.cycles.length ? Math.round(v.cycles.reduce((x, y) => x + y, 0) / v.cycles.length) : null,
    })).sort((a, b) => b.count - a.count || b.usd - a.usd)
  }, [rows, fx])

  // 小组（团队）维度：销售 → 组别；未匹配到的归入「未分组」
  const teamOf = useMemo(() => {
    const m = new Map<string, string>()
    meta.sales.forEach((x) => m.set(x.name, x.team || '未分组'))
    return m
  }, [meta.sales])

  /** 月度 × 小组：每月各组的订单数与金额（折USD），以及月度合计 */
  const monthTeams = useMemo(() => {
    const m = new Map<string, { month: string; total: { usd: number; n: number }; teams: Map<string, { usd: number; n: number }> }>()
    rows.forEach((r) => {
      const month = String(r.won_date).slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(month)) return
      const team = teamOf.get(r.sales) ?? '未分组'
      const cell = m.get(month) ?? { month, total: { usd: 0, n: 0 }, teams: new Map() }
      const t = cell.teams.get(team) ?? { usd: 0, n: 0 }
      t.usd += r.usdApprox || 0; t.n += 1
      cell.teams.set(team, t)
      cell.total.usd += r.usdApprox || 0; cell.total.n += 1
      m.set(month, cell)
    })
    return Array.from(m.values()).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12)
  }, [rows, teamOf])
  const activeTeams = useMemo(() => {
    const names = new Set<string>()
    monthTeams.forEach((mo) => mo.teams.forEach((_v, k) => names.add(k)))
    const ordered = meta.sales.map((x) => x.team || '未分组').filter((t, i, a) => a.indexOf(t) === i)
    return ordered.filter((t) => names.has(t)).concat(Array.from(names).filter((n) => !ordered.includes(n)))
  }, [monthTeams, meta.sales])

  const topCustomers = useMemo(() => {
    const m = new Map<string, { usd: number; n: number }>()
    rows.forEach((r) => { const a = m.get(r.customer_name) ?? { usd: 0, n: 0 }; a.usd += r.usdApprox || 0; a.n += 1; m.set(r.customer_name, a) })
    return Array.from(m.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.usd - a.usd).slice(0, 10)
  }, [rows])

  /** 按小组：成单次数、金额折USD、金额占比、平均转化周期、组内人数 */
  const teamRows = useMemo(() => {
    const m = new Map<string, { n: number; usd: number; cycles: number[]; people: Set<string> }>()
    rows.forEach((r) => {
      const team = teamOf.get(r.sales) ?? '未分组'
      const a = m.get(team) ?? { n: 0, usd: 0, cycles: [], people: new Set<string>() }
      a.n += 1; a.usd += r.usdApprox || 0; a.people.add(r.sales || '未指定')
      if (typeof r.cycleDays === 'number' && r.cycleDays >= 0) a.cycles.push(r.cycleDays)
      m.set(team, a)
    })
    const total = Array.from(m.values()).reduce((x, v) => x + v.usd, 0)
    return Array.from(m.entries()).map(([name, v]) => ({
      name, n: v.n, usd: Math.round(v.usd), people: v.people.size,
      share: total ? Math.round((v.usd / total) * 1000) / 10 : 0,
      avgCycle: v.cycles.length ? Math.round(v.cycles.reduce((x, y) => x + y, 0) / v.cycles.length) : null,
    })).sort((a, b) => b.usd - a.usd)
  }, [rows, teamOf])

  /** 小组内成员明细：每个小组下各成员的订单数/金额/组内占比/平均周期（含本期无成单的成员） */
  const teamNames = useMemo(() => {
    const names = Array.from(new Set(meta.sales.map((x) => x.team || '未分组')))
    return names
  }, [meta.sales])

  const teamMembers = useMemo(() => {
    const byMember = new Map<string, { n: number; usd: number; cycles: number[] }>()
    rows.forEach((r) => {
      const k = r.sales || '未指定'
      const a = byMember.get(k) ?? { n: 0, usd: 0, cycles: [] }
      a.n += 1; a.usd += r.usdApprox || 0
      if (typeof r.cycleDays === 'number' && r.cycleDays >= 0) a.cycles.push(r.cycleDays)
      byMember.set(k, a)
    })
    const teamNames = Array.from(new Set(meta.sales.map((x) => x.team || '未分组')))
    rows.forEach((r) => { const t = teamOf.get(r.sales) ?? '未分组'; if (!teamNames.includes(t)) teamNames.push(t) })
    return teamNames.map((team) => {
      const members = Array.from(new Set(meta.sales.filter((x) => (x.team || '未分组') === team).map((x) => x.name)))
      byMember.forEach((_v, k) => { if ((teamOf.get(k) ?? '未分组') === team && !members.includes(k)) members.push(k) })
      const list = members.map((name) => {
        const v = byMember.get(name) ?? { n: 0, usd: 0, cycles: [] }
        return {
          name, n: v.n, usd: Math.round(v.usd),
          avgCycle: v.cycles.length ? Math.round(v.cycles.reduce((x, y) => x + y, 0) / v.cycles.length) : null,
        }
      }).sort((a, b) => b.usd - a.usd)
      const total = list.reduce((x, v) => x + v.usd, 0)
      return {
        team, list, usd: Math.round(total), n: list.reduce((x, v) => x + v.n, 0),
        rows: list.map((m) => ({ ...m, share: total ? Math.round((m.usd / total) * 1000) / 10 : 0 })),
      }
    }).filter((t) => t.list.length > 0).sort((a, b) => b.usd - a.usd)
  }, [rows, teamOf, meta.sales])
  /** 组内子页面当前展示的小组（按小组筛选后） */
  const shownTeams = useMemo(() => (teamFilter ? teamMembers.filter((t) => t.team === teamFilter) : teamMembers), [teamMembers, teamFilter])

  /** 按销售：成单次数、金额折USD、平均转化周期 */
  /** 个人分析：该销售名下所有客户的订单、客户数、客单价（金额÷客户数）、单均价（金额÷订单数） */
  const salesRows = useMemo(() => {
    const m = new Map<string, { n: number; usd: number; cycles: number[]; customers: Map<string, { usd: number; n: number }> }>()
    rows.forEach((r) => {
      const k = r.sales || '未指定'
      const a = m.get(k) ?? { n: 0, usd: 0, cycles: [] as number[], customers: new Map<string, { usd: number; n: number }>() }
      a.n += 1; a.usd += r.usdApprox || 0
      if (typeof r.cycleDays === 'number' && r.cycleDays >= 0) a.cycles.push(r.cycleDays)
      const cust = r.customer_name || '未知客户'
      const c = a.customers.get(cust) ?? { usd: 0, n: 0 }
      c.usd += r.usdApprox || 0; c.n += 1
      a.customers.set(cust, c)
      m.set(k, a)
    })
    // 本期没有成单的销售也列出来（便于对比），归到其所属小组
    meta.sales.forEach((x) => { if (!m.has(x.name)) m.set(x.name, { n: 0, usd: 0, cycles: [], customers: new Map() }) })
    const all = Array.from(m.entries()).map(([name, v]) => {
      const customers = Array.from(v.customers.entries())
        .map(([cname, cv]) => ({ name: cname, usd: Math.round(cv.usd), n: cv.n }))
        .sort((a, b) => b.usd - a.usd)
      return {
        name, n: v.n, usd: Math.round(v.usd), team: teamOf.get(name) ?? '未分组',
        customerCount: customers.length, customers,
        perCustomer: customers.length ? Math.round(v.usd / customers.length) : null,
        perOrder: v.n ? Math.round(v.usd / v.n) : null,
        avgCycle: v.cycles.length ? Math.round(v.cycles.reduce((x, y) => x + y, 0) / v.cycles.length) : null,
      }
    })
    return all.sort((a, b) => b.usd - a.usd)
  }, [rows, meta.sales, teamOf])

  const sumUsd = rows.reduce((s, r) => s + (r.usdApprox || 0), 0)
  const winSum = reasons?.win
  const lostSum = reasons?.lost

  return (
    <div className="page-fit scroll">
      {/* 筛选条 */}
      <section className="card panel-tight auto">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>销售订单分析</h3>
          <span className="hint" style={{ flex: 1, minWidth: 180 }}>{RANGE_LABEL[range]} · 成交金额、转化周期、小组/产品/销售/客户与成交·丢单原因（全部跟随筛选）</span>
          <select className="sa" value={sales} onChange={(e) => setSales(e.target.value)}><option value="">全部销售</option>{meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
          <select className="sa" style={{ maxWidth: 220 }} value={product} onChange={(e) => setProduct(e.target.value)} title="按产品筛选（下拉可选）">
            <option value="">全部产品</option>
            {products.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            {product && !products.some((p) => p.name === product) && <option value={product}>{product}</option>}
          </select>
          <select className="sa" value={range} onChange={(e) => setRange(e.target.value as RangeKey)} title="时间范围（成单日期 / 丢单日期口径）">
            {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => <option key={k} value={k}>{RANGE_LABEL[k]}</option>)}
          </select>
          <button className="btn sm" onClick={() => void load()}>查询</button>
          <button className="btn sm" onClick={() => { setSales(''); setRange(''); setProduct('') }}>重置</button>
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
          <select className="sa" style={{ width: 150, marginLeft: 'auto' }} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} title="按小组筛选组内成员">
            <option value="">全部小组</option>
            {teamNames.map((t) => <option key={t} value={t}>{t}</option>)}
            {teamFilter && !teamNames.includes(teamFilter) && <option value={teamFilter}>{teamFilter}</option>}
          </select>
        )}
      </div>

      {/* 当前子页的关键数字速览 */}
      <div className="ana-sum">
        {tab === 'all' && (<>
          <span className="ana-sum-i"><b>{stats?.contractCount ?? 0}</b> 单</span>
          <span className="ana-sum-i"><b>{money(stats?.usdTotal ?? 0)}</b> USD</span>
          <span className="ana-sum-i">平均周期 <b>{stats?.avgCycle == null ? '—' : `${stats.avgCycle} 天`}</b></span>
          <span className="ana-sum-i">成交 <b>{winSum?.total ?? 0}</b> · 丢单 <b>{lostSum?.total ?? 0}</b></span>
          <span className="ana-sum-i">客户 <b>{topCustomers.length}</b> 家 · 产品 <b>{productRows.length}</b> 个 · 小组 <b>{teamRows.length}</b> 个 · 销售 <b>{salesRows.length}</b> 名</span>
        </>)}
        {tab === 'team' && (<>
          <span className="ana-sum-i">小组 <b>{teamRows.length}</b> 个</span>
          <span className="ana-sum-i">合计 <b>{money(teamRows.reduce((a, b) => a + b.usd, 0))}</b> USD</span>
          <span className="ana-sum-i">最高 <b>{teamRows[0]?.name ?? '—'}</b>{teamRows[0] ? `（${money(teamRows[0].usd)} · ${teamRows[0].share}%）` : ''}</span>
          <span className="ana-sum-i">月份数 <b>{monthTeams.length}</b></span>
        </>)}
        {tab === 'group' && (<>
          <span className="ana-sum-i">成员 <b>{shownTeams.reduce((a, t) => a + t.list.length, 0)}</b> 人</span>
          <span className="ana-sum-i">其中有成单 <b>{shownTeams.reduce((a, t) => a + t.rows.filter((m) => m.n > 0).length, 0)}</b> 人</span>
          <span className="ana-sum-i">合计 <b>{money(shownTeams.reduce((a, t) => a + t.usd, 0))}</b> USD</span>
          <span className="ana-sum-i">最高成员 <b>{(() => { const all = shownTeams.flatMap((t) => t.rows); const top = all.sort((a, b) => b.usd - a.usd)[0]; return top ? `${top.name}（${money(top.usd)}）` : '—' })()}</b></span>
        </>)}
      </div>

      <div className="dash-grid" style={{ marginTop: 10 }}>
        {tab === 'all' && (<>
        <div className="dash-span2 kpi-grid">
          {stats && (<>
            <Kpi label="销售订单数" value={`${stats.contractCount} 单`} note={stats.contractCount ? `平均单值 ${money(stats.usdTotal / stats.contractCount)} USD` : ''} />
            <Kpi label="订单金额（折USD）" value={money(stats.usdTotal)} tone="var(--brand)" note={`成交 ${winSum?.total ?? 0} · 丢单 ${lostSum?.total ?? 0}`} />
            <Kpi label="平均转化周期" value={stats.avgCycle == null ? '—' : `${stats.avgCycle} 天`} tone={cycleTone(stats.avgCycle)} note={stats.minCycle == null ? '' : `${stats.minCycle} ~ ${stats.maxCycle} 天`} />
            <Kpi label="丢单金额（折USD）" value={money(lostSum?.usdTotal ?? 0)} tone="var(--danger)" note={winSum && winSum.usdTotal > 0 && lostSum ? `占成交 ${Math.round((lostSum.usdTotal / winSum.usdTotal) * 100)}%` : ''} />
          </>)}
        </div>

        <Panel
          style={{ gridColumn: '1 / -1' }}
          title="订单金额趋势（折USD）"
          hint={trendMode === 'year' ? `按年 · 合计 ≈USD ${money(trend.reduce((a, b) => a + b.usd, 0))} · ${trendN} 单` : `${activeYear} 年各月 · 合计 ≈USD ${money(trend.reduce((a, b) => a + b.usd, 0))} · ${trendN} 单`}
          extra={(
            <>
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

        {tab === 'all' && (
        <Panel title="按产品" hint={`${product ? `已筛「${product}」· ` : ''}${productRows.length} 个产品 · 合计 ${productRows.reduce((a, b) => a + b.count, 0)} 次 · ${money(sumUsd)} USD`}>
          <DataTable
            cols={['产品', '成单次数', '金额（折USD）', '金额占比', '平均周期']}
            widths={['34%', '15%', '20%', '15%', '16%']}
            topCol={2} topLabel="最高"
            empty="暂无成单产品"
            rows={productRows.slice(0, 15).map((p) => [
              p.name, `${p.count} 次`, money(p.usd), `${sumUsd ? Math.round((p.usd / sumUsd) * 1000) / 10 : 0}%`,
              p.avgCycle == null ? '—' : `${p.avgCycle} 天`,
            ])}
          />
          {productRows.length > 15 && <div className="hint" style={{ fontSize: 11 }}>仅显示前 15 个产品</div>}
        </Panel>
        )}

        {tab === 'team' && (<>
        <Panel title="按小组" hint="小组维度：单数 · 金额 · 占比 · 平均周期 · 组内人数">
          <DataTable
            cols={['小组', '订单数', '金额（折USD）', '金额占比', '平均周期', '组内人数']}
            widths={['26%', '13%', '20%', '13%', '16%', '12%']}
            topCol={2} topLabel="第一"
            empty="暂无成单小组"
            rows={teamRows.map((t) => [t.name, `${t.n} 单`, money(t.usd), `${t.share}%`, t.avgCycle == null ? '—' : `${t.avgCycle} 天`, `${t.people} 人`])}
          />
          {teamRows.length > 0 && (
            <div className="hint" style={{ marginTop: 4, fontSize: 11 }}>
              合计 {money(teamRows.reduce((a, b) => a + b.usd, 0))} USD · {teamRows.reduce((a, b) => a + b.n, 0)} 单（小组归属按「销售人员 → 组别」，未匹配的归入未分组）
            </div>
          )}
        </Panel>

        </>)}

        {tab === 'group' && (<>
        <Panel title="小组内成员分析" hint={`${teamFilter ? `已筛「${teamFilter}」· ` : ''}每个小组下各成员的成单金额与占比（含本期无成单的成员）`} style={{ gridColumn: '1 / -1' }}>
          {shownTeams.length === 0 ? <div className="hint" style={{ fontSize: 12 }}>暂无成单数据</div> : (
            <div className="tablewrap h300">
              <table className="grid data-table fixed-table" style={{ fontSize: 12.5 }}>
                <colgroup><col style={{ width: '28%' }} /><col style={{ width: '14%' }} /><col style={{ width: '18%' }} /><col style={{ width: '13%' }} /><col style={{ width: '16%' }} /><col style={{ width: '11%' }} /></colgroup>
                <thead><tr>{['小组 / 成员', '订单数', '金额（折USD）', '组内占比', '平均转化周期', '组内排名'].map((h, j) => <th key={h} style={{ textAlign: j === 0 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {shownTeams.map((t) => (
                    <Fragment key={t.team}>
                      <tr style={{ background: '#f4f7fc' }}>
                        <td style={{ padding: '6px 8px', fontWeight: 800 }}>{t.team}<span className="hint" style={{ marginLeft: 6, fontWeight: 400 }}>小组合计 {t.list.length} 人</span></td>
                        <td style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>{t.n} 单</td>
                        <td className="mono" style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>{money(t.usd)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>100%</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>—</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>—</td>
                      </tr>
                      {t.rows.map((m, i) => (
                        <tr key={t.team + m.name} className={i === 0 && m.n > 0 && t.rows.length > 1 ? 'row-top' : undefined} style={{ borderBottom: '1px solid var(--line2)' }}>
                          <td className="ellip" style={{ padding: '6px 8px', paddingLeft: 22 }} title={m.name}>
                            {m.name}
                            {i === 0 && m.n > 0 && t.rows.length > 1 && <span className="top-badge">组内第一</span>}
                            {m.n === 0 && <span className="hint" style={{ marginLeft: 6 }}>本期无成单</span>}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{m.n} 单</td>
                          <td className={'mono' + (i === 0 && m.n > 0 && t.rows.length > 1 ? ' cell-top' : '')} style={{ padding: '6px 8px', textAlign: 'right' }}>{money(m.usd)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{m.n === 0 ? '—' : `${m.share}%`}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{m.avgCycle == null ? '—' : `${m.avgCycle} 天`}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{m.n === 0 ? '—' : `第 ${i + 1} 名`}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        </>)}

        {tab === 'all' && (<>
        <Panel title="个人分析"
          hint={`${salesRows.length} 名销售 · 合计 ${money(sumUsd)} USD · 含该销售名下所有客户的订单`}
          style={{ gridColumn: '1 / -1' }}
          extra={<span className="hint" style={{ fontSize: 11 }}>客单价＝金额÷客户数 · 单均价＝金额÷订单数（悬停「客户数」看客户明细）</span>}>
          <DataTable
            cols={['销售', '小组', '客户数', '订单数', '金额（折USD）', '金额占比', '客单价', '单均价', '平均周期']}
            widths={['14%', '10%', '9%', '8%', '14%', '10%', '12%', '12%', '11%']}
            topCol={4} topLabel="第一"
            empty="暂无成单销售（可调整时间范围或筛选）"
            rows={salesRows.map((p) => [
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
          <div className="hint" style={{ marginTop: 4, fontSize: 11 }}>
            口径：只统计「成单日期」落在当前筛选范围内的销售订单（含各客户的多笔订单）；本期无成单的销售也会列出（金额 0），便于横向对比。
          </div>
        </Panel>

        </>)}

        {tab === 'team' && (<>
        {/* 月度小组分析：每月各组订单数与金额（跟随筛选） */}
        <Panel
          title="月度小组分析"
          hint={monthTeams.length ? `近 ${monthTeams.length} 个月 · 每月按小组拆解金额与单数（括号内为订单数）` : '按成单月份 × 销售人员所属小组'}
          style={{ gridColumn: '1 / -1' }}
        >
          {monthTeams.length === 0 ? <div className="hint" style={{ fontSize: 12 }}>暂无成单数据</div> : (
            <>
              <div className="tablewrap h240">
                <table className="grid data-table fixed-table" style={{ fontSize: 12.5 }}>
                  <colgroup><col style={{ width: '14%' }} />{[...activeTeams, '合计'].map((t) => <col key={t} style={{ width: `${Math.round(86 / (activeTeams.length + 1))}%` }} />)}</colgroup>
                  <thead><tr>{['月份', ...activeTeams, '合计'].map((h, j) => <th key={h} style={{ textAlign: j === 0 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {monthTeams.map((mo) => {
                      const best = activeTeams.reduce((bi, t, i) => ((mo.teams.get(t)?.usd ?? 0) > (mo.teams.get(activeTeams[bi])?.usd ?? 0) ? i : bi), 0)
                      return (
                        <tr key={mo.month} style={{ borderBottom: '1px solid var(--line2)' }}>
                          <td className="mono" style={{ padding: '6px 8px', fontWeight: 700 }}>{mo.month}</td>
                          {activeTeams.map((t, i) => {
                            const v = mo.teams.get(t)
                            const isBest = i === best && !!v && activeTeams.filter((x) => mo.teams.has(x)).length > 1
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
                      {activeTeams.map((t) => {
                        const usd = monthTeams.reduce((a, mo) => a + (mo.teams.get(t)?.usd ?? 0), 0)
                        const n = monthTeams.reduce((a, mo) => a + (mo.teams.get(t)?.n ?? 0), 0)
                        return <td key={t} style={{ padding: '6px 8px', whiteSpace: 'nowrap', fontWeight: 700, textAlign: 'right' }}>{money(usd)}<span className="hint" style={{ marginLeft: 4 }}>（{n} 单）</span></td>
                      })}
                      <td className="mono" style={{ padding: '6px 8px', fontWeight: 800, textAlign: 'right' }}>{money(monthTeams.reduce((a, mo) => a + mo.total.usd, 0))} USD<span className="hint" style={{ marginLeft: 4 }}>（{monthTeams.reduce((a, mo) => a + mo.total.n, 0)} 单）</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="hint" style={{ marginTop: 4, fontSize: 11 }}>小组：{activeTeams.join(' · ')}（未匹配到小组的销售归入「未分组」）</div>
            </>
          )}
        </Panel>

        </>)}

        {tab === 'all' && (
        <Panel title="小组对比" hint={`${teamRows.length} 个小组 · 合计 ${money(sumUsd)} USD${teamRows[0] ? ` · 最高 ${teamRows[0].name}` : ''}`}
          style={{ gridColumn: '1 / -1' }}
          extra={teamRows.length > 1 ? <span className="hint" style={{ fontSize: 11 }}>组均 {money(Math.round(sumUsd / teamRows.length))} USD · 最高组占比 {teamRows[0]?.share ?? 0}%</span> : undefined}>
          <DataTable
            cols={['排名', '小组', '订单数', '金额（折USD）', '金额占比', '平均周期', '组内人数', '与最高组差距']}
            widths={['6%', '20%', '10%', '15%', '12%', '12%', '11%', '14%']}
            topCol={3} topLabel="第一"
            empty="本期暂无成单，无法进行小组对比（可调整时间范围或筛选）"
            rows={teamRows.map((t, i) => [
              `${i + 1}`,
              i === 0 && teamRows.length > 1 ? `${t.name}（第一）` : t.name,
              `${t.n} 单`,
              money(t.usd),
              `${t.share}%`,
              t.avgCycle == null ? '—' : `${t.avgCycle} 天`,
              `${t.people} 人`,
              i === 0 ? '—' : (() => {
                const top = teamRows[0]?.usd ?? 0
                const pct = top ? Math.round((t.usd / top) * 100) : 0
                return `${pct}%（少 ${money(Math.max(0, top - t.usd))}）`
              })(),
            ])}
          />
          <div className="hint" style={{ marginTop: 4, fontSize: 11 }}>
            小组归属按「销售人员 → 组别」，未匹配到组别的销售归入「未分组」；金额为该组成单金额折算 USD，随上方筛选（时间/客户/产品等）联动。
            更细的「月度 × 小组拆解」与「组内成员排名」见「小组」「组内」两个板块。
          </div>
        </Panel>
        )}

        {tab === 'all' && (<>
        <Panel title="成交原因分析" hint={`${winSum?.total ?? 0} 单 · ${money(winSum?.usdTotal ?? 0)} USD`}
          extra={winSum && winSum.missing > 0 ? <span className="hint" style={{ color: '#a35c00', fontSize: 11 }}>{winSum.missing} 笔未填</span> : undefined}>
          <DataTable
            cols={['成交原因', '订单数', '占比', '金额（折USD）', '金额占比', '平均周期']}
            widths={['26%', '13%', '12%', '18%', '13%', '18%']}
            topCol={3} topLabel="最多"
            empty="暂无成交原因（生成/编辑销售订单时填写）"
            rows={(winSum?.items ?? []).map((x) => [x.reason, `${x.count} 单`, `${x.share}%`, money(x.usd), `${x.usdShare}%`, x.avgCycle == null ? '—' : `${x.avgCycle} 天`])}
          />
        </Panel>

        <Panel title="丢单原因分析" hint={`${lostSum?.total ?? 0} 单 · ${money(lostSum?.usdTotal ?? 0)} USD`}>
          <DataTable
            cols={['丢单原因', '丢单数', '占比', '丢单金额（折USD）', '金额占比', '丢单周期']}
            widths={['26%', '13%', '12%', '18%', '13%', '18%']}
            topCol={3} topLabel="最多"
            empty="暂无丢单记录（在询报价管理里标记未成单）"
            rows={(lostSum?.items ?? []).map((x) => [x.reason, `${x.count} 单`, `${x.share}%`, money(x.usd), `${x.usdShare}%`, x.avgCycle == null ? '—' : `${x.avgCycle} 天`])}
          />
        </Panel>

        </>)}

        {tab === 'all' && (
        <Panel title="客户 Top10" hint={`合计 ${money(sumUsd)} USD`} style={{ gridColumn: '1 / -1' }}>
          <DataTable
            cols={['排名', '客户', '金额（折USD）', '订单数', '金额占比']}
            widths={['7%', '41%', '22%', '14%', '16%']}
            topCol={2} topLabel="第一"
            rows={topCustomers.map((c, i) => [`${i + 1}`, c.name, money(c.usd), `${c.n} 单`, `${sumUsd ? Math.round((c.usd / sumUsd) * 100) : 0}%`])}
          />
        </Panel>
        )}
      </div>
    </div>
  )
}
