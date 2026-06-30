# Commercial Release Checklist

## Licensing

- Configure `NOMAD_LICENSE_PUBLIC_KEY` in production.
- Set `NOMAD_REQUIRE_LICENSE=true` when the activation flow is ready for customers.
- Keep `NOMAD_LICENSE_BYPASS=false` outside local development.
- Generate customer keys as `planrla_<base64url-json-payload>.<base64url-signature>`.
- Include at least `product`, `customer`, `plan`, `seats`, `issuedAt`, and `expiresAt` in the signed payload.
- Generate keys with `npm run license:generate` after setting `NOMAD_LICENSE_PRIVATE_KEY`, `CUSTOMER`, and `EXPIRES_AT`.

## Update Infrastructure

- Publish Electron artifacts to the generic update bucket configured by `NOMAD_UPDATE_URL`.
- Publish web update metadata to `NOMAD_UPDATE_CHECK_URL` with:
  - `version`
  - `title`
  - `body`
  - `htmlUrl`
  - `publishedAt`

## Desktop Signing

- Windows installer signing uses `CSC_LINK` and `CSC_KEY_PASSWORD`.
- macOS signing/notarization uses `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`.
- Build commands:
  - `npm run desktop:dist:win`
  - `npm run desktop:dist:mac`
  - `npm run desktop:dist:linux`

## Preflight

- Run `npm run typecheck`.
- Run `npm run build`.
- Run `git diff --check`.
- Confirm `docs/commercial/THIRD_PARTY_LICENSE_AUDIT.md` is refreshed after dependency changes.
