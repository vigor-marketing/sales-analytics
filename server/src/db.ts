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
export const todayStr = () => nowIso().slice(0, 10)
export const newId = () => randomUUID()
export const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }
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
