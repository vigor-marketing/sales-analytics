import { useEffect, useState } from 'react'
import { get } from './api'

/** 产品价格变动记录（/api/products/history 返回） */
interface PriceRow {
  id: string; product_name: string; currency: string; amount: number | null; qty: number | null
  prev_amount: number | null; prev_qty: number | null; prev_currency: string | null
  source: string | null; inquiry_no: string | null; customer_name: string | null; sales: string | null
  biz_date: string | null; created_at: string; version?: number; is_latest?: boolean
  /** 换产品时记录的原行信息 */
  from_product?: string | null; from_qty?: number | null; from_amount?: number | null; from_currency?: string | null
}
/** 费用变动记录（/api/inquiries/:id/fee-history 返回） */
export interface FeeVersion {
  id: string; version: number; is_latest?: boolean
  freight: number | null; tax: number | null; commission: number | null; other_fee: number | null
  fee_currency: string; total: number; source: string | null; created_at: string
  fee_detail?: string | null
}
interface FeeItem { label: string; value: number; currency: string }
/** 合并后的一行：产品价格变更 与 费用变更 放在同一条时间线上 */
interface Row {
  key: string; time: string; kind: 'product' | 'fee'; object: string; objectTitle?: string
  version: number; isLatest?: boolean; changes: { label: string; from: string | null; to: string; note?: string }[]
  summary: string; source: string
}

const money = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))
const when = (t: string) => String(t || '').slice(5, 16).replace('T', ' ')   // MM-DD HH:mm
const whenFull = (t: string) => String(t || '').slice(0, 19).replace('T', ' ')

/** 费用版本里的四项费用与各自币种（老记录没有 fee_detail 时按统一币种回退） */
function feeItems(v: FeeVersion): FeeItem[] {
  const base: FeeItem[] = [
    { label: '运费', value: Number(v.freight ?? 0), currency: v.fee_currency },
    { label: '税费', value: Number(v.tax ?? 0), currency: v.fee_currency },
    { label: '佣金', value: Number(v.commission ?? 0), currency: v.fee_currency },
    { label: '其他费用', value: Number(v.other_fee ?? 0), currency: v.fee_currency },
  ]
  if (!v.fee_detail) return base
  try {
    const arr = JSON.parse(v.fee_detail)
    if (!Array.isArray(arr)) return base
    return base.map((b) => {
      const hit = arr.find((x) => x && String(x.label) === b.label)
      return hit ? { label: b.label, value: Number(hit.value ?? 0), currency: String(hit.currency ?? b.currency) } : b
    })
  } catch { return base }
}
const fmtItem = (it: FeeItem) => (it.value ? `${money(it.value)} ${it.currency}` : '0')

/**
 * 变更记录弹窗：把「产品价格变更」与「费用变更」放在一起按时间倒序展示，
 * 每条都完整写明「哪个版本、改了哪些内容（字段 旧 → 新）」。
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
      // —— 产品价格变更 ——
      priceLists.flat().filter(Boolean).forEach((r) => {
        const source = String(r.source || '询价录入')
        const swappedFrom = (/产品变更（原 (.+)）\s*$/.exec(source) || [])[1] ?? null
        const prevCur = r.prev_currency ?? r.currency
        const delta = (r.prev_amount == null || r.amount == null) ? null : Math.round((r.amount - r.prev_amount) * 100) / 100
        const qtyChanged = Number(r.prev_qty ?? -1) !== Number(r.qty ?? -1)
        const curChanged = !!r.prev_amount && prevCur !== r.currency
        const changes: Row['changes'] = []
        if (swappedFrom) {
          // 产品变更：把原行的「产品名称 / 数量 / 金额 / 币种」一起列出，看清具体变的是哪一行
          const fromQty = r.from_qty ?? null; const fromAmt = r.from_amount ?? null; const fromCur = r.from_currency ?? prevCur
          changes.push({
            label: '产品名称', from: swappedFrom, to: r.product_name,
            note: '本行原来是另一个产品',
          })
          if (fromQty != null || fromAmt != null) {
            changes.push({
              label: '原行内容', from: null,
              to: `${fromQty != null ? `${fromQty} 件 × ` : ''}${fromAmt != null ? `${money(fromAmt)} ${fromCur}` : '—'}（合计 ${fromQty != null && fromAmt != null ? `${money(Math.round(fromQty * fromAmt * 100) / 100)} ${fromCur}` : '—'}）`,
              note: `原产品 ${swappedFrom} 的数量与金额`,
            })
          }
        }
        changes.push({
          label: '单价',
          from: r.prev_amount == null ? null : `${money(r.prev_amount)} ${prevCur}`,
          to: `${money(r.amount)} ${r.currency}`,
          note: r.prev_amount == null ? '首次录入'
            : (delta ? `${delta > 0 ? '↑' : '↓'} ${money(Math.abs(delta))}` : '价格未变'),
        })
        if (qtyChanged) changes.push({ label: '数量', from: r.prev_qty == null ? '—' : String(r.prev_qty), to: r.qty == null ? '—' : String(r.qty) })
        if (curChanged) changes.push({ label: '币种', from: prevCur, to: r.currency })
        out.push({
          key: `p-${r.id}`, time: String(r.created_at || ''), kind: 'product',
          object: r.product_name,
          objectTitle: [r.customer_name ? `客户 ${r.customer_name}` : '', r.sales ? `销售 ${r.sales}` : '', r.inquiry_no ? `来源询价 ${r.inquiry_no}` : ''].filter(Boolean).join(' · '),
          version: r.version ?? 0, isLatest: r.is_latest, changes,
          summary: changes.map((c) => `${c.label} ${c.from == null ? '' : `${c.from} → `}${c.to}`).join('；'),
          source,
        })
      })
      // —— 费用变更 ——
      const versions = Array.isArray(feeRes?.versions) ? feeRes.versions : []
      versions.forEach((v, i) => {
        const prev = versions[i + 1] ?? null   // 列表按版本倒序，下一个更旧
        const cur = feeItems(v)
        const old = prev ? feeItems(prev) : null
        const changes: Row['changes'] = []
        cur.forEach((it) => {
          const was = old?.find((x) => x.label === it.label)
          const sameValue = was ? was.value === it.value : false
          const sameCur = was ? was.currency === it.currency : false
          if (!was || !sameValue || !sameCur) {
            changes.push({
              label: it.label,
              from: was ? fmtItem(was) : null,
              to: fmtItem(it),
              note: !was ? '首次填写' : (!sameValue ? '金额调整' : '币种调整'),
            })
          }
        })
        const totalDelta = prev ? Math.round((v.total - prev.total) * 100) / 100 : null
        changes.push({
          label: '合计',
          from: prev ? `${money(prev.total)} ${prev.fee_currency}` : null,
          to: `${money(v.total)} ${v.fee_currency}`,
          note: !prev ? '首次填写' : (totalDelta ? `${totalDelta > 0 ? '↑' : '↓'} ${money(Math.abs(totalDelta))}` : '合计未变'),
        })
        out.push({
          key: `f-${v.id}`, time: String(v.created_at || ''), kind: 'fee',
          object: '费用（运费 / 税费 / 佣金 / 其他费用）',
          objectTitle: cur.map((x) => `${x.label} ${fmtItem(x)}`).join(' · '),
          version: v.version, isLatest: v.is_latest, changes,
          summary: changes.map((c) => `${c.label} ${c.from == null ? '' : `${c.from} → `}${c.to}`).join('；'),
          source: String(v.source || '费用调整'),
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
      <div className="modal" style={{ width: 'min(1400px, 98vw)', maxHeight: '90vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="变更记录">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>变更记录{inquiryNo ? ` · ${inquiryNo}` : ''}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          产品价格变更与费用变更放在同一条时间线上（按时间倒序）；每条都写明<b>版本号</b>与<b>改了哪些内容（旧 → 新）</b>。产品部分为本询价用到的产品的历史记录，费用部分为本询价的费用版本。
          {rows && <> 共 <b>{rows.length}</b> 条（产品价格 <b>{prodN}</b> · 费用 <b>{feeN}</b>）</>}
        </div>
        {err && <div className="msg err">{err}</div>}
        <div className="tablewrap" style={{ marginTop: 10, maxHeight: '62vh' }}>
          {/* minWidth：窗口很窄时表格区域横向滚动，保证每列都完整显示、不截断文字 */}
          <table className="grid data-table fixed-table fit-table" style={{ fontSize: 12.5, minWidth: 1140 }}>
            <colgroup>
              <col style={{ width: '10%' }} /><col style={{ width: '8%' }} /><col style={{ width: '14%' }} /><col style={{ width: '8%' }} />
              <col style={{ width: '44%' }} /><col style={{ width: '16%' }} />
            </colgroup>
            <thead><tr>{['时间', '类型', '产品 / 费用', '版本', '变更内容（旧 → 新）', '来源'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.key}>
                  <td className="mono" title={whenFull(r.time)}>{when(r.time)}</td>
                  <td>{r.kind === 'product'
                    ? <span className="badge" style={{ background: '#eef4ff', color: 'var(--brand)' }}>产品价格</span>
                    : <span className="badge" style={{ background: '#fff4e5', color: '#a35c00' }}>费用</span>}</td>
                  <td className="cell-left" title={r.objectTitle || r.object} style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{r.object}</td>
                  <td>
                    <span className={'badge' + (r.isLatest ? ' new' : '')} title={r.isLatest ? `第 ${r.version} 版（当前）` : `第 ${r.version} 版`}>V{r.version}</span>
                    {r.isLatest && <div className="hint" style={{ fontSize: 10.5, marginTop: 2 }}>当前</div>}
                  </td>
                  <td className="cell-left" style={{ whiteSpace: 'normal', padding: '6px 10px' }}>
                    {r.changes.map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', lineHeight: 1.5 }}>
                        <span className="hint" style={{ minWidth: 54, fontSize: 11.5 }}>{c.label}</span>
                        {c.from != null && <><span className="mono">{c.from}</span><span className="hint">→</span></>}
                        {c.from == null && <span className="hint">（首次）</span>}
                        <b className="mono">{c.to}</b>
                        {c.note && <span className="hint" style={{ fontSize: 11 }}>{c.note}</span>}
                      </div>
                    ))}
                  </td>
                  <td className="cell-left" title={r.source} style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{r.source}</td>
                </tr>
              ))}
              {rows && rows.length === 0 && <tr><td colSpan={6} className="hint" style={{ textAlign: 'center' }}>暂无变更记录（该询价的产品价格与费用都没有变动过）</td></tr>}
              {!rows && !err && <tr><td colSpan={6} className="hint" style={{ textAlign: 'center' }}>加载中…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  )
}
