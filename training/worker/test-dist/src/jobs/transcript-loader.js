/**
 * Pure helpers for reconstructing a learner/assistant transcript from persisted
 * `conversation_message` rows.
 *
 * The assistant's reply text is not stored as a separate row — it lives inside
 * the originating learner row's `response_hash` JSON payload at
 * `suggestion.replyText`. The customer mood for a turn is also persisted on the
 * same learner row at the top-level `customerMood` key.
 *
 * This module is shared between the worker's evaluation-input loader and any
 * API-side transcript reconstruction so that both surfaces agree on how a raw
 * message list becomes a transcript.
 */
/**
 * Walk ordered message rows and emit an interleaved transcript plus the final
 * customer mood observed.
 *
 * - Every learner row contributes a `{role: 'learner', content}` entry.
 * - When the learner row carries a `response_hash`, its `suggestion.replyText`
 *   (if present and non-empty) is emitted as the following assistant entry.
 * - The last non-empty `customerMood` seen across all turns becomes the
 *   conversation-level mood; absent any, the result is `'neutral'`.
 */
export function buildTranscriptFromMessages(rows) {
    const transcript = [];
    let customerMood = 'neutral';
    for (const row of rows) {
        transcript.push({ role: 'learner', content: row.content });
        if (row.responseHash === null)
            continue;
        const parsed = tryParseResponseHash(row.responseHash);
        if (parsed === undefined)
            continue;
        const replyText = parsed.suggestion?.replyText;
        if (typeof replyText === 'string' && replyText.length > 0) {
            transcript.push({ role: 'assistant', content: replyText });
        }
        const mood = parsed.customerMood;
        if (typeof mood === 'string' && mood.length > 0) {
            customerMood = mood;
        }
    }
    return { transcript, customerMood };
}
function tryParseResponseHash(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null)
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}
