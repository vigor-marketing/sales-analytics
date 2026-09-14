import { useState } from 'react'
import Accounts from './Accounts'
import OrgSettings from './OrgSettings'
import SettingsView from './SettingsView'
import SystemInfo from './SystemInfo'
import { currentActor } from './session'

/**
 * 设置
 * 开放范围：总经理 / 副总经理 / 管理员（全部数据）与各部门组长（本组数据）；普通成员不显示本页。
 * 其中「账号与权限」「系统信息」仅总经理 / 副总经理 / 管理员可见；
 * 组长可以查看「组织架构」「字段与选项」，但不能修改（修改接口服务端也只放给全部数据权限）。
 */
export default function Settings() {
  const actor = currentActor()
  const canAdmin = actor?.scope === 'all'      // 账号与权限 / 系统信息
  const canEdit = actor?.scope === 'all'       // 组织架构同步、字段与选项保存
  type Tab = 'org' | 'accounts' | 'fields' | 'sys'
  const allowed: Tab[] = canAdmin ? ['org', 'accounts', 'fields', 'sys'] : ['org', 'fields']
  const saved = (localStorage.getItem('sa:setTab') ?? '') as Tab
  const [tab, setTab] = useState<Tab>(() => (allowed.includes(saved) ? saved : 'org'))
  const go = (t: Tab) => { setTab(t); try { localStorage.setItem('sa:setTab', t) } catch { /* */ } }
  const note: Record<Tab, string> = {
    org: '部门 / 小组 / 人员，来自工作台并可全量同步到本系统',
    accounts: '登录账号、密码与数据范围（仅全部数据权限可见）',
    fields: '来源、成交原因、丢单原因、跟进方式、国别、币种（含汇率）',
    sys: '当前实例（本地/线上）、数据库文件、数据量、自动备份状态',
  }
  return (
    <div className="page-fit scroll">
      <section className="card panel-tight auto">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>设置</h3>
          <span className="hint">
            {canEdit
              ? '组织架构来自工作台（可同步到本系统）；字段与选项是询报价/订单/跟进用到的下拉选项与币种'
              : `你的职位是「${actor?.roleLabel || '组长'}」，可以查看组织架构与字段选项；修改需总经理 / 副总经理 / 管理员`}
          </span>
        </div>
        <div className="ana-tabs" style={{ marginTop: 10 }}>
          <div className="ana-tabs-l">
            <button className={tab === 'org' ? 'on' : ''} onClick={() => go('org')}>组织架构</button>
            {canAdmin && <button className={tab === 'accounts' ? 'on' : ''} onClick={() => go('accounts')}>账号与权限</button>}
            <button className={tab === 'fields' ? 'on' : ''} onClick={() => go('fields')}>字段与选项</button>
            {canAdmin && <button className={tab === 'sys' ? 'on' : ''} onClick={() => go('sys')}>系统信息</button>}
          </div>
          <span className="ana-note hint">{note[tab]}</span>
        </div>
      </section>
      {tab === 'org' && <OrgSettings readOnly={!canEdit} />}
      {tab === 'accounts' && canAdmin && <Accounts />}
      {tab === 'fields' && <SettingsView readOnly={!canEdit} />}
      {tab === 'sys' && canAdmin && <SystemInfo />}
    </div>
  )
}
