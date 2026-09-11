import { useState } from 'react'
import { post } from './api'

export interface SaActor {
  username: string; name: string; cnName: string; role: string; roleLabel: string
  department: string; team: string; head: boolean; isAdmin: boolean
  scope: 'all' | 'team' | 'self'; reason: string
  readNames: string[] | null; writeNames: string[] | null
}
export const SCOPE_LABEL: Record<SaActor['scope'], string> = { all: '全部数据', team: '本组数据', self: '只看自己' }

/** 登录页：本系统自带的简单登录入口（账号在服务端 server/.env 配置；后续再与工作台合并单点登录） */
export default function Login({ onDone }: { onDone: (a: SaActor) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async () => {
    if (!username.trim() || !password) return setErr('请输入账号和密码')
    setBusy(true); setErr('')
    try {
      const r = await post<{ actor: SaActor }>('/auth/login', { username: username.trim(), password })
      onDone(r.actor)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6fb' }}>
      <div className="card" style={{ width: 'min(420px, 94vw)', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="sa-logo" style={{ width: 34, height: 34 }}>销</span>
          <div>
            <b style={{ fontSize: 16 }}>销售数据分析</b>
            <div className="hint">本系统登录入口 · 账号＝你的英文名（与工作台一致）</div>
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="col"><label>账号</label>
            <input className="sa" style={{ width: '100%' }} value={username} autoFocus placeholder="账号（如 vera / joseph）"
              onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
          </div>
          <div className="col"><label>密码</label>
            <input className="sa" style={{ width: '100%' }} type="password" value={password} placeholder="工作台密码"
              onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
          </div>
          {err && <div className="msg err">{err}</div>}
          <button className="btn pri" disabled={busy} onClick={() => void submit()}>{busy ? '登录中…' : '登录'}</button>
          <div className="hint">数据范围：总经理 / 分管销售副总 → 全部数据；销售经理 / 部门负责人 → 本组数据；销售员 → 只看自己的（组长只看不改别人的）。</div>
          <div className="hint" style={{ borderTop: '1px dashed var(--line)', paddingTop: 8 }}>
            账号＝组织架构里的英文名（如 vera、joseph、erica），初始密码由管理员统一发放；忘记密码请联系管理员。后续与工作台合并单点登录后会改为免密登录。
          </div>
        </div>
      </div>
    </div>
  )
}
