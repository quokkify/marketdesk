// Presentation-layer port for authentication. The application layer has no user
// aggregate (auth is a pragmatic v1 addition, see migration 001), so AuthController
// depends on this thin store abstraction. Group 6 wires a concrete implementation
// backed by the `users` table.

export interface AuthUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  workspaceId?: string | null;
  tokenVersion: number;
  createdAt: Date;
}

export interface CreateAuthUserInput {
  email: string;
  passwordHash: string;
  workspaceId?: string | null;
}

export interface IAuthUserStore {
  findByEmail(email: string): Promise<AuthUserRecord | null>;
  findById(id: string): Promise<AuthUserRecord | null>;
  create(input: CreateAuthUserInput): Promise<AuthUserRecord>;
  /** Returns the new version; rejects NotFoundError when the user does not exist. */
  bumpTokenVersion(userId: string): Promise<number>;
  /** Sets the hash and bumps the version; returns the new version; rejects NotFoundError. */
  updatePassword(userId: string, passwordHash: string): Promise<number>;
}
