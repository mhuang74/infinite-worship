# Repo layout and full legacy teardown at cutover

The new code lives in top-level `worker/` (the analysis Lambda: `InfiniteJukebox` ported from `exploration/remixatron` as a proper Python package plus a Lambda handler) and `infra/` (Terraform, AWS + Cloudflare providers); `application/` becomes frontend-only. This finally kills the `sys.path.append` shadow hack where `app.py` imported from `exploration/remixatron` while `backend/Remixatron.py` sat as a dead copy — `exploration/` returns to being pure notebooks. At cutover, **all** legacy deployment code is deleted rather than kept runnable: `application/backend/`, docker-compose files, `nginx.conf`, `build.sh`, plus the ECR images and Graviton host. Rationale: the migration's entire goal is eliminating server ops, and a "just in case" legacy stack is dead weight that git history already preserves.

## Consequences

- `application/` no longer means "two apps"; AGENTS.md and README must be rewritten at cutover or they will lie about the repo.
- Backend test `test_remixatron.py` must move with the ported analysis code into `worker/` or the only first-party test suite dies with the legacy deletion.
