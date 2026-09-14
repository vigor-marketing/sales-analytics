import { useState } from 'react'
import Accounts from './Accounts'
import OrgSettings from './OrgSettings'
import SettingsView from './SettingsView'
import SystemInfo from './SystemInfo'
import { currentActor } from './session'

/**
 * 设置
 * 开放范围：除「普通成员」外都可查看与编辑（总经理 / 副总经理 / 管理员 / 主管）；普通成员不显示本页。
 * 主管可以管理本组 / 本部门的账号；「全部数据」权限的账号仅总经理 / 副总经理 / 管理员可管理（服务端同样拦截）。
 */
export default function Settings() {
  const actor = currentActor()
  const canManage = !!actor && actor.scope !== 'self'   // 除普通成员外都可查看与编辑
  const canAll = actor?.scope === 'all'                 // 只有全部数据权限能管理「全部数据」账号
  type Tab = 'org' | 'accounts' | 'fields' | 'sys'
  const allowed: Tab[] = ['org', 'accounts', 'fields', 'sys']
  const saved = (localStorage.getItem('sa:setTab') ?? '') as Tab
  const [tab, setTab] = useState<Tab>(() => (allowed.includes(saved) ? saved : 'org'))
  const go = (t: Tab) => { setTab(t); try { localStorage.setItem('sa:setTab', t) } catch { /* */ } }
  const note: Record<Tab, string> = {
    org: '部门 / 小组 / 人员，来自工作台并可全量同步到本系统',
    accounts: '登录账号、密码与数据范围（主管可管理本组 / 本部门；「全部数据」权限仅总经理 / 副总经理 / 管理员可管理）',
    fields: '来源、成交原因、丢单原因、跟进方式、国别、币种（含汇率）',
    sys: '当前实例（本地/线上）、数据库文件、数据量、自动备份状态',
  }
  return (
    <div className="page-fit scroll">
      <section className="card panel-tight auto">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>设置</h3>
          <span className="hint">
            组织架构来自工作台（可同步到本系统）；字段与选项是询报价/订单/跟进用到的下拉选项与币种
            {!canAll && '；你的职位是「' + (actor?.roleLabel || '主管') + '」，可以管理本组 / 本部门的账号与设置（「全部数据」权限的账号仅总经理 / 副总经理 / 管理员可管理）'}
          </span>
        </div>
        <div className="ana-tabs" style={{ marginTop: 10 }}>
          <div className="ana-tabs-l">
            <button className={tab === 'org' ? 'on' : ''} onClick={() => go('org')}>组织架构</button>
            <button className={tab === 'accounts' ? 'on' : ''} onClick={() => go('accounts')}>账号与权限</button>
            <button className={tab === 'fields' ? 'on' : ''} onClick={() => go('fields')}>字段与选项</button>
            <button className={tab === 'sys' ? 'on' : ''} onClick={() => go('sys')}>系统信息</button>
          </div>
          <span className="ana-note hint">{note[tab]}</span>
        </div>
      </section>
      {tab === 'org' && <OrgSettings />}
      {tab === 'accounts' && canManage && <Accounts />}
      {tab === 'fields' && <SettingsView />}
      {tab === 'sys' && <SystemInfo />}
    </div>
  )
}
