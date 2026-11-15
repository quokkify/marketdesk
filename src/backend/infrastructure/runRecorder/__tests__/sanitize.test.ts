import { SecretRegistry } from '../SecretRegistry';
import { MAX_LINE_BYTES, MAX_STRING_LENGTH, sanitize, serializeLine } from '../sanitize';

const registry = () => {
  const r = new SecretRegistry();
  r.register('s3cr3t-hermes-key', 'ENV:HERMES_API_KEY');
  return r;
};

describe('sanitize', () => {
  it('replaces a registered secret with its label and keeps the event', () => {
    const out = sanitize({ message: 'call failed with s3cr3t-hermes-key in url' }, registry());
    expect(out.message).toBe('call failed with [ENV:HERMES_API_KEY] in url');
  });

  it('ignores registered values shorter than 8 characters', () => {
    const r = new SecretRegistry();
    r.register('olx', 'ENV:X');
    expect(sanitize({ marketplaceKey: 'olx' }, r)).toEqual({ marketplaceKey: 'olx' });
  });

  it('redacts by key name and keeps marketplaceKey', () => {
    expect(
      sanitize({
        access_token: 'abc',
        refreshToken: 'def',
        code: '123',
        state: 'zz',
        marketplaceKey: 'olx',
      })
    ).toEqual({
      access_token: '[REDACTED:key]',
      refreshToken: '[REDACTED:key]',
      code: '[REDACTED:key]',
      state: '[REDACTED:key]',
      marketplaceKey: 'olx',
    });
  });

  it('redacts a denylisted key whose value is an object', () => {
    expect(sanitize({ credentials: { user: 'a', pass: 'b' } })).toEqual({
      credentials: '[REDACTED:key]',
    });
  });

  it('redacts bearer values, JWTs, long tokens and URL queries inside free text', () => {
    const out = sanitize({
      note:
        'Authorization: Bearer abc.def and https://u:p@host/cb?code=42&x=1 and ' + 'A'.repeat(48),
    });
    expect(out.note).toBe(
      'Authorization: Bearer [REDACTED] and https://host/cb?[REDACTED] and [REDACTED:token]'
    );
  });

  it('redacts a JWT', () => {
    const out = sanitize({ note: 'got eyJhbGciOi.eyJzdWIiOjF9.sig_nature-1 ok' });
    expect(out.note).toBe('got [REDACTED:jwt] ok');
  });

  it('leaves a bare question mark in prose alone', () => {
    expect(sanitize({ note: 'is it done? yes' })).toEqual({ note: 'is it done? yes' });
  });

  // Review Focus 3
  it('finds a secret that contains a quote and a backslash, inside an error message', () => {
    const r = new SecretRegistry();
    r.register('pa"ss\\word-1', 'ENV:DB_PASSWORD');
    const line = serializeLine(sanitize({ error: new Error('auth failed for pa"ss\\word-1') }, r));
    expect(line).not.toContain('ss\\\\word');
    expect(line).toContain('[ENV:DB_PASSWORD]');
  });

  // Review Focus 5
  it('scans before truncating, so a secret at the cut cannot survive', () => {
    const r = new SecretRegistry();
    r.register('tail-secret-value', 'ENV:TAIL');
    const out = sanitize({ body: 'x '.repeat(2040) + 'tail-secret-value' }, r);
    expect(out.body).not.toContain('tail-sec');
    expect(out.body).toContain('[ENV:TAIL]');
  });

  it('keeps the code and pg fields that identify an Error', () => {
    const error = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    const pgError = Object.assign(new Error('dup'), {
      code: '23505',
      constraint: 'listings_pkey',
      table: 'listings',
    });
    const out = sanitize({ a: error, b: pgError }) as unknown as {
      a: { code: string };
      b: { code: string; pg: { code: string } };
    };
    expect(out.a.code).toBe('ECONNREFUSED');
    expect(out.b.code).toBe('23505');
    expect(out.b.pg.code).toBe('23505');
  });

  it('replaces a Buffer or typed array with its size', () => {
    const out = sanitize({ body: Buffer.from('s3cr3t'), arr: new Uint8Array(3) });
    expect(out).toEqual({ body: '[Binary 6 bytes]', arr: '[Binary 3 bytes]' });
  });

  it('redacts relative URL queries, form pairs, header-style keys and any-case bearer', () => {
    const out = sanitize({
      'x-api-key': 'abc',
      'api-key': 'abc',
      url: '/api/olx/callback?code=abc&state=xyz',
      form: 'grant_type=authorization_code&code=abc123&client_secret=zzz&x=1',
      auth: 'bearer abc and BEARER def',
      prose: 'why? because',
    });
    expect(out).toEqual({
      'x-api-key': '[REDACTED:key]',
      'api-key': '[REDACTED:key]',
      url: '/api/olx/callback?[REDACTED]',
      form: 'grant_type=authorization_code&code=[REDACTED]&client_secret=[REDACTED]&x=1',
      auth: 'Bearer [REDACTED] and Bearer [REDACTED]',
      prose: 'why? because',
    });
  });

  it('sanitizes a 5 MB slash-heavy string quickly and truncates it', () => {
    const started = Date.now();
    const out = sanitize({ body: 'a/'.repeat(2_500_000) });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out.body).toMatch(/…\[truncated 4\d{6} chars\]$/);
  });

  it('scans a secret that straddles the string cap using the scan margin', () => {
    const secret = Array.from({ length: 50 }, (_, n) => `w${n}x`).join('.');
    const r = new SecretRegistry();
    r.register(secret, 'ENV:LONG');
    const out = sanitize({ body: 'x '.repeat(2000) + secret }, r);
    expect(out.body).toContain('[ENV:LONG]');
    expect(out.body).not.toContain(secret.slice(0, 12));
  });

  it('redacts a token pair whose key has a long prefix', () => {
    const out = sanitize({ form: `${'a'.repeat(100)}_access_token=abc123&x=1` });
    expect(out.form).not.toContain('abc123');
  });

  it('truncates a long string with a count suffix', () => {
    const out = sanitize({ body: 'ab '.repeat(MAX_STRING_LENGTH) });
    expect(out.body.length).toBeLessThan(MAX_STRING_LENGTH + 40);
    expect(out.body).toMatch(/…\[truncated \d+ chars\]$/);
  });

  it('keeps a line under the byte cap by omitting the largest field', () => {
    const line = serializeLine(
      sanitize({
        type: 'queue.enqueued',
        data: { blob: Array.from({ length: 200 }, (_, i) => `${i} `.repeat(2000)) },
      })
    );
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(MAX_LINE_BYTES);
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('queue.enqueued');
    expect(parsed.data).toMatch(/^\[omitted: \d+ bytes\]$/);
  });

  it('keeps an ordinary breaking field readable', () => {
    const body = {
      error: { validation: [{ field: 'attributes.state', title: 'Field is required' }] },
    };
    expect(sanitize(body)).toEqual(body);
  });

  it('survives cycles and deep nesting', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(sanitize(a)).toEqual({ self: '[Circular]' });
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 12; i += 1) deep = { n: deep };
    expect(JSON.stringify(sanitize(deep))).toContain('[MaxDepth]');
  });

  it('scrubs the strings inside a converted Error', () => {
    const out = sanitize({ error: new Error('boom s3cr3t-hermes-key') }, registry()) as {
      error: { name: string; message: string };
    };
    expect(out.error.name).toBe('Error');
    expect(out.error.message).toBe('boom [ENV:HERMES_API_KEY]');
  });

  describe('errorInfoKeys', () => {
    const event = {
      type: 'http.error',
      code: 'top-level-code',
      error: {
        name: 'GuardrailViolationError',
        message: 'blocked s3cr3t-hermes-key',
        code: 'GUARDRAIL_VIOLATION',
        details: { code: 'oauth-code-123', categoryDecision: { allowed: false } },
        pg: { code: '23505', constraint: 'listings_pkey', table: 'listings' },
      },
    };

    it('keeps the code fields of an ErrorInfo and still redacts inside details', () => {
      const out = sanitize(event, registry(), { errorInfoKeys: ['error'] }) as unknown as {
        code: string;
        error: {
          code: string;
          message: string;
          pg: { code: string; constraint: string; table: string };
          details: { code: string; categoryDecision: unknown };
        };
      };
      expect(out.error.code).toBe('GUARDRAIL_VIOLATION');
      expect(out.error.pg).toEqual({
        code: '23505',
        constraint: 'listings_pkey',
        table: 'listings',
      });
      expect(out.error.details.code).toBe('[REDACTED:key]');
      expect(out.error.details.categoryDecision).toEqual({ allowed: false });
      expect(out.error.message).toBe('blocked [ENV:HERMES_API_KEY]');
      expect(out.code).toBe('[REDACTED:key]');
    });

    it('redacts the same event as before when the option is absent', () => {
      const out = sanitize(event, registry()) as unknown as { error: { code: string } };
      expect(out.error.code).toBe('[REDACTED:key]');
    });

    describe('the exemption covers string values only', () => {
      const planted = 'x-planted-secret';
      const run = (error: unknown) =>
        sanitize({ error }, registry(), { errorInfoKeys: ['error'] }) as unknown;

      it.each([
        ['code', { code: { access_token: planted } }],
        ['name', { name: [{ token: planted }] }],
        ['message', { message: { secret: planted } }],
        ['at', { at: { password: planted } }],
        ['pg key', { pg: { password: planted, code: '23505' } }],
        ['pg value', { pg: { code: { token: planted } } }],
        ['pg not an object', { pg: [{ token: planted }] }],
      ])('does not leak a planted value under %s', (_label, error) => {
        expect(JSON.stringify(run(error))).not.toContain(planted);
      });

      it('keeps pg.code when pg also holds a denylisted key', () => {
        const out = run({ pg: { password: planted, code: '23505' } }) as {
          error: { pg: { code: string } };
        };
        expect(out.error.pg.code).toBe('23505');
      });

      it('does not exempt a nested, non-top-level error', () => {
        const out = sanitize(
          { data: { error: { code: 'oauth-code-x-planted-secret' } } },
          registry(),
          {
            errorInfoKeys: ['error'],
          }
        ) as unknown as { data: { error: { code: string } } };
        expect(out.data.error.code).toBe('[REDACTED:key]');
      });

      it('applies the same rule to an Error instance', () => {
        const error = Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
        const out = sanitize({ error }, registry()) as unknown as { error: { code: string } };
        expect(out.error.code).toBe('ECONNREFUSED');
      });
    });
  });
});
