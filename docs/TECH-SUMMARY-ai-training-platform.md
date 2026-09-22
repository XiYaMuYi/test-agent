# AI 陪练平台 技术方案汇总 v1.0

> 最后更新：2026-09-22｜对应代码分支：codex/gongzhugou-training-plugin

---

## 1. 总体架构

```
小程序 C端 ──HTTPS──> 公网域名(阿里云) ──内网穿透──> 内网 Docker(api)
Web B端 ──HTTPS──> 公网域名:18080 ──> admin-web(静态)
                                          │
                              api ──> PostgreSQL
                              api ──> 公主购主站网关(校验登录态)
                              api ──> LLM 模型供应商
                              worker ──> LLM(评分/情绪/报告)
```

详见《技术架构图》。

---

## 2. 技术栈

| 层 | 技术 |
|---|---|
| C 端 | 微信小程序原生（WXML/WXSS/JS） |
| B 端 | 纯静态 HTML/CSS/JS（admin-web），Nginx 托管 |
| 后端 API | Node.js + NestJS + TypeScript |
| 异步任务 | Nest 微任务 worker（评分/情绪/报告生成） |
| 数据库 | PostgreSQL（JSONB 存画像/维度分数） |
| 部署 | Docker Compose（api/worker/postgres/admin-web） |
| 鉴权 | 复用公主购主站登录态，经网关校验 |

---

## 3. 模块划分

```
modules/training/
├── contracts/     共享类型契约（persona/scoring/knowledge/evaluations）
├── api/           NestJS 后端
│   ├── sessions/      会话与陪练启动
│   ├── conversations/ 对话
│   ├── assignments/   任务投放
│   ├── scenarios/    场景编排与发布
│   ├── templates/     陪练模板
│   ├── persona/      人设与 prompt 组装
│   ├── scoring/      评分维度/模板配置
│   ├── evaluations/  LLM 评分引擎
│   ├── knowledge/   产品知识库
│   ├── learners/     学员档案
│   ├── identity/     鉴权与 PrincipalGuard
│   └── adapters/     外部依赖（模型/知识库/身份）
├── worker/        异步评分/情绪/报告
├── migrations/    DB 迁移（0019~0026）
├── admin-web/     B 端静态页
└── test-fixtures/ 测试夹具
```

小程序端：
```
pages/training/   陪练各页（index/conversation/persona-edit/result/history）
new-serve/api/training.js   陪练请求封装
new-serve/index.js          统一 request（签名/头注入）
utils/training-auth.js      登录态
utils/training-i18n.js      文案
```

---

## 4. 关键技术决策

### 4.1 鉴权链路
- 小程序请求带 `x-token` + query 签名（device/open_id/device_id/timestamp/sign）
- `PrincipalGuard` 统一校验：调公主购网关 `customer/info/get`，code===1101 视为无效
- 校验通过挂 `CurrentPrincipal` 到 request
- 学员昵称/头像经请求头 `x-nickname`/`x-avatar`（URL encode）上报

### 4.2 人设与 Prompt 组装
- 客户八类人群 + 心理卡 + 难度 + 场景 + 客户关系/信任等级
- 运行时按 `AgentConfigV1` 拼装 system prompt
- 上下文按 `historyMessageLimit` 截取，超长截断不超 token

### 4.3 异步化（不阻塞主对话）
- **客户情绪感知**：用户发言后异步 LLM 研判，延迟渲染
- **教练点评**：每轮结束异步生成
- **结果报告**：对话结束后 worker 异步生成，失败可重试
- 前端轮询接口取异步结果

### 4.4 评分引擎（防幻觉）
- 评分维度 + 模板多对多，权重任务级可覆盖
- LLM 评分时注入知识库片段（产品功效/禁忌）
- 未配置维度走 LLM 通用兜底，并标注
- LLM 不得编造功效，知识未覆盖明确说明

### 4.5 会话异常恢复
- 返回键退出/重开小程序后，下次进入检测未完成会话
- 弹窗引导"继续上次 / 结束并新建"
- 不静默清除

### 4.6 数据模型
- `learner_profile`：学员档案，含 display_name/avatar_url/dimension_scores(jsonb)/weak_points(jsonb)
- 评分维度、评分模板、模板-维度关联、产品知识库、症状-功效映射
- 迁移：0019~0026

---

## 5. 部署拓扑

| 容器 | 端口 | 说明 |
|---|---|---|
| gongzhu-training-api-1 | 18001→3000 | 只绑内网 IP |
| gongzhu-training-worker-1 | — | 异步任务 |
| gongzhu-training-postgres-1 | 5432 | 数据 |
| gongzhu-admin-web | 18080→80 | B 端静态 |

- 公网域名（阿里云）443 → 内网穿透 → 内网 api
- 密钥走 `.env`（gitignore），代码无硬编码

---

## 6. 外部依赖
- 公主购主站网关（登录态校验）
- LLM 模型供应商（MODEL_API_KEY）
- 外部知识库服务（可选 EXTERNAL_KNOWLEDGE_API_KEY）

---

## 7. 已知问题与后续
- 学员微信头像临时链接可能过期，长期走主站 customer/info
- 规模化压测待做（M5）
- 产品全品类知识库持续扩充
