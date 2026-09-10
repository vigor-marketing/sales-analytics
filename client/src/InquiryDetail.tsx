import { useEffect, useState } from 'react'
import { get } from './api'
import { StatusChip } from './StatusChip'
import PriceHistoryModal from './PriceHistory'
import GuidanceNote from './Guidance'

interface TotalItem { currency: string; total: number }
interface Detail {
  id: string; inquiry_no: string; date: string; country: string | null; use_location: string | null; customer_name: string
  sales: string; purchaser: string; source: string; hand_total: number | null; note: string | null
  is_key_customer: number; is_key_project: number; is_won: number; status?: 'won' | 'lost' | 'following'
  customer_stars?: number | null; won_date?: string | null; orderNo?: string | null
  last_followup_at?: string | null; next_followup_at?: string | null
  is_lost?: number; lost_reason?: string | null; lost_date?: string | null
  blockers?: string | null; action_plan?: string | null; support_needed?: string | null
  items: { product_name: string; qty: number | null; amount: number; currency: string }[]
  totals: TotalItem[]; usdApprox: number
  order?: { id: string; order_no: string; won_date: string; amount: number | null; currency: string; note: string | null; win_reason?: string | null } | null
}
interface ProductLite { id: string; name: string; currency: string; last_amount: number | null; last_qty?: number | null; use_count: number; version?: number; prev_amount?: number | null }

function Field({ label, value, area, empty, fixed }: { label: string; value?: string | number | null; area?: boolean; empty?: boolean; fixed?: boolean }) {
  const txt = value === null || value === undefined || value === '' ? '—' : String(value)
  return (
    <div className={'col' + (area ? ' box-fixed' : '') + (fixed ? ' fixed-h' : '')}>
      <label>{label}</label>
      <div className={'ro' + (area ? ' area' : '') + (fixed ? ' fixed-h' : '') + (empty || txt === '—' ? ' empty' : '')}>{txt}</div>
    </div>
  )
}

interface FuRow {
  id: string; date: string; method: string; summary: string | null; detail: string | null
  photos: string[]; attachments: { url: string; name: string }[]; next_followup_at: string | null; by_name: string | null; created_at: string
  comments?: { id: string; content: string; by_name: string | null; created_at: string }[]
}

export default function InquiryDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  // 产品档案（金额版本展示用）在组件内自行加载，方便各页面直接复用
  const [products, setProducts] = useState<ProductLite[]>([])
  useEffect(() => { get<ProductLite[]>('/products').then((l) => setProducts(Array.isArray(l) ? l : [])).catch(() => { /* */ }) }, [])
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState('')
  // 与「询报价跟进」联动：查看时一并带出该询价下的全部跟进记录
  const [fus, setFus] = useState<FuRow[]>([])
  const [fuLoaded, setFuLoaded] = useState(false)
  const [histName, setHistName] = useState<string | null>(null)
  useEffect(() => { get<Detail>(`/inquiries/${id}`).then(setD).catch((e) => setErr((e as Error).message)) }, [id])
  useEffect(() => {
    setFuLoaded(false)
    get<FuRow[]>(`/followups?inquiryId=${encodeURIComponent(id)}`)
      .then((list) => setFus(Array.isArray(list) ? list : []))
      .catch(() => setFus([]))
      .finally(() => setFuLoaded(true))
  }, [id])
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
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', marginLeft: 10 }}>状态</span>
              <StatusChip status={d.status} />
              {Number(d.is_won) === 1 && <span className="hint">订单号 {d.orderNo || '—'} · 成单日期 {d.won_date || '—'}{cycle != null ? ` · 转化 ${cycle} 天` : ''}</span>}
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', marginLeft: 10 }}>跟进</span>
              <span className="hint">最近跟进 {d.last_followup_at || '—'} · 下次跟进 {d.next_followup_at || '—'}</span>
            </div>
            {/* 提示词单独一行放在下方 */}
            <div className="hint" style={{ display: 'block', marginTop: 4 }}>
              状态为自动判定：有销售订单即为「已成单」，标记未成单后为「未成单」，其余为「跟进中」；跟进记录见下方「跟进记录」区块（与「询报价跟进」实时联动）。
            </div>

            {d.status === 'lost' && (
              <div className="lostbox">
                <div><b>未成单（丢单）</b></div>
                <div style={{ marginTop: 3 }}>丢单原因：<b>{d.lost_reason || '—'}</b></div>
                {d.lost_date && <div>丢单日期：<b className="mono">{d.lost_date}</b></div>}
                <div className="hint" style={{ color: '#b91c1c', marginTop: 4 }}>如需重新跟进：在「编辑」中取消未成单标记并保存，之后才能生成销售订单。</div>
              </div>
            )}

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

            {/* 金额版本：与产品档案联动，展示每个产品当前是第几版、最近一次变化 */}
            {(() => {
              const verOf = (nm: string) => products.find((x) => x.name.toLowerCase() === nm.trim().toLowerCase())
              const list = (d.items || []).map((it) => ({ it, p: verOf(it.product_name) }))
              return (
                <div style={{ marginTop: 8, background: '#f8fafd', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>金额版本</span>
                    <span className="hint">（在「编辑」里改金额保存后，会同步生成产品档案的新版本）</span>
                  </div>
                  {list.map(({ it, p: pr }, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap', fontSize: 12.5 }}>
                      <span style={{ minWidth: 180, fontWeight: 600 }}>{it.product_name}</span>
                      {pr
                        ? <>
                          {(pr.version ?? 0) > 0
                            ? <span className="badge new">当前 V{pr.version}</span>
                            : <span className="badge">暂无价格记录</span>}
                          <span className="hint">最近报价 {money2(pr.last_amount)} {pr.currency}{pr.last_qty != null ? ` · 数量 ${pr.last_qty}` : ''}</span>
                          {pr.prev_amount != null && <span className="hint">（上一版 {money2(pr.prev_amount)}）</span>}
                        </>
                        : <span className="badge">未建档</span>}
                      <button className="btn xs" disabled={!pr} onClick={() => pr && setHistName(pr.name)}>查看记录</button>
                    </div>
                  ))}
                  {list.length === 0 && <div className="hint" style={{ marginTop: 4 }}>暂无产品明细</div>}
                </div>
              )
            })()}

            <div className="row" style={{ alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)' }}>总报价金额（自动）</span>
              {(d.totals || []).map((t) => (
                <span key={t.currency} className="ro mono" style={{ width: 'auto', display: 'inline-flex' }}>{money2(t.total)} {t.currency}</span>
              ))}
              {(d.totals || []).some((t) => t.currency !== 'USD') && (
                <span className="ro mono" style={{ width: 'auto', display: 'inline-flex' }}>折 USD 约 {money2(d.usdApprox)}</span>
              )}
              {(d.totals || []).length === 0 && <span className="hint">—</span>}
            </div>
            <div className="row">
              <div className="col w2"><label>总金额（手填）</label><div className="ro mono">{money2(d.hand_total)}</div></div>
            </div>

            {/* 卡点/行动计划/需要的支持/备注（与录入页一致） */}
            <div style={{ marginTop: 12, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
              <div className="grid-eq3">
                <Field label="卡点/问题" value={(d as unknown as { blockers?: string }).blockers} area fixed />
                <Field label="行动计划" value={(d as unknown as { action_plan?: string }).action_plan} area fixed />
                <Field label="需要的支持" value={(d as unknown as { support_needed?: string }).support_needed} area fixed />
              </div>
              <div className="grid-1" style={{ marginTop: 10 }}>
                <Field label="备注" value={d.note} area fixed />
              </div>
            </div>

            {histName && <PriceHistoryModal name={histName} info={(() => { const pr = products.find((x) => x.name === histName); return pr ? { last_amount: pr.last_amount, currency: pr.currency, last_qty: pr.last_qty, use_count: pr.use_count } : undefined })()} onClose={() => setHistName(null)} />}

            {/* 跟进记录（与「询报价跟进」联动） */}
            <div style={{ marginTop: 12, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700 }}>跟进记录</span>
                <span className="badge">{fuLoaded ? `${fus.length} 条` : '加载中…'}</span>
                <span className="hint">来自「询报价跟进」页：按销售 + 询价号录入的记录会实时显示在这里</span>
              </div>
              {fus.length > 0 ? (
                <div className="tablewrap" style={{ marginTop: 8 }}>
                  <table className="grid data-table fixed-table" style={{ fontSize: 12.5 }}>
                    <colgroup>
                      <col style={{ width: '8%' }} /><col style={{ width: '6%' }} /><col style={{ width: '12%' }} /><col style={{ width: '20%' }} /><col style={{ width: '7%' }} />
                      <col style={{ width: '9%' }} /><col style={{ width: '16%' }} /><col style={{ width: '10%' }} /><col style={{ width: '6%' }} /><col style={{ width: '6%' }} />
                    </colgroup>
                    <thead><tr>{['跟进日期', '方式', '简述', '具体内容', '图片', '附件', '跟进指导', '下次跟进', '跟进人', '录入时间'].map((h) => <th key={h} style={{ textAlign: 'left' }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {fus.map((f) => (
                        <tr key={f.id}>
                          <td className="mono" title={f.date}>{f.date}</td>
                          <td title={f.method || '—'}>{f.method || '—'}</td>
                          <td title={f.summary || '—'}>{f.summary || '—'}</td>
                          <td title={f.detail || '—'}>{f.detail || '—'}</td>
                          <td title={(f.photos || []).length ? `${(f.photos || []).length} 张图片` : '—'}>
                            {(f.photos || []).length === 0 ? '—' : (
                              <span style={{ display: 'inline-flex', gap: 4 }}>
                                {(f.photos || []).map((u) => (
                                  <a key={u} href={u} target="_blank" rel="noreferrer" title="点击查看原图">
                                    <img src={u} alt="跟进图片" style={{ height: 26, width: 34, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--line)' }} />
                                  </a>
                                ))}
                              </span>
                            )}
                          </td>
                          <td title={(f.attachments || []).map((a) => a.name || '附件').join('、') || '—'}>
                            {(f.attachments || []).length === 0 ? '—' : (f.attachments || []).map((a) => (
                              <a key={a.url} className="mono" href={a.url} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}>{a.name || '附件'}</a>
                            ))}
                          </td>
                          {/* 跟进指导：此处只读查看，醒目标注；新增/追加在「询报价跟进」页 */}
                          <td title={(f.comments ?? []).map((c) => `${c.by_name || '—'}：${c.content}`).join('\n') || '暂无指导'}>
                            {(f.comments ?? []).length === 0 ? <span className="hint">—</span> : <GuidanceNote compact comments={f.comments} />}
                          </td>
                          <td className="mono" title={f.next_followup_at || '未设置下次跟进'}>{f.next_followup_at ? String(f.next_followup_at).replace('T', ' ') : '—'}</td>
                          <td title={f.by_name || '—'}>{f.by_name || '—'}</td>
                          <td className="mono hint" title={String(f.created_at || '').slice(0, 19).replace('T', ' ')}>{String(f.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="hint" style={{ marginTop: 6 }}>{fuLoaded ? '该询价暂无跟进记录（可到「询报价跟进」页按销售 + 询价号录入）' : '加载中…'}</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

