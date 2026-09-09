import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get, post } from './api'
import { COUNTRIES } from './countries'

interface ItemD { productName: string; qty: string; amount: string; currency: string }
const emptyRow = (): ItemD => ({ productName: '', qty: '', amount: '', currency: 'USD' })
const CURRENCIES = ['USD', 'CNY', 'EUR']
const money = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })

interface Bootstrap { sales: { name: string; team: string }[]; purchasers: string[]; sources: string[]; countries: string[]; fx: Record<string, number>; month: string }
interface Saved { id: string; inquiryNo: string }
const DEFAULTS: Bootstrap = {
  sales: [['Joey', '销售一组'], ['Vera', '销售一组'], ['Yolanda', '销售二组'], ['Jerric', '销售二组'], ['Loria', '销售三组']].map(([name, team]) => ({ name, team })),
  purchasers: ['Rita', 'Sunny'],
  sources: ['展会', '官网', '转介绍', '老客户复购', '平台询盘', '邮件直询', '其他'],
  countries: ['中国', '美国', '加拿大', '阿联酋', '沙特', '印尼', '马来西亚', '俄罗斯', '英国', '德国', '其他'],
  fx: { USD: 1, CNY: 7.12, EUR: 0.92 },
  month: new Date().toISOString().slice(0, 7),
}

export default function App() {
  const [meta, setMeta] = useState<Bootstrap>(DEFAULTS)
  const [no, setNo] = useState('')
  const [noTaken, setNoTaken] = useState(false)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [customer, setCustomer] = useState('')
  const [country, setCountry] = useState('')
  const [useLoc, setUseLoc] = useState('')
  const [locTouched, setLocTouched] = useState(false)
  const [items, setItems] = useState<ItemD[]>([emptyRow()])
  const [handTotal, setHandTotal] = useState('')
  const [sales, setSales] = useState('')
  const [purchaser, setPurchaser] = useState('')
  const [source, setSource] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [cusList, setCusList] = useState<{ id: string; name: string; country: string | null }[]>([])
  const [cusFocus, setCusFocus] = useState(false)
  const [srcOpen, setSrcOpen] = useState(false)
  const noT = useRef<HTMLInputElement>(null)

  useEffect(() => { get<Bootstrap>('/meta/bootstrap').then(setMeta).catch(() => { /* 使用内置默认，保存时会再报后端错误 */ }) }, [])
  const checkNo = useCallback((v: string) => {
    if (!v.trim()) { setNoTaken(false); return }
    get<{ exists: boolean }>(`/inquiries/exists?no=${encodeURIComponent(v.trim())}`).then((r) => setNoTaken(r.exists)).catch(() => { /* */ })
  }, [])
  const onCustomerChange = (v: string) => {
    setCustomer(v)
    if (!v.trim()) { setCusList([]); return }
    get<{ id: string; name: string; country: string | null }[]>(`/customers?q=${encodeURIComponent(v.trim())}`).then((rows) => {
      setCusList(rows.filter((r) => r.name !== v.trim()))
    }).catch(() => { /* */ })
  }
  const pickCustomer = (name: string, c?: string | null) => { setCustomer(name); setCusList([]); if (c && !country) setCountry(c) }

  const quoteByCur = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach((it) => { const a = Number(it.amount) || 0; if (a > 0) m.set(it.currency, (m.get(it.currency) ?? 0) + a) })
    return Array.from(m.entries()).sort((a, b) => CURRENCIES.indexOf(a[0]) - CURRENCIES.indexOf(b[0]))
  }, [items])
  const usdApprox = useMemo(() => {
    const fx = meta?.fx ?? { USD: 1, CNY: 7.12, EUR: 0.92 }
    return quoteByCur.reduce((s, [c, v]) => s + v / (fx[c] || 1), 0)
  }, [quoteByCur, meta])

  const salesTeams = useMemo(() => {
    const map = new Map<string, { name: string; team: string }[]>()
    ;(meta?.sales ?? []).forEach((s) => { const k = s.team || '未分组'; if (!map.has(k)) map.set(k, []); map.get(k)!.push(s) })
    return Array.from(map.entries())
  }, [meta])

  const valid = Boolean(no.trim() && !noTaken && date && customer.trim() && sales && purchaser && source) && items.some((it) => it.productName.trim() && (Number(it.amount) || 0) > 0)

  const save = async (again: boolean) => {
    setMsg(null)
    if (!no.trim() || noTaken) { setMsg({ t: 'err', text: noTaken ? `询价号 ${no} 已被占用` : '请填写询价号（手动必填，全库唯一）' }); noT.current?.focus(); return }
    if (!customer.trim()) return setMsg({ t: 'err', text: '请填写客户名称' })
    if (!sales) return setMsg({ t: 'err', text: '请选择销售人员' })
    if (!purchaser) return setMsg({ t: 'err', text: '请选择采购人员' })
    if (!source) return setMsg({ t: 'err', text: '请选择询价来源（可在来源设置中维护）' })
    if (!items.some((it) => it.productName.trim() && Number(it.amount) > 0)) return setMsg({ t: 'err', text: '至少一行产品：填写产品名称且金额>0' })
    setBusy(true)
    try {
      const res = await post<Saved>('/inquiries', {
        inquiryNo: no.trim(), date, customerName: customer.trim(), country: country.trim() || undefined,
        items: items.filter((it) => it.productName.trim() && Number(it.amount) > 0).map((it) => ({ productName: it.productName.trim(), qty: it.qty ? Number(it.qty) : undefined, amount: Number(it.amount), currency: it.currency })),
        sales, purchaser, source, totalAmount: handTotal ? Number(handTotal) : undefined, note: note.trim() || undefined,
        useLocation: useLoc.trim() || undefined,
      })
      setMsg({ t: 'ok', text: `已保存询价 ${res.inquiryNo}` })
      if (again) {
        setNo(''); setNoTaken(false); setItems([emptyRow()]); setHandTotal(''); setNote(''); noT.current?.focus()
      } else { setNo(''); setNoTaken(false); setItems([emptyRow()]); setHandTotal(''); setNote(''); setCustomer(''); setCountry(''); setUseLoc(''); setLocTouched(false); setSource('') }
    } catch (e) { setMsg({ t: 'err', text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <h1>询报价录入</h1>
        <span className="sub">询价号/日期/客户/国别手填 · 产品多行 · 来源在设置中维护 · 新客户名自动建档</span>
        <span style={{ flex: 1 }} />
        <span className="badge new" title="页面构建版本">v3-61058b3</span>
        <button className="btn sm" onClick={() => setSrcOpen(true)}>询价来源设置</button>
      </div>

      {msg && <div className={`msg ${msg.t}`} role="status">{msg.t === 'ok' ? '✔' : '✖'} {msg.text}</div>}

      {/* ① 基本信息 */}
      <div className="card">
        <h3 className="sec-title">基本信息 <small>必填：询价号 / 日期 / 客户名称</small></h3>
        <div className="row">
          <div className="col w2"><label>询价号 *</label><input ref={noT} className="sa" value={no} onChange={(e) => { setNo(e.target.value); checkNo(e.target.value) }} onBlur={() => checkNo(no)} placeholder="手动录入，全库唯一" /></div>
          <div className="col w1"><label>日期 *</label><input className="sa" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        {noTaken && <div className="hint" style={{ color: 'var(--danger)' }}>该询价号已被占用，请换一个</div>}
        <div className="row">
          <div className="col grow1" style={{ position: 'relative' }}>
            <label>客户名称 *</label>
            <input className="sa" style={{ width: '100%' }} value={customer} onChange={(e) => onCustomerChange(e.target.value)} onFocus={() => customer.trim() && onCustomerChange(customer)} onBlur={() => setTimeout(() => setCusFocus(false), 150)} placeholder="输入名称；同名自动复用档案，新名称保存即建档" />
            {cusFocus && cusList.length > 0 && (
              <ul className="sugs" style={{ position: 'absolute', zIndex: 3, width: '100%', background: '#fff' }}>
                {cusList.map((c) => <li key={c.id} onMouseDown={() => pickCustomer(c.name, c.country)}>{c.name}{c.country ? `（${c.country}）` : ''}</li>)}
              </ul>
            )}
          </div>
          <div className="col" style={{ flex: 1 }}>
            <label>国别 <span className="hint">（可输入过滤或手动输入）</span></label>
            <CountryPicker value={country} onChange={(v) => { setCountry(v); if (!locTouched) setUseLoc(v) }} placeholder="输入/选择国别" />
          </div>
          <div className="col" style={{ flex: 1 }}>
            <label>使用地 <span className="hint">（默认同国别，可修改）</span></label>
            <input className="sa" style={{ width: '100%' }} value={useLoc} onChange={(e) => { setUseLoc(e.target.value); setLocTouched(true) }} placeholder={country || '输入使用地，默认同国别'} />
          </div>
        </div>
      </div>

      {/* ② 产品明细 */}
      <div className="card">
        <h3 className="sec-title">产品明细 <small>可添加多个产品；总报价金额自动合计</small></h3>
        {items.map((it, i) => (
          <div key={i} className="item-row">
            <div className="col grow1"><label>产品名称</label><input className="sa" style={{ width: '100%' }} value={it.productName} onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, productName: e.target.value } : x))} placeholder="如：可溶桥塞" /></div>
            <div className="col w1"><label>数量</label><input className="sa" type="number" min="0" value={it.qty} onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} /></div>
            <div className="col w1"><label>金额 *</label><input className="sa" type="number" min="0" value={it.amount} onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} /></div>
            <div className="col w1"><label>币种</label>
              <select className="sa" value={it.currency} onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, currency: e.target.value } : x))}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
            {items.length > 1 && <button className="btn sm danger" onClick={() => setItems((a) => a.filter((_, j) => j !== i))}>删除</button>}
          </div>
        ))}
        <button className="btn sm" onClick={() => setItems((a) => [...a, emptyRow()])}>＋ 添加产品</button>

        <div style={{ marginTop: 14, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
          <div className="totals">
            <span className="badge new">总报价金额（自动）：</span>
            {quoteByCur.map(([c, v]) => <span key={c} className="t">{money(v)} {c}</span>)}
            {quoteByCur.some(([c]) => c !== 'USD') && <span className="badge">折 USD 约 {money(Math.round(usdApprox))}</span>}
            {quoteByCur.length === 0 && <span className="hint">填一行金额后自动合计</span>}
          </div>
          <div className="row" style={{ marginBottom: 0 }}>
            <div className="col w2"><label>总金额（手填，选填）</label><input className="sa" type="number" min="0" value={handTotal} onChange={(e) => setHandTotal(e.target.value)} placeholder="议价/最终金额，可与总报价不同" /></div>
            <span className="hint" style={{ alignSelf: 'center' }}>总报价金额=各行金额合计；此处为最终/成交金额（可不填）</span>
          </div>
        </div>
      </div>

      {/* ③ 归属与来源 */}
      <div className="card">
        <h3 className="sec-title">归属与来源 <small>人员名单自动取自工作台组织架构</small></h3>
        <div className="row">
          <div className="col w2"><label>销售人员 *</label>
            <select className="sa" style={{ width: 220 }} value={sales} onChange={(e) => setSales(e.target.value)}>
              <option value="">— 请选择 —</option>
              {salesTeams.map(([team, list]) => (
                <optgroup key={team} label={team}>{list.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</optgroup>
              ))}
            </select>
          </div>
          <div className="col w2"><label>采购人员 *</label>
            <select className="sa" style={{ width: 220 }} value={purchaser} onChange={(e) => setPurchaser(e.target.value)}>
              <option value="">— 请选择 —</option>
              {(meta?.purchasers ?? DEFAULTS.purchasers).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="col w2"><label>询价来源 *</label>
            <select className="sa" style={{ width: 220 }} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">— 请选择 —</option>
              {(meta?.sources ?? DEFAULTS.sources).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="col"><label>备注</label><textarea className="sa" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="客户要求、交期等补充说明（选填）" /></div>
        <div className="actions">
          <button className="btn pri" disabled={busy || !valid} onClick={() => void save(false)}>保存询价{busy ? '…' : ''}</button>
          <button className="btn" disabled={busy || !valid} onClick={() => void save(true)}>保存并继续录下一条</button>
          {!valid && <span className="hint">请补齐必填项（询价号唯一、客户/销售/采购/来源、≥1行产品金额大于0）</span>}
        </div>
      </div>

      {srcOpen && <SourcesModal onClose={() => setSrcOpen(false)} onSaved={() => get<Bootstrap>('/meta/bootstrap').then(setMeta).catch(() => { /* */ })} />}
    </div>
  )
}

function CountryPicker({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [focusI, setFocusI] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  const shown = q.trim()
    ? COUNTRIES.filter((c) => c.toLowerCase().includes(q.trim().toLowerCase()))
    : COUNTRIES
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); setFocusI(-1) }
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <input
        className="sa" style={{ width: '100%', minWidth: 0 }}
        value={open ? q : value}
        placeholder={placeholder || '选择/输入'}
        onFocus={() => { setOpen(true); setQ(value) }}
        onBlur={() => setTimeout(() => { const v = q.trim(); if (open && v && v !== value) onChange(v); setOpen(false) }, 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setFocusI((i) => Math.min(i + 1, shown.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusI((i) => Math.max(i - 1, -1)) }
          else if (e.key === 'Enter') { e.preventDefault(); if (focusI >= 0 && shown[focusI]) pick(shown[focusI]); else if (q.trim()) { pick(q.trim()) } setOpen(false) }
          else if (e.key === 'Escape') { setOpen(false); setQ('') }
        }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); if (!e.target.value) { onChange('') } setFocusI(-1) }}
      />
      {open && (
        <div style={{ position: 'absolute', top: 38, left: 0, right: 0, zIndex: 6 }}>
          <ul className="sugs" style={{ maxHeight: 252, overflowY: 'auto', background: '#fff' }}>
            {shown.slice(0, 100).map((c, i) => (
              <li key={c} className={focusI === i ? 'on' : ''} onMouseDown={() => pick(c)}>{c}</li>
            ))}
            {shown.length === 0 && (
              <li onMouseDown={() => q.trim() && pick(q.trim())} title="按回车使用该手动输入值">“{q}”不在清单 → 手动使用（回车确认）</li>
            )}
          </ul>
          <div className="hint" style={{ background: '#fff', padding: '3px 8px', border: '1px solid var(--line)', borderTop: 'none' }}>清单共 {COUNTRIES.length} 个国别 · 支持键盘 ↑↓ 回车选择</div>
        </div>
      )}
    </div>
  )
}
function SourcesModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [list, setList] = useState<string[]>([])
  const [newV, setNewV] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(() => get<string[]>('/sources').then(setList).catch((e) => setMsg((e as Error).message)), [])
  useEffect(() => { void load() }, [load])
  const act = async (fn: () => Promise<string[]>, okText: string) => { try { const l = await fn(); setList(l); onSaved(); setMsg(okText) } catch (e) { setMsg((e as Error).message) } }
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="询价来源设置">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>询价来源设置</h3>
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
        {msg && <div className="msg ok">{msg}</div>}
        <div style={{ margin: '10px 0' }}>
          {list.map((s, i) => (
            <div key={s} className="row" style={{ marginBottom: 6 }}>
              <span className="grow1" style={{ lineHeight: '34px' }}>{i + 1}. {s}</span>
              <button className="btn sm danger" onClick={() => void act(() => post<string[]>('/sources', { action: 'remove', value: s }), '已删除：' + s)}>删除</button>
            </div>
          ))}
          {list.length === 0 && <div className="hint">暂无来源，请添加</div>}
        </div>
        <div className="row" style={{ marginBottom: 0 }}>
          <input className="sa grow1" value={newV} onChange={(e) => setNewV(e.target.value)} placeholder="新增来源，如：客户转介绍" />
          <button className="btn pri sm" onClick={() => { const v = newV.trim(); if (!v) return; void act(() => post<string[]>('/sources', { action: 'add', value: v }), '已添加：' + v); setNewV('') }}>添加</button>
        </div>
      </div>
    </div>
  )
}
