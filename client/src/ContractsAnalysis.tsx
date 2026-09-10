import { useCallback, useEffect, useMemo, useState } from 'react'
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
const cycleTone = (d: number | null) => (d == null ? 'var(--sub)' : d <= 30 ? '#059669' : d <= 90 ? '#a35c00' : 'var(--danger)')

export default function ContractsAnalysis({ meta }: { meta: MetaLite }) {
  const [sales, setSales] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [product, setProduct] = useState('')
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

  // 月度订单金额趋势
  const trend = useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach((r) => { const k = String(r.won_date).slice(0, 7); if (k) m.set(k, (m.get(k) ?? 0) + (r.usdApprox || 0)) })
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([month, usd]) => ({ month, usd }))
  }, [rows])
  const maxTrend = Math.max(1, ...trend.map((t) => t.usd))
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

      <h4 style={{ margin: '12px 0 6px' }}>月度订单金额趋势（折USD）</h4>
      {trend.length ? (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 170, padding: '0 2px' }}>
          {trend.map((t) => (
            <div key={t.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }} title={`${t.month}：${money(t.usd)} USD`}>
              <div style={{ height: `${Math.round((t.usd / maxTrend) * 100)}%`, minHeight: 3, background: 'linear-gradient(180deg,#4f8cff,#1d4ed8)', borderRadius: '4px 4px 0 0' }} />
              <div className="hint" style={{ textAlign: 'center', fontSize: 11 }}>{t.month.slice(5)}月</div>
            </div>
          ))}
        </div>
      ) : <div className="hint">暂无数据</div>}

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
