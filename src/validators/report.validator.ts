import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const date = z
  .string()
  .regex(DATE_RE, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Not a real date');

/** Longest range one sales report covers. */
export const MAX_REPORT_DAYS = 366;

/** Which completed washes a report looks at. */
const washFilters = z.object({
  /** Inclusive local dates, in the car wash's timezone. */
  from: date,
  to: date,
  serviceId: z.string().uuid().optional(),
  /** Vehicle category (Private, Taxi, ...). */
  categoryId: z.string().uuid().optional(),
  /** Body type (SEDAN, SUV, MOTORCYCLE, ...). */
  vehicleType: z
    .enum(['SEDAN', 'SUV', 'HATCHBACK', 'TRUCK', 'VAN', 'MOTORCYCLE', 'OTHER'])
    .optional(),
  paymentStatus: z.enum(['PAID', 'UNPAID']).optional(),
});

function checkRange(q: { from: string; to: string }, ctx: z.RefinementCtx) {
  if (q.from > q.to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '"from" must not be after "to"',
      path: ['from'],
    });
  } else if (
    (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000 >=
    MAX_REPORT_DAYS
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `A report can cover at most ${MAX_REPORT_DAYS} days`,
      path: ['to'],
    });
  }
}

export const salesReportQuerySchema = washFilters
  .extend({
    /** How the chart is bucketed; picked from the range length when left out. */
    groupBy: z.enum(['hour', 'day', 'week', 'month']).optional(),
    /** How many of the newest transactions to include (all are counted in the totals). */
    limit: z.coerce.number().int().min(0).max(500).default(100),
  })
  .superRefine(checkRange);

export const audienceQuerySchema = washFilters
  .extend({
    /** Only customers with at least this many washes in the range. */
    minVisits: z.coerce.number().int().min(1).max(100).default(1),
    /** "true": only customers who haven't had a wash since the range ended. */
    notReturned: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .superRefine(checkRange);

/** What to download: the same filters as the sales report, as a PDF or an Excel file. */
export const salesExportSchema = washFilters
  .extend({ format: z.enum(['pdf', 'xlsx']) })
  .superRefine(checkRange);

export const exportDownloadQuerySchema = z.object({ token: z.string().min(1) });

export type SalesExportQuery = z.infer<typeof salesExportSchema>;
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
export type AudienceQuery = z.infer<typeof audienceQuerySchema>;
