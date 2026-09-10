/** 跟进指导的展示组件：只读、醒目标注（左侧色条 + 淡黄底 + 💬 图标） */
export interface GuidanceItem { id?: string; content: string; by_name: string | null; created_at: string }

const fmt = (v: string) => String(v || '').slice(0, 16).replace('T', ' ')

export default function GuidanceNote({ comments, compact, all }: { comments?: GuidanceItem[] | null; compact?: boolean; all?: boolean }) {
  const list = comments ?? []
  if (!list.length) return <span className="hint">—</span>
  const last = list[list.length - 1]
  const allText = list.map((c) => `${c.by_name ?? '—'}（${fmt(c.created_at)}）：${c.content}`).join('\n')
  // 完整展示：每条指导单列一行（评论人 · 时间 + 内容），不截断
  if (all) {
    return (
      <div className="gd-note gd-all">
        {list.map((c, i) => (
          <div key={c.id ?? i} className="gd-item">
            <span className="gd-tag">💬 指导{list.length > 1 ? ` ${i + 1}` : ''}</span>
            <span className="gd-meta">{c.by_name || '—'} · {fmt(c.created_at)}</span>
            <div className="gd-txt-full">{c.content}</div>
          </div>
        ))}
      </div>
    )
  }
  if (compact) {
    return (
      <span className="gd-note gd-compact" title={allText}>
        <span className="gd-tag">💬 指导{list.length > 1 ? ` ${list.length}` : ''}</span>
        <span className="gd-txt">{last.by_name ? `${last.by_name}：` : ''}{last.content}</span>
      </span>
    )
  }
  return (
    <div className="gd-note gd-block" title={allText}>
      <div className="gd-head">💬 跟进指导{list.length > 1 ? ` · 共 ${list.length} 条（悬停查看全部）` : ''}<span className="gd-meta">{last.by_name || '—'} · {fmt(last.created_at)}</span></div>
      <div className="gd-body">{last.content}</div>
    </div>
  )
}
