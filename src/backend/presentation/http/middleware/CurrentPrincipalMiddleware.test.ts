import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';
import { InMemoryAuthStore } from '../../testkit/support';
import {
  RENEWED_TOKEN_HEADER,
  requireCurrentPrincipal,
} from './CurrentPrincipalMiddleware';

const HOUR_SECONDS = 3600;

async function run(options: { renew?: boolean } | undefined, ageHours: number) {
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
  const req = { user: { userId: 'u-1', workspaceId: 'ws-1', tokenVersion: 0, issuedAt } } as Request;
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as Response;
  const next = jest.fn() as NextFunction;
  await requireCurrentPrincipal(users, options)(req, res, next);
  return { setHeader, next };
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
