"use client";

import { useCallback, useEffect, useRef, useState, ChangeEvent } from "react";
import Link from "next/link";
import { apiGet, apiPostFormData, API_BASE } from "@/lib/api";

type AvatarStatus = {
  status: "none" | "pencilizing" | "ready" | "failed";
  original_url: string | null;
  pencil_url: string | null;
  error: string | null;
};

export default function AvatarPage() {
  const [status, setStatus] = useState<AvatarStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    apiGet<AvatarStatus>("/me/avatar").then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onPick = () => fileRef.current?.click();

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Please choose a photo under 10 MB.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("photo", file, file.name || "selfie.jpg");
      const next = await apiPostFormData<AvatarStatus>("/me/avatar", form);
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your pencil portrait.");
      refresh();
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete your avatar? Story narrations will no longer show your portrait.")) return;
    try {
      const res = await fetch(`${API_BASE}/me/avatar`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setStatus((await res.json()) as AvatarStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete avatar.");
    }
  };

  return (
    <>
      <p style={{ marginBottom: 10 }}><Link href="/me">← Me</Link></p>
      <h1 className="page-title">Your pencil-sketch avatar</h1>
      <p className="page-lead">
        Upload a clear selfie. We&rsquo;ll create a friendly pencil-sketch portrait for your story narrations.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png"
        onChange={onFile}
        style={{ display: "none" }}
      />

      {error ? <div className="msg msg-error" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}

      {uploading || status?.status === "pencilizing" ? (
        <div className="card center stack-12">
          <div><span className="spinner" /></div>
          <p style={{ margin: 0 }}>Pencil-sketching your portrait…</p>
          <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>This can take up to a minute.</p>
        </div>
      ) : status?.status === "ready" && status.pencil_url ? (
        <div className="card stack-12 center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={status.pencil_url}
            alt="Your pencil-sketch portrait"
            style={{
              width: 220,
              height: 220,
              borderRadius: "50%",
              objectFit: "cover",
              border: "1px solid var(--border)",
              margin: "0 auto",
            }}
          />
          <div className="msg msg-success">Your avatar is ready.</div>
          <div className="btn-row" style={{ justifyContent: "center" }}>
            <button className="btn btn-ghost" onClick={onPick}>Replace photo</button>
            <button className="btn btn-danger" onClick={remove}>Delete avatar</button>
          </div>
        </div>
      ) : status?.status === "failed" ? (
        <div className="card stack-12">
          <div className="msg msg-error">{status.error || "Couldn't create your portrait. Try a clearer selfie."}</div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={onPick}>Try again</button>
          </div>
        </div>
      ) : (
        <div className="card stack-12">
          <p style={{ margin: 0 }}>
            For best results, choose a well-lit photo with your face centered and no other people.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-muted)", fontSize: 14 }}>
            <li>Face clearly visible, head and shoulders.</li>
            <li>JPEG or PNG under 10 MB.</li>
          </ul>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={onPick}>Upload a selfie</button>
          </div>
        </div>
      )}
    </>
  );
}
