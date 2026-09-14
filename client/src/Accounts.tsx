import { useCallback, useEffect, useMemo, useState } from 'react'
import { del, get, post, put } from './api'
import { fmtAgo, fmtDateTime, fmtMinute } from './time'

type Scope = 'all' | 'team' | 'self'
interface Acc {
  id: string; username: string; displayName: string; scope: Scope
  team: string; department: string; roleLabel: string
  disabled: boolean; note: string; createdAt: string; updatedAt: string
  /** 是否能在组织架构里找到这个人（账号必须来自组织架构；admin 属系统账号例外） */
  inOrg?: boolean; orgDepartment?: string; orgTeam?: string; orgRole?: string
}
interface TeamOpt { department: string; team: string; count: number }
interface Preset { key: string; label: string; roleLabel: string; scope: Scope; needDept: boolean; needTeam: boolean; desc: string }
interface OrgPerson { name: string; roleLabel: string; head: boolean; hasAccount: boolean; accountRole: string }
interface OrgTeam { team: string; persons: OrgPerson[] }
interface OrgDept { department: string; teams: OrgTeam[] }
interface Data {
  users: Acc[]; departments: string[]; teams: TeamOpt[]; presets: Preset[]; org: OrgDept[]
  defaultPassword: string; defaultPasswordFromEnv: boolean; orgPeopleCount: number
  scopeHelp: Record<Scope, string>
}
interface AuditRow { username: string; ip: string; ua: string; ok: number; reason: string; created_at: string }

/** 账号的可见范围说明（带人数，让人一眼看出这个职位能看多少数据） */
function visibleText(u: Pick<Acc, 'scope' | 'department' | 'team'>, teams: TeamOpt[]): string {
  if (u.scope === 'all') return '全部数据：所有组 / 所有人'
  if (u.scope === 'self') return '只看自己录入 / 参与的数据'
  if (u.team) {
    const n = teams.find((t) => t.department === u.department && t.team === u.team)?.count ?? 0
    return `本组：${u.team}${n ? `（${n} 人）` : ''}`
  }
  if (u.department) {
    const rows = teams.filter((t) => t.department === u.department)
    const n = rows.reduce((a, b) => a + b.count, 0)
    return `本部门：${u.department}（${rows.length} 个小组 / ${n} 人）`
  }
  return '本组（未指定部门，实际等同只看自己）'
}
/** 组织角色 → 默认职位（可再手动改） */
const presetKeyOf = (roleLabel: string): string => {
  if (/总经理|副总/.test(roleLabel)) return 'gm'
  if (/经理|主管|负责人|组长|总监/.test(roleLabel)) return 'team'
  return 'staff'
}
const EMPTY_ADD = { dept: '', team: '', person: '', presetKey: 'staff', password: '' }

/** 设置 · 账号与权限：账号必须从组织架构里选人，再按职位定数据范围 */
export default function Accounts() {
  const [data, setData] = useState<Data | null>(null)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [add, setAdd] = useState({ ...EMPTY_ADD })
  const [pwEdit, setPwEdit] = useState<{ id: string; username: string; password: string } | null>(null)
  const [edit, setEdit] = useState<Acc | null>(null)
  const [defPw, setDefPw] = useState('')
  const [audit, setAudit] = useState<{ rows: AuditRow[]; failLast10Min: number } | null>(null)

  const load = useCallback(async (keepMsg = false) => {
    if (!keepMsg) setMsg(null)
    try {
      const d = await get<Data>('/admin/accounts')
      setData(d); setDefPw(d.defaultPassword)
      get<{ rows: AuditRow[]; failLast10Min: number }>('/admin/login-audit?limit=30').then(setAudit).catch(() => setAudit(null))
    } catch (e) { setMsg({ t: 'err', text: (e as Error).message }) }
  }, [])
  useEffect(() => { void load() }, [load])

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true); setMsg(null)
    try { await fn(); await load(true); setMsg({ t: 'ok', text: okText }) }
    catch (e) { setMsg({ t: 'err', text: (e as Error).message }) }
    finally { setBusy(false) }
  }

  const presets = data?.presets ?? []
  const teams = data?.teams ?? []
  const org = data?.org ?? []
  const presetOf = (key: string) => presets.find((p) => p.key === key) ?? presets[presets.length - 1]
  const addPreset = presetOf(add.presetKey)
  const addDept = org.find((d) => d.department === add.dept)
  const addTeam = addDept?.teams.find((t) => t.team === add.team)
  const addPerson = addTeam?.persons.find((p) => p.name === add.person)
  const loginName = (addPerson?.name ?? '').toLowerCase()

  /** 选人后：自动带出部门/小组与建议职位（可再改） */
  const pickPerson = (name: string) => {
    const team = addTeam
    const per = team?.persons.find((p) => p.name === name)
    setAdd((s) => ({ ...s, person: name, presetKey: per ? presetKeyOf(per.roleLabel) : s.presetKey }))
  }
  const addBlocked = !addPerson || addPerson.hasAccount || add.password.length < 6
    || (!!addPreset?.needDept && !add.dept) || (!!addPreset?.needTeam && !add.team)

  return (
    <div style={{ marginTop: 8 }}>
      <section className="opt-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>账号与权限</b>
          <span className="hint">账号只能从<b>组织架构</b>里选人（部门 → 小组 → 人员），再按职位决定能看到多少数据</span>
          <span style={{ flex: 1 }} />
          <button className="btn sm" disabled={busy} onClick={() => void load()}>{busy ? '刷新中…' : '刷新'}</button>
        </div>
        {msg && <div className={`msg ${msg.t}`}>{msg.text}</div>}

        {/* 权限级别说明 */}
        <div className="opt-grid" style={{ marginTop: 10 }}>
          {presets.map((p) => (
            <div key={p.key} className="opt-card" style={{ margin: 0 }}>
              <b style={{ fontSize: 13 }}>{p.label}</b>
              <div className="hint" style={{ marginTop: 4 }}>{p.desc}</div>
            </div>
          ))}
        </div>

        {/* 新增账号：组织架构选人 */}
        <div className="row" style={{ marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="col w1"><label>部门 *（来自组织架构）</label>
            <select className="sa" value={add.dept} onChange={(e) => setAdd({ ...add, dept: e.target.value, team: '', person: '' })}>
              <option value="">— 请选择部门 —</option>
              {org.map((d) => <option key={d.department} value={d.department}>{d.department}（{d.teams.reduce((a, t) => a + t.persons.length, 0)} 人）</option>)}
            </select>
          </div>
          <div className="col w1"><label>小组 *（来自组织架构）</label>
            <select className="sa" value={add.team} disabled={!add.dept} title={!add.dept ? '请先选择部门' : undefined}
              onChange={(e) => setAdd({ ...add, team: e.target.value, person: '' })}>
              <option value="">— 请选择小组 —</option>
              {(addDept?.teams ?? []).map((t) => <option key={t.team} value={t.team}>{t.team}（{t.persons.length} 人）</option>)}
            </select>
          </div>
          <div className="col w1"><label>人员 *（组织架构里的人）</label>
            <select className="sa" value={add.person} disabled={!add.team} title={!add.team ? '请先选择小组' : undefined}
              onChange={(e) => pickPerson(e.target.value)}>
              <option value="">— 请选择人员 —</option>
              {(addTeam?.persons ?? []).map((p) => (
                <option key={p.name} value={p.name} disabled={p.hasAccount}>
                  {p.name}（{p.roleLabel}）{p.hasAccount ? ` · 已有账号${p.accountRole ? `（${p.accountRole}）` : ''}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="col w1"><label>职位（权限）</label>
            <select className="sa" value={add.presetKey} disabled={!addPerson} onChange={(e) => setAdd({ ...add, presetKey: e.target.value })}>
              {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <div className="col w1"><label>初始密码 *</label>
            <input className="sa" value={add.password} placeholder="至少 6 位" onChange={(e) => setAdd({ ...add, password: e.target.value })} /></div>
          <button className="btn pri" disabled={busy || addBlocked}
            onClick={() => void run(async () => {
              await post('/admin/accounts', {
                orgName: add.person, password: add.password,
                scope: addPreset?.scope ?? 'self', roleLabel: addPreset?.roleLabel ?? '普通成员',
                department: addPreset?.needDept ? add.dept : '', team: addPreset?.needTeam ? add.team : '',
              })
              setAdd({ ...EMPTY_ADD })
            }, `已为「${add.person}」新建账号（登录名 ${loginName}）`)}>新增账号</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {addPerson
            ? <>登录名：<b className="mono">{loginName}</b>（由组织架构里的姓名生成，小写）· 显示名：<b>{addPerson.name}</b> ·
                组织角色：{addPerson.roleLabel} · 可见范围：<b>{visibleText({ scope: addPreset?.scope ?? 'self', department: add.dept, team: add.team }, teams)}</b>
                {addPreset?.needDept ? '（主管/组长可看全组数据，但只能修改自己名下的记录）' : ''}</>
            : '先在组织架构里选到人；组织架构数据来自工作台，可在「组织架构」页同步最新。'}
        </div>

        <div className="tablewrap" style={{ marginTop: 10 }}>
          <table className="grid data-table fixed-table fit-table" style={{ fontSize: 12.5 }}>
            <colgroup><col style={{ width: '16%' }} /><col style={{ width: '10%' }} /><col style={{ width: '20%' }} /><col style={{ width: '22%' }} /><col style={{ width: '9%' }} /><col style={{ width: '11%' }} /><col style={{ width: '12%' }} /></colgroup>
            <thead><tr>{['账号（登录名 / 显示名）', '职位', '组织架构', '可见范围', '状态', '最近修改', '操作'].map((h) => <th key={h} className="cell-left">{h}</th>)}</tr></thead>
            <tbody>
              {(data?.users ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="cell-left"><span className="mono">{u.username}</span><div className="hint">{u.displayName}</div></td>
                  <td className="cell-left"><span className={u.scope === 'all' ? 'badge latest' : 'badge'}>{u.roleLabel}</span></td>
                  <td className="cell-left" title={u.inOrg ? `${u.orgDepartment} / ${u.orgTeam} · ${u.orgRole}` : '该账号不在组织架构里'}>
                    {u.inOrg
                      ? <>{u.orgDepartment} / {u.orgTeam}<div className="hint">{u.orgRole}</div></>
                      : <span className="badge" style={{ background: '#fff4e5', color: '#a35c00' }}>系统账号（不在组织架构）</span>}
                  </td>
                  <td className="cell-left"><span className="cell-note" style={{ marginLeft: 0 }}>{visibleText(u, teams)}</span></td>
                  <td className="cell-left">{u.disabled ? <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>已停用</span> : <span className="badge latest">启用</span>}</td>
                  <td className="cell-left mono hint" title={fmtDateTime(u.updatedAt)}>{fmtMinute(u.updatedAt)}</td>
                  <td className="cell-left">
                    <span className="act-group">
                      <button className="act-btn" onClick={() => setPwEdit({ id: u.id, username: u.username, password: '' })}>改密码</button>
                      <button className="act-btn" onClick={() => setEdit(u)}>编辑</button>
                      <button className="act-btn" onClick={() => void run(() => put(`/admin/accounts/${u.id}`, { disabled: !u.disabled }), u.disabled ? `已启用 ${u.username}` : `已停用 ${u.username}`)}>{u.disabled ? '启用' : '停用'}</button>
                      <button className="act-btn" onClick={() => { if (window.confirm(`删除账号「${u.username}」？`)) void run(() => del(`/admin/accounts/${u.id}`), `已删除 ${u.username}`) }}>删除</button>
                    </span>
                  </td>
                </tr>
              ))}
              {data && data.users.length === 0 && <tr><td colSpan={7} className="hint" style={{ textAlign: 'center' }}>还没有账号（上面的表单可从组织架构选人新建）</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* 组织架构同事的统一初始密码 */}
      <section className="opt-card" style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13.5 }}>组织架构同事的统一初始密码</b>
          <span className="hint">组织架构里的 {data?.orgPeopleCount ?? 0} 位同事可用「英文名（如 vera）+ 这个密码」登录，登录后按组织角色自动定范围</span>
        </div>
        <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
          <div className="col w2"><label>初始密码（留空＝关闭这种登录方式）</label>
            <input className="sa" style={{ width: '100%' }} value={defPw} onChange={(e) => setDefPw(e.target.value)} placeholder="至少 6 位，留空则关闭" />
          </div>
          <button className="btn pri" disabled={busy || (defPw.length > 0 && defPw.length < 6)}
            onClick={() => void run(() => post('/admin/login-default', { password: defPw }), defPw ? '已更新统一初始密码' : '已关闭「英文名 + 初始密码」登录')}>保存</button>
        </div>
        <div className="hint" style={{ marginTop: 4 }}>
          在上面按组织架构建号的人，会以「账号表」的职位为准（优先于组织角色自动判定）。
          {data?.defaultPasswordFromEnv ? ' 当前初始密码来自服务端 .env 的 LOGIN_DEFAULT_PASSWORD（保存后以本页为准）。' : ''}
        </div>
      </section>

      {/* 最近登录记录（发现异常登录用） */}
      <section className="opt-card" style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13.5 }}>最近登录记录</b>
          <span className="hint">每次登录（含失败）都会留痕，按本机时间显示；同 IP 10 分钟失败 8 次或同账号 5 次会被临时拒绝</span>
          <span style={{ flex: 1 }} />
          {audit && audit.failLast10Min > 0 && <span className="badge" style={{ background: '#fff4e5', color: '#a35c00' }}>近 10 分钟失败 {audit.failLast10Min} 次</span>}
          <button className="btn xs" onClick={() => void load()}>刷新</button>
        </div>
        <div className="tablewrap" style={{ marginTop: 8, maxHeight: 260 }}>
          <table className="grid data-table fixed-table fit-table" style={{ fontSize: 12.5 }}>
            <colgroup><col style={{ width: '18%' }} /><col style={{ width: '16%' }} /><col style={{ width: '10%' }} /><col style={{ width: '28%' }} /><col style={{ width: '28%' }} /></colgroup>
            <thead><tr>{['时间（本机）', '账号', '结果', '来源 IP', '说明'].map((h) => <th key={h} className="cell-left">{h}</th>)}</tr></thead>
            <tbody>
              {(audit?.rows ?? []).map((r, i) => (
                <tr key={i}>
                  <td className="cell-left mono" title={fmtDateTime(r.created_at)}>{fmtMinute(r.created_at)}<div className="hint">{fmtAgo(r.created_at)}</div></td>
                  <td className="cell-left">{r.username || '—'}</td>
                  <td className="cell-left">{Number(r.ok) === 1 ? <span className="badge latest">成功</span> : <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>失败</span>}</td>
                  <td className="cell-left mono">{r.ip || '—'}</td>
                  <td className="cell-left" title={r.ua || ''}>{r.reason || '—'}</td>
                </tr>
              ))}
              {audit && audit.rows.length === 0 && <tr><td colSpan={5} className="hint" style={{ textAlign: 'center' }}>暂无登录记录</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* 改密码弹窗 */}
      {pwEdit && (
        <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) setPwEdit(null) }}>
          <div className="modal" style={{ width: 'min(420px, 94vw)' }} role="dialog" aria-modal="true">
            <h3 style={{ margin: 0 }}>修改密码 · {pwEdit.username}</h3>
            <div className="col" style={{ marginTop: 10 }}><label>新密码（至少 6 位）</label>
              <input className="sa" style={{ width: '100%' }} value={pwEdit.password} onChange={(e) => setPwEdit({ ...pwEdit, password: e.target.value })} autoFocus />
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPwEdit(null)}>取消</button>
              <button className="btn pri" disabled={pwEdit.password.length < 6}
                onClick={() => void run(async () => { await put(`/admin/accounts/${pwEdit.id}`, { password: pwEdit.password }); setPwEdit(null) }, `已修改 ${pwEdit.username} 的密码`)}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑账号弹窗 */}
      {edit && (
        <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) setEdit(null) }}>
          <div className="modal" style={{ width: 'min(520px, 94vw)' }} role="dialog" aria-modal="true">
            <h3 style={{ margin: 0 }}>编辑账号 · {edit.username}</h3>
            <div className="hint" style={{ marginTop: 4 }}>
              登录名与显示名来自组织架构（{edit.inOrg ? `${edit.orgDepartment} / ${edit.orgTeam} · ${edit.orgRole}` : '该账号不在组织架构里，属系统账号'}），此处只调整职位与数据范围
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <div className="col w1"><label>职位（权限）</label>
                <select className="sa" value={edit.roleLabel} onChange={(e) => {
                  const label = e.target.value
                  const target = ['总经理', '副总经理'].includes(label) ? 'all' : ['部门主管', '组长'].includes(label) ? 'team' : 'self'
                  setEdit({ ...edit, roleLabel: label, scope: target as Scope })
                }}>
                  {['总经理', '副总经理', '部门主管', '组长', '普通成员'].map((r) => <option key={r} value={r}>{r}</option>)}
                  {!['总经理', '副总经理', '部门主管', '组长', '普通成员'].includes(edit.roleLabel) && <option value={edit.roleLabel}>{edit.roleLabel}</option>}
                </select>
              </div>
            </div>
            {edit.scope === 'team' && (
              <div className="row">
                <div className="col w1"><label>部门 *（组织架构）</label>
                  <select className="sa" value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value, team: '' })}>
                    <option value="">— 请选择部门 —</option>
                    {org.map((d) => <option key={d.department} value={d.department}>{d.department}</option>)}
                  </select>
                </div>
                <div className="col w1"><label>小组（组长必选；部门主管可留空＝整个部门）</label>
                  <select className="sa" value={edit.team} disabled={!edit.department} onChange={(e) => setEdit({ ...edit, team: e.target.value })}>
                    <option value="">— 整个部门 —</option>
                    {(org.find((d) => d.department === edit.department)?.teams ?? []).map((t) => (
                      <option key={t.team} value={t.team}>{t.team}（{t.persons.length} 人）</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div className="hint" style={{ marginTop: 6 }}>
              保存后可见范围：<b>{visibleText(edit, teams)}</b>
              {edit.scope === 'team' ? '（可看全组数据，但只能修改自己名下的记录）' : ''}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setEdit(null)}>取消</button>
              <button className="btn pri" disabled={busy} onClick={() => void run(async () => {
                await put(`/admin/accounts/${edit.id}`, {
                  scope: edit.scope, roleLabel: edit.roleLabel,
                  department: edit.scope === 'team' ? edit.department : '', team: edit.scope === 'team' ? edit.team : '',
                }); setEdit(null)
              }, `已保存 ${edit.username}`)}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
