import { eq } from 'drizzle-orm';
import { db } from '../db';
import { carWashPaymentQrs } from '../db/schema';

export async function findPaymentQr(carWashId: string) {
  return db.query.carWashPaymentQrs.findFirst({
    where: eq(carWashPaymentQrs.carWashId, carWashId),
  });
}

export async function upsertPaymentQr(data: {
  carWashId: string;
  image: string;
  note: string | null;
  updatedBy: string;
}) {
  const values = { ...data, updatedAt: new Date() };
  const [row] = await db
    .insert(carWashPaymentQrs)
    .values(values)
    .onConflictDoUpdate({ target: carWashPaymentQrs.carWashId, set: values })
    .returning();
  return row;
}

export async function deletePaymentQr(carWashId: string) {
  await db.delete(carWashPaymentQrs).where(eq(carWashPaymentQrs.carWashId, carWashId));
}
