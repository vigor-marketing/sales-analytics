import { useCallback, useEffect, useMemo, useState } from 'react'
import { del, get, post, put } from './api'

type Scope = 'all' | 'team' | 'self'
interface Acc {
  id: string; username: string; displayName: string; scope: Scope
  team: string; department: string; roleLabel: string
  disabled: boolean; note: string; createdAt: string; updatedAt: string
}
interface TeamOpt { department: string; team: string; count: number }
interface Preset { key: string; label: string; roleLabel: string; scope: Scope; needDept: boolean; needTeam: boolean; desc: string }
interface Data {
  users: Acc[]; departments: string[]; teams: TeamOpt[]; presets: Preset[]
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

const EMPTY_ADD = { username: '', displayName: '', password: '', presetKey: 'staff', department: '', team: '' }

/** 设置 · 账号与权限：按职位分配数据范围（总经理/副总＝全部、部门主管＝本部门、组长＝本组、成员＝只看自己） */
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
  const departments = data?.departments ?? []
  const presetOf = (key: string) => presets.find((p) => p.key === key) ?? presets[presets.length - 1]
  const addPreset = presetOf(add.presetKey)
  const teamsOfDept = useMemo(() => teams.filter((t) => t.department === add.department), [teams, add.department])

  const pickPreset = (key: string) => {
    const p = presetOf(key)
    setAdd((s) => ({
      ...s, presetKey: p.key,
      department: p.needDept ? (s.department || '') : '',
      team: p.needTeam ? s.team : '',
    }))
  }
  const addPayload = () => ({
    username: add.username.trim(), displayName: add.displayName.trim() || add.username.trim(), password: add.password,
    scope: addPreset?.scope ?? 'self', roleLabel: addPreset?.roleLabel ?? '普通成员',
    department: addPreset?.needDept ? add.department : '', team: addPreset?.needTeam ? add.team : '',
  })
  const addBlocked = !add.username.trim() || add.password.length < 6
    || (!!addPreset?.needDept && !add.department) || (!!addPreset?.needTeam && !add.team)

  return (
    <div style={{ marginTop: 8 }}>
      <section className="opt-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>账号与权限</b>
          <span className="hint">给账号选「职位」即可定权限：总经理 / 副总看全部，部门主管看本部门，组长看本组，成员只看自己</span>
          <span style={{ flex: 1 }} />
          <button className="btn sm" disabled={busy} onClick={() => void load()}>{busy ? '刷新中…' : '刷新'}</button>
        </div>
        {msg && <div className={`msg ${msg.t}`}>{msg.text}</div>}

        {/* 权限级别说明 */}
        <div className="opt-grid" style={{ marginTop: 10 }}>
          {(presets.length ? presets : []).map((p) => (
            <div key={p.key} className="opt-card" style={{ margin: 0 }}>
              <b style={{ fontSize: 13 }}>{p.label}</b>
              <div className="hint" style={{ marginTop: 4 }}>{p.desc}</div>
            </div>
          ))}
        </div>

        {/* 新增账号 */}
        <div className="row" style={{ marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="col w1"><label>账号 *</label><input className="sa" value={add.username} placeholder="如 lisa" onChange={(e) => setAdd({ ...add, username: e.target.value })} /></div>
          <div className="col w1"><label>显示名（须与询价里的销售名一致）</label><input className="sa" value={add.displayName} placeholder="如 Vera" onChange={(e) => setAdd({ ...add, displayName: e.target.value })} /></div>
          <div className="col w1"><label>初始密码 *</label><input className="sa" value={add.password} placeholder="至少 6 位" onChange={(e) => setAdd({ ...add, password: e.target.value })} /></div>
          <div className="col w1"><label>职位（权限）</label>
            <select className="sa" value={add.presetKey} onChange={(e) => pickPreset(e.target.value)}>
              {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          {addPreset?.needDept && (
            <div className="col w1"><label>部门 *</label>
              <select className="sa" value={add.department} onChange={(e) => setAdd({ ...add, department: e.target.value, team: '' })}>
                <option value="">— 请选择部门 —</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          {addPreset?.needTeam && (
            <div className="col w1"><label>小组 *</label>
              <select className="sa" value={add.team} disabled={!add.department} title={!add.department ? '请先选择部门' : undefined} onChange={(e) => setAdd({ ...add, team: e.target.value })}>
                <option value="">— 请选择小组 —</option>
                {teamsOfDept.map((t) => <option key={t.team} value={t.team}>{t.team}（{t.count} 人）</option>)}
              </select>
            </div>
          )}
          <button className="btn pri" disabled={busy || addBlocked}
            onClick={() => void run(async () => { await post('/admin/accounts', addPayload()); setAdd({ ...EMPTY_ADD }) }, `已新增账号：${add.username}（${addPreset?.label}）`)}>新增账号</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          该账号可见范围：<b>{visibleText({ scope: addPreset?.scope ?? 'self', department: add.department, team: add.team }, teams)}</b>
          {addPreset?.needDept ? '（主管/组长可看全组数据，但只能修改自己名下的记录）' : ''}
        </div>

        <div className="tablewrap" style={{ marginTop: 10 }}>
          <table className="grid data-table fixed-table fit-table" style={{ fontSize: 12.5 }}>
            <colgroup><col style={{ width: '12%' }} /><col style={{ width: '14%' }} /><col style={{ width: '12%' }} /><col style={{ width: '26%' }} /><col style={{ width: '9%' }} /><col style={{ width: '12%' }} /><col style={{ width: '15%' }} /></colgroup>
            <thead><tr>{['账号', '显示名', '职位', '可见范围', '状态', '最近修改', '操作'].map((h) => <th key={h} className="cell-left">{h}</th>)}</tr></thead>
            <tbody>
              {(data?.users ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="cell-left mono">{u.username}</td>
                  <td className="cell-left">{u.displayName}</td>
                  <td className="cell-left">
                    <span className={u.scope === 'all' ? 'badge latest' : 'badge'}>{u.roleLabel}</span>
                  </td>
                  <td className="cell-left" title={visibleText(u, teams)}>
                    <span className="cell-note" style={{ marginLeft: 0 }}>{visibleText(u, teams)}</span>
                  </td>
                  <td className="cell-left">{u.disabled ? <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>已停用</span> : <span className="badge latest">启用</span>}</td>
                  <td className="cell-left mono hint">{String(u.updatedAt || '').slice(0, 16).replace('T', ' ')}</td>
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
              {data && data.users.length === 0 && <tr><td colSpan={7} className="hint" style={{ textAlign: 'center' }}>还没有账号（上面的表单可新增）</td></tr>}
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
          想让某人用固定权限登录，就在上面新增一个同名的账号（账号表优先于组织架构自动判定）。
          {data?.defaultPasswordFromEnv ? ' 当前初始密码来自服务端 .env 的 LOGIN_DEFAULT_PASSWORD（保存后以本页为准）。' : ''}
        </div>
      </section>

      {/* 最近登录记录（发现异常登录用） */}
      <section className="opt-card" style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13.5 }}>最近登录记录</b>
          <span className="hint">每次登录（含失败）都会留痕；同 IP 10 分钟失败 8 次或同账号 5 次会被临时拒绝</span>
          <span style={{ flex: 1 }} />
          {audit && audit.failLast10Min > 0 && <span className="badge" style={{ background: '#fff4e5', color: '#a35c00' }}>近 10 分钟失败 {audit.failLast10Min} 次</span>}
          <button className="btn xs" onClick={() => void load()}>刷新</button>
        </div>
        <div className="tablewrap" style={{ marginTop: 8, maxHeight: 260 }}>
          <table className="grid data-table fixed-table fit-table" style={{ fontSize: 12.5 }}>
            <colgroup><col style={{ width: '16%' }} /><col style={{ width: '16%' }} /><col style={{ width: '10%' }} /><col style={{ width: '30%' }} /><col style={{ width: '28%' }} /></colgroup>
            <thead><tr>{['时间', '账号', '结果', '来源 IP', '说明'].map((h) => <th key={h} className="cell-left">{h}</th>)}</tr></thead>
            <tbody>
              {(audit?.rows ?? []).map((r, i) => (
                <tr key={i}>
                  <td className="cell-left mono">{String(r.created_at).slice(0, 19).replace('T', ' ')}</td>
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
            <div className="row" style={{ marginTop: 10 }}>
              <div className="col w2"><label>显示名（须与询价里的销售名一致）</label><input className="sa" style={{ width: '100%' }} value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} /></div>
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
                <div className="col w1"><label>部门 *</label>
                  <select className="sa" value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value, team: '' })}>
                    <option value="">— 请选择部门 —</option>
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="col w1"><label>小组（组长必选；部门主管可留空＝整个部门）</label>
                  <select className="sa" value={edit.team} disabled={!edit.department} onChange={(e) => setEdit({ ...edit, team: e.target.value })}>
                    <option value="">— 整个部门 —</option>
                    {teams.filter((t) => t.department === edit.department).map((t) => <option key={t.team} value={t.team}>{t.team}（{t.count} 人）</option>)}
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
                  displayName: edit.displayName, scope: edit.scope, roleLabel: edit.roleLabel,
                  department: edit.department, team: edit.scope === 'team' ? edit.team : '',
                }); setEdit(null)
              }, `已保存 ${edit.username}`)}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
