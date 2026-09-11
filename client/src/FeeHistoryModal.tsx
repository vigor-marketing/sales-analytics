import { useEffect, useState } from 'react'
import { get } from './api'

export interface FeeVersion {
  id: string; version: number; is_latest?: boolean
  freight: number | null; tax: number | null; commission: number | null; other_fee: number | null
  fee_currency: string; total: number; source: string | null; created_at: string
  /** 每项费用的币种明细（JSON 字符串，新增记录才有；老记录为空则回退到统一币种） */
  fee_detail?: string | null
}
/** 解析费用明细：返回每项费用的金额与币种 */
function detailOf(v: FeeVersion): { label: string; value: number; currency: string }[] | null {
  if (!v.fee_detail) return null
  try {
    const arr = JSON.parse(v.fee_detail)
    if (!Array.isArray(arr)) return null
    const list = arr.filter((x) => x && Number(x.value)).map((x) => ({ label: String(x.label ?? ''), value: Number(x.value), currency: String(x.currency ?? '') }))
    return list.length ? list : null
  } catch { return null }
}

const money = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))

/** 费用变动记录弹窗：与产品「价格变动记录」并列，追溯每次运费/税费/佣金/其他费用的调整 */
export default function FeeHistoryModal({ inquiryId, inquiryNo, onClose }: { inquiryId: string; inquiryNo?: string; onClose: () => void }) {
  const [rows, setRows] = useState<FeeVersion[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    get<{ inquiryNo: string; versions: FeeVersion[] }>(`/inquiries/${inquiryId}/fee-history`)
      .then((d) => setRows(Array.isArray(d?.versions) ? d.versions : []))
      .catch((e) => setErr((e as Error).message))
  }, [inquiryId])
  const latest = (rows ?? []).find((r) => r.is_latest) ?? (rows ?? [])[0]
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(1000px, 97vw)', maxHeight: '88vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label="费用变动记录">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>费用变动记录 · {inquiryNo ? `${inquiryNo} · ` : ''}{latest ? `${money(latest.total)} ${latest.fee_currency}` : '加载中…'}</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          每次修改运费/税费/佣金/其他费用（或某项费用的币种）都会生成一个新版本；每项费用按各自币种汇率折算；当前版本
          <b className="mono"> V{latest?.version ?? '—'}</b>
        </div>
        {err && <div className="msg err">{err}</div>}
        <div className="tablewrap" style={{ marginTop: 10, maxHeight: '56vh' }}>
          <table className="grid data-table fixed-table" style={{ fontSize: 12.5 }}>
            <colgroup>
              <col style={{ width: '8%' }} /><col style={{ width: '14%' }} /><col style={{ width: '9%' }} /><col style={{ width: '9%' }} />
              <col style={{ width: '9%' }} /><col style={{ width: '10%' }} /><col style={{ width: '13%' }} /><col style={{ width: '18%' }} /><col style={{ width: '10%' }} />
            </colgroup>
            <thead><tr>{['版本', '记录时间', '运费', '税费', '佣金', '其他费用', '合计', '费用币种明细', '来源'].map((h) => <th key={h} style={{ textAlign: h === '版本' ? 'center' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {(rows ?? []).map((v) => (
                <tr key={v.id}>
                  <td style={{ textAlign: 'center' }}><span className={'badge' + (v.is_latest ? ' new' : '')} title={v.is_latest ? '当前版本' : `第 ${v.version} 版`}>V{v.version}{v.is_latest ? ' 当前' : ''}</span></td>
                  <td className="mono" title={String(v.created_at).slice(0, 19).replace('T', ' ')}>{String(v.created_at).slice(0, 16).replace('T', ' ')}</td>
                  {(() => { const det = detailOf(v); const curOf = (label: string) => det?.find((x) => x.label === label)?.currency ?? v.fee_currency
                    return (<>
                      <td className="mono">{money(v.freight)}{v.freight ? <span className="hint" style={{ marginLeft: 3 }}>{curOf('运费')}</span> : null}</td>
                      <td className="mono">{money(v.tax)}{v.tax ? <span className="hint" style={{ marginLeft: 3 }}>{curOf('税费')}</span> : null}</td>
                      <td className="mono">{money(v.commission)}{v.commission ? <span className="hint" style={{ marginLeft: 3 }}>{curOf('佣金')}</span> : null}</td>
                      <td className="mono">{money(v.other_fee)}{v.other_fee ? <span className="hint" style={{ marginLeft: 3 }}>{curOf('其他费用')}</span> : null}</td>
                      <td className="mono" style={{ fontWeight: 700 }} title={det ? '各项费用按各自币种汇率折算后的 USD 合计' : `${money(v.total)} ${v.fee_currency}`}>
                        {money(v.total)} {det && new Set(det.map((x) => x.currency)).size > 1 ? 'USD(折)' : v.fee_currency}
                      </td>
                      <td className="hint" style={{ whiteSpace: 'normal' }} title={det ? det.map((x) => `${x.label} ${money(x.value)} ${x.currency}`).join(' · ') : '旧记录：四项费用使用同一币种'}>
                        {det ? det.map((x) => `${x.label} ${money(x.value)} ${x.currency}`).join(' · ') : `${v.fee_currency}（统一币种）`}
                      </td>
                      <td title={v.source || '—'}>{v.source || '—'}</td>
                    </>) })()}
                </tr>
              ))}
              {rows && rows.length === 0 && <tr><td colSpan={9} className="hint" style={{ textAlign: 'center' }}>暂无费用变动记录（该询价没有填写任何费用）</td></tr>}
              {!rows && !err && <tr><td colSpan={9} className="hint" style={{ textAlign: 'center' }}>加载中…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  )
}
