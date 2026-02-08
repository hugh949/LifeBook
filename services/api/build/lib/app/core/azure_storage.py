"""
Azure Blob Storage SAS helpers. Used for upload (write) and read (display) URLs.
When AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_ACCOUNT_KEY are set, generates real SAS tokens.
Otherwise callers fall back to stub or raw blob URLs.
"""
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse

# Lazy import so app starts without azure-storage-blob if not used
def _generate_blob_sas(account_name: str, container_name: str, blob_name: str, account_key: str, *, read: bool = False, write: bool = False, create: bool = False, expiry_minutes: int = 15) -> str:
    from azure.storage.blob import generate_blob_sas, BlobSasPermissions
    start = datetime.now(timezone.utc)
    expiry = start + timedelta(minutes=expiry_minutes)
    perm = BlobSasPermissions(read=read, write=write, create=create)
    return generate_blob_sas(
        account_name=account_name,
        container_name=container_name,
        blob_name=blob_name,
        account_key=account_key,
        permission=perm,
        expiry=expiry,
        start=start,
    )


def parse_blob_url(blob_url: str) -> tuple[str, str, str] | None:
    """Parse Azure blob URL into (account_name, container_name, blob_name). Returns None if not Azure."""
    try:
        parsed = urlparse(blob_url)
        if not parsed.hostname or ".blob.core.windows.net" not in parsed.hostname:
            return None
        account = parsed.hostname.removesuffix(".blob.core.windows.net")
        path = (parsed.path or "").strip("/")
        if not path:
            return None
        parts = path.split("/", 1)
        container = parts[0]
        blob_name = parts[1] if len(parts) > 1 else ""
        return (account, container, blob_name)
    except Exception:
        return None


def build_blob_url(account: str, container: str, blob_name: str) -> str:
    return f"https://{account}.blob.core.windows.net/{container}/{blob_name}"


def generate_upload_sas(
    account_name: str,
    account_key: str,
    container: str,
    blob_name: str,
    expiry_minutes: int = 15,
) -> tuple[str, str]:
    """Return (blob_url, upload_url_with_sas)."""
    blob_url = build_blob_url(account_name, container, blob_name)
    sas = _generate_blob_sas(
        account_name, container, blob_name, account_key,
        write=True, create=True, expiry_minutes=expiry_minutes,
    )
    upload_url = f"{blob_url}?{sas}"
    return blob_url, upload_url


def signed_read_url(blob_url: str, account_key: str, expiry_minutes: int = 60) -> str:
    """
    If blob_url is an Azure blob URL and account_key is set, return blob_url with read SAS.
    Otherwise return blob_url unchanged (e.g. local stub).
    """
    parsed = parse_blob_url(blob_url)
    if not parsed or not account_key:
        return blob_url
    account_name, container_name, blob_name = parsed
    sas = _generate_blob_sas(
        account_name, container_name, blob_name, account_key,
        read=True, expiry_minutes=expiry_minutes,
    )
    sep = "&" if "?" in blob_url else "?"
    return f"{blob_url}{sep}{sas}"
