/** sales-analytics v3 起步：询报价录入页 API */
import cors from 'cors'
import express from 'express'
import { schema, ensurePeople, backfillProducts, migrateWonToOrders, syncWonFlags, getDb, getSources, getCountries, saveSources, getFollowMethods, saveFollowMethods, getLostReasons, saveLostReasons, getWinReasons, saveWinReasons, getSetting, setSetting, newId, nowIso, todayStr, text, num, getCurrencies, saveCurrencies, currencyCodes, fxRates, fxRateOf, renameCurrencyInData, currencyUsage } from './db.js'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 极简 .env 读取：只在服务端生效（工作台令牌等敏感配置不进前端/仓库）；已存在的环境变量优先 */
function loadEnvFile(file: string): void {
  if (!existsSync(file)) return
  try {
    for (const line of String(readFileSyncSafe(file)).split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i < 1) continue
      const k = t.slice(0, i).trim(); const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
      if (process.env[k] === undefined) process.env[k] = v
    }
  } catch { /* 读不到就忽略 */ }
}
function readFileSyncSafe(file: string): string {
  try { return readFileSync(file, 'utf8') } catch { return '' }
}
loadEnvFile(path.join(__dirname, '..', '.env'))
loadEnvFile(path.join(__dirname, '..', '..', '.env'))

/** 工作台（vigor-workbench-platform）组织架构对接配置 */
const WORKBENCH_BASE = (process.env.WORKBENCH_BASE ?? 'http://1.15.91.150').replace(/\/+$/, '')
const WORKBENCH_TOKEN = process.env.ORG_PICKER_TOKEN ?? process.env.WORKBENCH_PICKER_TOKEN ?? ''

const app = express()
app.use(cors())
// 图片/附件以 base64 JSON 上传，body 上限放到 12MB（对应单文件约 8MB 的原始大小）
app.use(express.json({ limit: '12mb' }))
// 上传超限等 body 解析错误，返回统一的中文提示（而不是 HTML 500）
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const e = err as { type?: string; status?: number; message?: string }
  if (e?.type === 'entity.too.large') return fail(res, '文件过大（单个文件上限 8MB）', 413)
  if (e?.status === 400 && e?.message?.includes('JSON')) return fail(res, '请求内容格式不正确', 400)
  return next(err)
})

const str = (v: unknown) => text(v)
/** 文本长度上限校验：超长返回中文错误信息，正常返回 null（避免脏数据把库和界面撑坏） */
function overLimit(fields: [unknown, number, string][]): string | null {
  for (const [v, max, label] of fields) { if (text(v).length > max) return `${label}过长（最多 ${max} 个字符）` }
  return null
}
const NAME_MAX = 120
/** 录入/更新询价时把产品沉淀进产品档案 */
function upsertProducts(
  items: { productName: string; qty: number | null; amount: number; currency: string }[],
  date: string, t: string,
  src: {
    inquiryId?: string; inquiryNo?: string; customerName?: string; sales?: string; source?: string; oneOf?: string[]
    /** 本次保存前的旧明细（按行顺序）：换产品时把「原产品 / 原数量 / 原金额 / 原币种」一并记入变更记录 */
    prevLines?: { product_name: string; qty: number | null; amount: number; currency: string }[]
  } = {},
): void {
  const d = getDb()
  const up = d.prepare(`INSERT INTO products (id, name, currency, last_amount, last_qty, use_count, last_used_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET currency=excluded.currency, last_amount=excluded.last_amount, last_qty=excluded.last_qty,
      use_count=products.use_count+1, last_used_at=excluded.last_used_at, updated_at=excluded.updated_at`)
  const find = d.prepare('SELECT * FROM products WHERE name = ? COLLATE NOCASE')
  const insHist = d.prepare(`INSERT INTO product_prices (id, product_name, currency, amount, qty, prev_amount, prev_qty, prev_currency,
      source, inquiry_id, inquiry_no, customer_name, sales, biz_date, created_at, from_product, from_qty, from_amount, from_currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  items.forEach((it, i) => {
    const before = find.get(it.productName) as { last_amount: number | null; last_qty: number | null; currency: string } | undefined
    // 该行原来是另一个产品 → 属于「产品变更」，即使单价/数量/币种恰好相同，也要留下一条版本与价格记录
    const isEdit = Array.isArray(src.prevLines)          // 只有「编辑保存」才做行级判定，新建询价不额外记流水
    const prevLine = src.prevLines?.[i] ?? null
    const prevName = prevLine ? String(prevLine.product_name ?? '').trim() : null
    const allPrev = (src.prevLines ?? []).map((x) => String(x?.product_name ?? '').trim().toLowerCase())
    const isNewToInquiry = isEdit && !allPrev.includes(it.productName.trim().toLowerCase())
    // 产品变更：这一行换了名字（新名字原本不在本询价里）；新增产品行：本询价原来没有这个产品（追加或换行）
    const swapped = isNewToInquiry && !!prevName && prevName.toLowerCase() !== it.productName.trim().toLowerCase()
    const addedLine = isNewToInquiry && !swapped
    const changed = !before
      || Number(before.last_amount ?? -1) !== Number(it.amount)
      || Number(before.last_qty ?? -1) !== Number(it.qty ?? -1)
      || String(before.currency) !== String(it.currency)
      || swapped || addedLine
    up.run(newId(), it.productName, it.currency, it.amount, it.qty, date, t, t)
    // 首次录入、金额/数量/币种变化、或产品被替换 → 在产品档案留下一条变动记录（版本 + 价格）
    if (changed) {
      insHist.run(newId(), it.productName, it.currency, it.amount, it.qty ?? null,
        before ? (before.last_amount ?? null) : null, before ? (before.last_qty ?? null) : null, before ? before.currency : null,
        swapped ? `${src.source ?? '询报价录入'}·产品变更（原 ${prevName}）`
          : addedLine ? `${src.source ?? '询报价管理·编辑'}·新增产品行` : (src.source ?? '询报价录入'),
        src.inquiryId ?? null, src.inquiryNo ?? null, src.customerName ?? null, src.sales ?? null, date, t,
        swapped ? prevName : null, swapped ? (prevLine?.qty ?? null) : null, swapped ? (prevLine?.amount ?? null) : null, swapped ? (prevLine?.currency ?? null) : null)
    }
  })
}
/** 启动清理：删掉指向已不存在询价的明细行；清掉 24 小时内未被任何记录引用的上传文件 */
function cleanupOrphans(): void {
  try {
    const d = getDb()
    const items = d.prepare('DELETE FROM inquiry_items WHERE inquiry_id NOT IN (SELECT id FROM inquiries)').run()
    if (items.changes) console.log(`[cleanup] 清理孤儿询价明细 ${items.changes} 行`)
    const fees = d.prepare('DELETE FROM fee_versions WHERE inquiry_id NOT IN (SELECT id FROM inquiries)').run()
    if (fees.changes) console.log(`[cleanup] 清理孤儿费用版本 ${fees.changes} 行`)
    const refs = new Set<string>()
    ;(d.prepare('SELECT photos, attachments FROM followups').all() as { photos: string | null; attachments: string | null }[]).forEach((r) => {
      const collect = (v: unknown, key?: string) => {
        if (typeof v === 'string' && v) refs.add(path.basename(v))
        else if (v && typeof v === 'object') { const u = (v as Record<string, unknown>)[key ?? 'url']; if (typeof u === 'string' && u) refs.add(path.basename(u)) }
      }
      try { (JSON.parse(r.photos || '[]') as unknown[]).forEach((x) => collect(x)) } catch { /* 忽略 */ }
      try { (JSON.parse(r.attachments || '[]') as unknown[]).forEach((x) => collect(x)) } catch { /* 忽略 */ }
    })
    if (!existsSync(UPLOAD_DIR)) return
    const cutoff = Date.now() - 24 * 3600 * 1000
    let removed = 0
    readdirSync(UPLOAD_DIR).forEach((f) => {
      const full = path.join(UPLOAD_DIR, f)
      try {
        const st = statSync(full)
        if (st.isFile() && st.mtimeMs < cutoff && !refs.has(f)) { unlinkSync(full); removed += 1 }
      } catch { /* 忽略单个文件错误 */ }
    })
    if (removed) console.log(`[cleanup] 清理未引用的上传文件 ${removed} 个`)
  } catch (e) { console.warn('[cleanup] 跳过：', (e as Error).message) }
}

const ok = (res: express.Response, data: unknown, st = 200) => res.status(st).json({ ok: true, data })
// LIKE 参数：转义用户输入中的 % 与 _，配合 SQL 里的 ESCAPE \'!\' 使用（避免把通配符当字面量/全表匹配）
const likeArg = (v: string) => `%${v.replace(/[!%_]/g, (m) => `!${m}`)}%`

// 日期合法性（YYYY-MM-DD 且真实存在）
const isDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(y, m - 1, d)                       // 按本地时间构造，避免时区偏移
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}
const fail = (res: express.Response, msg: string, st = 400) => res.status(st).json({ ok: false, error: msg })

/** /api/* 统一鉴权（注册在所有路由之前）：除登录接口外都必须带工作台会话 */
const AUTH_OPEN = ['/auth/login']
app.use('/api', (req, res, next) => {
  if (AUTH_OPEN.includes(req.path)) return next()
  const actor = actorOf(req)
  if (!actor) return res.status(401).json({ ok: false, error: '请先登录（工作台账号）', needLogin: true })
  ;(req as express.Request & { actor?: SaActor }).actor = actor
  next()
})
/** 设置类写操作（组织架构同步、字段与选项、币种、来源等）：仅「全部」范围可改 */
const NEED_ALL_SCOPE = ['/org/sync', '/options/save', '/sources', '/currencies', '/countries-custom', '/follow-methods', '/lost-reasons', '/win-reasons']
app.use('/api', (req, res, next) => {
  const a = (req as express.Request & { actor?: SaActor }).actor
  if (!a || req.method === 'GET') return next()
  if (NEED_ALL_SCOPE.some((x) => req.path === x || req.path.startsWith(x + '/')) && a.scope !== 'all') return fail(res, '仅总经理 / 副总经理（或管理员）可操作设置', 403)
  next()
})

// —— 费用（运费/税费/佣金/其他）：金额录入，与明细合并成「总报价」 ——
const FEE_KEYS = [
  { key: 'freight', label: '运费', col: 'freight', curCol: 'freight_currency' },
  { key: 'tax', label: '税费', col: 'tax', curCol: 'tax_currency' },
  { key: 'commission', label: '佣金', col: 'commission', curCol: 'commission_currency' },
  { key: 'otherFee', label: '其他费用', col: 'other_fee', curCol: 'other_fee_currency' },
] as const
/** 每项费用各自的币种（老数据该列为空时回退到询价上的默认费用币种 fee_currency） */
function feeCurOfRow(r: Record<string, unknown>, curCol: string): string {
  const v = str(r[curCol])
  return v ? normCurrency(v) : feeCurrencyOf(r.fee_currency)
}
/** 四项费用（金额 + 各自币种），供展示与折算 */
function feeItemsOf(r: Record<string, unknown>): { key: string; label: string; value: number; currency: string }[] {
  return FEE_KEYS.map((f) => ({ key: f.key, label: f.label, value: num(r[f.col]) ?? 0, currency: feeCurOfRow(r, f.curCol) }))
}
/** 费用按各自币种合计成若干档（供与产品明细合并成总报价） */
function feeTotalsOf(r: Record<string, unknown>): { currency: string; total: number }[] {
  const m = new Map<string, number>()
  feeItemsOf(r).forEach((f) => { if (f.value) m.set(f.currency, (m.get(f.currency) ?? 0) + f.value) })
  return Array.from(m.entries()).map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }))
}
/** 费用折 USD 合计（每项按各自币种汇率折算；优先用该询价上覆盖的汇率） */
function feeUsdOf(r: Record<string, unknown>, rates?: Record<string, number>): number {
  const rs = rates ?? ratesOf(r)
  return Math.round(feeItemsOf(r).reduce((s, f) => s + f.value / rateIn(rs, f.currency), 0))
}
/** 读取四项费用（非数字/负数视为 0），并校验范围 */
function readFees(body: Record<string, unknown> | undefined): { values: Record<string, number | null>; currencies: Record<string, string | null>; total: number; err?: string } {
  const values: Record<string, number | null> = {}
  const currencies: Record<string, string | null> = {}
  let total = 0
  for (const f of FEE_KEYS) {
    const v = num(body?.[f.key])
    if (v != null && (v < 0 || v > 1e12)) return { values, currencies, total, err: `${f.label}需为 0 ~ 1e12 之间的数值` }
    values[f.key] = v
    total += v ?? 0
    // 每项费用可单独指定币种（未传则沿用询价上的默认费用币种）
    const rawCur = body?.[`${f.key}Currency`]
    currencies[f.key] = rawCur === undefined || rawCur === null || rawCur === '' ? null : normCurrency(rawCur)
  }
  return { values, currencies, total: Math.round(total * 100) / 100 }
}
/** 询价总额：明细按币种合计 + 若干档费用（费用可来自不同币种） */
function grandTotals(items: { currency: string; total: number }[], feeBuckets: { currency: string; total: number }[]): { currency: string; total: number }[] {
  const merged = items.map((x) => ({ currency: x.currency, amount: x.total }))
  feeBuckets.forEach((b) => { if (b.total) merged.push({ currency: b.currency, amount: b.total }) })
  return fmtTotals(merged)
}
/** 解析询价上的汇率覆盖（录入时按实际汇率算，未覆盖的用设置里的默认汇率） */
function ratesOf(r: Record<string, unknown> | null | undefined): Record<string, number> {
  const base = fxRates()
  const raw = r ? str(r.fx_overrides) : ''
  if (!raw) return base
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    Object.keys(obj).forEach((k) => {
      const v = Number(obj[k])
      const code = k.trim().toUpperCase()
      if (code && Number.isFinite(v) && v > 0) base[code] = v
    })
  } catch { /* 忽略坏数据 */ }
  return base
}
/** 读取前端传入的汇率覆盖 {币种: 汇率}，只保留合法项；无有效项时返回 null */
function readFxOverrides(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null
  const codes = currencyCodes()
  const out: Record<string, number> = {}
  Object.keys(v as Record<string, unknown>).forEach((k) => {
    const code = k.trim().toUpperCase()
    const rate = Number((v as Record<string, unknown>)[k])
    if (code === 'USD' || !codes.includes(code)) return
    if (Number.isFinite(rate) && rate > 0 && rate <= 1e6) out[code] = rate
  })
  return Object.keys(out).length ? JSON.stringify(out) : null
}
/** 订单金额折 USD：订单上填写的金额为准（按订单币种与本单汇率折算）；未填金额时回退到询价报价合计 */
function orderUsdOf(d: ReturnType<typeof getDb>, o: { inquiry_id?: unknown; amount?: unknown; currency?: unknown }, inqRow?: Record<string, unknown>): number {
  const amount = num(o.amount)
  if (amount != null) {
    const row = inqRow ?? (d.prepare('SELECT * FROM inquiries WHERE id = ?').get(text(o.inquiry_id)) as Record<string, unknown> | undefined)
    return amount / rateIn(ratesOf(row), str(o.currency) || 'USD')
  }
  return inquiryUsdTotal(d, text(o.inquiry_id), inqRow)
}
const rateIn = (rates: Record<string, number>, currency: string) => (rates[str(currency).trim().toUpperCase()] || 1)
const usdOfTotals = (totals: { currency: string; total: number }[], rates?: Record<string, number>) =>
  totals.reduce((s, x) => s + x.total / ((rates ? rateIn(rates, x.currency) : fxRateOf(x.currency)) || 1), 0)
const feeCurrencyOf = (v: unknown) => normCurrency(v)
/** 询价行上的费用合计 */
function feeTotalOf(r: Record<string, unknown>): number {
  const n = (v: unknown) => num(v) ?? 0
  return Math.round((n(r.freight) + n(r.tax) + n(r.commission) + n(r.other_fee)) * 100) / 100
}
/** 单个询价的折USD总额（含费用）：明细按币种合计 + 费用（费用币种档） */
function inquiryUsdTotal(d: ReturnType<typeof getDb>, inquiryId: string, row?: Record<string, unknown>): number {
  const items = d.prepare('SELECT amount, qty, currency FROM inquiry_items WHERE inquiry_id = ?').all(inquiryId) as { amount: number; qty: number | null; currency: string }[]
  const r = row ?? (d.prepare('SELECT * FROM inquiries WHERE id = ?').get(inquiryId) as Record<string, unknown> | undefined)
  const totals = fmtTotals(items.map((x) => ({ currency: x.currency, amount: Number(x.amount) || 0, qty: x.qty })))
  // 费用按各自币种折算后并入（每项费用可有独立汇率）
  const rates = ratesOf(r)
  const feeUsd = r ? feeUsdOf(r, rates) : 0
  return usdOfTotals(totals, rates) + feeUsd
}

/** 写一条费用版本（费用发生变化时调用，与产品价格版本并列，便于追溯） */
function insertFeeVersion(inquiryId: string, vals: Record<string, number | null>, curs: Record<string, string | null>, feeCurrency: string, source: string, rateOverride?: Record<string, number>): void {
  const total = FEE_KEYS.reduce((s, f) => s + (vals[f.key] ?? 0), 0)
  if (!total) return
  // 每项费用的币种（未指定则用默认费用币种）；全部同币种时沿用原语义，混币种时 total 记折算 USD
  const rs = rateOverride ?? ratesOf(null)
  const detail = FEE_KEYS.map((f) => ({ key: f.key, label: f.label, value: vals[f.key] ?? 0, currency: curs[f.key] ?? feeCurrency, rate: rateIn(rs, curs[f.key] ?? feeCurrency) }))
    .filter((x) => x.value)
  const used = Array.from(new Set(detail.map((x) => x.currency)))
  const sameCur = used.length === 1 ? used[0] : null
  const totalOut = sameCur ? Math.round(total * 100) / 100 : Math.round(detail.reduce((s2, x) => s2 + x.value / x.rate, 0) * 100) / 100
  getDb().prepare(`INSERT INTO fee_versions (id, inquiry_id, freight, tax, commission, other_fee, fee_currency, total, source, created_at, fee_detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(newId(), inquiryId, vals.freight ?? null, vals.tax ?? null, vals.commission ?? null, vals.otherFee ?? null, sameCur ?? 'USD', totalOut, source, nowIso(),
      JSON.stringify(detail))
}
/** 费用版本列表（按时间正序编号 V1、V2…） */
function feeVersionsOf(inquiryId: string): Record<string, unknown>[] {
  const rows = getDb().prepare('SELECT * FROM fee_versions WHERE inquiry_id = ? ORDER BY created_at ASC, rowid ASC').all(inquiryId) as Record<string, unknown>[]
  return rows.map((r, i) => ({ ...r, version: i + 1, is_latest: i === rows.length - 1 })).reverse()
}

/** 费用明细（含 0 项也返回，便于前端展示输入框回填；带各自币种与折 USD） */
function feeBreakdown(r: Record<string, unknown>): { key: string; label: string; value: number | null; currency: string; usd: number }[] {
  return FEE_KEYS.map((f) => {
    const value = num(r[f.col])
    const currency = feeCurOfRow(r, f.curCol)
    const rates = ratesOf(r)
    return { key: f.key, label: f.label, value, currency, rate: rateIn(rates, currency), usd: Math.round((value ?? 0) / rateIn(rates, currency)) }
  })
}

// —— 基础元数据：组织人员 / 来源 / 国别 / 汇率（开发态近似，后续接设置）——
app.get('/api/meta/bootstrap', (_req, res) => {
  const d = getDb()
  const people = d.prepare('SELECT name, department, team_name, role FROM people ORDER BY team_name, name').all() as { name: string; department: string; team_name: string; role: string }[]
  const sales = people.filter((p) => p.role === 'sales').map((p) => ({ name: p.name, team: p.team_name }))
  const purchasers = people.filter((p) => ['采购部', '销售支持组'].includes(p.department)).map((p) => p.name)
  // 采购人员按小组（部门/组别）分组，供录入时逐级筛选
  const purchaserTeams = people.filter((p) => ['采购部', '销售支持组'].includes(p.department))
    .map((p) => ({ name: p.name, team: p.team_name || p.department }))
  ok(res, { sales, purchasers, purchaserTeams, sources: getSources(), methods: getFollowMethods(), lostReasons: getLostReasons(), winReasons: getWinReasons(), countries: getCountries(), currencies: currencyCodes(), fx: fxRates(), month: todayStr().slice(0, 7) })
})

// ============================ 组织架构（对接工作台，保持同步） ============================
/** 工作台 org 数据（部门 → 团队 → 人员） */
interface WbPerson { id: string; role: string; name: string; englishName?: string; department: string; team: string }
interface OrgPerson { id: string; name: string; cnName: string; englishName: string; department: string; team: string; role: string; roleLabel: string }
interface OrgDept { name: string; teams: { name: string; persons: OrgPerson[] }[] }

/** 本系统里的角色归属：销售部→sales；采购部/销售支持组→support；其它部门→other（只镜像展示，不进销售/采购下拉） */
function orgRoleOf(department: string): { role: string; label: string } {
  if (department === '销售部') return { role: 'sales', label: '销售' }
  if (department === '采购部') return { role: 'support', label: '采购' }
  if (department === '销售支持组') return { role: 'support', label: '销售支持' }
  return { role: 'other', label: '其它部门' }
}
/** 本系统里显示的名字：优先英文名（历史询价/订单里记的就是英文名），没有英文名时用中文名 */
const orgDisplayName = (p: WbPerson) => String(p.englishName || '').trim() || String(p.name || '').trim()

/** 拉取工作台组织架构（服务端调用，令牌只在服务端） */
async function fetchWorkbenchOrg(): Promise<{ persons: OrgPerson[]; departments: OrgDept[]; fetchedAt: string }> {
  if (!WORKBENCH_TOKEN) throw new Error('未配置工作台令牌（ORG_PICKER_TOKEN），请在 server/.env 里配置后重启')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 10000)
  try {
    const r = await fetch(`${WORKBENCH_BASE}/api/org/tree`, { headers: { 'X-Picker-Token': WORKBENCH_TOKEN }, signal: ctl.signal })
    if (r.status === 401 || r.status === 403) throw new Error('工作台令牌无效或无权限（401/403）')
    if (!r.ok) throw new Error(`工作台返回 ${r.status}`)
    const tree = await r.json() as { department: string; teams: { team: string; persons: WbPerson[] }[] }[]
    if (!Array.isArray(tree)) throw new Error('工作台返回的 org/tree 结构不正确')
    const departments: OrgDept[] = tree.map((d) => ({
      name: String(d.department ?? ''),
      teams: (d.teams ?? []).map((t) => ({
        name: String(t.team ?? ''),
        persons: (t.persons ?? []).map((p) => {
          const info = orgRoleOf(String(d.department ?? ''))
          return {
            id: String(p.id ?? ''), name: orgDisplayName(p), cnName: String(p.name ?? ''), englishName: String(p.englishName ?? ''),
            department: String(d.department ?? ''), team: String(t.team ?? ''), role: info.role, roleLabel: String(p.role || info.label),
          }
        }),
      })),
    }))
    const persons = departments.flatMap((d) => d.teams.flatMap((t) => t.persons))
    return { persons, departments, fetchedAt: nowIso() }
  } finally { clearTimeout(timer) }
}

/** 本系统当前人员档案 + 与工作台的差异（用于设置页展示与同步确认） */
function localOrgState(persons?: OrgPerson[]) {
  const d = getDb()
  const local = d.prepare('SELECT name, department, team_name, role FROM people ORDER BY department, team_name, name').all() as { name: string; department: string; team_name: string; role: string }[]
  // 名字是否还被询价/订单/跟进引用（同步删除前提示用）
  const refOf = (name: string) => {
    const q = d.prepare('SELECT (SELECT COUNT(*) FROM inquiries WHERE sales = ?) + (SELECT COUNT(*) FROM followups WHERE by_name = ?) AS a, (SELECT COUNT(*) FROM inquiries WHERE purchaser = ?) AS b').get(name, name, name) as { a: number; b: number }
    return Number(q?.a ?? 0) + Number(q?.b ?? 0)
  }
  const base = { local, teams: Array.from(new Set(local.filter((x) => x.role === 'sales').map((x) => x.team_name))).sort(), syncedAt: getSetting('orgSyncAt') || '', syncInfo: getSetting('orgSyncInfo') || '' }
  if (!persons) return { ...base, add: [], update: [], remove: [], unchanged: 0 }
  const byName = new Map(persons.map((p) => [p.name.toLowerCase(), p]))
  const localByName = new Map(local.map((p) => [p.name.toLowerCase(), p]))
  const add = persons.filter((p) => !localByName.has(p.name.toLowerCase())).map((p) => ({ name: p.name, cnName: p.cnName, department: p.department, team: p.team, role: p.role, roleLabel: p.roleLabel }))
  const update = persons.filter((p) => {
    const l = localByName.get(p.name.toLowerCase())
    return l && (l.department !== p.department || l.team_name !== p.team || l.role !== p.role)
  }).map((p) => {
    const l = localByName.get(p.name.toLowerCase()) as { department: string; team_name: string; role: string }
    const parts: string[] = []
    if (l.department !== p.department) parts.push(`部门 ${l.department} → ${p.department}`)
    if (l.team_name !== p.team) parts.push(`小组 ${l.team_name} → ${p.team}`)
    if (l.role !== p.role) parts.push(`角色 ${l.role} → ${p.role}`)
    return { name: p.name, changes: parts, department: p.department, team: p.team, role: p.role }
  })
  const remove = local.filter((p) => !byName.has(p.name.toLowerCase())).map((p) => ({ name: p.name, department: p.department, team: p.team_name, role: p.role, refs: refOf(p.name) }))
  const unchanged = persons.length - add.length - update.length
  return { ...base, add, update, remove, unchanged }
}

/** 全量镜像：以工作台为准写入本系统人员档案（多出的删除） */
function applyOrgMirror(persons: OrgPerson[]): { added: number; updated: number; removed: number; total: number } {
  const d = getDb()
  let added = 0; let updated = 0; let removed = 0
  d.transaction(() => {
    const up = d.prepare(`INSERT INTO people (id, name, department, team_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, department = excluded.department, team_name = excluded.team_name, role = excluded.role`)
    const find = d.prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE')
    const before = d.prepare('SELECT name FROM people').all() as { name: string }[]
    const beforeSet = new Set(before.map((x) => x.name.toLowerCase()))
    persons.forEach((p) => {
      const hit = find.get(p.name) as { id: string } | undefined
      up.run(hit ? hit.id : `wb-${p.id || newId()}`, p.name, p.department, p.team, p.role, nowIso())
      if (hit) updated += 1; else added += 1
    })
    const keep = new Set(persons.map((p) => p.name.toLowerCase()))
    before.forEach((x) => { if (!keep.has(x.name.toLowerCase())) { d.prepare('DELETE FROM people WHERE name = ? COLLATE NOCASE').run(x.name); removed += 1 } })
  })()
  return { added, updated, removed, total: persons.length }
}

/** 同步一次（拉取 + 镜像写入），返回结果供接口/启动日志使用 */
async function syncOrgFromWorkbench(): Promise<{ fetchedAt: string; departments: number; persons: number; applied: { added: number; updated: number; removed: number; total: number } }> {
  const { persons, departments, fetchedAt } = await fetchWorkbenchOrg()
  const applied = applyOrgMirror(persons)
  setSetting('orgSyncAt', fetchedAt)
  setSetting('orgSyncInfo', JSON.stringify({ ...applied, departments: departments.length, base: WORKBENCH_BASE }))
  return { fetchedAt, departments: departments.length, persons: persons.length, applied }
}

/** 活动/停用：工作台有这个人，本系统就应该有（保持同步的判定依据） */
app.get('/api/org/workbench', async (_req, res) => {
  try {
    const { persons, departments, fetchedAt } = await fetchWorkbenchOrg()
    ok(res, {
      base: WORKBENCH_BASE, tokenConfigured: !!WORKBENCH_TOKEN, fetchedAt,
      departments, persons: persons.map((p) => ({ ...p })),
      counts: {
        departments: departments.length,
        teams: departments.reduce((a, d) => a + d.teams.length, 0),
        persons: persons.length,
        sales: persons.filter((p) => p.role === 'sales').length,
        support: persons.filter((p) => p.role === 'support').length,
        other: persons.filter((p) => p.role === 'other').length,
      },
      diff: localOrgState(persons),
    })
  } catch (e) { fail(res, (e as Error).message, 502) }
})
app.post('/api/org/sync', async (_req, res) => {
  try {
    const r = await syncOrgFromWorkbench()
    ok(res, { ...r, local: localOrgState() })
  } catch (e) { fail(res, (e as Error).message, 502) }
})
// 只读：本系统当前人员档案（不调用工作台）
app.get('/api/org/local', (_req, res) => ok(res, { base: WORKBENCH_BASE, tokenConfigured: !!WORKBENCH_TOKEN, ...localOrgState() }))

// ============================ 登录与权限（工作台 SSO + 数据范围） ============================
/**
 * 登录：用工作台账号密码调 POST {工作台}/api/auth/login，拿到岗位/部门/小组后在本系统建会话。
 * 数据范围（读）：总经理/副总/管理员＝全部；部门负责人或经理＝本组；其他人＝自己。
 * 写入范围：只有「全部」权限可以改别人的；组长能看到本组，但只能改自己的（需求：组长只看不改别人的）。
 */
type SaScope = 'all' | 'team' | 'self'
interface SaActor {
  username: string; name: string; cnName: string; role: string; roleLabel: string
  department: string; team: string; head: boolean; isAdmin: boolean
  scope: SaScope; reason: string
  /** 可查看的销售名集合（null = 不限） */
  readNames: string[] | null
  /** 可写入的销售名集合（null = 不限） */
  writeNames: string[] | null
}
const SESSION_COOKIE = 'sa_session'
const SESSION_HOURS = Number(process.env.SESSION_HOURS ?? 12)

/** 会话签名密钥：环境变量优先，否则写入设置表（服务端，不外泄） */
function sessionSecret(): string {
  const env = process.env.SESSION_SECRET
  if (env && env.length >= 16) return env
  let v = getSetting('sessionSecret') || ''
  if (v.length < 16) { v = randomBytes(32).toString('base64url'); setSetting('sessionSecret', v) }
  return v
}
const b64u = (v: string) => Buffer.from(v).toString('base64url')
function signSession(data: Record<string, unknown>): string {
  const payload = b64u(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 }))
  const sig = createHmac('sha256', sessionSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}
function verifySession(token: string): SaActor | null {
  const [payload, sig] = String(token || '').split('.')
  if (!payload || !sig) return null
  const expect = createHmac('sha256', sessionSecret()).update(payload).digest('base64url')
  const a = Buffer.from(sig); const b = Buffer.from(expect)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const o = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number; actor?: SaActor }
    if (!o?.exp || o.exp < Math.floor(Date.now() / 1000) || !o.actor) return null
    return o.actor
  } catch { return null }
}
function cookieOf(req: express.Request, name: string): string {
  const raw = String(req.headers.cookie || '')
  const hit = raw.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`))
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : ''
}
/** 当前登录人：会话里带着岗位快照，但每次请求都按本系统人员档案重算可读名单，保证组织架构同步后立即生效 */
function actorOf(req: express.Request): SaActor | null {
  const raw = cookieOf(req, SESSION_COOKIE) || (String(req.headers.authorization || '').startsWith('Bearer ') ? String(req.headers.authorization).slice(7) : '')
  const actor = verifySession(raw)
  if (!actor) return null
  return { ...actor, ...scopeOf(actor) }
}
/** 按人员档案把「可读/可写名单」算出来 */
function scopeOf(actor: Pick<SaActor, 'scope' | 'name'>): Pick<SaActor, 'readNames' | 'writeNames'> {
  const d = getDb()
  if (actor.scope === 'all') return { readNames: null, writeNames: null }
  if (actor.scope === 'self') return { readNames: [actor.name], writeNames: [actor.name] }
  const team = (actor as unknown as { team?: string }).team ?? ''
  const mates = d.prepare("SELECT name FROM people WHERE role = 'sales' AND team_name = ?").all(team) as { name: string }[]
  const names = Array.from(new Set([actor.name, ...mates.map((m) => m.name)].filter(Boolean)))
  return { readNames: names.length ? names : [actor.name], writeNames: [actor.name] }   // 组长：读本组，写只写自己的
}
/** 工作台人员索引（id/英文名 → 本系统显示名与小组），登录时用于把账号映射到销售名 */
async function workbenchPeopleIndex(): Promise<Map<string, { name: string; cnName: string; department: string; team: string; roleLabel: string }>> {
  const { persons } = await fetchWorkbenchOrg()
  const m = new Map<string, { name: string; cnName: string; department: string; team: string; roleLabel: string }>()
  persons.forEach((p) => {
    const rec = { name: p.name, cnName: p.cnName, department: p.department, team: p.team, roleLabel: p.roleLabel }
    ;[p.id, p.englishName, p.name].filter(Boolean).forEach((k) => m.set(String(k).toLowerCase(), rec))
  })
  return m
}
/** 岗位 → 数据范围 */
function scopeFor(u: { role?: string; department?: string; departmentHead?: boolean; isAdmin?: boolean }): { scope: SaScope; reason: string } {
  const role = String(u.role || '')
  if (u.isAdmin) return { scope: 'all', reason: '管理员' }
  if (String(u.department || '') === '总经理办公室' || /general_manager|deputy|gm|副总|总经理/i.test(role)) return { scope: 'all', reason: '总经理 / 副总经理办公室' }
  if (u.departmentHead || /manager|head|lead|经理|主管|负责人/i.test(role)) return { scope: 'team', reason: '组长 / 部门负责人' }
  return { scope: 'self', reason: '个人' }
}
// —— 登录（工作台账号）——
app.post('/api/auth/login', async (req, res) => {
  const username = str(req.body?.username).trim(); const password = str(req.body?.password)
  if (!username || !password) return fail(res, '请输入账号和密码')
  try {
    const r = await fetch(`${WORKBENCH_BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
    })
    const body = await r.json().catch(() => ({})) as { user?: Record<string, unknown>; message?: string; error?: string }
    if (!r.ok || !body?.user) return fail(res, body?.message || body?.error || '工作台账号或密码不正确', 401)
    const u = body.user as { username?: string; displayName?: string; role?: string; department?: string; teamName?: string; departmentHead?: boolean; isAdmin?: boolean }
    // 账号 → 本系统销售名（英文名）：优先按 id/英文名匹配工作台人员清单
    let name = String(u.displayName || u.username || ''); let cnName = ''; let team = String(u.teamName || ''); let department = String(u.department || ''); let roleLabel = ''
    try {
      const idx = await workbenchPeopleIndex()
      const hit = idx.get(String(u.username || '').toLowerCase()) || idx.get(name.toLowerCase())
      if (hit) { name = hit.name || name; cnName = hit.cnName; team = hit.team || team; department = hit.department || department; roleLabel = hit.roleLabel }
    } catch { /* 工作台组织接口不可用时，退回账号自带信息 */ }
    const { scope, reason } = scopeFor({ role: u.role, department, departmentHead: u.departmentHead, isAdmin: u.isAdmin })
    const actor: SaActor = {
      username: String(u.username || ''), name, cnName, role: String(u.role || ''), roleLabel,
      department, team, head: !!u.departmentHead, isAdmin: !!u.isAdmin, scope, reason,
      readNames: null, writeNames: null,
    }
    const full = { ...actor, ...scopeOf(actor) }
    const token = signSession({ actor: full })
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`)
    ok(res, { actor: full, sessionHours: SESSION_HOURS })
  } catch (e) { fail(res, `无法连接工作台登录：${(e as Error).message}`, 502) }
})
app.get('/api/auth/session', (req, res) => {
  const a = actorOf(req)
  if (!a) return res.status(401).json({ ok: false, error: '请先登录（工作台账号）', needLogin: true })
  ok(res, { actor: a, sessionHours: SESSION_HOURS })
})
app.post('/api/auth/logout', (_req, res) => { res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); ok(res, { ok: true }) })

const actorIn = (req: express.Request): SaActor => (req as express.Request & { actor?: SaActor }).actor as SaActor
/** 只读范围条件：返回 ` AND col IN (?,?)`（全部权限时为空串） */
function scopeSql(actor: SaActor | undefined, col: string): { sql: string; args: string[] } {
  const names = actor?.readNames
  if (!actor || !names) return { sql: '', args: [] }
  return { sql: ` AND ${col} IN (${names.map(() => '?').join(',')})`, args: names }
}
/** 是否允许写这条（按销售名）：全部权限随便写，其它人只能写自己的 */
function canWrite(actor: SaActor | undefined, salesName: unknown): boolean {
  if (!actor) return false
  if (!actor.writeNames) return true
  const n = String(salesName || '').trim().toLowerCase()
  return actor.writeNames.some((x) => x.toLowerCase() === n)
}
/** 读校验：能否看这条（按销售名） */
function canRead(actor: SaActor | undefined, salesName: unknown): boolean {
  if (!actor) return false
  if (!actor.readNames) return true
  const n = String(salesName || '').trim().toLowerCase()
  return actor.readNames.some((x) => x.toLowerCase() === n)
}
// —— 产品档案：录入自动沉淀 + 查询/维护 ——
app.get('/api/products', (req, res) => {
  const d = getDb()
  const q = str(req.query.q)
  const like = likeArg(q)
  const rows = (q
    ? d.prepare('SELECT * FROM products WHERE name LIKE ? ESCAPE \'!\' ORDER BY use_count DESC, updated_at DESC LIMIT 500').all(like)
    : d.prepare('SELECT * FROM products ORDER BY use_count DESC, updated_at DESC LIMIT 500').all()) as Record<string, unknown>[]
  // 价格变动：最近一次记录里的“上一次金额/数量”，以及累计变动次数
  const hist = d.prepare('SELECT product_name, prev_amount, prev_qty, prev_currency, amount, qty, currency, created_at FROM product_prices ORDER BY created_at DESC').all() as
    { product_name: string; prev_amount: number | null; prev_qty: number | null; prev_currency: string | null; amount: number | null; qty: number | null; currency: string; created_at: string }[]
  const latest = new Map<string, typeof hist[number]>()
  const counts = new Map<string, number>()
  hist.forEach((h) => {
    const k = h.product_name.toLowerCase()
    counts.set(k, (counts.get(k) ?? 0) + 1)
    if (!latest.has(k)) latest.set(k, h)
  })
  ok(res, rows.map((r) => {
    const k = String(r.name).toLowerCase()
    const h = latest.get(k)
    const prevAmount = h ? h.prev_amount : null
    return {
      ...r,
      prev_amount: prevAmount,
      prev_qty: h ? h.prev_qty : null,
      prev_currency: h ? h.prev_currency : null,
      amount_delta: (prevAmount == null || r.last_amount == null) ? null : Math.round((Number(r.last_amount) - Number(prevAmount)) * 100) / 100,
      change_count: counts.get(k) ?? 0,
      version: counts.get(k) ?? 0,
    }
  }))
})

// 单个产品的价格变动记录（谁改的、什么时候、从多少变到多少、来源询价）
app.get('/api/products/history', (req, res) => {
  const name = str(req.query.name)
  if (!name) return fail(res, '请提供产品名称')
  const rows = getDb().prepare('SELECT * FROM product_prices WHERE product_name = ? COLLATE NOCASE ORDER BY created_at ASC, biz_date ASC LIMIT 500').all(name) as Record<string, unknown>[]
  // 按时间顺序编版本号：V1 首次录入，之后每次变动 +1
  const versioned = rows.map((r, i) => ({ ...r, version: i + 1, is_latest: i === rows.length - 1 }))
  ok(res, versioned.reverse())
})
app.post('/api/products', (req, res) => {
  const name = str(req.body?.name)
  if (!name) return fail(res, '产品名称必填')
  if (name.length > NAME_MAX) return fail(res, `产品名称过长（最多 ${NAME_MAX} 个字符）`)
  const t = nowIso()
  // 只在显式传入时才覆盖已有值：未传币种/金额/数量时保留原值，避免手动维护把档案清空
  const rawCur = str(req.body?.currency)
  const cur = isCurrency(rawCur) ? rawCur.trim().toUpperCase() : null
  const amt = num(req.body?.lastAmount)
  const qty = num(req.body?.lastQty)
  const d = getDb()
  const before = d.prepare('SELECT * FROM products WHERE name = ? COLLATE NOCASE').get(name) as { id: string; last_amount: number | null; last_qty: number | null; currency: string } | undefined
  if (before) {
    // 已有档案：只覆盖本次显式传入的字段，其余保留原值
    d.prepare(`UPDATE products SET currency = COALESCE(?, currency), last_amount = COALESCE(?, last_amount),
      last_qty = COALESCE(?, last_qty), updated_at = ? WHERE id = ?`).run(cur, amt, qty, t, before.id)
  } else {
    d.prepare(`INSERT INTO products (id, name, currency, last_amount, last_qty, use_count, last_used_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`).run(newId(), name, cur ?? 'USD', amt, qty, t, t)
  }
  const after = d.prepare('SELECT * FROM products WHERE name = ? COLLATE NOCASE').get(name) as { currency: string; last_amount: number | null; last_qty: number | null }
  if (amt != null && Number(before?.last_amount ?? -1) !== Number(amt)) {
    d.prepare(`INSERT INTO product_prices (id, product_name, currency, amount, qty, prev_amount, prev_qty, prev_currency, source, biz_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(newId(), name, after.currency, amt, qty, before?.last_amount ?? null, before?.last_qty ?? null, before?.currency ?? null, '手动维护', todayStr(), t)
  }
  ok(res, getDb().prepare('SELECT * FROM products WHERE name = ? COLLATE NOCASE').get(name), 201)
})
app.put('/api/products/:id', (req, res) => {
  const d = getDb()
  const oldP = d.prepare('SELECT id, name FROM products WHERE id = ?').get(req.params.id) as { id: string; name: string } | undefined
  if (!oldP) return fail(res, '产品不存在', 404)
  const name = str(req.body?.name)
  if (name.length > NAME_MAX) return fail(res, `产品名称过长（最多 ${NAME_MAX} 个字符）`)
  const cur = isCurrency(req.body?.currency) ? str(req.body?.currency).trim().toUpperCase() : null
  if (name && name !== oldP.name) {
    if (d.prepare('SELECT id FROM products WHERE name = ? COLLATE NOCASE AND id <> ?').get(name, req.params.id)) return fail(res, `产品名称「${name}」已存在`, 409)
    d.transaction(() => {
      d.prepare('UPDATE products SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), req.params.id)
      // 价格历史按名称关联，改名同步迁移，避免历史「丢失」
      d.prepare('UPDATE product_prices SET product_name = ? WHERE product_name = ? COLLATE NOCASE').run(name, oldP.name)
    })()
  }
  if (cur) d.prepare('UPDATE products SET currency = ?, updated_at = ? WHERE id = ?').run(cur, nowIso(), req.params.id)
  if (req.body?.lastAmount !== undefined) {
    const cur2 = d.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id) as { name: string; last_amount: number | null; last_qty: number | null; currency: string }
    const amt = num(req.body?.lastAmount)
    d.prepare('UPDATE products SET last_amount = ?, updated_at = ? WHERE id = ?').run(amt, nowIso(), req.params.id)
    if (Number(cur2.last_amount ?? -1) !== Number(amt)) {
      d.prepare(`INSERT INTO product_prices (id, product_name, currency, amount, qty, prev_amount, prev_qty, prev_currency, source, biz_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(newId(), cur2.name, cur2.currency, amt, cur2.last_qty, cur2.last_amount, cur2.last_qty, cur2.currency, '手动维护', todayStr(), nowIso())
    }
  }
  ok(res, d.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id))
})
app.delete('/api/products/:id', (req, res) => {
  const r = getDb().prepare('DELETE FROM products WHERE id = ?').run(req.params.id)
  if (!r.changes) return fail(res, '产品不存在', 404)
  ok(res, { deleted: 1 })
})

// —— 跟进方式字典管理（设置页统一维护） ——
app.get('/api/follow-methods', (_req, res) => ok(res, getFollowMethods()))
app.post('/api/follow-methods', (req, res) => {
  const b = (req.body ?? {}) as { action?: string; value?: string; newValue?: string }
  const list = getFollowMethods()
  if (b.action === 'add' && str(b.value)) { const v = str(b.value); if (!list.includes(v)) list.push(v); saveFollowMethods(list); return ok(res, list) }
  if (b.action === 'remove' && str(b.value)) { saveFollowMethods(list.filter((x) => x !== str(b.value))); return ok(res, getFollowMethods()) }
  if (b.action === 'rename' && str(b.value) && str(b.newValue)) { saveFollowMethods(list.map((x) => (x === str(b.value) ? str(b.newValue) : x))); return ok(res, getFollowMethods()) }
  fail(res, '未知操作')
})

// —— 附件/图片上传（base64 JSON 方式，落盘 server/data/uploads） ——
const UPLOAD_DIR = path.resolve(__dirname, '../data/uploads')
// —— 丢单原因字典管理（设置页统一管理） ——
app.get('/api/lost-reasons', (_req, res) => ok(res, getLostReasons()))
app.post('/api/lost-reasons', (req, res) => {
  const b = (req.body ?? {}) as { action?: string; value?: string; newValue?: string }
  const list = getLostReasons()
  if (b.action === 'add' && str(b.value)) { if (!list.includes(str(b.value))) list.push(str(b.value)); saveLostReasons(list); return ok(res, list) }
  if (b.action === 'remove' && str(b.value)) { saveLostReasons(list.filter((x) => x !== str(b.value))); return ok(res, getLostReasons()) }
  if (b.action === 'rename' && str(b.value) && str(b.newValue)) { saveLostReasons(list.map((x) => (x === str(b.value) ? str(b.newValue) : x))); return ok(res, getLostReasons()) }
  fail(res, '未知操作')
})

// —— 成交原因字典管理（设置页统一管理） ——
app.get('/api/win-reasons', (_req, res) => ok(res, getWinReasons()))
app.post('/api/win-reasons', (req, res) => {
  const b = (req.body ?? {}) as { action?: string; value?: string; newValue?: string }
  const list = getWinReasons()
  if (b.action === 'add' && str(b.value)) { if (!list.includes(str(b.value))) list.push(str(b.value)); saveWinReasons(list); return ok(res, list) }
  if (b.action === 'remove' && str(b.value)) { saveWinReasons(list.filter((x) => x !== str(b.value))); return ok(res, getWinReasons()) }
  if (b.action === 'rename' && str(b.value) && str(b.newValue)) { saveWinReasons(list.map((x) => (x === str(b.value) ? str(b.newValue) : x))); return ok(res, getWinReasons()) }
  fail(res, '未知操作')
})

app.post('/api/uploads', (req, res) => {
  const name = str(req.body?.name) || 'file'
  const dataUrl = str(req.body?.dataUrl)
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return fail(res, '文件格式不正确')
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 8 * 1024 * 1024) return fail(res, '文件过大（上限 8MB）')
  mkdirSync(UPLOAD_DIR, { recursive: true })
  const safe = name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(-60)
  const file = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`
  writeFileSync(path.join(UPLOAD_DIR, file), buf)
  ok(res, { url: `/uploads/${file}`, name, size: buf.length, type: m[1] }, 201)
})

// —— 客户档案：列表（含询价联动聚合） + 详情 ——
app.get('/api/customers', (req, res) => {
  const d = getDb()
  const q = str(req.query.q)
  const salesQ = str(req.query.sales)
  const like = likeArg(q)
  const parts: string[] = []; const args: unknown[] = []
  if (q) { parts.push('(name LIKE ? ESCAPE \'!\' OR country LIKE ? ESCAPE \'!\')'); args.push(like, like) }
  if (salesQ) { parts.push('EXISTS (SELECT 1 FROM inquiries i WHERE i.customer_id = customers.id AND i.sales = ?)'); args.push(salesQ) }
  { const a = actorIn(req); if (a?.readNames) { const names = a.readNames; parts.push(`EXISTS (SELECT 1 FROM inquiries i WHERE i.customer_id = customers.id AND i.sales IN (${names.map(() => '?').join(',')}))`); args.push(...names) } }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : ''
  const rows = d.prepare(`SELECT id, name, country, use_location, source, stars, created_at, updated_at FROM customers ${where} ORDER BY updated_at DESC LIMIT 500`).all(...args) as Record<string, unknown>[]
  const out = rows.map((c) => {
    const inqs = d.prepare('SELECT i.id, i.date, i.is_key_customer, i.is_key_project, i.is_lost, (SELECT COUNT(*) FROM orders o WHERE o.inquiry_id = i.id) AS has_order, (SELECT COALESCE(SUM(amount * COALESCE(NULLIF(qty,0),1)),0) FROM inquiry_items it WHERE it.inquiry_id = i.id) AS raw FROM inquiries i WHERE i.customer_id = ? ORDER BY i.date DESC').all(c.id) as { id: string; date: string; is_key_customer: number; is_key_project: number; has_order: number; raw: number }[]
    let usd = 0
    inqs.forEach((i) => { usd += inquiryUsdTotal(d, text(i.id)) })
    const won = inqs.filter((i) => Number((i as Record<string, unknown>).has_order) > 0)
    const lost = inqs.filter((i) => Number((i as Record<string, unknown>).has_order) === 0 && Number((i as Record<string, unknown>).is_lost) === 1)
    const decided = won.length + lost.length
    return { ...c, inquiryCount: inqs.length, lastDate: inqs[0]?.date ?? null, usdTotal: Math.round(usd), wonCount: won.length, lostCount: lost.length, winRate: decided ? Math.round((won.length / decided) * 1000) / 10 : 0, keyCustomer: inqs.some((i) => Number(i.is_key_customer) === 1) ? 1 : 0, keyProjectCount: inqs.filter((i) => Number(i.is_key_project) === 1).length }
  })
  ok(res, out)
})
app.get('/api/customers/:id', (req, res) => {
  const d = getDb()
  const c = d.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!c) return fail(res, '客户不存在', 404)
  const a0 = actorIn(req)
  const scope0 = a0?.readNames ? ` AND i.sales IN (${a0.readNames.map(() => '?').join(',')})` : ''
  const inqsArgs: unknown[] = [req.params.id, ...(a0?.readNames ?? [])]
  const inqs = d.prepare(`SELECT i.*, o.order_no AS order_no, o.won_date AS order_won_date, CASE WHEN o.id IS NOT NULL THEN 1 ELSE 0 END AS won_flag,
      (SELECT COALESCE(SUM(amount * COALESCE(NULLIF(qty,0),1)),0) FROM inquiry_items it WHERE it.inquiry_id = i.id) AS raw_amount
    FROM inquiries i LEFT JOIN orders o ON o.inquiry_id = i.id WHERE i.customer_id = ?${scope0} ORDER BY i.date DESC`).all(...inqsArgs) as Record<string, unknown>[]
  const list = inqs.map((i) => {
    const items = d.prepare('SELECT currency, amount, qty FROM inquiry_items WHERE inquiry_id = ?').all(i.id) as { currency: string; amount: number; qty: number | null }[]
    const feeBuckets = feeTotalsOf(i)
    const feeTotal = feeUsdOf(i)
    const grand = grandTotals(fmtTotals(items), feeBuckets)
    const usd = usdOfTotals(grand, ratesOf(i))
    const { won_flag, order_won_date, order_no, is_won: _w, won_date: _wd, ...ibase } = i
    return { ...ibase, is_won: Number(won_flag) === 1 ? 1 : 0, status: inquiryStatus(Number(won_flag) === 1, (i as Record<string, unknown>).is_lost), won_date: str(order_won_date) || null, orderNo: str(order_no) || null, itemCount: items.length, totals: fmtTotals(items), feeTotal, grandTotals: grand, usdApprox: Math.round(usd) }
  })
  const wonList = list.filter((x) => Number((x as Record<string, unknown>).is_won) === 1)
  const lostList = list.filter((x) => (x as { status?: string }).status === 'lost')
  const decided = wonList.length + lostList.length
  const keyProjectCount = list.filter((x) => Number((x as Record<string, unknown>).is_key_project) === 1).length
  ok(res, { ...c, keyCustomer: list.some((x) => Number((x as Record<string, unknown>).is_key_customer) === 1) ? 1 : 0, keyProjectCount, inquiries: list, summary: { inquiryCount: list.length, usdTotal: Math.round(list.reduce((s, x) => s + (x.usdApprox || 0), 0)), wonCount: wonList.length, lostCount: lostList.length, winRate: decided ? Math.round((wonList.length / decided) * 1000) / 10 : 0, wonUsd: Math.round(wonList.reduce((s, x) => s + (x.usdApprox || 0), 0)), keyProjectCount: list.filter((x) => Number((x as Record<string, unknown>).is_key_project) === 1).length } })
})

// —— 询价号唯一性检查 ——
app.get('/api/inquiries/exists', (req, res) => {
  const no = str(req.query.no)
  const r = no ? getDb().prepare('SELECT 1 FROM inquiries WHERE inquiry_no = ? COLLATE NOCASE').get(no) : undefined
  ok(res, { exists: Boolean(r) })
})

// —— 统一字段/选项元数据（可配字典 + 系统固定字典） ——
app.get('/api/options', (_req, res) => {
  ok(res, {
    editable: [
      { code: 'source', name: '询价来源', values: getSources() },
      { code: 'follow_method', name: '跟进方式', values: getFollowMethods() },
      { code: 'lost_reason', name: '丢单原因（未成单原因）', values: getLostReasons() },
      { code: 'win_reason', name: '成交原因', values: getWinReasons() },
    ],
    // 币种改由设置页专门卡片维护（含折算汇率），不再以固定组下发；自定义国别组已下线（国别支持直接手输）
    fixed: [],
  })
})
// —— 询价来源字典管理（设置页/来源设置弹窗） ——
app.get('/api/sources', (_req, res) => ok(res, getSources()))
app.post('/api/sources', (req, res) => {
  const b = (req.body ?? {}) as { action?: string; value?: string; newValue?: string }
  const list = getSources()
  if (b.action === 'add' && str(b.value)) { if (!list.includes(str(b.value))) list.push(str(b.value)); saveSources(list); return ok(res, list) }
  if (b.action === 'remove' && str(b.value)) { saveSources(list.filter((x) => x !== str(b.value))); return ok(res, getSources()) }
  if (b.action === 'rename' && str(b.value) && str(b.newValue)) { saveSources(list.map((x) => (x === str(b.value) ? str(b.newValue) : x))); return ok(res, getSources()) }
  fail(res, '未知操作')
})
// —— 币种管理（可增删改 + 折算汇率；USD 为基准，rate 语义：1 USD = rate 个该币种） ——
app.get('/api/currencies', (_req, res) => ok(res, getCurrencies()))
app.post('/api/currencies', (req, res) => {
  const b = (req.body ?? {}) as { action?: string; code?: string; rate?: unknown; newCode?: string }
  const code = str(b.code).trim().toUpperCase()
  const list = getCurrencies()
  switch (str(b.action)) {
    case 'add': {
      if (!code) return fail(res, '请填写币种代码')
      if (!/^[A-Z]{2,6}$/.test(code)) return fail(res, '币种代码建议 2-6 位字母（如 USD、JPY）')
      if (list.some((x) => x.code === code)) return fail(res, `币种「${code}」已存在`, 409)
      const rate = Number(b.rate)
      if (!Number.isFinite(rate) || rate <= 0) return fail(res, '请填写大于 0 的折算汇率（1 USD = ? 该币种）')
      list.push({ code, rate }); saveCurrencies(list); return ok(res, getCurrencies())
    }
    case 'rename': {
      const next = str(b.newCode).trim().toUpperCase()
      if (!list.some((x) => x.code === code)) return fail(res, '币种不存在', 404)
      if (!next) return fail(res, '请填写新币种代码')
      if (code === 'USD' && next !== 'USD') return fail(res, 'USD 为基准币种，不能改名')
      if (next !== code && list.some((x) => x.code === next)) return fail(res, `币种「${next}」已存在`, 409)
      saveCurrencies(list.map((x) => (x.code === code ? { ...x, code: next } : x)))
      if (next !== code) renameCurrencyInData(code, next)
      return ok(res, getCurrencies())
    }
    case 'setRate': {
      if (!list.some((x) => x.code === code)) return fail(res, '币种不存在', 404)
      if (code === 'USD') return fail(res, 'USD 为基准币种，汇率固定为 1')
      const rate = Number(b.rate)
      if (!Number.isFinite(rate) || rate <= 0) return fail(res, '请填写大于 0 的折算汇率')
      saveCurrencies(list.map((x) => (x.code === code ? { ...x, rate } : x)))
      return ok(res, getCurrencies())
    }
    case 'remove': {
      if (!list.some((x) => x.code === code)) return fail(res, '币种不存在', 404)
      if (code === 'USD') return fail(res, 'USD 为基准币种，不能删除')
      saveCurrencies(list.filter((x) => x.code !== code))
      return ok(res, getCurrencies())
    }
    case 'usage': return ok(res, { code, usage: currencyUsage(code) })
    default: return fail(res, '未知操作')
  }
})
// 自定义国别补充维护（保留接口；设置页已下线该分组，国别可直接手输）
app.post('/api/countries-custom', (req, res) => {
  const b = (req.body ?? {}) as { action?: string; value?: string; newValue?: string }
  let arr: string[] = []; try { const a = JSON.parse(getSetting('countries', '')); arr = Array.isArray(a) ? a : [] } catch { arr = [] }
  if (b.action === 'add' && str(b.value)) { if (!arr.includes(str(b.value))) arr.push(str(b.value)) }
  if (b.action === 'remove' && str(b.value)) arr = arr.filter((x) => x !== str(b.value))
  if (b.action === 'rename' && str(b.value) && str(b.newValue)) arr = arr.map((x) => (x === str(b.value) ? str(b.newValue) : x))
  setSetting('countries', JSON.stringify(arr))
  ok(res, arr)
})

// —— 一次性保存整组选项（设置页「保存」按钮用） ——
app.post('/api/options/save', (req, res) => {
  const code = str(req.body?.code)
  const raw = Array.isArray(req.body?.values) ? (req.body.values as unknown[]).map((x) => str(x).trim()).filter(Boolean) : null
  if (!raw) return fail(res, '请提供选项列表')
  const values = raw.filter((v, i, a) => a.indexOf(v) === i)
  if (code === 'source') { saveSources(values); return ok(res, getSources()) }
  if (code === 'follow_method') { saveFollowMethods(values); return ok(res, getFollowMethods()) }
  if (code === 'lost_reason') { saveLostReasons(values); return ok(res, getLostReasons()) }
  if (code === 'win_reason') { saveWinReasons(values); return ok(res, getWinReasons()) }
  if (code === 'country_custom') { setSetting('countries', JSON.stringify(values)); return ok(res, values) }
  return fail(res, '未知的字段类型')
})

// —— 录入询报价（新客户名自动建档） ——
app.post('/api/inquiries', (req, res) => {
  const d = getDb()
  if (!canWrite(actorIn(req), req.body?.sales)) return fail(res, '只能录入自己名下的询价（销售需为你本人）', 403)
  const no = str(req.body?.inquiryNo)
  const date = str(req.body?.date) || todayStr()
  const country = str(req.body?.country) || null
  const useLocation = str(req.body?.useLocation) || country
  const sales = str(req.body?.sales)
  const purchaser = str(req.body?.purchaser)
  const source = str(req.body?.source)
  const handTotal = num(req.body?.totalAmount)
  // 手填总金额的金额单位（未传按 USD；手填金额为空时不落币种）
  const newHandTotalCur = str(req.body?.totalAmountCurrency) || 'USD'
  const fees = readFees(req.body as Record<string, unknown>)
  if (fees.err) return fail(res, fees.err)
  // 录入时按实际汇率计算：允许传入 {币种: 汇率} 覆盖设置里的默认汇率
  const fxOverrides = readFxOverrides(req.body?.fxRates)
  const feeCurrency = feeCurrencyOf(req.body?.feeCurrency)
  const note = text(req.body?.note) || null
  const keyCust = req.body?.isKeyCustomer ? 1 : 0
  const keyProj = req.body?.isKeyProject ? 1 : 0
  const isWon = req.body?.isWon ? 1 : 0
  const blockers = text(req.body?.blockers) || null
  const actionPlan = text(req.body?.actionPlan) || null
  const supportNeeded = text(req.body?.supportNeeded) || null
  const starsRaw = num(req.body?.customerStars)
  const customerStars = starsRaw && starsRaw >= 1 && starsRaw <= 5 ? Math.round(starsRaw) : null
  const clientIdIn = str(req.body?.clientId)
  const nc = (req.body?.newClient ?? null) as { name?: unknown; country?: unknown; useLocation?: unknown } | null
  // 兼容两种契约：newClient.name（标准）与 customerName（旧客户端直接传名称）
  const newName = str(nc?.name) || (clientIdIn ? '' : str(req.body?.customerName))
  const items = (Array.isArray(req.body?.items) ? (req.body.items as unknown[]) : []) as { productName?: unknown; qty?: unknown; amount?: unknown; currency?: unknown }[]

  if (!no) return fail(res, '询价号必填')
  if (!isDate(date)) return fail(res, '询价日期格式应为 YYYY-MM-DD（且为真实日期）')
  if (d.prepare('SELECT 1 FROM inquiries WHERE inquiry_no = ? COLLATE NOCASE').get(no)) return fail(res, `询价号 ${no} 已存在（不区分大小写）`, 409)
  if (!clientIdIn && !newName) return fail(res, '请选择客户档案中的客户，或选择“新客户”并填写名称')
  if (!sales) return fail(res, '请选择销售人员')
  if (!purchaser) return fail(res, '请选择采购人员')
  if (!source) return fail(res, '请选择询价来源')

  const cleanItems = items
    .map((it, i) => ({ productName: str(it.productName), qty: num(it.qty), amount: num(it.amount) ?? 0, currency: normCurrency(it.currency), sort: i + 1 }))
    .filter((it) => it.productName && it.amount > 0)
  if (!cleanItems.length) return fail(res, '至少一行询价明细（产品名称与金额大于 0）')
  if (cleanItems.some((it) => it.qty != null && it.qty < 0)) return fail(res, '数量不能为负数')
  if (cleanItems.some((it) => it.amount > 1e12)) return fail(res, '金额超出合理范围')
  const tooLongNew = overLimit([[no, 60, '询价号'], [newName, NAME_MAX, '客户名称'], [note, 5000, '备注'], [blockers, 3000, '卡点'], [actionPlan, 3000, '行动计划'], [supportNeeded, 3000, '需要的支持']])
  if (tooLongNew) return fail(res, tooLongNew)
  if (cleanItems.length > 50) return fail(res, '询价明细最多 50 行')
  if (cleanItems.some((it) => it.productName.length > NAME_MAX)) return fail(res, `产品名称过长（最多 ${NAME_MAX} 个字符）`)

  const t = nowIso()
  let customer = clientIdIn ? (d.prepare('SELECT * FROM customers WHERE id = ?').get(clientIdIn) as Record<string, unknown> | undefined) : undefined
  if (clientIdIn && !customer) return fail(res, '客户不存在', 404)
  let createdCustomer = false
  if (!customer) {
    // 新客户：同名复用，否则建档
    customer = d.prepare('SELECT * FROM customers WHERE name = ? COLLATE NOCASE').get(newName) as Record<string, unknown> | undefined
    if (!customer) {
      const cid = newId()
      d.prepare('INSERT INTO customers (id, name, country, use_location, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(cid, newName, str(nc?.country) || country, str(nc?.useLocation) || useLocation, source, t, t)
      customer = d.prepare('SELECT * FROM customers WHERE id = ?').get(cid) as Record<string, unknown>
      createdCustomer = true
    }
  }

  // 组别推导（销售负责人 → 组织小组）
  let teamName = str(req.body?.teamName) || text((customer as Record<string, unknown>).team_name)
  if (!teamName && sales) {
    const ppl = d.prepare('SELECT team_name FROM people WHERE name = ? OR name = ? LIMIT 1').get(sales, sales) as Record<string, unknown> | undefined
    if (ppl) teamName = text(ppl.team_name)
  }

  if (!customer) return fail(res, '客户解析失败', 500)
  const customerId = text(customer.id)
  const customerCountry = text(customer.country)
  const iid = newId()
  d.transaction(() => {
    d.prepare('UPDATE customers SET country = COALESCE(?, country), use_location = COALESCE(?, use_location), source = COALESCE(?, source), stars = COALESCE(?, stars), updated_at = ? WHERE id = ?')
      .run(country || null, useLocation || null, source || null, customerStars, t, customerId)
    d.prepare(`INSERT INTO inquiries (id, inquiry_no, date, customer_id, country, use_location, sales, purchaser, source, hand_total, hand_total_currency, note,
        is_key_customer, is_key_project, is_won, blockers, action_plan, support_needed, customer_stars, freight, tax, commission, other_fee, fee_currency,
        freight_currency, tax_currency, commission_currency, other_fee_currency, fx_overrides, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(iid, no, date, customerId, country || customerCountry || null, useLocation || country, sales, purchaser, source, handTotal, handTotal == null ? null : normCurrency(newHandTotalCur), note, keyCust, keyProj, isWon, blockers, actionPlan, supportNeeded, customerStars,
        fees.values.freight, fees.values.tax, fees.values.commission, fees.values.otherFee, feeCurrency,
        fees.currencies.freight ?? feeCurrency, fees.currencies.tax ?? feeCurrency, fees.currencies.commission ?? feeCurrency, fees.currencies.otherFee ?? feeCurrency, fxOverrides, t, t)
    const ins = d.prepare('INSERT INTO inquiry_items (id, inquiry_id, product_name, qty, amount, currency, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
    cleanItems.forEach((it) => ins.run(newId(), iid, it.productName, it.qty, it.amount, it.currency, it.sort))
    // 费用版本 V1（有费用时才记录）
    insertFeeVersion(iid, fees.values, fees.currencies, feeCurrency, '询报价录入', ratesOf({ fx_overrides: fxOverrides }))
    upsertProducts(cleanItems, date, t, { inquiryId: iid, inquiryNo: no, customerName: text(customer.name), sales, source: '询报价录入' })
  })()
  ok(res, { id: iid, inquiryNo: no, customerId: customerId, createdCustomer, team: teamName || null }, 201)
})

// —— 询报价跟进：按 销售+询价号 定位询价并建立跟进 ——
app.get('/api/inquiries/lookup', (req, res) => {
  const d = getDb()
  const no = str(req.query.no), salesQ = str(req.query.sales)
  if (!no) return fail(res, '请提供询价号')
  const parts = ['i.inquiry_no = ?']; const args: unknown[] = [no]
  if (salesQ) { parts.push('i.sales = ?'); args.push(salesQ) }
  { const sc = scopeSql(actorIn(req), 'i.sales'); if (sc.sql) { parts.push(sc.sql.replace(/^ AND /, '')); args.push(...sc.args) } }
  const r = d.prepare(`SELECT i.*, c.name AS customer_name, o.order_no AS order_no, o.won_date AS order_won_date,
      CASE WHEN o.id IS NOT NULL THEN 1 ELSE 0 END AS won_flag
    FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN orders o ON o.inquiry_id = i.id
    WHERE ${parts.join(' AND ')}`).get(...args) as Record<string, unknown> | undefined
  if (!r) return fail(res, salesQ ? '该销售名下未找到此询价号' : '未找到此询价号', 404)
  const items = d.prepare('SELECT product_name, qty, amount, currency FROM inquiry_items WHERE inquiry_id = ? ORDER BY sort').all(r.id) as { product_name: string; qty: number | null; amount: number; currency: string }[]
  const totals = fmtTotals(items.map((x) => ({ currency: x.currency, amount: x.amount, qty: x.qty })))
  const feeBuckets = feeTotalsOf(r)
  const feeTotal = feeUsdOf(r)
  const grand = grandTotals(totals, feeBuckets)
  const { won_flag, order_won_date, is_won: _w, won_date: _wd, ...base } = r
  ok(res, { ...base, is_won: Number(won_flag) === 1 ? 1 : 0, won_date: str(order_won_date) || null, orderNo: str(r.order_no) || null, items,
    totals, feeTotal, fees: feeBreakdown(r), grandTotals: grand, quoteUsdApprox: Math.round(usdOfTotals(totals)), usdApprox: Math.round(usdOfTotals(grand)), productNames: items.map((x) => x.product_name).join(' / ') })
})
app.get('/api/followups', (req, res) => {
  const d = getDb()
  const inquiryId = str(req.query.inquiryId), salesQ = str(req.query.sales), q = str(req.query.q)
  const parts: string[] = ['1=1']; const args: unknown[] = []
  { const sc = scopeSql(actorIn(req), 'i.sales'); if (sc.sql) { parts.push(sc.sql.replace(/^ AND /, '')); args.push(...sc.args) } }
  if (inquiryId) { parts.push('f.inquiry_id = ?'); args.push(inquiryId) }
  if (salesQ) { parts.push('i.sales = ?'); args.push(salesQ) }
  if (q) { parts.push('(i.inquiry_no LIKE ? ESCAPE \'!\' OR f.content LIKE ? ESCAPE \'!\' OR c.name LIKE ? ESCAPE \'!\')'); const l = likeArg(q); args.push(l, l, l) }
  // seq：按跟进日期（同日按录入先后）算出「第几次跟进」；seq_total：该项目共几次
  const rows = d.prepare(`SELECT f.*, i.inquiry_no, i.sales, i.is_key_customer, i.is_key_project, c.name AS customer_name,
      ROW_NUMBER() OVER (PARTITION BY f.inquiry_id ORDER BY f.date ASC, f.created_at ASC, f.rowid ASC) AS seq,
      COUNT(*) OVER (PARTITION BY f.inquiry_id) AS seq_total
    FROM followups f
    JOIN inquiries i ON i.id = f.inquiry_id LEFT JOIN customers c ON c.id = i.customer_id
    WHERE ${parts.join(' AND ')} ORDER BY f.date DESC, f.created_at DESC LIMIT 300`).all(...args) as Record<string, unknown>[]
  // 跟进评论（跟进指导）：一次性取出并挂到对应记录上
  const ids = rows.map((r) => text(r.id))
  const comments = new Map<string, { id: string; content: string; by_name: string | null; created_at: string }[]>()
  if (ids.length) {
    const marks = ids.map(() => '?').join(',')
    const cs = d.prepare(`SELECT id, followup_id, content, by_name, created_at FROM followup_comments WHERE followup_id IN (${marks}) ORDER BY created_at ASC`).all(...ids) as
      { id: string; followup_id: string; content: string; by_name: string | null; created_at: string }[]
    cs.forEach((c) => { const a = comments.get(c.followup_id) ?? []; a.push({ id: c.id, content: c.content, by_name: c.by_name, created_at: c.created_at }); comments.set(c.followup_id, a) })
  }
  ok(res, rows.map((r) => {
    const parse = (v: unknown) => { try { const a = JSON.parse(str(v)); return Array.isArray(a) ? a : [] } catch { return [] } }
    return { ...r, photos: parse(r.photos), attachments: parse(r.attachments), comments: comments.get(text(r.id)) ?? [] }
  }))
})

// —— 跟进评论：对某条跟进记录做指导/批注 ——
app.post('/api/followups/:id/comments', (req, res) => {
  const d = getDb()
  const fid = str(req.params.id)
  const f = d.prepare('SELECT id, inquiry_id, by_name FROM followups WHERE id = ?').get(fid) as { id: string; inquiry_id: string; by_name: string | null } | undefined
  if (!f) return fail(res, '跟进记录不存在', 404)
  const content = text(req.body?.content)
  if (!content) return fail(res, '请填写评论内容')
  const byName = str(req.body?.byName) || null
  const cid = newId(); const t = nowIso()
  d.prepare('INSERT INTO followup_comments (id, followup_id, content, by_name, created_at) VALUES (?, ?, ?, ?, ?)').run(cid, fid, content, byName, t)
  ok(res, { id: cid, followupId: fid, content, byName, createdAt: t }, 201)
})
app.post('/api/followups', (req, res) => {
  const d = getDb()
  const inquiryId = str(req.body?.inquiryId)
  const iq = d.prepare('SELECT * FROM inquiries WHERE id = ?').get(inquiryId) as Record<string, unknown> | undefined
  if (!iq) return fail(res, '询价不存在', 404)
  if (!canWrite(actorIn(req), iq.sales)) return fail(res, '只能对自己名下的询价添加跟进', 403)
  const date = str(req.body?.date) || todayStr()
  const summary = text(req.body?.summary) || null
  const detail = text(req.body?.detail) || text(req.body?.content) || null
  if (!summary && !detail) return fail(res, '请填写跟进简述或具体内容')
  const photos = Array.isArray(req.body?.photos) ? (req.body.photos as unknown[]).map((x) => str(x)).filter(Boolean).slice(0, 20) : []
  const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as { url?: unknown; name?: unknown; size?: unknown }[]).map((x) => ({ url: str(x.url), name: str(x.name), size: num(x.size) ?? null })).filter((x) => x.url).slice(0, 20) : []
  const nextAt = str(req.body?.nextFollowupAt) || null
  if (!isDate(date)) return fail(res, '跟进日期格式应为 YYYY-MM-DD（且为真实日期）')
  if (nextAt && !isDate(nextAt)) return fail(res, '下次跟进日期格式应为 YYYY-MM-DD（且为真实日期）')
  const tooLongFu = overLimit([[summary, 2000, '跟进简述'], [detail, 5000, '跟进内容'], [str(req.body?.method), 40, '跟进方式']])
  if (tooLongFu) return fail(res, tooLongFu)
  const byName = str(req.body?.byName) || text(iq.sales)
  const t = nowIso()
  const fid = newId()
  d.transaction(() => {
    d.prepare('INSERT INTO followups (id, inquiry_id, date, method, content, summary, detail, photos, attachments, next_followup_at, by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(fid, inquiryId, date, str(req.body?.method) || '电话', detail, summary, detail, JSON.stringify(photos), JSON.stringify(attachments), nextAt, byName, t)
    // 询价上的「最近跟进 / 下次跟进」按**最新一条**跟进记录重算（补录历史日期不会覆盖最新状态）
    syncInquiryFollowTimes(inquiryId, t)
  })()
  ok(res, { id: fid, inquiryId, date, nextFollowupAt: nextAt }, 201)
})
/** 按最新一条跟进重算询价上的「最近跟进 / 下次跟进」（新增、修改日期后都要调用） */
function syncInquiryFollowTimes(inquiryId: string, t: string): void {
  getDb().prepare(`UPDATE inquiries SET
      last_followup_at = (SELECT f2.date FROM followups f2 WHERE f2.inquiry_id = ? ORDER BY f2.date DESC, f2.created_at DESC, f2.rowid DESC LIMIT 1),
      next_followup_at = (SELECT f3.next_followup_at FROM followups f3 WHERE f3.inquiry_id = ? ORDER BY f3.date DESC, f3.created_at DESC, f3.rowid DESC LIMIT 1),
      updated_at = ? WHERE id = ?`).run(inquiryId, inquiryId, t, inquiryId)
}
// 修改跟进记录：只有该项目「最新一条」允许改（旧的只读，保证历史可追溯）
app.put('/api/followups/:id', (req, res) => {
  const d = getDb()
  const fid = str(req.params.id)
  const old = d.prepare('SELECT * FROM followups WHERE id = ?').get(fid) as Record<string, unknown> | undefined
  if (!old) return fail(res, '跟进记录不存在', 404)
  { const iqRow = d.prepare('SELECT sales FROM inquiries WHERE id = ?').get(text(old.inquiry_id)) as { sales: string } | undefined
    if (!canWrite(actorIn(req), iqRow?.sales)) return fail(res, '只能修改自己名下询价的跟进记录', 403) }
  const inquiryId = text(old.inquiry_id)
  const latest = d.prepare('SELECT id FROM followups WHERE inquiry_id = ? ORDER BY date DESC, created_at DESC, rowid DESC LIMIT 1').get(inquiryId) as { id: string } | undefined
  if (!latest || latest.id !== fid) return fail(res, '只能编辑该项目最新一条跟进记录；较早的记录只能查看', 409)
  const date = req.body?.date !== undefined ? str(req.body.date) : str(old.date)
  if (!isDate(date)) return fail(res, '跟进日期格式应为 YYYY-MM-DD（且为真实日期）')
  const summary = req.body?.summary !== undefined ? (text(req.body.summary) || null) : (str(old.summary) || null)
  const detail = req.body?.detail !== undefined ? (text(req.body.detail) || null) : (str(old.detail) || str(old.content) || null)
  if (!summary && !detail) return fail(res, '请填写跟进简述或具体内容')
  const method = req.body?.method !== undefined ? (str(req.body.method) || '电话') : (str(old.method) || '电话')
  const nextAt = req.body?.nextFollowupAt !== undefined ? (str(req.body.nextFollowupAt) || null) : (str(old.next_followup_at) || null)
  if (nextAt && !isDate(nextAt)) return fail(res, '下次跟进日期格式应为 YYYY-MM-DD（且为真实日期）')
  const byName = req.body?.byName !== undefined ? (str(req.body.byName) || null) : (str(old.by_name) || null)
  const tooLong = overLimit([[summary, 2000, '跟进简述'], [detail, 5000, '跟进内容'], [method, 40, '跟进方式']])
  if (tooLong) return fail(res, tooLong)
  const t = nowIso()
  d.transaction(() => {
    d.prepare('UPDATE followups SET date = ?, method = ?, content = ?, summary = ?, detail = ?, next_followup_at = ?, by_name = ? WHERE id = ?')
      .run(date, method, detail, summary, detail, nextAt, byName, fid)
    syncInquiryFollowTimes(inquiryId, t)
  })()
  ok(res, { id: fid, inquiryId, date, method, summary, detail, nextFollowupAt: nextAt, byName })
})

// —— 销售订单（成交的唯一来源；询价是否成交由是否存在订单自动判定） ——
function nextOrderNo(): string {
  const d = getDb()
  const seq = Number(getSetting('orderSeq', '0')) + 1
  setSetting('orderSeq', String(seq))
  const now = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `SO-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(seq, 3)}`
}
// 预览「下一个订单号」（只读，不占用序号）：生成销售订单时预填，便于把订单号也设为必填
app.get('/api/orders/next-no', (_req, res) => {
  const seq = Number(getSetting('orderSeq', '0')) + 1
  const now = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  ok(res, { orderNo: `SO-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(seq, 3)}` })
})
app.get('/api/orders', (req, res) => {
  const d = getDb()
  const q = str(req.query.q), salesQ = str(req.query.sales), from = str(req.query.from), to = str(req.query.to), productQ = str(req.query.product)
  const orderNoQ = str(req.query.orderNo), customerQ = str(req.query.customer), purchaserQ = str(req.query.purchaser), sourceQ = str(req.query.source)
  const parts: string[] = ['1=1']; const args: unknown[] = []
  { const sc = scopeSql(actorIn(req), 'i.sales'); if (sc.sql) { parts.push(sc.sql.replace(/^ AND /, '')); args.push(...sc.args) } }
  if (q) { parts.push('(o.order_no LIKE ? ESCAPE \'!\' OR i.inquiry_no LIKE ? ESCAPE \'!\' OR c.name LIKE ? ESCAPE \'!\')'); const l = likeArg(q); args.push(l, l, l) }
  if (orderNoQ) { parts.push('(o.order_no LIKE ? ESCAPE \'!\' OR i.inquiry_no LIKE ? ESCAPE \'!\')'); const l = likeArg(orderNoQ); args.push(l, l) }
  if (customerQ) { parts.push('c.name LIKE ? ESCAPE \'!\''); args.push(likeArg(customerQ)) }
  if (purchaserQ) { parts.push('i.purchaser = ?'); args.push(purchaserQ) }
  if (sourceQ) { parts.push('i.source = ?'); args.push(sourceQ) }
  if (salesQ) { parts.push('i.sales = ?'); args.push(salesQ) }
  if (from) { parts.push('o.won_date >= ?'); args.push(from) }
  if (to) { parts.push('o.won_date <= ?'); args.push(to) }
  if (productQ) { parts.push('EXISTS (SELECT 1 FROM inquiry_items it WHERE it.inquiry_id = i.id AND it.product_name LIKE ? ESCAPE \'!\')'); args.push(likeArg(productQ)) }
  const rows = d.prepare(`SELECT o.id AS order_id, o.order_no, o.won_date, o.amount AS order_amount, o.currency AS order_currency, o.note AS order_note, o.win_reason AS win_reason,
      o.created_at AS order_created_at, o.updated_at AS order_updated_at,
      i.id AS inquiry_id, i.inquiry_no, i.date, i.sales, i.purchaser, i.source, i.country, i.use_location, i.hand_total, i.hand_total_currency, i.is_key_customer, i.is_key_project,
      i.customer_stars, i.note, i.blockers, i.action_plan, i.support_needed, i.is_lost, i.lost_reason, i.lost_date, i.last_followup_at, i.next_followup_at,
      i.freight, i.tax, i.commission, i.other_fee, i.fee_currency, i.freight_currency, i.tax_currency, i.commission_currency, i.other_fee_currency, i.fx_overrides,
      c.name AS customer_name, c.country AS customer_country
    FROM orders o JOIN inquiries i ON i.id = o.inquiry_id LEFT JOIN customers c ON c.id = i.customer_id
    WHERE ${parts.join(' AND ')} ORDER BY o.won_date DESC, o.created_at DESC LIMIT 1000`).all(...args) as Record<string, unknown>[]
  const list = rows.map((r) => {
    const items = d.prepare('SELECT product_name, qty, amount, currency FROM inquiry_items WHERE inquiry_id = ? ORDER BY sort').all(r.inquiry_id) as { product_name: string; qty: number | null; amount: number; currency: string }[]
    const totals = fmtTotals(items)
    const feeBuckets = feeTotalsOf(r)
    const rates = ratesOf(r)
    const feeTotal = Math.round(feeBuckets.reduce((a, b) => a + b.total / rateIn(rates, b.currency), 0))
    const grand = grandTotals(totals, feeBuckets)
    const cycle = (r.won_date && r.date) ? Math.round((Date.parse(String(r.won_date)) - Date.parse(String(r.date))) / 86400000) : null
    // 订单金额（手填）为真实成交金额：分析与统计一律以它为准；未填时才回退到询价报价合计
    const quoteUsd = Math.round(usdOfTotals(grand, rates))
    const usdApprox = num(r.order_amount) != null ? Math.round(Number(num(r.order_amount)) / rateIn(rates, str(r.order_currency) || 'USD')) : quoteUsd
    return { ...r, items, itemCount: items.length, totals, feeTotal, feeBuckets, fees: feeBreakdown(r), fxUsed: rates, grandTotals: grand,
      usdApprox, quoteUsd, quoteUsdApprox: Math.round(usdOfTotals(totals, rates)), cycleDays: cycle, productNames: items.map((x) => x.product_name).join(' / ') }
  })
  const cycles = list.map((x) => x.cycleDays).filter((x): x is number => typeof x === 'number' && x >= 0).sort((a, b) => a - b)
  const sum = cycles.reduce((a, b) => a + b, 0)
  const byProductMap = new Map<string, number[]>()
  list.forEach((x) => { if (typeof x.cycleDays === 'number') x.items.forEach((it) => { const a = byProductMap.get(it.product_name) ?? []; a.push(x.cycleDays as number); byProductMap.set(it.product_name, a) }) })
  const byProduct = Array.from(byProductMap.entries()).map(([name, arr]) => ({ name, count: arr.length, avgCycle: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) })).sort((a, b) => b.count - a.count || a.avgCycle - b.avgCycle).slice(0, 20)
  const bySalesMap = new Map<string, number[]>()
  list.forEach((x) => { if (typeof x.cycleDays === 'number') { const key = String((x as Record<string, unknown>).sales ?? ''); const a = bySalesMap.get(key) ?? []; a.push(x.cycleDays as number); bySalesMap.set(key, a) } })
  const bySales = Array.from(bySalesMap.entries()).map(([name, arr]) => ({ name, count: arr.length, avgCycle: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) })).sort((a, b) => b.count - a.count)
  ok(res, { rows: list, stats: { contractCount: list.length, cycleCount: cycles.length, avgCycle: cycles.length ? Math.round(sum / cycles.length) : null, medianCycle: cycles.length ? cycles[Math.floor((cycles.length - 1) / 2)] : null, minCycle: cycles.length ? cycles[0] : null, maxCycle: cycles.length ? cycles[cycles.length - 1] : null, usdTotal: Math.round(list.reduce((s2, x) => s2 + x.usdApprox, 0)), byProduct, bySales } })
})
app.post('/api/orders', (req, res) => {
  const d = getDb()
  const inquiryId = str(req.body?.inquiryId)
  const inq = d.prepare('SELECT * FROM inquiries WHERE id = ?').get(inquiryId) as Record<string, unknown> | undefined
  if (!inq) return fail(res, '询价不存在', 404)
  if (!canWrite(actorIn(req), inq.sales)) return fail(res, '只能对自己名下的询价生成销售订单', 403)
  if (d.prepare('SELECT id FROM orders WHERE inquiry_id = ?').get(inquiryId)) return fail(res, '该询价已生成销售订单', 409)
  if (Number(inq.is_lost) === 1) return fail(res, '该询价已标记「未成单」，请先撤销未成单后再生成销售订单', 409)
  const wonDate = str(req.body?.wonDate) || todayStr()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wonDate)) return fail(res, '成单日期格式应为 YYYY-MM-DD')
  if (wonDate < str(inq.date)) return fail(res, '成单日期不能早于询价日期')
  const orderNo = str(req.body?.orderNo) || nextOrderNo()
  if (d.prepare('SELECT id FROM orders WHERE order_no = ?').get(orderNo)) return fail(res, `订单号 ${orderNo} 已存在`, 409)
  const cur = normCurrency(req.body?.currency)
  const amount = num(req.body?.amount)
  if (amount != null && (amount < 0 || amount > 1e12)) return fail(res, '订单金额需为 0 ~ 1e12 之间的数值')
  // 生成销售订单：所有选项必填（成单日期 / 订单金额 / 币种 / 成交原因 / 订单备注）
  if (amount == null) return fail(res, '请填写订单金额（生成销售订单为必填）')
  if (!str(req.body?.currency)) return fail(res, '请选择币种（生成销售订单为必填）')
  if (!text(req.body?.winReason)) return fail(res, '请选择或填写成交原因（生成销售订单为必填）')
  if (!text(req.body?.note)) return fail(res, '请填写订单备注（生成销售订单为必填）')
  const t = nowIso()
  const oid = newId()
  const winReason = text(req.body?.winReason) || null
  const tooLongOrd = overLimit([[orderNo, 60, '订单号'], [winReason, 2000, '成单原因'], [text(req.body?.note), 5000, '订单备注']])
  if (tooLongOrd) return fail(res, tooLongOrd)
  d.prepare('INSERT INTO orders (id, order_no, inquiry_id, customer_id, won_date, amount, currency, note, win_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(oid, orderNo, inquiryId, text(inq.customer_id) || null, wonDate, amount, cur, text(req.body?.note) || null, winReason, t, t)
  syncWonFlags()
  ok(res, { id: oid, orderNo, wonDate }, 201)
})
app.put('/api/orders/:id', (req, res) => {
  const d = getDb()
  const o = d.prepare('SELECT o.*, i.date, i.sales FROM orders o JOIN inquiries i ON i.id = o.inquiry_id WHERE o.id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!o) return fail(res, '订单不存在', 404)
  if (!canWrite(actorIn(req), o.sales)) return fail(res, '只能修改自己名下询价的订单', 403)
  const wonDate = req.body?.wonDate !== undefined ? str(req.body.wonDate) : str(o.won_date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wonDate)) return fail(res, '成单日期格式应为 YYYY-MM-DD')
  if (wonDate < str(o.date)) return fail(res, '成单日期不能早于询价日期')
  const orderNo = req.body?.orderNo !== undefined ? (str(req.body.orderNo) || str(o.order_no)) : str(o.order_no)
  const dup = d.prepare('SELECT id FROM orders WHERE order_no = ? AND id <> ?').get(orderNo, req.params.id)
  if (dup) return fail(res, `订单号 ${orderNo} 已存在`, 409)
  const amount = req.body?.amount !== undefined ? num(req.body.amount) : num(o.amount)
  if (amount != null && (amount < 0 || amount > 1e12)) return fail(res, '订单金额需为 0 ~ 1e12 之间的数值')
  const cur = req.body?.currency !== undefined && isCurrency(req.body.currency) ? str(req.body.currency).trim().toUpperCase() : str(o.currency)
  const note = req.body?.note !== undefined ? (text(req.body.note) || null) : str(o.note) || null
  const winReason = req.body?.winReason !== undefined ? (text(req.body.winReason) || null) : (str(o.win_reason) || null)
  const tooLongOrd2 = overLimit([[orderNo, 60, '订单号'], [winReason, 2000, '成单原因'], [note, 5000, '订单备注']])
  if (tooLongOrd2) return fail(res, tooLongOrd2)
  d.prepare('UPDATE orders SET order_no = ?, won_date = ?, amount = ?, currency = ?, note = ?, win_reason = ?, updated_at = ? WHERE id = ?').run(orderNo, wonDate, amount, cur, note, winReason, nowIso(), req.params.id)
  syncWonFlags()
  ok(res, { id: req.params.id })
})
app.delete('/api/orders/:id', (req, res) => {
  const r = getDb().prepare('DELETE FROM orders WHERE id = ?').run(req.params.id)
  if (!r.changes) return fail(res, '订单不存在', 404)
  syncWonFlags()
  ok(res, { deleted: 1 })
})

// —— 仪表盘：本月数据 + 跟进提醒 ——
app.get('/api/dashboard', (req2, res) => {
  const d = getDb()
  const month = todayStr().slice(0, 7)
  const today = todayStr()
  const monthFrom = `${month}-01`
  const monthTo = `${month}-31`
  const usdOf = (inquiryId: string) => inquiryUsdTotal(d, inquiryId)
  const rowsOf = (sql: string, ...args: unknown[]) => d.prepare(sql).all(...args) as Record<string, unknown>[]

  // 本月询价（按询价日期）；按登录人的数据范围过滤
  const dsc = scopeSql(actorIn(req2), 'i.sales')
  const inqs = rowsOf(`SELECT i.*, c.name AS customer_name FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.date >= ? AND i.date <= ?${dsc.sql} ORDER BY i.date DESC`, monthFrom, monthTo, ...dsc.args)
  const inqUsd = inqs.reduce((s2, r) => s2 + usdOf(text(r.id)), 0)
  const wonMonth = rowsOf(`SELECT o.id, o.won_date, o.amount, o.currency, o.inquiry_id FROM orders o JOIN inquiries i2 ON i2.id = o.inquiry_id
    WHERE o.won_date >= ? AND o.won_date <= ?${dsc.sql.replace(/\bi\.sales\b/g, 'i2.sales')}`, monthFrom, monthTo, ...dsc.args)
  // 本月成单金额：订单上填写的金额为准（未填则回退到询价报价合计）
  const wonUsd = wonMonth.reduce((s2, o) => s2 + orderUsdOf(d, o), 0)
  const lostMonth = inqs.filter((r) => Number(r.is_lost) === 1)
  const lostUsd = lostMonth.reduce((s2, r) => s2 + usdOf(text(r.id)), 0)
  const decided = wonMonth.length + lostMonth.length
  const newCustomers = (d.prepare('SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? AND created_at <= ?').get(`${monthFrom}T00:00:00`, `${monthTo}T23:59:59`) as { n: number }).n
  const fsc = scopeSql(actorIn(req2), 'i.sales')
  const followMonth = (d.prepare(`SELECT COUNT(*) AS n FROM followups f JOIN inquiries i ON i.id = f.inquiry_id WHERE f.date >= ? AND f.date <= ?${fsc.sql}`).get(monthFrom, monthTo, ...fsc.args) as { n: number }).n

  // 本月排行
  const bySales = new Map<string, { n: number; usd: number }>()
  wonMonth.forEach((o) => {
    const inq = d.prepare('SELECT sales FROM inquiries WHERE id = ?').get(text(o.inquiry_id)) as { sales: string } | undefined
    const k = inq?.sales || '未指定'
    const a = bySales.get(k) ?? { n: 0, usd: 0 }
    a.n += 1; a.usd += usdOf(text(o.inquiry_id))
    bySales.set(k, a)
  })
  const monthBySales = Array.from(bySales.entries()).map(([name, v]) => ({ name, n: v.n, usd: Math.round(v.usd) })).sort((a, b) => b.usd - a.usd)
  const byProduct = new Map<string, { n: number; usd: number }>()
  wonMonth.forEach((o) => {
    const items = d.prepare('SELECT product_name, amount, qty, currency FROM inquiry_items WHERE inquiry_id = ?').all(text(o.inquiry_id)) as { product_name: string; amount: number; qty: number | null; currency: string }[]
    const rowRates = ratesOf(d.prepare('SELECT * FROM inquiries WHERE id = ?').get(text(o.inquiry_id)) as Record<string, unknown> | undefined)
    items.forEach((it) => {
      const a = byProduct.get(it.product_name) ?? { n: 0, usd: 0 }
      a.n += 1; a.usd += lineAmount(it) / rateIn(rowRates, it.currency)
      byProduct.set(it.product_name, a)
    })
  })
  const monthByProduct = Array.from(byProduct.entries()).map(([name, v]) => ({ name, n: v.n, usd: Math.round(v.usd) })).sort((a, b) => b.usd - a.usd)

  // 跟进提醒：仅针对「跟进中」的询价
  const openRows = rowsOf(`SELECT i.id, i.inquiry_no, i.date, i.sales, i.purchaser, i.last_followup_at, i.next_followup_at, i.customer_stars,
      (SELECT COUNT(*) FROM orders o WHERE o.inquiry_id = i.id) AS has_order, c.name AS customer_name
    FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id
    WHERE COALESCE(i.is_lost, 0) = 0 ORDER BY i.date DESC`)
  const staleDays = 7
  const staleBefore = (() => { const dd = new Date(); dd.setDate(dd.getDate() - staleDays); return `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}` })()
  const weekEnd = (() => { const now = new Date(); const dow = (now.getDay() + 6) % 7; const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + 6); return `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')}` })()
  // 跟进指导（评论）：按询价汇总，用于提醒行与「最新指导」板块
  const commentRows = rowsOf(`SELECT fc.id, fc.content, fc.by_name, fc.created_at, f.inquiry_id,
      i.inquiry_no, i.sales, c.name AS customer_name
    FROM followup_comments fc JOIN followups f ON f.id = fc.followup_id
    LEFT JOIN inquiries i ON i.id = f.inquiry_id LEFT JOIN customers c ON c.id = i.customer_id
    ORDER BY fc.created_at DESC`)
  const guidanceByInquiry = new Map<string, { count: number; list: { id: string; content: string; by_name: string | null; created_at: string }[] }>()
  // commentRows 已按时间倒序，这里按时间正序累积，便于前端从上到下阅读
  ;[...commentRows].reverse().forEach((c) => {
    const k = text(c.inquiry_id)
    const cur = guidanceByInquiry.get(k) ?? { count: 0, list: [] }
    cur.count += 1
    cur.list.push({ id: text(c.id), content: text(c.content), by_name: str(c.by_name) || null, created_at: text(c.created_at) })
    guidanceByInquiry.set(k, cur)
  })
  const guidance = commentRows.slice(0, 12).map((c) => ({
    id: text(c.id), inquiry_no: text(c.inquiry_no), customer_name: text(c.customer_name), sales: text(c.sales),
    content: text(c.content), by_name: str(c.by_name) || null, created_at: text(c.created_at),
  }))

  // 每条询价最近一条跟进记录 id（指导评论挂在该记录上）
  const lastFollowupOf = new Map<string, string>()
  // 同时带出该条跟进的日期/方式/简述/详情/跟进人，供仪表盘「查看指导」弹窗查看跟进详情
  const lastFuInfo = new Map<string, { date: string; method: string | null; summary: string | null; detail: string | null; by_name: string | null }>()
  rowsOf('SELECT id, inquiry_id, date, method, summary, detail, by_name FROM followups ORDER BY date DESC, created_at DESC').forEach((f) => {
    const k = text(f.inquiry_id)
    if (!lastFollowupOf.has(k)) {
      lastFollowupOf.set(k, text(f.id))
      lastFuInfo.set(k, {
        date: text(f.date), method: str(f.method) || null, summary: str(f.summary) || null,
        detail: str(f.detail) || null, by_name: str(f.by_name) || null,
      })
    }
  })

  const brief = (r: Record<string, unknown>) => ({
    id: text(r.id), inquiry_no: text(r.inquiry_no), date: text(r.date), sales: text(r.sales), purchaser: text(r.purchaser),
    customer_name: text(r.customer_name), customer_stars: num(r.customer_stars), last_followup_at: str(r.last_followup_at) || null,
    next_followup_at: str(r.next_followup_at) || null, usd: Math.round(usdOf(text(r.id))),
    lastFollowupId: lastFollowupOf.get(text(r.id)) ?? null,
    commentCount: guidanceByInquiry.get(text(r.id))?.count ?? 0,
    comments: guidanceByInquiry.get(text(r.id))?.list ?? [],
    last_followup_date: lastFuInfo.get(text(r.id))?.date ?? null,
    last_followup_method: lastFuInfo.get(text(r.id))?.method ?? null,
    last_followup_summary: lastFuInfo.get(text(r.id))?.summary ?? null,
    last_followup_detail: lastFuInfo.get(text(r.id))?.detail ?? null,
    last_followup_by: lastFuInfo.get(text(r.id))?.by_name ?? null,
  })
  const open = openRows.filter((r) => Number(r.has_order) === 0)
  const dateOf = (v: unknown) => String(str(v) || '').slice(0, 10)
  // 已经跟进过（最近跟进 >= 计划跟进日期）就不再提醒
  const doneAfterPlan = (r: Record<string, unknown>) => {
    const nx = dateOf(r.next_followup_at); const last = dateOf(r.last_followup_at)
    return Boolean(nx && last && last >= nx)
  }
  const overdue = open
    .filter((r) => { const nx = dateOf(r.next_followup_at); return nx && nx < today && !doneAfterPlan(r) })
    .map((r) => ({ ...brief(r), kind: 'overdue' as const, kindLabel: '逾期未跟进' }))
  const dueSoon = open
    .filter((r) => { const nx = dateOf(r.next_followup_at); return nx && nx >= today && nx <= weekEnd && !doneAfterPlan(r) })
    .map((r) => ({ ...brief(r), kind: 'dueSoon' as const, kindLabel: '本周待跟进' }))
  const stale = open
    .filter((r) => {
      if (dateOf(r.next_followup_at)) return false
      const last = dateOf(r.last_followup_at)
      return !last || last < staleBefore
    })
    .map((r) => ({ ...brief(r), kind: 'stale' as const, kindLabel: '超期未跟进' }))

  ok(res, {
    month, today, weekEnd,
    kpi: {
      inqCount: inqs.length, inqUsd: Math.round(inqUsd),
      wonCount: wonMonth.length, wonUsd: Math.round(wonUsd),
      lostCount: lostMonth.length, lostUsd: Math.round(lostUsd),
      winRate: decided ? Math.round((wonMonth.length / decided) * 1000) / 10 : 0,
      followCount: followMonth, newCustomers,
      openCount: open.length,
    },
    reminders: { overdue, dueSoon, stale, staleDays, counts: { overdue: overdue.length, dueSoon: dueSoon.length, stale: stale.length } },
    guidance,
    monthBySales, monthByProduct,
  })
})

// —— 原因分析：成交原因（来源销售订单）与丢单原因（来源标记未成单的询价） ——
app.get('/api/analysis/reasons', (req, res) => {
  const d = getDb()
  const salesQ = str(req.query.sales), from = str(req.query.from), to = str(req.query.to), productQ = str(req.query.product)
  const usdOf = (inquiryId: string) => inquiryUsdTotal(d, inquiryId)
  const blank = (v: unknown) => text(v) || '未填写'

  const wParts: string[] = ['1=1']; const wArgs: unknown[] = []
  { const sc = scopeSql(actorIn(req), 'i.sales'); if (sc.sql) { wParts.push(sc.sql.replace(/^ AND /, '')); wArgs.push(...sc.args) } }
  if (salesQ) { wParts.push('i.sales = ?'); wArgs.push(salesQ) }
  if (from) { wParts.push('o.won_date >= ?'); wArgs.push(from) }
  if (to) { wParts.push('o.won_date <= ?'); wArgs.push(to) }
  if (productQ) { wParts.push('EXISTS (SELECT 1 FROM inquiry_items it WHERE it.inquiry_id = i.id AND it.product_name LIKE ? ESCAPE \'!\')'); wArgs.push(likeArg(productQ)) }
  const wins = d.prepare(`SELECT i.id AS inquiry_id, i.date AS inq_date, o.won_date, o.win_reason, o.amount, o.currency FROM orders o JOIN inquiries i ON i.id = o.inquiry_id WHERE ${wParts.join(' AND ')}`)
    .all(...wArgs) as { inquiry_id: string; inq_date: string; won_date: string; win_reason: string | null; amount: number | null; currency: string | null }[]

  const lParts: string[] = ['o.id IS NULL', 'COALESCE(i.is_lost, 0) = 1']; const lArgs: unknown[] = []
  { const sc = scopeSql(actorIn(req), 'i.sales'); if (sc.sql) { lParts.push(sc.sql.replace(/^ AND /, '')); lArgs.push(...sc.args) } }
  if (salesQ) { lParts.push('i.sales = ?'); lArgs.push(salesQ) }
  if (from) { lParts.push('COALESCE(i.lost_date, i.date) >= ?'); lArgs.push(from) }
  if (to) { lParts.push('COALESCE(i.lost_date, i.date) <= ?'); lArgs.push(to) }
  if (productQ) { lParts.push('EXISTS (SELECT 1 FROM inquiry_items it WHERE it.inquiry_id = i.id AND it.product_name LIKE ? ESCAPE \'!\')'); lArgs.push(likeArg(productQ)) }
  const losts = d.prepare(`SELECT i.id, i.lost_reason, i.date AS inq_date, COALESCE(i.lost_date, i.date) AS lost_at FROM inquiries i LEFT JOIN orders o ON o.inquiry_id = i.id WHERE ${lParts.join(' AND ')}`)
    .all(...lArgs) as { id: string; lost_reason: string | null; inq_date: string; lost_at: string }[]

  const agg = (rows: { reason: string; usd: number; cycle: number | null }[]) => {
    const m = new Map<string, { reason: string; count: number; usd: number; cycles: number[] }>()
    rows.forEach((r) => {
      const a = m.get(r.reason) ?? { reason: r.reason, count: 0, usd: 0, cycles: [] }
      a.count += 1; a.usd += r.usd
      if (typeof r.cycle === 'number' && r.cycle >= 0) a.cycles.push(r.cycle)
      m.set(r.reason, a)
    })
    const totalN = rows.length
    const totalUsd = rows.reduce((s2, r) => s2 + r.usd, 0)
    const items = Array.from(m.values())
      .map((a) => ({
        reason: a.reason, count: a.count, usd: Math.round(a.usd),
        share: totalN ? Math.round((a.count / totalN) * 1000) / 10 : 0,
        usdShare: totalUsd ? Math.round((a.usd / totalUsd) * 1000) / 10 : 0,
        avgCycle: a.cycles.length ? Math.round(a.cycles.reduce((x, y) => x + y, 0) / a.cycles.length) : null,
      }))
      .sort((a, b) => b.count - a.count || b.usd - a.usd)
    return { total: totalN, usdTotal: Math.round(totalUsd), items, missing: items.find((x) => x.reason === '未填写')?.count ?? 0 }
  }

  const winRows = wins.map((w) => ({
    reason: blank(w.win_reason),
    usd: orderUsdOf(d, { inquiry_id: w.inquiry_id, amount: w.amount, currency: w.currency }),
    cycle: (w.won_date && w.inq_date) ? Math.round((Date.parse(String(w.won_date)) - Date.parse(String(w.inq_date))) / 86400000) : null,
  }))
  // 丢单周期：询价日期 → 丢单日期（同成交的转化周期口径）
  const lostRows = losts.map((l) => ({
    reason: blank(l.lost_reason),
    usd: usdOf(l.id),
    cycle: (l.lost_at && l.inq_date) ? Math.round((Date.parse(String(l.lost_at)) - Date.parse(String(l.inq_date))) / 86400000) : null,
  }))

  ok(res, { win: agg(winRows), lost: agg(lostRows), reasons: { win: getWinReasons(), lost: getLostReasons() } })
})

// 历史遗留接口：与 /api/orders 同口径（按订单表统计），避免出现两套成交口径
app.get('/api/contracts', (req, res) => {
  const p2 = new URLSearchParams(req.query as Record<string, string>).toString()
  return res.redirect(307, `/api/orders${p2 ? `?${p2}` : ''}`)
})
app.get('/api/contracts-legacy', (req, res) => {
  const d = getDb()
  const q = str(req.query.q), salesQ = str(req.query.sales), from = str(req.query.from), to = str(req.query.to), productQ = str(req.query.product)
  const parts: string[] = ['i.is_won = 1']; const args: unknown[] = []
  if (q) { parts.push('(i.inquiry_no LIKE ? ESCAPE \'!\' OR c.name LIKE ? ESCAPE \'!\')'); const l = likeArg(q); args.push(l, l) }
  if (salesQ) { parts.push('i.sales = ?'); args.push(salesQ) }
  if (from) { parts.push('i.won_date >= ?'); args.push(from) }
  if (to) { parts.push('i.won_date <= ?'); args.push(to) }
  if (productQ) { parts.push('EXISTS (SELECT 1 FROM inquiry_items it WHERE it.inquiry_id = i.id AND it.product_name LIKE ? ESCAPE \'!\')'); args.push(likeArg(productQ)) }
  const rows = d.prepare(`SELECT i.*, c.name AS customer_name FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id WHERE ${parts.join(' AND ')} ORDER BY i.won_date DESC, i.updated_at DESC LIMIT 1000`).all(...args) as Record<string, unknown>[]
  const list = rows.map((i) => {
    const items = d.prepare('SELECT product_name, qty, amount, currency FROM inquiry_items WHERE inquiry_id = ? ORDER BY sort').all(i.id) as { product_name: string; qty: number | null; amount: number; currency: string }[]
    const totals = fmtTotals(items)
    const usd = totals.reduce((s, x) => s + x.total / rateIn(ratesOf(i), x.currency), 0)
    const cycle = (i.won_date && i.date) ? Math.round((Date.parse(String(i.won_date)) - Date.parse(String(i.date))) / 86400000) : null
    return { ...i, items, itemCount: items.length, totals, usdApprox: Math.round(usd), cycleDays: cycle, productNames: items.map((x) => x.product_name).join(' / ') }
  })
  const cycles = list.map((x) => x.cycleDays).filter((x): x is number => typeof x === 'number' && x >= 0).sort((a, b) => a - b)
  const sum = cycles.reduce((a, b) => a + b, 0)
  const median = cycles.length ? cycles[Math.floor((cycles.length - 1) / 2)] : null
  const byProductMap = new Map<string, number[]>()
  list.forEach((x) => { if (typeof x.cycleDays === 'number') x.items.forEach((it) => { const a = byProductMap.get(it.product_name) ?? []; a.push(x.cycleDays as number); byProductMap.set(it.product_name, a) }) })
  const byProduct = Array.from(byProductMap.entries()).map(([name, arr]) => ({ name, count: arr.length, avgCycle: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) })).sort((a, b) => b.count - a.count || a.avgCycle - b.avgCycle).slice(0, 20)
  const bySalesMap = new Map<string, number[]>()
  list.forEach((x) => { if (typeof x.cycleDays === 'number') { const key = String((x as Record<string, unknown>).sales ?? ''); const a = bySalesMap.get(key) ?? []; a.push(x.cycleDays as number); bySalesMap.set(key, a) } })
  const bySales = Array.from(bySalesMap.entries()).map(([name, arr]) => ({ name, count: arr.length, avgCycle: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) })).sort((a, b) => b.count - a.count)
  ok(res, {
    rows: list,
    stats: {
      contractCount: list.length,
      cycleCount: cycles.length,
      avgCycle: cycles.length ? Math.round(sum / cycles.length) : null,
      medianCycle: median,
      minCycle: cycles.length ? cycles[0] : null,
      maxCycle: cycles.length ? cycles[cycles.length - 1] : null,
      usdTotal: Math.round(list.reduce((s2, x) => s2 + x.usdApprox, 0)),
      byProduct, bySales,
    },
  })
})

// —— 询报价管理：列表（筛选/统计/详情/编辑/删除） ——
/** 币种是否合法（以设置里维护的币种清单为准） */
const isCurrency = (v: unknown) => currencyCodes().includes(str(v).trim().toUpperCase())
const normCurrency = (v: unknown, dft = 'USD') => (isCurrency(v) ? str(v).trim().toUpperCase() : dft)

/** 询价状态自动判定：有销售订单 → 已成单；标记未成单 → 未成单（必填原因）；其余 → 跟进中 */
export type InquiryStatus = 'won' | 'lost' | 'following'
const inquiryStatus = (hasOrder: boolean, isLost: unknown): InquiryStatus => (hasOrder ? 'won' : Number(isLost) === 1 ? 'lost' : 'following')
/** 明细行小计 = 金额（单价）× 数量；数量未填/为 0 时按 1 计 */
function lineAmount(it: { amount: number | null | undefined; qty?: number | null }): number {
  const a = num(it.amount) ?? 0
  const q = num(it.qty)
  return a * (q != null && q > 0 ? q : 1)
}
function fmtTotals(items: { currency: string; amount: number; qty?: number | null }[]): { currency: string; total: number }[] {
  const m = new Map<string, number>()
  items.forEach((it) => m.set(it.currency, (m.get(it.currency) ?? 0) + lineAmount(it)))
  return Array.from(m.entries()).map(([currency, total]) => ({ currency, total })).sort((a, b) => currencyCodes().indexOf(a.currency) - currencyCodes().indexOf(b.currency))
}
app.get('/api/inquiries', (req, res) => {
  const d = getDb()
  const parts: string[] = []; const args: unknown[] = []
  { const sc = scopeSql(actorIn(req), 'i.sales'); if (sc.sql) { parts.push(sc.sql.replace(/^ AND /, '')); args.push(...sc.args) } }
  const q = str(req.query.q), from = str(req.query.from), to = str(req.query.to)
  const sales = str(req.query.sales), purchaser = str(req.query.purchaser), source = str(req.query.source), country = str(req.query.country)
  const statusQ = str(req.query.status)
  if (q) { parts.push('(i.inquiry_no LIKE ? ESCAPE \'!\' OR c.name LIKE ? ESCAPE \'!\' OR i.note LIKE ? ESCAPE \'!\')'); const l = likeArg(q); args.push(l, l, l) }
  if (from) { parts.push('i.date >= ?'); args.push(from) }
  if (to) { parts.push('i.date <= ?'); args.push(to) }
  if (sales) { parts.push('i.sales = ?'); args.push(sales) }
  if (purchaser) { parts.push('i.purchaser = ?'); args.push(purchaser) }
  if (source) { parts.push('i.source = ?'); args.push(source) }
  if (country) { parts.push('(i.country = ? OR i.use_location = ?)'); args.push(country, country) }
  if (statusQ === 'won') parts.push('o.id IS NOT NULL')
  if (statusQ === 'lost') parts.push('o.id IS NULL AND COALESCE(i.is_lost, 0) = 1')
  if (statusQ === 'following') parts.push('o.id IS NULL AND COALESCE(i.is_lost, 0) = 0')
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : ''
  const join = 'FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id'
  const rows = d.prepare(`SELECT i.id, i.inquiry_no, i.date, i.country, i.use_location, i.sales, i.purchaser, i.source, i.hand_total, i.hand_total_currency, i.note, i.blockers, i.action_plan, i.support_needed, i.customer_stars, i.is_key_customer, i.is_key_project, i.is_lost, i.lost_reason, i.lost_date, i.last_followup_at, i.next_followup_at, i.created_at,
      i.freight, i.tax, i.commission, i.other_fee, i.fee_currency, i.freight_currency, i.tax_currency, i.commission_currency, i.other_fee_currency, i.fx_overrides, c.name AS customer_name,
      (SELECT f.summary FROM followups f WHERE f.inquiry_id = i.id ORDER BY f.date DESC, f.created_at DESC, f.rowid DESC LIMIT 1) AS last_followup_summary,
      (SELECT f.detail FROM followups f WHERE f.inquiry_id = i.id ORDER BY f.date DESC, f.created_at DESC, f.rowid DESC LIMIT 1) AS last_followup_detail,
      (SELECT COALESCE(f.by_name, '') FROM followups f WHERE f.inquiry_id = i.id ORDER BY f.date DESC, f.created_at DESC, f.rowid DESC LIMIT 1) AS last_followup_by,
      (SELECT COUNT(*) FROM followups f WHERE f.inquiry_id = i.id) AS followup_count,
      (SELECT json_array_length(COALESCE(NULLIF(f.photos, ''), '[]')) FROM followups f WHERE f.inquiry_id = i.id ORDER BY f.date DESC, f.created_at DESC, f.rowid DESC LIMIT 1) AS last_followup_photos,
      (SELECT json_array_length(COALESCE(NULLIF(f.attachments, ''), '[]')) FROM followups f WHERE f.inquiry_id = i.id ORDER BY f.date DESC, f.created_at DESC, f.rowid DESC LIMIT 1) AS last_followup_files,
      CASE WHEN o.id IS NOT NULL THEN 1 ELSE 0 END AS _won, o.won_date AS _won_date, o.order_no AS _order_no, o.id AS _order_id
    ${join} LEFT JOIN orders o ON o.inquiry_id = i.id ${where} ORDER BY i.date DESC, i.created_at DESC LIMIT 500`).all(...args) as Record<string, unknown>[]
  const ids = rows.map((r) => str(r.id))
  const totalsOf = new Map<string, { currency: string; amount: number; qty: number | null }[]>()
  if (ids.length) {
    const marks = ids.map(() => '?').join(',')
    const items = d.prepare(`SELECT inquiry_id, currency, amount, qty FROM inquiry_items WHERE inquiry_id IN (${marks})`).all(...ids) as { inquiry_id: string; currency: string; amount: number; qty: number | null }[]
    items.forEach((it) => { const a = totalsOf.get(it.inquiry_id) ?? []; a.push(it); totalsOf.set(it.inquiry_id, a) })
  }
  const out = rows.map((r) => {
    const t = fmtTotals(totalsOf.get(str(r.id)) ?? [])
    const feeBuckets = feeTotalsOf(r)
    const rates = ratesOf(r)
    const feeTotal = Math.round(feeBuckets.reduce((a, b) => a + b.total / rateIn(rates, b.currency), 0))
    const grand = grandTotals(t, feeBuckets)
    const { _won, _won_date, _order_no, _order_id, ...rest } = r
    return { ...rest, is_won: Number(_won) === 1 ? 1 : 0, status: inquiryStatus(Number(_won) === 1, r.is_lost), won_date: (str(_won_date) || null), orderNo: str(_order_no) || null, orderId: str(_order_id) || null,
      itemCount: (totalsOf.get(str(r.id)) ?? []).length, totals: t, feeTotal, feeBuckets, fees: feeBreakdown(r), grandTotals: grand,
      quoteUsdApprox: Math.round(usdOfTotals(t, rates)), usdApprox: Math.round(usdOfTotals(grand, rates)),
      fxUsed: rates,
      // 手填总金额（若有）：按手填币种折算 USD，供列表「报价合计」以手填为准
      handTotalUsd: num(r.hand_total) == null ? null : Math.round(Number(num(r.hand_total)) / rateIn(rates, str(r.hand_total_currency) || 'USD')),
      quoteUsd: Math.round(num(r.hand_total) == null ? usdOfTotals(grand, rates) : Number(num(r.hand_total)) / rateIn(rates, str(r.hand_total_currency) || 'USD')) }
  })
  const totalN = (d.prepare(`SELECT COUNT(*) AS n FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN orders o ON o.inquiry_id = i.id ${where}`).get(...args) as { n: number }).n
  // 全量（当前筛选）累计金额 / 成单统计
  const allRows = out
  const usdVal = (r: Record<string, unknown>) => Number((r.handTotalUsd ?? r.usdApprox) || 0)
  const usdTotal = Math.round(allRows.reduce((s, r) => s + usdVal(r), 0))
  const autoUsdTotal = Math.round(allRows.reduce((s, r) => s + Number(r.usdApprox || 0), 0))
  const handTotalCount = allRows.filter((r) => (r as { handTotalUsd?: number | null }).handTotalUsd != null).length
  const wonCount = allRows.filter((r) => Number((r as Record<string, unknown>).is_won) === 1).length
  const wonUsd = Math.round(allRows.filter((r) => Number((r as Record<string, unknown>).is_won) === 1).reduce((s, r) => s + usdVal(r), 0))
  const lostCount = allRows.filter((r) => (r as { status?: string }).status === 'lost').length
  const decided = wonCount + lostCount
  ok(res, { rows: out, meta: { total: totalN, shown: out.length, usdTotal, autoUsdTotal, handTotalCount, wonCount, lostCount, winRate: decided ? Math.round((wonCount / decided) * 1000) / 10 : 0, wonUsd } })
})
app.get('/api/inquiries/:id', (req, res) => {
  const d = getDb()
  const r = d.prepare('SELECT i.*, c.name AS customer_name FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!r) return fail(res, '询价不存在', 404)
  if (!canRead(actorIn(req), r.sales)) return fail(res, '无权查看该询价（不在你的数据范围内）', 403)
  const items = d.prepare('SELECT product_name, qty, amount, currency FROM inquiry_items WHERE inquiry_id = ? ORDER BY sort').all(req.params.id) as { product_name: string; qty: number | null; amount: number; currency: string }[]
  const order = d.prepare('SELECT id, order_no, won_date, amount, currency, note, win_reason FROM orders WHERE inquiry_id = ?').get(req.params.id) as Record<string, unknown> | undefined
  const { is_won: _legacyWon, won_date: _legacyWonDate, ...base } = r
  const totals = fmtTotals(items.map((x) => ({ currency: x.currency, amount: x.amount, qty: x.qty })))
  const feeBuckets = feeTotalsOf(r)
  const rates = ratesOf(r)
  const feeTotal = feeUsdOf(r, rates)
  const grand = grandTotals(totals, feeBuckets)
  ok(res, { ...base, is_won: order ? 1 : 0, status: inquiryStatus(Boolean(order), r.is_lost), won_date: order ? str(order.won_date) : null, orderNo: order ? str(order.order_no) : null, order: order ?? null, items,
    totals, feeTotal, fees: feeBreakdown(r), feeVersions: feeVersionsOf(req.params.id), grandTotals: grand, fxUsed: rates, quoteUsdApprox: Math.round(usdOfTotals(totals, rates)), usdApprox: Math.round(usdOfTotals(grand, rates)) })
})
// 费用版本记录（与产品价格记录并列，便于追溯每次运费/税费/佣金/其他费用的变化）
app.get('/api/inquiries/:id/fee-history', (req, res) => {
  const d = getDb()
  const inq = d.prepare('SELECT inquiry_no FROM inquiries WHERE id = ?').get(req.params.id) as { inquiry_no: string } | undefined
  if (!inq) return fail(res, '询价不存在', 404)
  ok(res, { inquiryNo: inq.inquiry_no, versions: feeVersionsOf(req.params.id) })
})
app.put('/api/inquiries/:id', (req, res) => {
  const d = getDb()
  const old = d.prepare('SELECT * FROM inquiries WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!old) return fail(res, '询价不存在', 404)
  if (!canWrite(actorIn(req), old.sales)) return fail(res, '只能修改自己名下的询价（组长可查看本组，但不修改他人记录）', 403)
  const date = str(req.body?.date) || str(old.date)
  if (!isDate(date)) return fail(res, '询价日期格式应为 YYYY-MM-DD（且为真实日期）')
  const country = req.body?.country !== undefined ? str(req.body?.country) || null : str(old.country) || null
  const useLocation = req.body?.useLocation !== undefined ? str(req.body?.useLocation) || country : str(old.use_location) || country
  const sales = str(req.body?.sales) || str(old.sales)
  const purchaser = str(req.body?.purchaser) || str(old.purchaser)
  const source = str(req.body?.source) || str(old.source)
  const handTotal = req.body?.totalAmount !== undefined ? num(req.body?.totalAmount) : num(old.hand_total)
  const handTotalCur = req.body?.totalAmountCurrency !== undefined
    ? (handTotal == null ? null : normCurrency(req.body?.totalAmountCurrency))
    : (str(old.hand_total_currency) || null)
  // 费用：只有显式传入才覆盖（与其它字段一致）
  const feePatch = readFees(req.body as Record<string, unknown>)
  if (feePatch.err) return fail(res, feePatch.err)
  const fxOverrides = req.body?.fxRates !== undefined ? readFxOverrides(req.body?.fxRates) : (str(old.fx_overrides) || null)
  const feeVals: Record<string, number | null> = {}
  for (const f of FEE_KEYS) {
    feeVals[f.key] = req.body?.[f.key] !== undefined ? feePatch.values[f.key] : (num(old[f.key === 'otherFee' ? 'other_fee' : f.key]) ?? null)
  }
  const feeCurrency = req.body?.feeCurrency !== undefined ? feeCurrencyOf(req.body?.feeCurrency) : feeCurrencyOf(old.fee_currency)
  // 每项费用各自的币种（未传则沿用原值，原值为空再回退默认费用币种）
  const feeCurVals: Record<string, string> = {}
  for (const f of FEE_KEYS) {
    const posted = req.body?.[`${f.key}Currency`]
    feeCurVals[f.key] = posted !== undefined && posted !== null && posted !== ''
      ? normCurrency(posted)
      : (str(old[f.curCol]) ? normCurrency(str(old[f.curCol])) : feeCurrency)
  }
  const note = req.body?.note !== undefined ? (text(req.body?.note) || null) : str(old.note) || null
  const keyCust = req.body?.isKeyCustomer !== undefined ? (req.body.isKeyCustomer ? 1 : 0) : (num(old.is_key_customer) ?? 0)
  const keyProj = req.body?.isKeyProject !== undefined ? (req.body.isKeyProject ? 1 : 0) : (num(old.is_key_project) ?? 0)
  // 成交只能来自销售订单：忽略入参 isWon，保持原值（迁移期兼容旧数据）
  const isWon = num(old.is_won) ?? 0
  const blockers = req.body?.blockers !== undefined ? (text(req.body?.blockers) || null) : (str(old.blockers) || null)
  const actionPlan = req.body?.actionPlan !== undefined ? (text(req.body?.actionPlan) || null) : (str(old.action_plan) || null)
  const supportNeeded = req.body?.supportNeeded !== undefined ? (text(req.body?.supportNeeded) || null) : (str(old.support_needed) || null)
  const starsIn = num(req.body?.customerStars)
  const customerStars = req.body?.customerStars !== undefined ? (starsIn && starsIn >= 1 && starsIn <= 5 ? Math.round(starsIn) : null) : (num(old.customer_stars) ?? null)
  // 未成单（丢单）标记：有销售订单时不允许（需先删订单）
  const hasOrder = Boolean(d.prepare('SELECT id FROM orders WHERE inquiry_id = ?').get(req.params.id))
  const lostIn = req.body?.isLost
  const isLost = lostIn !== undefined ? (lostIn ? 1 : 0) : (num(old.is_lost) ?? 0)
  let lostReason = req.body?.lostReason !== undefined ? (text(req.body?.lostReason) || null) : (str(old.lost_reason) || null)
  let lostDate = req.body?.lostDate !== undefined ? (str(req.body?.lostDate) || null) : (str(old.lost_date) || null)
  if (isLost === 1) {
    if (hasOrder) return fail(res, '该询价已生成销售订单，不能标记为未成单（如需作废请先删除销售订单）', 409)
    if (!lostReason) return fail(res, '标记「未成单」必须填写丢单原因')
    if (!lostDate) lostDate = todayStr()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lostDate)) return fail(res, '丢单日期格式应为 YYYY-MM-DD')
    if (lostDate < date) return fail(res, '丢单日期不能早于询价日期')
  } else { lostReason = null; lostDate = null }

  const itemsProvided = Array.isArray(req.body?.items)
  const items = itemsProvided ? (req.body.items as unknown[]) : []
  const clean = items
    .map((it, i) => ({ productName: str((it as { productName?: unknown }).productName), qty: num((it as { qty?: unknown }).qty), amount: num((it as { amount?: unknown }).amount) ?? 0, currency: normCurrency((it as { currency?: unknown }).currency), sort: i + 1 }))
    .filter((x) => x.productName && x.amount > 0)
  if (itemsProvided && !clean.length) return fail(res, '至少一行产品（产品名称与金额>0）')
  if (clean.some((it) => it.qty != null && it.qty < 0)) return fail(res, '数量不能为负数')
  if (clean.some((it) => it.amount > 1e12)) return fail(res, '金额超出合理范围')
  const tooLongUpd = overLimit([[note, 5000, '备注'], [blockers, 3000, '卡点'], [actionPlan, 3000, '行动计划'], [supportNeeded, 3000, '需要的支持'], [lostReason, 500, '丢单原因']])
  if (tooLongUpd) return fail(res, tooLongUpd)
  if (clean.length > 50) return fail(res, '询价明细最多 50 行')
  if (clean.some((it) => it.productName.length > NAME_MAX)) return fail(res, `产品名称过长（最多 ${NAME_MAX} 个字符）`)
  const t = nowIso()
  d.transaction(() => {
    d.prepare(`UPDATE inquiries SET date = ?, country = ?, use_location = ?, sales = ?, purchaser = ?, source = ?, hand_total = ?, hand_total_currency = ?, note = ?,
        freight_currency = ?, tax_currency = ?, commission_currency = ?, other_fee_currency = ?, fx_overrides = ?,
        is_key_customer = ?, is_key_project = ?, is_won = ?, blockers = ?, action_plan = ?, support_needed = ?, customer_stars = ?,
        is_lost = ?, lost_reason = ?, lost_date = ?, freight = ?, tax = ?, commission = ?, other_fee = ?, fee_currency = ?, updated_at = ? WHERE id = ?`)
      .run(date, country, useLocation, sales, purchaser, source, handTotal, handTotalCur, note,
        feeCurVals.freight, feeCurVals.tax, feeCurVals.commission, feeCurVals.otherFee, fxOverrides, keyCust, keyProj, isWon, blockers, actionPlan, supportNeeded, customerStars,
        isLost, lostReason, lostDate, feeVals.freight, feeVals.tax, feeVals.commission, feeVals.otherFee, feeCurrency, t, req.params.id)
    if (itemsProvided) {
      // 先取旧明细（按行顺序）：用于识别「这一行换了产品」
      const prevLines = d.prepare('SELECT product_name, qty, amount, currency FROM inquiry_items WHERE inquiry_id = ? ORDER BY sort').all(req.params.id) as { product_name: string; qty: number | null; amount: number; currency: string }[]
      d.prepare('DELETE FROM inquiry_items WHERE inquiry_id = ?').run(req.params.id)
      const ins = d.prepare('INSERT INTO inquiry_items (id, inquiry_id, product_name, qty, amount, currency, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
      clean.forEach((it) => ins.run(newId(), req.params.id, it.productName, it.qty, it.amount, it.currency, it.sort))
      const custForName = text(old.customer_id) ? d.prepare('SELECT name FROM customers WHERE id = ?').get(text(old.customer_id)) as { name: string } | undefined : undefined
      upsertProducts(clean, date, t, { inquiryId: req.params.id, inquiryNo: str(old.inquiry_no), customerName: custForName?.name, sales, source: '询报价管理·编辑', prevLines })
    }
    // 费用有变化（金额或币种）→ 记一条新的费用版本
    const feeChanged = FEE_KEYS.some((f) => Number(feeVals[f.key] ?? 0) !== Number(num(old[f.key === 'otherFee' ? 'other_fee' : f.key]) ?? 0))
      || feeCurrency !== feeCurrencyOf(old.fee_currency)
    if (feeChanged || fxOverrides !== (str(old.fx_overrides) || null)) insertFeeVersion(req.params.id, feeVals, feeCurVals, feeCurrency, '询报价管理·编辑', ratesOf({ fx_overrides: fxOverrides }))
    // 客户档案同步：星级/国别/使用地/来源在询报价里改动后要跟着更新
    const custId = text(old.customer_id)
    if (custId) {
      d.prepare('UPDATE customers SET country = COALESCE(?, country), use_location = COALESCE(?, use_location), source = COALESCE(?, source), stars = COALESCE(?, stars), updated_at = ? WHERE id = ?')
        .run(country || null, useLocation || null, source || null, customerStars, t, custId)
    }
  })()
  ok(res, { id: req.params.id, status: inquiryStatus(hasOrder, isLost) })
})
// 询报价不允许删除（如需作废请在编辑中处理；成交以订单为准）
app.delete('/api/inquiries/:id', (_req, res) => fail(res, '询报价不允许删除', 403))

schema(); ensurePeople(); backfillProducts(); syncWonFlags()
// 注：历史成交迁移 migrateWonToOrders() 已不再随启动自动执行（避免废弃列 is_won 反向物化订单）；
// 如需迁移旧库，可手动调用一次。
cleanupOrphans()

// 生产托管前端产物（可选）
const clientDist = path.resolve(__dirname, '../../client/dist')
// 上传文件加固：禁止类型嗅探、限制页面能力；可执行/文档类强制下载，避免同源存储型 XSS
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
    if (/\.(html?|svg|js|mjs|xml)$/i.test(filePath)) res.setHeader('Content-Disposition', 'attachment')
  },
}))
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, {
    setHeaders(res, filePath) {
      // 页面壳不缓存（避免刷新到旧版本）；带 hash 的静态资源可长缓存
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store, must-revalidate')
    },
  }))
  app.get('*', (req, res, next) => { if (req.path.startsWith('/api/')) return next(); res.sendFile(path.join(clientDist, 'index.html')) })
}
// 未匹配到的接口统一返回 JSON，避免前端把 SPA 首页当成接口响应
app.use('/api', (req, res) => fail(res, `接口不存在：${req.method} ${req.originalUrl}`, 404))
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ ok: false, error: err.message || 'Internal Error' })
})

const PORT = Number(process.env.PORT ?? 3218)
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[sales-analytics v3] http://127.0.0.1:${PORT}/api/meta/bootstrap`)
  // 启动后台把工作台组织架构同步一次（保持同步更新）；失败不影响服务，仅记日志
  if (WORKBENCH_TOKEN) {
    setTimeout(() => {
      syncOrgFromWorkbench()
        .then((r) => console.log(`[org] 已从工作台同步组织架构：${r.departments} 个部门 / ${r.persons} 人（新增 ${r.applied.added} · 更新 ${r.applied.updated} · 删除 ${r.applied.removed}）`))
        .catch((e) => console.log(`[org] 启动同步跳过：${(e as Error).message}`))
    }, 1500)
  }
})

// 优雅退出：先落盘（WAL 检查点）再停止接收请求，最后关闭数据库
const shutdown = (sig: string) => {
  console.log(`[sales-analytics] 收到 ${sig}，正在关闭…`)
  // 1) 立刻落盘：WAL 检查点 + 关闭数据库（即使有长连接占着也不会丢数据、不残留 WAL）
  try { getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* 忽略 */ }
  try { getDb().close() } catch { /* 忽略 */ }
  // 2) 让在途请求正常收尾，最多 2 秒后强制退出
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
