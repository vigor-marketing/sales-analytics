import { useEffect, useRef, useState } from 'react'

export interface ProductLite { id: string; name: string; currency: string; last_amount: number | null; use_count: number }

/** 产品名称录入：可手输，也可点「选择 ▾」从产品档案下拉选择（两处页面共用） */
export default function ProductPicker({
  value, products, onChange, placeholder = '如：可溶桥塞',
}: {
  value: string
  products: ProductLite[]
  onChange: (patch: { productName: string; currency?: string }) => void
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
  return (
    <div className="prod-pick" ref={box} style={{ display: 'flex', gap: 6, position: 'relative' }}>
      <input
        className="sa"
        style={{ width: '100%', minWidth: 0 }}
        value={value}
        placeholder={placeholder}
        title={hit ? `档案：参考金额 ${hit.last_amount == null ? '—' : Number(hit.last_amount).toLocaleString()} ${hit.currency} · 已用 ${hit.use_count} 次` : ''}
        onChange={(e) => {
          const v = e.target.value
          const h = products.find((p) => p.name.toLowerCase() === v.trim().toLowerCase())
          onChange({ productName: v, currency: h ? h.currency : undefined })
        }}
      />
      <button type="button" className="btn sm" style={{ flexShrink: 0 }} title="从产品档案选择"
        onClick={() => { setOpen((o) => !o); setFilter('') }}>选择 ▾</button>
      {open && (
        <div className="prod-panel">
          <input className="sa" style={{ width: '100%', marginBottom: 6 }} autoFocus value={filter} placeholder="筛选产品…" onChange={(e) => setFilter(e.target.value)} />
          {shown.map((p) => (
            <div key={p.id} className="prod-item" onClick={() => { onChange({ productName: p.name, currency: p.currency }); setOpen(false) }}>
              <b>{p.name}</b>
              <span className="hint">{p.last_amount == null ? '—' : Number(p.last_amount).toLocaleString()} {p.currency} · 已用 {p.use_count} 次</span>
            </div>
          ))}
          {shown.length === 0 && <div className="hint" style={{ padding: 8 }}>{products.length === 0 ? '产品档案为空（录入后自动生成）' : '没有匹配的产品，可直接手输新名称'}</div>}
        </div>
      )}
    </div>
  )
}
