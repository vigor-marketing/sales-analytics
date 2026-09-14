# sales-analytics（v3 重做）

询报价录入起步：手动录入 询价号/日期/客户/国别/产品多行/总报价自动合计/总金额/销售·采购（取自组织架构）/来源（设置管理）/备注；新客户名自动建档，询价号唯一。

- 后端：Express + SQLite，端口 3218
- 前端：React + Vite，端口 5178（dev）
- 启动：`bash scripts/start.sh`，停止：`bash scripts/stop.sh`
- API 快速参考见 `server/src/index.ts`

## 数据隔离（重要）
- 本地开发数据与线上生产数据是**两份独立数据**，靠实例标识区分（本地 `local`、线上 `production`）；认错库会拒绝启动。
- 页面顶部徽标 + 「设置 → 系统信息」随时确认当前在看哪份数据；自检：`bash scripts/check-isolation.sh`。
- 部署只上传代码，`.db` / `.env` / `server/data` 一律不进包，解包前后比对线上数据指纹。
- 详见 [docs/数据隔离.md](docs/数据隔离.md)
