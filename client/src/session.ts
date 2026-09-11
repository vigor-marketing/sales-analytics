import type { SaActor } from './Login'

/** 当前登录人（登录后由 App 写入；各表单用它自动带入账号信息，避免逐层传 props） */
let actor: SaActor | null = null
export function setCurrentActor(a: SaActor | null): void { actor = a }
export function currentActor(): SaActor | null { return actor }
/** 登录人是否是销售人员（在工作台销售部名单里） */
export function isSalesActor(metaSales: { name: string; team: string }[]): boolean {
  const a = actor
  if (!a) return false
  return (metaSales ?? []).some((x) => x.name.toLowerCase() === a.name.toLowerCase())
}
/** 登录人是否是采购/支持人员 */
export function isPurchaserActor(metaPurchasers: string[]): boolean {
  const a = actor
  if (!a) return false
  return (metaPurchasers ?? []).some((x) => x.toLowerCase() === a.name.toLowerCase())
}
