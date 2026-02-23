import { z } from 'zod'

export const authTypeEnum = z.enum(['HMAC', 'BEARER', 'NONE'])

const customerApiBaseSchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url().max(500),
  healthPath: z.string().max(200).optional(),
  deletePath: z.string().max(200).optional(),
  statusPath: z.string().max(200).optional(),
  webhookPath: z.string().max(200).optional().nullable(),
  authType: authTypeEnum,
  sharedSecret: z.string().min(1).optional(),
  bearerToken: z.string().min(1).optional(),
  headers: z.record(z.string()).optional().nullable(),
  timeoutMs: z.number().int().min(500).max(60_000).optional(),
  retries: z.number().int().min(0).max(5).optional(),
  hmacHeaderName: z.string().max(60).optional(),
  timestampHeaderName: z.string().max(60).optional(),
  replayWindowSeconds: z.number().int().min(60).max(3600).optional()
})

export const createCustomerApiSchema = customerApiBaseSchema.refine(
  (d) => (d.authType === 'HMAC' ? !!d.sharedSecret : true) && (d.authType === 'BEARER' ? !!d.bearerToken : true),
  { message: 'sharedSecret required for HMAC; bearerToken required for BEARER' }
)

export const patchCustomerApiSchema = customerApiBaseSchema.partial().extend({
  sharedSecret: z.string().min(1).optional(),
  bearerToken: z.string().min(1).optional()
})

export type CreateCustomerApiInput = z.infer<typeof createCustomerApiSchema>
export type PatchCustomerApiInput = z.infer<typeof patchCustomerApiSchema>
