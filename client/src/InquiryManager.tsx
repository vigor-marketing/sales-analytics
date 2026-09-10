import { useCallback, useEffect, useState } from 'react'
import { del, get, post, put } from './api'
import { COUNTRIES } from './countries'

interface TotalItem { currency: string; total: number }
interface Row { id: string; inquiry_no: string; date: string; country: string | null; use_location: string | null; customer_name: string; sales: string; purchaser: string; source: string; hand_total: number | null; note: string | null; created_at: string; itemCount: number; totals: TotalItem[]; usdApprox: number; is_key_customer: number; is_key_project: number; is_won: number; customer_stars?: number | null; won_date?: string | null; orderNo?: string | null; orderId?: string | null; blockers?: string | null; action_plan?: string | null; support_needed?: string | null }
interface Detail extends Row { items: { product_name: string; qty: number | null; amount: number; currency: string }[]; order?: { id: string; order_no: string; won_date: string; amount: number | null; currency: string; note: string | null } | null }
interface MetaLite { sales: { name: string; team: string }[]; purchasers: string[]; sources: string[] }

const money = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))
const CURS = ['USD', 'CNY', 'EUR']

export default function InquiryManager({ meta = { sales: [], purchasers: [], sources: [] } }: { meta?: MetaLite }) {
  const [q, setQ] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [sales, setSales] = useState(''); const [pur, setPur] = useState(''); const [src, setSrc] = useState('')
  const [rows, setRows] = useState<Row[]>([]); const [total, setTotal] = useState(0)
  const [sum, setSum] = useState<{ usdTotal: number; wonCount: number; winRate: number; wonUsd: number }>({ usdTotal: 0, wonCount: 0, winRate: 0, wonUsd: 0 })
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      if (q) p.set('q', q); if (from) p.set('from', from); if (to) p.set('to', to)
      if (sales) p.set('sales', sales); if (pur) p.set('purchaser', pur); if (src) p.set('source', src)
      const url = `/inquiries?${p.toString()}`
      const d = await get<{ rows: Row[]; meta: { total: number; usdTotal: number; wonCount: number; winRate: number; wonUsd: number } }>(url)
      if (!d || !d.rows) throw new Error(`接口 ${url} 返回异常：${JSON.stringify(d)}`)
      setRows(d.rows); setTotal(d.meta.total); setSum({ usdTotal: d.meta.usdTotal ?? 0, wonCount: d.meta.wonCount ?? 0, winRate: d.meta.winRate ?? 0, wonUsd: d.meta.wonUsd ?? 0 })
    } catch (e) { setMsg('加载失败：' + (e as Error).message) }
  }, [q, from, to, sales, pur, src])
  useEffect(() => { void load() }, [load])
  const fmtT = (r: Row) => (r.totals ?? []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'
  const sumUsd = rows.reduce((s, r) => s + (r.usdApprox || 0), 0)
  return (
    <div className="card">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>询报价管理</h3>
        <span className="hint">命中 {total} 条 · 累计金额 ≈USD {money(sum.usdTotal)} · 成单 {sum.wonCount} 条（{money(sum.wonUsd)} USD）· 成交率 {sum.winRate}%</span>
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
          <thead><tr>{['询价号', '日期', '客户', '标签', '报价合计', '销售', '操作'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--line2)' }}>
                <td className="mono" style={{ padding: '6px 8px' }}>{r.inquiry_no}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.date}</td>
                <td style={{ padding: '6px 8px' }}>{r.customer_name}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}><TagBlocks r={r} /></td>
                <td style={{ padding: '6px 8px' }} title={fmtT(r)}>≈USD {money(r.usdApprox)}<div className="hint">{fmtT(r)}</div></td>
                <td style={{ padding: '6px 8px' }}>{r.sales}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => setViewId(r.id)}>查看</button>
                  <button className="btn sm" onClick={() => setEditId(r.id)}>编辑</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--sub)' }}>暂无询报价记录（先到「询报价录入」录一单）</td></tr>}
          </tbody>
        </table>
      </div>
      {viewId && <DetailModal id={viewId} onClose={() => setViewId(null)} />}
      {editId && <EditModal id={editId} meta={meta} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); void load() }} />}
    </div>
  )
}

function TagBlocks({ r }: { r: { is_key_customer?: number; is_key_project?: number; is_won?: number } }) {
  const kc = Number(r.is_key_customer) === 1, kp = Number(r.is_key_project) === 1, won = Number(r.is_won) === 1
  if (!kc && !kp && !won) return <span className="hint">—</span>
  return (
    <>
      {won && <span className="tag won">已成单</span>}
      {kc && <span className="tag kc">重点客户</span>}
      {kp && <span className="tag kp">重点项目</span>}
    </>
  )
}
function Field({ label, value, area, empty }: { label: string; value?: string | number | null; area?: boolean; empty?: boolean }) {
  const txt = value === null || value === undefined || value === '' ? '—' : String(value)
  return (
    <div className={'col' + (area ? ' box-fixed' : '')}>
      <label>{label}</label>
      <div className={'ro' + (area ? ' area' : '') + (empty || txt === '—' ? ' empty' : '')}>{txt}</div>
    </div>
  )
}

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { get<Detail>(`/inquiries/${id}`).then(setD).catch((e) => setErr((e as Error).message)) }, [id])
  const money2 = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))
  const cycle = d?.won_date && d?.date ? Math.round((Date.parse(d.won_date) - Date.parse(d.date)) / 86400000) : null
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(1040px, 97vw)', maxHeight: '92vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="询价详情">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>询价查看 · {d?.inquiry_no ?? '加载中…'}{d?.customer_name ? `（${d.customer_name}）` : ''}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        {err && <div className="msg err">{err}</div>}
        {d && (
          <>
            {/* 基本信息（与录入页一致） */}
            <h4 className="sec-title" style={{ marginTop: 8 }}>基本信息</h4>
            <div className="row">
              <div className="col w2"><label>询价号</label><div className="ro">{d.inquiry_no}</div></div>
              <div className="col w1"><label>日期</label><div className="ro">{d.date}</div></div>
              <div className="col w2"><label>销售人员</label><div className="ro">{d.sales || '—'}</div></div>
              <div className="col w2"><label>采购人员</label><div className="ro">{d.purchaser || '—'}</div></div>
              <div className="col w2"><label>询价来源</label><div className="ro">{d.source || '—'}</div></div>
            </div>
            <div className="row">
              <div className="col grow1"><label>客户</label><div className="ro">{d.customer_name || '—'}</div></div>
              <div className="col" style={{ flex: 1 }}><label>国别</label><div className="ro">{d.country || '—'}</div></div>
              <div className="col" style={{ flex: 1 }}><label>使用地</label><div className="ro">{d.use_location || '—'}</div></div>
            </div>
            <div className="row" style={{ alignItems: 'center', gap: 18 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)' }}>客户星级</span>
              <span style={{ color: '#e3a008', fontWeight: 700 }}>{d.customer_stars ? '★'.repeat(Number(d.customer_stars)) + '☆'.repeat(5 - Number(d.customer_stars)) : '—'}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', marginLeft: 10 }}>重点客户</span>
              <span className={Number(d.is_key_customer) === 1 ? 'tag kc' : 'badge'}>{Number(d.is_key_customer) === 1 ? '是' : '否'}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', marginLeft: 10 }}>重点项目</span>
              <span className={Number(d.is_key_project) === 1 ? 'tag kp' : 'badge'}>{Number(d.is_key_project) === 1 ? '是' : '否'}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', marginLeft: 10 }}>成交状态</span>
              {Number(d.is_won) === 1 ? <span className="tag won">已生成销售订单</span> : <span className="badge">跟进中</span>}
              {Number(d.is_won) === 1 && <span className="hint">订单号 {d.orderNo || '—'} · 成单日期 {d.won_date || '—'}{cycle != null ? ` · 转化 ${cycle} 天` : ''}</span>}
            </div>

            {/* 询价明细（与录入页一致） */}
            <h4 className="sec-title" style={{ marginTop: 14 }}>询价明细</h4>
            {(d.items || []).map((it, i) => (
              <div key={i} className="item-row">
                <div className="col w-idx"><label>序号</label><div className="idx-cell">{i + 1}</div></div>
                <div className="col grow1"><label>产品名称</label><div className="ro">{it.product_name || '—'}</div></div>
                <div className="col w1"><label>数量</label><div className="ro">{it.qty == null ? '—' : it.qty}</div></div>
                <div className="col w1"><label>金额</label><div className="ro mono">{money2(it.amount)}</div></div>
                <div className="col w1"><label>币种</label><div className="ro">{it.currency}</div></div>
              </div>
            ))}
            {(d.items || []).length === 0 && <div className="hint">暂无明细</div>}
            <div className="totals" style={{ marginTop: 6 }}>
              <span className="badge new">总报价金额（自动）：</span>
              {(d.totals || []).map((t) => <span key={t.currency} className="t">{money2(t.total)} {t.currency}</span>)}
              {(d.totals || []).some((t) => t.currency !== 'USD') && <span className="badge">折 USD 约 {money2(d.usdApprox)}</span>}
              {(d.totals || []).length === 0 && <span className="hint">—</span>}
            </div>
            <div className="row">
              <div className="col w2"><label>总金额（手填）</label><div className="ro mono">{money2(d.hand_total)}</div></div>
            </div>

            {/* 卡点/行动计划/需要的支持/备注（与录入页一致） */}
            <div style={{ marginTop: 12, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
              <div className="grid-2">
                <Field label="卡点/问题" value={(d as unknown as { blockers?: string }).blockers} area />
                <Field label="行动计划" value={(d as unknown as { action_plan?: string }).action_plan} area />
                <Field label="需要的支持" value={(d as unknown as { support_needed?: string }).support_needed} area />
                <Field label="备注" value={d.note} area />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function EditModal({ id, meta = { sales: [], purchasers: [], sources: [] }, onClose, onSaved }: { id: string; meta?: MetaLite; onClose: () => void; onSaved: () => void }) {
  const [order, setOrder] = useState<{ id: string; order_no: string; won_date: string; amount: number | null; currency: string; note: string | null } | null>(null)
  const [ord, setOrd] = useState({ wonDate: new Date().toISOString().slice(0, 10), orderNo: '', amount: '', currency: 'USD', note: '' })
  const [ordErr, setOrdErr] = useState('')
  const [ordBusy, setOrdBusy] = useState(false)
  const [ordOpen, setOrdOpen] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [form, setForm] = useState<{ inquiryNo: string; customerName: string; date: string; country: string; useLoc: string; sales: string; purchaser: string; source: string; handTotal: string; note: string; blockers: string; actionPlan: string; supportNeeded: string; stars: string; keyCust: boolean; keyProj: boolean; items: { productName: string; qty: string; amount: string; currency: string }[] } | null>(null)
  const set = (patch: Partial<typeof form>) => setForm((f) => (f ? { ...f, ...patch } : f))
  useEffect(() => {
    get<Detail>(`/inquiries/${id}`).then((d) => {
      setOrdOpen(false)
      if (d.order) { setOrder(d.order); setOrd({ wonDate: d.order.won_date, orderNo: d.order.order_no, amount: d.order.amount == null ? '' : String(d.order.amount), currency: d.order.currency, note: d.order.note || '' }) }
      else { setOrder(null) }
    }).catch(() => { /* */ })
  }, [id])
  const genOrder = async () => {
    setOrdErr(''); setOrdBusy(true)
    try { await post('/orders', { inquiryId: id, wonDate: ord.wonDate, orderNo: ord.orderNo.trim() || undefined, amount: ord.amount ? Number(ord.amount) : undefined, currency: ord.currency, note: ord.note }); onSaved() }
    catch (e) { setOrdErr((e as Error).message) } finally { setOrdBusy(false) }
  }
  const saveOrder = async () => {
    if (!order) return
    setOrdErr(''); setOrdBusy(true)
    try { await put(`/orders/${order.id}`, { wonDate: ord.wonDate, orderNo: ord.orderNo.trim() || undefined, amount: ord.amount ? Number(ord.amount) : undefined, currency: ord.currency, note: ord.note }); onSaved() }
    catch (e) { setOrdErr((e as Error).message) } finally { setOrdBusy(false) }
  }
  const delOrder = async () => {
    if (!order) return
    if (!window.confirm(`删除订单 ${order.order_no}？该询价将自动变为“跟进中”。`)) return
    setOrdErr(''); setOrdBusy(true)
    try { await del(`/orders/${order.id}`); onSaved() }
    catch (e) { setOrdErr((e as Error).message) } finally { setOrdBusy(false) }
  }
  useEffect(() => { get<Detail>(`/inquiries/${id}`).then((d) => setForm({ inquiryNo: d.inquiry_no, customerName: d.customer_name, date: d.date, country: d.country || '', useLoc: d.use_location || '', sales: d.sales, purchaser: d.purchaser, source: d.source, handTotal: d.hand_total == null ? '' : String(d.hand_total), note: d.note || '', stars: d.customer_stars == null ? '' : String(d.customer_stars), blockers: d.blockers || '', actionPlan: d.action_plan || '', supportNeeded: d.support_needed || '', keyCust: Number(d.is_key_customer) === 1, keyProj: Number(d.is_key_project) === 1, items: (d.items || []).map((it) => ({ productName: it.product_name, qty: it.qty == null ? '' : String(it.qty), amount: String(it.amount), currency: it.currency })) })).catch((e) => setErr((e as Error).message)) }, [id])
  const save = async () => {
    if (!form) return
    if (!form.items.some((it) => it.productName.trim() && Number(it.amount) > 0)) return setErr('至少一行有效产品')
    setBusy(true); setErr('')
    try {
      await put(`/inquiries/${id}`, {
        date: form.date, country: form.country, useLocation: form.useLoc || form.country, sales: form.sales, purchaser: form.purchaser, source: form.source,
        totalAmount: form.handTotal ? Number(form.handTotal) : undefined, note: form.note,
        blockers: form.blockers, actionPlan: form.actionPlan, supportNeeded: form.supportNeeded, customerStars: form.stars ? Number(form.stars) : undefined,
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
            <div className="row" style={{ alignItems: 'center', gap: 18 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)' }}>客户星级</span>
              <select className="sa" style={{ width: 150 }} value={form.stars} title={form.stars ? `${form.stars} 星` : ''} onChange={(e) => set({ stars: e.target.value })}>
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{`${n} 星 `}{'★'.repeat(n)}</option>)}
              </select>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)' }}>标签</span>
              <label className="chk"><input type="checkbox" checked={form.keyCust} onChange={(e) => set({ keyCust: e.target.checked })} /> <span className="tag kc">重点客户</span></label>
              <label className="chk"><input type="checkbox" checked={form.keyProj} onChange={(e) => set({ keyProj: e.target.checked })} /> <span className="tag kp">重点项目</span></label>
              <span className="hint">（在询价基本信息中修改；成交状态由下方销售订单自动判定）</span>
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
            <div className="row" style={{ marginTop: 8 }}>
              <div className="col grow1"><label>卡点/问题</label><textarea className="sa" rows={2} value={form.blockers} onChange={(e) => set({ blockers: e.target.value })} /></div>
              <div className="col grow1"><label>行动计划</label><textarea className="sa" rows={2} value={form.actionPlan} onChange={(e) => set({ actionPlan: e.target.value })} /></div>
              <div className="col grow1"><label>需要的支持</label><textarea className="sa" rows={2} value={form.supportNeeded} onChange={(e) => set({ supportNeeded: e.target.value })} /></div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <div className="col grow1"><label>备注</label><textarea className="sa" rows={2} value={form.note} onChange={(e) => set({ note: e.target.value })} /></div>
            </div>
            <div className="actions">
              <button className="btn pri" disabled={busy} onClick={() => void save()}>保存修改{busy ? '…' : ''}</button>
            </div>

            <div style={{ marginTop: 14, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>销售订单 {order ? <span className="hint" style={{ fontWeight: 400 }}>（已生成：{order.order_no} · 成单日期 {order.won_date}）</span> : <span className="hint" style={{ fontWeight: 400 }}>（未生成，点击下方按钮补充信息）</span>}</div>
              {ordErr && <div className="msg err">{ordErr}</div>}
              {order && !ordOpen && (
                <div className="actions">
                  <button className="btn pri" disabled={ordBusy} onClick={() => setOrdOpen(true)}>编辑订单</button>
                  <button className="btn danger" disabled={ordBusy} onClick={() => void delOrder()}>删除订单</button>
                </div>
              )}
              {ordOpen && (<>
              <div className="row">
                <div className="col w2"><label>成单日期 *</label><input className="sa" type="date" value={ord.wonDate} onChange={(e) => setOrd({ ...ord, wonDate: e.target.value })} /></div>
                <div className="col w2"><label>订单号 <span className="hint">（留空自动）</span></label><input className="sa" value={ord.orderNo} onChange={(e) => setOrd({ ...ord, orderNo: e.target.value })} /></div>
                <div className="col w2"><label>订单金额</label><input className="sa" type="number" value={ord.amount} onChange={(e) => setOrd({ ...ord, amount: e.target.value })} /></div>
                <div className="col w1"><label>币种</label><select className="sa" value={ord.currency} onChange={(e) => setOrd({ ...ord, currency: e.target.value })}>{['USD', 'CNY', 'EUR'].map((c) => <option key={c}>{c}</option>)}</select></div>
              </div>
              <div className="col"><label>订单备注</label><textarea className="sa" rows={2} value={ord.note} onChange={(e) => setOrd({ ...ord, note: e.target.value })} /></div>
              <div className="actions" style={{ marginTop: 8 }}>
                {order
                  ? <><button className="btn pri" disabled={ordBusy} onClick={() => void saveOrder()}>保存订单修改</button><button className="btn" disabled={ordBusy} onClick={() => setOrdOpen(false)}>取消</button></>
                  : <><button className="btn pri" disabled={ordBusy} onClick={() => void genOrder()}>确认生成订单</button><button className="btn" disabled={ordBusy} onClick={() => setOrdOpen(false)}>取消</button></>}
              </div>
              </>)}
              {!order && !ordOpen && (
                <div className="actions">
                  <button className="btn pri" disabled={ordBusy} onClick={() => setOrdOpen(true)}>生成销售订单</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
