/** sales-analytics v3 起步：询报价录入页 API */
import cors from 'cors'
import express from 'express'
import { schema, ensurePeople, getDb, getSources, getCountries, saveSources, getSetting, setSetting, newId, nowIso, todayStr, text, num } from './db.js'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(cors())
app.use(express.json())

const str = (v: unknown) => text(v)
const ok = (res: express.Response, data: unknown, st = 200) => res.status(st).json({ ok: true, data })
const fail = (res: express.Response, msg: string, st = 400) => res.status(st).json({ ok: false, error: msg })

// —— 基础元数据：组织人员 / 来源 / 国别 / 汇率（开发态近似，后续接设置）——
const FX: Record<string, number> = { USD: 1, CNY: 7.12, EUR: 0.92 }
app.get('/api/meta/bootstrap', (_req, res) => {
  const d = getDb()
  const people = d.prepare('SELECT name, department, team_name, role FROM people ORDER BY team_name, name').all() as { name: string; department: string; team_name: string; role: string }[]
  const sales = people.filter((p) => p.role === 'sales').map((p) => ({ name: p.name, team: p.team_name }))
  const purchasers = people.filter((p) => ['采购部', '销售支持组'].includes(p.department)).map((p) => p.name)
  ok(res, { sales, purchasers, sources: getSources(), countries: getCountries(), fx: FX, month: todayStr().slice(0, 7) })
})

// —— 客户联想（自动建档支持） ——
app.get('/api/customers', (req, res) => {
  const q = str(req.query.q)
  const like = `%${q}%`
  const rows = q
    ? getDb().prepare('SELECT id, name, country FROM customers WHERE name LIKE ? ORDER BY updated_at DESC LIMIT 10').all(like)
    : getDb().prepare('SELECT id, name, country FROM customers ORDER BY name LIMIT 50').all()
  ok(res, rows)
})

// —— 询价号唯一性检查 ——
app.get('/api/inquiries/exists', (req, res) => {
  const no = str(req.query.no)
  const r = no ? getDb().prepare('SELECT 1 FROM inquiries WHERE inquiry_no = ?').get(no) : undefined
  ok(res, { exists: Boolean(r) })
})

// —— 统一字段/选项元数据（可配字典 + 系统固定字典） ——
app.get('/api/options', (_req, res) => {
  ok(res, {
    editable: [
      { code: 'source', name: '询价来源', values: getSources() },
      { code: 'country_custom', name: '自定义国别补充（可选维护）', values: (() => { try { const a = JSON.parse(getSetting('countries', '')); return Array.isArray(a) ? a : [] } catch { return [] } })() },
    ],
    fixed: [
      { code: 'currency', name: '币种（系统固定）', values: ['USD', 'CNY', 'EUR'] },
    ],
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
// 自定义国别补充维护（设置页统一管理；主列表仍为内置完整清单）
app.post('/api/countries-custom', (req, res) => {
  const b = (req.body ?? {}) as { action?: string; value?: string; newValue?: string }
  let arr: string[] = []; try { const a = JSON.parse(getSetting('countries', '')); arr = Array.isArray(a) ? a : [] } catch { arr = [] }
  if (b.action === 'add' && str(b.value)) { if (!arr.includes(str(b.value))) arr.push(str(b.value)) }
  if (b.action === 'remove' && str(b.value)) arr = arr.filter((x) => x !== str(b.value))
  if (b.action === 'rename' && str(b.value) && str(b.newValue)) arr = arr.map((x) => (x === str(b.value) ? str(b.newValue) : x))
  setSetting('countries', JSON.stringify(arr))
  ok(res, arr)
})

// —— 录入询报价（新客户名自动建档） ——
app.post('/api/inquiries', (req, res) => {
  const d = getDb()
  const no = str(req.body?.inquiryNo)
  const date = str(req.body?.date) || todayStr()
  const customerName = str(req.body?.customerName)
  const country = str(req.body?.country) || null
  const useLocation = str(req.body?.useLocation) || country
  const sales = str(req.body?.sales)
  const purchaser = str(req.body?.purchaser)
  const source = str(req.body?.source)
  const handTotal = num(req.body?.totalAmount)
  const note = text(req.body?.note) || null
  const keyCust = req.body?.isKeyCustomer ? 1 : 0
  const keyProj = req.body?.isKeyProject ? 1 : 0
  const items = (Array.isArray(req.body?.items) ? (req.body.items as unknown[]) : []) as { productName?: unknown; qty?: unknown; amount?: unknown; currency?: unknown }[]
  if (!no) return fail(res, '询价号必填')
  if (d.prepare('SELECT 1 FROM inquiries WHERE inquiry_no = ?').get(no)) return fail(res, `询价号 ${no} 已存在`, 409)
  if (!customerName) return fail(res, '客户名称必填')
  if (!sales) return fail(res, '请选择销售人员')
  if (!purchaser) return fail(res, '请选择采购人员')
  if (!source) return fail(res, '请选择询价来源')
  const cleanItems = items
    .map((it, i) => ({ productName: str(it.productName), qty: num(it.qty), amount: num(it.amount) ?? 0, currency: ['USD', 'CNY', 'EUR'].includes(str(it.currency)) ? str(it.currency) : 'USD', sort: i + 1 }))
    .filter((it) => it.productName && it.amount > 0)
  if (!cleanItems.length) return fail(res, '至少一行产品（产品名称与金额>0）')

  const t = nowIso()
  d.transaction(() => {
    // 自动建档：同名客户复用，否则新建
    let cus = d.prepare('SELECT * FROM customers WHERE name = ? COLLATE NOCASE').get(customerName) as { id: string; country: string | null } | undefined
    if (!cus) {
      const cid = newId()
      d.prepare('INSERT INTO customers (id, name, country, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(cid, customerName, country, source, t, t)
      cus = { id: cid, country }
    } else {
      d.prepare('UPDATE customers SET country = COALESCE(?, country), source = COALESCE(?, source), updated_at = ? WHERE id = ?').run(country || null, source || null, t, cus.id)
    }
    const iid = newId()
    d.prepare('INSERT INTO inquiries (id, inquiry_no, date, customer_id, country, use_location, sales, purchaser, source, hand_total, note, is_key_customer, is_key_project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(iid, no, date, cus.id, country || cus.country, useLocation, sales, purchaser, source, handTotal, note, keyCust, keyProj, t, t)
    const ins = d.prepare('INSERT INTO inquiry_items (id, inquiry_id, product_name, qty, amount, currency, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
    cleanItems.forEach((it) => ins.run(newId(), iid, it.productName, it.qty, it.amount, it.currency, it.sort))
  })()
  const saved = d.prepare('SELECT id FROM inquiries WHERE inquiry_no = ?').get(no) as { id: string }
  ok(res, { id: saved.id, inquiryNo: no }, 201)
})

// —— 询报价管理：列表（筛选/统计/详情/编辑/删除） ——
const FX2: Record<string, number> = { USD: 1, CNY: 7.12, EUR: 0.92 }
function fmtTotals(items: { currency: string; amount: number }[]): { currency: string; total: number }[] {
  const m = new Map<string, number>()
  items.forEach((it) => m.set(it.currency, (m.get(it.currency) ?? 0) + (num(it.amount) ?? 0)))
  return Array.from(m.entries()).map(([currency, total]) => ({ currency, total })).sort((a, b) => ['USD', 'CNY', 'EUR'].indexOf(a.currency) - ['USD', 'CNY', 'EUR'].indexOf(b.currency))
}
app.get('/api/inquiries', (req, res) => {
  const d = getDb()
  const parts: string[] = []; const args: unknown[] = []
  const q = str(req.query.q), from = str(req.query.from), to = str(req.query.to)
  const sales = str(req.query.sales), purchaser = str(req.query.purchaser), source = str(req.query.source), country = str(req.query.country)
  if (q) { parts.push('(i.inquiry_no LIKE ? OR c.name LIKE ? OR i.note LIKE ?)'); const l = `%${q}%`; args.push(l, l, l) }
  if (from) { parts.push('i.date >= ?'); args.push(from) }
  if (to) { parts.push('i.date <= ?'); args.push(to) }
  if (sales) { parts.push('i.sales = ?'); args.push(sales) }
  if (purchaser) { parts.push('i.purchaser = ?'); args.push(purchaser) }
  if (source) { parts.push('i.source = ?'); args.push(source) }
  if (country) { parts.push('(i.country = ? OR i.use_location = ?)'); args.push(country, country) }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : ''
  const join = 'FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id'
  const rows = d.prepare(`SELECT i.id, i.inquiry_no, i.date, i.country, i.use_location, i.sales, i.purchaser, i.source, i.hand_total, i.note, i.is_key_customer, i.is_key_project, i.created_at, c.name AS customer_name ${join} ${where} ORDER BY i.date DESC, i.created_at DESC LIMIT 500`).all(...args) as Record<string, unknown>[]
  const ids = rows.map((r) => str(r.id))
  const totalsOf = new Map<string, { currency: string; amount: number }[]>()
  if (ids.length) {
    const marks = ids.map(() => '?').join(',')
    const items = d.prepare(`SELECT inquiry_id, currency, amount FROM inquiry_items WHERE inquiry_id IN (${marks})`).all(...ids) as { inquiry_id: string; currency: string; amount: number }[]
    items.forEach((it) => { const a = totalsOf.get(it.inquiry_id) ?? []; a.push(it); totalsOf.set(it.inquiry_id, a) })
  }
  const out = rows.map((r) => {
    const t = fmtTotals(totalsOf.get(str(r.id)) ?? [])
    const usd = t.reduce((s, x) => s + x.total / (FX2[x.currency] || 1), 0)
    return { ...r, itemCount: (totalsOf.get(str(r.id)) ?? []).length, totals: t, usdApprox: Math.round(usd) }
  })
  const totalN = (d.prepare(`SELECT COUNT(*) AS n FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id ${where}`).get(...args) as { n: number }).n
  ok(res, { rows: out, meta: { total: totalN, shown: out.length } })
})
app.get('/api/inquiries/:id', (req, res) => {
  const d = getDb()
  const r = d.prepare('SELECT i.*, c.name AS customer_name FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!r) return fail(res, '询价不存在', 404)
  const items = d.prepare('SELECT product_name, qty, amount, currency FROM inquiry_items WHERE inquiry_id = ? ORDER BY sort').all(req.params.id) as { product_name: string; qty: number | null; amount: number; currency: string }[]
  ok(res, { ...r, items, totals: fmtTotals(items.map((x) => ({ currency: x.currency, amount: x.amount }))) })
})
app.put('/api/inquiries/:id', (req, res) => {
  const d = getDb()
  const old = d.prepare('SELECT * FROM inquiries WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!old) return fail(res, '询价不存在', 404)
  const date = str(req.body?.date) || str(old.date)
  const country = req.body?.country !== undefined ? str(req.body?.country) || null : str(old.country) || null
  const useLocation = req.body?.useLocation !== undefined ? str(req.body?.useLocation) || country : str(old.use_location) || country
  const sales = str(req.body?.sales) || str(old.sales)
  const purchaser = str(req.body?.purchaser) || str(old.purchaser)
  const source = str(req.body?.source) || str(old.source)
  const handTotal = req.body?.totalAmount !== undefined ? num(req.body?.totalAmount) : num(old.hand_total)
  const note = req.body?.note !== undefined ? (text(req.body?.note) || null) : str(old.note) || null
  const keyCust = req.body?.isKeyCustomer !== undefined ? (req.body.isKeyCustomer ? 1 : 0) : (num(old.is_key_customer) ?? 0)
  const keyProj = req.body?.isKeyProject !== undefined ? (req.body.isKeyProject ? 1 : 0) : (num(old.is_key_project) ?? 0)
  const itemsProvided = Array.isArray(req.body?.items)
  const items = itemsProvided ? (req.body.items as unknown[]) : []
  const clean = items
    .map((it, i) => ({ productName: str((it as { productName?: unknown }).productName), qty: num((it as { qty?: unknown }).qty), amount: num((it as { amount?: unknown }).amount) ?? 0, currency: ['USD', 'CNY', 'EUR'].includes(str((it as { currency?: unknown }).currency)) ? str((it as { currency?: unknown }).currency) : 'USD', sort: i + 1 }))
    .filter((x) => x.productName && x.amount > 0)
  if (itemsProvided && !clean.length) return fail(res, '至少一行产品（产品名称与金额>0）')
  const t = nowIso()
  d.transaction(() => {
    d.prepare('UPDATE inquiries SET date = ?, country = ?, use_location = ?, sales = ?, purchaser = ?, source = ?, hand_total = ?, note = ?, is_key_customer = ?, is_key_project = ?, updated_at = ? WHERE id = ?').run(date, country, useLocation, sales, purchaser, source, handTotal, note, keyCust, keyProj, t, req.params.id)
    if (itemsProvided) {
      d.prepare('DELETE FROM inquiry_items WHERE inquiry_id = ?').run(req.params.id)
      const ins = d.prepare('INSERT INTO inquiry_items (id, inquiry_id, product_name, qty, amount, currency, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
      clean.forEach((it) => ins.run(newId(), req.params.id, it.productName, it.qty, it.amount, it.currency, it.sort))
    }
  })()
  ok(res, { id: req.params.id })
})
app.delete('/api/inquiries/:id', (req, res) => {
  const d = getDb()
  const r = d.prepare('DELETE FROM inquiries WHERE id = ?').run(req.params.id)
  if (!r.changes) return fail(res, '询价不存在', 404)
  ok(res, { deleted: 1 })
})

schema(); ensurePeople()

// 生产托管前端产物（可选）
const clientDist = path.resolve(__dirname, '../../client/dist')
if (existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get('*', (req, res, next) => { if (req.path.startsWith('/api/')) return next(); res.sendFile(path.join(clientDist, 'index.html')) })
}
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ ok: false, error: err.message || 'Internal Error' })
})

const PORT = Number(process.env.PORT ?? 3218)
app.listen(PORT, '127.0.0.1', () => console.log(`[sales-analytics v3] http://127.0.0.1:${PORT}/api/meta/bootstrap`))
