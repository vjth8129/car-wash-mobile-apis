import { eq } from 'drizzle-orm';
import { db } from '../db';
import { menus, Menu, NewMenu } from '../db/schema';

export interface MenuWithPermissions extends Menu {
  permission: { key: string } | null;
  menuPermissions: { permission: { key: string } }[];
}

export async function getAllActiveMenus(): Promise<MenuWithPermissions[]> {
  const rows = await db.query.menus.findMany({
    where: eq(menus.isActive, true),
    with: {
      permission: { columns: { key: true } },
      menuPermissions: { with: { permission: { columns: { key: true } } } },
    },
    orderBy: (m, { asc }) => [asc(m.sortOrder)],
  });
  return rows as unknown as MenuWithPermissions[];
}

export async function createMenu(data: NewMenu): Promise<Menu> {
  const [row] = await db.insert(menus).values(data).returning();
  return row;
}

export async function findMenuByKey(key: string): Promise<Menu | undefined> {
  return db.query.menus.findFirst({ where: eq(menus.key, key) });
}
