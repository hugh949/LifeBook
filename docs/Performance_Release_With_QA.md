# Performance release with snapshot, QA, and benchmarks

This doc describes the process for applying performance improvements (Always On, pilot scale, DB pool) with a safe snapshot, verification logs, comprehensive QA, and before/after benchmarks.

## Pilot settings (cost-minimal, ≤5 users)

| Component       | Setting        | Pilot value | Rationale                        |
|----------------|----------------|-------------|----------------------------------|
| Web App        | Always On      | On          | Fewer cold first-request delays  |
| Container App  | Min replicas   | 1           | No scale-to-zero                 |
| Container App  | Max replicas   | 1           | Minimize cost; 1 replica enough  |
| Container App  | CPU / Memory   | Current     | No increase unless issues appear|
| API (code)     | DB pool        | 5/10/300    | Stable connections, no extra cost|

## Release order

1. **Snapshot**
   - Create git tag: `git tag -a release/pre-perf-YYYYMMDD -m "Snapshot before performance changes"` then `git push origin release/pre-perf-YYYYMMDD`.
   - DB backup: `DATABASE_URL='<production-url>' ./scripts/backup-db.sh` (optionally set `AZURE_STORAGE_ACCOUNT` and `AZURE_STORAGE_ACCOUNT_KEY` to upload to blob).
   - Azure state: `./scripts/azure-snapshot-state.sh` → `logs/azure-snapshot-*.json` and `logs/azure-snapshot-*.log`.

2. **Baseline metrics**
   - `./scripts/performance-benchmark.sh` → save output to `logs/performance-baseline-pre-perf-YYYYMMDD.json` (set `OUTPUT_JSON=logs/performance-baseline-pre-perf-YYYYMMDD.json`).
   - `QA_LOG=1 ./scripts/qa-verify-prod.sh` → `logs/qa-baseline-pre-perf-*.log`.

3. **Apply Azure (pilot settings)**
   - `./scripts/azure-performance-apply.sh` (Always On + min/max replicas 1). Logs: `logs/azure-performance-apply-*.log`, `logs/azure-webapp-always-on-*.log`, `logs/azure-containerapp-scale-*.log`.

4. **Apply code**
   - Commit DB pool changes in `services/api/app/db/session.py`; deploy via `gh workflow run deploy-all.yml` (after push to main).

5. **After metrics**
   - `./scripts/performance-benchmark.sh` → `OUTPUT_JSON=logs/performance-after-perf-YYYYMMDD.json ./scripts/performance-benchmark.sh`.
   - `QA_LOG=1 ./scripts/qa-verify-prod.sh`.

6. **Compare**
   - `./scripts/performance-compare.sh logs/performance-baseline-pre-perf-YYYYMMDD.json logs/performance-after-perf-YYYYMMDD.json` for a before/after table.

## Key performance metrics (benchmarks)

| Metric ID                 | Description                          | Target (post-change)        |
|---------------------------|--------------------------------------|-----------------------------|
| ttfb_home                 | Time to first byte – home page      | Lower than baseline         |
| ttfb_proxy                | TTFB – API proxy ping                | Lower than baseline         |
| latency_health           | API health latency (s)               | Lower than baseline         |
| latency_voice_shared      | GET shared stories latency (s)      | Lower than baseline         |
| latency_voice_context     | GET voice context latency (s)       | Lower than baseline         |
| cold_start_health_ms      | Health latency after 5 min idle (ms)| Low (no scale-from-zero)    |

Run with `COLD_START=1` once (e.g. after 5 min idle) to capture cold_start_health_ms:  
`COLD_START=1 ./scripts/performance-benchmark.sh`.

## Rollback

If QA fails or users report issues after the performance release:

- **Revert app:** `SNAPSHOT_TAG=release/pre-perf-YYYYMMDD ./scripts/rollback-to-snapshot.sh`. Optionally `SKIP_DEPLOY=1` to only checkout the tag, then push and trigger deploy manually.
- **Revert DB:** Only if you ran migrations or changed DB state; restore from the dump taken in step 1 per [Backup_And_Recovery.md](Backup_And_Recovery.md).

## Log locations

| Log / file pattern                         | Purpose                          |
|--------------------------------------------|----------------------------------|
| `logs/azure-snapshot-*.log`, `*.json`      | Pre-change Azure state           |
| `logs/azure-webapp-always-on-*.log`        | Always On apply + verify         |
| `logs/azure-containerapp-scale-*.log`      | Scale apply + verify             |
| `logs/azure-performance-apply-*.log`       | Full Azure apply run             |
| `logs/qa-baseline-pre-perf-*.log`          | QA result before changes         |
| `logs/qa-verify-prod-*.log`                | QA result (when `QA_LOG=1`)      |
| `logs/performance-baseline-pre-perf-*.json`| Benchmark before                 |
| `logs/performance-after-perf-*.json`       | Benchmark after                  |
| `logs/performance-benchmark-*.log`         | Benchmark run log                |
| `logs/rollback-*.log`                      | Rollback run                     |

Add `logs/` to `.gitignore` so these are not committed.
