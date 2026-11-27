# OLX PL real API readiness

This document tracks the implemented OAuth/publish path and the gates required
before a real OLX listing is created.

## Current seller context

- Market: OLX Poland (`PL`).
- Seller account: user's personal verified OLX account.
- First live-test item: base AirPods 4.
- No OLX app credentials are stored in this repository.

## Safety rules

1. Keep `OLX_ADAPTER_MODE=stub` until an official OLX app/client is approved.
2. Keep `OLX_LIVE_PUBLISH_ENABLED=false` until a human explicitly approves the
   first real listing publish.
3. Never commit `OLX_CLIENT_SECRET`, access tokens, refresh tokens, account
   passwords, or screenshots containing credentials.
4. Use publish preview/dry-run first. Live publish must be a separate intentional
   step.

## Required OLX app values

When OLX developer/app access is approved, store these outside git (for example
in the deployment `.env` or the platform secret store):

```env
OLX_MARKET=PL
OLX_ADAPTER_MODE=real
OLX_API_BASE_URL=https://www.olx.pl/api/partner
OLX_CLIENT_ID=[REDACTED]
OLX_CLIENT_SECRET=[REDACTED]
OLX_REDIRECT_URI=https://<domain>/api/marketplaces/olx/oauth/callback
OLX_OAUTH_SUCCESS_URL=https://<domain>/marketplaces
PUBLIC_BASE_URL=https://<domain>
OLX_AUTH_URL=https://www.olx.pl/oauth/authorize
OLX_TOKEN_URL=https://www.olx.pl/api/open/oauth/token
MARKETPLACE_CREDENTIALS_KEY=[REDACTED_BASE64_32_BYTES]
OLX_LIVE_PUBLISH_ENABLED=false
```

`OLX_SEARCH_BASE_URL` is optional. It is the public OLX site whose search pages the
listing response check reads; empty means `https://www.olx.pl`.

Access and refresh tokens are obtained only through OAuth, encrypted with
AES-256-GCM, and stored per marketplace account. They must not be copied into
environment variables or logs.

## Prepared in code

- Fetch-backed marketplace transport can be wired into the OLX adapter.
- Real transport is opt-in via `OLX_ADAPTER_MODE=real`.
- Live Partner API `POST /adverts` is blocked unless
  `OLX_LIVE_PUBLISH_ENABLED=true`.
- `POST /api/marketplaces/:id/connect` creates a short-lived one-time OAuth state.
- `GET /api/marketplaces/olx/oauth/callback` exchanges the code and persists the
  encrypted account credentials before marking the marketplace connected.
- `GET /api/marketplaces/:id/check` reports app-authoritative account state without
  exposing credentials.
- Expired access tokens are refreshed and rotated before a real publish job.
- Publish jobs contain `marketplaceId`; access tokens are resolved inside the
  worker and are never placed in Redis job payloads.
- Existing Product → Listing and publish-preview flows let us validate the final
  payload before attempting live publish.

## First live validation

The first manual run completed the full guarded path: browser OAuth callback,
encrypted account persistence, warning-free preview, one-attempt queue publish,
database finalization, authenticated Partner API readback, and anonymous public
readback after the provider status became `active`. The concrete seller account,
advert ID, contact details, and credentials are intentionally not recorded here.

## Next stage

- Resolve account-scoped OAuth credentials in the existing marketplace sync worker.
- Reconcile remote advert status with local listing state.
- Add scheduled polling or provider webhooks; stage 1 sync remains manual.
- Expand OLX PL taxonomy/location/required-attribute mapping beyond the validated
  category and location.
- Harden media hosting for long-lived production use.

## AirPods 4 draft checklist

Collect before real preview:

- condition: new / like new / used;
- price in PLN;
- city/location;
- photos;
- box/receipt/warranty details;
- exact model (AirPods 4 basic, not ANC variant);
- contact/phone visibility preference if OLX requires it.

## Advert completeness checks: hand checks after deploy

The sale verdict has three checks that read the live OLX advert: `category`, `attributes` and `delivery`. The stand
mocks OLX, so these are checked by hand on production after each deploy:

1. AirPods: `brand: Apple` is filled, and a second run makes no second write.
2. Projector: `brand: AOPEN` is filled.
3. Nail drill: the category check shows a category proposal.
4. AirPods delivery: the check is `needs_human` with "check in OLX".
5. A price change keeps the attributes.
6. On a stub stand a manual price change never reaches OLX (the update handler lacks OAuth dependencies), so only a
   prod hand check proves that a price change keeps attributes.
