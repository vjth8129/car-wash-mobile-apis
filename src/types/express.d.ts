import 'express';

export interface AuthenticatedUser {
  id: string;
  username: string;
  name: string;
  carWashId: string | null;
  roleId: string;
  roleName: string;
  permissions: string[];
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
    requestId?: string;
  }
}
