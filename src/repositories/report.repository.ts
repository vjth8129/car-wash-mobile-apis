import { sql, SQL } from 'drizzle-orm';
import { db } from '../db';

export interface CarWashSummary {
  totalCustomers: number;
  totalVehicles: number;
  totalServices: number;
  totalBookings: number;
  bookingsByStatus: Record<string, number>;
  totalOrders: number;
  revenue: number;
}

export async function getCarWashSummary(carWashId: string): Promise<CarWashSummary> {
  const [customers, vehicles, services, bookings, bookingsByStatus, orders, revenue] =
    await Promise.all([
      db.execute<{ count: number }>(
        sql`select count(*)::int as count from customers where car_wash_id = ${carWashId} and deleted_at is null`,
      ),
      db.execute<{ count: number }>(
        sql`select count(*)::int as count from vehicles where car_wash_id = ${carWashId} and deleted_at is null`,
      ),
      db.execute<{ count: number }>(
        sql`select count(*)::int as count from services where car_wash_id = ${carWashId} and deleted_at is null`,
      ),
      db.execute<{ count: number }>(
        sql`select count(*)::int as count from bookings where car_wash_id = ${carWashId}`,
      ),
      db.execute<{ status: string; count: number }>(
        sql`select status, count(*)::int as count from bookings where car_wash_id = ${carWashId} group by status`,
      ),
      db.execute<{ count: number }>(
        sql`select count(*)::int as count from orders where car_wash_id = ${carWashId}`,
      ),
      db.execute<{ total: string | null }>(
        sql`select sum(total_amount) as total from orders where car_wash_id = ${carWashId} and status = 'COMPLETED'`,
      ),
    ]);

  const statusMap: Record<string, number> = {};
  for (const row of bookingsByStatus.rows) {
    statusMap[row.status] = row.count;
  }

  return {
    totalCustomers: customers.rows[0]?.count ?? 0,
    totalVehicles: vehicles.rows[0]?.count ?? 0,
    totalServices: services.rows[0]?.count ?? 0,
    totalBookings: bookings.rows[0]?.count ?? 0,
    bookingsByStatus: statusMap,
    totalOrders: orders.rows[0]?.count ?? 0,
    revenue: Number(revenue.rows[0]?.total ?? 0),
  };
}

export interface PlatformSummary {
  totalCarWashes: number;
  activeCarWashes: number;
  totalUsers: number;
  totalBookings: number;
  totalRevenue: number;
}

export async function getPlatformSummary(): Promise<PlatformSummary> {
  const [carWashes, activeCarWashes, users, bookings, revenue] = await Promise.all([
    db.execute<{ count: number }>(
      sql`select count(*)::int as count from car_washes where deleted_at is null`,
    ),
    db.execute<{ count: number }>(
      sql`select count(*)::int as count from car_washes where status = 'ACTIVE' and deleted_at is null`,
    ),
    db.execute<{ count: number }>(
      sql`select count(*)::int as count from users where deleted_at is null`,
    ),
    db.execute<{ count: number }>(sql`select count(*)::int as count from bookings`),
    db.execute<{ total: string | null }>(
      sql`select sum(total_amount) as total from orders where status = 'COMPLETED'`,
    ),
  ]);

  return {
    totalCarWashes: carWashes.rows[0]?.count ?? 0,
    activeCarWashes: activeCarWashes.rows[0]?.count ?? 0,
    totalUsers: users.rows[0]?.count ?? 0,
    totalBookings: bookings.rows[0]?.count ?? 0,
    totalRevenue: Number(revenue.rows[0]?.total ?? 0),
  };
}

// ---- sales report -----------------------------------------------------------

export type SalesBucket = 'hour' | 'day' | 'week' | 'month';

export interface SalesReportParams {
  carWashId: string;
  /** IANA zone the car wash's days are counted in. */
  timezone: string;
  from: string;
  to: string;
  groupBy?: SalesBucket;
  serviceId?: string;
  categoryId?: string;
  vehicleType?: string;
  paymentStatus?: 'PAID' | 'UNPAID';
  limit: number;
}

export interface SalesTotals {
  revenue: number;
  washes: number;
  average: number;
  customers: number;
  /** Revenue with a payment noted, and what's still owed. */
  collected: number;
  unpaid: number;
  unpaidWashes: number;
}

export interface SalesRow {
  key: string;
  label: string;
  washes: number;
  revenue: number;
}

export interface SalesTransaction {
  id: string;
  completedAt: string;
  amount: number;
  paidAt: string | null;
  paymentMethod: string | null;
  registrationNumber: string;
  vehicleType: string;
  category: { id: string; code: string; name: string } | null;
  customer: { id: string; name: string; phone: string | null };
  services: { serviceId: string; name: string; price: number }[];
}

export interface SalesReport {
  range: { from: string; to: string; days: number };
  timezone: string;
  groupBy: SalesBucket;
  totals: SalesTotals;
  /**
   * The same-length period just before (the previous month(s) for a whole-month range), cut at
   * the same point when the range runs up to now (a day in progress is compared with yesterday
   * up to this time).
   */
  previous: SalesTotals & { from: string; to: string };
  /** Revenue over time, one row per bucket with empty buckets filled in, oldest first. */
  series: SalesRow[];
  /** Hour of day (00-23) the washes were completed, for "busiest hours". */
  byHour: SalesRow[];
  /** A wash with two services counts toward both. */
  byService: SalesRow[];
  /** Vehicle category: Private, Taxi, ... */
  byCategory: SalesRow[];
  /** Body type: SEDAN, SUV, MOTORCYCLE, ... */
  byVehicleType: SalesRow[];
  /** UPI, CASH, or NONE (no payment noted yet). */
  byPayment: SalesRow[];
  /** Newest first, at most `limit` of them; totals.washes is the full count. */
  transactions: SalesTransaction[];
  /** What the filters can be set to. */
  options: {
    services: { id: string; name: string }[];
    categories: { id: string; code: string; name: string }[];
  };
}

const DAY_MS = 86_400_000;
const utcDate = (s: string) => new Date(`${s}T00:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => isoDay(new Date(utcDate(s).getTime() + n * DAY_MS));
/** The Monday starting the week a day falls in. */
const mondayOf = (s: string) => addDays(s, -((utcDate(s).getUTCDay() + 6) % 7));

export function autoBucket(days: number): SalesBucket {
  if (days <= 1) return 'hour';
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

/** Every bucket key in the range, so the chart shows quiet days as zero instead of skipping them. */
function bucketKeys(bucket: SalesBucket, from: string, to: string, seen: string[]): string[] {
  const keys: string[] = [];
  switch (bucket) {
    case 'hour': {
      // Opening hours roughly; widened to cover any wash outside them.
      const hours = seen.map(Number);
      const first = Math.min(7, ...hours);
      const last = Math.max(20, ...hours);
      for (let h = first; h <= last; h++) keys.push(String(h).padStart(2, '0'));
      break;
    }
    case 'day':
      for (let d = from; d <= to; d = addDays(d, 1)) keys.push(d);
      break;
    case 'week':
      for (let d = mondayOf(from); d <= to; d = addDays(d, 7)) keys.push(d);
      break;
    case 'month': {
      const [y0, m0] = from.split('-').map(Number);
      const [y1, m1] = to.split('-').map(Number);
      for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, (m = 1)) : m++) {
        keys.push(`${y}-${String(m).padStart(2, '0')}`);
      }
      break;
    }
  }
  return keys;
}

const BUCKET_SQL: Record<SalesBucket, string> = {
  hour: `to_char(local_at, 'HH24')`,
  day: `to_char(local_at, 'YYYY-MM-DD')`,
  week: `to_char(date_trunc('week', local_at), 'YYYY-MM-DD')`,
  month: `to_char(date_trunc('month', local_at), 'YYYY-MM')`,
};

const VEHICLE_TYPE_LABEL: Record<string, string> = {
  SEDAN: 'Sedan',
  SUV: 'SUV',
  HATCHBACK: 'Hatchback',
  TRUCK: 'Truck',
  VAN: 'Van',
  MOTORCYCLE: 'Two-wheeler',
  OTHER: 'Other',
};
const PAYMENT_LABEL: Record<string, string> = { UPI: 'UPI', CASH: 'Cash', NONE: 'Not paid' };

type AggRow = { key: string; label: string | null; washes: number; revenue: string | null };
const toRows = (
  rows: AggRow[],
  label: (r: AggRow) => string = (r) => r.label ?? r.key,
): SalesRow[] =>
  rows.map((r) => ({
    key: r.key,
    label: label(r),
    washes: r.washes,
    revenue: Number(r.revenue ?? 0),
  }));

export type SalesFilters = Omit<SalesReportParams, 'groupBy' | 'limit'>;

/**
 * The SQL pieces every sales query shares: the range's bounds in the car wash's timezone (cut at
 * now), and `washes(lo, hi)` — the matching completed washes, one row each, with what they count for.
 */
function washScope(p: SalesFilters) {
  const {
    carWashId,
    timezone: tz,
    from,
    to,
    serviceId,
    categoryId,
    vehicleType,
    paymentStatus,
  } = p;
  const days = Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / DAY_MS) + 1;

  const start = sql`((${from}::date)::timestamp at time zone ${tz})`;
  const end = sql`least(((${to}::date + 1)::timestamp at time zone ${tz}), now())`;
  // A whole calendar month (or several) is compared with the months before it, not N days back.
  const months =
    from.endsWith('-01') && addDays(to, 1).endsWith('-01')
      ? (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
        Number(to.slice(5, 7)) -
        Number(from.slice(5, 7)) +
        1
      : 0;
  const shift = months
    ? sql`make_interval(months => ${months}::int)`
    : sql`make_interval(days => ${days}::int)`;

  const amount = serviceId
    ? sql`(select coalesce(sum(bs.price), 0) from booking_services bs where bs.booking_id = b.id and bs.service_id = ${serviceId})`
    : sql`coalesce(o.total_amount, b.price, 0)`;
  const filters = sql.join(
    [
      serviceId
        ? sql`and exists (select 1 from booking_services bs where bs.booking_id = b.id and bs.service_id = ${serviceId})`
        : undefined,
      categoryId ? sql`and vc.id = ${categoryId}` : undefined,
      vehicleType ? sql`and v.vehicle_type = ${vehicleType}` : undefined,
      paymentStatus === 'PAID' ? sql`and o.paid_at is not null` : undefined,
      paymentStatus === 'UNPAID' ? sql`and o.paid_at is null` : undefined,
    ].filter((f): f is SQL => !!f),
    sql` `,
  );

  /** The matching completed washes between two instants, one row each. */
  const washes = (lo: SQL, hi: SQL) => sql`
    select o.id, o.completed_at, o.paid_at, o.payment_method,
      o.completed_at at time zone ${tz} as local_at,
      b.id as booking_id, b.customer_id,
      v.vehicle_type, v.registration_number,
      vc.id as category_id, vc.code as category_code, vc.name as category_name,
      ${amount} as amount
    from orders o
    join bookings b on b.id = o.booking_id
    join vehicles v on v.id = b.vehicle_id
    left join vehicle_categories vc on vc.id = coalesce(
      b.category_id,
      (select id from vehicle_categories where code = b.vehicle_category::text)
    )
    where o.car_wash_id = ${carWashId}
      and o.status = 'COMPLETED'
      and o.completed_at >= ${lo} and o.completed_at < ${hi}
      ${filters}`;
  const current = sql`with w as (${washes(start, end)})`;

  return { days, start, end, shift, washes, current };
}

/**
 * Completed washes in a date range, summed every way the owner's analytics needs. Days are the
 * car wash's local days; a wash counts on the day it was completed (handed over), not booked.
 * With a service filter, each wash counts only what was charged for that service.
 */
export async function getSalesReport(p: SalesReportParams): Promise<SalesReport> {
  const { carWashId, timezone: tz, from, to, serviceId } = p;
  const { days, start, end, shift, washes, current } = washScope(p);
  const groupBy = p.groupBy ?? autoBucket(days);
  const totalsOf = (cte: SQL) =>
    db.execute<{
      revenue: string | null;
      washes: number;
      customers: number;
      collected: string | null;
      unpaid: string | null;
      unpaid_washes: number;
    }>(sql`${cte}
    select coalesce(sum(amount), 0) as revenue, count(*)::int as washes,
      count(distinct customer_id)::int as customers,
      coalesce(sum(amount) filter (where paid_at is not null), 0) as collected,
      coalesce(sum(amount) filter (where paid_at is null), 0) as unpaid,
      (count(*) filter (where paid_at is null))::int as unpaid_washes
    from w`);

  const [
    totals,
    previous,
    previousBounds,
    series,
    byHour,
    byService,
    byCategory,
    byVehicleType,
    byPayment,
    transactions,
    services,
    categories,
  ] = await Promise.all([
    totalsOf(current),
    totalsOf(sql`with w as (${washes(sql`(${start} - ${shift})`, sql`(${end} - ${shift})`)})`),
    db.execute<{ from: string; to: string }>(sql`
      select to_char((${from}::date - ${shift})::date, 'YYYY-MM-DD') as "from",
             to_char(((${to}::date + 1) - ${shift})::date - 1, 'YYYY-MM-DD') as "to"`),
    db.execute<AggRow>(sql`${current}
      select ${sql.raw(BUCKET_SQL[groupBy])} as key, null as label, count(*)::int as washes, sum(amount) as revenue
      from w group by 1`),
    db.execute<AggRow>(sql`${current}
      select ${sql.raw(BUCKET_SQL.hour)} as key, null as label, count(*)::int as washes, sum(amount) as revenue
      from w group by 1 order by 1`),
    db.execute<AggRow>(sql`${current}
      select bs.service_id::text as key, coalesce(s.name, max(bs.name)) as label,
        count(distinct w.id)::int as washes, sum(bs.price) as revenue
      from w
      join booking_services bs on bs.booking_id = w.booking_id
      left join services s on s.id = bs.service_id
      ${serviceId ? sql`where bs.service_id = ${serviceId}` : sql``}
      group by bs.service_id, s.name
      order by revenue desc`),
    db.execute<AggRow>(sql`${current}
      select coalesce(category_id::text, '?') as key, coalesce(max(category_name), 'Vehicle') as label,
        count(*)::int as washes, sum(amount) as revenue
      from w group by 1 order by revenue desc`),
    db.execute<AggRow>(sql`${current}
      select vehicle_type::text as key, null as label, count(*)::int as washes, sum(amount) as revenue
      from w group by 1 order by revenue desc`),
    db.execute<AggRow>(sql`${current}
      select case when paid_at is null then 'NONE' else coalesce(payment_method, 'UPI') end as key,
        null as label, count(*)::int as washes, sum(amount) as revenue
      from w group by 1 order by revenue desc`),
    db.execute<{
      id: string;
      completed_at: Date;
      amount: string;
      paid_at: Date | null;
      payment_method: string | null;
      registration_number: string;
      vehicle_type: string;
      category_id: string | null;
      category_code: string | null;
      category_name: string | null;
      customer_id: string;
      customer_name: string;
      customer_phone: string | null;
      services: { serviceId: string; name: string; price: string }[];
    }>(sql`${current}
      select w.id, w.completed_at, w.amount, w.paid_at, w.payment_method, w.registration_number,
        w.vehicle_type, w.category_id, w.category_code, w.category_name,
        c.id as customer_id, c.name as customer_name, c.phone as customer_phone,
        (select coalesce(json_agg(json_build_object('serviceId', bs.service_id, 'name', bs.name, 'price', bs.price)
            order by bs.sort_order), '[]'::json)
          from booking_services bs where bs.booking_id = w.booking_id) as services
      from w join customers c on c.id = w.customer_id
      order by w.completed_at desc
      limit ${p.limit}`),
    db.execute<{ id: string; name: string }>(sql`
      select id, name from services where car_wash_id = ${carWashId} and deleted_at is null order by name`),
    db.execute<{ id: string; code: string; name: string }>(sql`
      select id, code, name from vehicle_categories order by sort_order, name`),
  ]);

  const summarize = (r: (typeof totals.rows)[number] | undefined): SalesTotals => {
    const revenue = Number(r?.revenue ?? 0);
    const count = r?.washes ?? 0;
    return {
      revenue,
      washes: count,
      average: count ? revenue / count : 0,
      customers: r?.customers ?? 0,
      collected: Number(r?.collected ?? 0),
      unpaid: Number(r?.unpaid ?? 0),
      unpaidWashes: r?.unpaid_washes ?? 0,
    };
  };

  const seriesMap = new Map(series.rows.map((r) => [r.key, r]));
  const filled = bucketKeys(
    groupBy,
    from,
    to,
    series.rows.map((r) => r.key),
  ).map((key) => ({
    key,
    label: key,
    washes: seriesMap.get(key)?.washes ?? 0,
    revenue: Number(seriesMap.get(key)?.revenue ?? 0),
  }));

  return {
    range: { from, to, days },
    timezone: tz,
    groupBy,
    totals: summarize(totals.rows[0]),
    previous: { ...summarize(previous.rows[0]), ...previousBounds.rows[0] },
    series: filled,
    byHour: toRows(byHour.rows),
    byService: toRows(byService.rows),
    byCategory: toRows(byCategory.rows),
    byVehicleType: toRows(byVehicleType.rows, (r) => VEHICLE_TYPE_LABEL[r.key] ?? r.key),
    byPayment: toRows(byPayment.rows, (r) => PAYMENT_LABEL[r.key] ?? r.key),
    transactions: transactions.rows.map((t) => ({
      id: t.id,
      completedAt: new Date(t.completed_at).toISOString(),
      amount: Number(t.amount),
      paidAt: t.paid_at ? new Date(t.paid_at).toISOString() : null,
      paymentMethod: t.payment_method,
      registrationNumber: t.registration_number,
      vehicleType: t.vehicle_type,
      category: t.category_id
        ? { id: t.category_id, code: t.category_code ?? '', name: t.category_name ?? '' }
        : null,
      customer: { id: t.customer_id, name: t.customer_name, phone: t.customer_phone },
      services: t.services.map((s) => ({ ...s, price: Number(s.price) })),
    })),
    options: { services: services.rows, categories: categories.rows },
  };
}

// ---- customers behind the sales (promotion audiences) ----------------------

export interface AudienceParams extends SalesFilters {
  /** Only customers with at least this many washes in the range. */
  minVisits: number;
  /** Only customers who haven't had a wash since the range ended. */
  notReturned: boolean;
}

export interface AudienceCustomer {
  id: string;
  name: string;
  phone: string | null;
  visits: number;
  spent: number;
  firstVisit: string;
  lastVisit: string;
  /** They had another wash after the range ended. */
  returned: boolean;
  vehicles: { registrationNumber: string; vehicleType: string; category: string | null }[];
  /** Services they had in these washes, most frequent first. */
  services: string[];
}

/** Most customers one audience lists. */
export const MAX_AUDIENCE = 2000;

/** The customers behind the matching washes, newest visit first: who a promotion can go to. */
export async function getCustomerAudience(p: AudienceParams): Promise<{
  customers: AudienceCustomer[];
  truncated: boolean;
}> {
  const { carWashId } = p;
  const { end, current } = washScope(p);
  const rows = await db.execute<{
    id: string;
    name: string;
    phone: string | null;
    visits: number;
    spent: string;
    first_visit: string;
    last_visit: string;
    returned: boolean;
    vehicles: AudienceCustomer['vehicles'];
    services: string[] | null;
  }>(sql`${current}
    select c.id, c.name, c.phone, count(*)::int as visits, sum(w.amount) as spent,
      to_char(min(w.local_at), 'YYYY-MM-DD') as first_visit,
      to_char(max(w.local_at), 'YYYY-MM-DD') as last_visit,
      exists (
        select 1 from orders o2 join bookings b2 on b2.id = o2.booking_id
        where o2.car_wash_id = ${carWashId} and b2.customer_id = c.id
          and o2.status = 'COMPLETED' and o2.completed_at >= ${end}
      ) as returned,
      json_agg(distinct jsonb_build_object(
        'registrationNumber', w.registration_number,
        'vehicleType', w.vehicle_type,
        'category', w.category_name
      )) as vehicles,
      (select array_agg(name order by n desc, name) from (
        select bs.name, count(*) as n from booking_services bs
        where bs.booking_id in (select booking_id from w w2 where w2.customer_id = c.id)
        group by bs.name
      ) svc) as services
    from w join customers c on c.id = w.customer_id
    where c.deleted_at is null
    group by c.id, c.name, c.phone
    having count(*) >= ${p.minVisits}::int
    order by max(w.completed_at) desc
    limit ${MAX_AUDIENCE + 1}`);

  const customers = rows.rows
    .slice(0, MAX_AUDIENCE)
    .map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      visits: r.visits,
      spent: Number(r.spent ?? 0),
      firstVisit: r.first_visit,
      lastVisit: r.last_visit,
      returned: r.returned,
      vehicles: r.vehicles,
      services: r.services ?? [],
    }))
    .filter((c) => !(p.notReturned && c.returned));
  return { customers, truncated: rows.rows.length > MAX_AUDIENCE };
}
