# 备份、恢复与安全说明（销售数据分析）

## 一、每日备份（已配置）

- 定时：systemd timer `sales-analytics-backup.timer`，**每天 02:30**（错过会在开机后补跑）
- 内容：SQLite 一致性快照（在线备份 API，不停服）+ 上传附件目录（有内容才打包）
- 加密：**AES-256-CBC（PBKDF2，20 万轮）**，本地与云端都只存密文
- 保留：本地最近 **14 份**（`BACKUP_KEEP`），超出自动清理
- 位置：`/opt/sales-analytics/server/data/backup/sales-analytics-<时间>.db.gz.enc`
- 日志：`/var/log/sales-analytics-backup.log`、`journalctl -u sales-analytics-backup`
- 配置：`/etc/sales-analytics-backup.env`（600，仅服务器本地；含加密口令与对象存储配置）
- 手动跑一次：`sudo systemctl start sales-analytics-backup.service`

## 二、恢复

```bash
# 1) 看有哪些备份
ls -lt /opt/sales-analytics/server/data/backup/

# 2) 恢复（会先用当前库另存一份再覆盖，需输入 yes 确认）
sudo bash /opt/sales-analytics/scripts/restore-db.sh /opt/sales-analytics/server/data/backup/sales-analytics-20260915-023012.db.gz.enc
```

恢复脚本会：解密 → `integrity_check` 校验并打印关键表行数 → 停服 → 另存当前库 → 覆盖 → 启动服务 → 自检。

## 三、同步到对象存储（腾讯云 COS，已启用）

备份已同步到**腾讯云 COS 桶 `knowledge-base-1459141414`（ap-shanghai）**下的独立前缀 **`sales-analytics/`**
（同桶下另有 `knowledge-base/`、`sales-commission/` 前缀，互不干扰）；每次备份自动上传，并**同步清理远端 15 天前的备份**，与本地保留策略一致。

配置位置：`/etc/sales-analytics-backup.env`（600，密钥只在本机）：

```
RCLONE_CONFIG_COS_TYPE=s3
RCLONE_CONFIG_COS_PROVIDER=TencentCOS
RCLONE_CONFIG_COS_ACCESS_KEY_ID=…
RCLONE_CONFIG_COS_SECRET_ACCESS_KEY=…
RCLONE_CONFIG_COS_ENDPOINT=cos.ap-shanghai.myqcloud.com
RCLONE_REMOTE=cos:knowledge-base-1459141414/sales-analytics
```

换桶或换 Key 时改这里，然后 `sudo systemctl start sales-analytics-backup.service` 验证一次即可。参考写法（其它对象存储）：

```bash
# 阿里云 OSS 示例（腾讯云 COS 见文件内注释，只需把 provider/endpoint 换掉）
RCLONE_CONFIG_OSS_TYPE=s3
RCLONE_CONFIG_OSS_PROVIDER=Alibaba
RCLONE_CONFIG_OSS_ACCESS_KEY_ID=...
RCLONE_CONFIG_OSS_SECRET_ACCESS_KEY=...
RCLONE_CONFIG_OSS_ENDPOINT=oss-cn-shanghai.aliyuncs.com
RCLONE_REMOTE=oss:你的bucket/sales-analytics
```

改完执行一次 `sudo systemctl start sales-analytics-backup.service` 即可验证；日志里会出现“对象存储同步完成”。

## 四、安全措施现状

| 项 | 状态 |
|---|---|
| 应用监听 | 只监听 `127.0.0.1:3218`，由 nginx 反代到 `/sales/`，数据库不对公网暴露 |
| 密码存储 | PBKDF2-SHA256（salt + 210000 轮），不存明文 |
| 会话 | HMAC-SHA256 签名 Cookie，`HttpOnly` + `SameSite=Lax`，12 小时过期；走 HTTPS 时自动加 `Secure` |
| 登录防爆破 | 同一 IP 10 分钟失败 8 次，或同账号失败 5 次 → 429 拒绝；nginx 层另加 20 次/分钟限流 |
| 登录审计 | 每次尝试（成功/失败、账号、IP、UA）入库，可在「设置 → 账号与权限 → 最近登录记录」查看 |
| 备份 | 每日加密备份，保留 14 天；恢复脚本一键回滚 |
| 数据权限 | 按岗位自动限定范围（全部 / 本组 / 只看自己），服务端强制过滤 |
| 待办 | ① 对象存储密钥（待填）② HTTPS（需要域名，当前为 http，公网明文传输） |
