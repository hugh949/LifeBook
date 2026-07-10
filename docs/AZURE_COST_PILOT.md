# Azure cost reduction (pilot) — LifeBook

**RG:** `rg-lifebook-v1`  
**Estate goal:** all Azure pilots **&lt; $150/mo** total (2–3 users each).  
**Index:** `~/Cursor/Cleanup/AZURE_COST_REDUCTION.md`

## Current posture (post Tier A, 2026-07-09)

| Resource | Setting |
|----------|---------|
| Container App `aca-lifebook-api-v1` | **minReplicas = 0** (was 1) — scale-to-zero |

Expect **cold starts** after idle; verify scripts already allow longer timeouts (see `Deployment_Pitfalls_and_Learnings.md`).

### User-facing feedback

- First request after idle may take **~20s** (ACA `minReplicas=0`).
- Sign-in / auth can sit on **“Loading…”** with no dedicated cold-start copy — **retry** if it fails or hangs.
- Per-page errors exist; no global outage banner. Prefer longer client timeouts over keeping a warm replica.

## What changed this session

- Scale-to-zero on the API Container App to cut idle compute cost (part of estate Tier A).

## Do not regress

- **Do not set minReplicas back to 1** “for snappier demos” without accepting idle monthly cost and updating the estate cost doc.
- Prefer scale-to-zero for internal pilots with 2–3 users.

## Pending

- None specific from this session. Watch cold-start UX; tune timeouts rather than keeping a warm replica unless needed.

## Agent note

When editing ACA scale, always-on, or performance scripts: keep cost constraints in mind. Cold start &gt; idle bill for this pilot.
