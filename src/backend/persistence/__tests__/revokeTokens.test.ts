import { revokeTokens } from '../revokeTokens';

function fakeUsers() {
  const versions = new Map([['demo@example.com', 0]]);
  return {
    versions,
    findByEmail: jest.fn(async (email: string) =>
      versions.has(email.toLowerCase()) ? ({ id: 'u-1', email: email.toLowerCase() } as never) : null,
    ),
    bumpTokenVersion: jest.fn(async () => {
      versions.set('demo@example.com', (versions.get('demo@example.com') ?? 0) + 1);
      return versions.get('demo@example.com')!;
    }),
  };
}

function fakeOut() {
  return { log: jest.fn(), error: jest.fn() };
}

describe('revokeTokens', () => {
  it('revokes the sessions of a known e-mail, whatever its case', async () => {
    const users = fakeUsers();
    const out = fakeOut();

    const code = await revokeTokens('Demo@Example.com', users, out);

    expect(code).toBe(0);
    expect(out.log).toHaveBeenCalledWith('Revoked all sessions of Demo@Example.com');
    expect(users.bumpTokenVersion).toHaveBeenCalledWith('u-1');
    expect(users.versions.get('demo@example.com')).toBe(1);
  });

  it('exits 1 with an error line for an unknown e-mail and bumps nothing', async () => {
    const users = fakeUsers();
    const out = fakeOut();

    const code = await revokeTokens('nobody@example.com', users, out);

    expect(code).toBe(1);
    expect(out.error).toHaveBeenCalledWith('No user with e-mail nobody@example.com');
    expect(users.bumpTokenVersion).not.toHaveBeenCalled();
  });

  it('exits 2 with a usage line when the e-mail is missing', async () => {
    const users = fakeUsers();
    const out = fakeOut();

    const code = await revokeTokens(undefined, users, out);

    expect(code).toBe(2);
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining('auth:revoke'));
    expect(users.findByEmail).not.toHaveBeenCalled();
  });
});
