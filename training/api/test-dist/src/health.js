/**
 * Stable health contract for the B-01 skeleton.
 *
 * B-05 will expose this response through NestJS at GET /health; keeping it
 * framework-free lets the contract stay testable during the bootstrap phase.
 */
export function healthResponse() {
    return { status: 'ok', service: 'api' };
}
