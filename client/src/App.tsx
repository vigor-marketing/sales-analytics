import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get, post } from './api'
import { COUNTRIES } from './countries'
import { ArticleIcon, CartIcon, ChartBarIcon, ChartColumnIcon, ChatBubbleHistoryIcon, EditIcon, SettingIcon, UserIcon } from 'tdesign-icons-react'
import CustomerArchive from './CustomerArchive'
import ProductArchive from './ProductArchive'
import Contracts from './Contracts'
import ContractsAnalysis from './ContractsAnalysis'
import FollowUps from './FollowUps'
import InquiryManager from './InquiryManager'
import SettingsView from './SettingsView'

interface ItemD { productName: string; qty: string; amount: string; currency: string }
const emptyRow = (): ItemD => ({ productName: '', qty: '', amount: '', currency: 'USD' })
const CURRENCIES = ['USD', 'CNY', 'EUR']
const money = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })

interface Bootstrap { sales: { name: string; team: string }[]; purchasers: string[]; sources: string[]; methods?: string[]; lostReasons?: string[]; countries: string[]; fx: Record<string, number>; month: string }
interface Saved { id: string; inquiryNo: string }
const DEFAULTS: Bootstrap = {
  sales: [['Joey', '销售一组'], ['Vera', '销售一组'], ['Yolanda', '销售二组'], ['Jerric', '销售二组'], ['Loria', '销售三组']].map(([name, team]) => ({ name, team })),
  purchasers: ['Rita', 'Sunny'],
  sources: ['展会', '官网', '转介绍', '老客户复购', '平台询盘', '邮件直询', '其他'],
  methods: ['电话', '邮件', '微信', '拜访', '展会', '其他'],
  lostReasons: ['价格无优势', '交期太长', '技术方案不满足', '客户选择竞品', '客户预算取消', '项目暂停/延期', '联系不上客户', '其他'],
  countries: ['中国', '美国', '加拿大', '阿联酋', '沙特', '印尼', '马来西亚', '俄罗斯', '英国', '德国', '其他'],
  fx: { USD: 1, CNY: 7.12, EUR: 0.92 },
  month: new Date().toISOString().slice(0, 7),
}

type PageKey = 'entry' | 'manage' | 'followups' | 'contracts' | 'contractsAnalysis' | 'customers' | 'products' | 'settings'
const NAV: { key: PageKey; label: string; icon: JSX.Element }[] = [
  { key: 'entry', label: '询报价录入', icon: <EditIcon /> },
  { key: 'manage', label: '询报价管理', icon: <ArticleIcon /> },
  { key: 'followups', label: '询报价跟进', icon: <ChatBubbleHistoryIcon /> },
  { key: 'contracts', label: '销售订单管理', icon: <ChartBarIcon /> },
  { key: 'contractsAnalysis', label: '销售订单分析', icon: <ChartColumnIcon /> },
  { key: 'customers', label: '客户档案', icon: <UserIcon /> },
  { key: 'products', label: '产品档案', icon: <CartIcon /> },
  { key: 'settings', label: '字段与选项设置', icon: <SettingIcon /> },
]
const PAGES: PageKey[] = ['entry', 'manage', 'followups', 'contracts', 'contractsAnalysis', 'customers', 'products', 'settings']
/** 记忆当前页面：优先 URL hash，其次 localStorage，刷新后保持 */
function initialPage(): PageKey {
  const fromHash = location.hash.replace(/^#\/?/, '')
  if (PAGES.includes(fromHash as PageKey)) return fromHash as PageKey
  const saved = localStorage.getItem('sa:page') ?? ''
  if (PAGES.includes(saved as PageKey)) return saved as PageKey
  return 'entry'
}
const TITLES: Record<PageKey, string> = { entry: '询报价录入', manage: '询报价管理', followups: '询报价跟进', contracts: '销售订单管理', contractsAnalysis: '销售订单分析', customers: '客户档案', products: '产品档案', settings: '字段与选项设置' }
function Shell({ page, onNav, children }: { page: PageKey; onNav: (p: PageKey) => void; children: React.ReactNode }) {
  return (
    <div className="sa-layout">
      <aside className="sa-sider">
        <div className="sa-brand">
          <div className="sa-logo">销</div>
          <div className="sa-brand-text">
            <b>销售数据分析</b>
            <i>Sales Analytics</i>
          </div>
        </div>
        <nav className="sa-menu">
          {NAV.map((n) => (
            <button key={n.key} className={`sa-item${page === n.key ? ' on' : ''}`} onClick={() => onNav(n.key)}>
              <span className="sa-ic">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sa-foot">v{__BUILD_ID__}</div>
      </aside>
      <main className="sa-main">
        <div className="sa-page-head">
          <h1>{TITLES[page]}</h1>
          <span className="badge new" title="页面构建版本">v{__BUILD_ID__}</span>
        </div>
        {children}
      </main>
    </div>
  )
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
  const [blockers, setBlockers] = useState('')
  const [actionPlan, setActionPlan] = useState('')
  const [supportNeeded, setSupportNeeded] = useState('')
  const [keyCust, setKeyCust] = useState<'' | '1' | '0'>('')
  const [keyProj, setKeyProj] = useState<'' | '1' | '0'>('')
  const [stars, setStars] = useState<'' | '1' | '2' | '3' | '4' | '5'>('')
  const [prodOpen, setProdOpen] = useState<number | null>(null)
  const [prodFilter, setProdFilter] = useState('')
  const [products, setProducts] = useState<{ id: string; name: string; currency: string; last_amount: number | null; use_count: number }[]>([])
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [cusList, setCusList] = useState<{ id: string; name: string; country: string | null; use_location: string | null }[]>([])
  const [custId, setCustId] = useState('')
  const [cusFocus, setCusFocus] = useState(false)
  const [page, setPage] = useState<PageKey>(() => initialPage())
  const noT = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.prod-pick')) setProdOpen(null) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  // 浏览器页签标题跟随当前页面
  useEffect(() => { document.title = `${TITLES[page]} · 销售数据分析` }, [page])
  // 页面变化 → 写入 hash 与本地记忆（刷新后回到同一页，可分享链接）
  useEffect(() => {
    localStorage.setItem('sa:page', page)
    if (location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`)
  }, [page])
  // 支持浏览器前进/后退与手动改 hash
  useEffect(() => {
    const onHash = () => { const h = location.hash.replace(/^#\/?/, ''); if (PAGES.includes(h as PageKey) && h !== page) setPage(h as PageKey) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [page])

  useEffect(() => { get<Bootstrap>('/meta/bootstrap').then(setMeta).catch(() => { /* 使用内置默认，保存时会再报后端错误 */ }) }, [])
  useEffect(() => { get<{ id: string; name: string; currency: string; last_amount: number | null; use_count: number }[]>('/products').then(setProducts).catch(() => { /* */ }) }, [])
  const checkNo = useCallback((v: string) => {
    if (!v.trim()) { setNoTaken(false); return }
    get<{ exists: boolean }>(`/inquiries/exists?no=${encodeURIComponent(v.trim())}`).then((r) => setNoTaken(r.exists)).catch(() => { /* */ })
  }, [])
  useEffect(() => {
    if (!sales) { setCusList([]); setCustId(''); return }
    get<{ id: string; name: string; country: string | null; use_location: string | null }[]>(`/customers?sales=${encodeURIComponent(sales)}`)
      .then((list) => { setCusList(list); setCustId(''); setCustomer('') })
      .catch(() => { /* */ })
  }, [sales])
  const selectCust = (id: string) => {
    if (id === '__new__') { setCustId('__new__'); setCustomer(''); setCountry(''); setUseLoc(''); setLocTouched(false); return }
    if (!id) { setCustId(''); setCustomer(''); return }
    const c = cusList.find((x) => x.id === id)
    if (!c) return
    setCustId(id); setCustomer(c.name); setCountry(c.country || '')
    setUseLoc(c.use_location || c.country || ''); setLocTouched(false)
  }
  const onCustomerChange = (v: string) => { setCustomer(v) }

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

  const valid = Boolean(no.trim() && !noTaken && date && ((custId && custId !== '__new__') || customer.trim()) && sales && purchaser && source && stars !== '' && keyCust !== '' && keyProj !== '') && items.some((it) => it.productName.trim() && (Number(it.amount) || 0) > 0)

  const save = async (again: boolean) => {
    setMsg(null)
    if (!no.trim() || noTaken) { setMsg({ t: 'err', text: noTaken ? `询价号 ${no} 已被占用` : '请填写询价号（手动必填，全库唯一）' }); noT.current?.focus(); return }
    if (!sales) return setMsg({ t: 'err', text: '请先选择销售人员，再选择该销售名下的客户' })
    if (custId === '__new__' ? !customer.trim() : !custId) return setMsg({ t: 'err', text: '请选择客户档案中的客户，或选择“＋ 新客户”并填写名称' })
    if (!purchaser) return setMsg({ t: 'err', text: '请选择采购人员' })
    if (!source) return setMsg({ t: 'err', text: '请选择询价来源（可在来源设置中维护）' })
    if (stars === '') return setMsg({ t: 'err', text: '请选择客户星级（1-5 星，基本信息必填）' })
    if (keyCust === '') return setMsg({ t: 'err', text: '请选择是否为重点客户（基本信息必填）' })
    if (keyProj === '') return setMsg({ t: 'err', text: '请选择是否为重点项目（询价明细必填）' })
    if (!items.some((it) => it.productName.trim() && Number(it.amount) > 0)) return setMsg({ t: 'err', text: '至少一行询价明细：填写产品名称且金额>0' })
    setBusy(true)
    try {
      const isNew = custId === '__new__'
      const res = await post<Saved>('/inquiries', {
        inquiryNo: no.trim(), date, customerName: customer.trim(), country: country.trim() || undefined, clientId: custId && custId !== '__new__' ? custId : undefined,
        // 新客户：服务端按 newClient 建档（与 customerName 内容一致，兼容两种契约）
        newClient: isNew ? { name: customer.trim(), country: country.trim() || undefined, useLocation: useLoc.trim() || country.trim() || undefined } : undefined,
        items: items.filter((it) => it.productName.trim() && Number(it.amount) > 0).map((it) => ({ productName: it.productName.trim(), qty: it.qty ? Number(it.qty) : undefined, amount: Number(it.amount), currency: it.currency })),
        sales, purchaser, source, totalAmount: handTotal ? Number(handTotal) : undefined, note: note.trim() || undefined,
        useLocation: useLoc.trim() || undefined, isKeyCustomer: keyCust === '1', isKeyProject: keyProj === '1',
        blockers: blockers.trim() || undefined, actionPlan: actionPlan.trim() || undefined, supportNeeded: supportNeeded.trim() || undefined, customerStars: stars ? Number(stars) : undefined,
      })
      setMsg({ t: 'ok', text: `已保存询价 ${res.inquiryNo}` })
      if (again) {
        setNo(''); setNoTaken(false); setItems([emptyRow()]); setHandTotal(''); setNote(''); setBlockers(''); setActionPlan(''); setSupportNeeded(''); setStars(''); setKeyCust(''); setKeyProj(''); setCustId(''); setCustomer(''); noT.current?.focus()
      } else { setNo(''); setNoTaken(false); setItems([emptyRow()]); setHandTotal(''); setNote(''); setBlockers(''); setActionPlan(''); setSupportNeeded(''); setStars(''); setKeyCust(''); setKeyProj(''); setCustId(''); setCustomer(''); setCountry(''); setUseLoc(''); setLocTouched(false); setSource('') }
    } catch (e) { setMsg({ t: 'err', text: (e as Error).message }) } finally { setBusy(false) }
  }

  if (page !== 'entry') return (
    <Shell page={page} onNav={setPage}>
      {page === 'manage' && <InquiryManager meta={meta} />}
      {page === 'followups' && <FollowUps meta={meta} />}
      {page === 'contracts' && <Contracts meta={meta} />}
      {page === 'contractsAnalysis' && <ContractsAnalysis meta={meta} />}
      {page === 'customers' && <CustomerArchive />}
      {page === 'products' && <ProductArchive />}
      {page === 'settings' && <SettingsView />}
    </Shell>
  )
  return (
    <Shell page={page} onNav={setPage}>
      {msg && <div className={`msg ${msg.t}`} role="status">{msg.t === 'ok' ? '✔' : '✖'} {msg.text}</div>}

      {/* 基本信息（含归属与来源） */}
      <div className="card">
        <h3 className="sec-title">基本信息 <small>必填：询价号 / 日期 / 销售人员 / 客户 / 采购人员 / 询价来源 / 重点客户</small></h3>
        <div className="row" style={{ alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)' }}>状态</span>
          <span className="badge">跟进中</span>
          <span className="hint">新录入的询价自动为「跟进中」；生成销售订单后自动变「已成单」，客户丢单时在「询报价管理 → 编辑」里标记「未成单」并填写原因</span>
        </div>
        <div className="row">
          <div className="col w2"><label>询价号 *</label><input ref={noT} className="sa" value={no} onChange={(e) => { setNo(e.target.value); checkNo(e.target.value) }} onBlur={() => checkNo(no)} placeholder="手动录入，全库唯一" /></div>
          <div className="col w1"><label>日期 *</label><input className="sa" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="col w2"><label>销售人员 *</label>
            <select className="sa" style={{ width: 200 }} value={sales} onChange={(e) => setSales(e.target.value)}>
              <option value="">— 请选择 —</option>
              {salesTeams.map(([team, list]) => (
                <optgroup key={team} label={team}>{list.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}</optgroup>
              ))}
            </select>
          </div>
          <div className="col w2"><label>采购人员 *</label>
            <select className="sa" style={{ width: 200 }} value={purchaser} onChange={(e) => setPurchaser(e.target.value)}>
              <option value="">— 请选择 —</option>
              {(meta?.purchasers ?? DEFAULTS.purchasers).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="col w2"><label>询价来源 *</label>
            <select className="sa" style={{ width: 200 }} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">— 请选择 —</option>
              {(meta?.sources ?? DEFAULTS.sources).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
        </div>
        {noTaken && <div className="hint" style={{ color: 'var(--danger)' }}>该询价号已被占用，请换一个</div>}

        <div className="row" style={{ marginTop: 6 }}>
          <div className="col grow1">
            <label>客户 * <span className="hint">（先选销售人员，再从该销售的客户档案中选择）</span></label>
            <select className="sa" style={{ width: '100%' }} value={custId} disabled={!sales} onChange={(e) => selectCust(e.target.value)}>
              <option value="">{sales ? '— 请选择客户 —' : '— 请先选择销售人员 —'}</option>
              {cusList.map((c) => <option key={c.id} value={c.id}>{c.name}{c.country ? `（${c.country}）` : ''}</option>)}
              <option value="__new__">＋ 新客户（输入新名称，保存即建档）</option>
            </select>
            {sales && cusList.length === 0 && <span className="hint">该销售名下暂无客户档案，可“＋ 新客户”新建，下次即可直接调用</span>}
          </div>
        </div>

        {custId === '__new__' && (
          <div className="row" style={{ marginTop: 6 }}>
            <div className="col grow1"><label>新客户名称 *</label><input className="sa" style={{ width: '100%' }} value={customer} onChange={(e) => onCustomerChange(e.target.value)} placeholder="输入客户名称" /></div>
            <div className="col" style={{ flex: 1 }}>
              <label>国别</label>
              <CountryPicker value={country} onChange={(v) => { setCountry(v); if (!locTouched) setUseLoc(v) }} placeholder="输入/选择国别" />
            </div>
            <div className="col" style={{ flex: 1 }}>
              <label>使用地 <span className="hint">（默认同国别）</span></label>
              <input className="sa" style={{ width: '100%' }} value={useLoc} onChange={(e) => { setUseLoc(e.target.value); setLocTouched(true) }} placeholder={country || '输入使用地'} />
            </div>
          </div>
        )}
        {custId && custId !== '__new__' && (
          <div className="hint" style={{ marginTop: 6 }}>已选客户档案：<b>{customer}</b>{country ? ` · 国别 ${country}` : ''}{useLoc ? ` · 使用地 ${useLoc}` : ''}</div>
        )}

        <div className="row" style={{ alignItems: 'center', gap: 10, marginTop: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)' }}>客户星级 *</span>
          <select className="sa" style={{ width: 170 }} value={stars} title={stars ? `${stars} 星` : ''} onChange={(e) => setStars(e.target.value as '' | '1' | '2' | '3' | '4' | '5')}>
            <option value="">— 请选择 —</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{`${n} 星 `}{'★'.repeat(n)}</option>)}
          </select>
          <span className="hint">必选；1–5 星代表客户重要度/合作价值</span>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 18 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)' }}>重点客户 *</span>
          <label className="chk"><input type="radio" name="kc" checked={keyCust === '1'} onChange={() => setKeyCust('1')} /> <span className="tag kc">是</span></label>
          <label className="chk"><input type="radio" name="kc" checked={keyCust === '0'} onChange={() => setKeyCust('0')} /> 否</label>
          <span className="hint">必选；选“是”将在列表与详情以琥珀色块标注「重点客户」</span>
        </div>
      </div>

      {/* 询价明细 */}
      <div className="card">
        <h3 className="sec-title">询价明细 <small>可添加多个产品；总报价金额自动合计</small></h3>
        <div className="row" style={{ alignItems: 'center', gap: 18, marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)' }}>重点项目 *</span>
          <label className="chk"><input type="radio" name="kp" checked={keyProj === '1'} onChange={() => setKeyProj('1')} /> <span className="tag kp">是</span></label>
          <label className="chk"><input type="radio" name="kp" checked={keyProj === '0'} onChange={() => setKeyProj('0')} /> 否</label>
          <span className="hint">必选；选“是”将在列表与详情以蓝色块标注「重点项目」</span>
        </div>
        {items.map((it, i) => (
          <div key={i} className="item-row">
            <div className="col w-idx"><label>序号</label><div className="idx-cell">{i + 1}</div></div>
            <div className="col grow1">
              <label>产品名称 <span className="hint">（可手输；点右侧按钮从产品档案选择）</span></label>
              <div className="prod-pick" style={{ display: 'flex', gap: 6 }}>
                <input className="sa" style={{ width: '100%' }} value={it.productName} placeholder="如：可溶桥塞"
                  title={(() => { const h = products.find((pp) => pp.name.toLowerCase() === it.productName.trim().toLowerCase()); return h ? `档案：参考金额 ${h.last_amount == null ? '—' : Number(h.last_amount).toLocaleString()} ${h.currency} · 已用 ${h.use_count} 次` : '' })()}
                  onChange={(e) => {
                    const v = e.target.value
                    const hit = products.find((pp) => pp.name.toLowerCase() === v.trim().toLowerCase())
                    setItems((a) => a.map((x, j) => j === i ? { ...x, productName: v, currency: hit ? hit.currency : x.currency } : x))
                  }} />
                <button type="button" className="btn sm" style={{ flexShrink: 0 }} title="从产品档案选择"
                  onClick={() => { setProdOpen(prodOpen === i ? null : i); setProdFilter('') }}>选择 ▾</button>
                {prodOpen === i && (
                  <div className="prod-panel">
                    <input className="sa" style={{ width: '100%', marginBottom: 6 }} autoFocus value={prodFilter} placeholder="筛选产品…" onChange={(e) => setProdFilter(e.target.value)} />
                    {products.filter((pp) => !prodFilter.trim() || pp.name.toLowerCase().includes(prodFilter.trim().toLowerCase())).map((pp) => (
                      <div key={pp.id} className="prod-item" onClick={() => {
                        setItems((a) => a.map((x, j) => j === i ? { ...x, productName: pp.name, currency: pp.currency } : x))
                        setProdOpen(null)
                      }}>
                        <b>{pp.name}</b>
                        <span className="hint" style={{ marginLeft: 8 }}>{pp.last_amount == null ? '—' : Number(pp.last_amount).toLocaleString()} {pp.currency} · 已用 {pp.use_count} 次</span>
                      </div>
                    ))}
                    {products.length === 0 && <div className="hint" style={{ padding: 8 }}>产品档案为空（录入后自动生成）</div>}
                  </div>
                )}
              </div>
            </div>
            <div className="col w1"><label>数量</label><input className="sa" type="number" min="0" value={it.qty} onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} /></div>
            <div className="col w1"><label>金额 *</label><input className="sa" type="number" min="0" value={it.amount} onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} /></div>
            <div className="col w1"><label>币种</label>
              <select className="sa" value={it.currency} onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, currency: e.target.value } : x))}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
            <span className="row-act">
              {items.length > 1 && (
                <button className="icon-del" title="删除该行" aria-label={`删除第 ${i + 1} 行`} onClick={() => setItems((a) => a.filter((_, j) => j !== i))}>×</button>
              )}
            </span>
          </div>
        ))}
        <button className="add-row" onClick={() => setItems((a) => [...a, emptyRow()])}>
          <span className="plus">＋</span> 添加产品
        </button>

        <div style={{ marginTop: 14, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
          <div className="totals">
            <span className="badge new">总报价金额（自动）：</span>
            {quoteByCur.map(([c, v]) => <span key={c} className="t">{money(v)} {c}</span>)}
            {quoteByCur.some(([c]) => c !== 'USD') && <span className="badge">折 USD 约 {money(Math.round(usdApprox))}</span>}
            {quoteByCur.length === 0 && <span className="hint">填一行金额后自动合计</span>}
          </div>
          <div className="row" style={{ marginBottom: 0 }}>
            <div className="col w2"><label>总金额（手填 · 选填）</label><input className="sa" type="number" min="0" value={handTotal} onChange={(e) => setHandTotal(e.target.value)} placeholder="议价/最终金额" /></div>
          </div>
          <div className="hint" style={{ display: 'block', marginTop: 4 }}>总报价金额=各行金额自动合计（只读）；总金额可另行手填最终/成交金额，与报价一致可留空。</div>
        </div>

        <div style={{ marginTop: 12, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
          <div className="grid-eq3">
            <div className="col box-fixed"><label>卡点/问题</label><textarea className="sa" rows={3} style={{ fieldSizing: 'content' } as React.CSSProperties} value={blockers} onChange={(e) => setBlockers(e.target.value)} placeholder="如：价格、交期、技术规格、竞品占位…" /></div>
            <div className="col box-fixed"><label>行动计划</label><textarea className="sa" rows={3} style={{ fieldSizing: 'content' } as React.CSSProperties} value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} placeholder="下一步打算怎么做" /></div>
            <div className="col box-fixed"><label>需要的支持</label><textarea className="sa" rows={3} style={{ fieldSizing: 'content' } as React.CSSProperties} value={supportNeeded} onChange={(e) => setSupportNeeded(e.target.value)} placeholder="如：报价支持 / 技术选型 / 领导出面 / 样品寄送 / 资质文件" /></div>
          </div>
          <div className="grid-1" style={{ marginTop: 10 }}>
            <div className="col box-fixed"><label>备注</label><textarea className="sa" rows={3} style={{ fieldSizing: 'content' } as React.CSSProperties} value={note} onChange={(e) => setNote(e.target.value)} placeholder="客户要求、交期等补充说明（选填）" /></div>
          </div>
        </div>

        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn pri" disabled={busy || !valid} onClick={() => void save(false)}>保存询价{busy ? '…' : ''}</button>
          <button className="btn" disabled={busy || !valid} onClick={() => void save(true)}>保存并继续录下一条</button>
          {!valid && <span className="hint">请补齐必填项（询价号唯一 / 销售 / 客户 / 采购 / 来源 / 重点客户 / 重点项目 / ≥1行明细金额大于0）</span>}
        </div>
      </div>
    </Shell>
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
