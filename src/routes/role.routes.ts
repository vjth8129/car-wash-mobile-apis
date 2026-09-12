import { Router } from 'express';
import * as roleController from '../controllers/role.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { requirePermission } from '../middlewares/authorize.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createRoleSchema,
  updateRoleSchema,
  roleIdParamSchema,
} from '../validators/role.validator';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /roles:
 *   get:
 *     tags: [Roles]
 *     summary: List roles visible to the current user's car wash
 *     responses:
 *       200: { description: List of roles }
 *   post:
 *     tags: [Roles]
 *     summary: Create a custom role with a set of permissions
 *     description: A caller may only grant permissions they themselves hold.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: Receptionist }
 *               description: { type: string }
 *               permissionIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Role created }
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.get('/', requirePermission(PERMISSIONS.ROLES_VIEW), roleController.listRoles);
router.post(
  '/',
  requirePermission(PERMISSIONS.ROLES_CREATE),
  validate({ body: createRoleSchema }),
  roleController.createRole,
);

/**
 * @openapi
 * /roles/{id}:
 *   get:
 *     tags: [Roles]
 *     summary: Get a role by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Role detail }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *   patch:
 *     tags: [Roles]
 *     summary: Update a role's name, description, or permissions
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Role updated }
 *   delete:
 *     tags: [Roles]
 *     summary: Delete a role (must have no assigned users)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Role deleted }
 */
router.get(
  '/:id',
  requirePermission(PERMISSIONS.ROLES_VIEW),
  validate({ params: roleIdParamSchema }),
  roleController.getRole,
);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.ROLES_UPDATE),
  validate({ params: roleIdParamSchema, body: updateRoleSchema }),
  roleController.updateRole,
);
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.ROLES_DELETE),
  validate({ params: roleIdParamSchema }),
  roleController.deleteRole,
);

export default router;
