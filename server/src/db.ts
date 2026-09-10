/** 数据层：SQLite（WAL）。v3 起步：询报价录入最小闭环 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
mkdirSync(path.resolve(__dirname, '../data'), { recursive: true })
export const DB_FILE = process.env.DB_PATH ?? path.resolve(__dirname, '../data/sales-analytics.db')
const db = new Database(DB_FILE)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

export const nowIso = () => new Date().toISOString()
export const todayStr = () => nowIso().slice(0, 10)
export const newId = () => randomUUID()
export const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }
export const text = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : '')

export function schema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT, use_location TEXT, source TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(name COLLATE NOCASE));
    CREATE TABLE IF NOT EXISTS inquiries (
      id TEXT PRIMARY KEY, inquiry_no TEXT UNIQUE NOT NULL, date TEXT NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id), country TEXT, use_location TEXT,
      sales TEXT, purchaser TEXT, source TEXT, hand_total REAL, note TEXT,
      is_key_customer INTEGER NOT NULL DEFAULT 0, is_key_project INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inquiry_items (
      id TEXT PRIMARY KEY, inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
      product_name TEXT NOT NULL, qty REAL, amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
      sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, department TEXT, team_name TEXT,
      role TEXT NOT NULL DEFAULT 'sales', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `)
  // 老库补列（幂等）
  try { db.exec('ALTER TABLE inquiries ADD COLUMN use_location TEXT') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN is_key_customer INTEGER NOT NULL DEFAULT 0') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE inquiries ADD COLUMN is_key_project INTEGER NOT NULL DEFAULT 0') } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE customers ADD COLUMN use_location TEXT') } catch { /* 已存在 */ }
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
export function saveSources(list: string[]): void {
  setSetting('inquirySources', JSON.stringify(list.filter((x) => text(x)).slice(0, 200)))
}

/** 常用国别（前端可下拉，也可自由输入新值） */
export function getCountries(): string[] {
  try { const arr = JSON.parse(getSetting('countries', '')); if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string' && x.trim()) } catch { /* */ }
  return ['中国', '美国', '加拿大', '阿联酋', '沙特', '科威特', '印尼', '马来西亚', '俄罗斯', '哈萨克斯坦', '英国', '德国', '巴西', '墨西哥', '其他']
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
