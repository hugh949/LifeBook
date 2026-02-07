from pydantic import BaseModel


class SasRequest(BaseModel):
    type: str  # "photo" | "audio"
    contentType: str
    fileName: str


class SasResponse(BaseModel):
    uploadUrl: str
    blobUrl: str
    expiresAt: str


class CompleteRequest(BaseModel):
    blobUrl: str
    type: str  # "photo" | "audio"
    metadata: dict | None = None


class CompleteResponse(BaseModel):
    assetId: str
