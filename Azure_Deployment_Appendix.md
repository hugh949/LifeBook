# Azure Deployment Appendix — Option B (Next.js SSR on App Service + FastAPI on Container Apps)

**Deployments are managed via GitHub:** push to `main` or run workflows manually. See **§ 11) GitHub Actions** below.  
**First time?** Use **`First_Time_Deploy.md`** for a step-by-step checklist; this appendix is the full reference.

## 0) Target State (V1)

**Region: all resources in West US 3** (`westus3` — Phoenix, Arizona). Create every resource below in this location so deployment stays in one region.

### Azure resources (all in **West US 3**)
1) **Resource Group**: `rg-lifebook-v1` — create with `--location westus3`
2) **Azure App Service Plan** (Linux) + **Web App** for Next.js SSR
3) **Azure Container Apps Environment** + **Container App** for FastAPI
4) **Azure Database for PostgreSQL Flexible Server**
5) **Azure Storage Account (Blob)**
6) **Azure Key Vault**
7) (Optional) **Application Insights** for logs/metrics

---

## 1) Environment Variables (Recommended)

### Next.js (App Service) — App Settings
- `NEXT_PUBLIC_API_BASE_URL` = `https://<fastapi-domain>`
- `NEXT_PUBLIC_APP_ENV` = `dev|prod`
- `NEXT_PUBLIC_DEFAULT_LANGUAGE` = `auto`
- `NEXT_PUBLIC_SUPPORTED_LANGUAGES` = `en,zh-yue,zh,es,ur`

SSR-only secrets (do NOT expose as NEXT_PUBLIC):
- `INTERNAL_API_KEY` (optional, if you want SSR to call FastAPI with a service key)

### FastAPI (Container Apps) — Environment Variables
- `APP_ENV` = `dev|prod`
- `DATABASE_URL` = `postgresql+psycopg://...`
- `AZURE_STORAGE_ACCOUNT` = `...`
- `AZURE_STORAGE_CONTAINER_PHOTOS` = `photos`
- `AZURE_STORAGE_CONTAINER_AUDIO` = `audio`
- `AZURE_STORAGE_CONTAINER_TRAILERS` = `trailers` (optional V1)
- `AZURE_STORAGE_SAS_TTL_MINUTES` = `15`
- `OPENAI_API_KEY` = from Key Vault
- `OPENAI_REALTIME_MODEL` = (set to the model name you use)
- `OPENAI_TEXT_MODEL` = (set to the model name you use)
- `CORS_ALLOW_ORIGINS` = `https://<your-appservice-domain>,http://localhost:3000`

---

## 2) Key Vault Integration

Store secrets in Key Vault:
- `OPENAI-API-KEY`
- `DATABASE-URL`
- (Optional) `STORAGE-ACCOUNT-KEY` (if not using Managed Identity)
- (Optional) `INTERNAL-API-KEY`

### Recommended approach (V1)
- Mount Key Vault secrets into App Service and Container Apps as environment variables.

---

## 3) Blob Storage Setup (Private, Direct Upload)

### Containers
- `photos` (private)
- `audio` (private)
- `trailers` (private, optional V1)

### Upload pattern (SAS “valet key”) — **implemented**
1) Client → `POST /media/sas`
2) FastAPI returns `uploadUrl` (SAS URL with write+create) + `blobUrl` (canonical URL)
3) Client uploads directly with PUT to `uploadUrl`
4) Client calls `POST /media/complete` to register the Asset in Postgres

When `AZURE_STORAGE_ACCOUNT` and `AZURE_STORAGE_ACCOUNT_KEY` are set, the API generates real SAS tokens. Otherwise it returns stub URLs for local dev.

### Read URLs for display
- Moment list and detail return `thumbnail_url` and `image_url`. When those point to Azure blobs, the API signs them with short-lived read SAS (default 60 minutes) so the frontend can display photos without exposing the storage key.
- Set `AZURE_STORAGE_READ_SAS_TTL_MINUTES` (optional; default 60).

### Notes
- Use short TTL for upload (10–20 minutes); read SAS can be 30–60 minutes.
- Upload SAS: write + create only. Read SAS: read only.

---

## 4) Playback Strategy for Private Media (V1)

### Option A (Fastest V1): Signed read URLs
- FastAPI provides short-lived read SAS URLs when needed (Moment detail, SSR pages).

Pros: fastest.
Cons: URLs expire; must refresh.

### Option B (Later): Media proxy endpoint
- `GET /media/{assetId}` streams content after auth.
Pros: more control.
Cons: more load on API.

**Recommendation:** Option A for V1.

---

## 5) FastAPI Containerization

### Dockerfile (outline)
- Base: `python:3.11-slim`
- Install deps
- Run `uvicorn app.main:app --host 0.0.0.0 --port 8000`

### Container Apps settings
- Ingress: external
- Target port: 8000
- Min replicas: 1 (V1)
- CPU/memory: modest (e.g., 0.5 vCPU, 1GB)

---

## 6) Next.js SSR on Azure App Service

### Build & Run
- Build: `npm ci && npm run build`
- Start: `npm run start` (should run Next server)

### App Service configuration tips
- Enable “Always On”
- Set node version to LTS
- Use deployment slot for staging (optional)

### SSR and private media
- SSR pages should call FastAPI to fetch Moment metadata and request **read SAS URLs** (short-lived) for assets.

---

## 7) CORS & Realtime Notes (V1)

### CORS
FastAPI must allow:
- `http://localhost:3000`
- `https://<appservice-domain>`

Allow headers:
- `Authorization`
- `Content-Type`

### Realtime token minting
Do not expose OpenAI API keys to client.
Client requests:
- `POST /realtime/token`
Backend returns:
- ephemeral token/config
Client uses it to connect directly to OpenAI Realtime.

---

## 8) Database Provisioning (Postgres Flexible Server)

### Recommended
- Separate DB user with limited privileges
- Run migrations with Alembic (recommended) or Prisma (if you prefer JS tooling)
- Enable automated backups

---

## 9) CI/CD Outline (GitHub Actions)

**Implemented.** See **§ 12) GitHub Actions** for the exact workflows and secrets.

---

## 10) Resource Naming and Location (Example)

**Location for all:** **West US 3** (`westus3`).

- `rg-lifebook-v1` — resource group in westus3
- `kv-lifebook-v1` — Key Vault
- `stlifebookv1` (storage; globally unique, e.g. `lifebookv1prod`)
- `pg-lifebook-v1` — PostgreSQL Flexible Server
- `asp-lifebook-v1` — App Service Plan
- `app-lifebook-web-v1` — App Service (Web App)
- `acae-lifebook-v1` — Container Apps Environment
- `aca-lifebook-api-v1` — Container App
- `lifebookv1acr` — ACR (name only, no .azurecr.io)

---

## 11) GitHub Actions (Deployments managed via GitHub)

Workflows in `.github/workflows/`:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `deploy-web.yml` | Push to `main` (paths: `apps/web/**`) or Run workflow | Build Next.js, deploy to Azure App Service |
| `deploy-api.yml` | Push to `main` (paths: `services/api/**`) or Run workflow | Build API Docker image, push to ACR, update Container App |
| `deploy-all.yml` | Push to `main` (any path) or Run workflow | Run both deploy-web and deploy-api |

### Secrets (Repository → Settings → Secrets and variables → Actions)

**Web (App Service)**  
- `AZURE_WEBAPP_PUBLISH_PROFILE` — From Azure Portal: your Web App → **Get publish profile** (download the file, paste the whole XML as the secret value).

**API (Container Apps + ACR)**  
- `AZURE_CREDENTIALS` — JSON from Azure CLI (service principal with Contributor on the resource group and **AcrPush** on the ACR):

  ```bash
  az ad sp create-for-rbac --name "LifeBook-GitHub" --role contributor \
    --scopes /subscriptions/<SUB_ID>/resourceGroups/rg-lifebook-v1 \
    --sdk-auth
  ```
  Then assign **AcrPush** to that SP on the ACR (Access control (IAM) → Add role assignment → AcrPush → assign to the app named "LifeBook-GitHub").

### Variables (Repository → Settings → Secrets and variables → Actions → Variables)

Optional; defaults are shown. Override if your names differ.

| Name | Default | Used by |
|------|---------|--------|
| `AZURE_WEBAPP_NAME` | `app-lifebook-web-v1` | deploy-web |
| `AZURE_RESOURCE_GROUP` | `rg-lifebook-v1` | deploy-api |
| `AZURE_ACR_NAME` | `lifebookv1acr` | deploy-api |
| `AZURE_CONTAINER_APP` | `aca-lifebook-api-v1` | deploy-api |
| `AZURE_LOCATION` | `westus3` (West US 3) | deploy-api (when creating resources) |

### One-time Azure setup before first deploy

**Use location `West US 3` (Azure CLI: `westus3`) for every resource.**

1. Create all resources in **West US 3**:
   - Resource group (e.g. `az group create --name rg-lifebook-v1 --location westus3`)
   - App Service Plan + Web App (Node 20)
   - Container Apps Environment + Container App (placeholder image)
   - ACR (Container Registry)
   - Storage Account
   - Postgres Flexible Server  
   When using the Azure Portal, choose **West US 3** as the region for each.
2. In the Web App, set **Startup Command** to `npm run start` (or leave default if it runs `npm start`).
3. In the Web App **Configuration**, add `NEXT_PUBLIC_API_BASE_URL` = your Container App URL (e.g. `https://aca-lifebook-api-v1.xxx.azurecontainerapps.io`).
4. In the Container App, set env vars (e.g. `DATABASE_URL`, `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_ACCOUNT_KEY`, `OPENAI_API_KEY`, `CORS_ALLOW_ORIGINS`).
5. Create Blob containers `photos` and `audio` in the storage account (private).
6. Run DB migrations once (e.g. from your machine with `DATABASE_URL` pointing to Azure Postgres, or a one-off job in the Container App).

After that, every push to `main` (or manual run of the workflows) deploys via GitHub.

---

## 12) Production Hardening (Post-V1)

- Add CDN in front of Blob (Azure CDN / Front Door)
- App Insights + log sampling
- Queue-based processing for transcripts and summaries (Service Bus)
- Rate limiting + abuse protection
- Fine-grained sharing controls and expiring invites
