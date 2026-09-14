/**
 * 时间显示统一入口
 *
 * 后端所有「时间」字段（created_at / updated_at / syncedAt …）都按 UTC 存 ISO 字符串（结尾 Z）。
 * 页面如果直接截字符串显示，北京时间就会比实际早 8 小时（登录记录、录入时间都会看着不对）。
 * 这里统一转成本机时区显示。
 *
 * 注意：纯日期字段（date / won_date / lost_date / last_followup_at / next_followup_at 这类 YYYY-MM-DD）
 * 不要用这里的函数，它们本来就没有时区概念。
 */
function toDate(v?: string | null): Date | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  // 带时区（Z / +08:00）的按原样解析；历史数据若没有时区，按 UTC 处理（与后端写入方式一致）
  const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}
const p2 = (n: number) => String(n).padStart(2, '0')

/** 2026-09-14 15:07:38（本机时区） */
export function fmtDateTime(v?: string | null, fallback = '—'): string {
  const d = toDate(v)
  if (!d) return fallback
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}
/** 2026-09-14 15:07（本机时区，到分钟） */
export function fmtMinute(v?: string | null, fallback = '—'): string {
  const d = toDate(v)
  if (!d) return fallback
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}
/** 09-14 15:07（本机时区，列表里省空间） */
export function fmtMdHm(v?: string | null, fallback = '—'): string {
  const d = toDate(v)
  if (!d) return fallback
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}
/** 相对时间：刚刚 / 12 秒前 / 3 分钟前 / 2 小时前 / 4 天前 */
export function fmtAgo(v?: string | null): string {
  const d = toDate(v)
  if (!d) return ''
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  if (sec < 10) return '刚刚'
  if (sec < 60) return `${sec} 秒前`
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)} 天前`
  return fmtMdHm(v)
}
