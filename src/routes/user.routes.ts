import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { requirePermission } from '../middlewares/authorize.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createUserSchema,
  updateUserSchema,
  updateUserStatusSchema,
  resetUserPasswordSchema,
  userIdParamSchema,
  listUsersQuerySchema,
} from '../validators/user.validator';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List users within the current user's car wash
 *     description: Tenant-scoped - results are always filtered to the caller's own car wash (platform admins see all).
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ACTIVE, INACTIVE, SUSPENDED] }
 *     responses:
 *       200: { description: List of users }
 *   post:
 *     tags: [Users]
 *     summary: Create a user within the current user's car wash
 *     description: The new user is automatically scoped to the creator's car wash; the caller may only assign roles/permissions they themselves hold.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password, name, roleId]
 *             properties:
 *               username: { type: string }
 *               password: { type: string, format: password }
 *               name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               roleId: { type: string, format: uuid }
 *     responses:
 *       201: { description: User created }
 */
router.get(
  '/',
  requirePermission(PERMISSIONS.USERS_VIEW),
  validate({ query: listUsersQuerySchema }),
  userController.listUsers,
);
router.post(
  '/',
  requirePermission(PERMISSIONS.USERS_CREATE),
  validate({ body: createUserSchema }),
  userController.createUser,
);

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get a user by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: User detail }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *   patch:
 *     tags: [Users]
 *     summary: Update a user's profile or role
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: User updated }
 *   delete:
 *     tags: [Users]
 *     summary: Remove a user (soft delete)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: User deleted }
 */
router.get(
  '/:id',
  requirePermission(PERMISSIONS.USERS_VIEW),
  validate({ params: userIdParamSchema }),
  userController.getUser,
);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.USERS_UPDATE),
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  userController.updateUser,
);
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.USERS_DELETE),
  validate({ params: userIdParamSchema }),
  userController.deleteUser,
);

/**
 * @openapi
 * /users/{id}/status:
 *   patch:
 *     tags: [Users]
 *     summary: Activate, deactivate, or suspend a user
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [ACTIVE, INACTIVE, SUSPENDED] }
 *     responses:
 *       200: { description: Status updated }
 */
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.USERS_UPDATE),
  validate({ params: userIdParamSchema, body: updateUserStatusSchema }),
  userController.updateUserStatus,
);

/**
 * @openapi
 * /users/{id}/reset-password:
 *   post:
 *     tags: [Users]
 *     summary: Administratively reset a user's password
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPassword]
 *             properties:
 *               newPassword: { type: string, format: password }
 *     responses:
 *       200: { description: Password reset }
 */
router.post(
  '/:id/reset-password',
  requirePermission(PERMISSIONS.USERS_UPDATE),
  validate({ params: userIdParamSchema, body: resetUserPasswordSchema }),
  userController.resetUserPassword,
);

export default router;
