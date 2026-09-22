/**
 * 运营管理端（B 端 admin-web）面向的是培训/运营人员，不是小程序学习者，
 * 因此没有公主购顾客令牌，也没有小程序的设备签名（device/device_id）。
 *
 * 本适配器在正式 gongzhugou 顾客身份校验之前，先识别「默认管理员令牌」
 * （由环境变量 ADMIN_ACCESS_TOKEN 配置，支持英文逗号分隔多个），命中即返回一个
 * 固定的租户管理员主体；其余令牌一律原样委托给内层适配器（C 端顾客链路保持不变）。
 *
 * 这是接入公司统一登录/后台嵌入之前的过渡方案：不做登录页，默认以单一租户管理员进入。
 * 后续接入正式登录时，移除或替换本适配器即可。
 *
 * 安全约定：未配置 ADMIN_ACCESS_TOKEN 时管理员集合为空，本适配器等价于纯透传，
 * 不会为任何令牌开放管理员权限。
 */
export class AdminBypassIdentityAdapter {
    adminTokens;
    adminPrincipal;
    inner;
    constructor(adminTokens, adminPrincipal, inner) {
        this.adminTokens = adminTokens;
        this.adminPrincipal = adminPrincipal;
        this.inner = inner;
    }
    async verifyAccessToken(token, context) {
        if (typeof token === 'string' && token.length > 0 && this.adminTokens.has(token)) {
            return this.adminPrincipal;
        }
        return this.inner.verifyAccessToken(token, context);
    }
}
