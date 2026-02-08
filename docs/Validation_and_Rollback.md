# Validation and Rollback

Short guide for the validation cycle (local → small change → deploy → verify prod) and how to roll back or abandon.

## Release control (manual deploy only)

Production does **not** deploy on push to `main`. To deploy:

1. **GitHub** → repo → **Actions** → **Deploy All (Web + API)** → **Run workflow** → **Run workflow** (branch: `main`).
2. Wait for the run to finish, then verify (see below).

## Phase 3: Verify production after deploy

After merging to `main` and running the **Deploy All** workflow (or deploy-api + deploy-web):

1. **Production web URL** (default): `https://app-lifebook-web-v1.azurewebsites.net`  
   Override with GitHub variable `AZURE_WEBAPP_NAME` (e.g. `app-lifebook-web-v1` → `https://<name>.azurewebsites.net`).

2. **Quick checks:**
   - **Proxy:** `curl -s https://app-lifebook-web-v1.azurewebsites.net/api/proxy-ping`  
     Expect: HTTP 200 and JSON with `"proxy": true`.
   - **API health:** `curl -s https://app-lifebook-web-v1.azurewebsites.net/api/health`  
     Expect: HTTP 200.

3. **Script:**  
   `PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh`  
   Exits 0 if both checks pass, 1 otherwise.

4. **Smoke test:** Open the production URL in a browser, go to Older → Talk, and confirm the session message (e.g. includes “(Voice pipeline OK.)” if that change was deployed).

## Rollback or abandon

If production is broken or you want to undo the last change:

1. **Revert the commit on `main`:**
   - `git checkout main && git pull`
   - `git revert HEAD --no-edit` (or revert a specific commit)
   - `git push origin main`

2. **Redeploy:** Run the **Deploy All** (or deploy-api + deploy-web) workflow so production runs the reverted code.

3. **Optional:** Delete the feature branch (e.g. `validate-pipeline`) if you no longer need it:  
   `git push origin --delete validate-pipeline`

To **abandon** a branch without merging: don’t merge; close the PR and optionally delete the branch. Production is unchanged until you merge and deploy.
