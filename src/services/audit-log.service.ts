import { Request } from 'express';
import { db } from '../db';
import { auditLogs } from '../db/schema';

export const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
  USER_STATUS_CHANGED: 'USER_STATUS_CHANGED',
  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_UPDATED: 'ROLE_UPDATED',
  ROLE_DELETED: 'ROLE_DELETED',
  SERVICE_CREATED: 'SERVICE_CREATED',
  SERVICE_UPDATED: 'SERVICE_UPDATED',
  SERVICE_DELETED: 'SERVICE_DELETED',
  CUSTOMER_CREATED: 'CUSTOMER_CREATED',
  CUSTOMER_UPDATED: 'CUSTOMER_UPDATED',
  CUSTOMER_DELETED: 'CUSTOMER_DELETED',
  VEHICLE_CREATED: 'VEHICLE_CREATED',
  VEHICLE_UPDATED: 'VEHICLE_UPDATED',
  VEHICLE_DELETED: 'VEHICLE_DELETED',
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_UPDATED: 'BOOKING_UPDATED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_COMPLETED: 'BOOKING_COMPLETED',
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_UPDATED: 'ORDER_UPDATED',
  ORDER_PAYMENT_RECORDED: 'ORDER_PAYMENT_RECORDED',
  VEHICLE_CATEGORY_CREATED: 'VEHICLE_CATEGORY_CREATED',
  VEHICLE_CATEGORY_UPDATED: 'VEHICLE_CATEGORY_UPDATED',
  CAR_WASH_CREATED: 'CAR_WASH_CREATED',
  CAR_WASH_UPDATED: 'CAR_WASH_UPDATED',
  CAR_WASH_DELETED: 'CAR_WASH_DELETED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;

interface AuditLogInput {
  req?: Request;
  userId?: string | null;
  carWashId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAuditLog(input: AuditLogInput): Promise<void> {
  const { req } = input;
  await db.insert(auditLogs).values({
    userId: input.userId ?? req?.user?.id ?? null,
    carWashId: input.carWashId ?? req?.user?.carWashId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? null,
    ipAddress: req?.ip ?? null,
    userAgent: req?.headers['user-agent'] ?? null,
  });
}
