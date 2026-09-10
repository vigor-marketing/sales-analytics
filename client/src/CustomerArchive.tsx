import { useCallback, useEffect, useState } from 'react'
import { get } from './api'
import { StatusChip } from './StatusChip'
import InquiryDetailModal from './InquiryDetail'

interface CustRow { id: string; name: string; country: string | null; use_location: string | null; source: string | null; inquiryCount: number; lastDate: string | null; usdTotal: number; wonCount: number; lostCount: number; winRate: number; keyCustomer: number; keyProjectCount: number; stars?: number | null }
interface InqRow { id: string; inquiry_no: string; date: string; sales: string; purchaser: string; source: string; is_key_customer: number; is_key_project: number; is_won: number; status?: 'won' | 'lost' | 'following'; lost_reason?: string | null; lost_date?: string | null; totals: { currency: string; total: number }[]; usdApprox: number; itemCount: number }
interface CustDetail extends CustRow { inquiries: InqRow[]; summary: { inquiryCount: number; usdTotal: number; wonCount: number; lostCount: number; winRate: number; wonUsd: number; keyProjectCount: number } }

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
function Tags({ kc, kp, won }: { kc?: number; kp?: number; won?: number }) {
  const a = Number(kc) === 1, b = Number(kp) > 0, w = Number(won) === 1
  if (!a && !b && !w) return <span className="hint">—</span>
  return <>{w && <span className="tag won">已成单</span>}{a && <span className="tag kc">重点客户</span>}{b && <span className="tag kp">重点项目{kp && kp > 1 ? ` ×${kp}` : ''}</span>}</>
}

export default function CustomerArchive({ initialQuery }: { initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery ?? '')
  const [rows, setRows] = useState<CustRow[]>([])
  const [msg, setMsg] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  useEffect(() => { if (initialQuery !== undefined) setQ(initialQuery) }, [initialQuery])
  const load = useCallback(async () => {
    try { setRows(await get<CustRow[]>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`)) }
    catch (e) { setMsg((e as Error).message) }
  }, [q])
  useEffect(() => { void load() }, [load])
  const totals = rows.reduce((s, r) => ({ n: s.n + r.inquiryCount, usd: s.usd + r.usdTotal }), { n: 0, usd: 0 })
  return (
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
      <div className="tablewrap" style={{ overflow: 'auto', maxHeight: '62vh' }}>
        <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr>{['客户名称', '国别', '星级', '标签', '询价数', '已成单', '未成单', '累计金额(USD)', '成交率', '操作'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--line2)' }}>
                <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: '6px 8px' }}>{r.country || '—'}</td>
                <td style={{ padding: '6px 8px', color: '#e3a008', fontWeight: 700, whiteSpace: 'nowrap' }} title={r.stars ? `${r.stars} 星` : ''}>{r.stars ? '★'.repeat(Number(r.stars)) : '—'}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}><Tags kc={r.keyCustomer} kp={r.keyProjectCount} /></td>
                <td style={{ padding: '6px 8px' }}>{r.inquiryCount}</td>
                <td style={{ padding: '6px 8px', color: '#059669', fontWeight: 700 }}>{r.wonCount ?? 0}</td>
                <td style={{ padding: '6px 8px', color: (r.lostCount ?? 0) > 0 ? '#dc2626' : 'var(--sub)', fontWeight: 700 }}>{r.lostCount ?? 0}</td>
                <td style={{ padding: '6px 8px' }} className="mono">{money(r.usdTotal)}</td>
                <td style={{ padding: '6px 8px', fontWeight: 700, color: r.winRate >= 50 ? '#059669' : r.winRate > 0 ? '#a35c00' : 'var(--sub)' }}>{r.winRate}%</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => setDetailId(r.id)}>查看</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--sub)' }}>暂无客户档案（先到「询报价录入」录一单，即自动建档）</td></tr>}
          </tbody>
        </table>
      </div>
      {detailId && <CustDetailModal id={detailId} onClose={() => setDetailId(null)} />}
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
      <div className="modal" style={{ width: 'min(880px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="客户档案">
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
              <span>标签 <b><Tags kc={d.keyCustomer} kp={d.keyProjectCount} /></b></span>
              <span>询价 <b>{d.summary?.inquiryCount ?? 0}</b> 条</span><span>累计金额 <b>≈USD {money(d.summary?.usdTotal)}</b></span>
              <span>已成单 <b>{d.summary?.wonCount ?? 0}</b> 条（{money(d.summary?.wonUsd)} USD）</span><span>未成单 <b style={{ color: '#dc2626' }}>{d.summary?.lostCount ?? 0}</b> 条</span><span>成交率 <b style={{ color: '#059669' }}>{d.summary?.winRate ?? 0}%</b>（成交÷已成单+未成单）</span>
              <span>建档时间 <b className="mono">{((d as unknown as { created_at?: string }).created_at ?? '').slice(0, 16)}</b></span>
            </div>
            <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['询价号', '日期', '销售', '采购', '来源', '状态', '丢单原因', '标签', '行数', '报价合计', '折USD'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>
                {(d.inquiries ?? []).map((i) => (
                  <tr key={i.id} style={{ borderBottom: '1px solid var(--line2)' }}>
                    <td style={{ padding: 6 }} className="mono"><button className="btn sm" onClick={() => setDetailInquiryId(i.id)} title="查看询价详情">{i.inquiry_no}</button></td>
                    <td style={{ padding: 6 }}>{i.date}</td>
                    <td style={{ padding: 6 }}>{i.sales}</td>
                    <td style={{ padding: 6 }}>{i.purchaser}</td>
                    <td style={{ padding: 6 }}>{i.source}</td>
                    <td style={{ padding: 6, whiteSpace: 'nowrap' }}><StatusChip status={i.status ?? (Number(i.is_won) === 1 ? 'won' : 'following')} /></td>
                    <td style={{ padding: 6 }}>{i.lost_reason || '—'}{i.lost_date ? <span className="hint">（{i.lost_date}）</span> : null}</td>
                    <td style={{ padding: 6, whiteSpace: 'nowrap' }}><Tags kc={i.is_key_customer} kp={i.is_key_project} /></td>
                    <td style={{ padding: 6 }}>{i.itemCount}</td>
                    <td style={{ padding: 6 }}>{(i.totals || []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'}</td>
                    <td style={{ padding: 6 }} className="mono">{money(i.usdApprox)}</td>
                  </tr>
                ))}
                {(d.inquiries ?? []).length === 0 && <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', color: 'var(--sub)' }}>该客户暂无询价</td></tr>}
              </tbody>
            </table>
          </>
        )}
      </div>
      {detailInquiryId && <InquiryDetailModal id={detailInquiryId} onClose={() => setDetailInquiryId(null)} />}
    </div>
  )
}

interface InquiryDetail extends InqRow { country?: string | null; use_location?: string | null; hand_total?: number | null; note?: string | null; blockers?: string | null; action_plan?: string | null; support_needed?: string | null; items?: { product_name: string; qty: number | null; amount: number; currency: string }[] }

