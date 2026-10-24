import dotenv from 'dotenv';
import { readEmbeddedApplicationVersion } from './applicationVersion';
import { resolveDatabaseSslMode } from './databaseConfig';
import { resolveHermesProviderMode } from './hermesProviderMode';
export { resolveDatabaseSslMode, type DatabaseSslMode } from './databaseConfig';

dotenv.config();

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
      adapterMode: process.env.OLX_ADAPTER_MODE || 'stub',
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

// Boot gate, called by main.ts before any resource is touched. Throws one error that names
// every missing or invalid secret, each with the fix that applies to it, so a `.env` copied from
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
    problems.push(
      'MARKETPLACE_CREDENTIALS_KEY is not a base64-encoded 32-byte key. ' +
        `${FIX_WITH_OPENSSL} ${CREDENTIALS_KEY_WARNING}`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid startup configuration:\n${problems.map((problem) => `- ${problem}`).join('\n')}`,
    );
  }
}
