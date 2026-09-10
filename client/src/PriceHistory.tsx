import { useEffect, useState } from 'react'
import { get } from './api'

export interface PriceRow {
  id: string; product_name: string; currency: string; amount: number | null; qty: number | null
  prev_amount: number | null; prev_qty: number | null; prev_currency: string | null
  source: string | null; inquiry_no: string | null; customer_name: string | null; sales: string | null
  biz_date: string | null; created_at: string; version?: number; is_latest?: boolean
}

const money = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))

/** 价格变动记录弹窗：产品档案与询报价管理共用（含来源询价、客户、销售） */
export default function PriceHistoryModal({ name, info, onClose }: {
  name: string
  info?: { last_amount?: number | null; currency?: string; last_qty?: number | null; use_count?: number }
  onClose: () => void
}) {
  const [rows, setRows] = useState<PriceRow[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    get<PriceRow[]>(`/products/history?name=${encodeURIComponent(name)}`)
      .then((l) => setRows(Array.isArray(l) ? l : []))
      .catch((e) => setErr((e as Error).message))
  }, [name])
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(1000px, 97vw)', maxHeight: '88vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="产品价格变动记录">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>价格变动记录 · {name}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          当前参考报价 <b className="mono">{money(info?.last_amount)} {info?.currency ?? ''}</b> · 最近数量 <b>{info?.last_qty ?? '—'}</b> · 累计使用 {info?.use_count ?? 0} 次 · 当前版本 <b className="mono">V{rows?.length ?? 0}</b>（首次录入 V1，之后每次金额/数量/币种变化生成新版本）
        </div>
        {err && <div className="msg err">{err}</div>}
        <div className="tablewrap" style={{ overflowX: 'auto', marginTop: 10 }}>
          <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['版本', '记录时间', '业务日期', '金额变化', '数量变化', '来源', '询价号', '客户', '销售'].map((h) => <th key={h} style={{ background: '#f8fafd', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>
              {(rows ?? []).map((h) => {
                const delta = (h.prev_amount == null || h.amount == null) ? null : Math.round((h.amount - h.prev_amount) * 100) / 100
                return (
                  <tr key={h.id} style={{ borderBottom: '1px solid var(--line2)' }}>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      <span className={'badge' + (h.is_latest ? ' new' : '')} title={h.is_latest ? '当前版本' : `第 ${h.version} 版`}>V{h.version ?? '—'}{h.is_latest ? ' 当前' : ''}</span>
                    </td>
                    <td className="mono" style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{String(h.created_at).slice(0, 16).replace('T', ' ')}</td>
                    <td className="mono" style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{h.biz_date || '—'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {h.prev_amount == null
                        ? <span className="badge">首次录入 {money(h.amount)} {h.currency}</span>
                        : <>
                          <span className="mono">{money(h.prev_amount)} {h.prev_currency ?? h.currency}</span>
                          <span className="hint" style={{ margin: '0 4px' }}>→</span>
                          <b className="mono">{money(h.amount)} {h.currency}</b>
                          {delta != null && delta !== 0 && (
                            <span style={{ marginLeft: 6, fontWeight: 700, color: delta > 0 ? '#059669' : 'var(--danger)' }}>
                              {delta > 0 ? `↑ ${money(delta)}` : `↓ ${money(Math.abs(delta))}`}
                            </span>
                          )}
                        </>}
                    </td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {h.prev_qty == null && h.qty == null ? '—' : <><span className="mono">{h.prev_qty ?? '—'}</span><span className="hint" style={{ margin: '0 4px' }}>→</span><b>{h.qty ?? '—'}</b></>}
                    </td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{h.source || '—'}</td>
                    <td className="mono" style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{h.inquiry_no || '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{h.customer_name || '—'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{h.sales || '—'}</td>
                  </tr>
                )
              })}
              {rows && rows.length === 0 && <tr><td colSpan={9} className="hint" style={{ padding: 16, textAlign: 'center' }}>暂无变动记录（该产品只录入过同金额同数量，或由旧数据迁移而来）</td></tr>}
              {!rows && !err && <tr><td colSpan={9} className="hint" style={{ padding: 16, textAlign: 'center' }}>加载中…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
