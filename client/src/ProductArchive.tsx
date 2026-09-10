import { useCallback, useEffect, useState } from 'react'
import { del, get, post, put } from './api'
import PriceHistoryModal from './PriceHistory'

interface Prod {
  id: string; name: string; currency: string; last_amount: number | null; last_qty: number | null
  use_count: number; last_used_at: string | null; updated_at: string
  prev_amount?: number | null; prev_qty?: number | null; prev_currency?: string | null
  amount_delta?: number | null; change_count?: number; version?: number
}
const CURS = ['USD', 'CNY', 'EUR']
const money = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))

export default function ProductArchive() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Prod[]>([])
  const [msg, setMsg] = useState(''); const [msgErr, setMsgErr] = useState(false)
  const say = (text: string, isErr = false) => { setMsg(text); setMsgErr(isErr) }
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
    try { await del(`/products/${p.id}`); say(`已删除：${p.name}`); await load() } catch (e) { say((e as Error).message, true) } finally { setBusy(false) }
  }
  const doAdd = async () => {
    if (!add.name.trim()) return
    try { await post('/products', { name: add.name.trim(), currency: add.currency, lastAmount: add.lastAmount ? Number(add.lastAmount) : undefined }); say(`已添加：${add.name.trim()}`); setAdd({ name: '', currency: 'USD', lastAmount: '' }); await load() } catch (e) { say((e as Error).message, true) }
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
      {msg && <div className={`msg ${msgErr ? 'err' : 'ok'}`}>{msg}</div>}
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
                  {(p.version ?? 0) > 0 && <span className="badge new" style={{ marginLeft: 6 }} title={`该产品已记录 ${p.version} 个价格版本`}>V{p.version}</span>}
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
      {histOf && <PriceHistoryModal name={histOf.name} info={{ last_amount: histOf.last_amount, currency: histOf.currency, last_qty: histOf.last_qty, use_count: histOf.use_count }} onClose={() => setHistOf(null)} />}
    </div>
  )
}

/** 价格变动记录：每次录入金额/数量发生变化都会留痕（含来源询价、客户、销售） */
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
