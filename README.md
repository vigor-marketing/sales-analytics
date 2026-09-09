# sales-analytics（v3 重做）

询报价录入起步：手动录入 询价号/日期/客户/国别/产品多行/总报价自动合计/总金额/销售·采购（取自组织架构）/来源（设置管理）/备注；新客户名自动建档，询价号唯一。

- 后端：Express + SQLite，端口 3218
- 前端：React + Vite，端口 5178（dev）
- 启动：`bash scripts/start.sh`，停止：`bash scripts/stop.sh`
- API 快速参考见 `server/src/index.ts`
