import { z } from 'zod';

export const adminSessionRequestSchema = z.object({
  password: z.string().min(1).max(128),
}).strict();

export const adminEventUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000),
  notifyOnResponse: z.boolean(),
}).strict();

const adminCandidateDaySchema = z.object({
  date: z.iso.date(),
  slotIndexes: z.array(z.number().int().min(12).max(47))
    .min(1)
    .max(36)
    .refine((slotIndexes) => new Set(slotIndexes).size === slotIndexes.length, {
      message: '同じ時間枠を重複して指定できません。',
    }),
}).strict();

export const adminCandidateSlotsSchema = z.object({
  candidateSlots: z.array(adminCandidateDaySchema).min(1).max(20),
}).strict().superRefine((value, context) => {
  const dates = value.candidateSlots.map(({ date }) => date);
  if (new Set(dates).size !== dates.length) {
    context.addIssue({
      code: 'custom',
      path: ['candidateSlots'],
      message: '同じ候補日を重複して指定できません。',
    });
  }
}).transform((value) => ({
  candidateSlots: [...value.candidateSlots]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((candidate) => ({
      date: candidate.date,
      slotIndexes: [...candidate.slotIndexes].sort((left, right) => left - right),
    })),
}));

export const adminFinalizationSchema = z.object({
  date: z.iso.date(),
  startSlot: z.number().int().min(12).max(47),
  endSlot: z.number().int().min(13).max(48),
}).strict().refine((value) => value.endSlot > value.startSlot, {
  path: ['endSlot'],
  message: '終了枠は開始枠より後にしてください。',
});
