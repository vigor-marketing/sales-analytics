/** 跟进指导的展示组件：只读、醒目标注（左侧色条 + 淡黄底 + 💬 图标） */
export interface GuidanceItem { id?: string; content: string; by_name: string | null; created_at: string }

const fmt = (v: string) => String(v || '').slice(0, 16).replace('T', ' ')

export default function GuidanceNote({ comments, compact }: { comments?: GuidanceItem[] | null; compact?: boolean }) {
  const list = comments ?? []
  if (!list.length) return <span className="hint">—</span>
  const last = list[list.length - 1]
  const all = list.map((c) => `${c.by_name ?? '—'}（${fmt(c.created_at)}）：${c.content}`).join('\n')
  if (compact) {
    return (
      <span className="gd-note gd-compact" title={all}>
        <span className="gd-tag">💬 指导{list.length > 1 ? ` ${list.length}` : ''}</span>
        <span className="gd-txt">{last.by_name ? `${last.by_name}：` : ''}{last.content}</span>
      </span>
    )
  }
  return (
    <div className="gd-note gd-block" title={all}>
      <div className="gd-head">💬 跟进指导{list.length > 1 ? ` · 共 ${list.length} 条（悬停查看全部）` : ''}<span className="gd-meta">{last.by_name || '—'} · {fmt(last.created_at)}</span></div>
      <div className="gd-body">{last.content}</div>
    </div>
  )
}
