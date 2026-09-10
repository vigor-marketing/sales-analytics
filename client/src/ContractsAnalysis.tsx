import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get } from './api'

interface Item { product_name: string; amount: number; currency: string; qty: number | null }
interface OrderRow {
  order_id: string; order_no: string; won_date: string; order_amount: number | null; order_currency: string
  inquiry_no: string; date: string; sales: string; customer_name: string; country?: string | null
  usdApprox: number; totals: { currency: string; total: number }[]; items: Item[]; cycleDays: number | null; productNames: string
}
interface Stats { contractCount: number; cycleCount: number; avgCycle: number | null; medianCycle: number | null; minCycle: number | null; maxCycle: number | null; usdTotal: number; byProduct: { name: string; count: number; avgCycle: number }[]; bySales: { name: string; count: number; avgCycle: number }[] }
interface MetaLite { sales: { name: string; team: string }[] }

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
/** 坐标轴刻度取整：把最大值向上取到 1/2/5×10^n，让刻度好看 */
const niceMax = (v: number) => {
  if (v <= 0) return 1
  const exp = Math.floor(Math.log10(v))
  const base = Math.pow(10, exp)
  const f = v / base
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nice * base
}
const compact = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))

/** 金额趋势看板：曲线 + 数据点 + 刻度网格 + 悬浮提示（替代大色块柱子） */
function TrendChart({ data, unitLabel }: { data: { key: string; label: string; usd: number; n: number }[]; unitLabel: string }) {
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
  const maxRaw = Math.max(...data.map((d) => d.usd), 0)
  const top = niceMax(maxRaw)
  const step = data.length > 1 ? innerW / (data.length - 1) : 0
  const px = (i: number) => padL + (data.length > 1 ? i * step : innerW / 2)
  const py = (v: number) => padT + innerH - (v / top) * innerH
  const pts = data.map((d, i) => [px(i), py(d.usd)] as const)
  const line = pts.map((pt, i) => (i === 0 ? `M${pt[0]},${pt[1]}` : `L${pt[0]},${pt[1]}`)).join(' ')
  const smooth = pts.reduce((acc, pt, i) => {
    if (i === 0) return `M${pt[0].toFixed(1)},${pt[1].toFixed(1)}`
    const prev = pts[i - 1]
    const cx = (prev[0] + pt[0]) / 2
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
      <svg width={w} height={H} style={{ display: 'block' }} role="img" aria-label={`订单金额趋势（${unitLabel}）`}>
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
              fill={data[i].usd > 0 ? '#fff' : '#f2f4f8'}
              stroke={i === peak && data[i].usd > 0 ? '#ef4f0b' : '#0052d9'} strokeWidth={hover === i ? 3 : 2.2} />
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
          {hv.usd > 0 && <div className="hint">{hv.label === data[peak].label ? '本期最高' : ''}</div>}
        </div>
      )}
      <div className="hint" style={{ marginTop: 2 }}>柱线含义：每个点为一期金额，橙色圈为最高期；鼠标移到点上可看金额与单数</div>
    </div>
  )
}
const cycleTone = (d: number | null) => (d == null ? 'var(--sub)' : d <= 30 ? '#059669' : d <= 90 ? '#a35c00' : 'var(--danger)')

export default function ContractsAnalysis({ meta }: { meta: MetaLite }) {
  const [sales, setSales] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [product, setProduct] = useState('')
  // 看板口径：默认「年度」；切到「月度」时可再按年份看 12 个月的走势
  const [trendMode, setTrendMode] = useState<'year' | 'month'>('year')
  const [year, setYear] = useState('')
  const [rows, setRows] = useState<OrderRow[]>([]); const [stats, setStats] = useState<Stats | null>(null); const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      if (sales) p.set('sales', sales); if (from) p.set('from', from); if (to) p.set('to', to); if (product) p.set('product', product)
      const d = await get<{ rows: OrderRow[]; stats: Stats }>(`/orders?${p.toString()}`)
      setRows(d.rows); setStats(d.stats)
    } catch (e) { setMsg((e as Error).message) }
  }, [sales, from, to, product])
  useEffect(() => { void load() }, [load])

  // 有数据的年份（降序），用于「月度」口径选年
  const years = useMemo(() => {
    const s2 = new Set<string>()
    rows.forEach((r) => { const y = String(r.won_date).slice(0, 4); if (/^\d{4}$/.test(y)) s2.add(y) })
    return Array.from(s2).sort((a, b) => b.localeCompare(a))
  }, [rows])
  const curYear = String(new Date().getFullYear())
  const activeYear = year || (years.includes(curYear) ? curYear : (years[0] ?? curYear))

  // 金额趋势：年度看板（每年一根）或月度看板（选定年份的 1–12 月），均跟随上方筛选
  const trend = useMemo(() => {
    if (trendMode === 'year') {
      const m = new Map<string, { usd: number; n: number }>()
      rows.forEach((r) => {
        const k = String(r.won_date).slice(0, 4)
        if (!/^\d{4}$/.test(k)) return
        const a = m.get(k) ?? { usd: 0, n: 0 }
        a.usd += r.usdApprox || 0; a.n += 1
        m.set(k, a)
      })
      return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([key, v]) => ({ key, label: `${key}年`, ...v }))
    }
    const arr = Array.from({ length: 12 }, (_, i) => ({ key: `${activeYear}-${String(i + 1).padStart(2, '0')}`, label: `${i + 1}月`, usd: 0, n: 0 }))
    rows.forEach((r) => {
      const d = String(r.won_date)
      if (!d.startsWith(activeYear + '-')) return
      const i = Number(d.slice(5, 7)) - 1
      if (i < 0 || i > 11) return
      arr[i].usd += r.usdApprox || 0; arr[i].n += 1
    })
    return arr
  }, [rows, trendMode, activeYear])
  const trendSum = trend.reduce((a, b) => a + b.usd, 0)
  const trendN = trend.reduce((a, b) => a + b.n, 0)
  // 客户 Top10
  const topCustomers = useMemo(() => {
    const m = new Map<string, { usd: number; n: number }>()
    rows.forEach((r) => { const a = m.get(r.customer_name) ?? { usd: 0, n: 0 }; a.usd += r.usdApprox || 0; a.n += 1; m.set(r.customer_name, a) })
    return Array.from(m.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.usd - a.usd).slice(0, 10)
  }, [rows])
  const maxCust = Math.max(1, ...topCustomers.map((c) => c.usd))
  const card: React.CSSProperties = { flex: '1 1 170px', minWidth: 170, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>销售订单分析</h3>
        <span className="hint">基于已成交销售订单：金额、转化周期、产品/销售/客户维度</span>
        <span style={{ flex: 1 }} />
        <select className="sa" value={sales} onChange={(e) => setSales(e.target.value)}><option value="">全部销售</option>{meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
        <input className="sa" style={{ width: 150 }} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="产品名称" />
        <input className="sa" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="成单日期起" />
        <input className="sa" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="成单日期止" />
        <button className="btn" onClick={() => void load()}>查询</button>
        <button className="btn" onClick={() => { setSales(''); setFrom(''); setTo(''); setProduct('') }}>重置</button>
      </div>
      {msg && <div className="msg err">{msg}</div>}

      {stats && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '10px 0' }}>
          <div style={card}><div className="hint">销售订单数</div><div style={{ fontSize: 22, fontWeight: 800 }}>{stats.contractCount}</div></div>
          <div style={card}><div className="hint">订单金额（折USD）</div><div style={{ fontSize: 22, fontWeight: 800, color: 'var(--brand)' }}>{money(stats.usdTotal)}</div></div>
          <div style={card}><div className="hint">平均转化周期</div><div style={{ fontSize: 22, fontWeight: 800, color: cycleTone(stats.avgCycle) }}>{stats.avgCycle == null ? '—' : stats.avgCycle + ' 天'}</div></div>
          <div style={card}><div className="hint">中位转化周期</div><div style={{ fontSize: 22, fontWeight: 800 }}>{stats.medianCycle == null ? '—' : stats.medianCycle + ' 天'}</div></div>
          <div style={card}><div className="hint">最短 ~ 最长</div><div style={{ fontSize: 22, fontWeight: 800 }}>{stats.minCycle == null ? '—' : `${stats.minCycle} ~ ${stats.maxCycle} 天`}</div></div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '12px 0 6px' }}>
        <h4 style={{ margin: 0 }}>订单金额趋势（折USD）</h4>
        <span className="seg">
          <button className={trendMode === 'year' ? 'on' : ''} onClick={() => setTrendMode('year')}>年度看板</button>
          <button className={trendMode === 'month' ? 'on' : ''} onClick={() => setTrendMode('month')}>月度看板</button>
        </span>
        {trendMode === 'month' && (
          <select className="sa" style={{ width: 120 }} value={activeYear} onChange={(e) => setYear(e.target.value)}>
            {(years.length ? years : [curYear]).map((y) => <option key={y} value={y}>{y} 年</option>)}
          </select>
        )}
        <span className="hint">
          {trendMode === 'year'
            ? `按年汇总（跟随上方筛选）：合计 ≈USD ${money(trendSum)} · ${trendN} 单`
            : `${activeYear} 年各月（跟随上方筛选）：合计 ≈USD ${money(trendSum)} · ${trendN} 单`}
        </span>
      </div>
      {trend.length && trendN > 0
        ? <TrendChart data={trend} unitLabel={trendMode === 'year' ? '按年' : `${activeYear} 年按月`} />
        : <div className="hint">暂无数据</div>}

      {stats && (
        <div className="dash-cols2" style={{ marginTop: 14 }}>
          <div>
            <h4 style={{ margin: '0 0 6px' }}>按产品：成单次数与转化周期</h4>
            <div className="tablewrap" style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr>{['产品', '成单次数', '平均周期'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: 6, textAlign: 'left', borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {stats.byProduct.map((p) => <tr key={p.name} style={{ borderBottom: '1px solid var(--line2)' }}><td style={{ padding: 6 }}>{p.name}</td><td style={{ padding: 6 }}>{p.count}</td><td style={{ padding: 6, color: cycleTone(p.avgCycle), fontWeight: 700 }}>{p.avgCycle} 天</td></tr>)}
                  {stats.byProduct.length === 0 && <tr><td colSpan={3} className="hint" style={{ padding: 12, textAlign: 'center' }}>暂无数据</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4 style={{ margin: '0 0 6px' }}>按销售：成单次数与转化周期</h4>
            <div className="tablewrap" style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr>{['销售', '成单次数', '平均周期'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: 6, textAlign: 'left', borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {stats.bySales.map((p) => <tr key={p.name} style={{ borderBottom: '1px solid var(--line2)' }}><td style={{ padding: 6 }}>{p.name || '—'}</td><td style={{ padding: 6 }}>{p.count}</td><td style={{ padding: 6, color: cycleTone(p.avgCycle), fontWeight: 700 }}>{p.avgCycle} 天</td></tr>)}
                  {stats.bySales.length === 0 && <tr><td colSpan={3} className="hint" style={{ padding: 12, textAlign: 'center' }}>暂无数据</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <h4 style={{ margin: '14px 0 6px' }}>客户 Top10（按订单金额折USD）</h4>
      <div style={{ maxWidth: 860 }}>
        {topCustomers.map((c, i) => (
          <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
            <span className="mini" style={{ width: 20, textAlign: 'right' }}>{i + 1}</span>
            <span style={{ width: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.name}>{c.name}</span>
            <div style={{ flex: 1, background: '#eef1f6', borderRadius: 4, height: 12, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round((c.usd / maxCust) * 100)}%`, height: '100%', background: 'linear-gradient(90deg,#0052d9,#5b92f5)' }} />
            </div>
            <span className="mono" style={{ width: 110, textAlign: 'right' }}>{money(c.usd)} USD</span>
            <span className="hint" style={{ width: 60 }}>{c.n} 单</span>
          </div>
        ))}
        {topCustomers.length === 0 && <div className="hint">暂无数据</div>}
      </div>
    </div>
  )
}
