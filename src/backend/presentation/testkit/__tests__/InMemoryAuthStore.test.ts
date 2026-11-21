import { NotFoundError } from '../../../domain/shared/DomainError';
import { InMemoryAuthStore } from '../support';

describe('InMemoryAuthStore token version', () => {
  it('starts at 0, bumps, and bumps on password update', async () => {
    const store = new InMemoryAuthStore();
    const created = await store.create({ email: 'a@example.com', passwordHash: 'h1' });
    expect((await store.findById(created.id))?.tokenVersion).toBe(0);
    expect(await store.bumpTokenVersion(created.id)).toBe(1);
    expect(await store.bumpTokenVersion(created.id)).toBe(2);
    expect(await store.updatePassword(created.id, 'h2')).toBe(3);
    const after = await store.findById(created.id);
    expect(after?.passwordHash).toBe('h2');
    expect(after?.tokenVersion).toBe(3);
  });

  it('rejects NotFoundError for an unknown user', async () => {
    const store = new InMemoryAuthStore();
    await expect(store.bumpTokenVersion('missing')).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.updatePassword('missing', 'h')).rejects.toBeInstanceOf(NotFoundError);
  });
});
