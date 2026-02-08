# Troubleshooting: "All keys are in GitHub" but 500s persist

If GitHub Secrets are set but the API still returns 500 (e.g. on Memory Bank, Talk, or /media/sas), check the following.

## 1. Confirm secrets reach the Container App

- **In GitHub Actions:** Run "Deploy API" and open the "Deploy to Container Apps" step. You should see:
  ```
  Secrets present (will be sent to Container App):
    DATABASE_URL: set
    AZURE_STORAGE_ACCOUNT: set
    AZURE_STORAGE_ACCOUNT_KEY: set
    ...
  ```
  If any show `(empty)`, that secret is missing or not available to the workflow (check repo Settings → Secrets).

- **In Azure Portal:** Container App → **Containers** → your container → **Environment variables**. Confirm the same names exist and have values (values may be masked). If they’re missing, the deploy step may have failed or an old revision may be serving traffic.

## 2. Traffic is on the latest revision

After each deploy, a **new revision** is created. If traffic is still on an old revision, it may have old or no env vars.

- **CLI:** `./scripts/azure-api-status.sh list` then `./scripts/azure-api-status.sh traffic <NEWEST_REVISION>=100`
- **Portal:** Container App → **Revisions and replicas** → set 100% traffic to the **latest** revision (highest number).

## 3. Azure Storage: containers and key

- **Containers:** In the Storage Account, create two **Blob** containers named exactly `photos` and `audio` if they don’t exist. The API expects these by default.
- **Key:** Use **Access keys** for that Storage Account. Copy the key with no extra spaces or newlines. If you pasted from a multi-line display, re-copy a single line and update the GitHub Secret.
- **Account name:** Must match the Storage Account (e.g. `lifebookv1prod`). Case-sensitive.

## 4. DATABASE_URL format

- Use **single** quotes when testing locally; in GitHub Secrets you paste the full URL as one line.
- **Password:** If the password contains `@` or `%`, URL-encode it (`@` → `%40`, `%` → `%25`) in the URL.
- PostgreSQL firewall must allow the Container App (or “Allow Azure services”).

## 5. See the real error

After the latest deploy (with improved error responses), trigger the failing request again and check:

- **Browser console:** The failed request’s response body should be JSON with a `detail` field (e.g. `"Storage SAS failed: ..."` or a DB error). That message is the actual failure reason.
- **Log Stream:** Container App → Log stream. Reproduce the error and look for `media/sas: ...` or `Unhandled exception ...` with the traceback.

Use the `detail` message and traceback to fix the specific misconfiguration (wrong key, missing container, DB URL, etc.).
