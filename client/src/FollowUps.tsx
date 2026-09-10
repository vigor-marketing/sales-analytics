import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get, post } from './api'
import { StatusChip } from './StatusChip'
import { KeyTags } from './KeyTags'
import GuidanceNote from './Guidance'
import GuidanceModal from './GuidanceModal'
import FollowupRecordModal from './FollowupRecordModal'

interface MetaLite { sales: { name: string; team: string }[]; methods?: string[] }
interface Lookup {
  id: string; inquiry_no: string; date: string; customer_name: string; country: string | null; use_location: string | null
  sales: string; purchaser: string; source: string; is_won: number; won_date?: string | null; orderNo?: string | null
  productNames: string; usdApprox: number; totals: { currency: string; total: number }[]; itemCount?: number; feeTotal?: number; fee_currency?: string | null; grandTotals?: { currency: string; total: number }[]; quoteUsdApprox?: number
  last_followup_at?: string | null; next_followup_at?: string | null; status?: 'won' | 'lost' | 'following'; is_key_customer?: number; is_key_project?: number; items: { product_name: string; qty: number | null; amount: number; currency: string }[]
}
interface Att { url: string; name: string; size?: number }
interface Fu {
  id: string; inquiry_id: string; inquiry_no: string; customer_name: string; sales: string; date: string
  method: string; content: string | null; summary: string | null; detail: string | null
  photos: string[]; attachments: Att[]; next_followup_at: string | null; by_name: string | null; created_at: string
  is_key_customer?: number; is_key_project?: number
  comments?: { id: string; content: string; by_name: string | null; created_at: string }[]
}
interface Comment { id: string; content: string; by_name: string | null; created_at: string }

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
const DEFAULT_METHODS = ['电话', '邮件', '微信', '拜访', '展会', '其他']
const today = () => new Date().toISOString().slice(0, 10)

export default function FollowUps({ meta, target, resetSignal, onDetailChange }: {
  meta: MetaLite
  target?: { sales: string; no: string } | null
  resetSignal?: number
  onDetailChange?: (open: boolean) => void
}) {
  const methods = meta.methods?.length ? meta.methods : DEFAULT_METHODS
  const [sales, setSales] = useState('')
  const [no, setNo] = useState('')
  const [hit, setHit] = useState<Lookup | null>(null)
  // 项目行展开（多条跟进的项目：第一次点击先展开）；展开状态在切换页面后也保留
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try { const raw = sessionStorage.getItem('sa:fuExpanded'); return new Set<string>(raw ? JSON.parse(raw) as string[] : []) } catch { return new Set<string>() }
  })
  useEffect(() => { try { sessionStorage.setItem('sa:fuExpanded', JSON.stringify([...expanded])) } catch { /* 忽略 */ } }, [expanded])
  // 单条记录弹窗：最新一条可编辑，较早的只读
  const [recModal, setRecModal] = useState<{ record: Fu; editable: boolean; create?: boolean } | null>(null)
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
  const [options, setOptions] = useState<{ id: string; inquiry_no: string; customer_name: string; date: string }[]>([])
  const [optLoading, setOptLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const fitRef = useRef<HTMLDivElement | null>(null)
  // 记住本页滚动位置（切换页面、展开项目、打开弹窗、保存后刷新都不跳回顶部）
  const keepScroll = () => {
    const el = fitRef.current
    if (!el) return () => { /* 忽略 */ }
    const top = el.scrollTop
    return () => { requestAnimationFrame(() => { if (fitRef.current) fitRef.current.scrollTop = top }) }
  }
  const restoreScroll = () => {
    const saved = Number(sessionStorage.getItem('sa:fuScroll') || '0')
    if (saved > 0) requestAnimationFrame(() => { if (fitRef.current) fitRef.current.scrollTop = saved })
  }
  const onFitScroll = () => {
    const el = fitRef.current
    if (el) try { sessionStorage.setItem('sa:fuScroll', String(Math.round(el.scrollTop))) } catch { /* 忽略 */ }
  }

  // 详情打开状态上报（用于页面右上角显示「返回询报价跟进」）
  useEffect(() => { onDetailChange?.(Boolean(hit)) }, [hit, onDetailChange])
  // 页面右上角点了「返回询报价跟进」：退出详情回到列表
  useEffect(() => {
    if (!resetSignal) return
    const restore = keepScroll()
    setNo(''); setHit(null); setLookErr('')
    restore()   // 返回列表时保持原来的滚动位置，不跳回顶部
  }, [resetSignal])

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
  useEffect(() => { const t = setTimeout(() => { void lookup() }, 400); return () => clearTimeout(t) }, [lookup])

  // 同一个项目（同一条询价）的多条跟进记录，在前端合并成一行
  const groups = useMemo(() => {
    const m = new Map<string, {
      key: string; rep: Fu; count: number; records: Fu[]
      dates: string[]; nextAt: string | null; firstDate: string
      comments: { id: string; content: string; by_name: string | null; created_at: string }[]
      photos: string[]; atts: Att[]; methods: string[]; byNames: string[]
    }>()
    list.forEach((r) => {
      const g = m.get(r.inquiry_id)
      if (!g) {
        m.set(r.inquiry_id, {
          key: r.inquiry_id, rep: r, count: 1, records: [r], dates: [r.date], nextAt: r.next_followup_at, firstDate: r.date,
          comments: [...(r.comments ?? [])], photos: [...(r.photos ?? [])], atts: [...(r.attachments ?? [])],
          methods: [r.method].filter(Boolean), byNames: r.by_name ? [r.by_name] : [],
        })
        return
      }
      g.count += 1
      g.records.push(r)
      g.dates.push(r.date)
      // 列表按日期倒序返回，第一条即最新；下次跟进取最新一条有填写的那次
      if (!g.nextAt && r.next_followup_at) g.nextAt = r.next_followup_at
      if (r.date < g.firstDate) g.firstDate = r.date
      g.comments.push(...(r.comments ?? []))
      ;(r.photos ?? []).forEach((x) => { if (!g.photos.includes(x)) g.photos.push(x) })
      ;(r.attachments ?? []).forEach((x) => { if (!g.atts.some((y) => y.url === x.url)) g.atts.push(x) })
      if (r.method && !g.methods.includes(r.method)) g.methods.push(r.method)
      if (r.by_name && !g.byNames.includes(r.by_name)) g.byNames.push(r.by_name)
    })
    // 指导按时间正序展示（最新的在最后）
    m.forEach((g) => g.comments.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))))
    return Array.from(m.values()).sort((a, b) => String(b.rep.date).localeCompare(String(a.rep.date)) || String(b.rep.created_at).localeCompare(String(a.rep.created_at)))
  }, [list])

  const loadList = useCallback(async () => {
    try { setList(await get<Fu[]>(`/followups?sales=${encodeURIComponent(sales)}${hit ? `&inquiryId=${encodeURIComponent(hit.id)}` : ''}`)) }
    catch { /* */ }
  }, [sales, hit])
  useEffect(() => { void loadList() }, [loadList])
  // 页面（重新）挂载后、列表渲染完成再恢复上次的滚动位置
  useEffect(() => {
    if (!list.length) return
    const t = setTimeout(restoreScroll, 60)
    return () => clearTimeout(t)
  }, [list.length])

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
    <div className="page-fit" ref={fitRef} onScroll={onFitScroll}>
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
        <div style={{ marginTop: 10, border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', background: '#fbfcff' }}>
          {/* 进入某个询价的跟进详情后，可一键返回跟进列表 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>跟进详情</span>
            <span className="hint">询价 {hit.inquiry_no}</span>
            <span style={{ flex: 1 }} />
            <button className="btn sm" title="返回询报价跟进列表"
              onClick={() => { const restore = keepScroll(); setNo(''); setHit(null); setLookErr(''); restore() }}>← 返回跟进列表</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 13 }}>
            <span>询价号 <b className="mono">{hit.inquiry_no}</b></span>
            <span>客户 <b>{hit.customer_name}</b></span>
            <span>国别 <b>{hit.country || '—'}</b></span>
            <span>销售 <b>{hit.sales}</b></span>
            <span>采购 <b>{hit.purchaser}</b></span>
            <span>来源 <b>{hit.source}</b></span>
            <span>询价日期 <b className="mono">{hit.date}</b></span>
            <span>产品合计 <b>{(hit.totals || []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'}</b>{(hit.feeTotal ?? 0) > 0 ? <> ＋ 费用 <b>{money(hit.feeTotal)} {hit.fee_currency || 'USD'}</b></> : null}</span>
            <span>总报价（含费用） <b style={{ color: 'var(--brand)' }}>{(hit.grandTotals || hit.totals || []).map((t) => `${money(t.total)} ${t.currency}`).join(' + ') || '—'}</b>（≈USD {money(hit.usdApprox)}）</span>
            <span>状态 <b><StatusChip status={hit.status ?? (Number(hit.is_won) === 1 ? 'won' : 'following')} /></b></span>
            <span>标签 <b><KeyTags kc={hit.is_key_customer} kp={hit.is_key_project} compact /></b></span>
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

      {recModal && (
        <FollowupRecordModal record={recModal.record} editable={recModal.editable} create={recModal.create}
          onClose={() => setRecModal(null)}
          onSaved={() => {
            const restore = keepScroll()
            void loadList()
            if (recModal.create) { setMsg({ t: 'ok', text: `已建立跟进（${recModal.record.inquiry_no}）` }); setRecModal(null) }
            setTimeout(restore, 80)
          }} />
      )}

      {commentOf && (
        // 未进入详情时可新增；已进入跟进详情则只读
        <GuidanceModal record={commentOf} people={meta.sales.map((x) => x.name)} readOnly={Boolean(hit)}
          onClose={() => setCommentOf(null)} onSaved={() => { void loadList() }} />
      )}

      <div style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          {hit
            ? `跟进记录（本询价 ${list.length} 条明细）`
            : `跟进记录（按项目合并：${groups.length} 个项目 / ${list.length} 条记录${sales ? ` · ${sales} 名下` : ''}）`}
        </div>
        <div className="tablewrap">
          <table className="grid data-table fixed-table follow-table" style={{ fontSize: 12.5, minWidth: 1330 }}>
            <colgroup>
              {hit
                ? <><col style={{ width: 95 }} /><col style={{ width: 215 }} /><col style={{ width: 105 }} /><col style={{ width: 80 }} /><col style={{ width: 210 }} />
                  <col style={{ width: 240 }} /><col style={{ width: 110 }} /><col style={{ width: 150 }} /><col style={{ width: 115 }} /></>
                : <><col style={{ width: 95 }} /><col style={{ width: 215 }} /><col style={{ width: 105 }} /><col style={{ width: 80 }} /><col style={{ width: 140 }} />
                  <col style={{ width: 200 }} /><col style={{ width: 240 }} /><col style={{ width: 110 }} /><col style={{ width: 150 }} /></>}
            </colgroup>
            <thead><tr>{(hit
              ? ['跟进日期', '询价号 / 客户', '销售 / 跟进人', '方式', '简述与跟进内容', '跟进指导', '图片 / 附件', '下次跟进', '录入时间']
              : ['最近跟进', '询价号 / 客户', '销售 / 跟进人', '方式', '跟进次数', '最近简述与内容', '跟进指导（全部）', '图片 / 附件', '下次跟进']
            ).map((h) => <th key={h} className={h === '下次跟进' || h === '最近跟进' || h === '录入时间' ? 'cell-datetime' : (h === '询价号 / 客户' ? 'cell-left' : undefined)} title={h === '跟进次数' ? '同一个项目的多条跟进记录已在前端合并，点击整行可查看该项目全部记录' : undefined}>{h}</th>)}</tr></thead>
            <tbody>
              {(hit ? list.map((r) => ({
                key: r.id, rep: r, count: 1, records: [r], firstDate: r.date, dates: [r.date], nextAt: r.next_followup_at,
                comments: [...(r.comments ?? [])], photos: [...(r.photos ?? [])], atts: [...(r.attachments ?? [])],
                methods: [r.method].filter(Boolean), byNames: r.by_name ? [r.by_name] : [],
              })) : groups).map((g) => {
                const r = g.rep
                const detail = r.detail || r.content || ''
                const photos = g.photos
                const atts = g.atts
                const merged = !hit && g.count > 1
                const rangeTxt = g.firstDate === r.date ? r.date : `${g.firstDate} ~ ${r.date}`
                const open = expanded.has(g.key)
                return (
                  <Fragment key={g.key}>
                  <tr className={'row-click' + (open ? ' fu-open' : '')} title={merged ? `该项目 ${g.count} 条跟进：点击展开，再点最新一条可编辑、点较早的只能查看` : '点击查看/编辑这条跟进记录'}
                    onClick={(e) => {
                      // 行内按钮（查看/追加指导）不触发展开
                      if ((e.target as HTMLElement).closest('button,a,input,select,textarea')) return
                      const restore = keepScroll()
                      if (merged) {
                        setExpanded((prev) => { const n = new Set(prev); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })
                        restore()
                        return
                      }
                      // 单条记录的项目：直接打开该记录（是该询价最新一条时可编辑，否则只读）
                      setRecModal({ record: r, editable: hit ? list[0]?.id === r.id : true })
                      restore()
                    }}>
                    <td className="mono cell-datetime" title={merged ? `最近跟进 ${r.date}（首次 ${g.firstDate}）` : r.date}>{r.date}</td>
                    <td className="cell-left" title={`${r.inquiry_no} · ${r.customer_name || '—'}${Number(r.is_key_customer) === 1 ? ' · 重点客户' : ''}${Number(r.is_key_project) === 1 ? ' · 重点项目' : ''}`}>
                      <span className="mono" style={{ fontWeight: 600 }}>{r.inquiry_no}</span>
                      <span className="cell-note">{r.customer_name}</span>
                      {(Number(r.is_key_customer) === 1 || Number(r.is_key_project) === 1) && <span style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle' }}><KeyTags kc={r.is_key_customer} kp={r.is_key_project} compact /></span>}
                    </td>
                    <td title={r.by_name && r.by_name !== r.sales ? `销售 ${r.sales || '—'} · 跟进人 ${r.by_name}` : (r.sales || '—')}>
                      <span style={{ fontWeight: 600 }}>{r.sales || '—'}</span>
                      {r.by_name && r.by_name !== r.sales && <span className="cell-note">跟进人 {r.by_name}</span>}
                    </td>
                    <td title={g.methods.length > 1 ? `该项目用过：${g.methods.join('、')}` : (r.method || '—')} style={{ textAlign: 'center' }}>
                      <span className="badge">{hit ? (r.method || '—') : (g.methods[0] || '—')}</span>
                    </td>
                    {!hit && (
                      <td style={{ textAlign: 'center' }} title={merged ? `同一个项目共 ${g.count} 条跟进记录（${rangeTxt}）` : '该项目目前 1 条跟进记录'}>
                        <span className={'badge' + (merged ? ' new' : '')}>{g.count} 条</span>
                      </td>
                    )}
                    <td title={([merged ? `【${g.count} 条跟进合并】最近一条 ${r.date}：` : '', r.summary, detail].filter(Boolean).join(' ｜ ')) || '—'}>
                      {r.summary && <span style={{ fontWeight: 600 }}>{r.summary}</span>}
                      {detail && <span className={r.summary ? 'cell-note' : ''}>{detail}</span>}
                      {!r.summary && !detail && <span className="hint">—</span>}
                    </td>
                    <td className="cell-guidance">
                      {(() => {
                        const cs = hit ? (r.comments ?? []) : g.comments
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6, maxWidth: '100%' }}>
                            <GuidanceNote all comments={cs} />
                            {/* 跟进列表里可查看并新增指导；进入某个询价的跟进详情后只查看 */}
                            <button className="btn xs" style={{ flex: '0 0 auto' }} onClick={() => setCommentOf(r)}
                              title={hit ? '查看全部跟进指导（详情内只读）' : cs.length ? '查看全部指导 / 继续追加' : '添加跟进指导'}>
                              {hit ? '查看指导' : cs.length ? '查看/追加指导' : '＋ 添加指导'}
                            </button>
                          </span>
                        )
                      })()}
                    </td>
                    <td title={[merged ? `（该项目 ${g.count} 条记录合计）` : '', ...photos.map((_, i) => `图片 ${i + 1}`), ...atts.map((a) => a.name)].filter(Boolean).join('、') || '—'}>
                      {photos.length === 0 && atts.length === 0 ? <span className="hint">—</span> : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {photos.length > 0 && <span className="badge">🖼 {photos.length}</span>}
                          {atts.length > 0 && <span className="filelink" style={{ maxWidth: 120 }}>📎 {atts.length} 个附件</span>}
                        </span>
                      )}
                    </td>
                    <td className="mono cell-datetime" title={g.nextAt ? String(g.nextAt).replace('T', ' ') : '未设置下次跟进'}>{g.nextAt ? String(g.nextAt).replace('T', ' ') : '—'}</td>
                    {hit && <td className="mono hint cell-datetime" title={String(r.created_at || '').slice(0, 19).replace('T', ' ')}>{String(r.created_at || '').slice(0, 16).replace('T', ' ')}</td>}
                  </tr>
                  {/* 展开该项目下的每一条跟进记录：最新一条可编辑，较早的只能查看 */}
                  {open && (g.records ?? []).map((rec, idx) => {
                    const isLatest = idx === 0
                    const recDetail = rec.detail || rec.content || ''
                    const recPhotos = rec.photos || []
                    const recAtts = rec.attachments || []
                    return (
                      <tr key={rec.id} className={'row-click fu-child' + (isLatest ? ' fu-child-latest' : '')}
                        title={isLatest ? '该项目最新一条 · 点击编辑' : '较早的记录 · 点击查看（只读）'}
                        onClick={() => { const restore = keepScroll(); setRecModal({ record: rec, editable: isLatest }); restore() }}>
                        <td className="mono cell-datetime">{rec.date}</td>
                        <td className="cell-left"><span className="fu-indent">└</span><span className="mono" style={{ fontWeight: 600 }}>{rec.inquiry_no}</span><span className="cell-note">{rec.customer_name}</span></td>
                        <td title={rec.by_name && rec.by_name !== rec.sales ? `销售 ${rec.sales || '—'} · 跟进人 ${rec.by_name}` : (rec.sales || '—')}>
                          <span style={{ fontWeight: 600 }}>{rec.sales || '—'}</span>
                          {rec.by_name && rec.by_name !== rec.sales && <span className="cell-note">跟进人 {rec.by_name}</span>}
                        </td>
                        <td style={{ textAlign: 'center' }}><span className="badge">{rec.method || '—'}</span></td>
                        <td style={{ textAlign: 'center' }}>
                          {isLatest ? <span className="badge new" title="最新一条：可编辑">最新 · 可编辑</span> : <span className="badge" title="较早的记录：只能查看">只读</span>}
                        </td>
                        <td title={[rec.summary, recDetail].filter(Boolean).join(' ｜ ') || '—'}>
                          {rec.summary && <span style={{ fontWeight: 600 }}>{rec.summary}</span>}
                          {recDetail && <span className={rec.summary ? 'cell-note' : ''}>{recDetail}</span>}
                          {!rec.summary && !recDetail && <span className="hint">—</span>}
                        </td>
                        <td className="cell-guidance">
                          {(rec.comments ?? []).length === 0 ? <span className="hint">—</span> : (
                            <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6, maxWidth: '100%' }}>
                              <GuidanceNote all comments={rec.comments} />
                              <button className="btn xs" style={{ flex: '0 0 auto' }} title="查看全部指导 / 继续追加" onClick={() => setCommentOf(rec)}>{hit ? '查看指导' : '查看/追加指导'}</button>
                            </span>
                          )}
                        </td>
                        <td title={[...recPhotos.map((_, i) => `图片 ${i + 1}`), ...recAtts.map((a) => a.name)].join('、') || '—'}>
                          {recPhotos.length === 0 && recAtts.length === 0 ? <span className="hint">—</span> : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {recPhotos.length > 0 && <span className="badge">🖼 {recPhotos.length}</span>}
                              {recAtts.length > 0 && <span className="filelink" style={{ maxWidth: 120 }}>📎 {recAtts.length} 个附件</span>}
                            </span>
                          )}
                        </td>
                        <td className="mono cell-datetime">{rec.next_followup_at ? String(rec.next_followup_at).replace('T', ' ') : '—'}</td>
                      </tr>
                    )
                  })}
                  {open && (
                    <tr className="fu-child fu-child-add">
                      <td colSpan={9}>
                        {/* 直接弹窗建立跟进，不跳到页面顶部的建立跟进框 */}
                        <button className="btn xs" title="在弹窗里为该项目建立一条新跟进，不离开本页列表"
                          onClick={(e) => { e.stopPropagation(); const restore = keepScroll(); setRecModal({ record: r, editable: false, create: true }); restore() }}>＋ 为该项目建立新的跟进</button>
                        <span className="hint" style={{ marginLeft: 8 }}>最新一条可点击编辑，较早的记录只能查看</span>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
              {list.length === 0 && <tr><td colSpan={9} className="hint" style={{ textAlign: 'center' }}>暂无跟进记录</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </div>
  )
}
