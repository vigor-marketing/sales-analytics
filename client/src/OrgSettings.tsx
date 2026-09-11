import { useCallback, useEffect, useState } from 'react'
import { get, post } from './api'

interface OrgPerson { id: string; name: string; cnName: string; englishName: string; department: string; team: string; role: string; roleLabel: string }
interface DiffRow { name: string; department?: string; team?: string; role?: string; changes?: string[]; refs?: number }
interface LocalState {
  local: { name: string; department: string; team_name: string; role: string }[]
  teams: string[]; syncedAt: string; syncInfo: string
  add: DiffRow[]; update: DiffRow[]; remove: DiffRow[]; unchanged: number
}
interface OrgData {
  base: string; tokenConfigured: boolean; fetchedAt: string
  departments: { name: string; teams: { name: string; persons: OrgPerson[] }[] }[]
  counts: { departments: number; teams: number; persons: number; sales: number; support: number; other: number }
  diff: LocalState
}
const when = (t: string) => (t ? String(t).slice(0, 16).replace('T', ' ') : '—')
/** 上次同步结果（存的是 JSON）转成人看的一行 */
function syncInfoText(raw?: string): string {
  if (!raw) return ''
  try {
    const o = JSON.parse(raw) as { added?: number; updated?: number; removed?: number; total?: number; departments?: number }
    return `新增 ${o.added ?? 0} · 更新 ${o.updated ?? 0} · 删除 ${o.removed ?? 0} · 共 ${o.total ?? 0} 人（${o.departments ?? 0} 个部门）`
  } catch { return raw }
}

/** 设置 · 组织架构：调用工作台组织架构接口，展示「部门 → 小组 → 人员」，并可一键同步到本系统 */
export default function OrgSettings() {
  const [data, setData] = useState<OrgData | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; text: string } | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const load = useCallback(async (keepMsg = false) => {
    setBusy(true); if (!keepMsg) setMsg(null)
    try {
      const d = await get<OrgData>('/org/workbench')
      setData(d)
    } catch (e) { setMsg({ t: 'err', text: `调用工作台失败：${(e as Error).message}` }) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const sync = async () => {
    const rem = (data?.diff.remove ?? []) as DiffRow[]
    if (rem.length) {
      const referenced = rem.filter((r) => (r.refs ?? 0) > 0)
      const warn = `将以工作台为准全量镜像，本系统多出的 ${rem.length} 人会被删除：\\n${rem.map((r) => `${r.name}（${r.department}/${r.team}）${(r.refs ?? 0) > 0 ? ` · 被 ${r.refs} 条记录引用` : ''}`).join('\\n')}`
        + (referenced.length ? `\\n\\n注意：其中 ${referenced.map((r) => r.name).join('、')} 已被历史询价/跟进引用，删除后这些记录里的销售名不再匹配到人员（分析里会归入「未分组」，记录本身不受影响）。` : '')
      if (!window.confirm(warn)) return
    }
    setBusy(true); setMsg(null)
    try {
      const r = await post<{ departments: number; persons: number; applied: { added: number; updated: number; removed: number } }>('/org/sync', {})
      window.dispatchEvent(new Event('sa:meta-changed'))   // 让其它页面的销售/采购下拉刷新
      await load(true)
      setMsg({ t: 'ok', text: `已同步到本系统：${r.departments} 个部门 / ${r.persons} 人（新增 ${r.applied.added} · 更新 ${r.applied.updated} · 删除 ${r.applied.removed}）` })
    } catch (e) { setMsg({ t: 'err', text: `同步失败：${(e as Error).message}` }) }
    finally { setBusy(false) }
  }

  const d = data
  const diffN = (d?.diff.add.length ?? 0) + (d?.diff.update.length ?? 0) + (d?.diff.remove.length ?? 0)
  return (
    <div style={{ marginTop: 8 }}>
      <section className="opt-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>组织架构</b>
          <span className="badge" title="工作台地址">{d?.base ?? '—'}</span>
          {!d?.tokenConfigured && <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>未配置令牌</span>}
          <span className="hint">
            {d ? `${d.counts.departments} 个部门 · ${d.counts.teams} 个小组 · ${d.counts.persons} 人（销售 ${d.counts.sales} · 采购/支持 ${d.counts.support} · 其它 ${d.counts.other}）` : '加载中…'}
            {d ? ` · 上次同步 ${when(d.diff.syncedAt)}` : ''}
          </span>
          <span style={{ flex: 1 }} />
          {diffN > 0 && <span className="badge" style={{ background: '#fff4e5', color: '#a35c00' }}>待同步 {diffN} 处</span>}
          <button className="btn sm" disabled={busy} onClick={() => void load()} title="重新调用工作台组织架构接口">{busy ? '刷新中…' : '刷新'}</button>
          <button className="btn pri sm" disabled={busy} onClick={() => void sync()} title="按工作台全量镜像到本系统人员档案（本系统多出的会删除）">同步到本系统</button>
        </div>
        {msg && <div className={`msg ${msg.t}`}>{msg.text}</div>}
        {d?.diff.syncInfo && !msg && <div className="hint" style={{ marginTop: 4 }}>上次同步结果：{syncInfoText(d.diff.syncInfo)}</div>}
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(d?.departments ?? []).map((dept) => {
            const persons = dept.teams.reduce((a, t) => a + t.persons.length, 0)
            const isOpen = !!open[dept.name]
            return (
              <div key={dept.name} style={{ border: '1px solid var(--line)', borderRadius: 8, background: '#fbfcfe' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer' }} onClick={() => setOpen((o) => ({ ...o, [dept.name]: !isOpen }))}>
                  <span style={{ width: 12, color: 'var(--sub)' }}>{isOpen ? '▾' : '▸'}</span>
                  <b style={{ fontSize: 13 }}>{dept.name}</b>
                  <span className="hint">{dept.teams.length} 个小组 · {persons} 人</span>
                </div>
                {isOpen && (
                  <div style={{ padding: '0 10px 8px 30px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {dept.teams.map((t) => (
                      <div key={t.name} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <b style={{ fontSize: 12.5, minWidth: 110 }}>{t.name}</b>
                        {t.persons.map((p) => (
                          <span key={p.id} className="opt-chip" title={`${p.cnName || ''}${p.englishName ? ` / ${p.englishName}` : ''} · ${p.roleLabel}`}>
                            {p.name}{p.cnName && p.cnName !== p.name ? <span className="hint" style={{ marginLeft: 4 }}>{p.cnName}</span> : null}
                            <span className="hint" style={{ marginLeft: 4 }}>{p.roleLabel}</span>
                          </span>
                        ))}
                        {t.persons.length === 0 && <span className="hint">（无人员）</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {!d && !busy && <div className="hint">尚未取到工作台数据。</div>}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          进入本页自动调用工作台组织架构接口，服务启动时也会后台同步一次；「同步到本系统」＝按工作台全量镜像（销售部→销售人员、采购部/销售支持组→采购人员，本系统多出的删除）。
        </div>
      </section>
    </div>
  )
}
