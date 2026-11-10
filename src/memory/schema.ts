import { z } from "zod";
export const MemoryProposal = z.object({
  entries: z
    .array(
      z.object({
        kind: z.enum([
          "preference",
          "constraint",
          "project",
          "decision",
          "discussion",
          "reported_event",
          "plan",
        ]),
        text: z.string().min(1).max(1200),
        sources: z
          .array(
            z.object({
              messageId: z.string(),
              quote: z.string().min(4).max(1200),
            }),
          )
          .min(1)
          .max(8),
        validUntil: z.string().datetime().nullable(),
      }),
    )
    .max(30),
});
