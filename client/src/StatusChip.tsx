/** 询报价状态：三种状态统一尺寸，仅颜色与图标不同（已成单/未成单/跟进中） */
export type Status = 'won' | 'lost' | 'following'

export const statusLabel: Record<Status, string> = { won: '已成单', lost: '未成单', following: '跟进中' }

export function StatusChip({ status }: { status?: Status }) {
  const st: Status = status ?? 'following'
  return <span className={`statchip ${st}`}>{statusLabel[st]}</span>
}
