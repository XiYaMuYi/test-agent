# 部署说明（Docker Compose）

## 前置要求
- Docker 24+ / Docker Compose v2
- 已解析并备案的 HTTPS 域名（小程序 request 合法域名要求）
- 一个 LLM 供应商 key（OpenAI 兼容接口，如阿里百炼 DashScope）

## 快速启动

```bash
# 1. 准备环境变量
cp training/api/.env.example training/api/.env
# 编辑 training/api/.env，填入：
#   MODEL_PROVIDER=http
#   MODEL_BASE_URL / MODEL_NAME / MODEL_API_KEY
#   KNOWLEDGE_PROVIDER=fake 或 weknora
#   IDENTITY_PROVIDER=fake（本地）或 gongzhugou（接主站）

# 2. 启动
docker compose up -d --build

# 3. 查看状态
docker compose ps
docker compose logs -f api
```

## 服务端口
| 服务 | 容器 | 宿主端口 | 说明 |
|---|---|---|---|
| api | training-api | 18001→3000 | 业务 API |
| worker | training-worker | — | 异步评分/情绪/报告 |
| postgres | training-postgres | 5432 | 数据库 |
| admin-web | training-admin-web | 18080→80 | B 端运营页 |

## 小程序侧
- 小程序 request 合法域名需配置为 `https://你的域名`
- 公网经 Nginx 反代到 api 容器 18001
- B 端走 `https://你的域名:18080`

## 注意
- `training/api/.env` 含真实密钥，已 gitignore，不要提交
- 首次启动 api 会自动跑数据库迁移（migrate.ts）
- 本地开发用 `MODEL_PROVIDER=fake`、`KNOWLEDGE_PROVIDER=fake`，无需外网和密钥
