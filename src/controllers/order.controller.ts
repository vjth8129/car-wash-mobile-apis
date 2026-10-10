import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess, sendList } from '../utils/api-response';
import { parsePaginationQuery } from '../utils/pagination';
import * as orderService from '../services/order.service';
import { ForbiddenError } from '../utils/errors';

function carWashIdOf(req: Request): string {
  if (!req.user?.carWashId) throw new ForbiddenError('User is not associated with a car wash');
  return req.user.carWashId;
}

export const listOrders = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePaginationQuery(req.query as Record<string, unknown>);
  const { status, paymentStatus } = req.query as {
    status?: string;
    paymentStatus?: 'PAID' | 'UNPAID';
  };
  const { rows, pagination: paginationResult } = await orderService.listOrders(
    carWashIdOf(req),
    pagination,
    { status, paymentStatus },
  );
  sendList(res, rows, paginationResult);
});

export const getOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.getOrder(carWashIdOf(req), req.params.id);
  sendSuccess(res, order);
});

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.createOrder(
    req.user!,
    carWashIdOf(req),
    req.body.bookingId,
    req,
  );
  sendSuccess(res, order, 201);
});

export const recordPayment = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.recordPayment(
    req.user!,
    carWashIdOf(req),
    req.params.id,
    req.body.method,
    req,
  );
  sendSuccess(res, order);
});

export const updateOrderStatus = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.updateOrderStatus(
    carWashIdOf(req),
    req.params.id,
    req.body.status,
    req,
  );
  sendSuccess(res, order);
});
