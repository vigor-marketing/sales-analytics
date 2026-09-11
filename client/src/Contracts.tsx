import { useCallback, useEffect, useState } from 'react'
import { get, put } from './api'
import ReasonPicker from './ReasonPicker'
import { KeyTags } from './KeyTags'
import { currencyOptions } from './currencies'
import { RANGE_LABEL, rangeDates, type RangeKey } from './dateRange'

interface Item { product_name: string; qty: number | null; amount: number; currency: string }
interface OrderRow {
  order_id: string; order_no: string; won_date: string; order_amount: number | null; order_currency: string; order_note: string | null
  win_reason?: string | null; order_created_at?: string | null; order_updated_at?: string | null
  is_key_customer?: number; is_key_project?: number
  customer_stars?: number | null; note?: string | null; blockers?: string | null; action_plan?: string | null; support_needed?: string | null
  customer_country?: string | null; last_followup_at?: string | null; next_followup_at?: string | null
  use_location?: string | null; country?: string | null
  inquiry_id: string; inquiry_no: string; date: string; sales: string; purchaser: string; source: string
  customer_name: string; hand_total: number | null; hand_total_currency?: string | null; usdApprox: number; totals: { currency: string; total: number }[]
  productNames: string; itemCount: number; items: Item[]; cycleDays: number | null
}
interface MetaLite { currencies?: string[]; sales: { name: string; team: string }[]; purchasers?: string[]; sources?: string[]; winReasons?: string[]; lostReasons?: string[] }

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
const cycleTone = (d: number | null) => (d == null ? 'var(--sub)' : d <= 30 ? '#059669' : d <= 90 ? '#a35c00' : 'var(--danger)')

export default function Contracts({ meta }: { meta: MetaLite }) {
  const [orderNo, setOrderNo] = useState(''); const [customer, setCustomer] = useState(''); const [sales, setSales] = useState('')
  const [purchaser, setPurchaser] = useState(''); const [source, setSource] = useState(''); const [product, setProduct] = useState('')
  const [range, setRange] = useState<RangeKey>('')
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([])
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    get<{ id: string; name: string }[]>('/customers').then((l) => setCustomers(Array.isArray(l) ? l : [])).catch(() => { /* */ })
    get<{ id: string; name: string }[]>('/products').then((l) => setProducts(Array.isArray(l) ? l : [])).catch(() => { /* */ })
  }, [])
  const [rows, setRows] = useState<OrderRow[]>([])
  const [msg, setMsg] = useState(''); const [viewId, setViewId] = useState<string | null>(null); const [editId, setEditId] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      const { from, to } = rangeDates(range)
      if (orderNo) p.set('orderNo', orderNo); if (customer) p.set('customer', customer); if (sales) p.set('sales', sales)
      if (purchaser) p.set('purchaser', purchaser); if (source) p.set('source', source); if (product) p.set('product', product)
      if (from) p.set('from', from); if (to) p.set('to', to)
      const d = await get<{ rows: OrderRow[] }>(`/orders?${p.toString()}`)
      setRows(d.rows)
      setMsg('')
    } catch (e) {
      // 失败时不清空表格，但要说明「当前显示的是上次结果」，避免误读
      setMsg(`${(e as Error).message}（当前显示的是上次加载结果）`)
    }
  }, [orderNo, customer, sales, purchaser, source, product, range])
  useEffect(() => { void load() }, [load])
  const card: React.CSSProperties = { flex: '1 1 150px', minWidth: 150, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }
  return (
    <div className="page-fit">
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>销售订单管理</h3>
        <span className="hint">成交以订单为准：询价是否成交由是否存在订单自动判定；订单在「询报价管理」中生成</span>
        <span style={{ flex: 1 }} />
        <input className="sa" style={{ width: 150 }} value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="订单号/询价号" />
        <select className="sa" style={{ maxWidth: 170 }} value={customer} onChange={(e) => setCustomer(e.target.value)} title="按客户筛选">
          <option value="">全部客户</option>
          {customers.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          {customer && !customers.some((c) => c.name === customer) && <option value={customer}>{customer}</option>}
        </select>
        <select className="sa" value={sales} onChange={(e) => setSales(e.target.value)}><option value="">全部销售</option>{meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
        <select className="sa" value={purchaser} onChange={(e) => setPurchaser(e.target.value)}><option value="">全部采购</option>{(meta.purchasers ?? []).map((p) => <option key={p} value={p}>{p}</option>)}</select>
        <select className="sa" value={source} onChange={(e) => setSource(e.target.value)}><option value="">全部来源</option>{(meta.sources ?? []).map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select className="sa" style={{ maxWidth: 220 }} value={product} onChange={(e) => setProduct(e.target.value)} title="按产品筛选（下拉可选）">
          <option value="">全部产品</option>
          {products.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          {product && !products.some((p) => p.name === product) && <option value={product}>{product}</option>}
        </select>
        <select className="sa" value={range} onChange={(e) => setRange(e.target.value as RangeKey)} title="成单日期范围">
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => <option key={k} value={k}>{RANGE_LABEL[k]}</option>)}
        </select>
        <button className="btn" onClick={() => void load()}>查询</button>
        <button className="btn" onClick={() => { setOrderNo(''); setCustomer(''); setSales(''); setPurchaser(''); setSource(''); setProduct(''); setRange('') }}>重置</button>
      </div>
      {msg && <div className="msg err">{msg}</div>}

      <div className="tablewrap">
        <table className="grid data-table fixed-table fit-table" style={{ fontSize: 12.5 }}>
          <colgroup>
            <col style={{ width: '9%' }} /><col style={{ width: '8%' }} /><col style={{ width: '7%' }} /><col style={{ width: '14%' }} /><col style={{ width: '9%' }} />
            <col style={{ width: '5%' }} /><col style={{ width: '7%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '4%' }} />
            <col style={{ width: '5%' }} /><col style={{ width: '7%' }} /><col style={{ width: '9%' }} />
          </colgroup>
          <thead><tr>{['订单号', '询价号', '客户', '标签', '产品', '采购', '来源', '询价日期', '成单日期', '转化周期', '销售', '订单金额', '操作'].map((h) => <th key={h} style={{ textAlign: h === '来源' ? 'center' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.order_id}>
                <td className="mono" title={r.order_no}>{r.order_no}</td>
                <td className="mono" title={r.inquiry_no}>{r.inquiry_no}</td>
                <td title={r.customer_name}>{r.customer_name}</td>
                <td title={[Number(r.is_key_customer) === 1 ? '重点客户' : null, Number(r.is_key_project) === 1 ? '重点项目' : null].filter(Boolean).join('、') || '无标签'}><KeyTags kc={r.is_key_customer} kp={r.is_key_project} /></td>
                <td title={r.productNames || '—'}>{r.productNames || '—'}</td>
                <td title={r.purchaser || '—'}>{r.purchaser || '—'}</td>
                <td title={r.source || '—'} style={{ textAlign: 'center' }}><span className="badge">{r.source || '—'}</span></td>
                <td className="mono" title={r.date}>{r.date}</td>
                <td className="mono" title={r.won_date}>{r.won_date}</td>
                <td className="mono" style={{ fontWeight: 700, color: cycleTone(r.cycleDays) }} title={r.cycleDays == null ? '无转化周期' : `询价到成单 ${r.cycleDays} 天`}>{r.cycleDays == null ? '—' : r.cycleDays + ' 天'}</td>
                <td title={r.sales}>{r.sales}</td>
                <td className="mono" title={r.order_amount == null ? `按报价合计折 USD ≈ ${money(r.usdApprox)}` : `${money(r.order_amount)} ${r.order_currency}`}>{r.order_amount == null ? `≈USD ${money(r.usdApprox)}` : `${money(r.order_amount)} ${r.order_currency}`}</td>
                <td>
                  <button className="btn sm" onClick={() => setViewId(r.order_id)}>查看</button>
                  <button className="btn sm" onClick={() => setEditId(r.order_id)}>编辑</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={13} className="hint" style={{ textAlign: 'center' }}>暂无销售订单（到「询报价管理」点“生成销售订单”并填写成单日期）</td></tr>}
          </tbody>
        </table>
      </div>

      {viewId && <OrderView id={viewId} onClose={() => setViewId(null)} />}
      {editId && <OrderEdit id={editId} winReasons={meta.winReasons} currencies={meta.currencies} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); void load() }} />}
    </div>
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
  const [fus, setFus] = useState<FuLite[]>([])
  useEffect(() => {
    if (!d?.inquiry_id) return
    get<FuLite[]>(`/followups?inquiryId=${encodeURIComponent(d.inquiry_id)}`).then((l) => setFus(Array.isArray(l) ? l : [])).catch(() => { /* */ })
  }, [d?.inquiry_id])
  const totalQuote = (d?.items || []).reduce((sum, it) => sum + (Number(it.amount) || 0), 0)
  // 报价口径：产品合计 + 费用（运费/税费/佣金/其他）＝ 总报价
  const feeTotal = ['freight', 'tax', 'commission', 'other_fee'].reduce((sum, k) => sum + (Number((d as unknown as Record<string, number>)?.[k]) || 0), 0)
  const feeCur = (d as unknown as { fee_currency?: string })?.fee_currency || d?.order_currency || 'USD'
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(1040px, 97vw)', maxHeight: '92vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="订单详情">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>订单详情 · {d?.order_no ?? '加载中…'}{d?.customer_name ? `（${d.customer_name}）` : ''}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        {err && <div className="msg err">{err}</div>}
        {d && (
          <>
            {/* 订单信息 */}
            <h4 className="sec-title" style={{ marginTop: 12 }}>订单信息</h4>
            <div className="grid-2">
              <Info label="订单号" value={d.order_no} mono />
              <Info label="成单日期" value={d.won_date} mono />
              <Info label="订单金额" value={d.order_amount == null ? `未填写（报价 ≈USD ${money(d.usdApprox)}）` : `${money(d.order_amount)} ${d.order_currency}`} mono />
              <Info label="折 USD" value={`≈USD ${money(d.usdApprox)}`} mono />
              <Info label="成交原因" value={d.win_reason || '未填写'} />
              <Info label="转化周期" value={d.cycleDays == null ? '—' : `${d.cycleDays} 天（询价 ${d.date} → 成单 ${d.won_date}）`} />
              <Info label="录入时间" value={d.order_created_at ? String(d.order_created_at).slice(0, 16).replace('T', ' ') : '—'} mono />
              <Info label="最后更新" value={d.order_updated_at ? String(d.order_updated_at).slice(0, 16).replace('T', ' ') : '—'} mono />
            </div>
            {d.order_note && <Info label="订单备注" value={d.order_note} block />}

            {/* 询价与客户信息 */}
            <h4 className="sec-title" style={{ marginTop: 14 }}>询价与客户信息</h4>
            <div className="grid-2">
              <Info label="询价号" value={d.inquiry_no} mono />
              <Info label="询价日期" value={d.date} mono />
              <Info label="客户名称" value={d.customer_name} />
              <Info label="客户星级" value={d.customer_stars ? `${'★'.repeat(Number(d.customer_stars))}（${d.customer_stars} 星）` : '—'} />
              <Info label="国别" value={d.country || d.customer_country || '—'} />
              <Info label="使用地" value={d.use_location || '—'} />
              <Info label="销售人员" value={d.sales} />
              <Info label="采购人员" value={d.purchaser} />
              <Info label="询价来源" value={d.source} />
              <Info label="标签" value={`${Number(d.is_key_customer) === 1 ? '重点客户 ' : ''}${Number(d.is_key_project) === 1 ? '重点项目' : ''}`.trim() || '—'} />
              <Info label="成交时总报价（自动）" value={`${money(totalQuote + feeTotal)} ${feeTotal > 0 ? feeCur : d.order_currency}${feeTotal > 0 ? `（产品 ${money(totalQuote)} + 费用 ${money(feeTotal)}）` : ''}`} mono />
              <Info label="询价手填总金额" value={d.hand_total == null ? '—' : `${money(d.hand_total)} ${d.hand_total_currency || 'USD'}`} mono />
            </div>

            {/* 产品明细 */}
            <h4 className="sec-title" style={{ marginTop: 14 }}>产品明细（{d.items?.length ?? 0} 行）</h4>
            <div className="tablewrap">
              <table className="grid data-table fixed-table" style={{ fontSize: 12.5 }}>
                <colgroup><col style={{ width: '8%' }} /><col style={{ width: '42%' }} /><col style={{ width: '12%' }} /><col style={{ width: '20%' }} /><col style={{ width: '18%' }} /></colgroup>
                <thead><tr>{['序号', '产品名称', '数量', '金额', '币种'].map((h, i) => <th key={h} style={{ textAlign: i === 0 || i === 1 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {(d.items || []).map((it, i) => (
                    <tr key={i}>
                      <td className="mono">{i + 1}</td>
                      <td title={it.product_name}>{it.product_name}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{it.qty ?? '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(it.amount)}</td>
                      <td title={it.currency} style={{ textAlign: 'right' }}>{it.currency}</td>
                    </tr>
                  ))}
                  {feeTotal > 0 && (
                    <tr>
                      <td colSpan={3} style={{ fontWeight: 700 }}>费用合计（运费/税费/佣金/其他）</td>
                      <td className="mono" style={{ fontWeight: 700, textAlign: 'right' }}>{money(feeTotal)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{feeCur}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={3} style={{ fontWeight: 700 }}>{feeTotal > 0 ? '总报价（含费用）' : '报价合计'}</td>
                    <td className="mono" style={{ fontWeight: 800, textAlign: 'right' }}>{money(totalQuote + feeTotal)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{feeTotal > 0 ? feeCur : d.order_currency}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 询价补充信息 */}
            {(d.blockers || d.action_plan || d.support_needed || d.note) && (
              <>
                <h4 className="sec-title" style={{ marginTop: 14 }}>询价补充信息</h4>
                <div className="grid-eq3">
                  {d.blockers && <Info label="卡点/问题" value={d.blockers} block />}
                  {d.action_plan && <Info label="行动计划" value={d.action_plan} block />}
                  {d.support_needed && <Info label="需要的支持" value={d.support_needed} block />}
                </div>
                {d.note && <Info label="询价备注" value={d.note} block />}
              </>
            )}

            {/* 跟进情况 */}
            <h4 className="sec-title" style={{ marginTop: 14 }}>跟进情况（{fus.length} 条）</h4>
            <div className="grid-2">
              <Info label="最近跟进" value={d.last_followup_at || '—'} mono />
              <Info label="下次跟进" value={d.next_followup_at ? String(d.next_followup_at).replace('T', ' ') : '—'} mono />
            </div>
            {fus.length > 0 ? (
              <div className="tablewrap" style={{ overflowX: 'auto', marginTop: 6 }}>
                <table className="grid data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead><tr>{['跟进日期', '方式', '简述', '具体内容', '下次跟进', '跟进人'].map((h, i) => <th key={h} style={{ textAlign: i === 3 ? 'left' : i === 0 || i === 2 || i === 4 ? 'left' : 'left' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {fus.map((f) => (
                      <tr key={f.id}>
                        <td className="mono" style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{f.date}</td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{f.method || '—'}</td>
                        <td style={{ padding: '6px 8px' }}>{f.summary || '—'}</td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{f.detail || '—'}</td>
                        <td className="mono" style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{f.next_followup_at ? String(f.next_followup_at).replace('T', ' ') : '—'}</td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{f.by_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="hint" style={{ marginTop: 4 }}>该询价暂无跟进记录（可到「询报价跟进」页录入）</div>}
          </>
        )}
        <div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  )
}

interface FuLite {
  id: string; date: string; method: string; summary: string | null; detail: string | null
  next_followup_at: string | null; by_name: string | null
}

/** 只读信息项：标签在上、值在下（保持固定尺寸，不做拉伸） */
function Info({ label, value, mono, block }: { label: string; value: string; mono?: boolean; block?: boolean }) {
  return (
    <div className="col" style={block ? { gridColumn: '1 / -1', marginTop: 6 } : undefined}>
      <label>{label}</label>
      <div className={'ro' + (mono ? ' mono' : '')} style={{ minHeight: 30, whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  )
}

function OrderEdit({ id, onClose, onSaved, winReasons = [], currencies }: { id: string; onClose: () => void; onSaved: () => void; winReasons?: string[]; currencies?: string[] }) {
  const { d } = useOrder(id)
  const [form, setForm] = useState<{ orderNo: string; wonDate: string; amount: string; currency: string; note: string; winReason: string } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (d) setForm({ orderNo: d.order_no, wonDate: d.won_date, amount: d.order_amount == null ? '' : String(d.order_amount), currency: d.order_currency, note: d.order_note || '', winReason: (d as { win_reason?: string | null }).win_reason || '' }) }, [d])
  const save = async () => {
    if (!form) return
    setBusy(true); setErr('')
    try { await put(`/orders/${id}`, { orderNo: form.orderNo, wonDate: form.wonDate, amount: form.amount ? Number(form.amount) : undefined, currency: form.currency, note: form.note, winReason: form.winReason }); onSaved() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
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
              <div className="col w1"><label>币种</label><select className="sa" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{currencyOptions(currencies, form.currency).map((c) => <option key={c}>{c}</option>)}</select></div>
            </div>
            <div className="row">
              <div className="col w2"><label>成交原因 <span className="hint">（用于成交原因分析，选填）</span></label>
                <ReasonPicker value={form.winReason} onChange={(v) => setForm({ ...form, winReason: v })} options={winReasons} />
              </div>
            </div>
            <div className="col"><label>备注</label><textarea className="sa" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <div className="actions" style={{ marginTop: 10 }}><button className="btn pri" disabled={busy} onClick={() => void save()}>保存修改</button></div>
          </>
        )}
      </div>
    </div>
  )
}
