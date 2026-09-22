/**
 * User-facing (Chinese) copy for every known internal error code.
 *
 * The stable SCREAMING_SNAKE `code` is kept for the client to branch on and for
 * logs, but it is never shown to an end user. Typing this table as
 * `Record<ErrorCode, string>` makes the compiler force a Chinese sentence for
 * every code in the shared contract — adding a new code without copy is a
 * compile error, so no raw code can ever leak through a missing mapping.
 */
const USER_FACING_MESSAGE = {
    INVALID_TOKEN: '登录状态已失效，请重新登录。',
    ACCESS_DENIED: '抱歉，你暂时没有权限进行此操作。',
    SCHEMA_INVALID: '提交的内容格式有误，请检查后重试。',
    SCHEMA_NOT_FOUND: '请求的内容不存在或已被移除。',
    AUTH_UNAUTHENTICATED: '请先登录后再继续操作。',
    AUTH_FORBIDDEN: '抱歉，你没有访问该内容的权限。',
    ORG_SCOPE_FORBIDDEN: '抱歉，该内容不属于你的组织，无法访问。',
    SCENARIO_DRAFT_NOT_FOUND: '方案草稿不存在或已发布，请刷新后重试。',
    SCENARIO_INVALID_RELEASE: '当前方案还不满足发布条件，请完善后再发布。',
    PERSONA_PRESET_NOT_FOUND: '选择的客户画像不存在，请重新选择。',
    PERSONA_CONFIG_INVALID: '客户画像设置有误，请重新选择或调整后再试。',
    ASSIGNMENT_NOT_FOUND: '任务不存在或已被移除。',
    ASSIGNMENT_NOT_ELIGIBLE: '当前还不满足领取该任务的条件。',
    ASSIGNMENT_NOT_ACTIVE: '该任务当前不在进行中，无法操作。',
    ASSIGNMENT_QUOTA_EXHAUSTED: '该任务的练习次数已用完。',
    ASSIGNMENT_ILLEGAL_TRANSITION: '任务当前状态不支持此操作，请刷新后重试。',
    IDEMPOTENCY_KEY_REQUIRED: '操作缺少幂等标识，请重试。',
    ATTEMPT_ALREADY_ACTIVE: '你已有一个进行中的练习，请先完成它。',
    SESSION_ALREADY_ACTIVE: '你已有一个进行中的训练，请勿重复开始。',
    MESSAGE_IDEMPOTENCY_CONFLICT: '相同内容正在处理中，请勿重复发送。',
    MESSAGE_SEQUENCE_CONFLICT: '消息顺序发生冲突，请刷新后重试。',
    CONVERSATION_NOT_FOUND: '对话不存在或已结束。',
    CONVERSATION_CLOSED: '这场对话已结束，无法继续发送消息。',
    KNOWLEDGE_NOT_AVAILABLE: '相关知识暂时不可用，请稍后再试。',
    MODEL_TIMEOUT: '模型响应超时，请检查网络后重试。',
    MODEL_SCHEMA_INVALID: '智能陪练返回异常，请重试一次。',
    MODEL_UPSTREAM_UNAVAILABLE: '智能陪练服务暂时繁忙，请稍后再试。',
    EVALUATION_NOT_FOUND: '评估报告不存在或尚未生成。',
    EVALUATION_REPORT_IMMUTABLE: '评估报告一经发布不可修改。',
    EVALUATION_RETRY_EXHAUSTED: '评估多次尝试后仍失败，请稍后重新结束对话再试。',
    TEMPLATE_NOT_FOUND: '模板不存在或已被移除。',
    TEMPLATE_TITLE_CONFLICT: '已存在同名模板，请更换一个标题。',
    FREE_SESSION_TEMPLATE_UNAVAILABLE: '免费练习模板暂时不可用，请稍后再试。',
    LEARNER_PROFILE_NOT_FOUND: '学员档案不存在。',
};
/**
 * Returns the Chinese user-facing sentence for a known code, or `undefined` for
 * an unknown code so the caller can keep its own fallback.
 */
export function getUserFacingMessage(code) {
    return Object.prototype.hasOwnProperty.call(USER_FACING_MESSAGE, code)
        ? USER_FACING_MESSAGE[code]
        : undefined;
}
