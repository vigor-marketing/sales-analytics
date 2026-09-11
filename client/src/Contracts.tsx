import { useCallback, useEffect, useState } from 'react'
import { get } from './api'
import InquiryFollowupsModal from './InquiryFollowupsModal'
import { KeyTags } from './KeyTags'
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
  feeBuckets?: { currency: string; total: number }[]; fees?: { key: string; label: string; value: number | null; currency: string; rate?: number; usd: number }[]
  grandTotals?: { currency: string; total: number }[]; fxUsed?: Record<string, number>
  freight?: number | null; tax?: number | null; commission?: number | null; other_fee?: number | null; fee_currency?: string | null
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
  const [msg, setMsg] = useState(''); const [viewId, setViewId] = useState<string | null>(null)
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
        <span className="hint">成交以订单为准：询价是否成交由是否存在订单自动判定；订单在「询报价管理」中生成，本页只读查看</span>
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
            <col style={{ width: '8%' }} /><col style={{ width: '7%' }} /><col style={{ width: '6%' }} /><col style={{ width: '15%' }} /><col style={{ width: '6%' }} />
            <col style={{ width: '5%' }} /><col style={{ width: '6%' }} /><col style={{ width: '7%' }} /><col style={{ width: '7%' }} /><col style={{ width: '6%' }} />
            <col style={{ width: '10%' }} /><col style={{ width: '5%' }} /><col style={{ width: '8%' }} /><col style={{ width: '4%' }} />
          </colgroup>
          <thead><tr>{['订单号', '询价号', '客户', '标签', '产品', '采购', '来源', '询价日期', '成单日期', '转化周期', '成交原因', '销售', '订单金额', '操作'].map((h) => <th key={h} style={{ textAlign: h === '来源' ? 'center' : 'left' }} title={h === '成交原因' ? '本页均为已成交订单，只显示成交原因（不存在未成交/丢单原因）；成交原因在生成销售订单时填写，选项可在「字段与选项设置 → 成交原因」维护' : undefined}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.order_id}>
                <td className="mono" title={r.order_no}>{r.order_no}</td>
                <td className="mono" title={r.inquiry_no}>{r.inquiry_no}</td>
                <td title={r.customer_name}>{r.customer_name}</td>
                <td className="cell-tags" title={[Number(r.is_key_customer) === 1 ? '重点客户' : null, Number(r.is_key_project) === 1 ? '重点项目' : null].filter(Boolean).join('、') || '无标签'}><KeyTags kc={r.is_key_customer} kp={r.is_key_project} compact /></td>
                <td title={r.productNames || '—'}>{r.productNames || '—'}</td>
                <td title={r.purchaser || '—'}>{r.purchaser || '—'}</td>
                <td title={r.source || '—'} style={{ textAlign: 'center' }}><span className="badge">{r.source || '—'}</span></td>
                <td className="mono" title={r.date}>{r.date}</td>
                <td className="mono" title={r.won_date}>{r.won_date}</td>
                <td className="mono" style={{ fontWeight: 700, color: cycleTone(r.cycleDays) }} title={r.cycleDays == null ? '无转化周期' : `询价到成单 ${r.cycleDays} 天`}>{r.cycleDays == null ? '—' : r.cycleDays + ' 天'}</td>
                {/* 本页均为已成交订单：只显示成交原因（不存在未成交原因） */}
                <td title={r.win_reason || '该订单未填写成交原因（生成/编辑销售订单时可填写，用于成交原因分析）'}>
                  {r.win_reason ? <span className="badge latest">{r.win_reason}</span> : <span className="hint">未填写</span>}
                </td>
                <td title={r.sales}>{r.sales}</td>
                <td className="mono" title={r.order_amount == null ? `按报价合计折 USD ≈ ${money(r.usdApprox)}` : `${money(r.order_amount)} ${r.order_currency}`}>{r.order_amount == null ? `≈USD ${money(r.usdApprox)}` : `${money(r.order_amount)} ${r.order_currency}`}</td>
                <td>
                  <button className="btn sm" onClick={() => setViewId(r.order_id)}>查看</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={14} className="hint" style={{ textAlign: 'center' }}>暂无销售订单（到「询报价管理」点“生成销售订单”并填写成单日期）</td></tr>}
          </tbody>
        </table>
      </div>

      {viewId && <OrderView id={viewId} onClose={() => setViewId(null)} />}
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
  const [fuOpen, setFuOpen] = useState(false)
  useEffect(() => {
    if (!d?.inquiry_id) return
    get<FuLite[]>(`/followups?inquiryId=${encodeURIComponent(d.inquiry_id)}`).then((l) => setFus(Array.isArray(l) ? l : [])).catch(() => { /* */ })
  }, [d?.inquiry_id])
  const feeList = (d?.fees ?? []).filter((f) => f.value)
  const feeBuckets = (d?.feeBuckets ?? []).filter((b) => b.total)
  const quoteRows = d?.grandTotals ?? d?.totals ?? []
  const orderAmt = d?.order_amount == null ? null : `${money(d.order_amount)} ${d.order_currency}`
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(1060px, 97vw)', maxHeight: '92vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="订单详情">
        {/* 头部：订单号 + 关键指标 */}
        <div className="ov-head">
          <div>
            <h3 style={{ margin: 0 }}>订单详情 · <span className="mono">{d?.order_no ?? '加载中…'}</span></h3>
            {d && <div className="hint" style={{ marginTop: 2 }}>{d.customer_name} · 询价 {d.inquiry_no} · 成单 {d.won_date}</div>}
          </div>
          <span style={{ flex: 1 }} />
          {d && <span className={'badge ' + (d.win_reason ? 'latest' : '')} title="成交原因">{d.win_reason ? `成交原因：${d.win_reason}` : '未填写成交原因'}</span>}
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        {err && <div className="msg err">{err}</div>}
        {d && (
          <>
            <div className="ov-kpis">
              <div className="ov-kpi">
                <span className="ov-kpi-label">订单金额</span>
                <b className="ov-kpi-value">{orderAmt ?? `≈USD ${money(d.usdApprox)}`}</b>
                <span className="ov-kpi-note">{d.order_amount == null ? '未填写，按报价折算' : `折 USD ≈ ${money(d.usdApprox)}`}</span>
              </div>
              <div className="ov-kpi">
                <span className="ov-kpi-label">成交总报价（含费用）</span>
                <b className="ov-kpi-value">{quoteRows.map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'}</b>
                <span className="ov-kpi-note">折 USD ≈ {money(d.usdApprox)}</span>
              </div>
              <div className="ov-kpi">
                <span className="ov-kpi-label">转化周期</span>
                <b className="ov-kpi-value" style={{ color: cycleTone(d.cycleDays) }}>{d.cycleDays == null ? '—' : `${d.cycleDays} 天`}</b>
                <span className="ov-kpi-note">询价 {d.date} → 成单 {d.won_date}</span>
              </div>
              <div className="ov-kpi">
                <span className="ov-kpi-label">客户 / 归属</span>
                <b className="ov-kpi-value" style={{ fontSize: 14 }}>{d.customer_name}</b>
                <span className="ov-kpi-note">销售 {d.sales} · 采购 {d.purchaser} · 来源 {d.source}</span>
              </div>
            </div>

            {/* 订单信息 */}
            <section className="ov-sec">
              <h4 className="ov-sec-title">订单信息</h4>
              <div className="kv">
                <Kv k="订单号" v={d.order_no} mono />
                <Kv k="成单日期" v={d.won_date} mono />
                <Kv k="订单金额" v={orderAmt ?? '未填写'} mono />
                <Kv k="成交原因" v={d.win_reason || '未填写'} />
                <Kv k="录入时间" v={d.order_created_at ? String(d.order_created_at).slice(0, 16).replace('T', ' ') : '—'} mono />
                <Kv k="最后更新" v={d.order_updated_at ? String(d.order_updated_at).slice(0, 16).replace('T', ' ') : '—'} mono />
              </div>
              {d.order_note && <div className="ov-note"><span className="hint">订单备注</span><div>{d.order_note}</div></div>}
            </section>

            {/* 询价与客户 */}
            <section className="ov-sec">
              <h4 className="ov-sec-title">询价与客户</h4>
              <div className="kv">
                <Kv k="询价号" v={d.inquiry_no} mono />
                <Kv k="询价日期" v={d.date} mono />
                <Kv k="客户名称" v={d.customer_name} />
                <Kv k="客户星级" v={d.customer_stars ? `${'★'.repeat(Number(d.customer_stars))}（${d.customer_stars} 星）` : '—'} />
                <Kv k="国别" v={d.country || d.customer_country || '—'} />
                <Kv k="使用地" v={d.use_location || '—'} />
                <Kv k="销售人员" v={d.sales} />
                <Kv k="采购人员" v={d.purchaser} />
                <Kv k="询价来源" v={d.source} />
                <Kv k="标签" v={`${Number(d.is_key_customer) === 1 ? '重点客户 ' : ''}${Number(d.is_key_project) === 1 ? '重点项目' : ''}`.trim() || '—'} />
                <Kv k="询价手填总金额" v={d.hand_total == null ? '—' : `${money(d.hand_total)} ${d.hand_total_currency || 'USD'}`} mono />
                <Kv k="最近 / 下次跟进" v={`${d.last_followup_at || '—'} / ${d.next_followup_at ? String(d.next_followup_at).replace('T', ' ') : '—'}`} mono />
              </div>
            </section>

            {/* 报价明细 */}
            <section className="ov-sec">
              <h4 className="ov-sec-title">报价明细<span className="hint">（产品明细 ＋ 各项费用，币种各自计算）</span></h4>
              <div className="tablewrap">
                <table className="grid data-table fit-table" style={{ fontSize: 12.5 }}>
                  <colgroup><col style={{ width: '5%' }} /><col style={{ width: '31%' }} /><col style={{ width: '8%' }} /><col style={{ width: '13%' }} /><col style={{ width: '14%' }} /><col style={{ width: '9%' }} /><col style={{ width: '20%' }} /></colgroup>
                  <thead><tr>{['序号', '产品 / 费用项目', '数量', '单价', '小计', '币种', '折 USD'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {(d.items || []).map((it, i) => (
                      <tr key={i}>
                        <td className="mono">{i + 1}</td>
                        <td title={it.product_name}>{it.product_name}</td>
                        <td className="mono">{it.qty ?? '—'}</td>
                        <td className="mono">{money(it.amount)}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>{money((Number(it.amount) || 0) * (Number(it.qty) > 0 ? Number(it.qty) : 1))}</td>
                        <td title={it.currency}>{it.currency}</td>
                        <td className="mono hint">{money(Math.round(((Number(it.amount) || 0) * (Number(it.qty) > 0 ? Number(it.qty) : 1)) / ((d.fxUsed ?? {})[it.currency] || 1)))}</td>
                      </tr>
                    ))}
                    {feeList.map((f) => (
                      <tr key={f.key}>
                        <td className="mono">—</td>
                        <td title={`${f.label}（费用）`}><span className="badge">{f.label}</span></td>
                        <td className="hint">—</td>
                        <td className="hint">—</td>
                        <td className="mono">{money(f.value)}</td>
                        <td title={f.rate && f.rate !== 1 ? `本单汇率 1 USD = ${f.rate} ${f.currency}` : f.currency}>{f.currency}{f.rate && f.rate !== 1 ? <span className="hint" style={{ marginLeft: 3 }}>@{f.rate}</span> : null}</td>
                        <td className="mono hint">{money(f.usd)}</td>
                      </tr>
                    ))}
                    <tr className="ov-total-row">
                      <td colSpan={4} style={{ fontWeight: 700 }}>{feeList.length ? '总报价（含费用）' : '报价合计'}</td>
                      <td colSpan={2} className="mono" style={{ fontWeight: 800 }}>{quoteRows.map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'}</td>
                      <td className="mono" style={{ fontWeight: 800 }}>≈USD {money(d.usdApprox)}</td>
                    </tr>
                    {feeBuckets.length > 1 && (
                      <tr><td colSpan={7} className="hint" style={{ textAlign: 'left' }}>费用按各自币种与汇率分别折算（{feeList.map((f) => `${f.label} ${money(f.value)} ${f.currency}`).join(' · ')}）</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 跟进情况 */}
            <section className="ov-sec">
              <h4 className="ov-sec-title">
                跟进情况<span className="hint">（共 {fus.length} 条）</span>
                <span style={{ flex: 1 }} />
                {fus.length > 0 && <button className="btn xs" title="查看该询价的全部跟进详情（简述、详情、图片、附件、跟进指导）" onClick={() => setFuOpen(true)}>查看全部跟进详情</button>}
              </h4>
              {fus.length > 0 ? (
                <div className="tablewrap">
                  <table className="grid data-table fit-table" style={{ fontSize: 12.5 }}>
                    <colgroup><col style={{ width: '12%' }} /><col style={{ width: '10%' }} /><col style={{ width: '26%' }} /><col style={{ width: '14%' }} /><col style={{ width: '10%' }} /><col style={{ width: '28%' }} /></colgroup>
                    <thead><tr>{['跟进日期', '方式', '跟进简述', '下次跟进', '跟进人', '具体内容'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {fus.map((f) => (
                        <tr key={f.id}>
                          <td className="mono">{f.date}</td>
                          <td>{f.method || '—'}</td>
                          <td>{f.summary || '—'}</td>
                          <td className="mono">{f.next_followup_at ? String(f.next_followup_at).replace('T', ' ') : '—'}</td>
                          <td>{f.by_name || '—'}</td>
                          <td title={f.detail || '—'} style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{(f.detail || '—').slice(0, 60)}{(f.detail || '').length > 60 ? '…' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="hint">该询价暂无跟进记录（可到「询报价跟进」页录入）</div>}
            </section>

            {/* 询价补充信息 */}
            {(d.blockers || d.action_plan || d.support_needed || d.note) && (
              <section className="ov-sec">
                <h4 className="ov-sec-title">询价补充信息</h4>
                <div className="kv">
                  {d.blockers && <Kv k="卡点/问题" v={d.blockers} block />}
                  {d.action_plan && <Kv k="行动计划" v={d.action_plan} block />}
                  {d.support_needed && <Kv k="需要的支持" v={d.support_needed} block />}
                  {d.note && <Kv k="询价备注" v={d.note} block />}
                </div>
              </section>
            )}
            {fuOpen && <InquiryFollowupsModal inquiryId={d.inquiry_id} inquiryNo={d.inquiry_no} customerName={d.customer_name} onClose={() => setFuOpen(false)} />}
          </>
        )}
        <div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  )
}

/** 只读键值行：标签固定宽度在左、值在右，逐行对齐 */
function Kv({ k, v, mono, block }: { k: string; v: string; mono?: boolean; block?: boolean }) {
  return (
    <div className={'kv-row' + (block ? ' block' : '')}>
      <span className="kv-k">{k}</span>
      <span className={'kv-v' + (mono ? ' mono' : '')}>{v}</span>
    </div>
  )
}

interface FuLite {
  id: string; date: string; method: string; summary: string | null; detail: string | null
  next_followup_at: string | null; by_name: string | null
}

