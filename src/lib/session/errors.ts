/**
 * Session-layer error taxonomy (shared by chat.ts, pipeline.ts,
 * confirmatory.ts without creating import cycles).
 */
export class ChatError extends Error {
  constructor(
    public code: 'not_found' | 'ended' | 'empty_content' | 'too_long' | 'wrong_type',
    message: string,
  ) {
    super(message)
  }
}
