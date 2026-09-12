import * as roleRepo from '../repositories/role.repository';
import { findPermissionsByIds } from '../repositories/permission.repository';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { AuthenticatedUser } from '../types/express';
import { SYSTEM_ROLES } from '../constants/roles';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { Request } from 'express';

function isSuperAdmin(user: AuthenticatedUser): boolean {
  return user.roleName === SYSTEM_ROLES.SUPER_ADMIN;
}

function serializeRole(role: any) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    carWashId: role.carWashId,
    isSystem: role.isSystem,
    permissions: (role.rolePermissions ?? []).map((rp: any) => ({
      id: rp.permission.id,
      key: rp.permission.key,
      name: rp.permission.name,
    })),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

export async function listRoles(user: AuthenticatedUser) {
  // SUPER_ADMIN (carWashId=null) sees every role in the system; tenant users see their
  // own car wash's custom roles plus the global system role templates.
  const roles = await roleRepo.listRolesForCarWash(user.carWashId);
  return roles.map(serializeRole);
}

export async function getRole(user: AuthenticatedUser, id: string) {
  const role = await roleRepo.findRoleById(id);
  if (!role) throw new NotFoundError('Role not found');
  if (!isSuperAdmin(user) && role.carWashId !== null && role.carWashId !== user.carWashId) {
    throw new ForbiddenError('You do not have access to this role');
  }
  return serializeRole(role);
}

async function assertDelegatablePermissions(user: AuthenticatedUser, permissionIds: string[]) {
  if (isSuperAdmin(user)) return;
  const requested = await findPermissionsByIds(permissionIds);
  const notOwned = requested.filter((p) => !user.permissions.includes(p.key));
  if (notOwned.length > 0) {
    throw new ForbiddenError(
      `Cannot grant permissions you do not hold: ${notOwned.map((p) => p.key).join(', ')}`,
    );
  }
}

export async function createRole(
  user: AuthenticatedUser,
  input: { name: string; description?: string; permissionIds: string[] },
  req?: Request,
) {
  if (!isSuperAdmin(user) && !user.carWashId) {
    throw new ForbiddenError('User is not associated with a car wash');
  }
  const carWashId = isSuperAdmin(user) ? null : user.carWashId;

  const existing = await roleRepo.findRoleByName(input.name, carWashId);
  if (existing) {
    throw new ConflictError(`A role named "${input.name}" already exists`);
  }

  await assertDelegatablePermissions(user, input.permissionIds);

  const role = await roleRepo.createRole({
    name: input.name,
    description: input.description,
    carWashId,
    isSystem: false,
  });
  await roleRepo.setRolePermissions(role.id, input.permissionIds);

  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.ROLE_CREATED,
    entityType: 'ROLE',
    entityId: role.id,
    metadata: { name: role.name },
  });

  return getRole(user, role.id);
}

export async function updateRole(
  user: AuthenticatedUser,
  id: string,
  input: { name?: string; description?: string; permissionIds?: string[] },
  req?: Request,
) {
  const role = await roleRepo.findRoleById(id);
  if (!role) throw new NotFoundError('Role not found');
  if (!isSuperAdmin(user) && role.carWashId !== user.carWashId) {
    throw new ForbiddenError('You do not have access to this role');
  }
  if (role.isSystem) {
    throw new ForbiddenError('System roles cannot be modified');
  }

  if (input.permissionIds) {
    await assertDelegatablePermissions(user, input.permissionIds);
    await roleRepo.setRolePermissions(role.id, input.permissionIds);
  }
  if (input.name || input.description !== undefined) {
    await roleRepo.updateRole(role.id, { name: input.name, description: input.description });
  }

  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.ROLE_UPDATED,
    entityType: 'ROLE',
    entityId: role.id,
  });

  return getRole(user, id);
}

export async function deleteRole(user: AuthenticatedUser, id: string, req?: Request) {
  const role = await roleRepo.findRoleById(id);
  if (!role) throw new NotFoundError('Role not found');
  if (!isSuperAdmin(user) && role.carWashId !== user.carWashId) {
    throw new ForbiddenError('You do not have access to this role');
  }
  if (role.isSystem) {
    throw new ForbiddenError('System roles cannot be deleted');
  }
  const usersWithRole = await roleRepo.countUsersWithRole(id);
  if (usersWithRole > 0) {
    throw new ValidationError('Cannot delete a role that is currently assigned to users');
  }
  await roleRepo.deleteRole(id);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.ROLE_DELETED,
    entityType: 'ROLE',
    entityId: id,
  });
}
