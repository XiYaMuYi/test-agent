import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { Principal } from '../common/decorators/principal.decorator.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ConversationService } from './conversation.service.js';

interface SendMessageBody {
  readonly clientMessageId: string;
  readonly sequence: number;
  readonly content: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function readPagination(limitRaw?: string, offsetRaw?: string): { limit: number; offset: number } {
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined && limitRaw !== '') {
    const parsed = Number(limitRaw);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT) limit = parsed;
  }
  let offset = 0;
  if (offsetRaw !== undefined && offsetRaw !== '') {
    const parsed = Number(offsetRaw);
    if (Number.isInteger(parsed) && parsed >= 0) offset = parsed;
  }
  return { limit, offset };
}

@Controller(['me/conversations', 'training/conversations'])
@UseGuards(PrincipalGuard, RbacGuard)
@Roles('admin', 'streamer')
export class ConversationController {
  private readonly conversations: ConversationService;

  public constructor(conversations: ConversationService) {
    this.conversations = conversations;
  }

  @Get()
  async listMine(
    @Principal() principal: CurrentPrincipal,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<unknown> {
    const pagination = readPagination(limit, offset);
    return this.conversations.listForLearner(principal, pagination);
  }

  @Get(':id')
  async getConversation(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<unknown> {
    const conversation = await this.conversations.getConversationDetail(principal, id);
    if (conversation === undefined) {
      throw new Error('CONVERSATION_NOT_FOUND');
    }
    return conversation;
  }

  @Post(':id/messages')
  async sendMessage(@Principal() principal: CurrentPrincipal, @Param('id') id: string, @Body() body: SendMessageBody): Promise<unknown> {
    return this.conversations.sendMessage(principal, id, body);
  }

  @Get(':id/messages/:messageId/coach-feedback')
  async getCoachFeedback(
    @Principal() principal: CurrentPrincipal,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ): Promise<unknown> {
    return this.conversations.getCoachFeedback(principal, id, messageId);
  }

  @Get(':id/messages/:messageId/customer-state')
  async getCustomerState(
    @Principal() principal: CurrentPrincipal,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ): Promise<unknown> {
    return this.conversations.getCustomerState(principal, id, messageId);
  }

  @Post(':id/opening')
  async startConversation(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<unknown> {
    const result = await this.conversations.startConversation(principal, id);
    if (result === undefined) {
      throw new Error('CONVERSATION_NOT_FOUND');
    }
    return result;
  }

  @Post(':id/end')
  async endConversation(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<unknown> {
    const result = await this.conversations.endConversation(principal, id);
    if (result === undefined) {
      throw new Error('CONVERSATION_NOT_FOUND');
    }
    return result;
  }
}
