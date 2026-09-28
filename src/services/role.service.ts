import * as roleRepo from '../repositories/role.repository';
import {
  findPermissionsByIds,
  findRoleOverridePermissions,
  PermissionSummary,
} from '../repositories/permission.repository';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { AuthenticatedUser } from '../types/express';
import { SYSTEM_ROLES } from '../constants/roles';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { Request } from 'express';

function isSuperAdmin(user: AuthenticatedUser): boolean {
  return user.roleName === SYSTEM_ROLES.SUPER_ADMIN;
}

function defaultPermissions(role: any): PermissionSummary[] {
  return (role.rolePermissions ?? []).map((rp: any) => ({
    id: rp.permission.id,
    key: rp.permission.key,
    name: rp.permission.name,
  }));
}

/**
 * `permissions` is what the role grants in the caller's car wash: the car wash's override
 * for a system role when one exists (`isCustomized: true`), otherwise the defaults.
 */
function serializeRole(role: any, override: PermissionSummary[] | null = null) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    carWashId: role.carWashId,
    isSystem: role.isSystem,
    isCustomized: override !== null,
    permissions: override ?? defaultPermissions(role),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

export async function listRoles(user: AuthenticatedUser) {
  // SUPER_ADMIN (carWashId=null) sees every role in the system; tenant users see their
  // own car wash's custom roles plus the global system role templates.
  const roles = await roleRepo.listRolesForCarWash(user.carWashId);
  const overrides = user.carWashId
    ? await roleRepo.listRoleOverridesForCarWash(user.carWashId)
    : new Map<string, PermissionSummary[]>();
  return roles.map((role) => serializeRole(role, overrides.get(role.id) ?? null));
}

export async function getRole(user: AuthenticatedUser, id: string) {
  const role = await roleRepo.findRoleById(id);
  if (!role) throw new NotFoundError('Role not found');
  if (!isSuperAdmin(user) && role.carWashId !== null && role.carWashId !== user.carWashId) {
    throw new ForbiddenError('You do not have access to this role');
  }
  const override =
    role.isSystem && user.carWashId
      ? await findRoleOverridePermissions(user.carWashId, role.id)
      : null;
  return serializeRole(role, override);
}

/**
 * A caller may only hand out permissions they hold themselves. Only permissions being
 * *added* are checked, so removing permissions (or keeping ones the caller lacks) is fine.
 */
async function assertDelegatablePermissions(
  user: AuthenticatedUser,
  permissionIds: string[],
  currentPermissionIds: string[] = [],
) {
  if (isSuperAdmin(user)) return;
  const added = permissionIds.filter((id) => !currentPermissionIds.includes(id));
  const requested = await findPermissionsByIds(added);
  if (requested.length !== new Set(added).size) {
    throw new ValidationError('One or more permissions do not exist');
  }
  const notOwned = requested.filter((p) => !user.permissions.includes(p.key));
  if (notOwned.length > 0) {
    throw new ForbiddenError(
      `Cannot grant permissions you do not hold: ${notOwned.map((p) => p.key).join(', ')}`,
    );
  }
}

/**
 * Guards for a car wash customising a global (system) role. Returns the permissions the
 * role currently grants in that car wash.
 */
async function assertCanCustomizeSystemRole(user: AuthenticatedUser, role: any) {
  if (isSuperAdmin(user) || !user.carWashId) {
    throw new ForbiddenError('System roles cannot be modified globally');
  }
  if (role.name === SYSTEM_ROLES.SUPER_ADMIN) {
    throw new ForbiddenError('The SUPER_ADMIN role cannot be modified');
  }
  if (role.id === user.roleId) {
    // Otherwise an owner could remove their own ROLES_UPDATE and lock everyone out.
    throw new ForbiddenError('You cannot change the permissions of your own role');
  }
  const override = await findRoleOverridePermissions(user.carWashId, role.id);
  return override ?? defaultPermissions(role);
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

  if (role.isSystem) {
    // Built-in roles are shared by every car wash: a car wash edits its own copy of the
    // permission set (an override) and can't rename them.
    const current = await assertCanCustomizeSystemRole(user, role);
    if (
      (input.name !== undefined && input.name !== role.name) ||
      (input.description !== undefined && input.description !== (role.description ?? ''))
    ) {
      throw new ValidationError(
        'Built-in roles cannot be renamed; only their permissions can change',
      );
    }
    if (input.permissionIds) {
      await assertDelegatablePermissions(
        user,
        input.permissionIds,
        current.map((p) => p.id),
      );
      await roleRepo.setRoleOverride(user.carWashId!, role.id, [...new Set(input.permissionIds)]);
    }
    await recordAuditLog({
      req,
      action: AUDIT_ACTIONS.ROLE_UPDATED,
      entityType: 'ROLE',
      entityId: role.id,
      metadata: { customized: true },
    });
    return getRole(user, id);
  }

  if (!isSuperAdmin(user) && role.carWashId !== user.carWashId) {
    throw new ForbiddenError('You do not have access to this role');
  }
  if (role.id === user.roleId && input.permissionIds) {
    throw new ForbiddenError('You cannot change the permissions of your own role');
  }

  if (input.permissionIds) {
    await assertDelegatablePermissions(
      user,
      input.permissionIds,
      defaultPermissions(role).map((p) => p.id),
    );
    await roleRepo.setRolePermissions(role.id, [...new Set(input.permissionIds)]);
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

/** Put a built-in role back to its default permissions for the caller's car wash. */
export async function resetRole(user: AuthenticatedUser, id: string, req?: Request) {
  const role = await roleRepo.findRoleById(id);
  if (!role) throw new NotFoundError('Role not found');
  if (!role.isSystem) {
    throw new ValidationError('Only built-in roles can be reset to their defaults');
  }
  await assertCanCustomizeSystemRole(user, role);
  await roleRepo.deleteRoleOverride(user.carWashId!, role.id);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.ROLE_UPDATED,
    entityType: 'ROLE',
    entityId: role.id,
    metadata: { resetToDefaults: true },
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
