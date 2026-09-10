import { useCallback, useEffect, useState } from 'react'
import { get } from './api'
import { StatusChip } from './StatusChip'
import InquiryDetailModal from './InquiryDetail'

interface CustRow { id: string; name: string; country: string | null; use_location: string | null; source: string | null; inquiryCount: number; lastDate: string | null; usdTotal: number; wonCount: number; lostCount: number; winRate: number; keyCustomer: number; keyProjectCount: number; stars?: number | null }
interface InqRow { id: string; inquiry_no: string; date: string; sales: string; purchaser: string; source: string; is_key_customer: number; is_key_project: number; is_won: number; status?: 'won' | 'lost' | 'following'; lost_reason?: string | null; lost_date?: string | null; totals: { currency: string; total: number }[]; usdApprox: number; itemCount: number }
interface CustDetail extends CustRow { inquiries: InqRow[]; summary: { inquiryCount: number; usdTotal: number; wonCount: number; lostCount: number; winRate: number; wonUsd: number; keyProjectCount: number } }

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
/**
 * 客户级别只有「是否重点客户」一个标签：
 * 询价级别的「是否为重点询价」「是否成交」在「查看」弹窗的询价列表里看。
 */
function Tags({ kc }: { kc?: number }) {
  return Number(kc) === 1 ? <span className="tag kc">重点客户</span> : <span className="hint">非重点客户</span>
}

export default function CustomerArchive({ initialQuery }: { initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery ?? '')
  const [rows, setRows] = useState<CustRow[]>([])
  const [msg, setMsg] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  useEffect(() => { if (initialQuery !== undefined) setQ(initialQuery) }, [initialQuery])
  const load = useCallback(async () => {
    try { setRows(await get<CustRow[]>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`)); setMsg('') }
    catch (e) { setMsg((e as Error).message) }
  }, [q])
  useEffect(() => { void load() }, [load])
  const totals = rows.reduce((s, r) => ({ n: s.n + r.inquiryCount, usd: s.usd + r.usdTotal }), { n: 0, usd: 0 })
  return (
    <div className="page-fit">
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>客户档案</h3>
        <span className="hint">录入询价时填写的客户名称/国别/使用地/来源会自动建档，并在此与询价联动查看</span>
        <span style={{ flex: 1 }} />
        <input className="sa" style={{ width: 220 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索客户名称/国别" />
        <button className="btn" onClick={() => void load()}>查询</button>
      </div>
      {msg && <div className="msg err">{msg}</div>}
      <div className="hint" style={{ margin: '8px 0' }}>共 {rows.length} 个客户 · 询价 {totals.n} 条 · 累计折USD ≈ {money(totals.usd)}</div>
      <div className="tablewrap">
        <table className="grid data-table fixed-table" style={{ fontSize: 12.5, minWidth: 1220 }}>
          <colgroup>
            <col style={{ width: 210 }} /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 130 }} /><col style={{ width: 80 }} />
            <col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 140 }} /><col style={{ width: 90 }} /><col style={{ width: 100 }} />
          </colgroup>
          <thead><tr>{['客户名称', '国别', '星级', '是否重点客户', '询价数', '已成单', '未成单', '累计金额(USD)', '成交率', '操作'].map((h) => <th key={h} title={h === '是否重点客户' ? '客户级别标签；每条询价是否为重点询价、是否成交，请点「查看」' : undefined}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }} title={r.name}>{r.name}</td>
                <td title={r.country || '—'}>{r.country || '—'}</td>
                <td style={{ color: '#e3a008', fontWeight: 700 }} title={r.stars ? `${r.stars} 星` : '未评级'}>{r.stars ? '★'.repeat(Number(r.stars)) : '—'}</td>
                {/* 客户级别只标「是否重点客户」；询价级别的重点询价/是否成交在「查看」里看 */}
                <td title={Number(r.keyCustomer) === 1 ? '重点客户' : '非重点客户'}><Tags kc={r.keyCustomer} /></td>
                <td className="mono">{r.inquiryCount}</td>
                <td className="mono" style={{ color: '#059669', fontWeight: 700 }}>{r.wonCount ?? 0}</td>
                <td className="mono" style={{ color: (r.lostCount ?? 0) > 0 ? '#dc2626' : 'var(--sub)', fontWeight: 700 }}>{r.lostCount ?? 0}</td>
                <td className="mono" title={`累计折 USD ≈ ${money(r.usdTotal)}`}>{money(r.usdTotal)}</td>
                <td className="mono" style={{ fontWeight: 700, color: r.winRate >= 50 ? '#059669' : r.winRate > 0 ? '#a35c00' : 'var(--sub)' }}>{r.winRate}%</td>
                <td>
                  <button className="btn sm" onClick={() => setDetailId(r.id)}>查看</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} className="hint" style={{ textAlign: 'center' }}>暂无客户档案（先到「询报价录入」录一单，即自动建档）</td></tr>}
          </tbody>
        </table>
      </div>
      {detailId && <CustDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
    </div>
  )
}

function CustDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<CustDetail | null>(null)
  const [err, setErr] = useState('')
  const [detailInquiryId, setDetailInquiryId] = useState<string | null>(null)
  useEffect(() => { get<CustDetail>(`/customers/${id}`).then(setD).catch((e) => setErr((e as Error).message)) }, [id])
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal cust-modal" style={{ maxHeight: '90vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="客户档案">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>客户档案 · {d?.name ?? '加载中…'}</h3>
          <div className="actions" style={{ margin: 0 }}>
            <button className="btn sm" onClick={onClose}>关闭</button>
          </div>
        </div>
        {err && <div className="msg err">{err}</div>}
        {d && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', margin: '10px 0', fontSize: 13 }}>
              <span>国别 <b>{d.country || '—'}</b></span><span>使用地 <b>{d.use_location || '—'}</b></span><span>来源 <b>{d.source || '—'}</b></span>
              <span>是否重点客户 <b><Tags kc={d.keyCustomer} /></b></span>
              <span>重点询价 <b style={{ color: '#0052d9' }}>{d.summary?.keyProjectCount ?? 0}</b> 条</span>
              <span>询价 <b>{d.summary?.inquiryCount ?? 0}</b> 条</span><span>累计金额 <b>≈USD {money(d.summary?.usdTotal)}</b></span>
              <span>已成单 <b>{d.summary?.wonCount ?? 0}</b> 条（{money(d.summary?.wonUsd)} USD）</span><span>未成单 <b style={{ color: '#dc2626' }}>{d.summary?.lostCount ?? 0}</b> 条</span><span>成交率 <b style={{ color: '#059669' }}>{d.summary?.winRate ?? 0}%</b>（成交÷已成单+未成单）</span>
              <span>建档时间 <b className="mono">{((d as unknown as { created_at?: string }).created_at ?? '').slice(0, 16)}</b></span>
            </div>
            {/* 询价列表：窄窗口时在弹窗内横向滚动，列宽始终够用（不再截断） */}
            <div className="tablewrap" style={{ maxHeight: '52vh' }}>
            <table className="grid data-table fixed-table" style={{ fontSize: 12.5, minWidth: 1310 }}>
              <colgroup>
                <col style={{ width: 135 }} /><col style={{ width: 100 }} /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 90 }} />
                <col style={{ width: 100 }} /><col style={{ width: 210 }} /><col style={{ width: 120 }} /><col style={{ width: 70 }} /><col style={{ width: 200 }} /><col style={{ width: 100 }} />
              </colgroup>
              <thead><tr>{['询价号', '日期', '销售', '采购', '来源', '是否成交', '丢单原因', '是否重点询价', '行数', '报价合计', '折USD'].map((h) => <th key={h} style={{ textAlign: 'left' }}>{h}</th>)}</tr></thead>
              <tbody>
                {(d.inquiries ?? []).map((i) => (
                  <tr key={i.id}>
                    <td className="mono"><button className="btn sm" onClick={() => setDetailInquiryId(i.id)} title="查看询价详情">{i.inquiry_no}</button></td>
                    <td className="mono" title={i.date}>{i.date}</td>
                    <td title={i.sales || '—'}>{i.sales}</td>
                    <td title={i.purchaser || '—'}>{i.purchaser}</td>
                    <td title={i.source || '—'}>{i.source}</td>
                    <td><StatusChip status={i.status ?? (Number(i.is_won) === 1 ? 'won' : 'following')} /></td>
                    <td title={i.lost_reason ? `${i.lost_reason}${i.lost_date ? `（${i.lost_date}）` : ''}` : '—'}>{i.lost_reason || '—'}{i.lost_date ? <span className="cell-note">（{i.lost_date}）</span> : null}</td>
                    <td title={Number(i.is_key_project) === 1 ? '该询价已标记为重点询价' : '非重点询价'}>
                      {Number(i.is_key_project) === 1 ? <span className="tag kp">重点询价</span> : <span className="hint">—</span>}
                    </td>
                    <td className="mono" title={`${i.itemCount} 行明细`}>{i.itemCount}</td>
                    <td className="mono" title={(i.totals || []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'}>{(i.totals || []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'}</td>
                    <td className="mono" title={`折 USD ≈ ${money(i.usdApprox)}`}>{money(i.usdApprox)}</td>
                  </tr>
                ))}
                {(d.inquiries ?? []).length === 0 && <tr><td colSpan={11} className="hint" style={{ textAlign: 'center' }}>该客户暂无询价</td></tr>}
              </tbody>
            </table>
            </div>
          </>
        )}
        <div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div>
      </div>
      {detailInquiryId && <InquiryDetailModal id={detailInquiryId} onClose={() => setDetailInquiryId(null)} />}
    </div>
  )
}

interface InquiryDetail extends InqRow { country?: string | null; use_location?: string | null; hand_total?: number | null; note?: string | null; blockers?: string | null; action_plan?: string | null; support_needed?: string | null; items?: { product_name: string; qty: number | null; amount: number; currency: string }[] }

