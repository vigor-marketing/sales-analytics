import { useEffect, useRef, useState } from 'react'

export interface ProductLite {
  id: string; name: string; currency: string; last_amount: number | null; last_qty?: number | null; use_count: number
  /** 产品档案里的价格版本信息（由 /api/products 返回） */
  version?: number; prev_amount?: number | null; prev_qty?: number | null; amount_delta?: number | null; change_count?: number
}

/** 从产品档案选择后回填的内容：名称、币种，以及档案里的参考数量与参考金额 */
export interface ProductPatch {
  productName: string
  currency?: string
  qty?: string
  amount?: string
  fromArchive?: boolean
}

const num2str = (v: unknown) => (v == null || v === '' ? undefined : String(v))

/** 产品名称录入：可手输，也可点「选择 ▾」从产品档案下拉选择（录入页与询报价管理共用） */
export default function ProductPicker({
  value, products, onChange, placeholder = '如：可溶桥塞',
}: {
  value: string
  products: ProductLite[]
  onChange: (patch: ProductPatch) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.prod-pick')) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const hit = products.find((p) => p.name.toLowerCase() === value.trim().toLowerCase())
  const shown = products.filter((p) => !filter.trim() || p.name.toLowerCase().includes(filter.trim().toLowerCase()))
  const info = (p: ProductLite) => [
    p.last_amount == null ? null : `${Number(p.last_amount).toLocaleString()} ${p.currency}`,
    p.last_qty == null ? null : `上次数量 ${p.last_qty}`,
    `已用 ${p.use_count} 次`,
  ].filter(Boolean).join(' · ')
  return (
    <div className="prod-pick" ref={box} style={{ display: 'flex', gap: 6, position: 'relative' }}>
      <input
        className="sa"
        style={{ width: '100%', minWidth: 0 }}
        value={value}
        placeholder={placeholder}
        title={hit ? `档案参考：${info(hit)}（选择后自动带入上次录入的数量与金额，可修改）` : ''}
        onChange={(e) => {
          const v = e.target.value
          const h = products.find((p) => p.name.toLowerCase() === v.trim().toLowerCase())
          // 名称改成档案里的产品（手输命中同名）时，同样完全带入上次录入的数量/金额/币种
          onChange(h
            ? { productName: v, currency: h.currency, qty: num2str(h.last_qty) ?? '', amount: num2str(h.last_amount) ?? '', fromArchive: true }
            : { productName: v })
        }}
      />
      <button type="button" className="btn sm" style={{ flexShrink: 0 }} title="从产品档案选择（自动带出币种、参考数量与金额）"
        onClick={() => { setOpen((o) => !o); setFilter('') }}>选择 ▾</button>
      {open && (
        <div className="prod-panel">
          <input className="sa" style={{ width: '100%', marginBottom: 6 }} autoFocus value={filter} placeholder="筛选产品…" onChange={(e) => setFilter(e.target.value)} />
          {shown.map((p) => (
            <div key={p.id} className="prod-item" title="点击带出该产品的币种、参考数量与金额"
              onClick={() => {
                // 完全带入该产品上次录入的信息（数量、金额、币种），带入后仍可修改
                onChange({ productName: p.name, currency: p.currency, qty: num2str(p.last_qty) ?? '', amount: num2str(p.last_amount) ?? '', fromArchive: true })
                setOpen(false)
              }}>
              <b>{p.name}</b>
              <span className="hint">{info(p)}</span>
            </div>
          ))}
          {shown.length === 0 && <div className="hint" style={{ padding: 8 }}>{products.length === 0 ? '产品档案为空（录入后自动生成）' : '没有匹配的产品，可直接手输新名称'}</div>}
          <div className="hint" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 4 }}>选择后自动带入该产品上次录入的数量、金额与币种，带入后可直接修改</div>
        </div>
      )}
    </div>
  )
}
