import { useState } from 'react'
import { currentActor } from './session'
import { post, put } from './api'
import GuidanceNote, { type GuidanceItem } from './Guidance'

export interface FuRecord {
  id: string; inquiry_id: string; inquiry_no: string; customer_name: string; sales: string; date: string
  method: string; content: string | null; summary: string | null; detail: string | null
  photos: string[]; attachments: { url: string; name: string; size?: number }[]
  next_followup_at: string | null; by_name: string | null; created_at: string
  comments?: GuidanceItem[]
}

interface Form { date: string; method: string; summary: string; detail: string; nextAt: string; byName: string }
const METHODS = ['电话', '邮件', '微信', '拜访', '展会', '其他', '视频会议']
const today = () => new Date().toISOString().slice(0, 10)

/**
 * 单条跟进记录弹窗：
 * - editable=true（该项目最新一条）→ 可编辑并保存
 * - editable=false（较早的记录）→ 只能查看
 */
export default function FollowupRecordModal({ record, editable, create, onClose, onSaved }: {
  record: FuRecord
  editable: boolean
  /** 新建模式：直接为该项目建立一条新跟进（不再跳到页面顶部的建立跟进框） */
  create?: boolean
  onClose: () => void
  onSaved?: () => void
}) {
  const [f, setF] = useState<Form>({
    date: create ? today() : (record.date || today()), method: record.method || '电话',
    summary: create ? '' : (record.summary || ''), detail: create ? '' : (record.detail || record.content || ''),
    nextAt: create ? '' : (record.next_followup_at ? String(record.next_followup_at).slice(0, 10) : ''),
    byName: record.by_name || record.sales || currentActor()?.name || '',   // 新建时自动带入当前登录人
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const save = async () => {
    if (!f.summary.trim() && !f.detail.trim()) return setErr('请填写跟进简述或具体内容')
    setBusy(true); setErr(''); setOkMsg('')
    try {
      if (create) {
        await post('/followups', {
          inquiryId: record.inquiry_id, date: f.date, method: f.method,
          summary: f.summary.trim() || undefined, detail: f.detail.trim() || undefined,
          nextFollowupAt: f.nextAt || undefined, byName: f.byName.trim() || undefined,
        })
        setOkMsg('已建立跟进')
      } else {
        await put(`/followups/${record.id}`, {
          date: f.date, method: f.method, summary: f.summary.trim() || undefined, detail: f.detail.trim() || undefined,
          nextFollowupAt: f.nextAt || undefined, byName: f.byName.trim() || undefined,
        })
        setOkMsg('已保存修改')
      }
      onSaved?.()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const money = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('zh-CN'))
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal fu-modal" style={{ maxHeight: '88vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label={editable ? '编辑跟进记录' : '查看跟进记录'}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{create ? '建立跟进' : editable ? '编辑跟进记录' : '查看跟进记录（只读）'} · {record.inquiry_no}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {record.customer_name} · 销售 {record.sales}
          {create ? ' · 新建一条跟进（不离开本页列表）' : <> · 录入时间 {String(record.created_at).slice(0, 16).replace('T', ' ')}{editable ? ' · 该项目最新一条，可修改' : ' · 较早的记录，只能查看'}</>}
        </div>

        {editable || create ? (
          <>
            <div className="row" style={{ marginTop: 8 }}>
              <div className="col w1"><label>跟进日期 *</label><input className="sa" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
              <div className="col w1"><label>方式</label>
                <select className="sa" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
                  {METHODS.map((m) => <option key={m}>{m}</option>)}
                  {f.method && !METHODS.includes(f.method) && <option value={f.method}>{f.method}</option>}
                </select>
              </div>
              <div className="col w1"><label>跟进人</label><input className="sa" value={f.byName} onChange={(e) => setF({ ...f, byName: e.target.value })} /></div>
              <div className="col w1"><label>下次跟进</label><input className="sa" type="date" value={f.nextAt} onChange={(e) => setF({ ...f, nextAt: e.target.value })} /></div>
            </div>
            <div className="col"><label>跟进简述</label><input className="sa" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="一句话概括本次跟进" /></div>
            <div className="col" style={{ marginTop: 6 }}><label>跟进内容</label><textarea className="sa fu-input" value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} placeholder="沟通内容、客户反馈、异议与应对、下一步计划…" /></div>
          </>
        ) : (
          <>
            <div className="row" style={{ marginTop: 8 }}>
              <div className="col w1"><label>跟进日期</label><div className="ro mono">{record.date}</div></div>
              <div className="col w1"><label>方式</label><div className="ro">{record.method || '—'}</div></div>
              <div className="col w1"><label>跟进人</label><div className="ro">{record.by_name || record.sales || '—'}</div></div>
              <div className="col w1"><label>下次跟进</label><div className="ro mono">{record.next_followup_at ? String(record.next_followup_at).replace('T', ' ') : '—'}</div></div>
            </div>
            <div className="col"><label>跟进简述</label><div className="ro">{record.summary || '—'}</div></div>
            <div className="col" style={{ marginTop: 6 }}><label>跟进内容</label><div className="ro area fu-input" style={{ overflow: 'auto' }}>{record.detail || record.content || '—'}</div></div>
          </>
        )}

        {!create && (
          <div style={{ marginTop: 10 }}>
            <label>
              图片与附件
              {((record.photos || []).length + (record.attachments || []).length) > 0
                ? `（${(record.photos || []).length} 张图片 · ${(record.attachments || []).length} 个附件 · 点击可查看/打开）`
                : ''}
            </label>
            {((record.photos || []).length + (record.attachments || []).length) > 0 ? (
              <div className="fu-files">
                {(record.photos || []).map((u, i) => (
                  <a key={u} className="fu-photo" href={u} target="_blank" rel="noreferrer" title="点击查看原图">
                    <img src={u} alt={`跟进图片 ${i + 1}`} />
                    <span className="hint">查看原图</span>
                  </a>
                ))}
                {(record.attachments || []).map((a) => (
                  <a key={a.url} className="filelink" href={a.url} target="_blank" rel="noreferrer" title={`打开/下载 ${a.name}`}>
                    📎 {a.name}{a.size != null ? `（${money(Math.round(a.size / 1024))}KB）` : ''}
                  </a>
                ))}
              </div>
            ) : <div className="hint" style={{ marginTop: 4 }}>该条跟进没有上传图片或附件</div>}
          </div>
        )}

        {!create && <div style={{ marginTop: 10 }}>
          <label>跟进指导（{(record.comments ?? []).length} 条 · 只读）</label>
          <div style={{ marginTop: 4 }}>
            {(record.comments ?? []).length === 0 ? <span className="hint">暂无跟进指导</span> : <GuidanceNote all comments={record.comments} />}
          </div>
        </div>}

        {err && <div className="msg err" style={{ marginTop: 8 }}>{err}</div>}
        {okMsg && <div className="msg ok" style={{ marginTop: 8 }}>{okMsg}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{editable || create ? '取消' : '关闭'}</button>
          {editable && !create && <button className="btn pri" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存修改'}</button>}
          {create && <button className="btn pri" disabled={busy} onClick={() => void save()}>{busy ? '提交中…' : '建立跟进'}</button>}
        </div>
      </div>
    </div>
  )
}
