import crypto from 'node:crypto';
const HEADER = 'x-correlation-id';
/**
 * Attach a correlation ID to each request for logs and tracing.
 * Uses existing header if present, otherwise generates a short id.
 */
export function correlationId(req, _res, next) {
    const existing = req.headers[HEADER];
    const id = typeof existing === 'string' && existing.length > 0
        ? existing.slice(0, 64)
        : crypto.randomBytes(8).toString('hex');
    req.correlationId = id;
    next();
}
