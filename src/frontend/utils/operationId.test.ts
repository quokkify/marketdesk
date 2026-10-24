import { newOperationId } from './operationId';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type CryptoSource = NonNullable<Parameters<typeof newOperationId>[0]>;

// What a plain-HTTP origin exposes: getRandomValues, but no randomUUID.
const insecureCrypto: CryptoSource = {
  getRandomValues: (array) => globalThis.crypto.getRandomValues(array),
};

const filledWith = (byte: number): CryptoSource => ({
  getRandomValues: (array) => {
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(byte);
    return array;
  },
});

describe('newOperationId', () => {
  it('returns an RFC 4122 version 4 UUID from the runtime crypto', () => {
    expect(newOperationId()).toMatch(UUID_V4);
  });

  it('uses crypto.randomUUID where the browser exposes it', () => {
    const randomUUID = jest.fn(() => '0c5e9d3a-7b1f-4c2e-9a6d-2f8b1e4c7d90' as const);

    expect(newOperationId({ ...insecureCrypto, randomUUID })).toBe(
      '0c5e9d3a-7b1f-4c2e-9a6d-2f8b1e4c7d90',
    );
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('builds a version 4 UUID from getRandomValues outside secure contexts', () => {
    const ids = Array.from({ length: 64 }, () => newOperationId(insecureCrypto));

    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('forces the version and variant bits whatever the random bytes are', () => {
    expect(newOperationId(filledWith(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(newOperationId(filledWith(0x00))).toBe('00000000-0000-4000-8000-000000000000');
  });
});
