import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';
import { InMemoryAuthStore } from '../../testkit/support';
import {
  RENEWED_TOKEN_HEADER,
  requireCurrentPrincipal,
  requireCurrentWorkspacePrincipal,
} from './CurrentPrincipalMiddleware';

const HOUR_SECONDS = 3600;

async function run(
  options: { renew?: boolean } | undefined,
  ageHours: number,
  guard: 'principal' | 'workspace' = 'principal',
  tokenWorkspaceId = 'ws-1',
) {
  const users = new InMemoryAuthStore();
  users.users.push({
    id: 'u-1',
    email: 'demo@example.com',
    passwordHash: 'unused',
    workspaceId: 'ws-1',
    tokenVersion: 0,
    createdAt: new Date(),
  });
  const issuedAt = Math.floor(Date.now() / 1000) - ageHours * HOUR_SECONDS;
  const req = { user: { userId: 'u-1', workspaceId: tokenWorkspaceId, tokenVersion: 0, issuedAt } } as Request;
  const setHeader = jest.fn();
  const status = jest.fn().mockReturnThis();
  const json = jest.fn();
  const res = { setHeader, status, json } as unknown as Response;
  const next = jest.fn() as NextFunction;
  const handler =
    guard === 'workspace'
      ? requireCurrentWorkspacePrincipal(users)
      : requireCurrentPrincipal(users, options);
  await handler(req, res, next);
  return { setHeader, next, status };
}

describe('requireCurrentPrincipal renewal', () => {
  it('renews an old token by default', async () => {
    const { setHeader, next } = await run(undefined, 13);

    expect(next).toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith(RENEWED_TOKEN_HEADER, expect.any(String));
    const issued = setHeader.mock.calls[0][1] as string;
    expect(jwt.verify(issued, env.jwt.secret)).toMatchObject({ userId: 'u-1', tv: 0 });
  });

  it('emits no header for an old token when renew is false', async () => {
    const { setHeader, next } = await run({ renew: false }, 13);

    expect(next).toHaveBeenCalled();
    expect(setHeader).not.toHaveBeenCalled();
  });
});

describe('requireCurrentWorkspacePrincipal renewal', () => {
  it('renews an old token once the workspace check passed', async () => {
    const { setHeader, next } = await run(undefined, 13, 'workspace');

    expect(next).toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith(RENEWED_TOKEN_HEADER, expect.any(String));
  });

  it('emits no header on its 403 for a changed workspace', async () => {
    const { setHeader, next, status } = await run(undefined, 13, 'workspace', 'ws-other');

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(setHeader).not.toHaveBeenCalled();
  });
});

describe('requireCurrentPrincipal workspace change', () => {
  it('does not renew a token of another workspace', async () => {
    const { setHeader, next } = await run(undefined, 13, 'principal', 'ws-other');

    expect(next).toHaveBeenCalled();
    expect(setHeader).not.toHaveBeenCalled();
  });
});
