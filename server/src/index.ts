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
    d.prepare('INSERT INTO inquiries (id, inquiry_no, date, customer_id, country, use_location, sales, purchaser, source, hand_total, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(iid, no, date, cus.id, country || cus.country, useLocation, sales, purchaser, source, handTotal, note, t, t)
    const ins = d.prepare('INSERT INTO inquiry_items (id, inquiry_id, product_name, qty, amount, currency, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
    cleanItems.forEach((it) => ins.run(newId(), iid, it.productName, it.qty, it.amount, it.currency, it.sort))
  })()
  const saved = d.prepare('SELECT id FROM inquiries WHERE inquiry_no = ?').get(no) as { id: string }
  ok(res, { id: saved.id, inquiryNo: no }, 201)
})

// —— 已录列表（调试/后续页面用） ——
app.get('/api/inquiries', (_req, res) => {
  const rows = getDb().prepare('SELECT i.*, c.name AS customer_name, (SELECT COALESCE(SUM(it.amount),0) FROM inquiry_items it WHERE it.inquiry_id = i.id) AS raw_amount_sum FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id ORDER BY i.created_at DESC LIMIT 200').all()
  ok(res, rows)
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
