import { z } from 'zod';

export const responseRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  comment: z.string().trim().max(1000),
  availability: z.array(z.object({
    candidateSlotId: z.uuid().transform((value) => value.toLowerCase()),
    mark: z.enum(['best', 'ok', 'maybe', 'ng']),
  })).min(1).max(720).refine(
    (values) => new Set(values.map((value) => value.candidateSlotId)).size === values.length,
    { message: '同じ候補枠を重複して指定できません。' },
  ),
}).transform((value) => ({
  ...value,
  availability: [...value.availability].sort((left, right) =>
    left.candidateSlotId.localeCompare(right.candidateSlotId),
  ),
}));
