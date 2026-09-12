import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess, sendList } from '../utils/api-response';
import { parsePaginationQuery } from '../utils/pagination';
import * as bookingService from '../services/booking.service';
import { ForbiddenError } from '../utils/errors';

function carWashIdOf(req: Request): string {
  if (!req.user?.carWashId) throw new ForbiddenError('User is not associated with a car wash');
  return req.user.carWashId;
}

export const listBookings = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePaginationQuery(req.query as Record<string, unknown>);
  const { status, dateFrom, dateTo, customerId } = req.query as Record<string, string | undefined>;
  const { rows, pagination: paginationResult } = await bookingService.listBookings(
    carWashIdOf(req),
    pagination,
    { status, dateFrom, dateTo, customerId },
  );
  sendList(res, rows, paginationResult);
});

export const getBooking = asyncHandler(async (req: Request, res: Response) => {
  const booking = await bookingService.getBooking(carWashIdOf(req), req.params.id);
  sendSuccess(res, booking);
});

export const createBooking = asyncHandler(async (req: Request, res: Response) => {
  const booking = await bookingService.createBooking(req.user!, carWashIdOf(req), req.body, req);
  sendSuccess(res, booking, 201);
});

export const updateBooking = asyncHandler(async (req: Request, res: Response) => {
  const booking = await bookingService.updateBooking(
    carWashIdOf(req),
    req.params.id,
    req.body,
    req,
  );
  sendSuccess(res, booking);
});

export const cancelBooking = asyncHandler(async (req: Request, res: Response) => {
  const booking = await bookingService.cancelBooking(carWashIdOf(req), req.params.id, req);
  sendSuccess(res, booking);
});

export const completeBooking = asyncHandler(async (req: Request, res: Response) => {
  const booking = await bookingService.completeBooking(carWashIdOf(req), req.params.id, req);
  sendSuccess(res, booking);
});
