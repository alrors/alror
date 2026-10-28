# Errors

Every error from the workspace API has the same shape, and the CLI and console show the same fields:

```json
{
  "error": {
    "code": "unknown_service",
    "message": "Unknown service \"checkout\". Add it to the org config first.",
    "fix": "Add the service with alror config push or on the Services page, then retry.",
    "docs_url": "https://github.com/alrors/alror/tree/main/internal/docsite/content/errors.md#unknown_service",
    "request_id": "req_6f1c2b9a4d7e"
  }
}
```

`request_id` is also sent as the `X-Request-Id` header on every response, including successful ones. Quote it when you ask for help; the server logs it with each failure. A client may send its own `X-Request-Id` (8 to 64 letters, digits, `-` or `_`) and the server reuses it.

## bad_request

The request body is not valid JSON, or a parameter has the wrong type. Check the request against the [connected mode](connected.md) reference and retry.

## invalid

A field failed validation (HTTP 422). `message` names the field; `details` lists each problem. Fix the value and retry.

## unauthorized

No valid API key or session (HTTP 401). Run `alror login --server <url> --key <key>`, or sign in again in the console. Keys are created under Settings, API keys.

## forbidden

The key or user lacks the permission (HTTP 403). `message` names the missing scope. Create a key with that scope, or ask an owner or admin.

## not_found

The resource does not exist in this organization (HTTP 404). Check the id, and that the key belongs to the right organization (`alror whoami`).

## conflict

The request clashes with the current state (HTTP 409), for example a job claimed by another runner or a name already in use. Reload the current state and retry.

## ambiguous

A short id prefix matches more than one resource (HTTP 409). Use more characters of the id.

## unknown_service

The service is not in this organization's config (HTTP 422). Add it with `alror config push` or on the Services page, then retry.

## unknown_environment

The environment does not exist (HTTP 422). Create it under Settings, Environments, or use one listed by `alror status`.

## rate_limited

Too many attempts (HTTP 429). Wait for the number of seconds in `Retry-After`, then retry.

## unavailable

The workspace cannot reach PostgreSQL or Redis (HTTP 503, `Retry-After: 10`). `details.reason` is `database_unavailable` or `cache_unavailable`. Retry with backoff; operators should check `GET /api/v1/health`.

## internal

An unexpected server error (HTTP 500). Retry once. If it persists, report it with the `request_id`.
