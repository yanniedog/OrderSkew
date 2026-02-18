import { z } from "zod";

import { RANDOMNESS_VALUES, STYLE_VALUES } from "@/lib/types";

export const searchRequestSchema = z.object({
  keywords: z.string().trim().min(2).max(200),
  description: z.string().trim().max(500).optional().default(""),
  style: z.enum(STYLE_VALUES),
  randomness: z.enum(RANDOMNESS_VALUES),
  blacklist: z.string().trim().max(500).optional().default(""),
  maxLength: z.number().int().min(5).max(25),
  tld: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^\.?[a-zA-Z0-9-]+$/)
    .transform((value) => value.replace(/^\./, "").toLowerCase()),
  maxNames: z.number().int().min(1).max(250).default(100),
  yearlyBudget: z.number().positive().max(100_000),
  loopCount: z.number().int().min(1).max(25).default(10),
});

export type SearchRequestInput = z.input<typeof searchRequestSchema>;
export type SearchRequestParsed = z.output<typeof searchRequestSchema>;
