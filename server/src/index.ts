/** sales-analytics v3 起步：询报价录入页 API */
import cors from 'cors'
import express from 'express'
import { schema, ensurePeople, backfillProducts, migrateWonToOrders, getDb, getSources, getCountries, saveSources, getFollowMethods, saveFollowMethods, getLostReasons, saveLostReasons, getWinReasons, saveWinReasons, getSetting, setSetting, newId, nowIso, todayStr, text, num } from './db.js'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(cors())
app.use(express.json())

const str = (v: unknown) => text(v)
/** 录入/更新询价时把产品沉淀进产品档案 */
function upsertProducts(
  items: { productName: string; qty: number | null; amount: number; currency: string }[],
  date: string, t: string,
  src: { inquiryId?: string; inquiryNo?: string; customerName?: string; sales?: string; source?: string } = {},
): void {
  const d = getDb()
  const up = d.prepare(`INSERT INTO products (id, name, currency, last_amount, last_qty, use_count, last_used_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET currency=excluded.currency, last_amount=excluded.last_amount, last_qty=excluded.last_qty,
      use_count=products.use_count+1, last_used_at=excluded.last_used_at, updated_at=excluded.updated_at`)
  const find = d.prepare('SELECT * FROM products WHERE name = ? COLLATE NOCASE')
  const insHist = d.prepare(`INSERT INTO product_prices (id, product_name, currency, amount, qty, prev_amount, prev_qty, prev_currency,
      source, inquiry_id, inquiry_no, customer_name, sales, biz_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  items.forEach((it) => {
    const before = find.get(it.productName) as { last_amount: number | null; last_qty: number | null; currency: string } | undefined
    const changed = !before
      || Number(before.last_amount ?? -1) !== Number(it.amount)
      || Number(before.last_qty ?? -1) !== Number(it.qty ?? -1)
      || String(before.currency) !== String(it.currency)
    up.run(newId(), it.productName, it.currency, it.amount, it.qty, date, t, t)
    // 首次录入或金额/数量/币种发生变化 → 在产品档案留下一条变动记录
    if (changed) {
      insHist.run(newId(), it.productName, it.currency, it.amount, it.qty ?? null,
        before ? (before.last_amount ?? null) : null, before ? (before.last_qty ?? null) : null, before ? before.currency : null,
        src.source ?? '询报价录入', src.inquiryId ?? null, src.inquiryNo ?? null, src.customerName ?? null, src.sales ?? null, date, t)
    }
  })
}
const ok = (res: express.Response, data: unknown, st = 200) => res.status(st).json({ ok: true, data })
const fail = (res: express.Response, msg: string, st = 400) => res.status(st).json({ ok: false, error: msg })

// —— 基础元数据：组织人员 / 来源 / 国别 / 汇率（开发态近似，后续接设置）——
const FX: Record<string, number> = { USD: 1, CNY: 7.12, EUR: 0.92 }
app.get('/api/meta/bootstrap', (_req, res) => {
  const d = getDb()
  const people = d.prepare('SELECT name, department, team_name, role FROM people ORDER BY team_name, name').all() as { name: string; department: string; team_name: string; role: string }[]
  const sales = people.filter((p) => p.role === 'sales').map((p) => ({ name: p.name, team: p.team_name }))
  const purchasers = people.filter((p) => ['采购部', '销售支持组'].includes(p.department)).map((p) => p.name)
  ok(res, { sales, purchasers, sources: getSources(), methods: getFollowMethods(), lostReasons: getLostReasons(), winReasons: getWinReasons(), countries: getCountries(), fx: FX, month: todayStr().slice(0, 7) })
})

// —— 产品档案：录入自动沉淀 + 查询/维护 ——
app.get('/api/products', (req, res) => {
  const d = getDb()
  const q = str(req.query.q)
  const like = `%${q}%`
  const rows = (q
    ? d.prepare('SELECT * FROM products WHERE name LIKE ? ORDER BY use_count DESC, updated_at DESC LIMIT 500').all(like)
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
    }
  }))
})

// 单个产品的价格变动记录（谁改的、什么时候、从多少变到多少、来源询价）
app.get('/api/products/history', (req, res) => {
  const name = str(req.query.name)
  if (!name) return fail(res, '请提供产品名称')
  const rows = getDb().prepare('SELECT * FROM product_prices WHERE product_name = ? COLLATE NOCASE ORDER BY created_at DESC, biz_date DESC LIMIT 500').all(name)
  ok(res, rows)
})
app.post('/api/products', (req, res) => {
  const name = str(req.body?.name)
  if (!name) return fail(res, '产品名称必填')
  const t = nowIso()
  const cur = ['USD', 'CNY', 'EUR'].includes(str(req.body?.currency)) ? str(req.body?.currency) : 'USD'
  const d = getDb()
  const before = d.prepare('SELECT * FROM products WHERE name = ? COLLATE NOCASE').get(name) as { last_amount: number | null; last_qty: number | null; currency: string } | undefined
  d.prepare(`INSERT INTO products (id, name, currency, last_amount, last_qty, use_count, last_used_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?) ON CONFLICT(name) DO UPDATE SET currency=excluded.currency, updated_at=excluded.updated_at`)
    .run(newId(), name, cur, num(req.body?.lastAmount), num(req.body?.lastQty), t, t)
  const amt = num(req.body?.lastAmount)
  if (amt != null && Number(before?.last_amount ?? -1) !== Number(amt)) {
    d.prepare(`INSERT INTO product_prices (id, product_name, currency, amount, qty, prev_amount, prev_qty, prev_currency, source, biz_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(newId(), name, cur, amt, num(req.body?.lastQty), before?.last_amount ?? null, before?.last_qty ?? null, before?.currency ?? null, '手动维护', todayStr(), t)
  }
  ok(res, getDb().prepare('SELECT * FROM products WHERE name = ? COLLATE NOCASE').get(name), 201)
})
app.put('/api/products/:id', (req, res) => {
  const d = getDb()
  if (!d.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id)) return fail(res, '产品不存在', 404)
  const name = str(req.body?.name)
  const cur = ['USD', 'CNY', 'EUR'].includes(str(req.body?.currency)) ? str(req.body?.currency) : null
  if (name) d.prepare('UPDATE products SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), req.params.id)
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
  const like = `%${q}%`
  const parts: string[] = []; const args: unknown[] = []
  if (q) { parts.push('(name LIKE ? OR country LIKE ?)'); args.push(like, like) }
  if (salesQ) { parts.push('EXISTS (SELECT 1 FROM inquiries i WHERE i.customer_id = customers.id AND i.sales = ?)'); args.push(salesQ) }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : ''
  const rows = d.prepare(`SELECT id, name, country, use_location, source, stars, created_at, updated_at FROM customers ${where} ORDER BY updated_at DESC LIMIT 500`).all(...args) as Record<string, unknown>[]
  const out = rows.map((c) => {
    const inqs = d.prepare('SELECT i.id, i.date, i.is_key_customer, i.is_key_project, i.is_lost, (SELECT COUNT(*) FROM orders o WHERE o.inquiry_id = i.id) AS has_order, (SELECT COALESCE(SUM(amount),0) FROM inquiry_items it WHERE it.inquiry_id = i.id) AS raw FROM inquiries i WHERE i.customer_id = ? ORDER BY i.date DESC').all(c.id) as { id: string; date: string; is_key_customer: number; is_key_project: number; has_order: number; raw: number }[]
    let usd = 0
    inqs.forEach((i) => { const totals = d.prepare('SELECT currency, COALESCE(SUM(amount),0) AS t FROM inquiry_items WHERE inquiry_id = ? GROUP BY currency').all(i.id) as { currency: string; t: number }[]; totals.forEach((x) => { usd += (x.t || 0) / (FX2[x.currency] || 1) }) })
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
  const inqs = d.prepare(`SELECT i.*, o.order_no AS order_no, o.won_date AS order_won_date, CASE WHEN o.id IS NOT NULL THEN 1 ELSE 0 END AS won_flag,
      (SELECT COALESCE(SUM(amount),0) FROM inquiry_items it WHERE it.inquiry_id = i.id) AS raw_amount
    FROM inquiries i LEFT JOIN orders o ON o.inquiry_id = i.id WHERE i.customer_id = ? ORDER BY i.date DESC`).all(req.params.id) as Record<string, unknown>[]
  const list = inqs.map((i) => {
    const items = d.prepare('SELECT currency, amount FROM inquiry_items WHERE inquiry_id = ?').all(i.id) as { currency: string; amount: number }[]
    const totals = fmtTotals(items)
    const usd = totals.reduce((s, x) => s + x.total / (FX2[x.currency] || 1), 0)
    const { won_flag, order_won_date, order_no, is_won: _w, won_date: _wd, ...ibase } = i
    return { ...ibase, is_won: Number(won_flag) === 1 ? 1 : 0, status: inquiryStatus(Number(won_flag) === 1, (i as Record<string, unknown>).is_lost), won_date: str(order_won_date) || null, orderNo: str(order_no) || null, itemCount: items.length, totals, usdApprox: Math.round(usd) }
  })
  const wonList = list.filter((x) => Number((x as Record<string, unknown>).is_won) === 1)
  const lostList = list.filter((x) => (x as { status?: string }).status === 'lost')
  const decided = wonList.length + lostList.length
  ok(res, { ...c, inquiries: list, summary: { inquiryCount: list.length, usdTotal: Math.round(list.reduce((s, x) => s + (x.usdApprox || 0), 0)), wonCount: wonList.length, lostCount: lostList.length, winRate: decided ? Math.round((wonList.length / decided) * 1000) / 10 : 0, wonUsd: Math.round(wonList.reduce((s, x) => s + (x.usdApprox || 0), 0)), keyProjectCount: list.filter((x) => Number((x as Record<string, unknown>).is_key_project) === 1).length } })
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
      { code: 'follow_method', name: '跟进方式', values: getFollowMethods() },
      { code: 'lost_reason', name: '丢单原因（未成单原因）', values: getLostReasons() },
      { code: 'win_reason', name: '成交原因', values: getWinReasons() },
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
  const country = str(req.body?.country) || null
  const useLocation = str(req.body?.useLocation) || country
  const sales = str(req.body?.sales)
  const purchaser = str(req.body?.purchaser)
  const source = str(req.body?.source)
  const handTotal = num(req.body?.totalAmount)
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
  if (d.prepare('SELECT 1 FROM inquiries WHERE inquiry_no = ?').get(no)) return fail(res, `询价号 ${no} 已存在`, 409)
  if (!clientIdIn && !newName) return fail(res, '请选择客户档案中的客户，或选择“新客户”并填写名称')
  if (!sales) return fail(res, '请选择销售人员')
  if (!purchaser) return fail(res, '请选择采购人员')
  if (!source) return fail(res, '请选择询价来源')

  const cleanItems = items
    .map((it, i) => ({ productName: str(it.productName), qty: num(it.qty), amount: num(it.amount) ?? 0, currency: ['USD', 'CNY', 'EUR'].includes(str(it.currency)) ? str(it.currency) : 'USD', sort: i + 1 }))
    .filter((it) => it.productName && it.amount > 0)
  if (!cleanItems.length) return fail(res, '至少一行询价明细（产品名称与金额大于 0）')

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
    d.prepare('INSERT INTO inquiries (id, inquiry_no, date, customer_id, country, use_location, sales, purchaser, source, hand_total, note, is_key_customer, is_key_project, is_won, blockers, action_plan, support_needed, customer_stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(iid, no, date, customerId, country || customerCountry || null, useLocation || country, sales, purchaser, source, handTotal, note, keyCust, keyProj, isWon, blockers, actionPlan, supportNeeded, customerStars, t, t)
    const ins = d.prepare('INSERT INTO inquiry_items (id, inquiry_id, product_name, qty, amount, currency, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
    cleanItems.forEach((it) => ins.run(newId(), iid, it.productName, it.qty, it.amount, it.currency, it.sort))
    upsertProducts(cleanItems, date, t, { inquiryId: iid, inquiryNo: no, customerName: text(customer.name), sales })
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
  const r = d.prepare(`SELECT i.*, c.name AS customer_name, o.order_no AS order_no, o.won_date AS order_won_date,
      CASE WHEN o.id IS NOT NULL THEN 1 ELSE 0 END AS won_flag
    FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN orders o ON o.inquiry_id = i.id
    WHERE ${parts.join(' AND ')}`).get(...args) as Record<string, unknown> | undefined
  if (!r) return fail(res, salesQ ? '该销售名下未找到此询价号' : '未找到此询价号', 404)
  const items = d.prepare('SELECT product_name, qty, amount, currency FROM inquiry_items WHERE inquiry_id = ? ORDER BY sort').all(r.id) as { product_name: string; qty: number | null; amount: number; currency: string }[]
  const totals = fmtTotals(items.map((x) => ({ currency: x.currency, amount: x.amount })))
  const usd = totals.reduce((s2, x) => s2 + x.total / (FX2[x.currency] || 1), 0)
  const { won_flag, order_won_date, is_won: _w, won_date: _wd, ...base } = r
  ok(res, { ...base, is_won: Number(won_flag) === 1 ? 1 : 0, won_date: str(order_won_date) || null, orderNo: str(r.order_no) || null, items, totals, usdApprox: Math.round(usd), productNames: items.map((x) => x.product_name).join(' / ') })
})
app.get('/api/followups', (req, res) => {
  const d = getDb()
  const inquiryId = str(req.query.inquiryId), salesQ = str(req.query.sales), q = str(req.query.q)
  const parts: string[] = ['1=1']; const args: unknown[] = []
  if (inquiryId) { parts.push('f.inquiry_id = ?'); args.push(inquiryId) }
  if (salesQ) { parts.push('i.sales = ?'); args.push(salesQ) }
  if (q) { parts.push('(i.inquiry_no LIKE ? OR f.content LIKE ? OR c.name LIKE ?)'); const l = `%${q}%`; args.push(l, l, l) }
  const rows = d.prepare(`SELECT f.*, i.inquiry_no, i.sales, c.name AS customer_name FROM followups f
    JOIN inquiries i ON i.id = f.inquiry_id LEFT JOIN customers c ON c.id = i.customer_id
    WHERE ${parts.join(' AND ')} ORDER BY f.date DESC, f.created_at DESC LIMIT 300`).all(...args) as Record<string, unknown>[]
  ok(res, rows.map((r) => {
    const parse = (v: unknown) => { try { const a = JSON.parse(str(v)); return Array.isArray(a) ? a : [] } catch { return [] } }
    return { ...r, photos: parse(r.photos), attachments: parse(r.attachments) }
  }))
})
app.post('/api/followups', (req, res) => {
  const d = getDb()
  const inquiryId = str(req.body?.inquiryId)
  const iq = d.prepare('SELECT * FROM inquiries WHERE id = ?').get(inquiryId) as Record<string, unknown> | undefined
  if (!iq) return fail(res, '询价不存在', 404)
  const date = str(req.body?.date) || todayStr()
  const summary = text(req.body?.summary) || null
  const detail = text(req.body?.detail) || text(req.body?.content) || null
  if (!summary && !detail) return fail(res, '请填写跟进简述或具体内容')
  const photos = Array.isArray(req.body?.photos) ? (req.body.photos as unknown[]).map((x) => str(x)).filter(Boolean).slice(0, 20) : []
  const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as { url?: unknown; name?: unknown }[]).map((x) => ({ url: str(x.url), name: str(x.name) })).filter((x) => x.url).slice(0, 20) : []
  const nextAt = str(req.body?.nextFollowupAt) || null
  const byName = str(req.body?.byName) || text(iq.sales)
  const t = nowIso()
  const fid = newId()
  d.transaction(() => {
    d.prepare('INSERT INTO followups (id, inquiry_id, date, method, content, summary, detail, photos, attachments, next_followup_at, by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(fid, inquiryId, date, str(req.body?.method) || '电话', detail, summary, detail, JSON.stringify(photos), JSON.stringify(attachments), nextAt, byName, t)
    d.prepare('UPDATE inquiries SET last_followup_at = ?, next_followup_at = COALESCE(?, next_followup_at), updated_at = ? WHERE id = ?').run(date, nextAt, t, inquiryId)
  })()
  ok(res, { id: fid, inquiryId, date, nextFollowupAt: nextAt }, 201)
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
app.get('/api/orders', (req, res) => {
  const d = getDb()
  const q = str(req.query.q), salesQ = str(req.query.sales), from = str(req.query.from), to = str(req.query.to), productQ = str(req.query.product)
  const parts: string[] = ['1=1']; const args: unknown[] = []
  if (q) { parts.push('(o.order_no LIKE ? OR i.inquiry_no LIKE ? OR c.name LIKE ?)'); const l = `%${q}%`; args.push(l, l, l) }
  if (salesQ) { parts.push('i.sales = ?'); args.push(salesQ) }
  if (from) { parts.push('o.won_date >= ?'); args.push(from) }
  if (to) { parts.push('o.won_date <= ?'); args.push(to) }
  if (productQ) { parts.push('EXISTS (SELECT 1 FROM inquiry_items it WHERE it.inquiry_id = i.id AND it.product_name LIKE ?)'); args.push(`%${productQ}%`) }
  const rows = d.prepare(`SELECT o.id AS order_id, o.order_no, o.won_date, o.amount AS order_amount, o.currency AS order_currency, o.note AS order_note, o.win_reason AS win_reason,
      i.id AS inquiry_id, i.inquiry_no, i.date, i.sales, i.purchaser, i.source, i.country, i.use_location, i.hand_total, i.is_key_customer, i.is_key_project,
      c.name AS customer_name
    FROM orders o JOIN inquiries i ON i.id = o.inquiry_id LEFT JOIN customers c ON c.id = i.customer_id
    WHERE ${parts.join(' AND ')} ORDER BY o.won_date DESC, o.created_at DESC LIMIT 1000`).all(...args) as Record<string, unknown>[]
  const list = rows.map((r) => {
    const items = d.prepare('SELECT product_name, qty, amount, currency FROM inquiry_items WHERE inquiry_id = ? ORDER BY sort').all(r.inquiry_id) as { product_name: string; qty: number | null; amount: number; currency: string }[]
    const totals = fmtTotals(items)
    const usd = totals.reduce((s2, x) => s2 + x.total / (FX2[x.currency] || 1), 0)
    const cycle = (r.won_date && r.date) ? Math.round((Date.parse(String(r.won_date)) - Date.parse(String(r.date))) / 86400000) : null
    return { ...r, items, itemCount: items.length, totals, usdApprox: Math.round(usd), cycleDays: cycle, productNames: items.map((x) => x.product_name).join(' / ') }
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
  if (d.prepare('SELECT id FROM orders WHERE inquiry_id = ?').get(inquiryId)) return fail(res, '该询价已生成销售订单', 409)
  if (Number(inq.is_lost) === 1) return fail(res, '该询价已标记「未成单」，请先撤销未成单后再生成销售订单', 409)
  const wonDate = str(req.body?.wonDate) || todayStr()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wonDate)) return fail(res, '成单日期格式应为 YYYY-MM-DD')
  if (wonDate < str(inq.date)) return fail(res, '成单日期不能早于询价日期')
  const orderNo = str(req.body?.orderNo) || nextOrderNo()
  if (d.prepare('SELECT id FROM orders WHERE order_no = ?').get(orderNo)) return fail(res, `订单号 ${orderNo} 已存在`, 409)
  const cur = ['USD', 'CNY', 'EUR'].includes(str(req.body?.currency)) ? str(req.body.currency) : 'USD'
  const amount = num(req.body?.amount)
  const t = nowIso()
  const oid = newId()
  const winReason = text(req.body?.winReason) || null
  d.prepare('INSERT INTO orders (id, order_no, inquiry_id, customer_id, won_date, amount, currency, note, win_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(oid, orderNo, inquiryId, text(inq.customer_id) || null, wonDate, amount, cur, text(req.body?.note) || null, winReason, t, t)
  ok(res, { id: oid, orderNo, wonDate }, 201)
})
app.put('/api/orders/:id', (req, res) => {
  const d = getDb()
  const o = d.prepare('SELECT o.*, i.date FROM orders o JOIN inquiries i ON i.id = o.inquiry_id WHERE o.id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!o) return fail(res, '订单不存在', 404)
  const wonDate = req.body?.wonDate !== undefined ? str(req.body.wonDate) : str(o.won_date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wonDate)) return fail(res, '成单日期格式应为 YYYY-MM-DD')
  if (wonDate < str(o.date)) return fail(res, '成单日期不能早于询价日期')
  const orderNo = req.body?.orderNo !== undefined ? (str(req.body.orderNo) || str(o.order_no)) : str(o.order_no)
  const dup = d.prepare('SELECT id FROM orders WHERE order_no = ? AND id <> ?').get(orderNo, req.params.id)
  if (dup) return fail(res, `订单号 ${orderNo} 已存在`, 409)
  const amount = req.body?.amount !== undefined ? num(req.body.amount) : num(o.amount)
  const cur = req.body?.currency !== undefined && ['USD', 'CNY', 'EUR'].includes(str(req.body.currency)) ? str(req.body.currency) : str(o.currency)
  const note = req.body?.note !== undefined ? (text(req.body.note) || null) : str(o.note) || null
  const winReason = req.body?.winReason !== undefined ? (text(req.body.winReason) || null) : (str(o.win_reason) || null)
  d.prepare('UPDATE orders SET order_no = ?, won_date = ?, amount = ?, currency = ?, note = ?, win_reason = ?, updated_at = ? WHERE id = ?').run(orderNo, wonDate, amount, cur, note, winReason, nowIso(), req.params.id)
  ok(res, { id: req.params.id })
})
app.delete('/api/orders/:id', (req, res) => {
  const r = getDb().prepare('DELETE FROM orders WHERE id = ?').run(req.params.id)
  if (!r.changes) return fail(res, '订单不存在', 404)
  ok(res, { deleted: 1 })
})

// —— 原因分析：成交原因（来源销售订单）与丢单原因（来源标记未成单的询价） ——
app.get('/api/analysis/reasons', (req, res) => {
  const d = getDb()
  const salesQ = str(req.query.sales), from = str(req.query.from), to = str(req.query.to), productQ = str(req.query.product)
  const usdOf = (inquiryId: string) => {
    const items = d.prepare('SELECT amount, currency FROM inquiry_items WHERE inquiry_id = ?').all(inquiryId) as { amount: number; currency: string }[]
    return items.reduce((s2, x) => s2 + (Number(x.amount) || 0) / (FX2[x.currency] || 1), 0)
  }
  const blank = (v: unknown) => text(v) || '未填写'

  const wParts: string[] = ['1=1']; const wArgs: unknown[] = []
  if (salesQ) { wParts.push('i.sales = ?'); wArgs.push(salesQ) }
  if (from) { wParts.push('o.won_date >= ?'); wArgs.push(from) }
  if (to) { wParts.push('o.won_date <= ?'); wArgs.push(to) }
  if (productQ) { wParts.push('EXISTS (SELECT 1 FROM inquiry_items it WHERE it.inquiry_id = i.id AND it.product_name LIKE ?)'); wArgs.push(`%${productQ}%`) }
  const wins = d.prepare(`SELECT i.id AS inquiry_id, i.date AS inq_date, o.won_date, o.win_reason FROM orders o JOIN inquiries i ON i.id = o.inquiry_id WHERE ${wParts.join(' AND ')}`)
    .all(...wArgs) as { inquiry_id: string; inq_date: string; won_date: string; win_reason: string | null }[]

  const lParts: string[] = ['o.id IS NULL', 'COALESCE(i.is_lost, 0) = 1']; const lArgs: unknown[] = []
  if (salesQ) { lParts.push('i.sales = ?'); lArgs.push(salesQ) }
  if (from) { lParts.push('COALESCE(i.lost_date, i.date) >= ?'); lArgs.push(from) }
  if (to) { lParts.push('COALESCE(i.lost_date, i.date) <= ?'); lArgs.push(to) }
  if (productQ) { lParts.push('EXISTS (SELECT 1 FROM inquiry_items it WHERE it.inquiry_id = i.id AND it.product_name LIKE ?)'); lArgs.push(`%${productQ}%`) }
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
    usd: usdOf(w.inquiry_id),
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

app.get('/api/contracts', (req, res) => {
  const d = getDb()
  const q = str(req.query.q), salesQ = str(req.query.sales), from = str(req.query.from), to = str(req.query.to), productQ = str(req.query.product)
  const parts: string[] = ['i.is_won = 1']; const args: unknown[] = []
  if (q) { parts.push('(i.inquiry_no LIKE ? OR c.name LIKE ?)'); const l = `%${q}%`; args.push(l, l) }
  if (salesQ) { parts.push('i.sales = ?'); args.push(salesQ) }
  if (from) { parts.push('i.won_date >= ?'); args.push(from) }
  if (to) { parts.push('i.won_date <= ?'); args.push(to) }
  if (productQ) { parts.push('EXISTS (SELECT 1 FROM inquiry_items it WHERE it.inquiry_id = i.id AND it.product_name LIKE ?)'); args.push(`%${productQ}%`) }
  const rows = d.prepare(`SELECT i.*, c.name AS customer_name FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id WHERE ${parts.join(' AND ')} ORDER BY i.won_date DESC, i.updated_at DESC LIMIT 1000`).all(...args) as Record<string, unknown>[]
  const list = rows.map((i) => {
    const items = d.prepare('SELECT product_name, qty, amount, currency FROM inquiry_items WHERE inquiry_id = ? ORDER BY sort').all(i.id) as { product_name: string; qty: number | null; amount: number; currency: string }[]
    const totals = fmtTotals(items)
    const usd = totals.reduce((s, x) => s + x.total / (FX2[x.currency] || 1), 0)
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
const FX2: Record<string, number> = { USD: 1, CNY: 7.12, EUR: 0.92 }

/** 询价状态自动判定：有销售订单 → 已成单；标记未成单 → 未成单（必填原因）；其余 → 跟进中 */
export type InquiryStatus = 'won' | 'lost' | 'following'
const inquiryStatus = (hasOrder: boolean, isLost: unknown): InquiryStatus => (hasOrder ? 'won' : Number(isLost) === 1 ? 'lost' : 'following')
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
  const statusQ = str(req.query.status)
  if (q) { parts.push('(i.inquiry_no LIKE ? OR c.name LIKE ? OR i.note LIKE ?)'); const l = `%${q}%`; args.push(l, l, l) }
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
  const rows = d.prepare(`SELECT i.id, i.inquiry_no, i.date, i.country, i.use_location, i.sales, i.purchaser, i.source, i.hand_total, i.note, i.blockers, i.action_plan, i.support_needed, i.customer_stars, i.is_key_customer, i.is_key_project, i.is_lost, i.lost_reason, i.lost_date, i.last_followup_at, i.next_followup_at, i.created_at, c.name AS customer_name,
      CASE WHEN o.id IS NOT NULL THEN 1 ELSE 0 END AS _won, o.won_date AS _won_date, o.order_no AS _order_no, o.id AS _order_id
    ${join} LEFT JOIN orders o ON o.inquiry_id = i.id ${where} ORDER BY i.date DESC, i.created_at DESC LIMIT 500`).all(...args) as Record<string, unknown>[]
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
    const { _won, _won_date, _order_no, _order_id, ...rest } = r
    return { ...rest, is_won: Number(_won) === 1 ? 1 : 0, status: inquiryStatus(Number(_won) === 1, r.is_lost), won_date: (str(_won_date) || null), orderNo: str(_order_no) || null, orderId: str(_order_id) || null, itemCount: (totalsOf.get(str(r.id)) ?? []).length, totals: t, usdApprox: Math.round(usd) }
  })
  const totalN = (d.prepare(`SELECT COUNT(*) AS n FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN orders o ON o.inquiry_id = i.id ${where}`).get(...args) as { n: number }).n
  // 全量（当前筛选）累计金额 / 成单统计
  const allRows = out
  const usdTotal = Math.round(allRows.reduce((s, r) => s + (r.usdApprox || 0), 0))
  const wonCount = allRows.filter((r) => Number((r as Record<string, unknown>).is_won) === 1).length
  const wonUsd = Math.round(allRows.filter((r) => Number((r as Record<string, unknown>).is_won) === 1).reduce((s, r) => s + (r.usdApprox || 0), 0))
  const lostCount = allRows.filter((r) => (r as { status?: string }).status === 'lost').length
  const decided = wonCount + lostCount
  ok(res, { rows: out, meta: { total: totalN, shown: out.length, usdTotal, wonCount, lostCount, winRate: decided ? Math.round((wonCount / decided) * 1000) / 10 : 0, wonUsd } })
})
app.get('/api/inquiries/:id', (req, res) => {
  const d = getDb()
  const r = d.prepare('SELECT i.*, c.name AS customer_name FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!r) return fail(res, '询价不存在', 404)
  const items = d.prepare('SELECT product_name, qty, amount, currency FROM inquiry_items WHERE inquiry_id = ? ORDER BY sort').all(req.params.id) as { product_name: string; qty: number | null; amount: number; currency: string }[]
  const order = d.prepare('SELECT id, order_no, won_date, amount, currency, note, win_reason FROM orders WHERE inquiry_id = ?').get(req.params.id) as Record<string, unknown> | undefined
  const { is_won: _legacyWon, won_date: _legacyWonDate, ...base } = r
  ok(res, { ...base, is_won: order ? 1 : 0, status: inquiryStatus(Boolean(order), r.is_lost), won_date: order ? str(order.won_date) : null, orderNo: order ? str(order.order_no) : null, order: order ?? null, items, totals: fmtTotals(items.map((x) => ({ currency: x.currency, amount: x.amount }))) })
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
  const isWon = req.body?.isWon !== undefined ? (req.body.isWon ? 1 : 0) : (num(old.is_won) ?? 0)
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
    .map((it, i) => ({ productName: str((it as { productName?: unknown }).productName), qty: num((it as { qty?: unknown }).qty), amount: num((it as { amount?: unknown }).amount) ?? 0, currency: ['USD', 'CNY', 'EUR'].includes(str((it as { currency?: unknown }).currency)) ? str((it as { currency?: unknown }).currency) : 'USD', sort: i + 1 }))
    .filter((x) => x.productName && x.amount > 0)
  if (itemsProvided && !clean.length) return fail(res, '至少一行产品（产品名称与金额>0）')
  const t = nowIso()
  d.transaction(() => {
    d.prepare('UPDATE inquiries SET date = ?, country = ?, use_location = ?, sales = ?, purchaser = ?, source = ?, hand_total = ?, note = ?, is_key_customer = ?, is_key_project = ?, is_won = ?, blockers = ?, action_plan = ?, support_needed = ?, customer_stars = ?, is_lost = ?, lost_reason = ?, lost_date = ?, updated_at = ? WHERE id = ?').run(date, country, useLocation, sales, purchaser, source, handTotal, note, keyCust, keyProj, isWon, blockers, actionPlan, supportNeeded, customerStars, isLost, lostReason, lostDate, t, req.params.id)
    if (itemsProvided) {
      d.prepare('DELETE FROM inquiry_items WHERE inquiry_id = ?').run(req.params.id)
      const ins = d.prepare('INSERT INTO inquiry_items (id, inquiry_id, product_name, qty, amount, currency, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
      clean.forEach((it) => ins.run(newId(), req.params.id, it.productName, it.qty, it.amount, it.currency, it.sort))
      const custForName = text(old.customer_id) ? d.prepare('SELECT name FROM customers WHERE id = ?').get(text(old.customer_id)) as { name: string } | undefined : undefined
      upsertProducts(clean, date, t, { inquiryId: req.params.id, inquiryNo: str(old.inquiry_no), customerName: custForName?.name, sales })
    }
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

schema(); ensurePeople(); backfillProducts(); migrateWonToOrders()

// 生产托管前端产物（可选）
const clientDist = path.resolve(__dirname, '../../client/dist')
app.use('/uploads', express.static(path.resolve(__dirname, '../data/uploads')))
if (existsSync(clientDist)) {
  app.use('/uploads', express.static(UPLOAD_DIR))
  app.use(express.static(clientDist, {
    setHeaders(res, filePath) {
      // 页面壳不缓存（避免刷新到旧版本）；带 hash 的静态资源可长缓存
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store, must-revalidate')
    },
  }))
  app.get('*', (req, res, next) => { if (req.path.startsWith('/api/')) return next(); res.sendFile(path.join(clientDist, 'index.html')) })
}
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ ok: false, error: err.message || 'Internal Error' })
})

const PORT = Number(process.env.PORT ?? 3218)
app.listen(PORT, '127.0.0.1', () => console.log(`[sales-analytics v3] http://127.0.0.1:${PORT}/api/meta/bootstrap`))
