import { Router } from 'express';
import * as bookingController from '../controllers/booking.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { requirePermission } from '../middlewares/authorize.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createBookingSchema,
  updateBookingSchema,
  bookingIdParamSchema,
  listBookingsQuerySchema,
  cancelBookingSchema,
} from '../validators/booking.validator';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /bookings:
 *   get:
 *     tags: [Bookings]
 *     summary: List bookings within the current user's car wash
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW] }
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: List of bookings }
 *   post:
 *     tags: [Bookings]
 *     summary: Create a booking
 *     description: customerId, vehicleId and serviceId must all belong to the caller's car wash; endTime is derived from the service duration and overlapping bookings for the same vehicle are rejected. The response's price is set by the server - the service's taxiPrice for TAXI bookings (when set), otherwise its price - and is kept even if the service's rates change later.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, vehicleId, serviceId, bookingDate, startTime]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               vehicleId: { type: string, format: uuid }
 *               serviceId: { type: string, format: uuid }
 *               bookingDate: { type: string, format: date }
 *               startTime: { type: string, example: "14:30" }
 *               notes: { type: string }
 *               vehicleCategory: { type: string, enum: [PRIVATE, TAXI], default: PRIVATE, description: Decides which service rate is charged }
 *     responses:
 *       201: { description: Booking created }
 *       409:
 *         description: Overlapping booking conflict
 */
router.get(
  '/',
  requirePermission(PERMISSIONS.BOOKINGS_VIEW),
  validate({ query: listBookingsQuerySchema }),
  bookingController.listBookings,
);
router.post(
  '/',
  requirePermission(PERMISSIONS.BOOKINGS_CREATE),
  validate({ body: createBookingSchema }),
  bookingController.createBooking,
);

/**
 * @openapi
 * /bookings/{id}:
 *   get:
 *     tags: [Bookings]
 *     summary: Get a booking by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Booking detail }
 *   patch:
 *     tags: [Bookings]
 *     summary: Update a booking (only while PENDING or CONFIRMED)
 *     description: Changing serviceId or vehicleCategory re-prices the booking from the service's current rates.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vehicleId: { type: string, format: uuid }
 *               serviceId: { type: string, format: uuid }
 *               bookingDate: { type: string, format: date }
 *               startTime: { type: string, example: "14:30" }
 *               notes: { type: string }
 *               vehicleCategory: { type: string, enum: [PRIVATE, TAXI] }
 *     responses:
 *       200: { description: Booking updated }
 */
router.get(
  '/:id',
  requirePermission(PERMISSIONS.BOOKINGS_VIEW),
  validate({ params: bookingIdParamSchema }),
  bookingController.getBooking,
);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.BOOKINGS_UPDATE),
  validate({ params: bookingIdParamSchema, body: updateBookingSchema }),
  bookingController.updateBooking,
);

/**
 * @openapi
 * /bookings/{id}/cancel:
 *   post:
 *     tags: [Bookings]
 *     summary: Cancel a booking
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Booking cancelled }
 */
router.post(
  '/:id/cancel',
  requirePermission(PERMISSIONS.BOOKINGS_CANCEL),
  validate({ params: bookingIdParamSchema, body: cancelBookingSchema }),
  bookingController.cancelBooking,
);

/**
 * @openapi
 * /bookings/{id}/complete:
 *   post:
 *     tags: [Bookings]
 *     summary: Mark a booking as completed
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Booking completed }
 */
router.post(
  '/:id/complete',
  requirePermission(PERMISSIONS.BOOKINGS_UPDATE),
  validate({ params: bookingIdParamSchema }),
  bookingController.completeBooking,
);

export default router;
