# Scripts

## deploy-to-github.sh

Push LifeBook to GitHub first (commit if needed, then push to `main`).

**Usage:**
```bash
./scripts/deploy-to-github.sh
```

- Asks to commit any uncommitted changes, then pushes to `origin main`.
- After push, Azure deploy runs automatically via GitHub Actions (if configured).

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

## run-local.sh

Runs the app locally (e.g. Docker Compose). See repo root **README.md**.
