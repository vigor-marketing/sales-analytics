/** 数据层：SQLite（WAL）。v3 起步：询报价录入最小闭环 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
mkdirSync(path.resolve(__dirname, '../data'), { recursive: true })
export const DB_FILE = process.env.DB_PATH ?? path.resolve(__dirname, '../data/sales-analytics.db')
const raw = new DatabaseSync(DB_FILE)
raw.exec('PRAGMA journal_mode = WAL')
raw.exec('PRAGMA foreign_keys = ON')
// 写锁等待：避免并发写入时直接抛 "database is locked"
raw.exec('PRAGMA busy_timeout = 5000')
raw.exec('PRAGMA synchronous = NORMAL')
// 语句缓存：复用 prepared statement，避免频繁创建/回收（也规避驱动层 GC 问题）
const stmtCache = new Map<string, ReturnType<DatabaseSync['prepare']>>()
const db = {
  exec: (sql: string) => { raw.exec(sql) },
  prepare: (sql: string) => {
    let st = stmtCache.get(sql)
    if (!st) { st = raw.prepare(sql); stmtCache.set(sql, st) }
    return st
  },
  transaction: <T extends (...args: unknown[]) => unknown>(fn: T) => (...args: Parameters<T>): ReturnType<T> => {
    raw.exec('BEGIN')
    try { const r = fn(...args) as ReturnType<T>; raw.exec('COMMIT'); return r } catch (e) { try { raw.exec('ROLLBACK') } catch { /* */ } throw e }
  },
  close: () => raw.close(),
}

export const nowIso = () => new Date().toISOString()
// 本地日期（避免 UTC 造成每天 8 小时的日期错位）
export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const newId = () => randomUUID()
// 注意：Number(null)===0、Number('')===0，会把「未填写」静默写成 0，这里显式排除
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string' && !v.trim()) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
export const text = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : '')

export function schema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT, use_location TEXT, source TEXT, stars INTEGER,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(name COLLATE NOCASE));
    CREATE TABLE IF NOT EXISTS inquiries (
      id TEXT PRIMARY KEY, inquiry_no TEXT UNIQUE NOT NULL, date TEXT NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id), country TEXT, use_location TEXT,
      sales TEXT, purchaser TEXT, source TEXT, hand_total REAL, note TEXT,
      is_key_customer INTEGER NOT NULL DEFAULT 0, is_key_project INTEGER NOT NULL DEFAULT 0,
      is_won INTEGER NOT NULL DEFAULT 0, won_date TEXT,
      customer_stars INTEGER, blockers TEXT, action_plan TEXT, support_needed TEXT,
      freight REAL, tax REAL, commission REAL, other_fee REAL, fee_currency TEXT NOT NULL DEFAULT 'USD',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inquiry_items (
      id TEXT PRIMARY KEY, inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
      product_name TEXT NOT NULL, qty REAL, amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
      sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, department TEXT, team_name TEXT,
      role TEXT NOT NULL DEFAULT 'sales', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      last_amount REAL, last_qty REAL, use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(name COLLATE NOCASE));
    CREATE TABLE IF NOT EXISTS followup_comments (
      id TEXT PRIMARY KEY, followup_id TEXT NOT NULL, content TEXT NOT NULL,
      by_name TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS fee_versions (
      id TEXT PRIMARY KEY, inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
      freight REAL, tax REAL, commission REAL, other_fee REAL, fee_currency TEXT NOT NULL DEFAULT 'USD',
      total REAL NOT NULL DEFAULT 0, source TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS product_prices (
      id TEXT PRIMARY KEY, product_name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      amount REAL, qty REAL, prev_amount REAL, prev_qty REAL, prev_currency TEXT,
      source TEXT, inquiry_id TEXT, inquiry_no TEXT, customer_name TEXT, sales TEXT, biz_date TEXT,
      created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS followups (
      id TEXT PRIMARY KEY, inquiry_id TEXT NOT NULL, date TEXT NOT NULL, method TEXT,
      content TEXT, summary TEXT, detail TEXT, photos TEXT, attachments TEXT,
      next_followup_at TEXT, by_name TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, order_no TEXT NOT NULL, inquiry_id TEXT NOT NULL,
      customer_id TEXT, won_date TEXT NOT NULL, amount REAL, currency TEXT NOT NULL DEFAULT 'USD',
      note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(order_no), UNIQUE(inquiry_id));
    CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `)
  // 老库补列（幂等）
  try { db.exec('ALTER TABLE inquiries ADD COLUMN use_location TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN is_key_customer INTEGER NOT NULL DEFAULT 0') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN is_key_project INTEGER NOT NULL DEFAULT 0') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE customers ADD COLUMN use_location TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN is_won INTEGER NOT NULL DEFAULT 0') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN blockers TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN action_plan TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN support_needed TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN customer_stars INTEGER') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE customers ADD COLUMN stars INTEGER') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE followups ADD COLUMN summary TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE followups ADD COLUMN detail TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE followups ADD COLUMN photos TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE followups ADD COLUMN attachments TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN won_date TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN last_followup_at TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN next_followup_at TEXT') } catch { /* 已存在 */ }
  // 未成单（丢单）：人工标记 + 必填原因；成交仍由销售订单自动判定
  try { db.exec('ALTER TABLE inquiries ADD COLUMN is_lost INTEGER NOT NULL DEFAULT 0') } catch { /* 已存在 */ }
  // 费用（运费/税费/佣金/其他）：单独记在询价上，总价 = 明细合计 + 费用合计
  try { db.exec('ALTER TABLE inquiries ADD COLUMN freight REAL') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN tax REAL') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN commission REAL') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN other_fee REAL') } catch { /* 已存在 */ }
  try { db.exec("ALTER TABLE inquiries ADD COLUMN fee_currency TEXT NOT NULL DEFAULT 'USD'") } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN lost_reason TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN lost_date TEXT') } catch { /* 已存在 */ }
  // 常用查询索引（幂等创建，提升联表与过滤效率）
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_inquiries_no ON inquiries(inquiry_no COLLATE NOCASE)',
    'CREATE INDEX IF NOT EXISTS idx_inquiries_customer ON inquiries(customer_id)',
    'CREATE INDEX IF NOT EXISTS idx_inquiries_sales_date ON inquiries(sales, date)',
    'CREATE INDEX IF NOT EXISTS idx_inquiries_lost ON inquiries(is_lost)',
    'CREATE INDEX IF NOT EXISTS idx_items_inquiry ON inquiry_items(inquiry_id)',
    'CREATE INDEX IF NOT EXISTS idx_fee_versions_inquiry ON fee_versions(inquiry_id)',
    'CREATE INDEX IF NOT EXISTS idx_orders_inquiry ON orders(inquiry_id)',
    'CREATE INDEX IF NOT EXISTS idx_orders_won_date ON orders(won_date)',
    'CREATE INDEX IF NOT EXISTS idx_followups_inquiry ON followups(inquiry_id)',
    'CREATE INDEX IF NOT EXISTS idx_comments_followup ON followup_comments(followup_id)',
    'CREATE INDEX IF NOT EXISTS idx_prices_name ON product_prices(product_name COLLATE NOCASE)',
    'CREATE INDEX IF NOT EXISTS idx_products_name ON products(name COLLATE NOCASE)',
    'CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name COLLATE NOCASE)',
  ]
  indexes.forEach((sql) => { try { db.exec(sql) } catch { /* 忽略 */ } })

  // 跟进评论表（旧库补建）
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS followup_comments (
      id TEXT PRIMARY KEY, followup_id TEXT NOT NULL, content TEXT NOT NULL,
      by_name TEXT, created_at TEXT NOT NULL)`)
  } catch { /* 已存在 */ }
  // 产品价格变动记录表（旧库补建）
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS product_prices (
      id TEXT PRIMARY KEY, product_name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      amount REAL, qty REAL, prev_amount REAL, prev_qty REAL, prev_currency TEXT,
      source TEXT, inquiry_id TEXT, inquiry_no TEXT, customer_name TEXT, sales TEXT, biz_date TEXT,
      created_at TEXT NOT NULL)`)
  } catch { /* 已存在 */ }
  // 成交原因（成单时填写，用于成交原因分析）
  try { db.exec('ALTER TABLE orders ADD COLUMN win_reason TEXT') } catch { /* 已存在 */ }
  // 手填总金额的币种（2026-09 增补：手填总金额此前没有金额单位）
  try { db.exec('ALTER TABLE inquiries ADD COLUMN hand_total_currency TEXT') } catch { /* 已存在 */ }
  // 每项费用各自的币种（2026-09 增补：运费/税费/佣金/其他费用可分别用不同币种录入，各自按对应汇率折算）
  for (const col of ['freight_currency', 'tax_currency', 'commission_currency', 'other_fee_currency']) {
    try { db.exec(`ALTER TABLE inquiries ADD COLUMN ${col} TEXT`) } catch { /* 已存在 */ }
  }
  // 费用版本记录每项费用的币种明细
  try { db.exec('ALTER TABLE fee_versions ADD COLUMN fee_detail TEXT') } catch { /* 已存在 */ }
  // 询价上可覆盖的汇率（录入非美元时按实际汇率计算，存 {币种: 汇率}）
  try { db.exec('ALTER TABLE inquiries ADD COLUMN fx_overrides TEXT') } catch { /* 已存在 */ }
  // 产品变更记录：这一行「原来是哪个产品、数量、金额、币种」（换产品时留痕，便于看清产品名称/数量/金额的变化）
  for (const col of ['from_product', 'from_currency']) {
    try { db.exec(`ALTER TABLE product_prices ADD COLUMN ${col} TEXT`) } catch { /* 已存在 */ }
  }
  for (const col of ['from_qty', 'from_amount']) {
    try { db.exec(`ALTER TABLE product_prices ADD COLUMN ${col} REAL`) } catch { /* 已存在 */ }
  }
  // 老记录回填：来源里写着「产品变更（原 X）」的，把原产品名补进 from_product
  try {
    db.exec(`UPDATE product_prices SET from_product = substr(source, instr(source, '产品变更（原 ') + length('产品变更（原 '), length(source) - instr(source, '产品变更（原 ') - length('产品变更（原 ') )
      WHERE from_product IS NULL AND source LIKE '%产品变更（原 %）%'`)
  } catch { /* 忽略 */ }
  // 丢单原因下拉自带「其他（手动输入）」，历史字典里的裸「其他」属重复项，清理掉
  try {
    for (const key of ['lostReasons', 'winReasons']) {
      const raw = db.prepare('SELECT v FROM settings WHERE k = ?').get(key) as { v: string } | undefined
      if (!raw?.v) continue
      const arr = JSON.parse(raw.v)
      if (Array.isArray(arr) && arr.includes('其他')) {
        const next = arr.filter((x: unknown) => x !== '其他')
        db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(key, JSON.stringify(next))
      }
    }
  } catch { /* 忽略 */ }
}
export const getDb = () => db


export function getSetting(k: string, dft = ''): string {
  const r = db.prepare('SELECT v FROM settings WHERE k = ?').get(k) as { v: string } | undefined
  return r ? r.v : dft
}
export function setSetting(k: string, v: string): void {
  db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v)
}

/** 询价来源字典（默认 + 设置可维护） */
export function getSources(): string[] {
  try { const arr = JSON.parse(getSetting('inquirySources', '')); if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string' && x.trim()) } catch { /* */ }
  return ['展会', '官网', '转介绍', '老客户复购', '平台询盘', '邮件直询', '其他']
}
/** 跟进方式字典（设置中可管理） */
export function getFollowMethods(): string[] {
  try { const arr = JSON.parse(getSetting('followMethods', '')); if (Array.isArray(arr) && arr.length) return arr.filter((x) => typeof x === 'string' && x.trim()) } catch { /* */ }
  return ['电话', '邮件', '微信', '拜访', '展会', '其他']
}
/** 丢单原因字典（设置中可管理；录入时下拉选 + 允许手填） */
export function getLostReasons(): string[] {
  try { const arr = JSON.parse(getSetting('lostReasons', '')); if (Array.isArray(arr) && arr.length) return arr.filter((x) => typeof x === 'string' && x.trim()) } catch { /* */ }
  return ['价格无优势', '交期太长', '技术方案不满足', '客户选择竞品', '客户预算取消', '项目暂停/延期', '联系不上客户']
}
export function saveLostReasons(list: string[]): void {
  setSetting('lostReasons', JSON.stringify(list.filter((x) => text(x)).slice(0, 100)))
}

/** 成交原因字典（设置中可管理；成单时下拉选 + 允许手填） */
export function getWinReasons(): string[] {
  try { const arr = JSON.parse(getSetting('winReasons', '')); if (Array.isArray(arr) && arr.length) return arr.filter((x) => typeof x === 'string' && x.trim()) } catch { /* */ }
  return ['价格有优势', '交期满足', '技术方案匹配', '品牌/资质认可', '客户关系', '售后服务', '老客户复购']
}
export function saveWinReasons(list: string[]): void {
  setSetting('winReasons', JSON.stringify(list.filter((x) => text(x)).slice(0, 100)))
}

export function saveFollowMethods(list: string[]): void {
  setSetting('followMethods', JSON.stringify(list.filter((x) => text(x)).slice(0, 100)))
}

export function saveSources(list: string[]): void {
  setSetting('inquirySources', JSON.stringify(list.filter((x) => text(x)).slice(0, 200)))
}

/** 常用国别（前端可下拉，也可自由输入新值） */
export function getCountries(): string[] {
  try { const arr = JSON.parse(getSetting('countries', '')); if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string' && x.trim()) } catch { /* */ }
  return ['中国', '美国', '加拿大', '阿联酋', '沙特', '科威特', '印尼', '马来西亚', '俄罗斯', '哈萨克斯坦', '英国', '德国', '巴西', '墨西哥', '其他']
}

/** 历史成单询价迁移为销售订单（幂等）：仅当该询价尚无订单 */
export function migrateWonToOrders(): void {
  getDb().exec(`
    INSERT OR IGNORE INTO orders (id, order_no, inquiry_id, customer_id, won_date, amount, currency, note, created_at, updated_at)
    SELECT lower(hex(randomblob(16))), 'SO-LEGACY-' || i.inquiry_no, i.id, i.customer_id, COALESCE(i.won_date, i.date),
           (SELECT COALESCE(SUM(ii.amount),0) FROM inquiry_items ii WHERE ii.inquiry_id = i.id), 'USD', i.note, datetime('now'), datetime('now')
    FROM inquiries i
    WHERE i.is_won = 1 AND i.won_date IS NOT NULL;
  `)
}

/** 询价费用相关列（统一在此维护，避免各处 SQL 漏字段） */
export const FEE_COLUMNS = ['freight', 'tax', 'commission', 'other_fee', 'fee_currency'] as const

/** 以销售订单为唯一口径，回写废弃列 is_won / won_date（保持旧接口与统计口径一致，幂等） */
export function syncWonFlags(): void {
  getDb().prepare(`UPDATE inquiries SET
      is_won = CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.inquiry_id = inquiries.id) THEN 1 ELSE 0 END,
      won_date = (SELECT o.won_date FROM orders o WHERE o.inquiry_id = inquiries.id)`).run()
}

/** 历史明细回填产品档案（幂等，仅补名称/次数/币种/最近价格） */
export function backfillProducts(): void {
  db.exec(`
    INSERT OR IGNORE INTO products (id, name, currency, last_amount, last_qty, use_count, last_used_at, created_at, updated_at)
    SELECT lower(hex(randomblob(16))), t.product_name, t.currency, t.amount, t.qty, t.c, t.last_used, datetime('now'), datetime('now')
    FROM (
      SELECT ii.product_name AS product_name,
             (SELECT ii2.currency FROM inquiry_items ii2 WHERE ii2.product_name = ii.product_name ORDER BY ii2.rowid DESC LIMIT 1) AS currency,
             (SELECT ii2.amount FROM inquiry_items ii2 WHERE ii2.product_name = ii.product_name ORDER BY ii2.rowid DESC LIMIT 1) AS amount,
             (SELECT ii2.qty FROM inquiry_items ii2 WHERE ii2.product_name = ii.product_name ORDER BY ii2.rowid DESC LIMIT 1) AS qty,
             COUNT(*) AS c,
             (SELECT i2.date FROM inquiry_items ii3 JOIN inquiries i2 ON i2.id = ii3.inquiry_id WHERE ii3.product_name = ii.product_name ORDER BY ii3.rowid DESC LIMIT 1) AS last_used
      FROM inquiry_items ii
      WHERE ii.product_name IS NOT NULL AND ii.product_name <> ''
      GROUP BY ii.product_name
    ) t;
  `)
}

/** 开发/演示组织（真实接入工作台后由组织同步覆盖） */
export function ensurePeople(): void {
  const ins = db.prepare('INSERT OR IGNORE INTO people (id, name, department, team_name, role) VALUES (?, ?, ?, ?, ?)')
  const seed = [
    ['sales-1', 'Joey', '销售部', '销售一组', 'sales'],
    ['sales-2', 'Vera', '销售部', '销售一组', 'sales'],
    ['sales-3', 'Yolanda', '销售部', '销售二组', 'sales'],
    ['sales-4', 'Jerric', '销售部', '销售二组', 'sales'],
    ['sales-5', 'Loria', '销售部', '销售三组', 'sales'],
    ['pur-1', 'Rita', '采购部', '采购组', 'support'],
    ['pur-2', 'Sunny', '销售支持组', '采购组', 'support'],
  ]
  seed.forEach((x) => ins.run(x[0], x[1], x[2], x[3], x[4]))
}


/* ===== 币种（可增删改）与其折算汇率 =====
 * rate 语义：1 USD = rate 个该币种（与前台 fx 一致，USD 固定为基准 1） */
export const DEFAULT_CURRENCIES: { code: string; rate: number }[] = [
  { code: 'USD', rate: 1 },
  { code: 'CNY', rate: 7.12 },
  { code: 'EUR', rate: 0.92 },
]

export function getCurrencies(): { code: string; rate: number }[] {
  try {
    const arr = JSON.parse(getSetting('currencies', ''))
    if (Array.isArray(arr) && arr.length) {
      const list = arr
        .map((x) => ({ code: text((x as { code?: unknown }).code).trim().toUpperCase(), rate: Number((x as { rate?: unknown }).rate) }))
        .filter((x) => x.code && Number.isFinite(x.rate) && x.rate > 0)
      if (list.length) {
        // USD 永远是基准（rate = 1），保证折算口径稳定
        const usd = list.find((x) => x.code === 'USD')
        if (usd) usd.rate = 1
        else list.unshift({ code: 'USD', rate: 1 })
        return list
      }
    }
  } catch { /* 用默认值 */ }
  return DEFAULT_CURRENCIES.map((x) => ({ ...x }))
}

export function saveCurrencies(list: { code: string; rate: number }[]): void {
  const clean = list
    .map((x) => ({ code: text(x.code).trim().toUpperCase().slice(0, 10), rate: Number(x.rate) }))
    .filter((x) => x.code && Number.isFinite(x.rate) && x.rate > 0 && x.rate <= 1e6)
    .slice(0, 30)
  const usd = clean.find((x) => x.code === 'USD')
  if (usd) usd.rate = 1
  else clean.unshift({ code: 'USD', rate: 1 })
  setSetting('currencies', JSON.stringify(clean))
}

/** 币种代码列表（顺序即前台下拉顺序） */
export function currencyCodes(): string[] {
  return getCurrencies().map((x) => x.code)
}
/** 1 USD = ? 该币种；未知币种按 1:1 处理，避免折算成 0 */
export function fxRates(): Record<string, number> {
  const m: Record<string, number> = {}
  getCurrencies().forEach((x) => { m[x.code] = x.rate })
  return m
}
export function fxRateOf(code: string): number {
  const r = fxRates()[text(code).trim().toUpperCase()]
  return r && r > 0 ? r : 1
}
/** 币种改名：历史数据里的旧代码一起迁移，避免记录里留下字典外的币种 */
export function renameCurrencyInData(oldCode: string, newCode: string): void {
  const d = getDb()
  const o = text(oldCode).trim().toUpperCase(); const n = text(newCode).trim().toUpperCase()
  if (!o || !n || o === n) return
  d.prepare('UPDATE inquiry_items SET currency = ? WHERE currency = ?').run(n, o)
  d.prepare('UPDATE inquiries SET fee_currency = ? WHERE fee_currency = ?').run(n, o)
  d.prepare('UPDATE products SET currency = ? WHERE currency = ?').run(n, o)
  d.prepare('UPDATE orders SET currency = ? WHERE currency = ?').run(n, o)
  d.prepare('UPDATE product_prices SET currency = ? WHERE currency = ?').run(n, o)
  d.prepare('UPDATE product_prices SET prev_currency = ? WHERE prev_currency = ?').run(n, o)
}
/** 某币种被多少条数据使用（删除前提示用） */
export function currencyUsage(code: string): number {
  const d = getDb()
  const c = text(code).trim().toUpperCase()
  const q = (sql: string) => (d.prepare(sql).get(c) as { n: number }).n
  return q('SELECT COUNT(*) AS n FROM inquiry_items WHERE currency = ?')
    + q('SELECT COUNT(*) AS n FROM inquiries WHERE fee_currency = ?')
    + q('SELECT COUNT(*) AS n FROM products WHERE currency = ?')
    + q('SELECT COUNT(*) AS n FROM orders WHERE currency = ?')
    + q('SELECT COUNT(*) AS n FROM product_prices WHERE currency = ?')
}
