import { useCallback, useEffect, useState } from 'react'
import { get, post } from './api'

interface MetaLite { sales: { name: string; team: string }[] }
interface Lookup {
  id: string; inquiry_no: string; date: string; customer_name: string; country: string | null; use_location: string | null
  sales: string; purchaser: string; source: string; is_won: number; won_date?: string | null; orderNo?: string | null
  productNames: string; usdApprox: number; totals: { currency: string; total: number }[]; itemCount?: number
  last_followup_at?: string | null; next_followup_at?: string | null; items: { product_name: string; qty: number | null; amount: number; currency: string }[]
}
interface Fu { id: string; inquiry_id: string; inquiry_no: string; customer_name: string; sales: string; date: string; method: string; content: string | null; next_followup_at: string | null; by_name: string | null; created_at: string }

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
const METHODS = ['电话', '邮件', '微信', '拜访', '展会', '其他']
const today = () => new Date().toISOString().slice(0, 10)

export default function FollowUps({ meta }: { meta: MetaLite }) {
  const [sales, setSales] = useState('')
  const [no, setNo] = useState('')
  const [hit, setHit] = useState<Lookup | null>(null)
  const [lookErr, setLookErr] = useState('')
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; text: string } | null>(null)
  const [f, setF] = useState({ date: today(), method: '电话', content: '', nextFollowupAt: '', byName: '' })
  const [list, setList] = useState<Fu[]>([])
  const [busy, setBusy] = useState(false)

  const lookup = useCallback(async () => {
    setLookErr(''); setHit(null)
    if (!sales || !no.trim()) return
    try { setHit(await get<Lookup>(`/inquiries/lookup?sales=${encodeURIComponent(sales)}&no=${encodeURIComponent(no.trim())}`)) }
    catch (e) { setLookErr((e as Error).message) }
  }, [sales, no])
  useEffect(() => { const t = setTimeout(() => { void lookup() }, 400); return () => clearTimeout(t) }, [lookup])

  const loadList = useCallback(async () => {
    try { setList(await get<Fu[]>(`/followups?sales=${encodeURIComponent(sales)}${hit ? `&inquiryId=${encodeURIComponent(hit.id)}` : ''}`)) }
    catch { /* */ }
  }, [sales, hit])
  useEffect(() => { void loadList() }, [loadList])

  const submit = async () => {
    if (!hit) return setMsg({ t: 'err', text: '请先输入销售与询价号并带出询价信息' })
    if (!f.content.trim()) return setMsg({ t: 'err', text: '请填写跟进内容' })
    setBusy(true); setMsg(null)
    try {
      await post('/followups', { inquiryId: hit.id, date: f.date, method: f.method, content: f.content, nextFollowupAt: f.nextFollowupAt || undefined, byName: f.byName || sales })
      setMsg({ t: 'ok', text: `已建立跟进（${hit.inquiry_no}）` })
      setF({ date: today(), method: '电话', content: '', nextFollowupAt: '', byName: '' })
      await lookup(); await loadList()
    } catch (e) { setMsg({ t: 'err', text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>询报价跟进</h3>
        <span className="hint">按「销售人员 + 询价号」自动带出询价信息，随后建立跟进记录</span>
      </div>
      {msg && <div className={`msg ${msg.t}`}>{msg.t === 'ok' ? '✔' : '✖'} {msg.text}</div>}

      <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
        <div className="col w2"><label>销售人员 *</label>
          <select className="sa" style={{ width: 200 }} value={sales} onChange={(e) => { setSales(e.target.value); setHit(null) }}>
            <option value="">— 请选择 —</option>
            {meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div className="col w2"><label>询价号 *</label><input className="sa" style={{ width: 200 }} value={no} onChange={(e) => setNo(e.target.value)} placeholder="如 INQ-2026-001" /></div>
        <button className="btn" onClick={() => void lookup()}>带出询价信息</button>
        {lookErr && <span className="hint" style={{ color: 'var(--danger)', alignSelf: 'center' }}>{lookErr}</span>}
      </div>

      {hit && (
        <div style={{ marginTop: 10, border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', background: '#fbfcff' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 13 }}>
            <span>询价号 <b className="mono">{hit.inquiry_no}</b></span>
            <span>客户 <b>{hit.customer_name}</b></span>
            <span>国别 <b>{hit.country || '—'}</b></span>
            <span>使用地 <b>{hit.use_location || '—'}</b></span>
            <span>销售 <b>{hit.sales}</b></span>
            <span>采购 <b>{hit.purchaser}</b></span>
            <span>来源 <b>{hit.source}</b></span>
            <span>询价日期 <b className="mono">{hit.date}</b></span>
            <span>报价合计 <b>{(hit.totals || []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'}</b>（≈USD {money(hit.usdApprox)}）</span>
            <span>状态 <b>{Number(hit.is_won) === 1 ? <span className="tag won">已成单</span> : <span className="badge">跟进中</span>}</b></span>
            <span>最近跟进 <b className="mono">{hit.last_followup_at || '—'}</b></span>
            <span>下次跟进 <b className="mono">{hit.next_followup_at || '—'}</b></span>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>产品：{hit.productNames || '—'}</div>
        </div>
      )}

      {hit && (
        <div style={{ marginTop: 12, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>建立跟进</div>
          <div className="row">
            <div className="col w1"><label>跟进日期 *</label><input className="sa" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div className="col w1"><label>跟进方式</label><select className="sa" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
            <div className="col w1"><label>下次跟进</label><input className="sa" type="date" value={f.nextFollowupAt} onChange={(e) => setF({ ...f, nextFollowupAt: e.target.value })} /></div>
            <div className="col w2"><label>跟进人</label><select className="sa" style={{ width: 180 }} value={f.byName || sales} onChange={(e) => setF({ ...f, byName: e.target.value })}>{meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select></div>
          </div>
          <div className="col box-fixed" style={{ maxWidth: 720 }}><label>跟进内容 *</label><textarea className="sa" value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} placeholder="沟通要点、客户反馈、下一步安排…" /></div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button className="btn pri" disabled={busy} onClick={() => void submit()}>建立跟进{busy ? '…' : ''}</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>跟进记录{hit ? `（本询价 ${list.length} 条）` : sales ? `（${sales} 名下 ${list.length} 条）` : ''}</div>
        <div className="tablewrap" style={{ overflow: 'auto', maxHeight: '42vh' }}>
          <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['跟进日期', '询价号', '客户', '销售', '方式', '跟进内容', '下次跟进', '跟进人'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--line2)' }}>
                  <td style={{ padding: '6px 8px' }} className="mono">{r.date}</td>
                  <td style={{ padding: '6px 8px' }} className="mono">{r.inquiry_no}</td>
                  <td style={{ padding: '6px 8px' }}>{r.customer_name}</td>
                  <td style={{ padding: '6px 8px' }}>{r.sales}</td>
                  <td style={{ padding: '6px 8px' }}>{r.method}</td>
                  <td style={{ padding: '6px 8px', maxWidth: 420 }}>{r.content || '—'}</td>
                  <td style={{ padding: '6px 8px' }} className="mono">{r.next_followup_at || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{r.by_name || '—'}</td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--sub)' }}>暂无跟进记录</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
