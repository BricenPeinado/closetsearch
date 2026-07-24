# Fixture Evaluation v1

Command:

```sh
corepack pnpm --filter @closetsearch/ml evaluate
```

This evidence is deterministic synthetic-fixture validation, not production performance evidence.

## Recommendation at K=5

Eight synthetic held-out users were evaluated, including two cold-start users.

| Metric                       | Rules baseline | Hybrid candidate |
| ---------------------------- | -------------: | ---------------: |
| Recall@5                     |         0.0000 |           0.8750 |
| NDCG@5                       |         0.0000 |           0.7577 |
| MAP@5                        |         0.0000 |           0.7188 |
| Catalog coverage             |         0.3889 |           0.9444 |
| Intra-list diversity         |         0.8938 |           0.8375 |
| Novelty                      |         2.3965 |           3.0027 |
| Provider concentration (HHI) |         0.3350 |           0.3400 |
| Brand concentration (HHI)    |         0.2250 |           0.1763 |

Cold-start candidate results were Recall@5 `0.5000`, NDCG@5 `0.2153`, MAP@5 `0.1250`, and diversity `0.7850`.

Decision: **not promoted**. The fixture has 8 users and one snapshot versus required 100 users and three snapshots. Candidate diversity also trails the fixture baseline by more than the allowed `0.02`. The apparently large relevance lift is a property of the constructed fixture.

## Fair value

Six synthetic future sold rows were evaluated across three brands/categories.

| Metric                | Observed-median baseline | Ridge candidate |
| --------------------- | -----------------------: | --------------: |
| MAE (minor units)     |                    4,500 |           5,623 |
| Median absolute error |                    4,500 |           5,977 |
| MAPE (eligible rows)  |                  11.143% |         13.832% |
| Interval coverage     |                   0.0000 |          0.1667 |
| Test sample count     |                        6 |               6 |

Candidate segment MAE:

- Maison Margiela/shoes: `5,087`
- Prada/bags: `6,366.5`
- Rick Owens/jackets: `5,415.5`

Decision: **not promoted**. The candidate is worse than the simple baseline, interval coverage is far below the required `0.80`, the test has only six sales, and only one snapshot exists. The active product behavior must remain robust observed comparable ranges with limited-data gates.
