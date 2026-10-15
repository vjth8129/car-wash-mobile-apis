import { and, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  ADDRESS_FIELDS,
  carWashAddresses,
  carWashes,
  orders,
  users,
  AddressFields,
  CarWash,
  CarWashAddress,
  CarWashRow,
  NewCarWash,
} from '../db/schema';

type Db = typeof db;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A car wash with its address row flattened in, the shape the API has always returned. */
function withAddress(row: CarWashRow & { location?: CarWashAddress | null }): CarWash {
  const { location, ...carWash } = row;
  return {
    ...carWash,
    address: location?.address ?? null,
    city: location?.city ?? null,
    state: location?.state ?? null,
    country: location?.country ?? null,
    postalCode: location?.postalCode ?? null,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
  };
}

/** Splits create/update input into car wash columns and address columns. */
export function splitAddress<T extends Partial<AddressFields>>(input: T) {
  const rest: Record<string, unknown> = { ...input };
  const address: Partial<AddressFields> = {};
  for (const key of ADDRESS_FIELDS) {
    if (key in rest) {
      (address as Record<string, unknown>)[key] = rest[key];
      delete rest[key];
    }
  }
  return { carWash: rest as Omit<T, keyof AddressFields>, address };
}

/** Creates or updates the car wash's address row with the given fields. */
export async function upsertCarWashAddress(
  carWashId: string,
  address: Partial<AddressFields>,
  tx: Db | Tx = db,
): Promise<void> {
  if (Object.keys(address).length === 0) return;
  await tx
    .insert(carWashAddresses)
    .values({ carWashId, ...address })
    .onConflictDoUpdate({
      target: carWashAddresses.carWashId,
      set: { ...address, updatedAt: new Date() },
    });
}

export async function findCarWashById(id: string): Promise<CarWash | undefined> {
  const row = await db.query.carWashes.findFirst({
    where: eq(carWashes.id, id),
    with: { location: true },
  });
  return row && withAddress(row);
}

export async function findCarWashByCode(code: string): Promise<CarWashRow | undefined> {
  return db.query.carWashes.findFirst({ where: eq(carWashes.code, code) });
}

export async function updateCarWash(
  id: string,
  data: Partial<NewCarWash> & Partial<AddressFields>,
): Promise<CarWash | undefined> {
  const { carWash, address } = splitAddress(data);
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(carWashes)
      .set({ ...carWash, updatedAt: new Date() })
      .where(eq(carWashes.id, id))
      .returning();
    if (row) await upsertCarWashAddress(id, address, tx);
    return row;
  });
  return updated && findCarWashById(id);
}

export async function softDeleteCarWash(id: string): Promise<void> {
  await db
    .update(carWashes)
    .set({ status: 'INACTIVE', deletedAt: new Date() })
    .where(eq(carWashes.id, id));
}

/** The OWNER account(s) of a car wash, for reviewing a self sign-up. */
export async function findCarWashOwners(carWashId: string) {
  const rows = await db.query.users.findMany({
    where: and(eq(users.carWashId, carWashId), isNull(users.deletedAt)),
    columns: { id: true, name: true, username: true, phone: true, email: true, createdAt: true },
    with: { role: { columns: { name: true } } },
    orderBy: (u, { asc }) => [asc(u.createdAt)],
  });
  return rows.filter((u) => u.role.name === 'OWNER').map(({ role: _role, ...owner }) => owner);
}

interface ListCarWashesOptions {
  search?: string;
  status?: string;
  page: number;
  limit: number;
  offset: number;
}

export async function listCarWashes(options: ListCarWashesOptions) {
  const conditions = [];
  if (options.status) {
    conditions.push(eq(carWashes.status, options.status as CarWashRow['status']));
  }
  if (options.search) {
    const term = `%${options.search}%`;
    conditions.push(
      or(
        ilike(carWashes.name, term),
        ilike(carWashes.code, term),
        inArray(
          carWashes.id,
          db
            .select({ id: carWashAddresses.carWashId })
            .from(carWashAddresses)
            .where(ilike(carWashAddresses.city, term)),
        ),
      )!,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRow] = await Promise.all([
    db.query.carWashes.findMany({
      where,
      with: { location: true },
      limit: options.limit,
      offset: options.offset,
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(carWashes)
      .where(where ?? sql`true`),
  ]);

  const userCounts = await countUsersByCarWash(rows.map((r) => r.id));
  return {
    rows: rows.map((r) => ({ ...withAddress(r), userCount: userCounts.get(r.id) ?? 0 })),
    total: totalRow[0]?.count ?? 0,
  };
}

async function countUsersByCarWash(carWashIds: string[]) {
  if (carWashIds.length === 0) return new Map<string, number>();
  const counts = await db
    .select({ carWashId: users.carWashId, count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(inArray(users.carWashId, carWashIds), isNull(users.deletedAt)))
    .groupBy(users.carWashId);
  return new Map(counts.map((c) => [c.carWashId!, c.count]));
}

/** Platform-wide numbers for the admin portal dashboard. */
export async function getPlatformStats() {
  const [washes, people, orderCounts] = await Promise.all([
    db
      .select({ status: carWashes.status, count: sql<number>`count(*)::int` })
      .from(carWashes)
      .groupBy(carWashes.status),
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${users.status} = 'ACTIVE')::int`,
      })
      .from(users)
      .where(and(isNotNull(users.carWashId), isNull(users.deletedAt))),
    db
      .select({
        today: sql<number>`count(*) filter (where ${orders.createdAt} >= date_trunc('day', now()))::int`,
        last30Days: sql<number>`count(*) filter (where ${orders.createdAt} >= now() - interval '30 days')::int`,
      })
      .from(orders),
  ]);
  const byStatus = { ACTIVE: 0, SUSPENDED: 0, INACTIVE: 0, PENDING: 0 } as Record<string, number>;
  for (const w of washes) byStatus[w.status] = w.count;
  return {
    carWashes: {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      active: byStatus.ACTIVE,
      suspended: byStatus.SUSPENDED,
      inactive: byStatus.INACTIVE,
      pending: byStatus.PENDING,
    },
    users: people[0] ?? { total: 0, active: 0 },
    orders: orderCounts[0] ?? { today: 0, last30Days: 0 },
  };
}
