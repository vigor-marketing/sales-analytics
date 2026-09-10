import { useState } from 'react'

/** 原因下拉：字典项 + 「其他（手动输入）」，兼容历史里手填过的自定义值 */
export default function ReasonPicker({
  value, onChange, options, placeholder = '— 请选择 —', width,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  width?: number | string
}) {
  const list = (options ?? []).filter((x) => x !== '其他')
  const [custom, setCustom] = useState(Boolean(value) && !list.includes(value))
  const sel = custom ? '__custom__' : (list.includes(value) ? value : '')
  return (
    <div className="reason-row">
      <select
        className="sa"
        style={{ flex: custom ? '1 1 46%' : '1 1 100%', minWidth: 120, width: width ?? undefined }}
        value={sel}
        onChange={(e) => {
          const v = e.target.value
          if (v === '__custom__') { setCustom(true); onChange('') } else { setCustom(false); onChange(v) }
        }}
      >
        <option value="">{placeholder}</option>
        {list.map((x) => <option key={x} value={x}>{x}</option>)}
        <option value="__custom__">其他（手动输入）</option>
      </select>
      {custom && (
        <input className="sa" style={{ flex: '1 1 54%', minWidth: 120 }} value={value} onChange={(e) => onChange(e.target.value)} placeholder="请输入原因" />
      )}
    </div>
  )
}
