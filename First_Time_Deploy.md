# First-time Azure deployment (LifeBook)

Use this checklist for your **first** deploy. After that, you’ll iterate by pushing to `main` or re-running the GitHub workflows—no need to repeat these steps.

**Region:** Create every resource in **West US 3** (`westus3`).

---

## 1. Create Azure resources (West US 3)

Do this once, in any order that respects dependencies. Prefer **Azure Portal** for the first time; you can switch to CLI/Bicep later.

| # | Resource | Portal path | Notes |
|---|----------|-------------|--------|
| 1 | **Resource group** | Create a resource group | Name e.g. `rg-lifebook-v1`, **Region: West US 3** |
| 2 | **Storage account** | Create → Storage account | Same RG, **West US 3**. Create private containers: `photos`, `audio`. Note the **account name** (e.g. `lifebookv1prod`). You’ll need an **access key** for the API. |
| 3 | **Azure Container Registry (ACR)** | Create → Container registry | Same RG, **West US 3**. Name e.g. `lifebookv1acr`. Or run `./scripts/azure-create-acr.sh`. Then run `./scripts/azure-acr-grant-push.sh` to grant **LifeBook-GitHub** AcrPush (no Portal needed). |
| 4 | **PostgreSQL Flexible Server** | Create → Azure Database for PostgreSQL Flexible Server | Same RG, **West US 3**. Create a server + database (e.g. `lifebook`). Note **host**, **user**, **password**; build `DATABASE_URL` = `postgresql://user:password@host:5432/lifebook` (use `postgresql+psycopg://...` if your driver needs it). |
| 5 | **Container Apps environment** | Create → Container Apps → start with Environment | Same RG, **West US 3**. Name e.g. `acae-lifebook-v1`. |
| 6 | **Container App (API)** | In the same environment, create a Container App | Name e.g. `aca-lifebook-api-v1`. Use **any public image** as placeholder (e.g. `mcr.microsoft.com/azuredocs/containerapps-helloworld:latest`). Ingress: **external**, port **8000**. Add env vars (see step 3 below). |
| 7 | **App Service Plan + Web App** | Create → Web App | Same RG, **West US 3**. Runtime: **Node 20**. Name e.g. `app-lifebook-web-v1`. Set **Startup Command** to `npm run start`. Add app setting: `NEXT_PUBLIC_API_BASE_URL` = your Container App URL (e.g. `https://aca-lifebook-api-v1.<random>.azurecontainerapps.io`). |

---

## 2. Configure the API (Container App)

In the **Container App** (API) → **Containers** → your container → **Environment variables**, add (or use Key Vault references later):

| Name | Value / source |
|------|-----------------|
| `DATABASE_URL` | `postgresql+psycopg://user:password@host:5432/lifebook` (from step 1.4) |
| `AZURE_STORAGE_ACCOUNT` | Storage account name |
| `AZURE_STORAGE_ACCOUNT_KEY` | Storage account key (Access keys) |
| `AZURE_STORAGE_CONTAINER_PHOTOS` | `photos` |
| `AZURE_STORAGE_CONTAINER_AUDIO` | `audio` |
| `OPENAI_API_KEY` | Your OpenAI key (for voice; optional for photo-only) |
| `CORS_ALLOW_ORIGINS` | `https://app-lifebook-web-v1.azurewebsites.net` (your Web App URL; add `http://localhost:3000` if you need local dev against this API) |

---

## 3. Run database migrations (once)

From your machine (or a one-off job) with `DATABASE_URL` pointing at the Azure Postgres:

```bash
cd services/api
pip install .
alembic upgrade head
```

Or run the same inside the API container after the first deploy (see appendix).

---

## 4. GitHub secrets and variables

In your repo: **Settings → Secrets and variables → Actions**.

**Secrets (required):**

- **`AZURE_WEBAPP_PUBLISH_PROFILE`**  
  In Azure: **Web App** → **Get publish profile**. Open the downloaded file, copy the **entire** XML, and paste as the secret value.

- **`AZURE_CREDENTIALS`**  
  Create a service principal and paste the JSON:
  ```bash
  az ad sp create-for-rbac --name "LifeBook-GitHub" --role contributor \
    --scopes /subscriptions/<YOUR_SUBSCRIPTION_ID>/resourceGroups/rg-lifebook-v1 \
    --sdk-auth
  ```
  Then in Azure: **ACR** → **Access control (IAM)** → **Add role assignment** → **AcrPush** → assign to the app **LifeBook-GitHub** (the service principal you just created).  
  **If login fails with "client-id and tenant-id not supplied":** Use `--sdk-auth` so the JSON has `clientId`, `clientSecret`, `subscriptionId`, `tenantId`. Or use four secrets instead: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_CLIENT_SECRET`.

**Variables (optional):**  
If you used different names, add: `AZURE_WEBAPP_NAME`, `AZURE_RESOURCE_GROUP`, `AZURE_ACR_NAME`, `AZURE_CONTAINER_APP`. Defaults are in the table in `Azure_Deployment_Appendix.md` § 11.

---

## 5. First deploy from GitHub

1. Push your code to the `main` branch (or merge a PR into `main`).
2. Go to **Actions** and run **“Deploy All (Web + API)”** (or run **“Deploy Web”** and **“Deploy API”** once each).
3. Wait for both jobs to succeed. The Web App will serve the frontend; the Container App will serve the API (with the new image from ACR).

If the API was using a placeholder image, the workflow replaces it with your built image. If migrations didn’t run in step 3, run them now (step 3) and redeploy the API if needed.

---

## 6. Check the live app

- **Frontend:** `https://<your-web-app-name>.azurewebsites.net`
- **API health:** `https://<your-container-app-url>/health`

Try: upload a photo (Family → Upload), then open Memory Bank. Photos should appear (Azure Blob) if storage is configured.

---

## Iterating after the first deploy

You’re set up for **many iterations** with early adopters:

- **Deploy on every change:** Push to `main` → **Deploy All** runs automatically (or only **Deploy Web** / **Deploy API** when you change only one).
- **Deploy on demand:** **Actions** → choose **Deploy Web**, **Deploy API**, or **Deploy All** → **Run workflow**.
- **No need to touch Azure** for routine releases: same resources, same secrets; GitHub builds and deploys the new code.

Only if you add new env vars (e.g. a new API key) do you update the **Web App** or **Container App** configuration in Azure (or Key Vault) and optionally redeploy.

For full reference (CORS, Key Vault, production hardening), see **`Azure_Deployment_Appendix.md`**.
