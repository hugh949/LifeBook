# Azure deployment workflows — review

Summary of the GitHub Actions workflows for deploying LifeBook to Azure (West US 3) and what was checked/fixed.

---

## Workflows overview

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| **Deploy All** | `deploy-all.yml` | Push to `main`, or manual | Runs both Deploy Web and Deploy API (in parallel) |
| **Deploy Web** | `deploy-web.yml` | Push (paths: `apps/web/**`) or manual | Build Next.js → deploy to Azure App Service |
| **Deploy API** | `deploy-api.yml` | Push (paths: `services/api/**`) or manual | Build API Docker image → push to ACR → update Container App |

---

## What was reviewed and fixed

### 1. Deploy Web — package path

- **Issue:** The job uses `defaults.run.working-directory: apps/web` for *run* steps, but the `azure/webapps-deploy` step is a *uses* step. For *uses* steps the working directory is the repo root, so `package: .` would deploy the **entire repo**, not just the built app.
- **Fix:** Set `package: apps/web` explicitly so the action deploys the correct folder (with `.next`, `node_modules`, `package.json`).

### 2. Deploy All — concurrency

- **Addition:** `concurrency: group: deploy-all-${{ github.ref }}, cancel-in-progress: false` so that rapid pushes don’t overlap; the latest run completes (no cancel).

### 3. Everything else

- **Secrets/variables:** Documented in workflow comments and in `First_Time_Deploy.md` / `Azure_Deployment_Appendix.md`.
- **API workflow:** Uses `az containerapp update`; the Container App must already exist (one-time setup). Docker build context `./services/api` and image tag `${{ github.sha }}` are correct.
- **West US 3:** Documented; `AZURE_LOCATION` variable available for future use.
- **Reusable workflows:** `deploy-all` correctly calls `deploy-web` and `deploy-api` with `secrets: inherit`. Repository variables (`vars.*`) are available in the called workflows.

---

## Required setup (reminder)

**Secrets (repo or environment):**

- `AZURE_WEBAPP_PUBLISH_PROFILE` — Web App publish profile (full XML).
- `AZURE_CREDENTIALS` — Service principal JSON (`az ad sp create-for-rbac --sdk-auth`). SP needs **Contributor** on the resource group and **AcrPush** on the ACR.

**Variables (optional; defaults in workflow):**

- `AZURE_WEBAPP_NAME` (default: `app-lifebook-web-v1`)
- `AZURE_RESOURCE_GROUP` (default: `rg-lifebook-v1`)
- `AZURE_ACR_NAME` (default: `lifebookv1acr`)
- `AZURE_CONTAINER_APP` (default: `aca-lifebook-api-v1`)
- `AZURE_LOCATION` (default: `westus3`)

**Azure resources (create once in West US 3):**

- Resource group, App Service (Node 20) + Web App, Container Apps Environment + Container App (placeholder image), ACR, Storage, Postgres. See **First_Time_Deploy.md**.

---

## Optional improvements (not done)

- **Pinned action versions:** e.g. `actions/checkout@v4` → `actions/checkout@v4.2.0` for stricter pinning.
- **OIDC for Azure:** Use `id-token: write` and Azure federated credential instead of `AZURE_CREDENTIALS` (more setup, no secret in repo).
- **Success summary job:** A final job in `deploy-all` that `needs: [deploy-web, deploy-api]` and echoes a “Deploy complete” message (cosmetic).

---

## How to run

- **Automatic:** Push to `main` → Deploy All runs (or only Web/API if only that path changed).
- **Manual:** Actions → “Deploy All (Web + API)” (or Deploy Web / Deploy API) → Run workflow.
- **Script:** `./scripts/deploy-to-github.sh` (commits if needed and pushes to `main`).
