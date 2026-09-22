export function canEndConversation(status) {
    return status === 'created' || status === 'active' || status === 'awaiting_model';
}
export function decideMessage(conversation, input, existing) {
    if (existing !== undefined) {
        const sameBody = existing.sequence === input.sequence && existing.content === input.content;
        return sameBody ? { kind: 'replay' } : { kind: 'idempotency_conflict', reason: 'MESSAGE_IDEMPOTENCY_CONFLICT' };
    }
    if (conversation.status === 'completed' || conversation.status === 'ended' || conversation.status === 'failed') {
        return { kind: 'closed', reason: 'Conversation is closed.' };
    }
    if (conversation.status === 'awaiting_model') {
        return { kind: 'sequence_conflict', reason: 'MESSAGE_SEQUENCE_CONFLICT' };
    }
    if (input.sequence !== conversation.lastSequence + 1) {
        return { kind: 'sequence_conflict', reason: 'MESSAGE_SEQUENCE_CONFLICT' };
    }
    return { kind: 'accepted' };
}
