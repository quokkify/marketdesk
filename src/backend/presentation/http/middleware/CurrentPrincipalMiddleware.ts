import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES } from '../../../../shared/constants';
import type { IAuthUserStore } from '../ports/IAuthUserStore';
import { env } from '../../../config/env';
import { signToken } from './AuthMiddleware';
import { fail } from '../formatters/ResponseFormatter';

export const RENEWED_TOKEN_HEADER = 'X-Renewed-Token';

function unauthorized(res: Response, message: string): void {
  fail(res, undefined, 401, { code: ERROR_CODES.UNAUTHORIZED, message });
}

// Loads the user behind the verified JWT and refuses a token whose version no longer matches.
// Answers 401 itself and returns false when the request must stop; sets req.currentUser otherwise.
async function checkCurrentUser(
  users: IAuthUserStore,
  req: Request,
  res: Response,
  renew: boolean,
): Promise<boolean> {
  const jwtPrincipal = req.user!;
  const current = await users.findById(jwtPrincipal.userId);
  if (!current) {
    unauthorized(res, 'Authenticated user no longer exists');
    return false;
  }
  if (current.tokenVersion !== jwtPrincipal.tokenVersion) {
    unauthorized(res, 'Session has been revoked');
    return false;
  }
  req.currentUser = current;
  if (renew && Date.now() - jwtPrincipal.issuedAt * 1000 > env.jwt.renewAfterMs) {
    res.setHeader(
      RENEWED_TOKEN_HEADER,
      signToken({
        userId: current.id,
        workspaceId: current.workspaceId ?? undefined,
        tokenVersion: current.tokenVersion,
      }),
    );
  }
  return true;
}

export function requireCurrentPrincipal(
  users: IAuthUserStore,
  { renew = true }: { renew?: boolean } = {},
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (await checkCurrentUser(users, req, res, renew)) next();
  };
}

export function requireCurrentWorkspacePrincipal(users: IAuthUserStore): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!(await checkCurrentUser(users, req, res, true))) return;
    const current = req.currentUser!;
    if (!current.workspaceId || current.workspaceId !== req.user!.workspaceId) {
      fail(res, undefined, 403, {
        code: ERROR_CODES.FORBIDDEN,
        message: 'Authenticated workspace membership has changed',
      });
      return;
    }
    next();
  };
}
