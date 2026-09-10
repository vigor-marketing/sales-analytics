import { useCallback, useEffect, useState } from 'react'
import { del, get, post, put } from './api'

interface Prod {
  id: string; name: string; currency: string; last_amount: number | null; last_qty: number | null
  use_count: number; last_used_at: string | null; updated_at: string
  prev_amount?: number | null; prev_qty?: number | null; prev_currency?: string | null
  amount_delta?: number | null; change_count?: number
}
interface PriceRow {
  id: string; product_name: string; currency: string; amount: number | null; qty: number | null
  prev_amount: number | null; prev_qty: number | null; prev_currency: string | null
  source: string | null; inquiry_no: string | null; customer_name: string | null; sales: string | null
  biz_date: string | null; created_at: string
}
const CURS = ['USD', 'CNY', 'EUR']
const money = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))

export default function ProductArchive() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Prod[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<Prod | null>(null)
  const [histOf, setHistOf] = useState<Prod | null>(null)
  const [add, setAdd] = useState({ name: '', currency: 'USD', lastAmount: '' })
  const load = useCallback(async () => {
    try { setRows(await get<Prod[]>(`/products${q ? `?q=${encodeURIComponent(q)}` : ''}`)) } catch (e) { setMsg((e as Error).message) }
  }, [q])
  useEffect(() => { void load() }, [load])
  const doDelete = async (p: Prod) => {
    if (!window.confirm(`删除产品档案「${p.name}」？（历史询价中的名称不受影响）`)) return
    setBusy(true)
    try { await del(`/products/${p.id}`); setMsg(`已删除：${p.name}`); await load() } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  const doAdd = async () => {
    if (!add.name.trim()) return
    try { await post('/products', { name: add.name.trim(), currency: add.currency, lastAmount: add.lastAmount ? Number(add.lastAmount) : undefined }); setMsg(`已添加：${add.name.trim()}`); setAdd({ name: '', currency: 'USD', lastAmount: '' }); await load() } catch (e) { setMsg((e as Error).message) }
  }
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>产品档案</h3>
        <span className="hint">录入询价时填写的产品会自动沉淀到这里；再次录入若金额/数量发生变化，会记入该产品的「价格记录」</span>
        <span style={{ flex: 1 }} />
        <input className="sa" style={{ width: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索产品名称" />
        <button className="btn" onClick={() => void load()}>查询</button>
      </div>
      {msg && <div className="msg ok">{msg}</div>}
      <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
        <div className="col grow1"><label>新增产品（手动）</label><input className="sa" style={{ width: '100%' }} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="产品名称" /></div>
        <div className="col w1"><label>币种</label><select className="sa" value={add.currency} onChange={(e) => setAdd({ ...add, currency: e.target.value })}>{CURS.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="col w1"><label>参考金额（选填）</label><input className="sa" type="number" value={add.lastAmount} onChange={(e) => setAdd({ ...add, lastAmount: e.target.value })} /></div>
        <button className="btn pri" onClick={() => void doAdd()}>添加</button>
      </div>
      <div className="hint" style={{ margin: '8px 0' }}>共 {rows.length} 个产品</div>
      <div className="tablewrap" style={{ overflow: 'auto', maxHeight: '62vh' }}>
        <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr>{['产品名称', '币种', '最近报价', '较上次', '最近数量', '使用次数', '最近使用', '操作'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--line2)' }}>
                <td style={{ padding: '6px 8px', fontWeight: 600 }}>{p.name}</td>
                <td style={{ padding: '6px 8px' }}>{p.currency}</td>
                <td style={{ padding: '6px 8px' }} className="mono">
                  {money(p.last_amount)}
                  {(p.change_count ?? 0) > 0 && <span className="hint" style={{ marginLeft: 6 }} title={`共记录 ${p.change_count} 次价格变动`}>变动{p.change_count}次</span>}
                </td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                  {p.amount_delta == null
                    ? ((p.change_count ?? 0) === 0 ? <span className="hint">—</span> : <span className="badge">首次录入</span>)
                    : p.amount_delta === 0
                      ? <span className="hint">持平</span>
                      : p.amount_delta > 0
                        ? <span style={{ color: '#059669', fontWeight: 700 }} title={`上次 ${money(p.prev_amount)} ${p.prev_currency ?? ''}`}>↑ {money(p.amount_delta)}</span>
                        : <span style={{ color: 'var(--danger)', fontWeight: 700 }} title={`上次 ${money(p.prev_amount)} ${p.prev_currency ?? ''}`}>↓ {money(Math.abs(p.amount_delta))}</span>}
                </td>
                <td style={{ padding: '6px 8px' }}>{p.last_qty ?? '—'}</td>
                <td style={{ padding: '6px 8px' }}>{p.use_count}</td>
                <td style={{ padding: '6px 8px' }} className="mono">{p.last_used_at || '—'}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => setHistOf(p)}>价格记录</button>
                  <button className="btn sm" onClick={() => setEdit(p)}>编辑</button>
                  <button className="btn sm danger" disabled={busy} onClick={() => void doDelete(p)}>删除</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--sub)' }}>暂无产品档案（录入询价后自动生成）</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <EditModal p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load() }} />}
      {histOf && <HistoryModal p={histOf} onClose={() => setHistOf(null)} />}
    </div>
  )
}

/** 价格变动记录：每次录入金额/数量发生变化都会留痕（含来源询价、客户、销售） */
function HistoryModal({ p, onClose }: { p: Prod; onClose: () => void }) {
  const [rows, setRows] = useState<PriceRow[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    get<PriceRow[]>(`/products/history?name=${encodeURIComponent(p.name)}`)
      .then((l) => setRows(Array.isArray(l) ? l : []))
      .catch((e) => setErr((e as Error).message))
  }, [p.name])
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(1000px, 97vw)', maxHeight: '88vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="产品价格变动记录">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>价格变动记录 · {p.name}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          当前参考报价 <b className="mono">{money(p.last_amount)} {p.currency}</b> · 最近数量 <b>{p.last_qty ?? '—'}</b> · 累计使用 {p.use_count} 次 · 已记录 {rows?.length ?? 0} 次变动（首次录入与每次金额/数量/币种变化都会留痕）
        </div>
        {err && <div className="msg err">{err}</div>}
        <div className="tablewrap" style={{ overflowX: 'auto', marginTop: 10 }}>
          <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['记录时间', '业务日期', '金额变化', '数量变化', '来源', '询价号', '客户', '销售'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>
              {(rows ?? []).map((h) => {
                const delta = (h.prev_amount == null || h.amount == null) ? null : Math.round((h.amount - h.prev_amount) * 100) / 100
                return (
                  <tr key={h.id} style={{ borderBottom: '1px solid var(--line2)' }}>
                    <td className="mono" style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{String(h.created_at).slice(0, 16).replace('T', ' ')}</td>
                    <td className="mono" style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{h.biz_date || '—'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {h.prev_amount == null
                        ? <span className="badge">首次录入 {money(h.amount)} {h.currency}</span>
                        : <>
                          <span className="mono">{money(h.prev_amount)} {h.prev_currency ?? h.currency}</span>
                          <span className="hint" style={{ margin: '0 4px' }}>→</span>
                          <b className="mono">{money(h.amount)} {h.currency}</b>
                          {delta != null && delta !== 0 && (
                            <span style={{ marginLeft: 6, fontWeight: 700, color: delta > 0 ? '#059669' : 'var(--danger)' }}>
                              {delta > 0 ? `↑ ${money(delta)}` : `↓ ${money(Math.abs(delta))}`}
                            </span>
                          )}
                        </>}
                    </td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {h.prev_qty == null && h.qty == null ? '—' : <><span className="mono">{h.prev_qty ?? '—'}</span><span className="hint" style={{ margin: '0 4px' }}>→</span><b>{h.qty ?? '—'}</b></>}
                    </td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{h.source || '—'}</td>
                    <td className="mono" style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{h.inquiry_no || '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{h.customer_name || '—'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{h.sales || '—'}</td>
                  </tr>
                )
              })}
              {rows && rows.length === 0 && <tr><td colSpan={8} className="hint" style={{ padding: 16, textAlign: 'center' }}>暂无变动记录（该产品只录入过同金额同数量，或由旧数据迁移而来）</td></tr>}
              {!rows && !err && <tr><td colSpan={8} className="hint" style={{ padding: 16, textAlign: 'center' }}>加载中…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function EditModal({ p, onClose, onSaved }: { p: Prod; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(p.name)
  const [currency, setCurrency] = useState(p.currency)
  const [lastAmount, setLastAmount] = useState(p.last_amount == null ? '' : String(p.last_amount))
  const [err, setErr] = useState('')
  const save = async () => {
    try { await put(`/products/${p.id}`, { name: name.trim() || undefined, currency, lastAmount: lastAmount ? Number(lastAmount) : undefined }); onSaved() }
    catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(520px, 96vw)' }} role="dialog" aria-modal="true" aria-label="编辑产品">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>编辑产品档案</h3>
          <button className="btn sm" onClick={onClose}>取消</button>
        </div>
        {err && <div className="msg err">{err}</div>}
        <div className="row" style={{ marginTop: 8 }}>
          <div className="col grow1"><label>产品名称</label><input className="sa" style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="col w1"><label>币种</label><select className="sa" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="col w1"><label>参考金额</label><input className="sa" type="number" value={lastAmount} onChange={(e) => setLastAmount(e.target.value)} /></div>
        </div>
        <div className="actions" style={{ marginTop: 10 }}><button className="btn pri" onClick={() => void save()}>保存</button></div>
      </div>
    </div>
  )
}
