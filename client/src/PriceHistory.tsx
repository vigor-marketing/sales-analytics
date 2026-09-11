import { useEffect, useState } from 'react'
import { get } from './api'

export interface PriceRow {
  id: string; product_name: string; currency: string; amount: number | null; qty: number | null
  prev_amount: number | null; prev_qty: number | null; prev_currency: string | null
  source: string | null; inquiry_no: string | null; customer_name: string | null; sales: string | null
  biz_date: string | null; created_at: string; version?: number; is_latest?: boolean
  /** 换产品时记录的原行信息（产品名/数量/金额/币种） */
  from_product?: string | null; from_qty?: number | null; from_amount?: number | null; from_currency?: string | null
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
      <div className="modal" style={{ width: 'min(1360px, 98vw)', maxHeight: '88vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="产品价格变动记录">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>价格变动记录 · {name}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          当前参考单价 <b className="mono">{money(info?.last_amount)} {info?.currency ?? ''}</b> · 最近数量 <b>{info?.last_qty ?? '—'}</b> · 累计使用 {info?.use_count ?? 0} 次 · 当前版本 <b className="mono">V{rows?.length ?? 0}</b>（首次录入 V1，之后每次单价/数量/币种变化生成新版本）
        </div>
        {err && <div className="msg err">{err}</div>}
        <div className="tablewrap" style={{ marginTop: 10, maxHeight: '56vh' }}>
          <table className="grid data-table fixed-table fit-table" style={{ fontSize: 12.5, minWidth: 1320 }}>
            <colgroup>
              <col style={{ width: '6%' }} /><col style={{ width: '11%' }} /><col style={{ width: '8%' }} />
              <col style={{ width: '16%' }} /><col style={{ width: '17%' }} /><col style={{ width: '8%' }} />
              <col style={{ width: '12%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '6%' }} />
            </colgroup>
            <thead><tr>{['版本', '记录时间', '业务日期', '产品变更（原 → 新）', '金额变化（单价）', '数量变化', '来源', '询价号', '客户', '销售'].map((h, i) => <th key={h} style={{ textAlign: i === 0 ? 'center' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {(rows ?? []).map((h) => {
                const delta = (h.prev_amount == null || h.amount == null) ? null : Math.round((h.amount - h.prev_amount) * 100) / 100
                return (
                  <tr key={h.id}>
                    <td style={{ textAlign: 'center' }}>
                      <span className={'badge' + (h.is_latest ? ' new' : '')} title={h.is_latest ? `第 ${h.version} 版（当前）` : `第 ${h.version} 版`}>V{h.version ?? '—'}</span>
                      {h.is_latest && <div className="hint" style={{ fontSize: 10.5, marginTop: 2 }}>当前</div>}
                    </td>
                    <td className="mono" title={String(h.created_at).slice(0, 19).replace('T', ' ')}>{String(h.created_at).slice(0, 16).replace('T', ' ')}</td>
                    <td className="mono" title={h.biz_date || '—'}>{h.biz_date || '—'}</td>
                    <td className="cell-left" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }} title={h.from_product ? `本行原来是「${h.from_product}」（${h.from_qty ?? '—'} 件 / ${h.from_amount == null ? '—' : money(h.from_amount)} ${h.from_currency ?? ''}）` : '该次变更不是产品变更'}>
                      {h.from_product
                        ? <>
                          <div><span className="badge">{h.from_product}</span><span className="hint" style={{ margin: '0 4px' }}>→</span><b>{h.product_name}</b></div>
                          <div className="hint" style={{ fontSize: 11 }}>原行：{h.from_qty ?? '—'} 件 / {h.from_amount == null ? '—' : money(h.from_amount)} {h.from_currency ?? ''}</div>
                        </>
                        : <span className="hint">—</span>}
                    </td>
                    <td className="cell-left" style={{ whiteSpace: 'normal' }} title={h.prev_amount == null ? `首次录入 ${money(h.amount)} ${h.currency}` : `${money(h.prev_amount)} ${h.prev_currency ?? h.currency} → ${money(h.amount)} ${h.currency}`}>
                      {h.prev_amount == null
                        ? <span className="badge">首次录入 {money(h.amount)} {h.currency}</span>
                        : <>
                          <span className="mono">{money(h.prev_amount)}</span>
                          <span className="hint" style={{ margin: '0 4px' }}>→</span>
                          <b className="mono">{money(h.amount)} {h.currency}</b>
                          {delta != null && delta !== 0 && (
                            <span style={{ marginLeft: 6, fontWeight: 700, color: delta > 0 ? '#059669' : 'var(--danger)' }}>
                              {delta > 0 ? `↑ ${money(delta)}` : `↓ ${money(Math.abs(delta))}`}
                            </span>
                          )}
                        </>}
                    </td>
                    <td title={h.prev_qty == null && h.qty == null ? '—' : `${h.prev_qty ?? '—'} → ${h.qty ?? '—'}`}>
                      {h.prev_qty == null && h.qty == null ? '—' : <><span className="mono">{h.prev_qty ?? '—'}</span><span className="hint" style={{ margin: '0 4px' }}>→</span><b>{h.qty ?? '—'}</b></>}
                    </td>
                    <td className="cell-left" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }} title={h.source || '—'}>{h.source || '—'}</td>
                    <td className="mono" title={h.inquiry_no || '—'}>{h.inquiry_no || '—'}</td>
                    <td title={h.customer_name || '—'}>{h.customer_name || '—'}</td>
                    <td title={h.sales || '—'}>{h.sales || '—'}</td>
                  </tr>
                )
              })}
              {rows && rows.length === 0 && <tr><td colSpan={10} className="hint" style={{ textAlign: 'center' }}>暂无变动记录（该产品只录入过同金额同数量，或由旧数据迁移而来）</td></tr>}
              {!rows && !err && <tr><td colSpan={10} className="hint" style={{ textAlign: 'center' }}>加载中…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  )
}
