import { getAllActiveMenus, MenuWithPermissions } from '../repositories/menu.repository';
import { findCarWashById } from '../repositories/car-wash.repository';
import { AuthenticatedUser } from '../types/express';
import { env } from '../config/env';

interface MenuNode {
  key: string;
  title: string;
  icon: string | null;
  route: string | null;
  permission: string | null;
  children: MenuNode[];
}

function isVisible(menu: MenuWithPermissions, permissions: string[]): boolean {
  const requiredKeys = [
    ...(menu.permission ? [menu.permission.key] : []),
    ...menu.menuPermissions.map((mp) => mp.permission.key),
  ];
  // No permission requirement at all => always visible to any authenticated user.
  if (requiredKeys.length === 0) return true;
  return requiredKeys.some((key) => permissions.includes(key));
}

export async function getMenuForUser(user: AuthenticatedUser) {
  const allMenus = await getAllActiveMenus();
  const visible = allMenus.filter((m) => isVisible(m, user.permissions));
  const visibleIds = new Set(visible.map((m) => m.id));

  const nodeById = new Map<string, MenuNode>();
  for (const menu of visible) {
    nodeById.set(menu.id, {
      key: menu.key,
      title: menu.title,
      icon: menu.icon,
      route: menu.route,
      permission: menu.permission?.key ?? null,
      children: [],
    });
  }

  const roots: MenuNode[] = [];
  for (const menu of visible) {
    const node = nodeById.get(menu.id)!;
    if (menu.parentId && visibleIds.has(menu.parentId)) {
      nodeById.get(menu.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return { menus: roots };
}

export async function getAppConfig(carWashId?: string | null) {
  const carWash = carWashId ? await findCarWashById(carWashId) : undefined;
  return {
    appName: carWash?.name ?? 'Car Wash',
    currency: carWash?.currency ?? 'INR',
    timezone: carWash?.timezone ?? 'Asia/Kolkata',
    environment: env.NODE_ENV,
    features: {
      onlineBooking: true,
      payments: true,
      loyalty: false,
    },
  };
}
