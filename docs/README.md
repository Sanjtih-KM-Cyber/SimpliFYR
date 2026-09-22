# Simplifyr docs

Start here:

- `../README.md` — build, run, test, and per-phase status (authoritative for
  what is implemented).
- `../Simplifyr_PROD_DOC.md` — product & technical design blueprint (vision,
  includes Kafka/OpenSearch/Grafana/Keycloak/K8s targets not yet deployed).
- `../Simplifyr_Tech_DOC.md` — technical companion to the product doc.

## Current UI map (Phase 6 refactor)

Legacy pages `Drift/Events/Sources/Onboarding.tsx` were consolidated:

- `frontend/src/pages/Connections.tsx` + `AddConnection.tsx` +
  `ConnectionLayout/Overview/Tabs.tsx` — sources + onboarding wizard
- `frontend/src/pages/Logs.tsx` — Event Explorer (raw/parsed/normalized/output
  + provenance)
- `frontend/src/pages/NeedsReview.tsx` — drift operator console
- `frontend/src/pages/Analytics.tsx`, `Mappings.tsx`, `Outputs.tsx`,
  `Knowledge.tsx`, `Dashboard.tsx`, `Settings.tsx`, `Audit.tsx`

## Test isolation

See `README.md` → “Test isolation (Phase 0 hardening)” and
`../tests/conftest.py`. No test artifact may be written to the repo root.
