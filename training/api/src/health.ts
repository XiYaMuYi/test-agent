export interface HealthResponse {
  readonly status: 'ok';
  readonly service: 'api';
  readonly principalId?: string;
}

/**
 * Stable health contract for the B-01 skeleton.
 *
 * B-05 will expose this response through NestJS at GET /health; keeping it
 * framework-free lets the contract stay testable during the bootstrap phase.
 */
export function healthResponse(): HealthResponse {
  return { status: 'ok', service: 'api' };
}
