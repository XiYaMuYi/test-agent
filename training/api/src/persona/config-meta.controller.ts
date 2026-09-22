import { Controller, Get, UseGuards } from '@nestjs/common';

import {
  ALLOWED_OVERRIDE_PATH_PREFIXES,
  CLOSING_TENDENCIES,
  CONVERSATION_PACES,
  KNOWLEDGE_STRICTNESSES,
  RESPONSE_LENGTHS,
  AGENT_CONFIG_MAX_ADDITIONAL_INSTRUCTIONS,
  AGENT_CONFIG_MAX_HISTORY_MESSAGES,
  AGENT_CONFIG_MIN_HISTORY_MESSAGES,
} from '@training/contracts';
import { Roles } from '../common/decorators/roles.decorator.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { PersonaService } from './persona.service.js';

const RESPONSE_LENGTH_LABELS: Readonly<Record<string, string>> = {
  short: '简洁', normal: '适中', detailed: '详尽',
};
const KNOWLEDGE_STRICTNESS_LABELS: Readonly<Record<string, string>> = {
  strict: '严格（只讲知识要点）', balanced: '平衡（可补充常识）',
};
const CONVERSATION_PACE_LABELS: Readonly<Record<string, string>> = {
  slow: '慢节奏', normal: '正常', fast: '快节奏',
};
const CLOSING_TENDENCY_LABELS: Readonly<Record<string, string>> = {
  resistant: '抗成交', neutral: '中性', receptive: '易成交',
};
const OVERRIDE_MODE_LABELS: Readonly<Record<string, string>> = {
  locked: '锁定（学员不可修改）',
  allow_list: '白名单（仅允许勾选字段）',
  all: '全部开放（学员可改任意字段）',
};
const OVERRIDE_PATH_LABELS: Readonly<Record<string, string>> = {
  'age': '年龄',
  'gender': '性别',
  'occupation': '职业',
  'name': '姓名',
  'basic.maritalStatus': '婚姻状况',
  'basic.incomeLevel': '收入水平',
  'personality.friendliness': '性格·友好度',
  'personality.patience': '性格·耐心度',
  'personality.priceSensitivity': '性格·价格敏感度',
  'personality.decisiveness': '性格·决策果断度',
  'personality.skepticism': '性格·怀疑程度',
  'personality.socialActivity': '性格·社交活跃度',
  'personality.emotionalVolatility': '性格·情绪波动度',
  'communication.style': '沟通·语言风格',
  'communication.verbosity': '沟通·话量',
  'communication.emotionLevel': '沟通·情绪表达',
  'communication.catchphrase': '沟通·口头禅',
  'communication.dialect': '沟通·方言',
  'consumption.budgetMin': '消费·预算下限',
  'consumption.budgetMax': '消费·预算上限',
  'consumption.decisionCycle': '消费·决策周期',
  'consumption.brandLoyalty': '消费·品牌忠诚',
  'consumption.skinType': '消费·肤质',
  'consumption.skinConcerns': '消费·皮肤问题',
  'consumption.healthGoals': '消费·健康目标',
  'consumption.purchaseChannel': '消费·购买渠道',
  'consumption.ingredientFocus': '消费·成分关注',
  'consumption.competitorComparison': '消费·竞品倾向',
  'consumption.allergies': '消费·过敏信息',
  'consumption.currentProducts': '消费·当前产品',
  'conversation.maxTurns': '对话·最大轮数',
  'conversation.openingMode': '对话·开场方',
  'conversation.customNotes': '对话·补充备注',
};

function optionize(values: readonly string[], labels: Readonly<Record<string, string>>): readonly { value: string; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] ?? value }));
}

/**
 * B 端配置中心共享元数据端点（spec §6.1）：
 *   GET /admin/config-meta — persona 全字段枚举/范围 + AgentConfigV1 + C 端覆盖策略白名单。
 * 前端表单完全由本端点驱动渲染，禁止 B/C 两端各维护一份选项常量。
 */
@Controller('admin/config-meta')
@UseGuards(PrincipalGuard, RbacGuard)
@Roles('admin')
export class ConfigMetaController {
  public constructor(private readonly personas: PersonaService) {}

  @Get()
  getMetadata(): unknown {
    return {
      persona: this.personas.getFieldMetadata(),
      agentConfig: {
        schemaVersion: 'agent-config/v1',
        responseLengths: optionize(RESPONSE_LENGTHS, RESPONSE_LENGTH_LABELS),
        knowledgeStrictnesses: optionize(KNOWLEDGE_STRICTNESSES, KNOWLEDGE_STRICTNESS_LABELS),
        conversationPaces: optionize(CONVERSATION_PACES, CONVERSATION_PACE_LABELS),
        closingTendencies: optionize(CLOSING_TENDENCIES, CLOSING_TENDENCY_LABELS),
        historyMessageLimitRange: { min: AGENT_CONFIG_MIN_HISTORY_MESSAGES, max: AGENT_CONFIG_MAX_HISTORY_MESSAGES },
        additionalInstructionsMaxLength: AGENT_CONFIG_MAX_ADDITIONAL_INSTRUCTIONS,
      },
      overridePolicy: {
        modes: optionize(['locked', 'allow_list', 'all'], OVERRIDE_MODE_LABELS),
        allowedPaths: ALLOWED_OVERRIDE_PATH_PREFIXES.map((path) => ({
          path,
          label: OVERRIDE_PATH_LABELS[path] ?? path,
        })),
      },
    };
  }
}
