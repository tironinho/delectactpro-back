import { z } from 'zod';
const utmSchema = z.object({
    source: z.string().max(100).optional(),
    medium: z.string().max(100).optional(),
    campaign: z.string().max(100).optional(),
    term: z.string().max(100).optional(),
    content: z.string().max(100).optional()
});
export const createCheckoutSessionSchema = z.object({
    planId: z.literal('setup_fee_999'),
    email: z.string().email().max(254).optional(),
    companyName: z.string().max(200).optional(),
    leadId: z.union([z.string(), z.number()]).optional(),
    sourcePage: z.string().max(200).optional(),
    referrer: z.string().max(500).optional(),
    utm: utmSchema.optional()
});
