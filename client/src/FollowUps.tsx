import { useCallback, useEffect, useRef, useState } from 'react'
import { get, post } from './api'
import { StatusChip } from './StatusChip'

interface MetaLite { sales: { name: string; team: string }[]; methods?: string[] }
interface Lookup {
  id: string; inquiry_no: string; date: string; customer_name: string; country: string | null; use_location: string | null
  sales: string; purchaser: string; source: string; is_won: number; won_date?: string | null; orderNo?: string | null
  productNames: string; usdApprox: number; totals: { currency: string; total: number }[]; itemCount?: number
  last_followup_at?: string | null; next_followup_at?: string | null; status?: 'won' | 'lost' | 'following'; items: { product_name: string; qty: number | null; amount: number; currency: string }[]
}
interface Att { url: string; name: string }
interface Fu {
  id: string; inquiry_id: string; inquiry_no: string; customer_name: string; sales: string; date: string
  method: string; content: string | null; summary: string | null; detail: string | null
  photos: string[]; attachments: Att[]; next_followup_at: string | null; by_name: string | null; created_at: string
}

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
const DEFAULT_METHODS = ['电话', '邮件', '微信', '拜访', '展会', '其他']
const today = () => new Date().toISOString().slice(0, 10)

export default function FollowUps({ meta }: { meta: MetaLite }) {
  const methods = meta.methods?.length ? meta.methods : DEFAULT_METHODS
  const [sales, setSales] = useState('')
  const [no, setNo] = useState('')
  const [hit, setHit] = useState<Lookup | null>(null)
  const [lookErr, setLookErr] = useState('')
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; text: string } | null>(null)
  const [f, setF] = useState({ date: today(), method: methods[0] ?? '电话', summary: '', detail: '', nextFollowupAt: '', byName: '' })
  const [photos, setPhotos] = useState<string[]>([])
  const [files, setFiles] = useState<Att[]>([])
  const [uploading, setUploading] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [list, setList] = useState<Fu[]>([])
  const [options, setOptions] = useState<{ id: string; inquiry_no: string; customer_name: string; date: string }[]>([])
  const [optLoading, setOptLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setNo(''); setHit(null); setLookErr('')
    if (!sales) { setOptions([]); return }
    setOptLoading(true)
    get<{ id: string; inquiry_no: string; customer_name: string; date: string }[] | { rows: { id: string; inquiry_no: string; customer_name: string; date: string }[] }>(`/inquiries?sales=${encodeURIComponent(sales)}`)
      .then((d) => setOptions(Array.isArray(d) ? d : (d?.rows ?? [])))
      .catch(() => setOptions([]))
      .finally(() => setOptLoading(false))
  }, [sales])

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

  const upload = async (files2: FileList | null, kind: 'photo' | 'file') => {
    if (!files2?.length) return
    setUploading(true); setMsg(null)
    try {
      for (const file of Array.from(files2)) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('读取文件失败'))
          r.readAsDataURL(file)
        })
        const res = await post<{ url: string; name: string }>('/uploads', { name: file.name, dataUrl })
        if (kind === 'photo') setPhotos((a) => [...a, res.url])
        else setFiles((a) => [...a, { url: res.url, name: res.name }])
      }
    } catch (e) { setMsg({ t: 'err', text: (e as Error).message }) } finally { setUploading(false) }
  }

  const submit = async () => {
    if (!hit) return setMsg({ t: 'err', text: '请先按“销售 + 询价号”带出询价信息' })
    if (!f.summary.trim() && !f.detail.trim()) return setMsg({ t: 'err', text: '请填写跟进简述或具体跟进内容' })
    setBusy(true); setMsg(null)
    try {
      await post('/followups', {
        inquiryId: hit.id, date: f.date, method: f.method, summary: f.summary, detail: f.detail,
        photos, attachments: files, nextFollowupAt: f.nextFollowupAt || undefined, byName: f.byName || sales,
      })
      setMsg({ t: 'ok', text: `已建立跟进（${hit.inquiry_no}）` })
      setF({ date: today(), method: methods[0] ?? '电话', summary: '', detail: '', nextFollowupAt: '', byName: '' })
      setPhotos([]); setFiles([])
      await lookup(); await loadList()
    } catch (e) { setMsg({ t: 'err', text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>询报价跟进</h3>
        <span className="hint">按「销售人员 + 询价号」逐级筛选并自动带出询价信息，随后建立详细跟进记录</span>
      </div>
      {msg && <div className={`msg ${msg.t}`}>{msg.t === 'ok' ? '✔' : '✖'} {msg.text}</div>}

      <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
        <div className="col w2"><label>销售人员 *</label>
          <select className="sa" style={{ width: 200 }} value={sales} onChange={(e) => setSales(e.target.value)}>
            <option value="">— 请选择 —</option>
            {meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div className="col" style={{ flex: 1, minWidth: 340, maxWidth: 620 }}>
          <label>询价号 * <span className="hint">（先选销售，再选该销售名下询价）</span></label>
          <select className="sa" style={{ width: '100%' }} value={no} disabled={!sales || optLoading} title={no || ''} onChange={(e) => setNo(e.target.value)}>
            <option value="">{!sales ? '— 请先选择销售人员 —' : optLoading ? '加载中…' : options.length ? '— 请选择询价号 —' : '该销售名下暂无询价'}</option>
            {options.map((o) => <option key={o.id} value={o.inquiry_no}>{o.inquiry_no} · {o.customer_name}（{o.date}）</option>)}
          </select>
        </div>
        {lookErr && <span className="hint" style={{ color: 'var(--danger)', alignSelf: 'center' }}>{lookErr}</span>}
      </div>

      {hit && (
        <div style={{ marginTop: 10, border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', background: '#fbfcff' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 13 }}>
            <span>询价号 <b className="mono">{hit.inquiry_no}</b></span>
            <span>客户 <b>{hit.customer_name}</b></span>
            <span>国别 <b>{hit.country || '—'}</b></span>
            <span>销售 <b>{hit.sales}</b></span>
            <span>采购 <b>{hit.purchaser}</b></span>
            <span>来源 <b>{hit.source}</b></span>
            <span>询价日期 <b className="mono">{hit.date}</b></span>
            <span>报价合计 <b>{(hit.totals || []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'}</b>（≈USD {money(hit.usdApprox)}）</span>
            <span>状态 <b><StatusChip status={hit.status ?? (Number(hit.is_won) === 1 ? 'won' : 'following')} /></b></span>
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
            <div className="col w2"><label>跟进方式 *</label>
              <select className="sa" style={{ width: 180 }} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
                {methods.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="col w2"><label>下次跟进时间</label><input className="sa" type="datetime-local" value={f.nextFollowupAt} onChange={(e) => setF({ ...f, nextFollowupAt: e.target.value })} /></div>
            <div className="col w2"><label>跟进人</label>
              <select className="sa" style={{ width: 180 }} value={f.byName || sales} onChange={(e) => setF({ ...f, byName: e.target.value })}>
                {meta.sales.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="col grow1"><label>跟进简述</label><input className="sa" style={{ width: '100%' }} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="一句话概括本次跟进（如：确认技术规格并催 PO）" /></div>
          </div>
          <div className="col box-fixed" style={{ maxWidth: 860 }}><label>具体跟进内容</label><textarea className="sa" rows={4} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} placeholder="详细沟通内容、客户反馈、异议与应对、下一步计划…" /></div>

          <div className="row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
            <div className="col" style={{ flex: 1, minWidth: 280 }}>
              <label>图片/照片</label>
              <input ref={photoInput} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { void upload(e.target.files, 'photo'); e.target.value = '' }} />
              <button className="btn sm" disabled={uploading} onClick={() => photoInput.current?.click()}>＋ 上传图片</button>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                {photos.map((p) => (
                  <span key={p} style={{ position: 'relative' }}>
                    <img src={p} alt="照片" style={{ width: 84, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
                    <button className="icon-del" style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, fontSize: 13 }} title="移除" onClick={() => setPhotos((a) => a.filter((x) => x !== p))}>×</button>
                  </span>
                ))}
                {photos.length === 0 && <span className="hint">未上传</span>}
              </div>
            </div>
            <div className="col" style={{ flex: 1, minWidth: 280 }}>
              <label>附件</label>
              <input ref={fileInput} type="file" multiple style={{ display: 'none' }} onChange={(e) => { void upload(e.target.files, 'file'); e.target.value = '' }} />
              <button className="btn sm" disabled={uploading} onClick={() => fileInput.current?.click()}>＋ 上传附件</button>
              <div style={{ marginTop: 6 }}>
                {files.map((x) => (
                  <div key={x.url} className="row" style={{ marginBottom: 4 }}>
                    <a className="mono" href={x.url} target="_blank" rel="noreferrer" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</a>
                    <button className="btn sm danger" onClick={() => setFiles((a) => a.filter((y) => y.url !== x.url))}>移除</button>
                  </div>
                ))}
                {files.length === 0 && <span className="hint">未上传</span>}
              </div>
            </div>
          </div>

          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn pri" disabled={busy || uploading} onClick={() => void submit()}>建立跟进{busy ? '…' : ''}</button>
            {uploading && <span className="hint">文件上传中…</span>}
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>跟进记录{hit ? `（本询价 ${list.length} 条）` : sales ? `（${sales} 名下 ${list.length} 条）` : ''}</div>
        <div className="tablewrap" style={{ overflowX: 'auto' }}>
          <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['跟进日期', '询价号', '客户', '销售', '方式', '简述', '具体内容', '图片', '附件', '下次跟进', '跟进人'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--line2)' }}>
                  <td style={{ padding: '6px 8px' }} className="mono">{r.date}</td>
                  <td style={{ padding: '6px 8px' }} className="mono">{r.inquiry_no}</td>
                  <td style={{ padding: '6px 8px' }}>{r.customer_name}</td>
                  <td style={{ padding: '6px 8px' }}>{r.sales}</td>
                  <td style={{ padding: '6px 8px' }}>{r.method}</td>
                  <td style={{ padding: '6px 8px', minWidth: 160 }}>{r.summary || '—'}</td>
                  <td style={{ padding: '6px 8px', minWidth: 240, whiteSpace: 'pre-wrap' }}>{r.detail || r.content || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{(r.photos || []).length ? (r.photos || []).map((p) => <a key={p} href={p} target="_blank" rel="noreferrer"><img src={p} alt="图" style={{ width: 40, height: 32, objectFit: 'cover', borderRadius: 4, marginRight: 4, border: '1px solid var(--line)' }} /></a>) : '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{(r.attachments || []).length ? (r.attachments || []).map((a) => <a key={a.url} className="mono" href={a.url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>{a.name}</a>) : '—'}</td>
                  <td style={{ padding: '6px 8px' }} className="mono">{r.next_followup_at || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{r.by_name || '—'}</td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', padding: 20, color: 'var(--sub)' }}>暂无跟进记录</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
