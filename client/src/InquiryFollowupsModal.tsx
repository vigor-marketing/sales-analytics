import { useEffect, useState } from 'react'
import { get } from './api'
import GuidanceNote, { type GuidanceItem } from './Guidance'

/** 一条跟进记录（与 /api/followups 返回一致） */
export interface FuItem {
  id: string; inquiry_id: string; inquiry_no: string; customer_name: string; sales: string; date: string
  method: string; content: string | null; summary: string | null; detail: string | null
  photos: string[]; attachments: { url: string; name: string; size?: number }[]
  next_followup_at: string | null; by_name: string | null; created_at: string
  seq?: number; seq_total?: number
  comments?: GuidanceItem[]
}

const money = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('zh-CN'))
const fmt = (v: string | null) => (v ? String(v).slice(0, 16).replace('T', ' ') : '—')

/**
 * 跟进详情弹窗：展示某询价下的全部跟进记录（含简述、详情全文、图片、附件、跟进指导）
 * 用于询报价管理列表点「跟进详情」查看，解决单元格内看不全的问题。
 */
export default function InquiryFollowupsModal({ inquiryId, inquiryNo, customerName, onClose }: {
  inquiryId: string; inquiryNo: string; customerName?: string; onClose: () => void
}) {
  const [rows, setRows] = useState<FuItem[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    get<FuItem[]>(`/followups?inquiryId=${encodeURIComponent(inquiryId)}`)
      .then((l) => setRows(Array.isArray(l) ? l : []))
      .catch((e) => setErr((e as Error).message))
  }, [inquiryId])
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal fu-list-modal" style={{ maxHeight: '88vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="跟进详情">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>跟进详情 · {inquiryNo}{customerName ? `（${customerName}）` : ''}　共 {rows?.length ?? 0} 条</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>下面是该询价的全部跟进记录：简述与详情分开展示，上传的图片与附件可直接打开。</div>
        {err && <div className="msg err">{err}</div>}
        {!rows && !err && <div className="hint" style={{ marginTop: 10 }}>加载中…</div>}
        {rows && rows.length === 0 && <div className="hint" style={{ marginTop: 10 }}>该询价暂无跟进记录（可在「询报价跟进」页录入）。</div>}
        {(rows ?? []).map((f) => (
          <div key={f.id} className="fu-card">
            <div className="fu-card-head">
              <span className="badge new">第 {f.seq ?? '—'} 次</span>
              <span className="mono" style={{ fontWeight: 600 }}>{f.date}</span>
              <span className="badge">{f.method || '—'}</span>
              <span className="hint">跟进人 {f.by_name || f.sales || '—'}</span>
              <span className="hint">下次跟进 {fmt(f.next_followup_at)}</span>
              <span style={{ flex: 1 }} />
              <span className="hint">录入 {fmt(f.created_at)}</span>
            </div>
            <div className="fu-card-sec">
              <label>跟进简述</label>
              <div className="fu-card-val fu-strong">{f.summary || '—'}</div>
            </div>
            <div className="fu-card-sec">
              <label>跟进详情</label>
              <div className="fu-card-val" style={{ whiteSpace: 'pre-wrap' }}>{f.detail || f.content || '—'}</div>
            </div>
            <div className="fu-card-sec">
              <label>图片 / 附件{(f.photos?.length || f.attachments?.length) ? `（${f.photos?.length || 0} 图 · ${f.attachments?.length || 0} 附件）` : ''}</label>
              {(f.photos?.length || f.attachments?.length) ? (
                <div className="fu-files">
                  {(f.photos || []).map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" title="点击查看原图">
                      <img src={u} alt="跟进图片" className="fu-thumb" />
                    </a>
                  ))}
                  {(f.attachments || []).map((a) => (
                    <a key={a.url} className="filelink" href={a.url} target="_blank" rel="noreferrer" title={a.name}>
                      📎 {a.name}{a.size != null ? `（${money(Math.round(a.size / 1024))}KB）` : ''}
                    </a>
                  ))}
                </div>
              ) : <div className="hint">—</div>}
            </div>
            {(f.comments ?? []).length > 0 && (
              <div className="fu-card-sec">
                <label>跟进指导（{(f.comments ?? []).length} 条）</label>
                <div style={{ marginTop: 4 }}><GuidanceNote comments={f.comments} /></div>
              </div>
            )}
          </div>
        ))}
        <div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  )
}
