// Operator command: `npm run auth:revoke -- <email>` signs the user out of every device by
// bumping the token version. Exit codes: 0 revoked, 1 unknown e-mail, 2 missing argument.

import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import type { IAuthUserStore } from '../presentation/http/ports/IAuthUserStore.js';

dotenv.config();

type RevokeUsers = Pick<IAuthUserStore, 'findByEmail' | 'bumpTokenVersion'>;
type RevokeOutput = { log(msg: string): void; error(msg: string): void };

export async function revokeTokens(
  email: string | undefined,
  users: RevokeUsers,
  out: RevokeOutput,
): Promise<0 | 1 | 2> {
  if (!email) {
    out.error('Usage: npm run auth:revoke -- <email>');
    return 2;
  }
  const user = await users.findByEmail(email);
  if (!user) {
    out.error(`No user with e-mail ${email}`);
    return 1;
  }
  await users.bumpTokenVersion(user.id);
  out.log(`Revoked all sessions of ${email}`);
  return 0;
}

async function main(): Promise<void> {
  const { createPool, closePool } = await import('../config/database.js');
  const { AuthUserRepository } = await import(
    '../infrastructure/persistence/repositories/AuthUserRepository.js'
  );
  try {
    process.exitCode = await revokeTokens(process.argv[2], new AuthUserRepository(createPool()), console);
  } finally {
    await closePool();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Revoking sessions failed');
    process.exitCode = 1;
  });
}
