"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

type Moment = {
  id: string;
  title?: string | null;
  summary?: string | null;
  source?: string;
  created_at?: string | null;
  thumbnail_url?: string | null;
  image_url?: string | null;
};

function formatDate(created_at: string | null | undefined): string {
  if (!created_at) return "";
  const d = new Date(created_at);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** True if URL is a stub (e.g. local-mvp) that won't load as an image */
function isStubMediaUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  return url.startsWith("https://local-mvp/") || url.startsWith("http://local-mvp/");
}

export default function BankPage() {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Moment[]>("/moments")
      .then(setMoments)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <h1 className="page-title">Memory Bank</h1>
      <p className="page-lead">
        Moments you’ve saved — photos, voice, and stories. Tap one to view or share.
      </p>

      <a
        href="/family/upload"
        className="btn btn-primary"
        style={{ marginBottom: 24, display: "inline-block", textDecoration: "none", color: "white" }}
      >
        Add to Memory Bank
      </a>

      {loading && (
        <p style={{ color: "var(--ink-muted)" }}>Loading…</p>
      )}
      {error && (
        <p role="alert" className="card" style={{ background: "var(--error-bg)", color: "var(--error)" }}>
          {error}
        </p>
      )}
      {!loading && !error && moments.length === 0 && (
        <div className="card empty-state">
          <div className="icon">📚</div>
          <p style={{ margin: 0, fontSize: 1.1 }}>
            No moments yet. Use the button above or below to add a photo or voice note.
          </p>
          <a
            href="/family/upload"
            className="btn btn-primary"
            style={{ marginTop: 20, display: "inline-block", textDecoration: "none", color: "white" }}
          >
            Add a photo or voice note
          </a>
        </div>
      )}
      {!loading && !error && moments.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 16,
          }}
        >
          {moments.map((m) => {
            const thumbUrl = m.thumbnail_url || m.image_url;
            const showThumb = thumbUrl && !isStubMediaUrl(thumbUrl);
            return (
              <li key={m.id ?? String(Math.random())}>
                <a
                  href={`/m/${m.id}`}
                  className="card"
                  style={{
                    textDecoration: "none",
                    color: "var(--ink)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    padding: 0,
                    minHeight: 200,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "4/3",
                      backgroundColor: "var(--border)",
                      position: "relative",
                      flexShrink: 0,
                    }}
                  >
                    {showThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbUrl}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hide");
                        }}
                      />
                    ) : null}
                    <div
                      className={showThumb ? "hide" : ""}
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--ink-faint)",
                        fontSize: 40,
                      }}
                      aria-hidden
                    >
                      📷
                    </div>
                  </div>
                  <div style={{ padding: "10px 12px", flex: 1, minHeight: 0 }}>
                    <h2
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "0.95rem",
                        margin: "0 0 4px",
                        fontWeight: 600,
                        color: "var(--ink)",
                        lineHeight: 1.3,
                      }}
                    >
                      {m.title?.trim() || "Untitled"}
                    </h2>
                    {m.summary?.trim() ? (
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          color: "var(--ink-muted)",
                          lineHeight: 1.4,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {m.summary}
                      </p>
                    ) : null}
                    <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>
                      {formatDate(m.created_at)}
                    </p>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      <p style={{ marginTop: 32 }}>
        <a href="/family/upload">Upload photo</a> · <a href="/">Home</a>
      </p>
    </>
  );
}
