import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface AuthenticatedUser {
      id: string;
      name: string;
      email: string;
      role: Role;
      isActive: boolean;
    }

    interface Request {
      /** Preenchido pelo middleware authenticate. */
      user?: AuthenticatedUser;
    }
  }
}

export {};
