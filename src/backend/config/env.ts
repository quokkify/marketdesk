import { BlockList, isIP } from 'node:net';
import dotenv from 'dotenv';
import { readEmbeddedApplicationVersion } from './applicationVersion';
import { resolveDatabaseSslMode } from './databaseConfig';
import { resolveHermesProviderMode } from './hermesProviderMode';
export { resolveDatabaseSslMode, type DatabaseSslMode } from './databaseConfig';

// Quiet: dotenv would otherwise print its own "injected env" line on every import of this module.
dotenv.config({ quiet: true });

const nodeEnv = process.env.NODE_ENV || 'development';
const runningInProduction = nodeEnv === 'production';


export function optionalPositiveInt(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

export function positiveInt(value: string | undefined, fallback: number, name: string): number {
  const parsed = optionalPositiveInt(value) ?? fallback;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseCategoryIds(value: string | undefined): Record<string, number> {
  if (!value?.trim()) return {};
  const decoded = JSON.parse(value) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(decoded).map(([key, raw]) => {
      if (!Number.isInteger(raw) || Number(raw) <= 0) {
        throw new Error(`Invalid OLX category id for ${key}`);
      }
      return [key.toLowerCase(), Number(raw)];
    }),
  );
}

// 'stub' is the labelled sandbox that never calls OLX; 'real' calls the OLX Partner API.
export type OlxAdapterMode = 'stub' | 'real';

export function resolveOlxAdapterMode(value: string | undefined): OlxAdapterMode {
  const mode = value?.trim() || 'stub';
  if (mode !== 'stub' && mode !== 'real') {
    throw new Error('OLX_ADAPTER_MODE must be stub or real');
  }
  return mode;
}

const DEFAULT_PUBLIC_BASE_URL = 'http://localhost:3000';

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

// Public base URL of this backend. OLX downloads advert images itself, so the OLX
// adapter turns relative /uploads paths into absolute URLs on this base. Unset, it
// is the origin of OLX_REDIRECT_URI, which already points at this backend.
export function resolvePublicBaseUrl(
  configured: string | undefined,
  olxRedirectUri: string | undefined,
): string {
  const value = configured?.trim();
  if (value) {
    const parsed = parseHttpUrl(value);
    if (!parsed || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error(
        'PUBLIC_BASE_URL must be an absolute http(s) URL without credentials, query or fragment',
      );
    }
    // Rebuilt from its parts, so a bare "?" or "#" can never end up in an image URL.
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  }
  return parseHttpUrl(olxRedirectUri?.trim() ?? '')?.origin ?? DEFAULT_PUBLIC_BASE_URL;
}

// Addresses OLX cannot reach: loopback, private, link-local, shared (CGNAT) and
// unspecified ranges. IPv4-mapped IPv6 addresses match the IPv4 rules.
const NON_PUBLIC_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}

// A host that only resolves on this machine or a private network: localhost names,
// single-label names such as a Compose service, .local and .internal names, and
// addresses in a non-public range.
function isNonPublicHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const family = isIP(host);
  if (family !== 0) return NON_PUBLIC_ADDRESSES.check(host, family === 4 ? 'ipv4' : 'ipv6');
  return (
    host === 'localhost' ||
    !host.includes('.') ||
    /\.(localhost|local|internal)$/.test(host)
  );
}

// Value prefix of the development fallback below. assertStartupConfiguration
// recognises it so the fallback can never reach a real boot by accident.
const DEV_ONLY_SECRET_PREFIX = 'dev-only-insecure-';

// Resolve a JWT signing secret. Outside production a clearly-marked dev-only value is returned
// when unset so imports in tests and `ALLOW_INSECURE_DEV_JWT=true` development stay frictionless;
// a normal boot refuses it in assertStartupConfiguration. In production an unset, empty or
// `your_`-prefixed secret resolves to an empty one instead of throwing at import: nothing can be
// signed or verified with it, so an entrypoint that never runs the gate still fails closed, and
// the gate reports it together with every other startup problem. (S1)
export function resolveJwtSecret(
  value: string | undefined,
  name: string,
  isProd: boolean = runningInProduction,
): string {
  const isPlaceholder = value === undefined || value === '' || value.startsWith('your_');
  if (isProd) return isPlaceholder ? '' : value;
  return value && !isPlaceholder ? value : `${DEV_ONLY_SECRET_PREFIX}${name.toLowerCase()}`;
}

export const env = {
  // Application
  nodeEnv,
  appName: process.env.APP_NAME || 'hermes-marketdesk',
  applicationVersion: readEmbeddedApplicationVersion(),
  appPort: parseInt(process.env.APP_PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  trustProxy: process.env.TRUST_PROXY === 'true',
  // Local development only: tolerate a placeholder JWT_SECRET. Read once here, so the boot gate
  // and the boot warning decide from the same value (see insecureDevJwtAllowed).
  allowInsecureDevJwt: process.env.ALLOW_INSECURE_DEV_JWT === 'true',
  publicBaseUrl: resolvePublicBaseUrl(process.env.PUBLIC_BASE_URL, process.env.OLX_REDIRECT_URI),
  // False while publicBaseUrl is only the fallback; real OLX mode refuses that.
  publicBaseUrlConfigured: Boolean(process.env.PUBLIC_BASE_URL?.trim()),

  // Database
  database: {
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'marketdesk',
    password: process.env.DB_PASSWORD || 'marketdesk',
    name: process.env.DB_NAME || 'marketdesk',
    poolMin: parseInt(process.env.DB_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.DB_POOL_MAX || '10', 10),
    sslMode: resolveDatabaseSslMode(process.env.DB_SSL_MODE, runningInProduction),
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
  },

  // JWT. The signing secret resolves fail-closed (see resolveJwtSecret). The refresh secret is
  // reserved for refresh tokens, which are not implemented: nothing signs or verifies with it,
  // so it is neither required nor validated.
  jwt: {
    secret: resolveJwtSecret(process.env.JWT_SECRET, 'JWT_SECRET'),
    expiration: process.env.JWT_EXPIRATION || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || '',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },

  // Hermes Integration
  hermes: {
    apiUrl: process.env.HERMES_API_URL || '',
    apiKey: process.env.HERMES_API_KEY || '',
    webhookSecret: process.env.HERMES_WEBHOOK_SECRET || '',
    providerMode: resolveHermesProviderMode(process.env.HERMES_PROVIDER_MODE),
  },

  // External marketplaces
  marketplaces: {
    olx: {
      market: process.env.OLX_MARKET || 'PL',
      adapterMode: resolveOlxAdapterMode(process.env.OLX_ADAPTER_MODE),
      apiBaseUrl: process.env.OLX_API_BASE_URL || 'https://www.olx.pl/api/partner',
      authUrl: process.env.OLX_AUTH_URL || 'https://www.olx.pl/oauth/authorize',
      tokenUrl: process.env.OLX_TOKEN_URL || 'https://www.olx.pl/api/open/oauth/token',
      clientId: process.env.OLX_CLIENT_ID || '',
      clientSecret: process.env.OLX_CLIENT_SECRET || '',
      redirectUri: process.env.OLX_REDIRECT_URI || '',
      requiredScopes: process.env.OLX_REQUIRED_SCOPES || 'read write v2',
      oauthSuccessUrl:
        process.env.OLX_OAUTH_SUCCESS_URL || 'http://localhost:3000/marketplaces',
      accessToken: process.env.OLX_ACCESS_TOKEN || '',
      refreshToken: process.env.OLX_REFRESH_TOKEN || '',
      livePublishEnabled: process.env.OLX_LIVE_PUBLISH_ENABLED === 'true',
      requestTimeoutMs: parseInt(process.env.OLX_REQUEST_TIMEOUT_MS || '30000', 10),
      categoryIds: parseCategoryIds(process.env.OLX_CATEGORY_IDS_JSON),
      defaultCategoryId: optionalPositiveInt(process.env.OLX_DEFAULT_CATEGORY_ID),
      cityId: optionalPositiveInt(process.env.OLX_CITY_ID),
      districtId: optionalPositiveInt(process.env.OLX_DISTRICT_ID),
      contactName: process.env.OLX_CONTACT_NAME || '',
      contactPhone: process.env.OLX_CONTACT_PHONE || '',
      advertiserType:
        process.env.OLX_ADVERTISER_TYPE === 'business' ? ('business' as const) : ('private' as const),
      priceNegotiable: process.env.OLX_PRICE_NEGOTIABLE === 'true',
      conditionAttributeCode: process.env.OLX_CONDITION_ATTRIBUTE_CODE || '',
      deliveryAttributeCode: process.env.OLX_DELIVERY_ATTRIBUTE_CODE || '',
      deliveryOptionCode: process.env.OLX_DELIVERY_OPTION_CODE || '',
    },
  },

  marketplaceCredentialsKey: process.env.MARKETPLACE_CREDENTIALS_KEY || '',

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '15', 10) * 60 * 1000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  // File Upload
  upload: {
    maxFileSize: positiveInt(process.env.MAX_FILE_SIZE, 52_428_800, 'MAX_FILE_SIZE'),
    maxWorkspaceBytes: positiveInt(
      process.env.MAX_UPLOAD_WORKSPACE_BYTES,
      1_073_741_824,
      'MAX_UPLOAD_WORKSPACE_BYTES',
    ),
    maxWorkspaceFiles: positiveInt(
      process.env.MAX_UPLOAD_WORKSPACE_FILES,
      1_200,
      'MAX_UPLOAD_WORKSPACE_FILES',
    ),
    uploadDir: process.env.UPLOAD_DIR || './uploads',
  },

  // Timezone
  timezone: process.env.TIMEZONE || 'UTC',

  // Feature Flags
  features: {
    enableBulkOperations: process.env.ENABLE_BULK_OPERATIONS === 'true',
    enablePriceOptimization: process.env.ENABLE_PRICE_OPTIMIZATION === 'true',
    enableInventorySync: process.env.ENABLE_INVENTORY_SYNC === 'true',
  },
};

export const isProduction = runningInProduction;
export const isDevelopment = env.nodeEnv === 'development';
export const isTest = env.nodeEnv === 'test';

const MIN_JWT_SECRET_LENGTH = 32;
const CREDENTIALS_KEY_BYTES = 32;

function isPlaceholderSecret(value: string): boolean {
  return (
    value.trim() === '' || value.startsWith('your_') || value.startsWith(DEV_ONLY_SECRET_PREFIX)
  );
}

// Same rule as AesGcmCredentialVault: base64 text that decodes to exactly 32 bytes.
function isValidCredentialsKey(value: string): boolean {
  return value !== '' && Buffer.from(value, 'base64').length === CREDENTIALS_KEY_BYTES;
}

// Test mode and ALLOW_INSECURE_DEV_JWT=true (local `npm run dev`) may sign tokens with the
// development secret. Production never may, whatever the flag says. The boot gate and the boot
// warning both ask this.
export function insecureDevJwtAllowed(
  e: Pick<typeof env, 'nodeEnv' | 'allowInsecureDevJwt'>,
): boolean {
  if (e.nodeEnv === 'production') return false;
  return e.nodeEnv === 'test' || e.allowInsecureDevJwt;
}

const FIX_WITH_ENV_INIT = 'Fix: run `npm run env:init`.';
// env:init only fills a value that is empty or a placeholder, so a short or malformed one has to
// be replaced by hand.
const FIX_WITH_OPENSSL = 'Fix: replace it with the output of `openssl rand -base64 32`.';
const CREDENTIALS_KEY_WARNING =
  'If accounts are already connected, restore the original key instead: ' +
  'a different key makes stored marketplace credentials unreadable.';
const PUBLIC_BASE_URL_FIX_HINT =
  'Fix: set PUBLIC_BASE_URL to the public URL of this backend, for example ' +
  'https://marketdesk.example.com, because OLX downloads advert photos from it.';

// OLX fetches advert photos from PUBLIC_BASE_URL, so real mode needs an explicit
// public one. The sandbox never calls OLX and keeps the local fallback.
function realOlxPublicBaseUrlProblem(e: typeof env): string | null {
  if (e.marketplaces.olx.adapterMode !== 'real') return null;
  if (!e.publicBaseUrlConfigured) return 'PUBLIC_BASE_URL is empty while OLX_ADAPTER_MODE=real';
  if (isNonPublicHost(new URL(e.publicBaseUrl).hostname)) {
    return 'PUBLIC_BASE_URL points at a loopback or private address while OLX_ADAPTER_MODE=real';
  }
  return null;
}

// Boot gate, called by main.ts before any resource is touched. Throws one error that names
// every missing or invalid setting, each with the fix that applies to it, so a `.env` copied from
// `.env.example` fails loudly instead of leaving a server that answers /health while every
// /api route is missing. The message never contains the rejected values.
export function assertStartupConfiguration(e: typeof env): void {
  const problems: string[] = [];

  if (!insecureDevJwtAllowed(e)) {
    if (isPlaceholderSecret(e.jwt.secret)) {
      problems.push(`JWT_SECRET is empty or still a placeholder. ${FIX_WITH_ENV_INIT}`);
    } else if (e.jwt.secret.length < MIN_JWT_SECRET_LENGTH) {
      problems.push(
        `JWT_SECRET is shorter than ${MIN_JWT_SECRET_LENGTH} characters. ${FIX_WITH_OPENSSL}`,
      );
    }
  }

  if (e.marketplaceCredentialsKey === '') {
    problems.push(`MARKETPLACE_CREDENTIALS_KEY is empty. ${FIX_WITH_ENV_INIT}`);
  } else if (!isValidCredentialsKey(e.marketplaceCredentialsKey)) {
    // A valid key passes whatever it starts with; only the diagnosis of an invalid one depends on
    // the prefix. env:init replaces a placeholder like an empty value, and a placeholder is no
    // damaged copy of a real key, so the openssl hint and the restore-the-original warning do not fit.
    problems.push(
      isPlaceholderSecret(e.marketplaceCredentialsKey)
        ? `MARKETPLACE_CREDENTIALS_KEY is still a placeholder. ${FIX_WITH_ENV_INIT}`
        : 'MARKETPLACE_CREDENTIALS_KEY is not a base64-encoded 32-byte key. ' +
            `${FIX_WITH_OPENSSL} ${CREDENTIALS_KEY_WARNING}`,
    );
  }

  const publicBaseUrlProblem = realOlxPublicBaseUrlProblem(e);
  if (publicBaseUrlProblem) {
    problems.push(`${publicBaseUrlProblem}. ${PUBLIC_BASE_URL_FIX_HINT}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid startup configuration:\n${problems.map((problem) => `- ${problem}`).join('\n')}`,
    );
  }
}
