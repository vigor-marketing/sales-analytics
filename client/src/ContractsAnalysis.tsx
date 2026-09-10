import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get } from './api'

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
function Panel({ title, hint, children, extra }: { title: string; hint?: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0 }}>{title}</h4>
        {hint && <span className="hint">{hint}</span>}
        <span style={{ flex: 1 }} />
        {extra}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </section>
  )
}

/** 图文结合：左边名称、中间条形、右边数值与备注 */
function BarList({
  items, tone = 'blue', empty = '暂无数据',
}: {
  items: { key: string; label: string; value: number; text: string; note?: string; tone?: 'blue' | 'green' | 'red' }[]
  tone?: 'blue' | 'green' | 'red'
  empty?: string
}) {
  const max = Math.max(1, ...items.map((x) => x.value))
  const color = (t: string) => (t === 'green' ? 'linear-gradient(90deg,#059669,#34d399)' : t === 'red' ? 'linear-gradient(90deg,#dc2626,#f87171)' : 'linear-gradient(90deg,#0052d9,#5b92f5)')
  if (!items.length) return <div className="hint">{empty}</div>
  return (
    <div>
      {items.map((x) => (
        <div key={x.key} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
          <span style={{ width: 190, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }} title={x.label}>{x.label}</span>
          <div style={{ flex: 1, background: '#eef1f6', borderRadius: 5, height: 14, overflow: 'hidden', minWidth: 80 }}>
            <div style={{ width: `${Math.max(2, Math.round((x.value / max) * 100))}%`, height: '100%', background: color(x.tone ?? tone), borderRadius: 5 }} />
          </div>
          <span className="mono" style={{ width: 120, textAlign: 'right', fontWeight: 700 }}>{x.text}</span>
          <span className="hint" style={{ width: 150 }}>{x.note ?? ''}</span>
        </div>
      ))}
    </div>
  )
}

function Kpi({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div style={{ flex: '1 1 170px', minWidth: 170, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}>
      <div className="hint">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: tone ?? 'var(--text)' }}>{value}</div>
      {note && <div className="hint">{note}</div>}
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
  const H = 230, padL = 58, padR = 18, padT = 26, padB = 36
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
            {showValue && data[i].usd > 0 && (
              <text x={pt[0]} y={pt[1] - 11} textAnchor="middle" fontSize="11" fontWeight={700} fill={i === peak ? '#ef4f0b' : '#33405a'}>{compact(data[i].usd)}</text>
            )}
            <text x={px(i)} y={H - 14} textAnchor="middle" fontSize="11.5" fill={hover === i ? '#0052d9' : '#6b7488'} fontWeight={hover === i ? 700 : 400}>{data[i].label}</text>
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
  const [sales, setSales] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [product, setProduct] = useState('')
  const [rows, setRows] = useState<OrderRow[]>([]); const [stats, setStats] = useState<Stats | null>(null); const [msg, setMsg] = useState('')
  const [reasons, setReasons] = useState<ReasonData | null>(null)
  const [trendMode, setTrendMode] = useState<'year' | 'month'>('year')
  const [year, setYear] = useState('')

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      if (sales) p.set('sales', sales); if (from) p.set('from', from); if (to) p.set('to', to); if (product) p.set('product', product)
      const d = await get<{ rows: OrderRow[]; stats: Stats }>(`/orders?${p.toString()}`)
      setRows(d.rows); setStats(d.stats)
      try { setReasons(await get<ReasonData>(`/analysis/reasons?${p.toString()}`)) } catch { setReasons(null) }
    } catch (e) { setMsg((e as Error).message) }
  }, [sales, from, to, product])
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

  const topCustomers = useMemo(() => {
    const m = new Map<string, { usd: number; n: number }>()
    rows.forEach((r) => { const a = m.get(r.customer_name) ?? { usd: 0, n: 0 }; a.usd += r.usdApprox || 0; a.n += 1; m.set(r.customer_name, a) })
    return Array.from(m.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.usd - a.usd).slice(0, 10)
  }, [rows])

  const sumUsd = rows.reduce((s, r) => s + (r.usdApprox || 0), 0)
  const winSum = reasons?.win
  const lostSum = reasons?.lost

  return (
    <>
      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>销售订单分析</h3>
          <span className="hint">基于已成交销售订单：金额、转化周期、产品/销售/客户与成交·丢单原因</span>
          <span style={{ flex: 1 }} />
          <select className="sa" value={sales} onChange={(e) => setSales(e.target.value)}><option value="">全部销售</option>{meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
          <input className="sa" style={{ width: 150 }} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="产品名称" />
          <input className="sa" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="成单/丢单日期起" />
          <input className="sa" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="成单/丢单日期止" />
          <button className="btn" onClick={() => void load()}>查询</button>
          <button className="btn" onClick={() => { setSales(''); setFrom(''); setTo(''); setProduct('') }}>重置</button>
        </div>
        {msg && <div className="msg err">{msg}</div>}
      </section>

      {/* 板块 1：总体概览 */}
      {stats && (
        <Panel title="总体概览" hint="当前筛选范围内的成交情况">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Kpi label="销售订单数" value={`${stats.contractCount} 单`} />
            <Kpi label="订单金额（折USD）" value={money(stats.usdTotal)} tone="var(--brand)" note={`平均单值 ${stats.contractCount ? money(stats.usdTotal / stats.contractCount) : '—'} USD`} />
            <Kpi label="平均转化周期" value={stats.avgCycle == null ? '—' : `${stats.avgCycle} 天`} tone={cycleTone(stats.avgCycle)} note="询价日期 → 成单日期" />
            <Kpi label="中位转化周期" value={stats.medianCycle == null ? '—' : `${stats.medianCycle} 天`} note={stats.minCycle == null ? '' : `最短 ${stats.minCycle} 天 / 最长 ${stats.maxCycle} 天`} />
            <Kpi label="成交原因已填" value={winSum ? `${winSum.total - winSum.missing} / ${winSum.total}` : '—'} tone={winSum && winSum.missing > 0 ? '#a35c00' : '#059669'} note="用于成交原因分析" />
          </div>
        </Panel>
      )}

      {/* 板块 2：金额趋势 */}
      <Panel
        title="订单金额趋势（折USD）"
        hint={trendMode === 'year' ? `按年汇总：合计 ≈USD ${money(trend.reduce((a, b) => a + b.usd, 0))} · ${trendN} 单` : `${activeYear} 年各月：合计 ≈USD ${money(trend.reduce((a, b) => a + b.usd, 0))} · ${trendN} 单`}
        extra={(
          <>
            <span className="seg">
              <button className={trendMode === 'year' ? 'on' : ''} onClick={() => setTrendMode('year')}>年度看板</button>
              <button className={trendMode === 'month' ? 'on' : ''} onClick={() => setTrendMode('month')}>月度看板</button>
            </span>
            {trendMode === 'month' && (
              <select className="sa" style={{ width: 110 }} value={activeYear} onChange={(e) => setYear(e.target.value)}>
                {(years.length ? years : [curYear]).map((y) => <option key={y} value={y}>{y} 年</option>)}
              </select>
            )}
          </>
        )}
      >
        {trend.length && trendN > 0 ? <TrendChart data={trend} /> : <div className="hint">暂无数据</div>}
      </Panel>

      {/* 板块 3：按产品 */}
      <Panel title="按产品" hint={`共 ${productRows.length} 个产品 · 合计成单 ${productRows.reduce((a, b) => a + b.count, 0)} 次`}>
        <BarList
          items={productRows.slice(0, 12).map((p) => ({
            key: p.name, label: p.name, value: p.count, text: `${p.count} 次`, note: `${money(p.usd)} USD · 平均 ${p.avgCycle == null ? '—' : `${p.avgCycle} 天`}`,
          }))}
          tone="blue"
          empty="暂无成单产品"
        />
        {productRows.length > 12 && <div className="hint" style={{ marginTop: 4 }}>仅显示前 12 个产品</div>}
      </Panel>

      {/* 板块 4：按销售 */}
      <Panel title="按销售" hint="成单次数与平均转化周期">
        <BarList
          items={(stats?.bySales ?? []).map((p) => ({
            key: p.name || '—', label: p.name || '未指定', value: p.count, text: `${p.count} 单`, note: `平均 ${p.avgCycle} 天`,
          }))}
          tone="blue"
          empty="暂无成单销售"
        />
      </Panel>

      {/* 板块 5：成交原因分析 */}
      <Panel
        title="成交原因分析"
        hint="来源：销售订单里填写的「成交原因」（按成单日期，跟随上方筛选）"
        extra={winSum && winSum.missing > 0 ? <span className="hint" style={{ color: '#a35c00' }}>有 {winSum.missing} 笔订单未填写成交原因</span> : undefined}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <Kpi label="成交单数" value={`${winSum?.total ?? 0} 单`} tone="#059669" />
          <Kpi label="成交金额（折USD）" value={money(winSum?.usdTotal ?? 0)} tone="#059669" />
          <Kpi label="原因种类" value={`${winSum?.items.filter((x) => x.reason !== '未填写').length ?? 0} 类`} />
        </div>
        <BarList
          items={(winSum?.items ?? []).map((x) => ({
            key: x.reason, label: x.reason, value: x.count, tone: x.reason === '未填写' ? 'blue' : 'green',
            text: `${x.count} 单 · ${x.share}%`, note: `${money(x.usd)} USD（${x.usdShare}%）· 平均 ${x.avgCycle == null ? '—' : `${x.avgCycle} 天`}`,
          }))}
          empty="暂无成交原因数据（生成或编辑销售订单时填写成交原因即可）"
        />
      </Panel>

      {/* 板块 6：丢单原因分析 */}
      <Panel title="丢单原因分析" hint="来源：标记「未成单」时填写的丢单原因（按丢单日期，跟随上方筛选）">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <Kpi label="丢单单数" value={`${lostSum?.total ?? 0} 单`} tone="var(--danger)" />
          <Kpi label="丢单金额（折USD）" value={money(lostSum?.usdTotal ?? 0)} tone="var(--danger)" note="按询价报价合计折算" />
          <Kpi label="原因种类" value={`${lostSum?.items.filter((x) => x.reason !== '未填写').length ?? 0} 类`} />
          <Kpi label="丢单 / 成交 金额比" value={winSum && winSum.usdTotal > 0 && lostSum ? `${Math.round((lostSum.usdTotal / winSum.usdTotal) * 100)}%` : '—'} note="丢单金额 ÷ 成交金额" />
        </div>
        <BarList
          items={(lostSum?.items ?? []).map((x) => ({
            key: x.reason, label: x.reason, value: x.count, tone: 'red',
            text: `${x.count} 单 · ${x.share}%`, note: `${money(x.usd)} USD（${x.usdShare}%）· 平均 ${x.avgCycle == null ? '—' : `${x.avgCycle} 天`}`,
          }))}
          empty="暂无丢单记录（在「询报价管理 → 编辑」里勾选「标记为未成单（丢单）」并选择原因）"
        />
      </Panel>

      {/* 板块 7：客户 Top10 */}
      <Panel title="客户 Top10" hint={`按订单金额折USD排序 · 合计 ${money(sumUsd)} USD`}>
        <BarList
          items={topCustomers.map((c) => ({ key: c.name, label: c.name, value: c.usd, text: `${money(c.usd)} USD`, note: `${c.n} 单 · 占 ${sumUsd ? Math.round((c.usd / sumUsd) * 100) : 0}%` }))}
          tone="blue"
          empty="暂无数据"
        />
      </Panel>
    </>
  )
}
