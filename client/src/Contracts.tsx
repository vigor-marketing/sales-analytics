import { useCallback, useEffect, useState } from 'react'
import { del, get, put } from './api'

interface Item { product_name: string; qty: number | null; amount: number; currency: string }
interface OrderRow {
  order_id: string; order_no: string; won_date: string; order_amount: number | null; order_currency: string; order_note: string | null
  inquiry_id: string; inquiry_no: string; date: string; sales: string; purchaser: string; source: string
  customer_name: string; hand_total: number | null; usdApprox: number; totals: { currency: string; total: number }[]
  productNames: string; itemCount: number; items: Item[]; cycleDays: number | null
}
interface MetaLite { sales: { name: string; team: string }[] }

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
const cycleTone = (d: number | null) => (d == null ? 'var(--sub)' : d <= 30 ? '#059669' : d <= 90 ? '#a35c00' : 'var(--danger)')

export default function Contracts({ meta }: { meta: MetaLite }) {
  const [q, setQ] = useState(''); const [sales, setSales] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [product, setProduct] = useState('')
  const [rows, setRows] = useState<OrderRow[]>([])
  const [msg, setMsg] = useState(''); const [viewId, setViewId] = useState<string | null>(null); const [editId, setEditId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      if (q) p.set('q', q); if (sales) p.set('sales', sales); if (from) p.set('from', from); if (to) p.set('to', to); if (product) p.set('product', product)
      const d = await get<{ rows: OrderRow[] }>(`/orders?${p.toString()}`)
      setRows(d.rows)
    } catch (e) { setMsg((e as Error).message) }
  }, [q, sales, from, to, product])
  useEffect(() => { void load() }, [load])
  const doDelete = async (r: OrderRow) => {
    if (!window.confirm(`删除订单 ${r.order_no}？删除后该询价将自动变为“跟进中”。`)) return
    setBusy(true)
    try { await del(`/orders/${r.order_id}`); setMsg(`已删除订单：${r.order_no}`); await load() } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  const card: React.CSSProperties = { flex: '1 1 150px', minWidth: 150, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>销售订单管理</h3>
        <span className="hint">成交以订单为准：询价是否成交由是否存在订单自动判定；订单在「询报价管理」中生成</span>
        <span style={{ flex: 1 }} />
        <input className="sa" style={{ width: 170 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="订单号/询价号/客户" />
        <input className="sa" style={{ width: 150 }} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="产品名称" />
        <select className="sa" value={sales} onChange={(e) => setSales(e.target.value)}><option value="">全部销售</option>{meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
        <input className="sa" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="成单日期起" />
        <input className="sa" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="成单日期止" />
        <button className="btn" onClick={() => void load()}>查询</button>
        <button className="btn" onClick={() => { setQ(''); setSales(''); setFrom(''); setTo(''); setProduct('') }}>重置</button>
      </div>
      {msg && <div className="msg ok">{msg}</div>}

      <div className="tablewrap" style={{ overflow: 'auto', maxHeight: '56vh' }}>
        <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr>{['订单号', '询价号', '客户', '产品', '询价日期', '成单日期', '转化周期', '销售', '订单金额', '操作'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.order_id} style={{ borderBottom: '1px solid var(--line2)' }}>
                <td style={{ padding: '6px 8px' }} className="mono">{r.order_no}</td>
                <td style={{ padding: '6px 8px' }} className="mono">{r.inquiry_no}</td>
                <td style={{ padding: '6px 8px' }}>{r.customer_name}</td>
                <td style={{ padding: '6px 8px', maxWidth: 260, whiteSpace: 'normal', wordBreak: 'break-word' }}>{r.productNames || '—'}</td>
                <td style={{ padding: '6px 8px' }} className="mono">{r.date}</td>
                <td style={{ padding: '6px 8px' }} className="mono">{r.won_date}</td>
                <td style={{ padding: '6px 8px', fontWeight: 700, color: cycleTone(r.cycleDays) }}>{r.cycleDays == null ? '—' : r.cycleDays + ' 天'}</td>
                <td style={{ padding: '6px 8px' }}>{r.sales}</td>
                <td style={{ padding: '6px 8px' }} className="mono">{r.order_amount == null ? `≈USD ${money(r.usdApprox)}` : `${money(r.order_amount)} ${r.order_currency}`}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => setViewId(r.order_id)}>查看</button>
                  <button className="btn sm" onClick={() => setEditId(r.order_id)}>编辑</button>
                  <button className="btn sm danger" disabled={busy} onClick={() => void doDelete(r)}>删除</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--sub)' }}>暂无销售订单（到「询报价管理」点“生成销售订单”并填写成单日期）</td></tr>}
          </tbody>
        </table>
      </div>

      {viewId && <OrderView id={viewId} onClose={() => setViewId(null)} />}
      {editId && <OrderEdit id={editId} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); void load() }} />}
    </div>
  )
}

function useOrder(id: string) {
  const [d, setD] = useState<OrderRow | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { get<{ rows: OrderRow[] }>(`/orders`).then((r) => { const hit = r.rows.find((x) => x.order_id === id) || null; if (!hit) setErr('订单不存在'); setD(hit) }).catch((e) => setErr((e as Error).message)) }, [id])
  return { d, err }
}

function OrderView({ id, onClose }: { id: string; onClose: () => void }) {
  const { d, err } = useOrder(id)
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(760px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="订单详情">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>订单详情 · {d?.order_no ?? '加载中…'}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        {err && <div className="msg err">{err}</div>}
        {d && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', margin: '10px 0', fontSize: 13 }}>
              <span>询价号 <b className="mono">{d.inquiry_no}</b></span><span>客户 <b>{d.customer_name}</b></span>
              <span>销售 <b>{d.sales}</b></span><span>采购 <b>{d.purchaser}</b></span><span>来源 <b>{d.source}</b></span>
              <span>询价日期 <b className="mono">{d.date}</b></span><span>成单日期 <b className="mono">{d.won_date}</b></span>
              <span>转化周期 <b style={{ color: cycleTone(d.cycleDays) }}>{d.cycleDays == null ? '—' : d.cycleDays + ' 天'}</b></span>
              <span>订单金额 <b>{d.order_amount == null ? `≈USD ${money(d.usdApprox)}` : `${money(d.order_amount)} ${d.order_currency}`}</b></span>
            </div>
            <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['#', '产品名称', '数量', '金额', '币种'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
              <tbody>{(d.items || []).map((it, i) => <tr key={i}><td style={{ padding: 6 }}>{i + 1}</td><td style={{ padding: 6 }}>{it.product_name}</td><td style={{ padding: 6 }}>{it.qty ?? '—'}</td><td style={{ padding: 6 }} className="mono">{money(it.amount)}</td><td style={{ padding: 6 }}>{it.currency}</td></tr>)}</tbody>
            </table>
            {d.order_note && <div className="hint" style={{ marginTop: 8 }}>订单备注：{d.order_note}</div>}
          </>
        )}
      </div>
    </div>
  )
}

function OrderEdit({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const { d } = useOrder(id)
  const [form, setForm] = useState<{ orderNo: string; wonDate: string; amount: string; currency: string; note: string } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (d) setForm({ orderNo: d.order_no, wonDate: d.won_date, amount: d.order_amount == null ? '' : String(d.order_amount), currency: d.order_currency, note: d.order_note || '' }) }, [d])
  const save = async () => {
    if (!form) return
    setBusy(true); setErr('')
    try { await put(`/orders/${id}`, { orderNo: form.orderNo, wonDate: form.wonDate, amount: form.amount ? Number(form.amount) : undefined, currency: form.currency, note: form.note }); onSaved() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(560px, 96vw)' }} role="dialog" aria-modal="true" aria-label="编辑订单">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>编辑销售订单</h3>
          <button className="btn sm" onClick={onClose}>取消</button>
        </div>
        {err && <div className="msg err">{err}</div>}
        {form && (
          <>
            <div className="row" style={{ marginTop: 8 }}>
              <div className="col w2"><label>订单号</label><input className="sa" value={form.orderNo} onChange={(e) => setForm({ ...form, orderNo: e.target.value })} /></div>
              <div className="col w2"><label>成单日期</label><input className="sa" type="date" value={form.wonDate} onChange={(e) => setForm({ ...form, wonDate: e.target.value })} /></div>
            </div>
            <div className="row">
              <div className="col w2"><label>订单金额</label><input className="sa" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div className="col w1"><label>币种</label><select className="sa" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{['USD', 'CNY', 'EUR'].map((c) => <option key={c}>{c}</option>)}</select></div>
            </div>
            <div className="col"><label>备注</label><textarea className="sa" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <div className="actions" style={{ marginTop: 10 }}><button className="btn pri" disabled={busy} onClick={() => void save()}>保存修改</button></div>
          </>
        )}
      </div>
    </div>
  )
}
