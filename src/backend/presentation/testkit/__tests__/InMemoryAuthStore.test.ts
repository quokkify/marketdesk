import { NotFoundError } from '../../../domain/shared/DomainError';
import { InMemoryAuthStore } from '../support';

describe('InMemoryAuthStore token version', () => {
  it('starts at 0, bumps, and bumps on password update', async () => {
    const store = new InMemoryAuthStore();
    const created = await store.create({ email: 'a@example.com', passwordHash: 'h1' });
    expect((await store.findById(created.id))?.tokenVersion).toBe(0);
    expect(await store.bumpTokenVersion(created.id)).toBe(1);
    expect(await store.bumpTokenVersion(created.id)).toBe(2);
    expect(await store.updatePassword(created.id, 'h2', 2)).toBe(3);
    const after = await store.findById(created.id);
    expect(after?.passwordHash).toBe('h2');
    expect(after?.tokenVersion).toBe(3);
  });

  it('refuses a password update when the version moved, leaving the user untouched', async () => {
    const store = new InMemoryAuthStore();
    const created = await store.create({ email: 'a@example.com', passwordHash: 'h1' });
    await store.bumpTokenVersion(created.id);

    expect(await store.updatePassword(created.id, 'h2', 0)).toBeNull();

    const after = await store.findById(created.id);
    expect(after?.passwordHash).toBe('h1');
    expect(after?.tokenVersion).toBe(1);
  });

  it('rejects NotFoundError for an unknown user', async () => {
    const store = new InMemoryAuthStore();
    await expect(store.bumpTokenVersion('missing')).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.updatePassword('missing', 'h', 0)).rejects.toBeInstanceOf(NotFoundError);
  });
});
