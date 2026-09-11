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
        <table className="grid data-table fixed-table fit-table" style={{ fontSize: 12.5 }}>
          <colgroup>
            <col style={{ width: '19%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '12%' }} /><col style={{ width: '7%' }} />
            <col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '13%' }} /><col style={{ width: '8%' }} /><col style={{ width: '9%' }} />
          </colgroup>
          <thead><tr>{['客户名称', '国别', '星级', '是否重点客户', '询价数', '已成单', '未成单', '累计金额(USD)', '成交率', '操作'].map((h) => <th key={h} title={h === '是否重点客户' ? '客户级别标签；每条询价是否为重点询价、是否成交，请点「查看」' : undefined}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td title={r.name}>
                  <div className="cust-name">{r.name}</div>
                  {Number(r.keyCustomer) === 1 && <span className="tag kc" style={{ marginTop: 2, display: 'inline-block' }}>重点客户</span>}
                </td>
                <td title={r.country || '—'}>{r.country || '—'}</td>
                <td title={r.stars ? `${r.stars} 星` : '未评级'}>{r.stars ? <span className="cust-stars sm">{'★'.repeat(Number(r.stars))}</span> : <span className="hint">—</span>}</td>
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

/** 只读键值行：标签固定宽度在左，值加粗在右（便于快速扫读） */
function Kv({ k, v, mono, strong }: { k: string; v: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="kv-row">
      <span className="kv-k">{k}</span>
      <span className={'kv-v' + (mono ? ' mono' : '')} style={strong ? { fontWeight: 700 } : undefined}>{v}</span>
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
        {/* 头部：客户名 + 关键标签（重点客户 / 星级）一眼可见 */}
        <div className="ov-head">
          <div>
            <h3 style={{ margin: 0 }}>客户档案 · {d?.name ?? '加载中…'}</h3>
            {d && (
              <div className="hint" style={{ marginTop: 2 }}>
                {d.country || '国别未填'} · 使用地 {d.use_location || '—'} · 来源 {d.source || '—'} · 建档 {(((d as unknown as { created_at?: string }).created_at ?? '').slice(0, 16) || '—')}
              </div>
            )}
          </div>
          <span style={{ flex: 1 }} />
          {d && (Number(d.stars) > 0 ? <span className="cust-stars" title={`客户星级 ${d.stars} 星`}>{'★'.repeat(Number(d.stars))}<i>{d.stars} 星</i></span> : <span className="hint">未评级</span>)}
          {d && <Tags kc={d.keyCustomer} />}
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        {err && <div className="msg err">{err}</div>}
        {d && (
          <>
            {/* 关键数据一眼可见 */}
            <div className="ov-kpis">
              <div className="ov-kpi">
                <span className="ov-kpi-label">累计金额（折 USD）</span>
                <b className="ov-kpi-value">≈USD {money(d.summary?.usdTotal)}</b>
                <span className="ov-kpi-note">共 {d.summary?.inquiryCount ?? 0} 条询价{d.summary?.keyProjectCount ? ` · 其中重点询价 ${d.summary.keyProjectCount} 条` : ''}</span>
              </div>
              <div className="ov-kpi">
                <span className="ov-kpi-label">已成单</span>
                <b className="ov-kpi-value" style={{ color: '#059669' }}>{d.summary?.wonCount ?? 0} <small style={{ fontSize: 12, fontWeight: 600 }}>单</small></b>
                <span className="ov-kpi-note">成交金额 {money(d.summary?.wonUsd)} USD</span>
              </div>
              <div className="ov-kpi">
                <span className="ov-kpi-label">未成单</span>
                <b className="ov-kpi-value" style={{ color: (d.summary?.lostCount ?? 0) > 0 ? 'var(--danger)' : 'var(--sub)' }}>{d.summary?.lostCount ?? 0} <small style={{ fontSize: 12, fontWeight: 600 }}>单</small></b>
                <span className="ov-kpi-note">{d.summary?.lostCount ? '丢单原因见下方询价列表' : '暂无丢单'}</span>
              </div>
              <div className="ov-kpi">
                <span className="ov-kpi-label">成交率</span>
                <b className="ov-kpi-value" style={{ color: (d.summary?.winRate ?? 0) >= 50 ? '#059669' : (d.summary?.winRate ?? 0) > 0 ? '#a35c00' : 'var(--sub)' }}>{d.summary?.winRate ?? 0}%</b>
                <span className="ov-kpi-note">成交 ÷（成交＋未成单）</span>
              </div>
            </div>

            {/* 基础信息：左标签固定宽度、右值加粗，逐行对齐 */}
            <section className="ov-sec">
              <h4 className="ov-sec-title">基础信息</h4>
              <div className="kv">
                <Kv k="客户名称" v={d.name} strong />
                <Kv k="是否重点客户" v={Number(d.keyCustomer) === 1 ? '重点客户' : '非重点客户'} strong={Number(d.keyCustomer) === 1} />
                <Kv k="客户星级" v={Number(d.stars) > 0 ? `${'★'.repeat(Number(d.stars))}（${d.stars} 星）` : '未评级'} />
                <Kv k="国别" v={d.country || '—'} />
                <Kv k="使用地" v={d.use_location || '—'} />
                <Kv k="询价来源" v={d.source || '—'} />
                <Kv k="询价条数" v={`${d.summary?.inquiryCount ?? 0} 条`} />
                <Kv k="重点询价" v={`${d.summary?.keyProjectCount ?? 0} 条`} />
                <Kv k="最近询价日期" v={(d as unknown as { lastDate?: string | null }).lastDate || d.inquiries?.[0]?.date || '—'} mono />
                <Kv k="建档时间" v={(((d as unknown as { created_at?: string }).created_at ?? '').slice(0, 19).replace('T', ' ') || '—')} mono />
              </div>
            </section>
            {/* 询价列表：窄窗口时在弹窗内横向滚动，列宽始终够用（不再截断） */}
            <section className="ov-sec">
            <h4 className="ov-sec-title">该客户的询价<span className="hint">（{d.inquiries?.length ?? 0} 条；点询价号看详情）</span></h4>
            <div className="tablewrap" style={{ maxHeight: '52vh' }}>
            <table className="grid data-table fixed-table fit-table" style={{ fontSize: 12.5 }}>
              <colgroup>
                <col style={{ width: '10%' }} /><col style={{ width: '8%' }} /><col style={{ width: '7%' }} /><col style={{ width: '7%' }} /><col style={{ width: '7%' }} />
                <col style={{ width: '8%' }} /><col style={{ width: '16%' }} /><col style={{ width: '9%' }} /><col style={{ width: '5%' }} /><col style={{ width: '16%' }} /><col style={{ width: '7%' }} />
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
            </section>
          </>
        )}
        <div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div>
      </div>
      {detailInquiryId && <InquiryDetailModal id={detailInquiryId} onClose={() => setDetailInquiryId(null)} />}
    </div>
  )
}

interface InquiryDetail extends InqRow { country?: string | null; use_location?: string | null; hand_total?: number | null; note?: string | null; blockers?: string | null; action_plan?: string | null; support_needed?: string | null; items?: { product_name: string; qty: number | null; amount: number; currency: string }[] }

