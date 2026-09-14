import { useCallback, useEffect, useState } from 'react'
import { get } from './api'

interface Counts { inquiries: number; orders: number; followups: number; users: number; people: number }
interface BackupFile { name: string; size: number; mtime: string }
interface Info {
  instance: { name: string; label: string; id: string; since: string; envLabel: string; byPath: boolean; startedAt: string }
  db: { path: string; size: number; mtime: string; counts: Counts }
  backups: { dir: string; keep: number; count: number; latest: BackupFile | null; items: BackupFile[] }
  uploads: { dir: string; files: number; size: number }
}

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`)
const dt = (s: string) => (s ? new Date(s).toLocaleString('zh-CN') : '—')

/** 设置 · 系统信息：确认当前在看的是哪一份数据（本地开发 / 线上生产），以及自动备份是否正常 */
export default function SystemInfo() {
  const [d, setD] = useState<Info | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    setErr('')
    get<Info>('/admin/system').then(setD).catch((e) => setErr((e as Error).message))
  }, [])
  useEffect(() => { load() }, [load])

  if (err) return <section className="opt-card"><div className="msg err" role="status">✖ {err}</div></section>
  if (!d) return <section className="opt-card"><div className="hint">正在读取系统信息…</div></section>

  const prod = d.instance.name === 'production'
  const rows: { k: string; v: React.ReactNode }[] = [
    { k: '当前实例', v: <span className={'badge ' + (prod ? 'prod' : 'local')}>{d.instance.label}</span> },
    { k: '实例标识', v: <span>{d.instance.name}　<small className="hint">ID {d.instance.id || '—'} · 首次登记 {dt(d.instance.since)}</small></span> },
    { k: '识别方式', v: <span className="hint">{d.instance.envLabel ? `环境变量 SA_INSTANCE=${d.instance.envLabel}` : d.instance.byPath ? '按线上部署目录自动判定（/opt/sales-analytics）' : '按本地目录自动判定（非线上部署路径）'}</span> },
    { k: '本次启动', v: <span>{dt(d.instance.startedAt)}</span> },
    { k: '数据库文件', v: <span title={d.db.path} style={{ wordBreak: 'break-all' }}>{d.db.path}　<small className="hint">{kb(d.db.size)} · 最后写入 {dt(d.db.mtime)}</small></span> },
    { k: '数据量', v: <span>询价 <b>{d.db.counts.inquiries}</b> · 订单 <b>{d.db.counts.orders}</b> · 跟进 <b>{d.db.counts.followups}</b>　<small className="hint">账号 {d.db.counts.users} · 组织人员 {d.db.counts.people}</small></span> },
    { k: '自动备份', v: <span>{d.backups.count} 份（保留 {d.backups.keep} 份 / 最近 {d.backups.keep} 天）　<small className="hint">{d.backups.latest ? `最近：${d.backups.latest.name}（${kb(d.backups.latest.size)} · ${dt(d.backups.latest.mtime)}）` : '暂无备份文件，请检查定时任务'}</small></span> },
    { k: '备份目录', v: <span title={d.backups.dir} style={{ wordBreak: 'break-all' }}>{d.backups.dir}</span> },
    { k: '附件目录', v: <span title={d.uploads.dir} style={{ wordBreak: 'break-all' }}>{d.uploads.files} 个文件 · {kb(d.uploads.size)}</span> },
  ]

  return (
    <div style={{ marginTop: 8, display: 'grid', gap: 10 }}>
      <section className="opt-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <b style={{ fontSize: 14 }}>系统信息</b>
          <span className="hint">用于随时确认「本页看的是哪一份数据」，避免本地测试数据与线上正式数据混淆</span>
          <span style={{ flex: 1 }} />
          <button className="btn xs" onClick={load}>刷新</button>
        </div>
        <table className="grid"><tbody>
          {rows.map((r) => (
            <tr key={r.k}><td style={{ width: 130, color: 'var(--sub)' }}>{r.k}</td><td>{r.v}</td></tr>
          ))}
        </tbody></table>
      </section>
      <section className="opt-card">
        <b style={{ fontSize: 13.5 }}>数据隔离说明</b>
        <ul className="hint" style={{ margin: '6px 0 0 18px', lineHeight: 1.9 }}>
          <li>本地开发库与线上生产库是<b>两份完全独立的数据</b>：本机改动只影响本机，线上同事的录入只影响线上。</li>
          <li>部署脚本<b>只上传程序代码</b>，数据文件（server/data）、备份与 .env 配置一律不进部署包，也不会被覆盖。</li>
          <li>数据库内记录了实例标识，若把本地库当作线上库启动（或反之），服务会<b>拒绝启动</b>并提示，避免两份数据互相顶替。</li>
          <li>备份文件带实例名（如 sales-analytics-{prod ? 'production' : 'local'}-…），恢复时若实例不符会先给出警告。</li>
          <li>需要拿线上数据在本机测试时，请复制一份另存为副本库并改用新的实例名（详见 docs/数据隔离.md），不要直接改线上库。</li>
        </ul>
      </section>
    </div>
  )
}
