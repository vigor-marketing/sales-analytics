import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get, post } from './api'
import { StatusChip } from './StatusChip'
import ProductPicker, { type ProductLite } from './ProductPicker'
import Dashboard from './Dashboard'
import { COUNTRIES } from './countries'
import { ArticleIcon, CartIcon, ChartBarIcon, ChartColumnIcon, ChatBubbleHistoryIcon, DashboardIcon, EditIcon, SettingIcon, UserIcon } from 'tdesign-icons-react'
import CustomerArchive from './CustomerArchive'
import ProductArchive from './ProductArchive'
import Contracts from './Contracts'
import ContractsAnalysis from './ContractsAnalysis'
import FollowUps from './FollowUps'
import InquiryManager from './InquiryManager'
import Settings from './Settings'
import Login, { SCOPE_LABEL, type SaActor } from './Login'
import { currencyOptions } from './currencies'

interface ItemD { productName: string; qty: string; amount: string; currency: string }
const emptyRow = (): ItemD => ({ productName: '', qty: '', amount: '', currency: 'USD' })
const CURRENCIES = ['USD', 'CNY', 'EUR']   // 兜底顺序；实际以后端配置的币种清单为准
const money = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })

interface Bootstrap { currencies?: string[]; sales: { name: string; team: string }[]; purchasers: string[]; purchaserTeams?: { name: string; team: string }[]; sources: string[]; methods?: string[]; lostReasons?: string[]; winReasons?: string[]; countries: string[]; fx: Record<string, number>; month: string }
interface Saved { id: string; inquiryNo: string }
const DEFAULTS: Bootstrap = {
  sales: [['Joey', '销售一组'], ['Vera', '销售一组'], ['Yolanda', '销售二组'], ['Jerric', '销售二组'], ['Loria', '销售三组']].map(([name, team]) => ({ name, team })),
  purchasers: ['Rita', 'Sunny'],
  purchaserTeams: [{ name: 'Rita', team: '采购组' }, { name: 'Sunny', team: '采购组' }],
  sources: ['展会', '官网', '转介绍', '老客户复购', '平台询盘', '邮件直询', '其他'],
  methods: ['电话', '邮件', '微信', '拜访', '展会', '其他'],
  lostReasons: ['价格无优势', '交期太长', '技术方案不满足', '客户选择竞品', '客户预算取消', '项目暂停/延期', '联系不上客户'],
  winReasons: ['价格有优势', '交期满足', '技术方案匹配', '品牌/资质认可', '客户关系', '售后服务', '老客户复购'],
  countries: ['中国', '美国', '加拿大', '阿联酋', '沙特', '印尼', '马来西亚', '俄罗斯', '英国', '德国', '其他'],
  fx: { USD: 1, CNY: 7.12, EUR: 0.92 },
  month: new Date().toISOString().slice(0, 7),
}

type PageKey = 'dashboard' | 'entry' | 'manage' | 'followups' | 'contracts' | 'contractsAnalysis' | 'customers' | 'products' | 'settings'
const NAV: { key: PageKey; label: string; icon: JSX.Element }[] = [
  { key: 'dashboard', label: '仪表盘', icon: <DashboardIcon /> },
  { key: 'entry', label: '询报价录入', icon: <EditIcon /> },
  { key: 'manage', label: '询报价管理', icon: <ArticleIcon /> },
  { key: 'followups', label: '询报价跟进', icon: <ChatBubbleHistoryIcon /> },
  { key: 'contracts', label: '销售订单管理', icon: <ChartBarIcon /> },
  { key: 'contractsAnalysis', label: '销售订单分析', icon: <ChartColumnIcon /> },
  { key: 'customers', label: '客户档案', icon: <UserIcon /> },
  { key: 'products', label: '产品档案', icon: <CartIcon /> },
  { key: 'settings', label: '设置', icon: <SettingIcon /> },
]
const PAGES: PageKey[] = ['dashboard', 'entry', 'manage', 'followups', 'contracts', 'contractsAnalysis', 'customers', 'products', 'settings']
/** 记忆当前页面：优先 URL hash，其次 localStorage，刷新后保持 */
function initialPage(): PageKey {
  const fromHash = location.hash.replace(/^#\/?/, '')
  if (PAGES.includes(fromHash as PageKey)) return fromHash as PageKey
  const saved = localStorage.getItem('sa:page') ?? ''
  if (PAGES.includes(saved as PageKey)) return saved as PageKey
  return 'entry'
}
const TITLES: Record<PageKey, string> = { dashboard: '仪表盘', entry: '询报价录入', manage: '询报价管理', followups: '询报价跟进', contracts: '销售订单管理', contractsAnalysis: '销售订单分析', customers: '客户档案', products: '产品档案', settings: '设置' }
function Shell({ page, onNav, children, headRight, actor, onLogout }: {
  page: PageKey; onNav: (p: PageKey) => void; children: React.ReactNode; headRight?: React.ReactNode
  actor?: SaActor | null; onLogout?: () => void
}) {
  const nav = actor ? NAV.filter((n) => n.key !== 'settings' || actor.scope === 'all') : NAV
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
          {nav.map((n) => (
            <button key={n.key} className={`sa-item${page === n.key ? ' on' : ''}`} onClick={() => onNav(n.key)}>
              <span className="sa-ic">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        {actor && (
          <div style={{ marginTop: 'auto', padding: '10px 12px', borderTop: '1px solid #eef0f5' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${actor.cnName ? `${actor.cnName} / ` : ''}${actor.name} · ${actor.department}${actor.team ? ` / ${actor.team}` : ''} · ${actor.roleLabel || actor.role} · ${SCOPE_LABEL[actor.scope]}`}>
              {actor.name}
              <span className="hint" style={{ marginLeft: 4 }}>{SCOPE_LABEL[actor.scope]}</span>
            </div>
            <div className="hint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${actor.department}${actor.team ? ` / ${actor.team}` : ''} · ${actor.roleLabel || actor.role}`}>
              {actor.department}{actor.team && actor.team !== actor.department ? ` / ${actor.team}` : ''}
            </div>
            <button className="btn xs" style={{ marginTop: 6 }} onClick={onLogout}>退出登录</button>
          </div>
        )}
        <div className="sa-foot">v{__BUILD_ID__}</div>
      </aside>
      <main className="sa-main">
        <div className="sa-page-head">
          <h1>{TITLES[page]}</h1>
          <span className="badge new" title="页面构建版本">v{__BUILD_ID__}</span>
          <span style={{ flex: 1 }} />
          {headRight}
        </div>
        {children}
      </main>
    </div>
  )
}
export default function App() {
  const [actor, setActor] = useState<SaActor | null>(null)
  const [authReady, setAuthReady] = useState(false)
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
  // 手填总金额的金额单位（与产品明细各自币种独立）
  const [handTotalCur, setHandTotalCur] = useState('USD')
  // 费用（运费/税费/佣金/其他）：计入总报价
  const [fees, setFees] = useState({ freight: '', tax: '', commission: '', otherFee: '' })
  const [feeCur, setFeeCur] = useState('USD')
  // 每项费用各自的币种（默认同上，可分别指定；统计时按各自汇率折算）
  const [feeCurs, setFeeCurs] = useState<{ freight: string; tax: string; commission: string; otherFee: string }>({ freight: 'USD', tax: 'USD', commission: 'USD', otherFee: 'USD' })
  // 本单实际使用的汇率：非美元时默认取「字段与选项设置 → 币种」里的汇率，可在此按实际汇率修改（同一币种所有行共用）
  const [rateOv, setRateOv] = useState<Record<string, string>>({})
  const [sales, setSales] = useState('')
  const [salesTeam, setSalesTeam] = useState('')   // 销售人员：先选小组再选人
  const [purTeam, setPurTeam] = useState('')       // 采购人员：先选小组再选人
  const [purchaser, setPurchaser] = useState('')
  const [source, setSource] = useState('')
  const [note, setNote] = useState('')
  const [blockers, setBlockers] = useState('')
  const [actionPlan, setActionPlan] = useState('')
  const [supportNeeded, setSupportNeeded] = useState('')
  const [keyCust, setKeyCust] = useState<'' | '1' | '0'>('')
  const [keyProj, setKeyProj] = useState<'' | '1' | '0'>('')
  const [stars, setStars] = useState<'' | '1' | '2' | '3' | '4' | '5'>('')
  const [products, setProducts] = useState<{ id: string; name: string; currency: string; last_amount: number | null; use_count: number }[]>([])
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [cusList, setCusList] = useState<{ id: string; name: string; country: string | null; use_location: string | null }[]>([])
  const [custId, setCustId] = useState('')
  const [cusFocus, setCusFocus] = useState(false)
  const [page, setPage] = useState<PageKey>(() => initialPage())
  // 仪表盘「去跟进」：跳到跟进页并带出该询价
  const [followTarget, setFollowTarget] = useState<{ sales: string; no: string; openForm?: boolean } | null>(null)
  // Esc 键关闭最上层弹窗（所有弹窗都用 .modal-mask，点遮罩空白处即可关闭）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const masks = document.querySelectorAll<HTMLElement>('.modal-mask')
      const last = masks[masks.length - 1]
      if (last) last.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 当前页引用：navTo 里需要读到最新页码（在 setState 更新函数里写另一个 state 会被 React 丢弃，故用 ref）
  const pageRef = useRef<PageKey>(page)
  useEffect(() => { pageRef.current = page }, [page])
  const navTo = useCallback((k: PageKey) => { setPage(k) }, [])
  const noT = useRef<HTMLInputElement>(null)
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

  // 字段字典（来源/跟进方式/丢单原因/成交原因/国别等）随页面切换与设置变更实时刷新
  const loadMeta = useCallback(() => {
    get<Bootstrap>('/meta/bootstrap').then(setMeta).catch(() => { /* 使用内置默认，保存时会再报后端错误 */ })
  }, [])
  /** 登录态：进页面先问一次会话；401 时 api.ts 会广播 sa:need-login */
  const logout = useCallback(async () => {
    try { await post('/auth/logout', {}) } catch { /* 忽略 */ }
    setActor(null)
  }, [])
  useEffect(() => {
    let alive = true
    get<{ actor: SaActor }>('/auth/session')
      .then((r) => { if (alive) { setActor(r.actor); setAuthReady(true) } })
      .catch(() => { if (alive) { setActor(null); setAuthReady(true) } })
    const onNeed = () => { setActor(null); setAuthReady(true) }
    window.addEventListener('sa:need-login', onNeed)
    return () => { alive = false; window.removeEventListener('sa:need-login', onNeed) }
  }, [])

  /** 非「全部」权限：录入页把销售固定为本人（小组跟随本人所在组） */
  useEffect(() => {
    if (!actor || actor.scope === 'all') return
    setSales(actor.name)
    const hit = (meta.sales ?? []).find((x) => x.name.toLowerCase() === actor.name.toLowerCase())
    if (hit) setSalesTeam(hit.team)
  }, [actor, meta.sales])

  useEffect(() => { loadMeta() }, [loadMeta, actor])          // 登录/退出后重新拉取基础数据（人员/小组/选项）
  useEffect(() => { loadMeta() }, [page, loadMeta, actor])
  useEffect(() => {
    const onChanged = () => loadMeta()
    window.addEventListener('sa:meta-changed', onChanged)
    return () => window.removeEventListener('sa:meta-changed', onChanged)
  }, [loadMeta])
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
    // 行小计 = 金额（单价）× 数量；数量未填/为 0 时按 1 计
    items.forEach((it) => { const a = (Number(it.amount) || 0) * (Number(it.qty) > 0 ? Number(it.qty) : 1); if (a > 0) m.set(it.currency, (m.get(it.currency) ?? 0) + a) })
    const order = currencyOptions(meta?.currencies, undefined)
    return Array.from(m.entries()).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
  }, [items])
  // 生效汇率：录入时改过的优先，否则用设置里的默认汇率
  const rateOf = useCallback((c: string) => {
    if (c === 'USD') return 1
    const ov = Number(rateOv[c]); if (ov > 0) return ov
    const dft = Number(meta?.fx?.[c]); return dft > 0 ? dft : 1
  }, [rateOv, meta])
  const usdApprox = useMemo(() => quoteByCur.reduce((s, [c, v]) => s + v / rateOf(c), 0), [quoteByCur, rateOf])
  // 各项费用：金额 + 币种 + 汇率 + 折 USD
  const feeRows = useMemo(() => ([['freight', '运费'], ['tax', '税费'], ['commission', '佣金'], ['otherFee', '其他费用']] as const).map(([k, label]) => {
    const value = Number((fees as Record<string, string>)[k]) || 0
    const currency = feeCurs[k]
    const rate = rateOf(currency)
    return { key: k, label, value, currency, rate, usd: value / rate }
  }), [fees, feeCurs, rateOf])
  const feeTotal = useMemo(() => feeRows.reduce((s, f) => s + f.value, 0), [feeRows])
  const feeUsdTotal = useMemo(() => feeRows.reduce((s, f) => s + f.usd, 0), [feeRows])
  // 总报价（含费用）：各项费用按各自币种并入对应档
  const grandByCur = useMemo(() => {
    const m = new Map<string, number>(quoteByCur)
    feeRows.forEach((f) => { if (f.value) m.set(f.currency, (m.get(f.currency) ?? 0) + f.value) })
    const order = currencyOptions(meta?.currencies, undefined)
    return Array.from(m.entries()).filter(([, v]) => v > 0).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
  }, [quoteByCur, feeRows, meta])
  const grandUsd = useMemo(() => grandByCur.reduce((s, [c, v]) => s + v / rateOf(c), 0), [grandByCur, rateOf])
  // 本单用到的非美元币种（明细或费用里出现），用于展示可修改的汇率
  const usedNonUsd = useMemo(() => {
    const set = new Set<string>()
    quoteByCur.forEach(([c, v]) => { if (c !== 'USD' && v > 0) set.add(c) })
    feeRows.forEach((f) => { if (f.currency !== 'USD' && f.value) set.add(f.currency) })
    return Array.from(set)
  }, [quoteByCur, feeRows])


  // 采购人员（含所属小组）：用于「采购小组 → 采购人员」逐级筛选
  const purchaserList = useMemo(() => {
    const list = meta?.purchaserTeams?.length
      ? meta.purchaserTeams
      : (meta?.purchasers ?? DEFAULTS.purchasers).map((n) => ({ name: n, team: '采购组' }))
    return list
  }, [meta])
  const purchaserTeamList = useMemo(() => Array.from(new Set(purchaserList.map((x) => x.team))), [purchaserList])

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
        items: items.filter((it) => it.productName.trim() && Number(it.amount) > 0).map((it) => ({ productName: it.productName.trim(), qty: Number(it.qty) > 0 ? Number(it.qty) : 1, amount: Number(it.amount), currency: it.currency })),
        sales, purchaser, source, totalAmount: handTotal ? Number(handTotal) : undefined, totalAmountCurrency: handTotal ? handTotalCur : undefined, note: note.trim() || undefined,
        freight: fees.freight ? Number(fees.freight) : undefined, tax: fees.tax ? Number(fees.tax) : undefined,
        commission: fees.commission ? Number(fees.commission) : undefined, otherFee: fees.otherFee ? Number(fees.otherFee) : undefined, feeCurrency: feeCur,
        freightCurrency: feeCurs.freight, taxCurrency: feeCurs.tax, commissionCurrency: feeCurs.commission, otherFeeCurrency: feeCurs.otherFee,
        fxRates: Object.fromEntries(Object.entries(rateOv).map(([c, v]) => [c, Number(v)]).filter(([, v]) => Number(v) > 0)),
        useLocation: useLoc.trim() || undefined, isKeyCustomer: keyCust === '1', isKeyProject: keyProj === '1',
        blockers: blockers.trim() || undefined, actionPlan: actionPlan.trim() || undefined, supportNeeded: supportNeeded.trim() || undefined, customerStars: stars ? Number(stars) : undefined,
      })
      setMsg({ t: 'ok', text: `已保存询价 ${res.inquiryNo}` })
      if (again) {
        setNo(''); setNoTaken(false); setItems([emptyRow()]); setHandTotal(''); setHandTotalCur('USD'); setFees({ freight: '', tax: '', commission: '', otherFee: '' }); setRateOv({}); setNote(''); setBlockers(''); setActionPlan(''); setSupportNeeded(''); setStars(''); setKeyCust(''); setKeyProj(''); setCustId(''); setCustomer(''); noT.current?.focus()
      } else { setNo(''); setNoTaken(false); setItems([emptyRow()]); setHandTotal(''); setHandTotalCur('USD'); setNote(''); setBlockers(''); setActionPlan(''); setSupportNeeded(''); setStars(''); setKeyCust(''); setKeyProj(''); setCustId(''); setCustomer(''); setCountry(''); setUseLoc(''); setLocTouched(false); setSource('') }
    } catch (e) { setMsg({ t: 'err', text: (e as Error).message }) } finally { setBusy(false) }
  }

  // 登录态：未登录先显示登录页
  if (!authReady) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a6b85' }}>正在校验登录状态…</div>
  if (!actor) return <Login onDone={(a) => { setActor(a); setAuthReady(true) }} />

  if (page !== 'entry') return (
    <Shell page={page} onNav={navTo} actor={actor} onLogout={logout}>
      {page === 'manage' && <InquiryManager meta={meta} onGoFollow={(t) => { setFollowTarget({ ...t, openForm: true }); navTo('followups') }} />}
      {page === 'dashboard' && <Dashboard people={meta.sales.map((x) => x.name)} onGoFollow={(t) => { setFollowTarget(t); navTo('followups') }} />}
      {page === 'followups' && (
        <FollowUps meta={meta} target={followTarget} />
      )}
      {page === 'contracts' && <Contracts meta={meta} />}
      {page === 'contractsAnalysis' && <ContractsAnalysis meta={meta} />}
      {page === 'customers' && <CustomerArchive />}
      {page === 'products' && <ProductArchive />}
      {page === 'settings' && <Settings />}
    </Shell>
  )
  return (
    <Shell page={page} onNav={navTo} actor={actor} onLogout={logout}>
      {msg && <div className={`msg ${msg.t}`} role="status">{msg.t === 'ok' ? '✔' : '✖'} {msg.text}</div>}

      {/* 基本信息（含归属与来源） */}
      <div className="card">
        <h3 className="sec-title">基本信息 <small>必填：询价号 / 日期 / 销售人员 / 客户 / 采购人员 / 询价来源 / 重点客户</small></h3>
        <div className="row" style={{ alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)' }}>状态</span>
          <StatusChip status="following" />
          <span className="hint">新录入的询价自动为「跟进中」；生成销售订单后自动变「已成单」，客户丢单时在「询报价管理 → 编辑」里标记「未成单」并填写原因</span>
          {actor && actor.scope !== 'all' && (
            <span className="badge" title="按工作台岗位自动判定：销售经理看本组、销售员只看自己">你的范围：{SCOPE_LABEL[actor.scope]}（录入自动归属 {actor.name}，销售已锁定）</span>
          )}
        </div>
        <div className="row">
          <div className="col w2"><label>询价号 *</label><input ref={noT} className="sa" value={no} onChange={(e) => { setNo(e.target.value); checkNo(e.target.value) }} onBlur={() => checkNo(no)} placeholder="手动录入，全库唯一" /></div>
          <div className="col w1"><label>日期 *</label><input className="sa" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="col w1"><label>销售小组 <span className="hint">（先选组）</span></label>
            <select className="sa" style={{ width: 140 }} value={salesTeam} disabled={!!actor && actor.scope !== 'all'}
              title={actor && actor.scope !== 'all' ? '你的数据范围不含他人，销售固定为本人' : undefined}
              onChange={(e) => { const v = e.target.value; setSalesTeam(v); if (sales && !(salesTeams.find(([t]) => t === v)?.[1] ?? []).some((x) => x.name === sales)) setSales('') }}>
              <option value="">全部小组</option>
              {salesTeams.map(([team]) => <option key={team} value={team}>{team}</option>)}
            </select>
          </div>
          <div className="col w2"><label>销售人员 *</label>
            <select className="sa" style={{ width: 180 }} value={sales} disabled={!!actor && actor.scope !== 'all'}
              title={actor && actor.scope !== 'all' ? '只能录入自己名下的询价' : undefined}
              onChange={(e) => setSales(e.target.value)}>
              <option value="">{salesTeam ? `— 请选择${salesTeam}成员 —` : '— 请选择 —'}</option>
              {salesTeams.filter(([team]) => !salesTeam || team === salesTeam).map(([team, list]) => (
                <optgroup key={team} label={team}>{list.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}</optgroup>
              ))}
            </select>
          </div>
          <div className="col w1"><label>采购小组 <span className="hint">（先选组）</span></label>
            <select className="sa" style={{ width: 140 }} value={purTeam} onChange={(e) => { const v = e.target.value; setPurTeam(v); if (purchaser && !(purchaserList.filter((x) => !v || x.team === v)).some((x) => x.name === purchaser)) setPurchaser('') }}>
              <option value="">全部小组</option>
              {purchaserTeamList.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="col w2"><label>采购人员 *</label>
            <select className="sa" style={{ width: 180 }} value={purchaser} onChange={(e) => setPurchaser(e.target.value)}>
              <option value="">{purTeam ? `— 请选择${purTeam}成员 —` : '— 请选择 —'}</option>
              {purchaserList.filter((x) => !purTeam || x.team === purTeam).map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
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
              <CountryPicker value={country} extra={meta?.countries ?? []} onChange={(v) => { setCountry(v); if (!locTouched) setUseLoc(v) }} placeholder="输入/选择国别" />
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
        <h3 className="sec-title">询价明细 <small>可添加多个产品 · 产品名称可手输或点「选择 ▾」从产品档案选 · 小计＝单价×数量</small></h3>
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
              <label>产品名称 *</label>
              <ProductPicker
                value={it.productName}
                products={products as ProductLite[]}
                onChange={(patch) => setItems((a) => a.map((x, j) => j === i ? {
                  ...x,
                  productName: patch.productName,
                  currency: patch.currency ?? x.currency,
                  // 命中产品档案：完全带入上次录入的数量与金额，之后可自由修改
                  qty: patch.fromArchive ? (patch.qty ?? '') : x.qty,
                  amount: patch.fromArchive ? (patch.amount ?? '') : x.amount,
                } : x))}
              />
            </div>
            <div className="col w1"><label>数量</label><input className="sa" type="number" min="0" value={it.qty} onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} /></div>
            <div className="col w1"><label>单价 *</label><input className="sa" type="number" min="0" value={it.amount} placeholder="单价" onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} /></div>
            <div className="col w1"><label>币种</label>
              <select className="sa" value={it.currency} onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, currency: e.target.value } : x))}>{currencyOptions(meta?.currencies, it.currency).map((c) => <option key={c}>{c}</option>)}</select>
            </div>
            <div className="col w1"><label>小计 <span className="hint">单价×数量</span></label>
              <div className="ro mono" title={`${money(Number(it.amount) || 0)} × ${Number(it.qty) > 0 ? Number(it.qty) : 1} = ${money((Number(it.amount) || 0) * (Number(it.qty) > 0 ? Number(it.qty) : 1))} ${it.currency}`}>
                {(() => { const q = Number(it.qty) > 0 ? Number(it.qty) : 1; const v = (Number(it.amount) || 0) * q; return v > 0 ? `${money(v)} ${it.currency}` : '—' })()}
              </div>
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
          {/* 每一项费用单独一行：金额 + 币种 + （非美元时）可修改的实际汇率 + 该项折 USD */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {feeRows.map((f) => (
              <div className="row" key={f.key} style={{ marginBottom: 0, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="col" style={{ minWidth: 96, maxWidth: 120 }}>
                  <label>{f.label}</label>
                  <input className="sa" style={{ width: '100%' }} type="number" min="0" value={(fees as Record<string, string>)[f.key]}
                    onChange={(e) => setFees({ ...fees, [f.key]: e.target.value })} placeholder="0" />
                </div>
                <div className="col" style={{ minWidth: 96, maxWidth: 120 }}>
                  <label>币种</label>
                  <select className="sa" style={{ width: '100%' }} title={`${f.label}的币种`}
                    value={f.currency} onChange={(e) => { const v = e.target.value; setFeeCurs((c) => ({ ...c, [f.key]: v })); if (f.key === 'freight') setFeeCur(v) }}>
                    {currencyOptions(meta?.currencies, f.currency).map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                {f.currency !== 'USD' ? (
                  <div className="col" style={{ minWidth: 190 }}>
                    <label>汇率 <span className="hint">1 USD = ? {f.currency}（可改）</span></label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input className="sa" style={{ width: 100 }} type="number" min="0" step="0.0001"
                        title={`本单 ${f.currency} 的实际汇率（默认取设置里的 ${meta?.fx?.[f.currency] ?? '—'}，改动后本单所有 ${f.currency} 金额都按此折算）`}
                        value={rateOv[f.currency] ?? String(meta?.fx?.[f.currency] ?? '')}
                        onChange={(e) => setRateOv((m) => ({ ...m, [f.currency]: e.target.value }))} />
                      <span className="hint">≈ USD {money(Math.round(f.usd * 100) / 100)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="col" style={{ minWidth: 190 }}>
                    <label>&nbsp;</label>
                    <span className="hint" style={{ lineHeight: '34px' }}>美元无需汇率 · 计入合计</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* 明细里用到的非美元币种，也允许改汇率（同一币种共用） */}
          {usedNonUsd.filter((c) => !feeRows.some((f) => f.currency === c && f.value)).length > 0 && (
            <div className="row" style={{ marginTop: 6, marginBottom: 0, alignItems: 'flex-end' }}>
              {usedNonUsd.filter((c) => !feeRows.some((f) => f.currency === c && f.value)).map((c) => (
                <div className="col" key={c} style={{ minWidth: 190 }}>
                  <label>{c} 汇率 <span className="hint">1 USD = ? {c}（可改）</span></label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input className="sa" style={{ width: 100 }} type="number" min="0" step="0.0001"
                      title={`本单 ${c} 的实际汇率（默认 ${meta?.fx?.[c] ?? '—'}）`}
                      value={rateOv[c] ?? String(meta?.fx?.[c] ?? '')} onChange={(e) => setRateOv((m) => ({ ...m, [c]: e.target.value }))} />
                    <span className="hint">用于产品明细折算</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="hint" style={{ display: 'block', marginTop: 6 }}>
            每行「小计＝单价 × 数量」（数量留空按 1 计）；费用选填，留空按 0 计算，每项费用可各自选择币种，<b>非美元时按上面填写的实际汇率折算</b>（默认取「字段与选项设置 → 币种」里的汇率），结果以实际计算为准，并计入下面的「总报价（含费用）」。
            每次修改费用（金额/币种/汇率）都会留一条<b>费用版本记录</b>，可在「询报价管理 → 查看 → 费用版本」里追溯。
          </div>
          <div className="totals" style={{ marginTop: 8 }}>
            <span className="badge new">总报价（含费用）：</span>
            {grandByCur.length === 0
              ? <span style={{ color: 'var(--sub)' }}>填一行金额后自动合计</span>
              : <span className="t" title={`按各自币种合计：${grandByCur.map(([c, v]) => `${money(v)} ${c}`).join(' + ')}（非美元按本单实际汇率折 USD）`}>
                  {money(Math.round(grandUsd))} USD
                </span>}
          </div>
          <div className="hint" style={{ display: 'block', marginTop: 4 }}>
            产品合计 {quoteByCur.length ? quoteByCur.map(([c, v]) => `${money(v)} ${c}`).join(' + ') : '—'}
            {feeRows.filter((f) => f.value).length
              ? feeRows.filter((f) => f.value).map((f) => ` ＋${f.label} ${money(f.value)} ${f.currency}（≈USD ${money(Math.round(f.usd))}）`).join('')
              : ' ＋ 费用 —'}
            {feeUsdTotal > 0 ? ` ｜ 费用折 USD 约 ${money(Math.round(feeUsdTotal))}` : ''}
            （总报价折 USD 约 {money(Math.round(grandUsd))}）
          </div>
          <div className="row" style={{ marginTop: 8, marginBottom: 0 }}>
            <div className="col w2"><label>总金额（手填 · 选填）</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="sa" style={{ flex: 1, minWidth: 0 }} type="number" min="0" value={handTotal} onChange={(e) => setHandTotal(e.target.value)} placeholder="议价/最终金额" />
                <select className="sa" style={{ width: 92, flexShrink: 0 }} value={handTotalCur} title="手填总金额的金额单位"
                  onChange={(e) => setHandTotalCur(e.target.value)}>{currencyOptions(meta?.currencies, handTotalCur).map((c) => <option key={c}>{c}</option>)}</select>
              </div>
            </div>
          </div>
          <div className="hint" style={{ display: 'block', marginTop: 4 }}>总报价（含费用）= 各行小计（单价×数量）合计 + 运费 + 税费 + 佣金 + 其他费用；总金额可另行手填最终/成交金额（右侧可选金额单位，默认 USD），与报价一致可留空。</div>
        </div>

        <div style={{ marginTop: 12, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
          <div className="grid-eq3">
            <div className="col box-fixed fixed-h"><label>卡点/问题</label><textarea className="sa fixed-h" value={blockers} onChange={(e) => setBlockers(e.target.value)} placeholder="如：价格、交期、技术规格、竞品占位…" /></div>
            <div className="col box-fixed fixed-h"><label>行动计划</label><textarea className="sa fixed-h" value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} placeholder="下一步打算怎么做" /></div>
            <div className="col box-fixed fixed-h"><label>需要的支持</label><textarea className="sa fixed-h" value={supportNeeded} onChange={(e) => setSupportNeeded(e.target.value)} placeholder="如：报价支持 / 技术选型 / 领导出面 / 样品寄送 / 资质文件" /></div>
          </div>
          <div className="grid-1" style={{ marginTop: 10 }}>
            <div className="col box-fixed fixed-h"><label>备注</label><textarea className="sa fixed-h" value={note} onChange={(e) => setNote(e.target.value)} placeholder="客户要求、交期等补充说明（选填）" /></div>
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

function CountryPicker({ value, onChange, placeholder, extra = [] }: { value: string; onChange: (v: string) => void; placeholder?: string; extra?: string[] }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [focusI, setFocusI] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  // 内置完整清单 + 设置页维护的自定义国别补充（联动「字段与选项设置」）
  const all = [...extra, ...COUNTRIES].filter((c, i, a) => c && a.indexOf(c) === i)
  const shown = q.trim()
    ? all.filter((c) => c.toLowerCase().includes(q.trim().toLowerCase()))
    : all
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
          <div className="hint" style={{ background: '#fff', padding: '3px 8px', border: '1px solid var(--line)', borderTop: 'none' }}>清单共 {all.length} 个国别 · 支持键盘 ↑↓ 回车选择</div>
        </div>
      )}
    </div>
  )
}
