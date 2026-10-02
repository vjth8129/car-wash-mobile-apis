import { Request } from 'express';
import * as paymentQrRepo from '../repositories/payment-qr.repository';
import { ForbiddenError } from '../utils/errors';
import { AuthenticatedUser } from '../types/express';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';

/** The payment QR always belongs to the caller's own car wash (never chosen by the client). */
function ownCarWashId(user: AuthenticatedUser): string {
  if (!user.carWashId) throw new ForbiddenError('User is not associated with a car wash');
  return user.carWashId;
}

function serialize(row: { image: string; note: string | null; updatedAt: Date }) {
  return { image: row.image, note: row.note, updatedAt: row.updatedAt };
}

export async function getPaymentQr(user: AuthenticatedUser) {
  const row = await paymentQrRepo.findPaymentQr(ownCarWashId(user));
  return row ? serialize(row) : null;
}

export async function setPaymentQr(
  user: AuthenticatedUser,
  input: { image: string; note?: string },
  req?: Request,
) {
  const carWashId = ownCarWashId(user);
  const row = await paymentQrRepo.upsertPaymentQr({
    carWashId,
    image: input.image,
    note: input.note || null,
    updatedBy: user.id,
  });
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.CAR_WASH_UPDATED,
    entityType: 'CAR_WASH',
    entityId: carWashId,
    metadata: { paymentQr: 'updated' },
  });
  return serialize(row);
}

export async function removePaymentQr(user: AuthenticatedUser, req?: Request) {
  const carWashId = ownCarWashId(user);
  await paymentQrRepo.deletePaymentQr(carWashId);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.CAR_WASH_UPDATED,
    entityType: 'CAR_WASH',
    entityId: carWashId,
    metadata: { paymentQr: 'removed' },
  });
}
