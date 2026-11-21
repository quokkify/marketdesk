import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES } from '../../../../shared/constants';
import type { IAuthUserStore } from '../ports/IAuthUserStore';
import { fail } from '../formatters/ResponseFormatter';

function unauthorized(res: Response, message: string): void {
  fail(res, undefined, 401, { code: ERROR_CODES.UNAUTHORIZED, message });
}

// Loads the user behind the verified JWT and refuses a token whose version no longer matches.
// Answers 401 itself and returns false when the request must stop; sets req.currentUser otherwise.
async function checkCurrentUser(
  users: IAuthUserStore,
  req: Request,
  res: Response,
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
  return true;
}

export function requireCurrentPrincipal(users: IAuthUserStore): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (await checkCurrentUser(users, req, res)) next();
  };
}

export function requireCurrentWorkspacePrincipal(users: IAuthUserStore): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!(await checkCurrentUser(users, req, res))) return;
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
