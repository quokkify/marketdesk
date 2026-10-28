// Shared test support for the HTTP layer: an in-memory auth user store, so
// tests can register and log in without the users table.

import type {
  IAuthUserStore,
  AuthUserRecord,
  CreateAuthUserInput,
} from '../http/ports/IAuthUserStore';

export class InMemoryAuthStore implements IAuthUserStore {
  readonly users: AuthUserRecord[] = [];
  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    return this.users.find((u) => u.email === email) ?? null;
  }
  async findById(id: string): Promise<AuthUserRecord | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }
  async create(input: CreateAuthUserInput): Promise<AuthUserRecord> {
    const user: AuthUserRecord = {
      id: `u-${this.users.length + 1}`,
      email: input.email,
      passwordHash: input.passwordHash,
      workspaceId: input.workspaceId,
      createdAt: new Date(),
    };
    this.users.push(user);
    return user;
  }
}
