import { z } from 'zod';

export const adminSessionRequestSchema = z.object({
  password: z.string().min(1).max(128),
}).strict();

export const adminEventUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000),
  notifyOnResponse: z.boolean(),
}).strict();
