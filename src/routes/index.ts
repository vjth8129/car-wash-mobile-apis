import { Router } from 'express';
import authRoutes from './auth.routes';
import appRoutes from './app.routes';
import carWashRoutes from './car-wash.routes';
import userRoutes from './user.routes';
import roleRoutes from './role.routes';
import permissionRoutes from './permission.routes';
import serviceRoutes from './service.routes';
import customerRoutes from './customer.routes';
import vehicleRoutes from './vehicle.routes';
import bookingRoutes from './booking.routes';
import orderRoutes from './order.routes';
import reportRoutes from './report.routes';
import vehicleCategoryRoutes from './vehicle-category.routes';
import promotionRoutes from './promotion.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/app', appRoutes);
router.use('/car-washes', carWashRoutes);
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);
router.use('/permissions', permissionRoutes);
router.use('/services', serviceRoutes);
router.use('/customers', customerRoutes);
router.use('/vehicles', vehicleRoutes);
router.use('/bookings', bookingRoutes);
router.use('/orders', orderRoutes);
router.use('/reports', reportRoutes);
router.use('/vehicle-categories', vehicleCategoryRoutes);
router.use('/promotions', promotionRoutes);

export default router;
