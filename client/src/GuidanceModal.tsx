import { useState } from 'react'
import { post } from './api'
import { type GuidanceItem } from './Guidance'

interface Rec {
  id: string; inquiry_no: string; customer_name: string; sales: string; date: string
  method?: string | null; summary?: string | null; detail?: string | null; by_name?: string | null
  comments?: GuidanceItem[]
}

/** 跟进指导弹窗：readOnly=true 时只查看（销售端），否则可新增指导（管理端/仪表盘） */
export default function GuidanceModal({ record, people, readOnly, onClose, onSaved }: {
  record: Rec
  people: string[]
  readOnly?: boolean
  onClose: () => void
  onSaved?: () => void
}) {
  const [list, setList] = useState<GuidanceItem[]>(record.comments ?? [])
  const [content, setContent] = useState('')
  const [byName, setByName] = useState(record.by_name || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async () => {
    if (!content.trim()) return setErr('请填写指导内容')
    setBusy(true); setErr('')
    try {
      const r = await post<{ id: string; content: string; byName: string | null; createdAt: string }>(`/followups/${record.id}/comments`, { content: content.trim(), byName: byName.trim() || undefined })
      setList((a) => [...a, { id: r.id, content: r.content, by_name: r.byName, created_at: r.createdAt }])
      setContent('')
      onSaved?.()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal gd-modal" style={{ maxHeight: '88vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="跟进指导">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>跟进指导 · {record.inquiry_no}{readOnly ? '（只读）' : ''}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {record.date} · {record.method || '—'} · {record.customer_name} · 跟进人 {record.by_name || record.sales}
          {record.summary ? ` ｜ ${record.summary}` : ''}
        </div>
        {record.detail && (<>
          <h4 className="sec-title" style={{ marginTop: 12, textAlign: 'center' }}>跟进详情</h4>
          <div className="ro" style={{ marginTop: 6, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', textAlign: 'center' }}>{record.detail}</div>
        </>)}

        <h4 className="sec-title" style={{ marginTop: 12 }}>指导意见（{list.length} 条）</h4>
        {/* 固定高度 + 内部滚动：指导意见再多也不改变弹窗尺寸 */}
        <div className="gd-list">
          {list.length === 0 && <div className="hint">暂无评论，可在下方写下跟进建议（如：先确认技术规格、下周约客户现场演示）。</div>}
          {list.map((c) => (
            <div key={c.id} className="gd-item-box">
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{c.content}</div>
              <div className="hint" style={{ marginTop: 4, fontSize: 11.5 }}>{c.by_name || '—'} · {String(c.created_at).slice(0, 16).replace('T', ' ')}</div>
            </div>
          ))}
        </div>

        {!readOnly && (<>
        <h4 className="sec-title" style={{ marginTop: 14 }}>新增指导</h4>
        <div className="row">
          <div className="col w2">
            <label>评论人</label>
            <select className="sa" style={{ width: 180 }} value={byName} onChange={(e) => setByName(e.target.value)}>
              <option value="">— 请选择 —</option>
              {people.map((p) => <option key={p} value={p}>{p}</option>)}
              {byName && !people.includes(byName) && <option value={byName}>{byName}</option>}
            </select>
          </div>
        </div>
        <div className="col">
          <label>指导内容</label>
          {/* 固定长宽：宽 100%（弹窗固定 720px）、高 96px、禁止拖拽改变大小 */}
          <textarea className="sa gd-input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="例如：这个卡点先找技术支持确认参数；报价可申请 5% 折扣；下周务必约客户现场演示。" />
        </div>
        {err && <div className="msg err">{err}</div>}
        </>)}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{readOnly ? '关闭' : '取消'}</button>
          {!readOnly && <button className="btn pri" disabled={busy} onClick={() => void submit()}>{busy ? '提交中…' : '提交指导'}</button>}
        </div>
      </div>
    </div>
  )
}
