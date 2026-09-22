# AI 陪练平台 · 学习指引（Learning Guide）

> 面向想克隆本仓库、理解一个 AI 产品从 0 到 1 怎么做的学习者。
> 不按职位，按思维维度分层：产品思维 → 领域建模 → AI 嵌入/提示词工程 → 前后端架构 → 异步工程 → B 端产品。

---

## 代码量概览

| 模块 | 文件 | 行数 | 学什么 |
|---|---|---|---|
| contracts（共享契约） | 19 | ~2,100 | 领域建模 |
| api（NestJS 后端） | 100 | ~11,200 | 业务/架构 |
| worker（异步） | 14 | ~2,800 | 工程化 |
| admin-web（B 端） | 13 | ~5,700 | 全栈/运营产品 |
| miniprogram/pages | 18 | ~4,000 | 小程序端 |
| utils | 2 | ~340 | 基础设施 |
| test（测试） | 63 | ~9,200 | 工程质量 |
| **合计** | ~230 | **~35,000** | — |

---

## 学习路径

### 第 0 步：读文档（建立产品观）— 半天
- `docs/PRD-ai-training-platform.md` — 一个 AI 产品如何从业务痛点拆出角色、功能、边界、里程碑
- `docs/TECH-SUMMARY-ai-training-platform.md` — 技术选型与部署
- `docs/ARCHITECTURE-ai-training-platform.html` — 整体分层

### 第 1 步：领域建模（把业务翻译成代码）— 1 天
从 contracts 入手，它是整个系统的"概念词典"：
- `training/contracts/src/agent-config.ts` — **重点**：AI 陪练如何抽象成配置对象
- `training/contracts/src/persona/card-presets.ts` — "客户八类"如何枚举
- `training/contracts/src/knowledge/product-knowledge.ts` — 知识依赖如何结构化
- `training/contracts/src/evaluations/llm-scoring.ts` — 评分维度如何设计
- `training/contracts/src/ports/` — **重点**：端口（接口）如何把外部依赖解耦

### 第 2 步：AI 嵌入 + 提示词工程 — 2 天
本项目最值得学的部分：
- `training/api/src/ai/persona-prompt.ts` — **重点**：system prompt 如何从配置拼装
- `training/api/src/ai/customer-prompt.ts` — 客户侧 prompt
- `training/api/src/ai/coach/llm-coach.ts` — 教练点评 prompt
- `training/api/src/evaluations/llm-scoring-engine.ts` — **重点**：LLM 评分如何注入知识库、防幻觉、兜底
- `training/worker/src/jobs/grouped-llm-evaluation-generator.ts` — 多维度如何组合调一次 LLM

**核心体会**：规则能定的用代码，规则定不了的交给 LLM 但要给约束。

### 第 3 步：前后端架构与选型 — 2 天
- `training/api/src/app.module.ts` — NestJS 模块组织
- `training/api/src/identity/principal.guard.ts` — 鉴权横切关注点
- `training/api/src/sessions/session.service.ts` — 一场陪练的完整业务流
- `training/api/src/adapters/` — **重点**：接口 + 多实现如何切换本地开发与生产
- `training/api/src/database/migrations/` — schema 如何演进

### 第 4 步：异步化工程思维 — 1 天
- `training/worker/src/worker.module.ts` + `jobs/` — 评分/情绪/报告如何异步、不阻塞主对话
- `training/api/src/ai/coach/customer-state-assessor.ts` — 客户情绪异步研判设计

### 第 5 步：B 端运营产品思维 — 1 天
- `training/admin-web/index.html` + `app.js` + `pages/` — 无框架快速搭内部工具
- `training/admin-web/pages/scoring.js`、`templates.js` — 配置页 CRUD 设计

### 第 6 步：测试思维 — 选读
- `training/api/test/` — contracts/集成/e2e 分层测试

---

## 一句话主线

> 从 `agent-config.ts` → `persona-prompt.ts` → `llm-scoring-engine.ts` 三个文件串起来读，就能抓住本项目核心方法论：
> **把业务配置化、把 prompt 结构化、把 LLM 评分加上知识约束和兜底**。其余都是围绕这条主线的工程化。
