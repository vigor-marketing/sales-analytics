import { useEffect, useState } from 'react'
import { get } from './api'

export interface FeeVersion {
  id: string; version: number; is_latest?: boolean
  freight: number | null; tax: number | null; commission: number | null; other_fee: number | null
  fee_currency: string; total: number; source: string | null; created_at: string
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
          每次修改运费/税费/佣金/其他费用（或费用币种）都会生成一个新版本，与产品金额版本一起记录；当前版本
          <b className="mono"> V{latest?.version ?? '—'}</b>
        </div>
        {err && <div className="msg err">{err}</div>}
        <div className="tablewrap" style={{ marginTop: 10, maxHeight: '56vh' }}>
          <table className="grid data-table fixed-table" style={{ fontSize: 12.5 }}>
            <colgroup>
              <col style={{ width: 95 }} /><col style={{ width: 130 }} /><col style={{ width: 95 }} /><col style={{ width: 95 }} />
              <col style={{ width: 95 }} /><col style={{ width: 110 }} /><col style={{ width: 130 }} /><col style={{ width: 170 }} />
            </colgroup>
            <thead><tr>{['版本', '记录时间', '运费', '税费', '佣金', '其他费用', '合计', '来源'].map((h) => <th key={h} style={{ textAlign: h === '版本' ? 'center' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {(rows ?? []).map((v) => (
                <tr key={v.id}>
                  <td style={{ textAlign: 'center' }}><span className={'badge' + (v.is_latest ? ' new' : '')} title={v.is_latest ? '当前版本' : `第 ${v.version} 版`}>V{v.version}{v.is_latest ? ' 当前' : ''}</span></td>
                  <td className="mono" title={String(v.created_at).slice(0, 19).replace('T', ' ')}>{String(v.created_at).slice(0, 16).replace('T', ' ')}</td>
                  <td className="mono">{money(v.freight)}</td>
                  <td className="mono">{money(v.tax)}</td>
                  <td className="mono">{money(v.commission)}</td>
                  <td className="mono">{money(v.other_fee)}</td>
                  <td className="mono" style={{ fontWeight: 700 }} title={`${money(v.total)} ${v.fee_currency}`}>{money(v.total)} {v.fee_currency}</td>
                  <td title={v.source || '—'}>{v.source || '—'}</td>
                </tr>
              ))}
              {rows && rows.length === 0 && <tr><td colSpan={8} className="hint" style={{ textAlign: 'center' }}>暂无费用变动记录（该询价没有填写任何费用）</td></tr>}
              {!rows && !err && <tr><td colSpan={8} className="hint" style={{ textAlign: 'center' }}>加载中…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  )
}
