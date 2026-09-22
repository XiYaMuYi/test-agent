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

export interface TranscriptEntry {
  readonly role: 'learner' | 'assistant';
  readonly content: string;
}

/**
 * Shape of a `conversation_message` row projected for transcript building.
 * `responseHash` is the raw JSON string (the column is TEXT in the schema).
 *
 * Declared as a `type` (not `interface`) so it structurally satisfies the
 * `Record<string, unknown>` constraint on `EvaluationSqlExecutorPort.query<Row>`.
 */
export type RawMessageRow = {
  readonly sequence: number;
  readonly content: string;
  readonly responseHash: string | null;
};

export interface TranscriptLoadResult {
  readonly transcript: readonly TranscriptEntry[];
  /** Final customer mood; defaults to 'neutral' when no turn recorded one. */
  readonly customerMood: string;
}

interface ParsedResponseHash {
  readonly suggestion?: { readonly replyText?: unknown };
  readonly customerMood?: unknown;
}

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
export function buildTranscriptFromMessages(
  rows: readonly RawMessageRow[],
): TranscriptLoadResult {
  const transcript: TranscriptEntry[] = [];
  let customerMood = 'neutral';

  for (const row of rows) {
    transcript.push({ role: 'learner', content: row.content });

    if (row.responseHash === null) continue;
    const parsed = tryParseResponseHash(row.responseHash);
    if (parsed === undefined) continue;

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

function tryParseResponseHash(raw: string): ParsedResponseHash | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    return parsed as ParsedResponseHash;
  } catch {
    return undefined;
  }
}
