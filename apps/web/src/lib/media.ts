import { apiPost } from "./api";

export type SasResponse = { uploadUrl: string; blobUrl: string; expiresAt: string };

export async function requestUploadUrl(args: {
  type: "photo" | "audio";
  contentType: string;
  fileName: string;
}): Promise<SasResponse> {
  return apiPost<SasResponse>("/media/sas", args);
}

export async function completeUpload(args: {
  blobUrl: string;
  type: "photo" | "audio";
  metadata?: Record<string, unknown>;
}): Promise<{ assetId: string }> {
  return apiPost<{ assetId: string }>("/media/complete", args);
}
