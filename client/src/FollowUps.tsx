import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get, post } from './api'
import { StatusChip } from './StatusChip'
import { KeyTags } from './KeyTags'
import GuidanceNote from './Guidance'
import GuidanceModal from './GuidanceModal'
import InquiryFollowupsModal from './InquiryFollowupsModal'

interface MetaLite { sales: { name: string; team: string }[]; methods?: string[] }
interface Lookup {
  id: string; inquiry_no: string; date: string; customer_name: string; country: string | null; use_location: string | null
  sales: string; purchaser: string; source: string; is_won: number; won_date?: string | null; orderNo?: string | null
  productNames: string; usdApprox: number; totals: { currency: string; total: number }[]; itemCount?: number
  last_followup_at?: string | null; next_followup_at?: string | null; status?: 'won' | 'lost' | 'following'; is_key_customer?: number; is_key_project?: number; items: { product_name: string; qty: number | null; amount: number; currency: string }[]
}
interface Att { url: string; name: string; size?: number }
interface Fu {
  id: string; inquiry_id: string; inquiry_no: string; customer_name: string; sales: string; date: string
  method: string; content: string | null; summary: string | null; detail: string | null
  photos: string[]; attachments: Att[]; next_followup_at: string | null; by_name: string | null; created_at: string
  is_key_customer?: number; is_key_project?: number
  seq?: number; seq_total?: number
  comments?: { id: string; content: string; by_name: string | null; created_at: string }[]
}
interface Comment { id: string; content: string; by_name: string | null; created_at: string }

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
const DEFAULT_METHODS = ['电话', '邮件', '微信', '拜访', '展会', '其他']
const today = () => new Date().toISOString().slice(0, 10)

export default function FollowUps({ meta, target }: {
  meta: MetaLite
  target?: { sales: string; no: string } | null
}) {
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
  const [dragP, setDragP] = useState(false); const [dragF, setDragF] = useState(false)
  const [commentOf, setCommentOf] = useState<Fu | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [list, setList] = useState<Fu[]>([])
  // 同一询价可能有多条跟进：列表只显示一行（取最新一条），其余明细在「查看详情」弹窗里查
  const rows = useMemo(() => {
    const m = new Map<string, Fu>()
    list.forEach((r) => {
      const cur = m.get(r.inquiry_id)
      const newer = !cur || Number(r.seq ?? 0) > Number(cur.seq ?? 0) || (Number(r.seq ?? 0) === Number(cur.seq ?? 0) && String(r.date) > String(cur.date))
      if (newer) m.set(r.inquiry_id, r)
    })
    return Array.from(m.values()).sort((a, b) => (String(b.date) < String(a.date) ? -1 : String(b.date) > String(a.date) ? 1 : 0))
  }, [list])
  const [options, setOptions] = useState<{ id: string; inquiry_no: string; customer_name: string; date: string }[]>([])
  const [optLoading, setOptLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  // 查看跟进详情：与「询报价管理」页的「查看详情」使用同一个弹窗（按条列出该询价全部跟进）
  const [detailOf, setDetailOf] = useState<{ id: string; no: string; customer?: string } | null>(null)
  // 详情里默认只「查看多条跟进」；点击任意一条（或点「＋ 新建跟进」）才展开建立跟进表单
  const [formOpen, setFormOpen] = useState(false)
  const formRef = useRef<HTMLDivElement | null>(null)
  const sumRef = useRef<HTMLInputElement | null>(null)

  // 进入跟进（仪表盘跳转 / 点击跟进记录行）时保留已选询价，仅手动切换销售才清空
  const keepNoRef = useRef(false)
  useEffect(() => {
    if (!target?.sales || !target?.no) return
    keepNoRef.current = true
    setSales(target.sales); setNo(target.no)
  }, [target])

  useEffect(() => {
    // 保留条件：来自仪表盘跳转（销售等于目标或尚未生效）／刚点了跟进记录行；仅手动换销售才清空
    const keepFromTarget = Boolean(target?.no && target.sales && (sales === target.sales || sales === ''))
    if (keepNoRef.current || keepFromTarget) { /* 保留已选询价 */ }
    else { setNo(''); setHit(null); setLookErr('') }
    keepNoRef.current = false
    if (!sales) { setOptions([]); return }
    setOptLoading(true)
    get<{ id: string; inquiry_no: string; customer_name: string; date: string }[] | { rows: { id: string; inquiry_no: string; customer_name: string; date: string }[] }>(`/inquiries?sales=${encodeURIComponent(sales)}`)
      .then((d) => setOptions(Array.isArray(d) ? d : (d?.rows ?? [])))
      .catch(() => setOptions([]))
      .finally(() => setOptLoading(false))
  }, [sales, target])

  const lookup = useCallback(async () => {
    setLookErr(''); setHit(null)
    if (!sales || !no.trim()) return
    try { setHit(await get<Lookup>(`/inquiries/lookup?sales=${encodeURIComponent(sales)}&no=${encodeURIComponent(no.trim())}`)) }
    catch (e) { setLookErr((e as Error).message) }
  }, [sales, no])
  // 点选/带出后立即查询（原 400ms 防抖会让「添加跟进」有等待感，这里改为立即执行）
  useEffect(() => { void lookup() }, [lookup])
  // 仅在切换到「另一个询价」时收起表单（同一询价由后台补全信息时不收起）
  const lastHitIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (lastHitIdRef.current && lastHitIdRef.current !== (hit?.id ?? null)) setFormOpen(false)
    lastHitIdRef.current = hit?.id ?? null
  }, [hit?.id])
  // 兜底：若仍有待展开（历史上排队的情况），询价信息就绪后补开一次表单
  useEffect(() => {
    if (!hit || !pendingOpenRef.current) return
    const r = pendingOpenRef.current
    pendingOpenRef.current = null
    setFormOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit])
  // 点击某条跟进 → 展开建立跟进表单（沿用该条的跟进方式/跟进人），不跳回页面顶部
  // 列表态点「添加跟进」：先用行内已有信息立即渲染「项目详情 + 跟进表单」，再后台补齐完整询价信息（避免等待感）
  const pendingOpenRef = useRef<Fu | null>(null)
  const enterFromRow = (r: Fu) => {
    keepNoRef.current = true
    setSales(r.sales)
    setNo(r.inquiry_no)
    setLookErr('')
    // 乐观数据：字段名与 /inquiries/lookup 返回保持一致，缺少的项先留空、由后台补全
    setHit((prev) => (prev && prev.id === r.inquiry_id ? prev : {
      id: r.inquiry_id, inquiry_no: r.inquiry_no, date: r.date, customer_name: r.customer_name,
      country: null, use_location: null, sales: r.sales, purchaser: '—', source: '—',
      is_won: 0, productNames: '', usdApprox: 0, totals: [], items: [],
      last_followup_at: r.date, next_followup_at: r.next_followup_at,
      status: 'following', is_key_customer: r.is_key_customer, is_key_project: r.is_key_project,
    }))
    openFormFrom(r)
  }
  const openFormFrom = (r: Fu) => {
    setF((prev) => ({ ...prev, date: today(), method: r.method || prev.method, byName: r.by_name || r.sales || prev.byName, summary: '', detail: '', nextFollowupAt: '' }))
    setFormOpen(true)
    setTimeout(() => { formRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); sumRef.current?.focus() }, 60)
  }

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
        else setFiles((a) => [...a, { url: res.url, name: res.name, size: (res as { size?: number }).size ?? file.size }])
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
        {(sales || no) && (
          <button className="btn sm" style={{ alignSelf: 'flex-end' }} title="清空当前筛选与选择"
            onClick={() => { setSales(''); setNo(''); setHit(null); setLookErr('') }}>清空选择</button>
        )}
        {lookErr && <span className="hint" style={{ color: 'var(--danger)', alignSelf: 'center' }}>{lookErr}</span>}
      </div>

      {hit && (
        <div className="proj">
          {/* 头部：项目（询价）标识 + 状态/标签一眼可见 */}
          <div className="proj-head">
            <span className="proj-no mono">{hit.inquiry_no}</span>
            <span className="proj-cust">{hit.customer_name}</span>
            <StatusChip status={hit.status ?? (Number(hit.is_won) === 1 ? 'won' : 'following')} />
            <KeyTags kc={hit.is_key_customer} kp={hit.is_key_project} compact />
            <span style={{ flex: 1 }} />
            <span className="hint">{hit.itemCount ? `${hit.itemCount} 行明细` : ''}</span>
          </div>

          {/* 重点数据：报价 / 跟进节奏 用卡片突出 */}
          <div className="proj-kpis">
            <div className="proj-kpi">
              <span className="proj-kpi-label">报价合计（含费用）</span>
              <b className="proj-kpi-value">{(hit.totals || []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'}</b>
              <span className="proj-kpi-note">折 USD ≈ {money(hit.usdApprox)}</span>
            </div>
            <div className="proj-kpi">
              <span className="proj-kpi-label">最近跟进</span>
              <b className="proj-kpi-value">{hit.last_followup_at || '—'}</b>
              <span className="proj-kpi-note">按销售 + 询价号自动带出</span>
            </div>
            <div className="proj-kpi">
              <span className="proj-kpi-label">下次跟进</span>
              <b className="proj-kpi-value" style={{ color: hit.next_followup_at ? 'var(--brand)' : 'var(--sub)' }}>{hit.next_followup_at || '未设置'}</b>
              <span className="proj-kpi-note">建立跟进时可修改</span>
            </div>
          </div>

          {/* 明细信息：表格展示，标签在左、值在右，逐行对齐 */}
          <table className="proj-table">
            <tbody>
              <tr><th>客户</th><td>{hit.customer_name || '—'}</td><th>询价日期</th><td className="mono">{hit.date || '—'}</td></tr>
              <tr><th>国别 / 使用地</th><td>{hit.country || '—'}{hit.use_location ? ` / ${hit.use_location}` : ''}</td><th>来源</th><td>{hit.source || '—'}</td></tr>
              <tr><th>销售</th><td>{hit.sales || '—'}</td><th>采购</th><td>{hit.purchaser || '—'}</td></tr>
              <tr><th>产品明细</th><td colSpan={3} title={hit.productNames || '—'}>{hit.productNames || '—'}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {detailOf && (
        <InquiryFollowupsModal inquiryId={detailOf.id} inquiryNo={detailOf.no} customerName={detailOf.customer}
          onClose={() => setDetailOf(null)} />
      )}

      {commentOf && (
        // 未进入详情时可新增；已进入跟进详情则只读
        <GuidanceModal record={commentOf} people={meta.sales.map((x) => x.name)} readOnly={Boolean(hit)}
          onClose={() => setCommentOf(null)} onSaved={() => { void loadList() }} />
      )}

      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontWeight: 700 }}>跟进记录{hit ? `（本询价 ${list.length} 条）` : sales ? `（${sales} 名下 ${list.length} 条）` : ''}</span>
          {hit && <span className="hint">{list.length > 1 ? '点击下面任意一条跟进即可新建跟进' : '点击该条跟进即可新建跟进'}</span>}
          {hit && <span style={{ flex: 1 }} />}
          {hit && !formOpen && <button className="btn sm pri" onClick={() => { setFormOpen(true); setTimeout(() => { formRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); sumRef.current?.focus() }, 60) }}>＋ 新建跟进</button>}
        </div>
        <div className="tablewrap" style={{ overflowX: 'auto' }}>
          <table className="grid follow-table fit-table" style={{ borderCollapse: 'collapse', fontSize: 12.5 }}>
            <colgroup>
              <col style={{ width: '10%' }} /><col style={{ width: '15%' }} /><col style={{ width: '9%' }} /><col style={{ width: '8%' }} />
              <col style={{ width: '20%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} />
            </colgroup>
            <thead><tr>{['跟进日期', '询价号 / 客户', '销售 / 跟进人', '方式', '跟进简述与内容', '跟进指导', '下次跟进', '录入时间', '操作'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: '7px 8px', textAlign: 'left', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }} title={h === '跟进日期' ? '同一询价多次跟进只显示一行（最新一次）；每条跟进的明细请在「查看详情」里查询' : (h === '操作' ? '为该询价新增一条跟进记录（展开下方「建立跟进」表单）' : undefined)}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => {
                const detail = r.detail || r.content || ''
                return (
                  // 行点击不再进入跟进详情：要进入某询价请用「操作」列的「添加跟进」
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--line2)' }}>
                    <td className="mono" style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                      {r.date}
                      {Number(r.seq_total ?? 1) > 1 && (
                        <span className="cell-note" title={`该询价共 ${r.seq_total} 次跟进，这里显示最新一次；全部记录在「查看详情」里查`}>共{r.seq_total}次</span>
                      )}
                    </td>
                    {/* 第几次跟进：按跟进日期先后自动编号（同日按录入先后） */}
                    <td style={{ padding: '7px 8px' }}>
                      <div className="mono" style={{ fontWeight: 600 }}>{r.inquiry_no}</div>
                      <div style={{ marginTop: 2 }}>{r.customer_name}</div>
                      {(Number(r.is_key_customer) === 1 || Number(r.is_key_project) === 1) && (
                        <div style={{ marginTop: 3 }}><KeyTags kc={r.is_key_customer} kp={r.is_key_project} compact /></div>
                      )}
                    </td>
                    <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 600 }}>{r.sales || '—'}</div>
                      {r.by_name && r.by_name !== r.sales && <div className="hint" style={{ fontSize: 11 }}>跟进人 {r.by_name}</div>}
                    </td>
                    <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}><span className="badge">{r.method || '—'}</span></td>
                    {/* 简述与详情合并在一列：简述加粗一行、详情紧随其后；右侧「查看详情」按钮打开完整记录 */}
                    <td style={{ padding: '7px 8px' }} title={[r.summary, detail].filter(Boolean).join(' ｜ ') || '—'}>
                      <div>
                        {r.summary && <div style={{ fontWeight: 600 }}>{r.summary}</div>}
                        {detail && <div style={{ marginTop: r.summary ? 3 : 0, whiteSpace: 'pre-wrap' }}>{detail}</div>}
                        {!r.summary && !detail && <span className="hint">—</span>}
                        {/* 「查看详情」放在简述/详情下面 */}
                        <button className="btn xs" style={{ marginTop: 6 }} title="查看该询价的全部跟进详情（含简述、详情、图片、附件、跟进指导）"
                          onClick={(e) => { e.stopPropagation(); setDetailOf({ id: r.inquiry_id, no: r.inquiry_no, customer: r.customer_name }) }}>查看详情</button>
                      </div>
                    </td>
                    <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                      {/* 跟进指导：列内只放「添加指导」按钮；指导详情在按钮弹窗里看（只显示最新一条） */}
                      <button className="btn xs" onClick={() => setCommentOf(r)}
                        title={hit ? '查看最新一条跟进指导（详情内只读）' : ((r.comments ?? []).length ? `添加指导（已有的最新指导：${(r.comments ?? [])[(r.comments ?? []).length - 1].content.slice(0, 40)}…）` : '给这条跟进添加指导建议')}>
                        {hit ? '查看指导' : '添加指导'}
                      </button>
                    </td>
                    <td className="mono" style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{r.next_followup_at ? r.next_followup_at.replace('T', ' ') : '—'}</td>
                    <td className="mono hint" style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{String(r.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                    {/* 操作：为该询价再添加一条跟进（详情/图片/附件看上方「简述与内容」列的「查看详情」） */}
                    <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                      <button className="btn xs pri" title="为该询价新增一条跟进记录（填写简述与具体内容，可上传图片/附件）"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (hit) { openFormFrom(r); return }
                          // 列表态：先用该行已有信息立即进入并展开表单（不等接口），随后后台补全询价信息
                          enterFromRow(r)
                        }}>添加跟进</button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 20, color: 'var(--sub)' }}>暂无跟进记录</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {hit && formOpen && (
        <div ref={formRef} style={{ marginTop: 12, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontWeight: 700 }}>建立跟进</span>
            <span className="hint">询价 {hit.inquiry_no} · 新建一条跟进记录</span>
            <span style={{ flex: 1 }} />
            <button className="btn sm" onClick={() => setFormOpen(false)}>收起表单</button>
          </div>
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
            <div className="col grow1"><label>跟进简述</label><input ref={sumRef} className="sa" style={{ width: '100%' }} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="一句话概括本次跟进（如：确认技术规格并催 PO）" /></div>
          </div>
          <div className="col box-fixed" style={{ maxWidth: 860 }}><label>具体跟进内容</label><textarea className="sa" rows={4} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} placeholder="详细沟通内容、客户反馈、异议与应对、下一步计划…" /></div>

          <div className="row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
            <div className="col" style={{ flex: 1, minWidth: 280 }}>
              <label>图片/照片 {photos.length > 0 && <span className="badge new">{photos.length}</span>}</label>
              <input ref={photoInput} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { void upload(e.target.files, 'photo'); e.target.value = '' }} />
              <div
                className={'dropzone' + (dragP ? ' on' : '') + (uploading ? ' uploading' : '')}
                onClick={() => { if (!uploading) photoInput.current?.click() }}
                onDragOver={(e) => { e.preventDefault(); setDragP(true) }}
                onDragLeave={() => setDragP(false)}
                onDrop={(e) => { e.preventDefault(); setDragP(false); if (!uploading) void upload(e.dataTransfer.files, 'photo') }}
                title="点击选择，或把图片拖进来（可多选，单张≤8MB）"
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>🖼</span>
                <span>{uploading ? '上传中…' : '点击或拖拽图片到此处'}</span>
                <span className="hint" style={{ fontSize: 11 }}>支持多张 · 单张 ≤ 8MB</span>
              </div>
              {photos.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {photos.map((p) => (
                    <span key={p} className="thumb" title="点击查看原图">
                      <a href={p} target="_blank" rel="noreferrer"><img src={p} alt="照片" /></a>
                      <button className="del" title="移除这张图片" onClick={() => setPhotos((a) => a.filter((x) => x !== p))}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="col" style={{ flex: 1, minWidth: 280 }}>
              <label>附件 {files.length > 0 && <span className="badge new">{files.length}</span>}</label>
              <input ref={fileInput} type="file" multiple style={{ display: 'none' }} onChange={(e) => { void upload(e.target.files, 'file'); e.target.value = '' }} />
              <div
                className={'dropzone' + (dragF ? ' on' : '') + (uploading ? ' uploading' : '')}
                onClick={() => { if (!uploading) fileInput.current?.click() }}
                onDragOver={(e) => { e.preventDefault(); setDragF(true) }}
                onDragLeave={() => setDragF(false)}
                onDrop={(e) => { e.preventDefault(); setDragF(false); if (!uploading) void upload(e.dataTransfer.files, 'file') }}
                title="点击选择，或把文件拖进来（可多选，单个≤8MB）"
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>📎</span>
                <span>{uploading ? '上传中…' : '点击或拖拽文件到此处'}</span>
                <span className="hint" style={{ fontSize: 11 }}>支持多选 · 单个 ≤ 8MB</span>
              </div>
              {files.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {files.map((x) => (
                    <span key={x.url} className="filechip" title={x.name}>
                      <a className="mono" href={x.url} target="_blank" rel="noreferrer">{x.name}</a>
                      {x.size != null && <span className="hint" style={{ fontSize: 11 }}>{(x.size / 1024).toFixed(0)}KB</span>}
                      <button className="del" title="移除该附件" onClick={() => setFiles((a) => a.filter((y) => y.url !== x.url))}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn pri" disabled={busy || uploading} onClick={() => void submit()}>建立跟进{busy ? '…' : ''}</button>
            {uploading && <span className="hint">文件上传中…</span>}
          </div>
        </div>
      )}
    </div>
  )
}
