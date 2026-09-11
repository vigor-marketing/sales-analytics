import { useCallback, useEffect, useState } from 'react'
import { del, get, post, put } from './api'
import { SCOPE_LABEL } from './Login'

interface Acc { id: string; username: string; displayName: string; scope: 'all' | 'team' | 'self'; team: string; disabled: boolean; note: string; createdAt: string; updatedAt: string }
interface Data { users: Acc[]; defaultPassword: string; defaultPasswordFromEnv: boolean; orgPeopleCount: number }

/** 设置 · 账号与权限：新增/改密码/改范围/停用/删除账号，以及组织架构同事的统一初始密码 */
export default function Accounts() {
  const [data, setData] = useState<Data | null>(null)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [add, setAdd] = useState({ username: '', displayName: '', password: '', scope: 'self' as Acc['scope'], team: '' })
  const [pwEdit, setPwEdit] = useState<{ id: string; username: string; password: string } | null>(null)
  const [edit, setEdit] = useState<Acc | null>(null)
  const [defPw, setDefPw] = useState('')

  const load = useCallback(async (keepMsg = false) => {
    if (!keepMsg) setMsg(null)
    try {
      const d = await get<Data>('/admin/accounts')
      setData(d); setDefPw(d.defaultPassword)
    } catch (e) { setMsg({ t: 'err', text: (e as Error).message }) }
  }, [])
  useEffect(() => { void load() }, [load])

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true); setMsg(null)
    try { await fn(); await load(true); setMsg({ t: 'ok', text: okText }) }
    catch (e) { setMsg({ t: 'err', text: (e as Error).message }) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <section className="opt-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>账号与权限</b>
          <span className="hint">账号用于登录本系统；范围决定能看到多少数据（{SCOPE_LABEL.all} / {SCOPE_LABEL.team} / {SCOPE_LABEL.self}）</span>
          <span style={{ flex: 1 }} />
          <button className="btn sm" disabled={busy} onClick={() => void load()}>{busy ? '刷新中…' : '刷新'}</button>
        </div>
        {msg && <div className={`msg ${msg.t}`}>{msg.text}</div>}

        {/* 新增账号 */}
        <div className="row" style={{ marginTop: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="col w1"><label>账号 *</label><input className="sa" value={add.username} placeholder="如 lisa" onChange={(e) => setAdd({ ...add, username: e.target.value })} /></div>
          <div className="col w1"><label>显示名（须与组织架构里的销售名一致）</label><input className="sa" style={{ width: 180 }} value={add.displayName} placeholder="如 Vera" onChange={(e) => setAdd({ ...add, displayName: e.target.value })} /></div>
          <div className="col w1"><label>初始密码 *</label><input className="sa" value={add.password} placeholder="至少 6 位" onChange={(e) => setAdd({ ...add, password: e.target.value })} /></div>
          <div className="col w1"><label>数据范围</label>
            <select className="sa" value={add.scope} onChange={(e) => setAdd({ ...add, scope: e.target.value as Acc['scope'] })}>
              <option value="self">只看自己</option><option value="team">本组数据</option><option value="all">全部数据</option>
            </select>
          </div>
          <div className="col w1"><label>小组（选填，本组范围用）</label><input className="sa" value={add.team} placeholder="如 V3(环球猎单)" onChange={(e) => setAdd({ ...add, team: e.target.value })} /></div>
          <button className="btn pri" disabled={busy || !add.username.trim() || add.password.length < 6}
            onClick={() => void run(async () => { await post('/admin/accounts', add); setAdd({ username: '', displayName: '', password: '', scope: 'self', team: '' }) }, `已新增账号：${add.username}`)}>新增账号</button>
        </div>

        <div className="tablewrap" style={{ marginTop: 10 }}>
          <table className="grid data-table fixed-table fit-table" style={{ fontSize: 12.5 }}>
            <colgroup><col style={{ width: '14%' }} /><col style={{ width: '16%' }} /><col style={{ width: '12%' }} /><col style={{ width: '14%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} /><col style={{ width: '20%' }} /></colgroup>
            <thead><tr>{['账号', '显示名', '数据范围', '小组', '状态', '最近修改', '操作'].map((h) => <th key={h} className="cell-left">{h}</th>)}</tr></thead>
            <tbody>
              {(data?.users ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="cell-left mono">{u.username}</td>
                  <td className="cell-left">{u.displayName}</td>
                  <td className="cell-left">{SCOPE_LABEL[u.scope]}</td>
                  <td className="cell-left">{u.team || '—'}</td>
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
        {data?.defaultPasswordFromEnv && <div className="hint" style={{ marginTop: 4 }}>当前值来自服务端 .env 的 LOGIN_DEFAULT_PASSWORD（保存后改为以本页为准）。</div>}
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
          <div className="modal" style={{ width: 'min(460px, 94vw)' }} role="dialog" aria-modal="true">
            <h3 style={{ margin: 0 }}>编辑账号 · {edit.username}</h3>
            <div className="row" style={{ marginTop: 10 }}>
              <div className="col w2"><label>显示名</label><input className="sa" style={{ width: '100%' }} value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} /></div>
              <div className="col w1"><label>数据范围</label>
                <select className="sa" value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value as Acc['scope'] })}>
                  <option value="self">只看自己</option><option value="team">本组数据</option><option value="all">全部数据</option>
                </select>
              </div>
              <div className="col w1"><label>小组</label><input className="sa" value={edit.team} onChange={(e) => setEdit({ ...edit, team: e.target.value })} /></div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setEdit(null)}>取消</button>
              <button className="btn pri" onClick={() => void run(async () => {
                await put(`/admin/accounts/${edit.id}`, { displayName: edit.displayName, scope: edit.scope, team: edit.team }); setEdit(null)
              }, `已保存 ${edit.username}`)}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
