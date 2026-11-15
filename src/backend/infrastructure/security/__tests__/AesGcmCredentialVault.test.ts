import { AesGcmCredentialVault } from '../AesGcmCredentialVault';
import { secretRegistry } from '../../runRecorder/SecretRegistry';
import type { OlxOAuthTokens } from '../../../application/services/MarketplaceOAuthService';

describe('AesGcmCredentialVault', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const tokens: OlxOAuthTokens = {
    accessToken: 'sensitive-access-token',
    refreshToken: 'sensitive-refresh-token',
    tokenType: 'Bearer',
    scopes: ['basic', 'write'],
    expiresAt: new Date('2026-07-14T13:00:00.000Z'),
  };

  it('round-trips OAuth credentials without storing plaintext', () => {
    const vault = new AesGcmCredentialVault(key);

    const encrypted = vault.encrypt(tokens);
    const serialized = JSON.stringify(encrypted);

    expect(serialized).not.toContain(tokens.accessToken);
    expect(serialized).not.toContain(tokens.refreshToken);
    expect(vault.decrypt(encrypted)).toEqual(tokens);
  });

  it('registers decrypted tokens so they cannot be recorded', () => {
    const vault = new AesGcmCredentialVault(key);
    const unique = {
      ...tokens,
      accessToken: 'vault-test-access-token-9f3a',
      refreshToken: 'vault-test-refresh-token-9f3a',
    };
    const decrypted = vault.decrypt(vault.encrypt(unique));
    expect(secretRegistry.scrub(`a ${decrypted.accessToken} b ${decrypted.refreshToken}`)).toBe(
      'a [SECRET:olx-token] b [SECRET:olx-token]',
    );
  });

  it('registers the decrypted app client secret', () => {
    const vault = new AesGcmCredentialVault(key);
    const decrypted = vault.decryptAppCredentials(
      vault.encryptAppCredentials({ clientId: 'cid', clientSecret: 'vault-test-client-secret-9f3a' }),
    );
    expect(secretRegistry.scrub(`x ${decrypted.clientSecret} y`)).toBe('x [SECRET:olx-client-secret] y');
  });

  it('fails closed when the configured key is missing or malformed', () => {
    expect(() => new AesGcmCredentialVault('')).toThrow('MARKETPLACE_CREDENTIALS_KEY');
    expect(() => new AesGcmCredentialVault('not-base64')).toThrow(
      'MARKETPLACE_CREDENTIALS_KEY',
    );
  });
});
