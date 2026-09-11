import { useCallback, useEffect, useMemo, useState } from 'react'
import { del, get, post, put } from './api'
import { StatusChip, type Status } from './StatusChip'
import ReasonPicker from './ReasonPicker'
import ProductPicker, { type ProductLite } from './ProductPicker'
import { KeyTags } from './KeyTags'
import PriceHistoryModal from './PriceHistory'
import InquiryFollowupsModal from './InquiryFollowupsModal'
import FeeHistoryModal from './FeeHistoryModal'
import InquiryDetailModal from './InquiryDetail'
import { RANGE_LABEL, rangeDates, type RangeKey } from './dateRange'
import { COUNTRIES } from './countries'
import { currencyOptions } from './currencies'

interface TotalItem { currency: string; total: number }
interface Row { id: string; inquiry_no: string; date: string; country: string | null; use_location: string | null; customer_name: string; sales: string; purchaser: string; source: string; hand_total: number | null; hand_total_currency?: string | null; note: string | null; created_at: string; itemCount: number; totals: TotalItem[]; usdApprox: number; is_key_customer: number; is_key_project: number; is_won: number; customer_stars?: number | null; won_date?: string | null; orderNo?: string | null; orderId?: string | null; last_followup_at?: string | null; next_followup_at?: string | null; is_lost?: number; lost_reason?: string | null; lost_date?: string | null; status?: Status; blockers?: string | null; action_plan?: string | null; support_needed?: string | null; last_followup_summary?: string | null; last_followup_detail?: string | null; last_followup_by?: string | null; followup_count?: number; last_followup_photos?: number; last_followup_files?: number; freight?: number | null; tax?: number | null; commission?: number | null; other_fee?: number | null; fee_currency?: string | null; feeTotal?: number; feeBuckets?: TotalItem[]; fees?: { key: string; label: string; value: number | null; currency: string; usd: number }[]; grandTotals?: TotalItem[]; quoteUsdApprox?: number; handTotalUsd?: number | null; quoteUsd?: number }
interface Detail extends Row { hand_total_currency?: string | null; fx_overrides?: string | null; freight_currency?: string | null; tax_currency?: string | null; commission_currency?: string | null; other_fee_currency?: string | null; feeVersions?: { id: string; version: number; is_latest?: boolean; total: number; fee_currency: string; created_at: string }[]; items: { product_name: string; qty: number | null; amount: number; currency: string }[]; order?: { id: string; order_no: string; won_date: string; amount: number | null; currency: string; note: string | null; win_reason?: string | null } | null }
interface MetaLite { currencies?: string[]; sales: { name: string; team: string }[]; purchasers: string[]; sources: string[]; lostReasons?: string[]; winReasons?: string[]; fx?: Record<string, number> }

const money = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))
/** 费用文案：按各自币种分行展示，如「＋运费 100 USD ＋税费 500 CNY」 */
const feeText = (r: { feeBuckets?: { currency: string; total: number }[]; fees?: { label: string; value: number | null; currency: string }[] }) => {
  const items = (r.fees ?? []).filter((f) => f.value)
  if (items.length === 0) {
    const buckets = (r.feeBuckets ?? []).filter((b) => b.total)
    return buckets.length ? buckets.map((b) => ` ＋费用 ${money(b.total)} ${b.currency}`).join('') : ''
  }
  return items.map((f) => ` ＋${f.label} ${money(f.value)} ${f.currency}`).join('')
}
const CURS = ['USD', 'CNY', 'EUR']
const LOST_REASONS = ['价格无优势', '交期太长', '技术方案不满足', '客户选择竞品', '客户预算取消', '项目暂停/延期', '联系不上客户']
/** 状态文案由后端自动判定：有订单=已成单，标记未成单=未成单，其余=跟进中 */
// 状态标签统一尺寸（见 StatusChip），三种状态大小一致
const StatusTag = StatusChip

export default function InquiryManager({ meta = { sales: [], purchasers: [], sources: [] }, onGoFollow }: {
  meta?: MetaLite
  /** 「跟进」按钮：跳转到「询报价跟进」页并带出该询价（销售 + 询价号） */
  onGoFollow?: (t: { sales: string; no: string }) => void
}) {
  const [followOf, setFollowOf] = useState<{ id: string; no: string; customer?: string } | null>(null)
  const [q, setQ] = useState(''); const [range, setRange] = useState<RangeKey>('')
  const [sales, setSales] = useState(''); const [pur, setPur] = useState(''); const [src, setSrc] = useState(''); const [st, setSt] = useState('')
  const [rows, setRows] = useState<Row[]>([]); const [total, setTotal] = useState(0)
  const [sum, setSum] = useState<{ usdTotal: number; autoUsdTotal?: number; handTotalCount?: number; wonCount: number; lostCount: number; winRate: number; wonUsd: number }>({ usdTotal: 0, wonCount: 0, lostCount: 0, winRate: 0, wonUsd: 0 })
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  // 产品档案：编辑时可直接下拉选择；这里手输的新产品保存后同样沉淀进档案
  const [products, setProducts] = useState<ProductLite[]>([])
  useEffect(() => { get<ProductLite[]>('/products').then((l) => setProducts(Array.isArray(l) ? l : [])).catch(() => { /* */ }) }, [])

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      const { from, to } = rangeDates(range)
      if (q) p.set('q', q); if (from) p.set('from', from); if (to) p.set('to', to)
      if (sales) p.set('sales', sales); if (pur) p.set('purchaser', pur); if (src) p.set('source', src); if (st) p.set('status', st)
      const url = `/inquiries?${p.toString()}`
      const d = await get<{ rows: Row[]; meta: { total: number; usdTotal: number; autoUsdTotal?: number; handTotalCount?: number; wonCount: number; lostCount: number; winRate: number; wonUsd: number } }>(url)
      void get<ProductLite[]>('/products').then((l) => setProducts(Array.isArray(l) ? l : [])).catch(() => { /* */ })
      if (!d || !d.rows) throw new Error(`接口 ${url} 返回异常：${JSON.stringify(d)}`)
      setRows(d.rows); setTotal(d.meta.total); setSum({ usdTotal: d.meta.usdTotal ?? 0, autoUsdTotal: d.meta.autoUsdTotal ?? 0, handTotalCount: d.meta.handTotalCount ?? 0, wonCount: d.meta.wonCount ?? 0, lostCount: d.meta.lostCount ?? 0, winRate: d.meta.winRate ?? 0, wonUsd: d.meta.wonUsd ?? 0 })
    } catch (e) { setMsg('加载失败：' + (e as Error).message); return }
    setMsg('')
  }, [q, range, sales, pur, src, st])
  useEffect(() => { void load() }, [load])
  const fmtT = (r: Row) => (r.totals ?? []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'
  const sumUsd = rows.reduce((s, r) => s + (r.usdApprox || 0), 0)
  return (
    <div className="card">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>询报价管理</h3>
        <span className="hint" title={sum.handTotalCount ? `其中 ${sum.handTotalCount} 条有手填总金额，按手填金额计入；无手填的按自动合计（产品明细＋费用）计入。自动合计口径合计 ≈USD ${money(sum.autoUsdTotal ?? 0)}` : '累计金额＝各询价「报价合计（含费用）」之和，即自动合计（产品明细＋费用）'}>
          {RANGE_LABEL[range]} · 命中 {total} 条 · 累计金额 ≈USD {money(sum.usdTotal)}{sum.handTotalCount ? `（含 ${sum.handTotalCount} 条手填）` : ''} · 已成单 {sum.wonCount} 条（{money(sum.wonUsd)} USD）· 未成单 {sum.lostCount} 条 · 成交率 {sum.winRate}%（成交÷已出结果）
        </span>
      </header>
      {msg && <div className="msg err">{msg}</div>}
      <div className="row" style={{ margin: '10px 0' }}>
        <div className="col grow1"><label>询价号/客户/备注</label><input className="sa" style={{ width: '100%' }} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="col w1"><label>时间范围</label>
          <select className="sa" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
            {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => <option key={k} value={k}>{RANGE_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="col w1"><label>销售</label>
          <select className="sa" value={sales} onChange={(e) => setSales(e.target.value)}><option value="">全部</option>{meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
        </div>
        <div className="col w1"><label>采购</label>
          <select className="sa" value={pur} onChange={(e) => setPur(e.target.value)}><option value="">全部</option>{meta.purchasers.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </div>
        <div className="col w1"><label>来源</label>
          <select className="sa" value={src} onChange={(e) => setSrc(e.target.value)}><option value="">全部</option>{meta.sources.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </div>
        <div className="col w1"><label>状态</label>
          <select className="sa" value={st} onChange={(e) => setSt(e.target.value)}>
            <option value="">全部</option>
            <option value="following">跟进中</option>
            <option value="won">已成单</option>
            <option value="lost">未成单</option>
          </select>
        </div>
        <button className="btn" onClick={() => void load()}>查询</button>
        <button className="btn" onClick={() => { setQ(''); setRange(''); setSales(''); setPur(''); setSrc(''); setSt(''); void load() }}>重置</button>
      </div>
      <div className="tablewrap" style={{ overflowX: 'auto' }}>
        {/* 自适应列宽：表格永远不超过屏幕宽度（长内容在单元格内换行/省略，悬停看全文） */}
        <table className="grid fit-table" style={{ borderCollapse: 'collapse', fontSize: 12.5 }}>
          <colgroup>
            <col style={{ width: '9%' }} /><col style={{ width: '6%' }} /><col style={{ width: '9%' }} /><col style={{ width: '11%' }} /><col style={{ width: '10%' }} />
            <col style={{ width: '9%' }} /><col style={{ width: '7%' }} /><col style={{ width: '15%' }} /><col style={{ width: '5%' }} /><col style={{ width: '5%' }} />
            <col style={{ width: '5%' }} /><col style={{ width: '9%' }} />
          </colgroup>
          <thead><tr>{['询价号', '日期', '客户', '状态', '标签', '报价合计（含费用）', '最近跟进', '跟进简述与详情', '销售', '采购', '来源', '操作'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: '6px 8px', textAlign: h === '来源' ? 'center' : 'left', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }} title={h === '报价合计（含费用）' ? '默认＝产品明细合计 ＋ 运费/税费/佣金/其他费用（自动统计）；该询价若手填了「总金额」，则以手填金额为准（显示「手填」标记）' : (h === '跟进简述与详情' ? '该询价最近一条跟进的简述与详情；点行内「查看详情」看全部跟进与附件' : undefined)}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.status === 'lost' ? 'row-lost' : undefined} style={{ borderBottom: '1px solid var(--line2)' }}>
                <td className="mono" style={{ padding: '6px 8px' }}>{r.inquiry_no}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.date}</td>
                <td style={{ padding: '6px 8px' }}>{r.customer_name}</td>
                <td className="cell-status" style={{ padding: '6px 8px', whiteSpace: 'nowrap' }} title={r.status === 'lost' ? `丢单原因：${r.lost_reason || '—'}${r.lost_date ? `（${r.lost_date}）` : ''}` : undefined}>
                  <StatusTag status={r.status} />
                  {r.status === 'lost' && <div className="lost-line">丢单原因：{r.lost_reason || '—'}{r.lost_date ? `（${r.lost_date}）` : ''}</div>}
                </td>
                <td className="cell-tags" style={{ padding: '6px 8px' }}><TagBlocks r={r} /></td>
                <td style={{ padding: '6px 8px' }}
                  title={r.handTotalUsd != null
                    ? `已手填总金额：${money(r.hand_total)} ${r.hand_total_currency || 'USD'}（≈USD ${money(r.handTotalUsd)}），以手填为准。\n自动合计：产品明细 ${fmtT(r) || '—'}${feeText(r)} ≈USD ${money(r.usdApprox)}`
                    : `报价合计（含费用）＝产品合计 ${fmtT(r) || '—'}${feeText(r)}（折 USD 约 ${money(r.usdApprox)}）${(r.feeBuckets ?? []).length > 1 ? '\n费用按各自币种汇率分别折算' : ''}`}>
                  {r.handTotalUsd != null ? (
                    <>
                      <span className="badge latest" style={{ marginRight: 4 }} title="该询价已手填总金额，报价合计以手填为准">手填</span>
                      <span className="mono">{money(r.hand_total)} {r.hand_total_currency || 'USD'}</span>
                      <div className="hint">≈USD {money(r.handTotalUsd)} · 自动合计 {money(r.usdApprox)}</div>
                    </>
                  ) : (
                    <>
                      ≈USD {money(r.usdApprox)}
                      <div className="hint">{fmtT(r)}{feeText(r)}</div>
                    </>
                  )}
                </td>
                {/* 最近跟进时间 + 该条跟进的简述/具体内容（悬停看全文） */}
                <td className="mono" style={{ padding: '6px 8px', whiteSpace: 'nowrap' }} title={r.last_followup_at ? `最近跟进：${r.last_followup_at}${r.followup_count ? `（共 ${r.followup_count} 次）` : ''}` : '还没有跟进记录'}>
                  {r.last_followup_at || '—'}
                </td>
                {/* 简述与详情合并在一列；完整内容（含图片/附件）点「查看详情」 */}
                <td style={{ padding: '6px 8px' }} title={[r.last_followup_summary, r.last_followup_detail].filter(Boolean).join(' ｜ ') || '还没有跟进记录'}>
                  {/* 简述/详情在上，操作按钮另起一行居中显示（与「询报价跟进」页一致） */}
                  <div className="cell-stack">
                    <span className="cell-stack-txt">
                      {r.last_followup_summary && <b>{r.last_followup_summary}</b>}
                      {r.last_followup_detail && <span className={r.last_followup_summary ? 'cell-note' : ''}>{r.last_followup_detail}</span>}
                      {!r.last_followup_summary && !r.last_followup_detail && <span className="hint">—</span>}
                      {r.last_followup_by ? <span className="cell-note">（{r.last_followup_by}）</span> : null}
                    </span>
                    {(r.followup_count || Number(r.last_followup_photos) || Number(r.last_followup_files)) ? (
                      <span className="cell-stack-actions">
                        {r.followup_count ? (
                          <button className="btn xs" title="查看该询价全部跟进详情（含简述、详情、图片、附件、跟进指导）"
                            onClick={() => setFollowOf({ id: r.id, no: r.inquiry_no, customer: r.customer_name })}>查看详情{r.followup_count > 1 ? `（${r.followup_count}）` : ''}</button>
                        ) : null}
                        {(() => {
                          const ph = Number(r.last_followup_photos) || 0, fi = Number(r.last_followup_files) || 0
                          if (!ph && !fi) return null
                          return <span className="badge" title={`最近一条跟进上传：${ph} 张图片 · ${fi} 个附件`}>{ph ? `🖼${ph}` : ''}{fi ? ` 📎${fi}` : ''}</span>
                        })()}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.sales}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.purchaser || '—'}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', textAlign: 'center' }}><span className="badge">{r.source || '—'}</span></td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                  {/* 操作：竖排分段式按钮组，统一宽度、悬停各自高亮（查看=蓝 / 编辑=琥珀 / 跟进=绿） */}
                  <span className="act-group">
                    <button className="act-btn view" title="查看该询价详情（产品明细、报价、跟进记录）" onClick={() => setViewId(r.id)}>查看</button>
                    <button className="act-btn edit" title="编辑该询价（客户、金额、标签、跟进计划等）" onClick={() => setEditId(r.id)}>编辑</button>
                    <button className="act-btn follow" title="跳转到「询报价跟进」页面对该询价做跟进"
                      onClick={() => onGoFollow ? onGoFollow({ sales: r.sales, no: r.inquiry_no }) : setFollowOf({ id: r.id, no: r.inquiry_no, customer: r.customer_name })}>跟进</button>
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={12} style={{ textAlign: 'center', padding: 24, color: 'var(--sub)' }}>暂无询报价记录（先到「询报价录入」录一单）</td></tr>}
          </tbody>
        </table>
      </div>
      {followOf && <InquiryFollowupsModal inquiryId={followOf.id} inquiryNo={followOf.no} customerName={followOf.customer} onClose={() => setFollowOf(null)} />}
      {viewId && <InquiryDetailModal id={viewId} onClose={() => setViewId(null)} />}
      {editId && <EditModal id={editId} meta={meta} products={products} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); void load() }} />}
    </div>
  )
}

const TagBlocks = ({ r }: { r: { is_key_customer?: number; is_key_project?: number } }) => <KeyTags kc={r.is_key_customer} kp={r.is_key_project} compact />

function EditModal({ id, meta = { sales: [], purchasers: [], sources: [] }, products = [], onClose, onSaved }: { id: string; meta?: MetaLite; products?: ProductLite[]; onClose: () => void; onSaved: () => void }) {
  const [order, setOrder] = useState<{ id: string; order_no: string; won_date: string; amount: number | null; currency: string; note: string | null; win_reason?: string | null } | null>(null)
  const [ord, setOrd] = useState({ wonDate: new Date().toISOString().slice(0, 10), orderNo: '', amount: '', currency: 'USD', note: '', winReason: '' })
  const [histName, setHistName] = useState<string | null>(null)
  const [ordErr, setOrdErr] = useState('')
  const [ordBusy, setOrdBusy] = useState(false)
  const [ordOpen, setOrdOpen] = useState(false)
  // 询价报价合计（与录入页一致：按币种自动合计 + 折USD），并用于生成订单时带出金额
  const [quote, setQuote] = useState<{ currency: string; total: number }[]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [feeHist, setFeeHist] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [form, setForm] = useState<{ freight: string; tax: string; commission: string; otherFee: string; feeCurrency: string; feeCurFreight: string; feeCurTax: string; feeCurCommission: string; feeCurOther: string; fxRates: Record<string, string>; inquiryNo: string; customerName: string; date: string; country: string; useLoc: string; sales: string; purchaser: string; source: string; handTotal: string; handTotalCur: string; note: string; blockers: string; actionPlan: string; supportNeeded: string; stars: string; keyCust: boolean; keyProj: boolean; isLost: boolean; lostReason: string; lostDate: string; items: { productName: string; qty: string; amount: string; currency: string }[] } | null>(null)
  const set = (patch: Partial<typeof form>) => setForm((f) => (f ? { ...f, ...patch } : f))
  useEffect(() => {
    get<Detail>(`/inquiries/${id}`).then((d) => {
      setDetail(d)
      setOrdOpen(false)
      setQuote((d.totals || []).filter((t) => Number(t.total) > 0)) // 首次快照；后续以 liveTotals 为准
      if (d.order) { setOrder(d.order); setOrd({ wonDate: d.order.won_date, orderNo: d.order.order_no, amount: d.order.amount == null ? '' : String(d.order.amount), currency: d.order.currency, note: d.order.note || '', winReason: d.order.win_reason || '' }) }
      else { setOrder(null) }
    }).catch(() => { /* */ })
  }, [id])
  // 生成/修改销售订单：所有选项必填
  const ordMissing = [
    !ord.wonDate.trim() ? '成单日期' : null,
    !ord.orderNo.trim() ? '订单号' : null,
    !(Number(ord.amount) > 0) ? '订单金额（需大于 0）' : null,
    !ord.currency ? '币种' : null,
    !ord.winReason.trim() ? '成交原因' : null,
    !ord.note.trim() ? '订单备注' : null,
  ].filter(Boolean) as string[]
  const ordValid = ordMissing.length === 0
  const genOrder = async () => {
    if (!ordValid) return setOrdErr(`请填写：${ordMissing.join('、')}`)
    setOrdErr(''); setOrdBusy(true)
    try { await post('/orders', { inquiryId: id, wonDate: ord.wonDate, orderNo: ord.orderNo.trim(), amount: Number(ord.amount), currency: ord.currency, note: ord.note.trim(), winReason: ord.winReason.trim() }); onSaved() }
    catch (e) { setOrdErr((e as Error).message) } finally { setOrdBusy(false) }
  }
  const saveOrder = async () => {
    if (!order) return
    if (!ordValid) return setOrdErr(`请填写：${ordMissing.join('、')}`)
    setOrdErr(''); setOrdBusy(true)
    try { await put(`/orders/${order.id}`, { wonDate: ord.wonDate, orderNo: ord.orderNo.trim(), amount: Number(ord.amount), currency: ord.currency, note: ord.note.trim(), winReason: ord.winReason.trim() }); onSaved() }
    catch (e) { setOrdErr((e as Error).message) } finally { setOrdBusy(false) }
  }
  const delOrder = async () => {
    if (!order) return
    if (!window.confirm(`删除订单 ${order.order_no}？该询价将自动变为“跟进中”。`)) return
    setOrdErr(''); setOrdBusy(true)
    try { await del(`/orders/${order.id}`); onSaved() }
    catch (e) { setOrdErr((e as Error).message) } finally { setOrdBusy(false) }
  }
  useEffect(() => { get<Detail>(`/inquiries/${id}`).then((d) => setForm({ freight: d.freight == null ? '' : String(d.freight), tax: d.tax == null ? '' : String(d.tax), commission: d.commission == null ? '' : String(d.commission), otherFee: d.other_fee == null ? '' : String(d.other_fee), feeCurrency: d.fee_currency || 'USD', feeCurFreight: d.freight_currency || d.fee_currency || 'USD', feeCurTax: d.tax_currency || d.fee_currency || 'USD', feeCurCommission: d.commission_currency || d.fee_currency || 'USD', feeCurOther: d.other_fee_currency || d.fee_currency || 'USD', fxRates: (d.fx_overrides ? (() => { try { const o = JSON.parse(d.fx_overrides) as Record<string, unknown>; return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) } catch { return {} } })() : {}), inquiryNo: d.inquiry_no, customerName: d.customer_name, date: d.date, country: d.country || '', useLoc: d.use_location || '', sales: d.sales, purchaser: d.purchaser, source: d.source, handTotal: d.hand_total == null ? '' : String(d.hand_total), handTotalCur: d.hand_total_currency || 'USD', note: d.note || '', stars: d.customer_stars == null ? '' : String(d.customer_stars), blockers: d.blockers || '', actionPlan: d.action_plan || '', supportNeeded: d.support_needed || '', keyCust: Number(d.is_key_customer) === 1, keyProj: Number(d.is_key_project) === 1, isLost: Number(d.is_lost) === 1, lostReason: d.lost_reason || '', lostDate: d.lost_date || new Date().toISOString().slice(0, 10),  items: (d.items || []).map((it) => ({ productName: it.product_name, qty: it.qty == null ? '' : String(it.qty), amount: String(it.amount), currency: it.currency })) })).catch((e) => setErr((e as Error).message)) }, [id])
  // 实时合计：跟随产品明细的金额与币种变化（与「询报价录入」同一口径）
  const liveTotals = useMemo(() => {
    const m = new Map<string, number>()
    // 行小计 = 金额（单价）× 数量；数量未填/为 0 时按 1 计
    ;(form?.items ?? []).forEach((it) => { const a = (Number(it.amount) || 0) * (Number(it.qty) > 0 ? Number(it.qty) : 1); if (a > 0) m.set(it.currency, (m.get(it.currency) ?? 0) + a) })
    const order = currencyOptions(meta.currencies, undefined)
    const list = Array.from(m.entries()).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([currency, total]) => ({ currency, total }))
    const fx = meta.fx ?? { USD: 1, CNY: 7.12, EUR: 0.92 }
    const usd = list.reduce((sum, x) => sum + x.total / (fx[x.currency] || 1), 0)
    const feeTotal = ['freight', 'tax', 'commission', 'otherFee'].reduce((sum, k) => sum + (Number((form as unknown as Record<string, string>)?.[k]) || 0), 0)
    const feeCur = form?.feeCurrency || 'USD'
    const gm = new Map<string, number>(list.map((x) => [x.currency, x.total]))
    if (feeTotal) gm.set(feeCur, (gm.get(feeCur) ?? 0) + feeTotal)
    const gOrder = currencyOptions(meta.currencies, undefined)
    const grandList = Array.from(gm.entries()).filter(([, v]) => v > 0).sort((a, b) => gOrder.indexOf(a[0]) - gOrder.indexOf(b[0])).map(([currency, total]) => ({ currency, total }))
    return { list, usd, feeTotal, feeCur, grandList, grandUsd: grandList.reduce((sum, x) => sum + x.total / (fx[x.currency] || 1), 0) }
  }, [form, meta.fx])

  const save = async () => {
    if (!form) return
    if (!form.items.some((it) => it.productName.trim() && Number(it.amount) > 0)) return setErr('至少一行有效产品')
    if (form.isLost && !order && !form.lostReason.trim()) return setErr('标记「未成单」必须选择或填写丢单原因')
    setBusy(true); setErr('')
    try {
      await put(`/inquiries/${id}`, {
        date: form.date, country: form.country, useLocation: form.useLoc || form.country, sales: form.sales, purchaser: form.purchaser, source: form.source,
        totalAmount: form.handTotal ? Number(form.handTotal) : undefined, totalAmountCurrency: form.handTotal ? form.handTotalCur : undefined, note: form.note,
        freight: form.freight === '' ? undefined : Number(form.freight), tax: form.tax === '' ? undefined : Number(form.tax),
        commission: form.commission === '' ? undefined : Number(form.commission), otherFee: form.otherFee === '' ? undefined : Number(form.otherFee), feeCurrency: form.feeCurrency, freightCurrency: form.feeCurFreight, taxCurrency: form.feeCurTax, commissionCurrency: form.feeCurCommission, otherFeeCurrency: form.feeCurOther,
        fxRates: Object.fromEntries(Object.entries(form.fxRates).map(([c, v]) => [c, Number(v)]).filter(([, v]) => Number(v) > 0)),
        blockers: form.blockers, actionPlan: form.actionPlan, supportNeeded: form.supportNeeded, customerStars: form.stars ? Number(form.stars) : undefined,
        isKeyCustomer: form.keyCust, isKeyProject: form.keyProj,
        isLost: order ? undefined : form.isLost, lostReason: order ? undefined : (form.lostReason.trim() || undefined), lostDate: order ? undefined : (form.lostDate || undefined),
        items: form.items.filter((it) => it.productName.trim() && Number(it.amount) > 0).map((it) => ({ productName: it.productName.trim(), qty: Number(it.qty) > 0 ? Number(it.qty) : 1, amount: Number(it.amount), currency: it.currency })),
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
            </div>
            <div style={{ marginTop: 8, borderTop: '1px dashed var(--line)', paddingTop: 8 }}>
              <div className="row" style={{ marginBottom: 6, alignItems: 'flex-end' }}>
                {([['freight', '运费', 'feeCurFreight'], ['tax', '税费', 'feeCurTax'], ['commission', '佣金', 'feeCurCommission'], ['otherFee', '其他费用', 'feeCurOther']] as const).map(([k, label, ck]) => (
                  <div className="col" key={k} style={{ minWidth: 130 }}>
                    <label>{label}</label>
                    <input className="sa" style={{ width: '100%' }} type="number" min="0" value={form[k]} onChange={(e) => set({ [k]: e.target.value })} placeholder="0" />
                  </div>
                ))}
                {([['freight', '运费', 'feeCurFreight'], ['tax', '税费', 'feeCurTax'], ['commission', '佣金', 'feeCurCommission'], ['otherFee', '其他费用', 'feeCurOther']] as const).map(([k, label, ck]) => (
                  <div className="col" key={`c-${k}`} style={{ minWidth: 160 }}>
                    <label>{label} · 币种{form[ck] !== 'USD' ? ' 与汇率' : ''}</label>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <select className="sa" style={{ width: 76, flexShrink: 0 }} value={form[ck]} onChange={(e) => set({ [ck]: e.target.value })}>
                        {currencyOptions(meta.currencies, form[ck]).map((c) => <option key={c}>{c}</option>)}
                      </select>
                      {form[ck] !== 'USD' && (
                        <input className="sa" style={{ flex: 1, minWidth: 0 }} type="number" min="0" step="0.0001"
                          title={`本单 ${form[ck]} 的实际汇率（1 USD = ? ${form[ck]}），默认 ${meta.fx?.[form[ck]] ?? '—'}`}
                          value={form.fxRates[form[ck]] ?? String(meta.fx?.[form[ck]] ?? '')}
                          onChange={(e) => set({ fxRates: { ...form.fxRates, [form[ck]]: e.target.value } })} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="totals" style={{ marginBottom: 6 }}>
                <span className="badge new">总报价（含费用）：</span>
                {liveTotals.grandList.length === 0
                  ? <span style={{ color: 'var(--sub)' }}>填一行金额后自动合计</span>
                  : <span className="t" title={`按各自币种合计：${liveTotals.grandList.map((t) => `${money(t.total)} ${t.currency}`).join(' + ')}（非美元按本单实际汇率折 USD）`}>
                      {money(Math.round(liveTotals.grandUsd))} USD
                    </span>}
              </div>
              <div className="row" style={{ marginBottom: 0 }}>
                <div className="col w2"><label>总金额（手填 · 选填）</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="sa" style={{ flex: 1, minWidth: 0 }} type="number" value={form.handTotal} onChange={(e) => set({ handTotal: e.target.value })} placeholder="议价/最终金额" />
                    <select className="sa" style={{ width: 92, flexShrink: 0 }} value={form.handTotalCur} title="手填总金额的金额单位"
                      onChange={(e) => set({ handTotalCur: e.target.value })}>{currencyOptions(meta.currencies, form.handTotalCur).map((c) => <option key={c}>{c}</option>)}</select>
                  </div>
                </div>
              </div>
              <div className="hint" style={{ display: 'block', marginTop: 4 }}>总报价（含费用）= 各行金额自动合计 ＋ 运费/税费/佣金/其他费用；总金额可另行手填最终/成交金额，与报价一致可留空。</div>
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
            {/* 金额版本记录：改金额保存后会在产品档案生成新版本，这里即时预演 */}
            <div style={{ marginTop: 10, background: '#f8fafd', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>金额版本记录</span>
                <span className="hint">保存后自动同步到产品档案：为每个产品生成一个新版本（单价/数量/币种有变化时）</span>
              </div>
              {form.items.filter((it) => it.productName.trim()).map((it, i) => {
                const pr = products.find((x) => x.name.toLowerCase() === it.productName.trim().toLowerCase())
                const amt = Number(it.amount) || 0
                const qty = it.qty === '' ? null : Number(it.qty)
                const changed = !pr
                  || Number(pr.last_amount ?? -1) !== amt
                  || Number(pr.last_qty ?? -1) !== Number(qty ?? -1)
                  || pr.currency !== it.currency
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap', fontSize: 12.5 }}>
                    <span style={{ minWidth: 180, fontWeight: 600 }}>{it.productName}</span>
                    {pr
                      ? <>
                        <span className="badge new">当前 V{pr.version ?? 0}</span>
                        <span className="hint">最近单价 {money(pr.last_amount)} {pr.currency}{pr.last_qty != null ? ` · 数量 ${pr.last_qty}` : ''}</span>
                        {pr.prev_amount != null && <span className="hint">（上一版 {money(pr.prev_amount)}）</span>}
                        <span className="hint">→ 本次录入 单价 <b className="mono">{money(amt)} {it.currency}</b> × {qty != null && qty > 0 ? qty : 1} ＝ <b className="mono">{money(amt * (qty != null && qty > 0 ? qty : 1))}</b> {it.currency}</span>
                        {changed
                          ? <span style={{ color: '#a35c00', fontWeight: 700 }}>保存后生成 V{(pr.version ?? 0) + 1}</span>
                          : <span className="hint" style={{ color: '#059669' }}>与最近一致，保存后版本不变</span>}
                      </>
                      : <>
                        <span className="badge">未建档</span>
                        <span style={{ color: '#a35c00', fontWeight: 700 }}>保存后创建 V1</span>
                      </>}
                    <button className="btn xs" disabled={!pr} onClick={() => pr && setHistName(pr.name)}>查看记录</button>
                  </div>
                )
              })}
              {(() => {
                const fv = (detail?.feeVersions ?? [])[0]
                const feeNow = liveTotals.feeTotal > 0
                const feeChanged = Math.abs(liveTotals.feeTotal - (Number(detail?.feeTotal ?? 0))) > 0.001 || (form.feeCurrency !== (detail?.fee_currency || 'USD'))
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap', fontSize: 12.5, borderTop: '1px dashed var(--line)', paddingTop: 6 }}>
                    <span style={{ minWidth: 180, fontWeight: 600 }}>费用（运费 / 税费 / 佣金 / 其他费用）</span>
                    {feeNow
                      ? <>
                        <span className="badge new">当前 V{fv?.version ?? 1}</span>
                        <span className="hint">当前合计 {money(Number(detail?.feeTotal ?? 0))} {detail?.fee_currency || 'USD'}</span>
                        <span className="hint">→ 本次录入 <b className="mono">{money(liveTotals.feeTotal)} {form.feeCurrency}</b></span>
                        {feeChanged
                          ? <span style={{ color: '#a35c00', fontWeight: 700 }}>保存后生成 V{(fv?.version ?? 0) + 1}</span>
                          : <span className="hint" style={{ color: '#059669' }}>与当前一致，保存后版本不变</span>}
                      </>
                      : <span className="badge">未填写费用</span>}
                    <button className="btn xs" disabled={!(detail?.feeVersions ?? []).length} onClick={() => setFeeHist(true)}>查看记录</button>
                  </div>
                )
              })()}
              {form.items.filter((it) => it.productName.trim()).length === 0 && <div className="hint" style={{ marginTop: 4 }}>先填写产品名称与金额</div>}
            </div>

            {/* 产品明细：表头 + 数据行共用同一套网格列宽，保证逐列对齐 */}
            <div className="item-scroll">
              <div className="item-grid item-head">
                <span>产品名称</span>
                <span>数量</span>
                <span>金额 <i style={{ color: 'var(--danger)', fontStyle: 'normal' }}>*</i></span>
                <span>币种</span>
                <span style={{ textAlign: 'center' }}>操作</span>
              </div>
              {form.items.map((it, i) => (
                <div key={i} className="item-grid" style={{ marginBottom: 6 }}>
                  <ProductPicker value={it.productName} products={products} placeholder="产品名称（可手输，也可选择）"
                    onChange={(patch) => {
                      set({
                        items: form.items.map((x, j) => (j === i ? {
                          ...x,
                          productName: patch.productName,
                          currency: patch.currency ?? x.currency,
                          // 命中产品档案：完全带入上次录入的数量与金额，之后可自由修改
                          qty: patch.fromArchive ? (patch.qty ?? '') : x.qty,
                          amount: patch.fromArchive ? (patch.amount ?? '') : x.amount,
                        } : x)),
                      })
                    }} />
                  <input className="sa" type="number" placeholder="数量" value={it.qty} onChange={(e) => set({ items: form.items.map((x, j) => j === i ? { ...x, qty: e.target.value } : x) })} />
                  <input className="sa" type="number" placeholder="单价" value={it.amount} onChange={(e) => set({ items: form.items.map((x, j) => j === i ? { ...x, amount: e.target.value } : x) })} />
                  <select className="sa" value={it.currency} onChange={(e) => set({ items: form.items.map((x, j) => j === i ? { ...x, currency: e.target.value } : x) })}>{currencyOptions(meta.currencies, it.currency).map((c) => <option key={c}>{c}</option>)}</select>
                  <span className="hint mono" title={`行小计＝单价 × 数量（数量留空按 1 计）`} style={{ whiteSpace: 'nowrap' }}>
                    小计 {(() => { const q = Number(it.qty) > 0 ? Number(it.qty) : 1; const v = (Number(it.amount) || 0) * q; return v > 0 ? `${money(v)} ${it.currency}` : '—' })()}
                  </span>
                  <span className="row-act">
                    {form.items.length > 1 && <button className="icon-del" title="删除该行" aria-label={`删除第 ${i + 1} 行`} onClick={() => set({ items: form.items.filter((_, j) => j !== i) })}>×</button>}
                  </span>
                </div>
              ))}
            </div>
            <button className="btn sm" onClick={() => set({ items: [...form.items, { productName: '', qty: '', amount: '', currency: 'USD' }] })}>＋ 添加产品</button>
            <div className="grid-eq3" style={{ marginTop: 8 }}>
              <div className="col fixed-h"><label>卡点/问题</label><textarea className="sa fixed-h" value={form.blockers} onChange={(e) => set({ blockers: e.target.value })} /></div>
              <div className="col fixed-h"><label>行动计划</label><textarea className="sa fixed-h" value={form.actionPlan} onChange={(e) => set({ actionPlan: e.target.value })} /></div>
              <div className="col fixed-h"><label>需要的支持</label><textarea className="sa fixed-h" value={form.supportNeeded} onChange={(e) => set({ supportNeeded: e.target.value })} /></div>
            </div>
            <div className="row fixed-h" style={{ marginTop: 8 }}>
              <div className="col grow1 fixed-h"><label>备注</label><textarea className="sa fixed-h" value={form.note} onChange={(e) => set({ note: e.target.value })} /></div>
            </div>
            {/* 跟进状态：自动判定，未成单需填原因 */}
            <div className={form.isLost && !order ? 'statuswrap-lost' : ''} style={{ marginTop: 14, borderTop: form.isLost && !order ? 'none' : '1px dashed var(--line)', paddingTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700 }}>跟进状态</span>
                <StatusTag status={order ? 'won' : form.isLost ? 'lost' : 'following'} />
              </div>
              {/* 提示词单独一行放在下方，不跟在标签后面 */}
              <div className="hint" style={{ display: 'block', marginTop: 4 }}>
                {order ? '已生成销售订单 → 自动判定为「已成单」' : form.isLost ? '已标记未成单（需填写原因，保存后生效）' : '无销售订单且未标未成单 → 自动判定为「跟进中」'}
              </div>
              {order ? (
                <div className="hint" style={{ marginTop: 6 }}>该询价已成单；若要改为未成单，请先在下方「销售订单」区块删除订单。</div>
              ) : (
                <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
                  <div className="col" style={{ minWidth: 220 }}>
                    <label>未成单标记</label>
                    <label className="chk" style={{ minHeight: 34 }} title="客户明确不做了/丢单时勾选，并填写原因">
                      <input type="checkbox" checked={form.isLost} onChange={(e) => set({ isLost: e.target.checked, lostDate: form.lostDate || new Date().toISOString().slice(0, 10) })} />
                      标记为「未成单（丢单）」
                    </label>
                  </div>
                  {form.isLost && (<>
                    <div className="col w2" style={{ minWidth: 320 }}>
                      <label>丢单原因 *</label>
                      <ReasonPicker
                        value={form.lostReason}
                        onChange={(v) => set({ lostReason: v })}
                        options={meta.lostReasons?.length ? meta.lostReasons : LOST_REASONS}
                        placeholder="— 请选择原因 —"
                      />
                    </div>
                    <div className="col w1"><label>丢单日期</label><input className="sa" type="date" value={form.lostDate} onChange={(e) => set({ lostDate: e.target.value })} /></div>
                  </>)}
                </div>
              )}
              {/* 未成单提示词：独立一行显示在下方 */}
              {!order && form.isLost && (
                <div className="hint" style={{ display: 'block', marginTop: 4 }}>
                  丢单原因必填；下拉选项在「字段与选项设置 → 丢单原因」维护，没有合适选项时选「其他（手动输入）」手填。
                </div>
              )}
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
              {/* 生成销售订单：所有选项均为必填（带 * 标记）；金额与币种同一行 */}
              <div className="hint" style={{ marginTop: 4 }}>以下均为必填项：成单日期、订单号、订单金额、币种、成交原因、订单备注。</div>
              <div className="row">
                <div className="col w2"><label>成单日期 *</label><input className="sa" type="date" value={ord.wonDate} onChange={(e) => setOrd({ ...ord, wonDate: e.target.value })} /></div>
                <div className="col w2"><label>订单号 * <span className="hint">（默认下一个可用号，可改）</span></label><input className="sa" value={ord.orderNo} onChange={(e) => setOrd({ ...ord, orderNo: e.target.value })} placeholder="如 SO-20260911-001" /></div>
              </div>
              {/* 金额 + 币种：同一行；金额输入框与上方「成单日期」等宽（w2 = 220px） */}
              <div className="row" style={{ marginBottom: 6 }}>
                <div className="col w2"><label>订单金额 * <span className="hint">（默认带出报价合计）</span></label>
                  <input className="sa" type="number" min="0" value={ord.amount} onChange={(e) => setOrd({ ...ord, amount: e.target.value })} placeholder="填写成交金额" />
                </div>
                <div className="col" style={{ flex: '0 0 120px' }}><label>币种 *</label>
                  <select className="sa" style={{ width: '100%' }} value={ord.currency} onChange={(e) => setOrd({ ...ord, currency: e.target.value })}>{currencyOptions(meta.currencies, ord.currency).map((c) => <option key={c}>{c}</option>)}</select>
                </div>
                <div className="col" style={{ flex: 1, minWidth: 220 }}>
                  <label>&nbsp;</label>
                  <span className="hint" style={{ lineHeight: '34px' }}>该金额即真实订单金额，销售订单管理/分析（金额、客单价、单均价、小组与个人对比）均以它为准。</span>
                </div>
              </div>
              <div className="row">
                <div className="col w2"><label>成交原因 * <span className="hint">（用于成交原因分析）</span></label>
                  <ReasonPicker value={ord.winReason} onChange={(v) => setOrd({ ...ord, winReason: v })} options={meta.winReasons ?? []} placeholder="— 请选择成交原因 —" />
                </div>
              </div>
              <div className="col"><label>订单备注 *</label><textarea className="sa" rows={2} value={ord.note} onChange={(e) => setOrd({ ...ord, note: e.target.value })} placeholder="如：分两批交付，首批 9 月内发出" /></div>
              {ordErr && <div className="msg err" style={{ marginTop: 6 }}>{ordErr}</div>}
              <div className="actions" style={{ marginTop: 8 }}>
                {order
                  ? <><button className="btn pri" disabled={ordBusy || !ordValid} title={ordValid ? '' : '请填写全部必填项'} onClick={() => void saveOrder()}>保存订单修改</button><button className="btn" disabled={ordBusy} onClick={() => setOrdOpen(false)}>取消</button></>
                  : <><button className="btn pri" disabled={ordBusy || !ordValid} title={ordValid ? '' : '请填写全部必填项'} onClick={() => void genOrder()}>确认生成订单</button><button className="btn" disabled={ordBusy} onClick={() => setOrdOpen(false)}>取消</button></>}
              </div>
              </>)}
              {!order && !ordOpen && (
                <div className="actions">
                  <button className="btn pri" disabled={ordBusy || form.isLost} onClick={() => {
                    const src = liveTotals.grandList.length ? liveTotals.grandList : quote
                    const best = [...src].sort((a, b) => Number(b.total) - Number(a.total))[0]
                    if (best) setOrd((o) => ({ ...o, amount: String(best.total), currency: best.currency }))
                    // 预填下一个订单号（所有字段必填，订单号也一并带出，可改）
                    get<{ orderNo: string }>('/orders/next-no').then((r) => setOrd((o) => ({ ...o, orderNo: o.orderNo || r.orderNo }))).catch(() => { /* 留空则由后端自动生成 */ })
                    setOrdOpen(true)
                  }}>生成销售订单</button>
                  {form.isLost && <span className="hint" style={{ color: 'var(--danger)' }}>已标记「未成单」：请先取消未成单标记并保存，才能生成销售订单</span>}
                </div>
              )}
            </div>

            {feeHist && <FeeHistoryModal inquiryId={id} inquiryNo={form?.inquiryNo} onClose={() => setFeeHist(false)} />}

            {histName && <PriceHistoryModal name={histName} info={(() => { const pr = products.find((x) => x.name === histName); return pr ? { last_amount: pr.last_amount, currency: pr.currency, last_qty: pr.last_qty, use_count: pr.use_count } : undefined })()} onClose={() => setHistName(null)} />}

            {/* 保存按钮固定在弹窗最下方右下角 */}
            <div className="modal-foot">
              {err && <span className="hint" style={{ color: 'var(--danger)', marginRight: 'auto' }}>{err}</span>}
              <button className="btn" disabled={busy} onClick={onClose}>取消</button>
              <button className="btn pri" disabled={busy} onClick={() => void save()}>保存修改{busy ? '…' : ''}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
