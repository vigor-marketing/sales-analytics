import { useCallback, useEffect, useState } from 'react'
import { get } from './api'
import { StatusChip } from './StatusChip'

interface Brief {
  id: string; inquiry_no: string; date: string; sales: string; purchaser: string; customer_name: string
  customer_stars: number | null; last_followup_at: string | null; next_followup_at: string | null; usd: number
}
interface Kpi {
  inqCount: number; inqUsd: number; wonCount: number; wonUsd: number; lostCount: number; lostUsd: number
  winRate: number; followCount: number; newCustomers: number; openCount: number
}
interface Rank { name: string; n: number; usd: number }
interface Dash {
  month: string; today: string; weekEnd: string
  kpi: Kpi
  reminders: { overdue: Brief[]; dueSoon: Brief[]; stale: Brief[]; staleDays: number; counts: { overdue: number; dueSoon: number; stale: number } }
  monthBySales: Rank[]; monthByProduct: Rank[]
}

const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('zh-CN'))
const fmt = (v: string | null) => (v ? String(v).slice(0, 16).replace('T', ' ') : '—')

export default function Dashboard({ onGoFollow }: { onGoFollow?: (t: { sales: string; no: string }) => void }) {
  const [d, setD] = useState<Dash | null>(null)
  const [err, setErr] = useState('')
  const [group, setGroup] = useState<'overdue' | 'dueSoon' | 'stale'>('overdue')
  const load = useCallback(() => {
    get<Dash>('/dashboard').then((x) => {
      setD(x)
      // 默认展示有内容的提醒分组：逾期 → 本周 → 超期
      const c = x.reminders.counts
      setGroup(c.overdue > 0 ? 'overdue' : c.dueSoon > 0 ? 'dueSoon' : 'stale')
    }).catch((e) => setErr((e as Error).message))
  }, [])
  useEffect(() => { load() }, [load])

  const groupMeta = [
    { key: 'overdue' as const, label: '逾期未跟进', tone: '#dc2626', note: '计划跟进时间已过，仍未跟进' },
    { key: 'dueSoon' as const, label: '本周待跟进', tone: '#a35c00', note: `今天 ~ 本周末（${d?.weekEnd ?? ''}）计划跟进` },
    { key: 'stale' as const, label: '超期未跟进', tone: 'var(--brand)', note: `距上次跟进超过 ${d?.reminders.staleDays ?? 7} 天（或从未跟进）` },
  ]
  const cur = groupMeta.find((g) => g.key === group)!
  const list = d?.reminders[group] ?? []

  return (
    <>
      <section className="card panel-tight">
        <div className="panel-head">
          <h4 className="panel-title">仪表盘</h4>
          <span className="hint panel-hint">{d ? `${d.month} 本月数据与跟进提醒 · 今天 ${d.today}` : '加载中…'}</span>
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={load}>刷新</button>
        </div>
        {err && <div className="msg err">{err}</div>}
        <div className="kpi-grid" style={{ marginTop: 10 }}>
          <div className="kpi-chip"><span className="kpi-label">本月新增询价</span><b className="kpi-value">{d?.kpi.inqCount ?? 0}<small style={{ fontSize: 13, fontWeight: 600, color: 'var(--sub)' }}> 条</small></b><span className="kpi-note">报价合计 ≈USD {money(d?.kpi.inqUsd)}</span></div>
          <div className="kpi-chip"><span className="kpi-label">本月成单</span><b className="kpi-value" style={{ color: '#059669' }}>{d?.kpi.wonCount ?? 0}<small style={{ fontSize: 13, fontWeight: 600, color: 'var(--sub)' }}> 单</small></b><span className="kpi-note">成交金额 ≈USD {money(d?.kpi.wonUsd)}</span></div>
          <div className="kpi-chip"><span className="kpi-label">本月未成单</span><b className="kpi-value" style={{ color: 'var(--danger)' }}>{d?.kpi.lostCount ?? 0}<small style={{ fontSize: 13, fontWeight: 600, color: 'var(--sub)' }}> 单</small></b><span className="kpi-note">丢单金额 ≈USD {money(d?.kpi.lostUsd)}</span></div>
          <div className="kpi-chip"><span className="kpi-label">本月成交率</span><b className="kpi-value">{d?.kpi.winRate ?? 0}<small style={{ fontSize: 13, fontWeight: 600, color: 'var(--sub)' }}>%</small></b><span className="kpi-note">成交 ÷（成交＋未成单）</span></div>
          <div className="kpi-chip"><span className="kpi-label">本月跟进次数</span><b className="kpi-value">{d?.kpi.followCount ?? 0}<small style={{ fontSize: 13, fontWeight: 600, color: 'var(--sub)' }}> 次</small></b><span className="kpi-note">本月新增客户 {d?.kpi.newCustomers ?? 0} 家</span></div>
          <div className="kpi-chip" style={{ borderTopColor: 'var(--danger)' }}><span className="kpi-label">待跟进询价</span><b className="kpi-value" style={{ color: 'var(--danger)' }}>{d?.kpi.openCount ?? 0}<small style={{ fontSize: 13, fontWeight: 600, color: 'var(--sub)' }}> 条</small></b><span className="kpi-note">跟进中的询价（未成交未丢单）</span></div>
        </div>
      </section>

      <section className="card panel-tight" style={{ marginTop: 12 }}>
        <div className="panel-head">
          <h4 className="panel-title">跟进提醒</h4>
          <span className="ana-tabs-l" style={{ marginLeft: 4 }}>
            {groupMeta.map((g) => (
              <button key={g.key} className={group === g.key ? 'on' : ''} onClick={() => setGroup(g.key)}>
                {g.label}<span className="badge" style={{ marginLeft: 6, background: g.key === group ? 'rgba(255,255,255,.25)' : '#eef1f6', color: group === g.key ? '#fff' : 'var(--sub)' }}>{d?.reminders.counts[g.key] ?? 0}</span>
              </button>
            ))}
          </span>
          <span style={{ flex: 1 }} />
          <span className="hint">{cur.note}</span>
        </div>
        <div className="tablewrap" style={{ overflowX: 'auto', marginTop: 10 }}>
          <table className="grid data-table fixed-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <colgroup><col style={{ width: '12%' }} /><col style={{ width: '22%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} /><col style={{ width: '12%' }} /><col style={{ width: '6%' }} /></colgroup>
            <thead><tr>
              <th style={{ textAlign: 'left' }}>询价号</th><th style={{ textAlign: 'left' }}>客户</th><th style={{ textAlign: 'left' }}>销售</th><th style={{ textAlign: 'left' }}>采购</th>
              <th style={{ textAlign: 'left' }}>上次跟进</th><th style={{ textAlign: 'left' }}>下次跟进</th><th style={{ textAlign: 'right' }}>报价(USD)</th><th style={{ textAlign: 'center' }}>操作</th>
            </tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className={group === 'overdue' ? 'row-top' : undefined}>
                  <td className="mono ellip" style={{ padding: '0 10px' }} title={r.inquiry_no}>{r.inquiry_no}</td>
                  <td className="ellip" style={{ padding: '0 10px' }} title={r.customer_name}>{r.customer_name || '—'}</td>
                  <td className="ellip" style={{ padding: '0 10px' }}>{r.sales || '—'}</td>
                  <td className="ellip" style={{ padding: '0 10px' }}>{r.purchaser || '—'}</td>
                  <td className="mono" style={{ padding: '0 10px' }}>{fmt(r.last_followup_at)}</td>
                  <td className="mono" style={{ padding: '0 10px', color: group === 'overdue' ? 'var(--danger)' : undefined, fontWeight: group === 'overdue' ? 700 : undefined }}>{fmt(r.next_followup_at)}</td>
                  <td className="mono cell-top" style={{ padding: '0 10px', textAlign: 'right' }}>{money(r.usd)}</td>
                  <td style={{ padding: '0 10px', textAlign: 'center' }}>
                    <button className="btn xs" onClick={() => onGoFollow?.({ sales: r.sales, no: r.inquiry_no })}>去跟进</button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={8} className="hint" style={{ padding: 16, textAlign: 'center' }}>{cur.label}：暂无（很好，暂无需要提醒的询价）</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="dash-grid" style={{ marginTop: 12 }}>
        <section className="card panel-tight">
          <div className="panel-head">
            <h4 className="panel-title">本月按销售</h4>
            <span className="hint panel-hint">本月成单金额排名（成交 ≈USD {money(d?.kpi.wonUsd)}）</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <table className="grid data-table fixed-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <colgroup><col style={{ width: '34%' }} /><col style={{ width: '16%' }} /><col style={{ width: '26%' }} /><col style={{ width: '24%' }} /></colgroup>
              <thead><tr><th style={{ textAlign: 'left' }}>销售</th><th style={{ textAlign: 'right' }}>单数</th><th style={{ textAlign: 'right' }}>金额(USD)</th><th style={{ textAlign: 'right' }}>占比</th></tr></thead>
              <tbody>
                {(d?.monthBySales ?? []).map((x, i) => (
                  <tr key={x.name} className={i === 0 ? 'row-top' : undefined}>
                    <td className="ellip" style={{ padding: '0 10px' }} title={x.name}>{x.name}{i === 0 && <span className="top-badge">第一</span>}</td>
                    <td style={{ padding: '0 10px', textAlign: 'right' }}>{x.n} 单</td>
                    <td className={'mono' + (i === 0 ? ' cell-top' : '')} style={{ padding: '0 10px', textAlign: 'right' }}>{money(x.usd)}</td>
                    <td style={{ padding: '0 10px', textAlign: 'right' }}>{d?.kpi.wonUsd ? `${Math.round((x.usd / d.kpi.wonUsd) * 1000) / 10}%` : '—'}</td>
                  </tr>
                ))}
                {(d?.monthBySales ?? []).length === 0 && <tr><td colSpan={4} className="hint" style={{ padding: 14, textAlign: 'center' }}>本月暂无成单</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card panel-tight">
          <div className="panel-head">
            <h4 className="panel-title">本月按产品</h4>
            <span className="hint panel-hint">本月成单产品排名</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <table className="grid data-table fixed-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <colgroup><col style={{ width: '40%' }} /><col style={{ width: '16%' }} /><col style={{ width: '24%' }} /><col style={{ width: '20%' }} /></colgroup>
              <thead><tr><th style={{ textAlign: 'left' }}>产品</th><th style={{ textAlign: 'right' }}>次数</th><th style={{ textAlign: 'right' }}>金额(USD)</th><th style={{ textAlign: 'right' }}>占比</th></tr></thead>
              <tbody>
                {(d?.monthByProduct ?? []).map((x, i) => (
                  <tr key={x.name} className={i === 0 ? 'row-top' : undefined}>
                    <td className="ellip" style={{ padding: '0 10px' }} title={x.name}>{x.name}{i === 0 && <span className="top-badge">最高</span>}</td>
                    <td style={{ padding: '0 10px', textAlign: 'right' }}>{x.n} 次</td>
                    <td className={'mono' + (i === 0 ? ' cell-top' : '')} style={{ padding: '0 10px', textAlign: 'right' }}>{money(x.usd)}</td>
                    <td style={{ padding: '0 10px', textAlign: 'right' }}>{d?.kpi.wonUsd ? `${Math.round((x.usd / d.kpi.wonUsd) * 1000) / 10}%` : '—'}</td>
                  </tr>
                ))}
                {(d?.monthByProduct ?? []).length === 0 && <tr><td colSpan={4} className="hint" style={{ padding: 14, textAlign: 'center' }}>本月暂无成单</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  )
}
