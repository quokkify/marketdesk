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

// Hands out a fresh token when the presented one is old enough. Only a request that is about to
// succeed gets one, and only for the workspace the token already names, so a renewal never
// moves a session into a workspace the client did not sign in to. A token without an issue time
// (issuedAt 0) is never renewed.
function renewIfDue(req: Request, res: Response): void {
  const presented = req.user!;
  const current = req.currentUser!;
  const presentedWorkspace = presented.workspaceId ?? undefined;
  const currentWorkspace = current.workspaceId ?? undefined;
  if (presentedWorkspace !== currentWorkspace) return;
  if (!Number.isFinite(presented.issuedAt) || presented.issuedAt <= 0) return;
  if (Date.now() - presented.issuedAt * 1000 <= env.jwt.renewAfterMs) return;
  res.setHeader(
    RENEWED_TOKEN_HEADER,
    signToken({
      userId: current.id,
      workspaceId: currentWorkspace,
      tokenVersion: current.tokenVersion,
    }),
  );
}

export function requireCurrentPrincipal(
  users: IAuthUserStore,
  { renew = true }: { renew?: boolean } = {},
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!(await checkCurrentUser(users, req, res))) return;
    if (renew) renewIfDue(req, res);
    next();
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
    renewIfDue(req, res);
    next();
  };
}
