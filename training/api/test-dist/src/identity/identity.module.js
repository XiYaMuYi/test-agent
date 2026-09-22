var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import process from 'node:process';
import { AdminBypassIdentityAdapter } from '../adapters/admin-bypass-identity.adapter.js';
import { FakeIdentityAdapter } from '../adapters/fake-identity.adapter.js';
import { GongzhugouIdentityAdapter } from '../adapters/gongzhugou-identity.adapter.js';
import { IDENTITY_PROVIDER } from './identity.tokens.js';
import { PrincipalGuard } from './principal.guard.js';
import { RbacGuard } from './rbac.guard.js';
const DEFAULT_ORGANIZATION_ID = '11111111-1111-1111-1111-111111111111';
let IdentityModule = class IdentityModule {
};
IdentityModule = __decorate([
    Module({
        providers: [
            FakeIdentityAdapter,
            {
                provide: IDENTITY_PROVIDER,
                useFactory: (fake, gongzhugou) => {
                    if (process.env.IDENTITY_PROVIDER === 'gongzhugou') {
                        // B 端运营后台过渡方案：ADMIN_ACCESS_TOKEN（逗号分隔）命中即视为固定租户管理员，
                        // 无需小程序设备签名；未配置时集合为空，行为与纯顾客校验完全一致。
                        const organizationId = process.env.TRAINING_ORGANIZATION_ID || DEFAULT_ORGANIZATION_ID;
                        const adminTokens = new Set((process.env.ADMIN_ACCESS_TOKEN ?? '')
                            .split(',')
                            .map((value) => value.trim())
                            .filter((value) => value.length > 0));
                        const adminSubjectId = (process.env.ADMIN_SUBJECT_ID || 'admin-organization-default').startsWith('admin-')
                            ? (process.env.ADMIN_SUBJECT_ID || 'admin-organization-default')
                            : 'admin-organization-default';
                        return new AdminBypassIdentityAdapter(adminTokens, { subjectId: adminSubjectId, organizationId, status: 'active' }, gongzhugou);
                    }
                    if (process.env.NODE_ENV === 'production' && process.env.LOCAL_TEST_AUTH !== 'true') {
                        throw new Error('IDENTITY_PROVIDER must be "gongzhugou" in production.');
                    }
                    return fake;
                },
                inject: [FakeIdentityAdapter, GongzhugouIdentityAdapter],
            },
            {
                provide: GongzhugouIdentityAdapter,
                useFactory: () => new GongzhugouIdentityAdapter(process.env.TRAINING_ORGANIZATION_ID || '11111111-1111-1111-1111-111111111111', Number(process.env.GONGZHUGOU_INTROSPECTION_TIMEOUT_MS || 5000)),
            },
            { provide: PrincipalGuard, useFactory: (identity) => new PrincipalGuard(identity), inject: [IDENTITY_PROVIDER] },
            RbacGuard,
        ],
        exports: [IDENTITY_PROVIDER, PrincipalGuard, RbacGuard],
    })
], IdentityModule);
export { IdentityModule };
