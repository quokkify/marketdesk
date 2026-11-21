// Express Request augmentation. AuthMiddleware attaches the authenticated principal
// (extracted from the JWT) so downstream controllers can read workspace/user context.

import 'express';
import type { AuthUserRecord } from '../ports/IAuthUserStore';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        workspaceId?: string;
        tokenVersion: number;
        /** The `iat` claim, in seconds. */
        issuedAt: number;
      };
      currentUser?: AuthUserRecord;
    }
  }
}

export {};
