import { useCallback, useEffect, useState } from 'react'
import { get } from './api'

interface Item { product_name: string; qty: number | null; amount: number; currency: string }
interface Contract { id: string; inquiry_no: string; customer_name: string; date: string; won_date: string | null; cycleDays: number | null; sales: string; purchaser: string; source: string; hand_total: number | null; note: string | null; usdApprox: number; totals: { currency: string; total: number }[]; productNames: string; itemCount: number; items: Item[]; country?: string | null; use_location?: string | null; is_key_customer?: number; is_key_project?: number }
interface Stats { contractCount: number; cycleCount: number; avgCycle: number | null; medianCycle: number | null; minCycle: number | null; maxCycle: number | null; usdTotal: number; byProduct: { name: string; count: number; avgCycle: number }[]; bySales: { name: string; count: number; avgCycle: number }[] }
interface MetaLite { sales: { name: string; team: string }[] }

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
const cycleTone = (d: number | null) => (d == null ? 'var(--sub)' : d <= 30 ? '#059669' : d <= 90 ? '#a35c00' : 'var(--danger)')

export default function Contracts({ meta }: { meta: MetaLite }) {
  const [q, setQ] = useState(''); const [sales, setSales] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [product, setProduct] = useState('')
  const [rows, setRows] = useState<Contract[]>([]); const [stats, setStats] = useState<Stats | null>(null)
  const [msg, setMsg] = useState(''); const [viewId, setViewId] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      if (q) p.set('q', q); if (sales) p.set('sales', sales); if (from) p.set('from', from); if (to) p.set('to', to); if (product) p.set('product', product)
      const d = await get<{ rows: Contract[]; stats: Stats }>(`/contracts?${p.toString()}`)
      setRows(d.rows); setStats(d.stats)
    } catch (e) { setMsg((e as Error).message) }
  }, [q, sales, from, to, product])
  useEffect(() => { void load() }, [load])
  const card: React.CSSProperties = { flex: '1 1 150px', minWidth: 150, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>销售订单（已成交）</h3>
        <span className="hint">已成交询价形成的销售订单一览，含产品转化周期统计</span>
        <span style={{ flex: 1 }} />
        <input className="sa" style={{ width: 180 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="询价号/客户" />
        <input className="sa" style={{ width: 160 }} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="产品名称" />
        <select className="sa" value={sales} onChange={(e) => setSales(e.target.value)}><option value="">全部销售</option>{meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
        <input className="sa" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="成单日期起" />
        <input className="sa" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="成单日期止" />
        <button className="btn" onClick={() => void load()}>查询</button>
        <button className="btn" onClick={() => { setQ(''); setSales(''); setFrom(''); setTo(''); setProduct('') }}>重置</button>
      </div>
      {msg && <div className="msg err">{msg}</div>}

      {stats && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '10px 0' }}>
          <div style={card}><div className="hint">销售订单</div><div style={{ fontSize: 20, fontWeight: 800 }}>{stats.contractCount}</div></div>
          <div style={card}><div className="hint">平均转化周期</div><div style={{ fontSize: 20, fontWeight: 800, color: cycleTone(stats.avgCycle) }}>{stats.avgCycle == null ? '—' : stats.avgCycle + ' 天'}</div></div>
          <div style={card}><div className="hint">中位转化周期</div><div style={{ fontSize: 20, fontWeight: 800 }}>{stats.medianCycle == null ? '—' : stats.medianCycle + ' 天'}</div></div>
          <div style={card}><div className="hint">最短 ~ 最长</div><div style={{ fontSize: 20, fontWeight: 800 }}>{stats.minCycle == null ? '—' : `${stats.minCycle} ~ ${stats.maxCycle} 天`}</div></div>
          <div style={card}><div className="hint">订单金额（折USD）</div><div style={{ fontSize: 20, fontWeight: 800, color: 'var(--brand)' }}>{money(stats.usdTotal)}</div></div>
        </div>
      )}

      <div className="tablewrap" style={{ overflow: 'auto', maxHeight: '56vh' }}>
        <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr>{['询价号', '客户', '产品', '询价日期', '成单日期', '转化周期', '销售', '采购', '报价合计', '操作'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--line2)' }}>
                <td style={{ padding: '6px 8px' }} className="mono">{r.inquiry_no}</td>
                <td style={{ padding: '6px 8px' }}>{r.customer_name}</td>
                <td style={{ padding: '6px 8px', maxWidth: 220 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.productNames}>{r.productNames || '—'}</div></td>
                <td style={{ padding: '6px 8px' }} className="mono">{r.date}</td>
                <td style={{ padding: '6px 8px' }} className="mono">{r.won_date || '—'}</td>
                <td style={{ padding: '6px 8px', fontWeight: 700, color: cycleTone(r.cycleDays) }}>{r.cycleDays == null ? '—' : r.cycleDays + ' 天'}</td>
                <td style={{ padding: '6px 8px' }}>{r.sales}</td>
                <td style={{ padding: '6px 8px' }}>{r.purchaser}</td>
                <td style={{ padding: '6px 8px' }} className="mono">≈USD {money(r.usdApprox)}<div className="hint">{(r.totals || []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ')}</div></td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}><button className="btn sm" onClick={() => setViewId(r.id)}>查看</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--sub)' }}>暂无销售订单（在「询报价管理」点击“已成交”并填写成单日期）</td></tr>}
          </tbody>
        </table>
      </div>

      {stats && (
        <div className="dash-cols2" style={{ marginTop: 12 }}>
          <div>
            <h4 style={{ margin: '0 0 6px' }}>按产品：转化周期统计</h4>
            <div className="tablewrap" style={{ maxHeight: 260, overflow: 'auto' }}>
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
            <h4 style={{ margin: '0 0 6px' }}>按销售：转化周期统计</h4>
            <div className="tablewrap" style={{ maxHeight: 260, overflow: 'auto' }}>
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

      {viewId && <ContractModal id={viewId} onClose={() => setViewId(null)} />}
    </div>
  )
}

function ContractModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Contract | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { get<Contract>(`/inquiries/${id}`).then(setD).catch((e) => setErr((e as Error).message)) }, [id])
  const cycle = d?.won_date && d?.date ? Math.round((Date.parse(d.won_date) - Date.parse(d.date)) / 86400000) : null
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(760px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="订单详情">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>订单详情 · {d?.inquiry_no ?? '加载中…'}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        {err && <div className="msg err">{err}</div>}
        {d && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', margin: '10px 0', fontSize: 13 }}>
              <span>客户 <b>{d.customer_name}</b></span><span>销售 <b>{d.sales}</b></span><span>采购 <b>{d.purchaser}</b></span><span>来源 <b>{d.source}</b></span>
              <span>询价日期 <b className="mono">{d.date}</b></span><span>成单日期 <b className="mono">{d.won_date || '—'}</b></span>
              <span>转化周期 <b style={{ color: cycleTone(cycle) }}>{cycle == null ? '—' : cycle + ' 天'}</b></span>
              <span>报价合计 <b>{(d.totals || []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'}</b></span>
              <span>折USD <b className="mono">{money(d.usdApprox)}</b></span><span>总金额 <b className="mono">{money(d.hand_total)}</b></span>
            </div>
            <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['#', '产品名称', '数量', '金额', '币种'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
              <tbody>{(d.items || []).map((it, i) => <tr key={i}><td style={{ padding: 6 }}>{i + 1}</td><td style={{ padding: 6 }}>{it.product_name}</td><td style={{ padding: 6 }}>{it.qty ?? '—'}</td><td style={{ padding: 6 }} className="mono">{money(it.amount)}</td><td style={{ padding: 6 }}>{it.currency}</td></tr>)}</tbody>
            </table>
            {d.note && <div className="hint" style={{ marginTop: 8 }}>备注：{d.note}</div>}
          </>
        )}
      </div>
    </div>
  )
}
