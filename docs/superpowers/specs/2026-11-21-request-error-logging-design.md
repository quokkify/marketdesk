# Request and error logging — design

## Intent

On production the owner pressed "Import from OLX", saw an error, and the server log had nothing: the
app logs only 5xx and non-domain errors, has no request log, and does not log what OLX answered. The
agent watching production logs must see every failed request to fix it without browser screenshots.

## Goals

1. One log line per `/api` request when the response finishes: method, path without query string,
   status, duration in ms, user id and workspace id when authenticated. 2xx/3xx at `info`, 4xx at
   `warn`, 5xx at `error`. `/health` and `/ready` are not logged.
2. A 4xx line carries the error code and message the client received (domain errors and request
   validation, including validation field paths).
3. When OLX (or any marketplace API) answers non-2xx or times out, log at `warn`: method, host + path
   without query, status, and the response body truncated to 500 characters.

## Non-goals / anti-goals

- Never log request bodies, query strings, headers, tokens, cookies or credentials.
- No new logging library: use the existing pino logger passed into the container.
- No change to response bodies or status codes.

## Approaches

1. **Express finish-hook middleware + error details in `res.locals` (chosen).** One line per request
   with the error attached; the error handler and validation middleware only record what they sent.
2. `pino-http`. Rejected: new dependency, logs headers by default (redaction burden).
3. Log inside the error handler only. Rejected: misses validation 400s, which respond without the
   error handler, and gives no request timeline.

## Testing

The owner's rule: live q4j tests, no Jest mocks. Log output is not visible to q4j API tests, so the
check is a scripted run against the branch Compose stack: send a request that fails validation, one
that fails auth-free domain logic, and one that succeeds, then assert the matching lines in
`docker logs` and that no `Authorization` value or body field appears.
