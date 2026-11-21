// Shared test support for the HTTP layer: an in-memory auth user store, so
// tests can register and log in without the users table.

import type {
  IAuthUserStore,
  AuthUserRecord,
  CreateAuthUserInput,
} from '../http/ports/IAuthUserStore';
import { NotFoundError } from '../../domain/shared/DomainError';

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
      tokenVersion: 0,
      createdAt: new Date(),
    };
    this.users.push(user);
    return user;
  }
  async bumpTokenVersion(userId: string): Promise<number> {
    const user = this.users.find((u) => u.id === userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);
    user.tokenVersion += 1;
    return user.tokenVersion;
  }
  async updatePassword(
    userId: string,
    passwordHash: string,
    expectedVersion: number,
  ): Promise<number | null> {
    const user = this.users.find((u) => u.id === userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);
    if (user.tokenVersion !== expectedVersion) return null;
    user.passwordHash = passwordHash;
    user.tokenVersion += 1;
    return user.tokenVersion;
  }
}
