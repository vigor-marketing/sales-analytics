import { useCallback, useEffect, useState } from 'react'
import { del, get, put } from './api'
import { COUNTRIES } from './countries'

interface TotalItem { currency: string; total: number }
interface Row { id: string; inquiry_no: string; date: string; country: string | null; use_location: string | null; customer_name: string; sales: string; purchaser: string; source: string; hand_total: number | null; note: string | null; created_at: string; itemCount: number; totals: TotalItem[]; usdApprox: number; is_key_customer: number; is_key_project: number }
interface Detail extends Row { items: { product_name: string; qty: number | null; amount: number; currency: string }[] }
interface MetaLite { sales: { name: string; team: string }[]; purchasers: string[]; sources: string[] }

const money = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))
const CURS = ['USD', 'CNY', 'EUR']

export default function InquiryManager({ meta = { sales: [], purchasers: [], sources: [] }, initialQuery, onOpenCustomer }: { meta?: MetaLite; initialQuery?: string; onOpenCustomer?: (name: string) => void }) {
  const [q, setQ] = useState(initialQuery ?? ''); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [sales, setSales] = useState(''); const [pur, setPur] = useState(''); const [src, setSrc] = useState('')
  const [rows, setRows] = useState<Row[]>([]); const [total, setTotal] = useState(0)
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      if (q) p.set('q', q); if (from) p.set('from', from); if (to) p.set('to', to)
      if (sales) p.set('sales', sales); if (pur) p.set('purchaser', pur); if (src) p.set('source', src)
      const url = `/inquiries?${p.toString()}`
      const d = await get<{ rows: Row[]; meta: { total: number } }>(url)
      if (!d || !d.rows) throw new Error(`接口 ${url} 返回异常：${JSON.stringify(d)}`)
      setRows(d.rows); setTotal(d.meta.total)
    } catch (e) { setMsg('加载失败：' + (e as Error).message) }
  }, [q, from, to, sales, pur, src])
  useEffect(() => { if (initialQuery !== undefined) setQ(initialQuery) }, [initialQuery])
  useEffect(() => { void load() }, [load])
  const doDelete = async (id: string) => {
    if (!window.confirm('确认删除这条询报价？将连同产品明细一起删除，不可恢复。')) return
    setBusy(true)
    try { await del(`/inquiries/${id}`); setMsg('已删除'); await load() } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  const fmtT = (r: Row) => (r.totals ?? []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'
  const sumUsd = rows.reduce((s, r) => s + (r.usdApprox || 0), 0)
  return (
    <div className="card">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>合同·询报价管理</h3>
        <span className="hint">命中 {total} 条 · 折USD合计 ≈ {money(sumUsd)}</span>
      </header>
      {msg && <div className="msg ok">{msg}</div>}
      <div className="row" style={{ margin: '10px 0' }}>
        <div className="col grow1"><label>询价号/客户/备注</label><input className="sa" style={{ width: '100%' }} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="col w1"><label>日期起</label><input className="sa" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="col w1"><label>日期止</label><input className="sa" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="col w1"><label>销售</label>
          <select className="sa" value={sales} onChange={(e) => setSales(e.target.value)}><option value="">全部</option>{meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
        </div>
        <div className="col w1"><label>采购</label>
          <select className="sa" value={pur} onChange={(e) => setPur(e.target.value)}><option value="">全部</option>{meta.purchasers.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </div>
        <div className="col w1"><label>来源</label>
          <select className="sa" value={src} onChange={(e) => setSrc(e.target.value)}><option value="">全部</option>{meta.sources.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </div>
        <button className="btn" onClick={() => void load()}>查询</button>
        <button className="btn" onClick={() => { setQ(''); setFrom(''); setTo(''); setSales(''); setPur(''); setSrc(''); void load() }}>重置</button>
      </div>
      <div className="tablewrap" style={{ overflow: 'auto', maxHeight: '62vh' }}>
        <table className="grid" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
          <thead><tr>{['询价号', '日期', '客户', '标签', '国别/使用地', '行数', '报价合计', '总金额', '销售', '采购', '来源', '备注', '操作'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--line2)' }}>
                <td className="mono" style={{ padding: '6px 8px' }}>{r.inquiry_no}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.date}</td>
                <td style={{ padding: '6px 8px' }}>{r.customer_name}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}><TagBlocks r={r} /></td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.country || '—'}{r.use_location && r.use_location !== r.country ? ` / ${r.use_location}` : ''}</td>
                <td style={{ padding: '6px 8px' }}>{r.itemCount}</td>
                <td style={{ padding: '6px 8px' }} title={fmtT(r)}>{fmtT(r)}<div className="hint">≈USD {money(r.usdApprox)}</div></td>
                <td style={{ padding: '6px 8px' }} className="mono">{money(r.hand_total)}</td>
                <td style={{ padding: '6px 8px' }}>{r.sales}</td>
                <td style={{ padding: '6px 8px' }}>{r.purchaser}</td>
                <td style={{ padding: '6px 8px' }}>{r.source}</td>
                <td style={{ padding: '6px 8px', maxWidth: 180 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.note || ''}>{r.note || '—'}</div></td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => setViewId(r.id)}>查看</button>
                  <button className="btn sm" onClick={() => onOpenCustomer?.(r.customer_name)} title="查看该客户档案">客户档案</button>
                  <button className="btn sm" onClick={() => setEditId(r.id)}>编辑</button>
                  <button className="btn sm danger" disabled={busy} onClick={() => void doDelete(r.id)}>删除</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={13} style={{ textAlign: 'center', padding: 24, color: 'var(--sub)' }}>暂无询报价记录（先到「询报价录入」录一单）</td></tr>}
          </tbody>
        </table>
      </div>
      {viewId && <DetailModal id={viewId} onClose={() => setViewId(null)} />}
      {editId && <EditModal id={editId} meta={meta} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); void load() }} />}
    </div>
  )
}

function TagBlocks({ r }: { r: { is_key_customer?: number; is_key_project?: number } }) {
  const kc = Number(r.is_key_customer) === 1, kp = Number(r.is_key_project) === 1
  if (!kc && !kp) return <span className="hint">—</span>
  return (
    <>
      {kc && <span className="tag kc">重点客户</span>}
      {kp && <span className="tag kp">重点项目</span>}
    </>
  )
}
function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { get<Detail>(`/inquiries/${id}`).then(setD).catch((e) => setErr((e as Error).message)) }, [id])
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(780px, 96vw)' }} role="dialog" aria-modal="true">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{d ? `${d.inquiry_no} · ${d.customer_name}` : '加载中…'}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        {err && <div className="msg err">{err}</div>}
        {d && (
          <>
            <div className="meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', margin: '10px 0', fontSize: 13 }}>
              <span>日期 <b>{d.date}</b></span><span>标签 <b><TagBlocks r={d} /></b></span><span>国别 <b>{d.country || '—'}</b></span><span>使用地 <b>{d.use_location || '—'}</b></span>
              <span>销售 <b>{d.sales}</b></span><span>采购 <b>{d.purchaser}</b></span><span>来源 <b>{d.source}</b></span>
              <span>报价合计 <b>{(d.totals || []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ')}</b></span>
              <span>总金额 <b>{money(d.hand_total)}</b></span><span>录入时间 <b className="mono">{d.created_at?.slice(0, 16)}</b></span>
            </div>
            <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['#', '产品名称', '数量', '金额', '币种'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
              <tbody>{(d.items || []).map((it, i) => (
                <tr key={i}><td style={{ padding: 6 }}>{i + 1}</td><td style={{ padding: 6 }}>{it.product_name}</td><td style={{ padding: 6 }}>{it.qty ?? '—'}</td><td style={{ padding: 6 }}>{money(it.amount)}</td><td style={{ padding: 6 }}>{it.currency}</td></tr>
              ))}</tbody>
            </table>
            {d.note && <div className="hint" style={{ marginTop: 8 }}>备注：{d.note}</div>}
          </>
        )}
      </div>
    </div>
  )
}

function EditModal({ id, meta = { sales: [], purchasers: [], sources: [] }, onClose, onSaved }: { id: string; meta?: MetaLite; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [form, setForm] = useState<{ inquiryNo: string; customerName: string; date: string; country: string; useLoc: string; sales: string; purchaser: string; source: string; handTotal: string; note: string; keyCust: boolean; keyProj: boolean; items: { productName: string; qty: string; amount: string; currency: string }[] } | null>(null)
  const set = (patch: Partial<typeof form>) => setForm((f) => (f ? { ...f, ...patch } : f))
  useEffect(() => { get<Detail>(`/inquiries/${id}`).then((d) => setForm({ inquiryNo: d.inquiry_no, customerName: d.customer_name, date: d.date, country: d.country || '', useLoc: d.use_location || '', sales: d.sales, purchaser: d.purchaser, source: d.source, handTotal: d.hand_total == null ? '' : String(d.hand_total), note: d.note || '', keyCust: Number(d.is_key_customer) === 1, keyProj: Number(d.is_key_project) === 1, items: (d.items || []).map((it) => ({ productName: it.product_name, qty: it.qty == null ? '' : String(it.qty), amount: String(it.amount), currency: it.currency })) })).catch((e) => setErr((e as Error).message)) }, [id])
  const save = async () => {
    if (!form) return
    if (!form.items.some((it) => it.productName.trim() && Number(it.amount) > 0)) return setErr('至少一行有效产品')
    setBusy(true); setErr('')
    try {
      await put(`/inquiries/${id}`, {
        date: form.date, country: form.country, useLocation: form.useLoc || form.country, sales: form.sales, purchaser: form.purchaser, source: form.source,
        totalAmount: form.handTotal ? Number(form.handTotal) : undefined, note: form.note,
        isKeyCustomer: form.keyCust, isKeyProject: form.keyProj,
        items: form.items.filter((it) => it.productName.trim() && Number(it.amount) > 0).map((it) => ({ productName: it.productName.trim(), qty: it.qty ? Number(it.qty) : undefined, amount: Number(it.amount), currency: it.currency })),
      })
      onSaved()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(860px, 98vw)', maxHeight: '90vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="编辑询报价">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>编辑 · {form?.inquiryNo}（{form?.customerName}）</h3>
          <button className="btn sm" onClick={onClose}>取消</button>
        </div>
        {err && <div className="msg err">{err}</div>}
        {form && (
          <>
            <div className="row" style={{ marginTop: 8 }}>
              <div className="col w1"><label>日期 *</label><input className="sa" type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} /></div>
              <div className="col w1"><label>国别</label><input className="sa" value={form.country} list="edit-countries" onChange={(e) => set({ country: e.target.value })} /><datalist id="edit-countries">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist></div>
              <div className="col w1"><label>使用地</label><input className="sa" value={form.useLoc} onChange={(e) => set({ useLoc: e.target.value })} /></div>
              <div className="col w1"><label>销售 *</label>
                <select className="sa" value={form.sales} onChange={(e) => set({ sales: e.target.value })}><option value="">—</option>{meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
              </div>
              <div className="col w1"><label>采购 *</label>
                <select className="sa" value={form.purchaser} onChange={(e) => set({ purchaser: e.target.value })}><option value="">—</option>{meta.purchasers.map((p) => <option key={p} value={p}>{p}</option>)}</select>
              </div>
              <div className="col w1"><label>来源 *</label>
                <select className="sa" value={form.source} onChange={(e) => set({ source: e.target.value })}><option value="">—</option>{meta.sources.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </div>
              <div className="col w1"><label>总金额（选填）</label><input className="sa" type="number" value={form.handTotal} onChange={(e) => set({ handTotal: e.target.value })} /></div>
            </div>
            <div style={{ margin: '6px 0', fontWeight: 600 }}>产品明细</div>
            {form.items.map((it, i) => (
              <div key={i} className="row" style={{ marginBottom: 6 }}>
                <input className="sa grow1" value={it.productName} placeholder="产品名称" onChange={(e) => set({ items: form.items.map((x, j) => j === i ? { ...x, productName: e.target.value } : x) })} />
                <input className="sa w1" type="number" placeholder="数量" value={it.qty} onChange={(e) => set({ items: form.items.map((x, j) => j === i ? { ...x, qty: e.target.value } : x) })} />
                <input className="sa w1" type="number" placeholder="金额" value={it.amount} onChange={(e) => set({ items: form.items.map((x, j) => j === i ? { ...x, amount: e.target.value } : x) })} />
                <select className="sa w1" value={it.currency} onChange={(e) => set({ items: form.items.map((x, j) => j === i ? { ...x, currency: e.target.value } : x) })}>{CURS.map((c) => <option key={c}>{c}</option>)}</select>
                {form.items.length > 1 && <button className="btn sm danger" onClick={() => set({ items: form.items.filter((_, j) => j !== i) })}>删</button>}
              </div>
            ))}
            <button className="btn sm" onClick={() => set({ items: [...form.items, { productName: '', qty: '', amount: '', currency: 'USD' }] })}>＋ 添加产品</button>
            <div className="row" style={{ alignItems: 'center', gap: 18 }}>
              <label className="chk"><input type="checkbox" checked={form.keyCust} onChange={(e) => set({ keyCust: e.target.checked })} /> <span className="tag kc">重点客户</span></label>
              <label className="chk"><input type="checkbox" checked={form.keyProj} onChange={(e) => set({ keyProj: e.target.checked })} /> <span className="tag kp">重点项目</span></label>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <div className="col grow1"><label>备注</label><textarea className="sa" rows={2} value={form.note} onChange={(e) => set({ note: e.target.value })} /></div>
            </div>
            <div className="actions">
              <button className="btn pri" disabled={busy} onClick={() => void save()}>保存修改{busy ? '…' : ''}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
