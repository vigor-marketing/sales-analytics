/** 币种下拉选项：以「字段与选项设置 → 币种」维护的清单为准 */
export const FALLBACK_CURRENCIES = ['USD', 'CNY', 'EUR']

/** 配置的币种清单；若当前记录用的币种不在清单里（历史数据/已停用），也补进选项，避免下拉空白 */
export function currencyOptions(configured: string[] | undefined | null, current?: string | null): string[] {
  const list = (configured && configured.length ? configured : FALLBACK_CURRENCIES).slice()
  const cur = String(current ?? '').trim().toUpperCase()
  if (cur && !list.includes(cur)) list.push(cur)
  return list
}
