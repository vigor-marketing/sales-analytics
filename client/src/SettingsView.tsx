import { useCallback, useEffect, useState } from 'react'
import { get, post } from './api'

interface Group { code: string; name: string; values: string[] }
interface Options { editable: Group[]; fixed: Group[] }

export default function SettingsView() {
  const [groups, setGroups] = useState<Group[]>([])
  const [saved, setSaved] = useState<Group[]>([])   // 已保存的版本，用于判断是否有未保存修改
  const [fixed, setFixed] = useState<Group[]>([])
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; text: string } | null>(null)
  const [adds, setAdds] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState<{ code: string; value: string; next: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    get<Options>('/options').then((d) => {
      if (!d || !d.editable) throw new Error('options 返回异常')
      setGroups(JSON.parse(JSON.stringify(d.editable)))
      setSaved(JSON.parse(JSON.stringify(d.editable)))
      setFixed(d.fixed)
    }).catch((e) => setMsg({ t: 'err', text: '加载失败：' + (e as Error).message }))
  }, [])
  useEffect(() => { load() }, [load])

  const dirtyGroups = groups.filter((g) => {
    const old = saved.find((x) => x.code === g.code)
    return !old || JSON.stringify(old.values) !== JSON.stringify(g.values)
  })
  const dirty = dirtyGroups.length > 0

  // 本地编辑（不落库，点保存才提交）
  const mutate = (code: string, fn: (list: string[]) => string[]) => {
    setMsg(null)
    setGroups((gs) => gs.map((g) => (g.code === code ? { ...g, values: fn([...g.values]) } : g)))
  }
  const addValue = (code: string, value: string) => {
    const v = value.trim()
    if (!v) return
    mutate(code, (list) => (list.includes(v) ? list : [...list, v]))
    setAdds((m) => ({ ...m, [code]: '' }))
  }
  // 删除同样先改本地，点「保存」才落库（与新增/改名一致）
  const removeValue = (code: string, value: string) => {
    mutate(code, (list) => list.filter((x) => x !== value))
  }
  const renameValue = (code: string, value: string, next: string) => {
    const v = next.trim()
    if (!v || v === value) return
    mutate(code, (list) => list.map((x) => (x === value ? v : x)))
  }

  const save = async () => {
    if (!dirtyGroups.length) return
    setSaving(true); setMsg(null)
    try {
      for (const g of dirtyGroups) {
        await post('/options/save', { code: g.code, values: g.values })
      }
      // 保存失败过的删除操作会在这里被整体覆盖，保证前后端一致
      setSaved(JSON.parse(JSON.stringify(groups)))
      setMsg({ t: 'ok', text: `已保存（${dirtyGroups.map((g) => g.name).join('、')}）` })
      window.dispatchEvent(new Event('sa:meta-changed'))
      load()
    } catch (e) { setMsg({ t: 'err', text: (e as Error).message }) } finally { setSaving(false) }
  }
  const discard = () => { setGroups(JSON.parse(JSON.stringify(saved))); setRenaming(null); setAdds({}); setMsg(null) }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>字段与选项设置</h2>
        <span className="hint">统一管理下拉选项：新增／改名／删除后点「保存」生效；历史记录保留原值展示。</span>
        <span style={{ flex: 1 }} />
        {dirty && <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>有未保存修改</span>}
        <button className="btn" onClick={discard} disabled={!dirty || saving}>放弃修改</button>
        <button className="btn pri" onClick={() => void save()} disabled={!dirty || saving}>{saving ? '保存中…' : `保存${dirty ? `（${dirtyGroups.length} 组）` : ''}`}</button>
      </div>
      {msg && <div className={`msg ${msg.t}`}>{msg.t === 'ok' ? '✔' : '✖'} {msg.text}</div>}

      {/* 选项组：两列卡片 + 标签式选项（点标签改名、× 删除），大幅压缩页面高度 */}
      <div className="opt-grid">
        {groups.map((g) => (
          <section key={g.code} className="opt-card">
            <div className="opt-head">
              <h4 className="opt-title">{g.name}</h4>
              <span className="hint">{g.values.length} 项</span>
              {dirtyGroups.some((x) => x.code === g.code) && <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>待保存</span>}
            </div>
            <div className="opt-chips">
              {g.values.length === 0 && <span className="hint">暂无选项，右侧输入即可新增</span>}
              {g.values.map((v, i) => (
                renaming && renaming.code === g.code && renaming.value === v ? (
                  <span key={v + i} className="opt-chip editing">
                    <input className="sa opt-edit" autoFocus value={renaming.next} placeholder="新名称"
                      onChange={(e) => setRenaming({ ...renaming, next: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && renaming.next.trim() && renaming.next !== renaming.value) { renameValue(g.code, renaming.value, renaming.next); setRenaming(null) }
                        if (e.key === 'Escape') setRenaming(null)
                      }} />
                    <button className="opt-x ok" title="确定改名" disabled={!renaming.next.trim() || renaming.next === renaming.value}
                      onClick={() => { renameValue(g.code, renaming.value, renaming.next); setRenaming(null) }}>✓</button>
                    <button className="opt-x" title="取消" onClick={() => setRenaming(null)}>×</button>
                  </span>
                ) : (
                  <span key={v + i} className="opt-chip" title={`第 ${i + 1} 项 · 点名称可改名；× 删除`}>
                    <button className="opt-name" onClick={() => setRenaming({ code: g.code, value: v, next: v })}>{v}</button>
                    <button className="opt-x" title={`删除「${v}」`} onClick={() => removeValue(g.code, v)}>×</button>
                  </span>
                )
              ))}
            </div>
            <div className="opt-add">
              <input className="sa" value={adds[g.code] ?? ''} placeholder="新增选项…"
                onChange={(e) => setAdds((m) => ({ ...m, [g.code]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') addValue(g.code, adds[g.code] ?? '') }} />
              <button className="btn sm pri" disabled={!(adds[g.code] ?? '').trim()} onClick={() => addValue(g.code, adds[g.code] ?? '')}>添加</button>
            </div>
          </section>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>点选项名称即可改名（回车确认 / Esc 取消），× 删除；改完后点右上角「保存」生效，历史记录保留原值展示。</div>

      {fixed.map((g) => (
        <section key={g.code} style={{ marginBottom: 10 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>{g.name} <span className="hint">（系统固定）</span></h3>
          <div className="row" style={{ marginBottom: 0 }}>{g.values.map((v) => <span key={v} className="badge grey">{v}</span>)}</div>
        </section>
      ))}

    </div>
  )
}
