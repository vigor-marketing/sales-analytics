import { useCallback, useEffect, useState } from 'react'
import { get, post } from './api'

interface OrgPerson { id: string; name: string; cnName: string; englishName: string; department: string; team: string; role: string; roleLabel: string }
interface DiffRow { name: string; department?: string; team?: string; role?: string; changes?: string[]; refs?: number; cnName?: string; roleLabel?: string }
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
const ROLE_LABEL: Record<string, string> = { sales: '销售', support: '采购/支持', other: '其它部门' }
const when = (t: string) => (t ? String(t).slice(0, 19).replace('T', ' ') : '—')

/** 设置 · 组织架构：调用工作台组织架构接口，展示部门/小组/人员，并一键全量镜像到本系统 */
export default function OrgSettings() {
  const [data, setData] = useState<OrgData | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; text: string } | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [local, setLocal] = useState<LocalState | null>(null)

  const load = useCallback(async (keepMsg = false) => {
    setBusy(true); if (!keepMsg) setMsg(null)
    try {
      const d = await get<OrgData>('/org/workbench')
      setData(d); setLocal(d.diff)
    } catch (e) { setMsg({ t: 'err', text: `调用工作台失败：${(e as Error).message}` }) }
    finally { setBusy(false) }
  }, [])
  const loadLocal = useCallback(() => { get<LocalState & { base: string; tokenConfigured: boolean }>('/org/local').then((d) => setLocal(d)).catch(() => { /* */ }) }, [])
  useEffect(() => { void load() }, [load])

  const sync = async () => {
    const rem = (data?.diff.remove ?? []) as DiffRow[]
    if (rem.length) {
      const referenced = rem.filter((r) => (r.refs ?? 0) > 0)
      const warn = `将以工作台为准全量镜像，本系统多出的 ${rem.length} 人会被删除：\n${rem.map((r) => `${r.name}（${r.department}/${r.team}）${(r.refs ?? 0) > 0 ? ` · 被 ${r.refs} 条记录引用` : ''}`).join('\n')}`
        + (referenced.length ? `\n\n注意：其中 ${referenced.map((r) => r.name).join('、')} 已被历史询价/跟进引用，删除后这些记录里的销售名不再匹配到人员（分析里会归入「未分组」，记录本身不受影响）。` : '')
      if (!window.confirm(warn)) return
    }
    setBusy(true); setMsg(null)
    try {
      const r = await post<{ departments: number; persons: number; applied: { added: number; updated: number; removed: number } }>('/org/sync', {})
      window.dispatchEvent(new Event('sa:meta-changed'))   // 让其它页面的销售/采购下拉刷新
      await load(true)                                      // 刷新数据但保留提示信息
      setMsg({ t: 'ok', text: `已同步到本系统：${r.departments} 个部门 / ${r.persons} 人（新增 ${r.applied.added} · 更新 ${r.applied.updated} · 删除 ${r.applied.removed}）` })
    } catch (e) { setMsg({ t: 'err', text: `同步失败：${(e as Error).message}` }) }
    finally { setBusy(false) }
  }

  const d = data
  const diffN = (d?.diff.add.length ?? 0) + (d?.diff.update.length ?? 0) + (d?.diff.remove.length ?? 0)
  return (
    <div style={{ marginTop: 8 }}>
      {/* 对接状态 */}
      <section className="opt-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>工作台组织架构</b>
          <span className="badge" title="工作台地址">来源：{d?.base ?? '—'}</span>
          <span className={'badge' + (d?.tokenConfigured ? ' latest' : '')} title="令牌只在服务端使用，不会出现在前端">{d?.tokenConfigured ? '令牌已配置' : '未配置令牌'}</span>
          <span className="hint">上次拉取：{when(d?.fetchedAt ?? '')}</span>
          <span className="hint">上次同步：{when(local?.syncedAt ?? '')}</span>
          <span style={{ flex: 1 }} />
          {diffN > 0 && <span className="badge" style={{ background: '#fff4e5', color: '#a35c00' }}>有 {diffN} 处待同步</span>}
          <button className="btn sm" disabled={busy} onClick={() => void load()}>{busy ? '刷新中…' : '刷新（调用工作台）'}</button>
          <button className="btn pri sm" disabled={busy} onClick={() => void sync()}>同步到本系统</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          进入本页会自动调用工作台 <code>GET {d?.base ?? ''}/api/org/tree</code>（服务端带令牌，前端拿不到令牌）；服务每次启动也会后台同步一次。
          「同步到本系统」为<b>全量镜像</b>：以工作台为准写入本系统人员档案，本系统多出的人会被删除（历史询价里已记录的销售名不受影响）。
          映射规则：<b>销售部 → 销售人员</b>，<b>采购部 / 销售支持组 → 采购人员</b>，其它部门只同步展示、不进下拉；显示名优先用英文名（与历史数据一致）。
        </div>
        {msg && <div className={`msg ${msg.t}`}>{msg.text}</div>}
        {local?.syncInfo && <div className="hint" style={{ marginTop: 4 }}>上次同步结果：{local.syncInfo}</div>}
      </section>

      {/* 数量概览 + 差异 */}
      <section className="opt-card" style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13.5 }}>对接概览</b>
          <span className="hint">部门 <b>{d?.counts.departments ?? 0}</b> · 小组 <b>{d?.counts.teams ?? 0}</b> · 人员 <b>{d?.counts.persons ?? 0}</b>（销售 <b>{d?.counts.sales ?? 0}</b> · 采购/支持 <b>{d?.counts.support ?? 0}</b> · 其它 <b>{d?.counts.other ?? 0}</b>）</span>
          <span style={{ flex: 1 }} />
          <span className="hint">本系统人员档案 <b>{d?.diff.local.length ?? 0}</b> 人 · 销售小组 <b>{d?.diff.teams.length ?? 0}</b> 个</span>
          <button className="btn xs" onClick={() => void loadLocal()}>重新读取本系统</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <span className="opt-chip" style={{ borderColor: '#bbf7d0' }}>待新增 {d?.diff.add.length ?? 0}</span>
          <span className="opt-chip" style={{ borderColor: '#bfdbfe' }}>待更新 {d?.diff.update.length ?? 0}</span>
          <span className="opt-chip" style={{ borderColor: '#fecaca' }}>待删除 {d?.diff.remove.length ?? 0}</span>
          <span className="opt-chip">无变化 {d?.diff.unchanged ?? 0}</span>
        </div>
        {d && (d.diff.add.length > 0 || d.diff.update.length > 0 || d.diff.remove.length > 0) && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
            {d.diff.add.slice(0, 12).map((r) => <div key={`a-${r.name}`}>➕ <b>{r.name}</b> <span className="hint">{r.cnName ? `${r.cnName} · ` : ''}{r.department} / {r.team} · {ROLE_LABEL[r.role ?? ''] ?? r.role}</span></div>)}
            {d.diff.update.slice(0, 12).map((r) => <div key={`u-${r.name}`}>✏️ <b>{r.name}</b> <span className="hint">{(r.changes ?? []).join(' · ')}</span></div>)}
            {d.diff.remove.slice(0, 12).map((r) => <div key={`r-${r.name}`}>🗑 <b>{r.name}</b> <span className="hint">{r.department} / {r.team}{(r.refs ?? 0) > 0 ? ` · 被 ${r.refs} 条记录引用` : ''}</span></div>)}
            {(d.diff.add.length + d.diff.update.length + d.diff.remove.length) > 36 && <div className="hint">…等共 {d.diff.add.length + d.diff.update.length + d.diff.remove.length} 处差异</div>}
          </div>
        )}
      </section>

      {/* 组织架构树 */}
      <section className="opt-card" style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13.5 }}>组织架构（工作台）</b>
          <span className="hint">部门 → 小组 → 人员；点击部门展开/收起</span>
          <span style={{ flex: 1 }} />
          <button className="btn xs" onClick={() => setOpen(Object.fromEntries((d?.departments ?? []).map((x) => [x.name, true])))}>全部展开</button>
          <button className="btn xs" onClick={() => setOpen({})}>全部收起</button>
        </div>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(d?.departments ?? []).map((dept) => {
            const persons = dept.teams.reduce((a, t) => a + t.persons.length, 0)
            const isOpen = !!open[dept.name]
            const role = ROLE_LABEL[dept.teams[0]?.persons[0]?.role ?? 'other'] ?? '其它部门'
            return (
              <div key={dept.name} style={{ border: '1px solid var(--line)', borderRadius: 8, background: '#fbfcfe' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer' }} onClick={() => setOpen((o) => ({ ...o, [dept.name]: !isOpen }))}>
                  <span style={{ width: 12, color: 'var(--sub)' }}>{isOpen ? '▾' : '▸'}</span>
                  <b style={{ fontSize: 13 }}>{dept.name}</b>
                  <span className="badge">{dept.teams.length} 个小组</span>
                  <span className="badge">{persons} 人</span>
                  <span className="badge" style={{ background: '#eef4ff', color: 'var(--brand)' }}>{role}</span>
                </div>
                {isOpen && (
                  <div style={{ padding: '0 10px 8px 30px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {dept.teams.map((t) => (
                      <div key={t.name} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <b style={{ fontSize: 12.5, minWidth: 110 }}>{t.name}</b>
                        {t.persons.map((p) => (
                          <span key={p.id} className="opt-chip" title={`${p.cnName || ''}${p.englishName ? ` / ${p.englishName}` : ''} · ${p.roleLabel} · ${p.department}/${p.team}`}>
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
      </section>

      {/* 本系统人员档案 */}
      <section className="opt-card" style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13.5 }}>本系统人员档案（同步结果）</b>
          <span className="hint">销售人员进「询报价录入 → 销售」下拉；采购/支持人员进「采购」下拉</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {(local?.local ?? []).map((p) => (
            <span key={`${p.name}-${p.team_name}`} className="opt-chip" title={`${p.department} / ${p.team_name} · ${ROLE_LABEL[p.role] ?? p.role}`}>
              {p.name}<span className="hint" style={{ marginLeft: 4 }}>{p.team_name}</span>
            </span>
          ))}
          {(local?.local ?? []).length === 0 && <span className="hint">本系统人员档案为空（点上方「同步到本系统」从工作台写入）</span>}
        </div>
      </section>
    </div>
  )
}
