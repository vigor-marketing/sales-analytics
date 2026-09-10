/** 重点客户 / 重点项目 标签（询报价管理、询报价跟进、销售订单管理等页面共用） */
export function KeyTags({ kc, kp, compact }: { kc?: number | boolean; kp?: number | boolean; compact?: boolean }) {
  const a = Number(kc) === 1 || kc === true
  const b = Number(kp) === 1 || kp === true
  if (!a && !b) return <span className="hint">—</span>
  return (
    <>
      {a && <span className="tag kc" style={compact ? { fontSize: 11, padding: '2px 6px' } : undefined}>重点客户</span>}
      {b && <span className="tag kp" style={compact ? { fontSize: 11, padding: '2px 6px' } : undefined}>重点项目</span>}
    </>
  )
}
