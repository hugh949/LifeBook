# Scripts

## deploy-to-github.sh

Push LifeBook to GitHub first (commit if needed, then push to `main`).

**Usage:**
```bash
./scripts/deploy-to-github.sh
```

- Asks to commit any uncommitted changes, then pushes to `origin main`.
- After push, Azure deploy runs automatically via GitHub Actions (if configured).

**If you see "Repository not found":**
1. **Create the repo on GitHub first:** [github.com/new](https://github.com/new) → name **LifeBook** → leave "Add a README" **unchecked** → Create.
2. **Check URL:** `git remote -v` should show your repo. Fix: `git remote set-url origin https://github.com/YOUR_USERNAME/LifeBook.git`
3. **Use the right account:** When Git asks for credentials, use the GitHub account that **owns** the repo (username + [Personal Access Token](https://github.com/settings/tokens) as password).

---

## deploy-to-azure.sh

Deploy LifeBook to Azure via GitHub Actions.

**What it does:**
- Runs from the repo root (or from `scripts/`).
- If you have uncommitted changes, offers to commit them.
- Pushes `main` to `origin`, which triggers the **Deploy All (Web + API)** workflow on GitHub.
- Prints the link to your repo’s Actions page so you can watch the run.
- If `gh` (GitHub CLI) is installed, shows the latest workflow run and how to trigger deploy manually.

**Usage:**
```bash
./scripts/deploy-to-azure.sh
```
Or from repo root:
```bash
bash scripts/deploy-to-azure.sh
```

**Requirements:**
- Git remote `origin` set (e.g. `https://github.com/hugh949/LifeBook.git`).
- Pushed to `main` (or the script will offer to push).
- GitHub Actions secrets set for Azure (see **First_Time_Deploy.md**).

**Manual workflow trigger (no push):**
```bash
gh workflow run deploy-all.yml
# Or only web or only API:
gh workflow run deploy-web.yml
gh workflow run deploy-api.yml
```

---

## azure-create-acr.sh

Create the Azure Container Registry (ACR) so the API workflow can push images.

**Usage:**
```bash
./scripts/azure-create-acr.sh
```
Creates `lifebookv1acr` in `rg-lifebook-v1` (West US 3). If that name is taken, run `ACR_NAME=myuniquename ./scripts/azure-create-acr.sh` and set GitHub variable **AZURE_ACR_NAME** to that name.

After creating, grant the SP push access (no Portal needed):
```bash
./scripts/azure-acr-grant-push.sh
```

---

## azure-acr-grant-push.sh

Grant the **LifeBook-GitHub** service principal **AcrPush** on your ACR so GitHub Actions can push the API image. Use this if you can't or don't want to do it in the Portal.

**Usage:**
```bash
./scripts/azure-acr-grant-push.sh
```
Uses ACR name `lifebookv1acr` and SP name `LifeBook-GitHub`. If your ACR has a different name: `ACR_NAME=myacr ./scripts/azure-acr-grant-push.sh`

Requires that you have permission to create role assignments (e.g. Owner or User Access Administrator on the ACR or subscription).

---

## azure-acr-containerapp-pull.sh

Let the **Container App** (API) pull images from ACR using its **system-assigned Managed Identity**. Use this when the Portal doesn’t show AcrPull or you prefer CLI.

**Usage:**
```bash
az login
./scripts/azure-acr-containerapp-pull.sh
```

**What it does:**
1. Enables system-assigned identity on the Container App (if not already).
2. Assigns the **AcrPull** role on your ACR to that identity (by role name, or by built-in role ID if name isn’t available).
3. Registers the ACR with the Container App so it uses this identity for image pull.

**Overrides (optional):**
```bash
AZURE_RESOURCE_GROUP=my-rg AZURE_ACR_NAME=myacr AZURE_CONTAINER_APP=my-app ./scripts/azure-acr-containerapp-pull.sh
```

Requires: `az` CLI, logged in with an account that can modify the Container App and create role assignments on the ACR (e.g. Owner or User Access Administrator).

---

## azure-create-postgres.sh

Create Azure PostgreSQL Flexible Server (Burstable B1ms) via CLI – target **under ~$30/month**.

**Usage:**
```bash
# Set password (required: 8+ chars, upper, lower, number, special)
PG_ADMIN_PASSWORD='YourSecurePassword123!' ./scripts/azure-create-postgres.sh
```

Or you'll be prompted for the password. The script creates:

- **Tier:** Burstable (Standard_B1ms)
- **Storage:** 32 GB (minimum)
- **Backup:** 7 days
- **Region:** West US 3
- **Public access:** 0.0.0.0 (allows Azure services; restrict later if needed)

**Output:** Prints `DATABASE_URL` to add to GitHub Secrets.

**Overrides:** `AZURE_RESOURCE_GROUP`, `AZURE_LOCATION`, `PG_SERVER_NAME`, `PG_ADMIN_USER`, `PG_DATABASE`.

---

## azure-postgres-change-password.sh

Change the Azure PostgreSQL admin password. Prompts for new password (supports `@` and other special characters). Outputs the new `DATABASE_URL` with the password URL-encoded for GitHub Secrets.

**Usage:**
```bash
./scripts/azure-postgres-change-password.sh
```

When prompted, type the new password (nothing will appear as you type). The script updates Azure and prints the `DATABASE_URL` to paste into GitHub Secrets.

**Overrides:** `AZURE_RESOURCE_GROUP`, `PG_SERVER_NAME`, `PG_ADMIN_USER`, `PG_DATABASE`.

---

## azure-api-status.sh

Manage and inspect the LifeBook API Container App via Azure CLI (no Portal needed).

**Usage:**
```bash
./scripts/azure-api-status.sh <command> [args]
```

**Commands:**

| Command | Description |
|---------|-------------|
| `list` | List revisions with status (Active, Failed, etc.) |
| `traffic` | Show traffic split |
| `traffic REVISION=100` | Send 100% traffic to a revision (e.g. working one) |
| `logs [N] [--follow] [--system]` | Last N console log lines (default 100); `--follow` streams; `--system` for system logs |
| `health` | Curl `GET /health` on the API |
| `moments` | Curl `GET /moments` — use to reproduce 500 and see API error body in CLI |
| `url` | Print the API base URL |
| `summary` | One-shot: revisions + traffic + health + last 30 log lines |

**Examples:**
```bash
# List revisions, find the working one
./scripts/azure-api-status.sh list

# Route all traffic to the working revision (e.g. rx9fam5)
./scripts/azure-api-status.sh traffic aca-lifebook-api-v1--rx9fam5=100

# One-shot: status + recent logs (good first check)
./scripts/azure-api-status.sh summary

# Stream logs (like Portal Log Stream)
./scripts/azure-api-status.sh logs 200 --follow

# Reproduce /moments 500 and see error body
./scripts/azure-api-status.sh moments

# Check if API responds
./scripts/azure-api-status.sh health
./scripts/azure-api-status.sh url
```

**Requirements:** `az` CLI, logged in (`az login`).

**Overrides:** `AZURE_RESOURCE_GROUP`, `AZURE_CONTAINER_APP` (defaults: `rg-lifebook-v1`, `aca-lifebook-api-v1`).

---

## troubleshoot-prod-backend.sh

Deep troubleshooting for production: why the backend (Container App) or database might not be responding. Runs seven checks and suggests next steps.

**Usage:**
```bash
# From repo root (uses default PROD_WEB_URL)
./scripts/troubleshoot-prod-backend.sh

# With Web App URL and optional DB check
PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/troubleshoot-prod-backend.sh
DATABASE_URL='postgresql://...' ./scripts/troubleshoot-prod-backend.sh
```

**Checks:** (1) Web App proxy and API_UPSTREAM, (2) GET /api/health via proxy, (3) GET /health on Container App directly, (4) Revisions and traffic, (5) Container App system log (exit 255, probe failed), (6) Database connectivity from this machine (if DATABASE_URL set; uses psql or Python/psycopg), (7) Postgres firewall rules (if `az` and server name available).

**Requirements:** `curl`. For full checks: Azure CLI (`az login`), and optionally `DATABASE_URL` and `psql` or repo `uv` for DB test.

**Overrides:** `PROD_WEB_URL`, `AZURE_RESOURCE_GROUP`, `AZURE_CONTAINER_APP`, `AZURE_WEBAPP_NAME`, `PG_SERVER_NAME`.

---

## azure-storage-cors.sh

Set CORS on the Azure Storage Account (Blob service) so the browser can load photos/audio from blob URLs. Run **once** per storage account (or when you add a new Web App origin).

**Usage:**
```bash
AZURE_STORAGE_ACCOUNT=lifebookv1prod AZURE_STORAGE_ACCOUNT_KEY='<key>' ./scripts/azure-storage-cors.sh
```

**Optional:** `WEB_APP_ORIGIN` or `ALLOWED_ORIGINS` (space-separated) to allow different origins. Defaults include `https://app-lifebook-web-v1.azurewebsites.net` and `http://localhost:3000`.

**When to use:** If loading a photo in the app gives "Preflight response is not successful. Status code: 403" or "access control checks", run this script with the same storage account and key used by the API.

---

## run-local.sh

Runs the app locally (e.g. Docker Compose). See repo root **README.md**.
