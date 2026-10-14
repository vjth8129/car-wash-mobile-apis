import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { customers, promotionRecipients, promotions, users, type Promotion } from '../db/schema';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { messenger } from '../utils/messenger';
import { buildPagination } from '../utils/api-response';
import { PaginationQuery } from '../utils/pagination';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import type { CreatePromotionInput } from '../validators/promotion.validator';

/** How far ahead a promotion can be scheduled. */
const MAX_SCHEDULE_DAYS = 180;
/** A promotion stuck in SENDING this long (e.g. the server restarted mid-send) is picked up again. */
const STALE_SENDING = sql`interval '10 minutes'`;

/** {name} → the customer's first name ("there" when unknown). */
export const personalize = (message: string, name: string) =>
  message.replaceAll('{name}', name.trim().split(/\s+/)[0] || 'there');

export async function createPromotion(
  carWashId: string,
  userId: string,
  input: CreatePromotionInput,
): Promise<Promotion> {
  const now = new Date();
  let scheduledAt = now;
  if (input.sendAt) {
    scheduledAt = new Date(input.sendAt);
    if (scheduledAt.getTime() < now.getTime() - 60_000) {
      throw new ValidationError('Pick a time in the future');
    }
    if (scheduledAt.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * 86_400_000) {
      throw new ValidationError(
        `Promotions can be scheduled at most ${MAX_SCHEDULE_DAYS} days ahead`,
      );
    }
  }

  const ids = [...new Set(input.customerIds)];
  const people = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(
      and(
        eq(customers.carWashId, carWashId),
        inArray(customers.id, ids),
        isNull(customers.deletedAt),
      ),
    );
  if (people.length !== ids.length) {
    throw new ValidationError('Some of these customers no longer exist in this car wash');
  }
  const reachable = people.filter((p) => p.phone?.trim());
  if (!reachable.length) throw new ValidationError('None of these customers has a phone number');

  const created = await db.transaction(async (tx) => {
    const [promotion] = await tx
      .insert(promotions)
      .values({
        carWashId,
        title: input.title,
        message: input.message,
        channel: input.channel,
        status: 'SCHEDULED',
        scheduledAt,
        audienceLabel: input.audienceLabel || null,
        audience: input.audience ?? null,
        recipientCount: people.length,
        skippedCount: people.length - reachable.length,
        createdBy: userId,
      })
      .returning();
    await tx.insert(promotionRecipients).values(
      people.map((p) => ({
        promotionId: promotion.id,
        customerId: p.id,
        name: p.name,
        phone: p.phone?.trim() || null,
        status: p.phone?.trim() ? ('PENDING' as const) : ('SKIPPED' as const),
        error: p.phone?.trim() ? null : 'No phone number',
      })),
    );
    return promotion;
  });

  // "Send now" goes through the same sender as scheduled ones, without making the owner wait.
  if (!input.sendAt && env.PROMOTION_POLL_MS > 0) {
    setImmediate(() => {
      runDuePromotions().catch((err) => logger.error({ err }, 'Sending promotions failed'));
    });
  }
  return created;
}

const listColumns = {
  id: promotions.id,
  title: promotions.title,
  message: promotions.message,
  channel: promotions.channel,
  status: promotions.status,
  scheduledAt: promotions.scheduledAt,
  startedAt: promotions.startedAt,
  finishedAt: promotions.finishedAt,
  cancelledAt: promotions.cancelledAt,
  audienceLabel: promotions.audienceLabel,
  audience: promotions.audience,
  recipientCount: promotions.recipientCount,
  sentCount: promotions.sentCount,
  failedCount: promotions.failedCount,
  skippedCount: promotions.skippedCount,
  deliveryMode: promotions.deliveryMode,
  createdAt: promotions.createdAt,
  createdBy: { id: users.id, name: users.name },
};

export async function listPromotions(
  carWashId: string,
  pagination: PaginationQuery,
  filters: { status?: Promotion['status'] },
) {
  const where = and(
    eq(promotions.carWashId, carWashId),
    filters.status ? eq(promotions.status, filters.status) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select(listColumns)
      .from(promotions)
      .leftJoin(users, eq(users.id, promotions.createdBy))
      .where(where)
      .orderBy(desc(promotions.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db.select({ total: count() }).from(promotions).where(where),
  ]);
  return { rows, pagination: buildPagination(pagination.page, pagination.limit, total) };
}

export async function getPromotion(carWashId: string, id: string) {
  const [promotion] = await db
    .select(listColumns)
    .from(promotions)
    .leftJoin(users, eq(users.id, promotions.createdBy))
    .where(and(eq(promotions.id, id), eq(promotions.carWashId, carWashId)));
  if (!promotion) throw new NotFoundError('Promotion not found');
  const recipients = await db
    .select({
      id: promotionRecipients.id,
      customerId: promotionRecipients.customerId,
      name: promotionRecipients.name,
      phone: promotionRecipients.phone,
      status: promotionRecipients.status,
      sentAt: promotionRecipients.sentAt,
      error: promotionRecipients.error,
    })
    .from(promotionRecipients)
    .where(eq(promotionRecipients.promotionId, id))
    .orderBy(asc(promotionRecipients.name));
  return { ...promotion, recipients };
}

/** Only a promotion that hasn't started sending can be cancelled. */
export async function cancelPromotion(carWashId: string, id: string) {
  const [cancelled] = await db
    .update(promotions)
    .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(promotions.id, id),
        eq(promotions.carWashId, carWashId),
        eq(promotions.status, 'SCHEDULED'),
      ),
    )
    .returning({ id: promotions.id });
  if (!cancelled) {
    await getPromotion(carWashId, id); // 404 if it isn't this car wash's
    throw new ConflictError('This promotion has already been sent or cancelled');
  }
  return getPromotion(carWashId, id);
}

// ---- sending -----------------------------------------------------------------

let running: Promise<number> | null = null;

/**
 * Sends every promotion that is due (scheduled time reached, or stuck mid-send), one at a time.
 * Each is claimed with SKIP LOCKED, so several API instances never send the same one twice.
 * Returns how many promotions it worked on.
 */
export function runDuePromotions(): Promise<number> {
  running ??= (async () => {
    let handled = 0;
    try {
      for (;;) {
        const claimed = await db.execute<{
          id: string;
          message: string;
          channel: 'WHATSAPP' | 'SMS';
        }>(sql`
          update promotions
          set status = 'SENDING', started_at = coalesce(started_at, now()),
              delivery_mode = ${messenger.name}, updated_at = now()
          where id = (
            select id from promotions
            where (status = 'SCHEDULED' and scheduled_at <= now())
               or (status = 'SENDING' and updated_at < now() - ${STALE_SENDING})
            order by scheduled_at
            limit 1
            for update skip locked
          )
          returning id, message, channel`);
        const promotion = claimed.rows[0];
        if (!promotion) return handled;
        await sendPromotion(promotion);
        handled += 1;
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

async function sendPromotion(p: { id: string; message: string; channel: 'WHATSAPP' | 'SMS' }) {
  const pending = await db
    .select()
    .from(promotionRecipients)
    .where(
      and(eq(promotionRecipients.promotionId, p.id), eq(promotionRecipients.status, 'PENDING')),
    );

  for (const r of pending) {
    let failure: string | null = null;
    try {
      await messenger.send({
        to: r.phone!,
        channel: p.channel,
        body: personalize(p.message, r.name),
      });
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    await db
      .update(promotionRecipients)
      .set(failure ? { status: 'FAILED', error: failure } : { status: 'SENT', sentAt: new Date() })
      .where(eq(promotionRecipients.id, r.id));
    await refreshCounts(p.id); // live progress, and keeps updated_at fresh while sending
  }

  const counts = await refreshCounts(p.id);
  await db
    .update(promotions)
    .set({
      status: counts.sent === 0 && counts.failed > 0 ? 'FAILED' : 'SENT',
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(promotions.id, p.id));
}

async function refreshCounts(promotionId: string) {
  const [counts] = await db
    .select({
      sent: sql<number>`(count(*) filter (where ${promotionRecipients.status} = 'SENT'))::int`,
      failed: sql<number>`(count(*) filter (where ${promotionRecipients.status} = 'FAILED'))::int`,
    })
    .from(promotionRecipients)
    .where(eq(promotionRecipients.promotionId, promotionId));
  await db
    .update(promotions)
    .set({ sentCount: counts.sent, failedCount: counts.failed, updatedAt: new Date() })
    .where(eq(promotions.id, promotionId));
  return counts;
}

/** Checks for due promotions every PROMOTION_POLL_MS; returns a function that stops it. */
export function startPromotionSender(): () => void {
  if (env.PROMOTION_POLL_MS <= 0) return () => {};
  const tick = () => {
    runDuePromotions().catch((err) => logger.error({ err }, 'Sending promotions failed'));
  };
  tick();
  const timer = setInterval(tick, env.PROMOTION_POLL_MS);
  return () => clearInterval(timer);
}
