# Apps

Runnable product processes:

- [`web`](web/README.md): React/Vite client for discovery, accounts, saved
  features, alerts, and analytics
- [`api`](api/README.md): TypeScript HTTP API, PostgreSQL data plane, and
  separately invoked worker entry point

Production deploys the web, API, worker, and one-shot migration job as separate
processes. Provider credentials remain server-side.
