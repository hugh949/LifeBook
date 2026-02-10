"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { requestUploadUrl, completeUpload } from "@/lib/media";
import { apiPost } from "@/lib/api";
import { useParticipantIdentity } from "@/app/components/ParticipantIdentity";

export default function UploadPage() {
  const { participantId, participants, loading: participantsLoading } = useParticipantIdentity();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [whoFor, setWhoFor] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [momentId, setMomentId] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const handleFile = useCallback((f: File | null) => {
    setFile(f);
    setStatus("idle");
    setMessage("");
    if (preview) URL.revokeObjectURL(preview);
    if (f && f.type.startsWith("image/")) {
      setPreview(URL.createObjectURL(f));
    } else {
      setPreview(null);
    }
  }, [preview]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const f = e.dataTransfer.files?.[0];
      if (f && (f.type.startsWith("image/") || f.type.startsWith("audio/"))) handleFile(f);
    },
    [handleFile]
  );
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDrag(true);
  }, []);
  const onDragLeave = useCallback(() => setDrag(false), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setMessage("Please choose a photo or audio first.");
      setStatus("error");
      return;
    }
    if (!participantId && participants.length > 0) {
      setMessage("Please choose who is adding this (I'm [Name] in the nav).");
      setStatus("error");
      return;
    }
    setStatus("uploading");
    setMessage("");
    try {
      const type = file.type.startsWith("audio/") ? "audio" : "photo";
      const { uploadUrl, blobUrl } = await requestUploadUrl({
        type,
        contentType: file.type,
        fileName: file.name,
      });
      const isStub = uploadUrl.startsWith("https://local-mvp/");
      if (!isStub) {
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": file.type },
        });
        if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
      }
      const { assetId: id } = await completeUpload({
        blobUrl,
        type,
        metadata: { source: "family_upload", fileName: file.name },
      });
      const titleFromCaption = caption.trim().split(/\n/)[0]?.slice(0, 200) || null;
      const title = titleFromCaption || file.name.replace(/\.[^.]+$/, "");
      const summary = caption.trim() || null;
      const tags: string[] = [];
      if (whoFor.trim()) tags.push(`For: ${whoFor.trim()}`);
      const moment = await apiPost<{ id: string }>("/moments", {
        title,
        summary,
        source: "family_upload",
        asset_ids: [id],
        tags_json: tags.length ? tags : undefined,
        participant_id: participantId || undefined,
      });
      setMomentId(moment?.id ?? null);
      setStatus("done");
      setMessage("Saved to My memories. Share with family when you're ready.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setMessage(msg);
      setStatus("error");
    }
  }

  return (
    <>
      <h1 className="page-title">Add a memory</h1>
      <p className="page-lead">
        One photo or voice note and an optional note. It stays in My memories until you share with the family.
      </p>

      {!participantsLoading && participants.length > 0 && (
        <p style={{ marginBottom: 16, fontSize: 14, color: "var(--ink-muted)" }}>
          Adding as: <strong>I&rsquo;m {participantId ? (participants.find((p) => p.id === participantId)?.label ?? "New User") : "New User"}</strong> (change in the nav above)
        </p>
      )}

      {status !== "done" ? (
        <form onSubmit={handleSubmit}>
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", margin: "0 0 8px" }}>
              1. Choose a photo or audio
            </h2>
            <div
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              className="card"
              style={{
                marginBottom: 8,
                border: `2px dashed ${drag ? "var(--accent)" : "var(--border)"}`,
                background: drag ? "var(--accent-soft)" : "var(--bg-card)",
                cursor: "pointer",
                textAlign: "center",
                padding: 24,
              }}
            >
              <input
                type="file"
                accept="image/*,audio/*"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
                id="file-upload"
              />
              <label htmlFor="file-upload" style={{ cursor: "pointer", display: "block" }}>
                {preview ? (
                  <div>
                    {file?.type.startsWith("image/") ? (
                      <img
                        src={preview}
                        alt="Preview"
                        style={{
                          maxWidth: "100%",
                          maxHeight: 200,
                          borderRadius: "var(--radius-sm)",
                          objectFit: "contain",
                        }}
                      />
                    ) : (
                      <p style={{ margin: 0, color: "var(--ink-muted)" }}>Audio selected</p>
                    )}
                    <p style={{ margin: "8px 0 0", color: "var(--ink-muted)", fontSize: 14 }}>
                      Tap to change
                    </p>
                  </div>
                ) : (
                  <p style={{ margin: 0, color: "var(--ink-muted)" }}>
                    Tap to pick a photo or audio from your device
                  </p>
                )}
              </label>
            </div>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", margin: "0 0 8px" }}>
              2. Add a note (optional)
            </h2>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="e.g. Grandpa, tell us about this day!"
              rows={3}
              maxLength={500}
              className="card"
              style={{
                width: "100%",
                resize: "vertical",
                fontFamily: "inherit",
                fontSize: 16,
                padding: 12,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
              }}
            />
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", margin: "0 0 8px" }}>
              3. Who&rsquo;s this for? (optional)
            </h2>
            <input
              type="text"
              value={whoFor}
              onChange={(e) => setWhoFor(e.target.value)}
              placeholder="e.g. For the family, For Grandpa"
              maxLength={120}
              className="card"
              style={{
                width: "100%",
                fontFamily: "inherit",
                fontSize: 16,
                padding: 12,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
              }}
            />
          </section>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={status === "uploading" || !file}
            aria-disabled={status === "uploading" || !file}
            style={{ width: "100%", fontSize: "1.1rem", padding: 16 }}
          >
            {status === "uploading" ? "Adding…" : !file ? "Choose a photo or audio first" : "Save to My memories"}
          </button>
          {message && status !== "uploading" && (
            <p
              role="alert"
              style={{
                marginTop: 16,
                padding: 12,
                borderRadius: "var(--radius-sm)",
                background: status === "error" ? "var(--error-bg)" : "var(--success-bg)",
                color: status === "error" ? "var(--error)" : "var(--success)",
              }}
            >
              {message}
            </p>
          )}
        </form>
      ) : (
        <div className="card" style={{ maxWidth: 420 }}>
          <p style={{ fontSize: "2.5rem", margin: "0 0 16px", textAlign: "center" }}>✓</p>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", margin: "0 0 8px", textAlign: "center" }}>
            Saved to My memories
          </h2>
          <p style={{ margin: "0 0 24px", color: "var(--ink-muted)", textAlign: "center" }}>
            {message}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
            <Link href="/my" className="btn btn-primary" style={{ textDecoration: "none", color: "white" }}>
              View My memories
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setStatus("idle");
                setMessage("");
                setMomentId(null);
                setCaption("");
                setWhoFor("");
                handleFile(null);
              }}
            >
              Add another memory
            </button>
          </div>
        </div>
      )}

      <p style={{ marginTop: 32, fontSize: 13, color: "var(--ink-faint)" }}>
        <Link href="/bank">Shared</Link> · <Link href="/">Home</Link>
      </p>
    </>
  );
}
