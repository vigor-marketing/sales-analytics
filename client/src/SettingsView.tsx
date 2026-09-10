import { useCallback, useEffect, useState } from 'react'
import { get, post } from './api'

interface Group { code: string; name: string; values: string[] }
interface Options { editable: Group[]; fixed: Group[] }

export default function SettingsView() {
  const [editable, setEditable] = useState<Group[]>([])
  const [fixed, setFixed] = useState<Group[]>([])
  const [msg, setMsg] = useState('')
  const [adds, setAdds] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState<{ code: string; value: string; next: string } | null>(null)

  const load = useCallback(() => { get<Options>('/options').then((d) => { if (!d || !d.editable) throw new Error('options 返回异常'); setEditable(d.editable); setFixed(d.fixed) }).catch((e) => setMsg('加载失败：' + (e as Error).message)) }, [])
  useEffect(() => { void load() }, [load])

  const save = async (code: string, action: string, value: string, newValue?: string) => {
    const url = code === 'source' ? '/sources' : code === 'follow_method' ? '/follow-methods' : code === 'lost_reason' ? '/lost-reasons' : code === 'win_reason' ? '/win-reasons' : '/countries-custom'
    try {
      const list = await post<string[]>(url, { action, value, newValue })
      setEditable((g) => g.map((x) => (x.code === code ? { ...x, values: list } : x)))
      setMsg(action === 'add' ? `已添加「${value}」` : action === 'remove' ? `已删除「${value}」` : `已改名为「${newValue}」`)
    } catch (e) { setMsg((e as Error).message) }
  }
  return (
    <div className="card">
      <h2 style={{ margin: '0 0 6px' }}>字段与选项设置</h2>
      <div className="hint" style={{ marginBottom: 8 }}>统一管理下拉选项：新增/改名/删除即时生效；历史记录保留原值展示，删除只影响以后录入。</div>
      {msg && <div className="msg ok">{msg}</div>}
      {editable.map((g) => (
        <section key={g.code} style={{ marginBottom: 18 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>{g.name} <span className="hint">（可增删改）</span></h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 640 }}>
            {g.values.length === 0 && <div className="hint">暂无选项</div>}
            {g.values.map((v, i) => (
              <div key={v + i} className="row" style={{ marginBottom: 0 }}>
                <span className="badge new" style={{ minWidth: 130 }}>{i + 1}. {v}</span>
                <span style={{ flex: 1 }} />
                <button className="btn sm" onClick={() => setRenaming({ code: g.code, value: v, next: v })}>改名</button>
                <button className="btn sm danger" onClick={() => void save(g.code, 'remove', v)}>删除</button>
              </div>
            ))}
            {renaming && renaming.code === g.code && (
              <div className="row" style={{ marginBottom: 0 }}>
                <input className="sa grow1" value={renaming.next} onChange={(e) => setRenaming({ ...renaming, next: e.target.value })} placeholder="新名称" />
                <button className="btn pri sm" disabled={!renaming.next.trim() || renaming.next === renaming.value} onClick={() => { void save(g.code, 'rename', renaming.value, renaming.next.trim()); setRenaming(null) }}>确定改名</button>
                <button className="btn sm" onClick={() => setRenaming(null)}>取消</button>
              </div>
            )}
            <div className="row" style={{ marginBottom: 0 }}>
              <input className="sa grow1" value={adds[g.code] ?? ''} onChange={(e) => setAdds((m) => ({ ...m, [g.code]: e.target.value }))} placeholder="新增选项名称" />
              <button className="btn pri sm" onClick={() => { const v = (adds[g.code] ?? '').trim(); if (!v) return; void save(g.code, 'add', v); setAdds((m) => ({ ...m, [g.code]: '' })) }}>添加</button>
            </div>
          </div>
        </section>
      ))}
      {fixed.map((g) => (
        <section key={g.code} style={{ marginBottom: 10 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>{g.name} <span className="hint">（系统固定）</span></h3>
          <div className="row" style={{ marginBottom: 0 }}>{g.values.map((v) => <span key={v} className="badge grey">{v}</span>)}</div>
        </section>
      ))}
    </div>
  )
}
