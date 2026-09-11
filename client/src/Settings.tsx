import { useState } from 'react'
import OrgSettings from './OrgSettings'
import SettingsView from './SettingsView'

/** 设置：组织架构（对接工作台）＋ 字段与选项（币种、来源、原因、跟进方式等） */
export default function Settings() {
  const [tab, setTab] = useState<'org' | 'fields'>(() => (localStorage.getItem('sa:setTab') === 'fields' ? 'fields' : 'org'))
  const go = (t: 'org' | 'fields') => { setTab(t); try { localStorage.setItem('sa:setTab', t) } catch { /* */ } }
  return (
    <div className="page-fit scroll">
      <section className="card panel-tight auto">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>设置</h3>
          <span className="hint">组织架构来自工作台（可同步到本系统）；字段与选项是询报价/订单/跟进用到的下拉选项与币种</span>
        </div>
        <div className="ana-tabs" style={{ marginTop: 10 }}>
          <div className="ana-tabs-l">
            <button className={tab === 'org' ? 'on' : ''} onClick={() => go('org')}>组织架构</button>
            <button className={tab === 'fields' ? 'on' : ''} onClick={() => go('fields')}>字段与选项</button>
          </div>
          <span className="ana-note hint">{tab === 'org' ? '部门 / 小组 / 人员，来自工作台并可全量同步到本系统' : '来源、成交原因、丢单原因、跟进方式、国别、币种（含汇率）'}</span>
        </div>
      </section>
      {tab === 'org' ? <OrgSettings /> : <SettingsView />}
    </div>
  )
}
