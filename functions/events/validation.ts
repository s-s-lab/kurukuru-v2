import { z } from 'zod';

const candidateDaySchema = z.object({
  date: z.iso.date(),
  slotIndexes: z
    .array(z.number().int().min(12).max(47))
    .min(1)
    .max(36)
    .refine((values) => new Set(values).size === values.length, {
      message: '同じ時間枠を重複して指定できません。',
    }),
});

export const createEventRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2000).optional().default(''),
    organizerEmail: z.email().max(254),
    adminPassword: z.string().min(8).max(128),
    notifyOnResponse: z.boolean().optional().default(true),
    candidateSlots: z.array(candidateDaySchema).min(1).max(20),
  })
  .superRefine((value, context) => {
    const dates = value.candidateSlots.map((candidate) => candidate.date);
    if (new Set(dates).size !== dates.length) {
      context.addIssue({
        code: 'custom',
        path: ['candidateSlots'],
        message: '同じ候補日を重複して指定できません。',
      });
    }
  })
  .transform((value) => ({
    ...value,
    organizerEmail: value.organizerEmail.toLowerCase(),
    candidateSlots: [...value.candidateSlots]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((candidate) => ({
        date: candidate.date,
        slotIndexes: [...candidate.slotIndexes].sort((left, right) => left - right),
      })),
  }));

export type CreateEventRequest = z.output<typeof createEventRequestSchema>;
