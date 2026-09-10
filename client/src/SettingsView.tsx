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

      {groups.map((g) => (
        <section key={g.code} style={{ marginBottom: 18 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>
            {g.name} <span className="hint">（可增删改）</span>
            {dirtyGroups.some((x) => x.code === g.code) && <span className="badge" style={{ marginLeft: 6, background: '#fef3c7', color: '#92400e' }}>待保存</span>}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 640 }}>
            {g.values.length === 0 && <div className="hint">暂无选项</div>}
            {g.values.map((v, i) => (
              <div key={v + i} className="row" style={{ marginBottom: 0 }}>
                <span className="badge new" style={{ minWidth: 130 }}>{i + 1}. {v}</span>
                <span style={{ flex: 1 }} />
                <button className="btn sm" onClick={() => setRenaming({ code: g.code, value: v, next: v })}>改名</button>
                <button className="btn sm danger" onClick={() => removeValue(g.code, v)}>删除</button>
              </div>
            ))}
            {renaming && renaming.code === g.code && (
              <div className="row" style={{ marginBottom: 0 }}>
                <input className="sa grow1" value={renaming.next} onChange={(e) => setRenaming({ ...renaming, next: e.target.value })} placeholder="新名称" />
                <button className="btn pri sm" disabled={!renaming.next.trim() || renaming.next === renaming.value}
                  onClick={() => { renameValue(g.code, renaming.value, renaming.next); setRenaming(null) }}>确定改名</button>
                <button className="btn sm" onClick={() => setRenaming(null)}>取消</button>
              </div>
            )}
            <div className="row" style={{ marginBottom: 0 }}>
              <input className="sa grow1" value={adds[g.code] ?? ''} onChange={(e) => setAdds((m) => ({ ...m, [g.code]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') addValue(g.code, adds[g.code] ?? '') }} placeholder="新增选项名称（回车或点添加，需保存后生效）" />
              <button className="btn pri sm" onClick={() => addValue(g.code, adds[g.code] ?? '')}>添加</button>
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

      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
        {dirty && <span className="hint" style={{ alignSelf: 'center' }}>有 {dirtyGroups.length} 组选项未保存</span>}
        <button className="btn" onClick={discard} disabled={!dirty || saving}>放弃修改</button>
        <button className="btn pri" onClick={() => void save()} disabled={!dirty || saving}>{saving ? '保存中…' : '保存'}</button>
      </div>
    </div>
  )
}
