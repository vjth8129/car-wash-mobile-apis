import { sql } from 'drizzle-orm';
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
