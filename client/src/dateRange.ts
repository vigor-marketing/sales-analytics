/** 快捷时间范围：全部 / 本周 / 本月 / 上月 / 近3个月 / 本年（周一为一周开始） */
export type RangeKey = '' | 'week' | 'month' | 'lastMonth' | 'q3' | 'year'

export const RANGE_LABEL: Record<RangeKey, string> = {
  '': '全部时间', week: '本周', month: '本月', lastMonth: '上月', q3: '近 3 个月', year: '本年',
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function rangeDates(key: RangeKey): { from: string; to: string } {
  const now = new Date()
  if (key === 'week') {
    const dow = (now.getDay() + 6) % 7 // 周一=0
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow)
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6)
    return { from: iso(mon), to: iso(sun) }
  }
  if (key === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
  if (key === 'lastMonth') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) }
  if (key === 'q3') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: iso(now) }
  if (key === 'year') return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(new Date(now.getFullYear(), 11, 31)) }
  return { from: '', to: '' }
}
