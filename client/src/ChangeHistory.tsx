import { useEffect, useState } from 'react'
import { get } from './api'

/** 产品价格变动记录（/api/products/history 返回） */
interface PriceRow {
  id: string; product_name: string; currency: string; amount: number | null; qty: number | null
  prev_amount: number | null; prev_qty: number | null; prev_currency: string | null
  source: string | null; inquiry_no: string | null; customer_name: string | null; sales: string | null
  biz_date: string | null; created_at: string; version?: number; is_latest?: boolean
}
/** 费用变动记录（/api/inquiries/:id/fee-history 返回） */
export interface FeeVersion {
  id: string; version: number; is_latest?: boolean
  freight: number | null; tax: number | null; commission: number | null; other_fee: number | null
  fee_currency: string; total: number; source: string | null; created_at: string
  fee_detail?: string | null
}
/** 合并后的一行：产品价格变更 与 费用变更 放在同一条时间线上 */
interface Row {
  key: string; time: string; kind: 'product' | 'fee'; object: string; objectTitle?: string
  version: number; isLatest?: boolean; before: string; after: string
  qty: string; currency: string; source: string
}

const money = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))
const when = (t: string) => String(t || '').slice(5, 16).replace('T', ' ')   // MM-DD HH:mm
const whenFull = (t: string) => String(t || '').slice(0, 16).replace('T', ' ')

/** 费用明细：解析每项费用的金额与币种（只有新记录才有 fee_detail） */
function feeDetail(v: FeeVersion): string {
  if (!v.fee_detail) return ''
  try {
    const arr = JSON.parse(v.fee_detail)
    if (!Array.isArray(arr)) return ''
    return arr.filter((x) => x && Number(x.value)).map((x) => `${x.label} ${money(Number(x.value))} ${x.currency}${x.rate && Number(x.rate) !== 1 ? `（汇率 ${x.rate}）` : ''}`).join(' · ')
  } catch { return '' }
}

/**
 * 变更记录弹窗：把「产品价格变更」与「费用变更」放在一起按时间倒序展示。
 * 产品部分覆盖本询价里用到的所有产品的历史记录；费用部分为本询价的费用版本。
 */
export default function ChangeHistoryModal({ inquiryId, inquiryNo, productNames, onClose }: {
  inquiryId: string; inquiryNo?: string; productNames: string[]; onClose: () => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const names = Array.from(new Set(productNames.map((x) => String(x || '').trim()).filter(Boolean)))
  const nameKey = names.join('|')
  useEffect(() => {
    let alive = true
    Promise.all([
      Promise.all(names.map((n) => get<PriceRow[]>(`/products/history?name=${encodeURIComponent(n)}`).catch(() => [] as PriceRow[]))),
      get<{ versions: FeeVersion[] }>(`/inquiries/${inquiryId}/fee-history`).catch(() => ({ versions: [] as FeeVersion[] })),
    ]).then(([priceLists, feeRes]) => {
      if (!alive) return
      const out: Row[] = []
      priceLists.flat().filter(Boolean).forEach((r) => {
        const changedProduct = /产品变更/.test(String(r.source || ''))
        out.push({
          key: `p-${r.id}`, time: String(r.created_at || ''), kind: 'product',
          object: r.product_name, objectTitle: r.customer_name ? `客户 ${r.customer_name}${r.sales ? ` · 销售 ${r.sales}` : ''}` : undefined,
          version: r.version ?? 0, isLatest: r.is_latest,
          before: r.prev_amount == null ? '首次录入' : `${money(r.prev_amount)} ${r.prev_currency ?? r.currency}`,
          after: `${money(r.amount)} ${r.currency}`,
          qty: r.prev_qty == null && r.qty == null ? '—' : `${r.prev_qty ?? '—'} → ${r.qty ?? '—'}`,
          currency: r.currency, source: String(r.source || (changedProduct ? '产品变更' : '询价录入')),
        })
      })
      const versions = Array.isArray(feeRes?.versions) ? feeRes.versions : []
      versions.forEach((v, i) => {
        const prev = versions[i + 1] ?? null   // 列表按版本倒序，下一个更旧
        const det = feeDetail(v)
        out.push({
          key: `f-${v.id}`, time: String(v.created_at || ''), kind: 'fee',
          object: '费用（运费 / 税费 / 佣金 / 其他费用）',
          objectTitle: det || '该版本四项费用使用同一币种',
          version: v.version, isLatest: v.is_latest,
          before: prev ? `${money(prev.total)} ${prev.fee_currency}` : '首次填写',
          after: `${money(v.total)} ${v.fee_currency}`,
          qty: '—', currency: v.fee_currency, source: String(v.source || '费用调整'),
        })
      })
      out.sort((a, b) => (b.time || '').localeCompare(a.time || ''))
      setRows(out)
    }).catch((e) => setErr((e as Error).message))
    return () => { alive = false }
  }, [inquiryId, nameKey])   // eslint-disable-line react-hooks/exhaustive-deps
  const prodN = (rows ?? []).filter((r) => r.kind === 'product').length
  const feeN = (rows ?? []).filter((r) => r.kind === 'fee').length
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(1220px, 97vw)', maxHeight: '88vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="变更记录">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>变更记录{inquiryNo ? ` · ${inquiryNo}` : ''}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          产品价格变更与费用变更放在同一条时间线上（按时间倒序）：产品部分为<b>本询价用到的产品</b>的历史记录（含来源询价），费用部分为<b>本询价</b>的费用版本。
          {rows && <> 共 <b>{rows.length}</b> 条（产品价格 <b>{prodN}</b> · 费用 <b>{feeN}</b>）</>}
        </div>
        {err && <div className="msg err">{err}</div>}
        <div className="tablewrap" style={{ marginTop: 10, maxHeight: '58vh' }}>
          <table className="grid data-table fixed-table fit-table" style={{ fontSize: 12.5 }}>
            <colgroup>
              <col style={{ width: '12%' }} /><col style={{ width: '8%' }} /><col style={{ width: '16%' }} /><col style={{ width: '8%' }} />
              <col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '8%' }} /><col style={{ width: '7%' }} /><col style={{ width: '15%' }} />
            </colgroup>
            <thead><tr>{['时间', '类型', '产品 / 费用', '版本', '变更前', '变更后', '数量', '币种', '来源'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.key}>
                  <td className="mono" title={whenFull(r.time)}>{when(r.time)}</td>
                  <td>{r.kind === 'product'
                    ? <span className="badge" style={{ background: '#eef4ff', color: 'var(--brand)' }}>产品价格</span>
                    : <span className="badge" style={{ background: '#fff4e5', color: '#a35c00' }}>费用</span>}</td>
                  <td className="ellip" title={r.objectTitle ? `${r.object} · ${r.objectTitle}` : r.object}>{r.object}</td>
                  <td><span className={'badge' + (r.isLatest ? ' new' : '')} title={r.isLatest ? '当前版本' : `第 ${r.version} 版`}>V{r.version}{r.isLatest ? ' 当前' : ''}</span></td>
                  <td className="mono">{r.before}</td>
                  <td className="mono" style={{ fontWeight: 700 }}>{r.after}</td>
                  <td className="mono">{r.qty}</td>
                  <td>{r.currency}</td>
                  <td className="ellip" title={r.source}>{r.source}</td>
                </tr>
              ))}
              {rows && rows.length === 0 && <tr><td colSpan={9} className="hint" style={{ textAlign: 'center' }}>暂无变更记录（该询价的产品价格与费用都没有变动过）</td></tr>}
              {!rows && !err && <tr><td colSpan={9} className="hint" style={{ textAlign: 'center' }}>加载中…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  )
}
