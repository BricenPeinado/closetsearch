# Launch Blockers

| Blocker                     | Type                  | Current state                                                  | Activation/evidence                                               |
| --------------------------- | --------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| eBay live provider          | external              | adapter complete; credentials/partner approval absent          | approved production credentials/terms/attribution + staging smoke |
| Grailed live provider       | external              | adapter complete; written permission reference absent          | exact written approval/reference + staging smoke                  |
| Two live real providers     | external              | zero authorized in checkout                                    | two independent no-mock successes                                 |
| Transactional account email | external/config       | flows/UI complete; sender absent                               | approved sender/domain + verification/reset/export E2E            |
| Production billing          | external/config       | entitlements/schema complete; provider absent                  | signed webhook/idempotency/subscription lifecycle                 |
| Live FX                     | external/config       | exact conversion/cache complete; source disabled               | approved rate source, refresh/persistence, stale behavior         |
| Final quality evidence      | internal verification | pending final merged SHA                                       | all required commands and five clean repeats                      |
| PostgreSQL/deployment proof | operational evidence  | local engine migration/reliability/restore pass; Docker absent | current CI, service restart, Compose, encrypted off-host restore  |
| No-mock HTTPS staging       | external/operational  | blocked by provider access                                     | smoke with expected provider IDs                                  |
| Privacy/retention review    | policy                | engineering draft only                                         | approved policy, enforcement, contacts/subprocessors              |
| Error tracking/dashboards   | internal/config       | redacted logs/metrics exist; external sink absent              | approved exporter, alert routing, and incident drill              |

## Not launch blockers because they are intentionally disabled

- push and SMS
- authenticity/fake verdicts
- active ML recommendation/fair-value candidates
- OAuth/social login

They become blockers only if a release claims them.
