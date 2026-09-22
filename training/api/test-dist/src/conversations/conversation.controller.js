var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Principal } from '../common/decorators/principal.decorator.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ConversationService } from './conversation.service.js';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
function readPagination(limitRaw, offsetRaw) {
    let limit = DEFAULT_LIMIT;
    if (limitRaw !== undefined && limitRaw !== '') {
        const parsed = Number(limitRaw);
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT)
            limit = parsed;
    }
    let offset = 0;
    if (offsetRaw !== undefined && offsetRaw !== '') {
        const parsed = Number(offsetRaw);
        if (Number.isInteger(parsed) && parsed >= 0)
            offset = parsed;
    }
    return { limit, offset };
}
let ConversationController = class ConversationController {
    conversations;
    constructor(conversations) {
        this.conversations = conversations;
    }
    async listMine(principal, limit, offset) {
        const pagination = readPagination(limit, offset);
        return this.conversations.listForLearner(principal, pagination);
    }
    async getConversation(principal, id) {
        const conversation = await this.conversations.getConversationDetail(principal, id);
        if (conversation === undefined) {
            throw new Error('CONVERSATION_NOT_FOUND');
        }
        return conversation;
    }
    async sendMessage(principal, id, body) {
        return this.conversations.sendMessage(principal, id, body);
    }
    async getCoachFeedback(principal, id, messageId) {
        return this.conversations.getCoachFeedback(principal, id, messageId);
    }
    async getCustomerState(principal, id, messageId) {
        return this.conversations.getCustomerState(principal, id, messageId);
    }
    async startConversation(principal, id) {
        const result = await this.conversations.startConversation(principal, id);
        if (result === undefined) {
            throw new Error('CONVERSATION_NOT_FOUND');
        }
        return result;
    }
    async endConversation(principal, id) {
        const result = await this.conversations.endConversation(principal, id);
        if (result === undefined) {
            throw new Error('CONVERSATION_NOT_FOUND');
        }
        return result;
    }
};
__decorate([
    Get(),
    __param(0, Principal()),
    __param(1, Query('limit')),
    __param(2, Query('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ConversationController.prototype, "listMine", null);
__decorate([
    Get(':id'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ConversationController.prototype, "getConversation", null);
__decorate([
    Post(':id/messages'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ConversationController.prototype, "sendMessage", null);
__decorate([
    Get(':id/messages/:messageId/coach-feedback'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __param(2, Param('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ConversationController.prototype, "getCoachFeedback", null);
__decorate([
    Get(':id/messages/:messageId/customer-state'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __param(2, Param('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ConversationController.prototype, "getCustomerState", null);
__decorate([
    Post(':id/opening'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ConversationController.prototype, "startConversation", null);
__decorate([
    Post(':id/end'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ConversationController.prototype, "endConversation", null);
ConversationController = __decorate([
    Controller(['me/conversations', 'training/conversations']),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin', 'streamer'),
    __metadata("design:paramtypes", [ConversationService])
], ConversationController);
export { ConversationController };
