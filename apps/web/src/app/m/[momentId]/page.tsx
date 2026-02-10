// Server component: fetch needs absolute URL (API_UPSTREAM in Docker, localhost when dev)
import { AddComment } from "./AddComment";

const API_BASE = process.env.API_UPSTREAM || "http://localhost:8000";

type MomentAsset = {
  id: string;
  type: string;
  role: string;
  playback_url?: string | null;
  duration_sec?: number | null;
};

type Moment = {
  id: string;
  title: string | null;
  summary: string | null;
  language: string | null;
  source: string;
  created_at: string;
  thumbnail_url?: string | null;
  image_url?: string | null;
  assets?: MomentAsset[] | null;
};

function isStubMediaUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  return url.startsWith("https://local-mvp/") || url.startsWith("http://local-mvp/");
}

export default async function MomentPage({ params }: { params: Promise<{ momentId: string }> }) {
  const { momentId } = await params;
  let moment: Moment | null = null;
  let error = false;
  try {
    const url = `${API_BASE}/moments/${momentId}`;
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) moment = await res.json();
    else error = true;
  } catch {
    error = true;
  }

  if (error || !moment) {
    return (
      <>
        <h1 className="page-title">Moment not found</h1>
        <p className="page-lead">This link may be old or the moment was removed.</p>
        <a href="/bank" className="btn btn-primary" style={{ textDecoration: "none", color: "white" }}>
          Back to Memory Bank
        </a>
      </>
    );
  }

  const imageUrl = moment.image_url || moment.thumbnail_url;
  const showImage = imageUrl && !isStubMediaUrl(imageUrl);

  return (
    <>
      <article className="card" style={{ maxWidth: 640, padding: 0, overflow: "hidden" }}>
        <div
          style={{
            width: "100%",
            aspectRatio: "4/3",
            backgroundColor: "var(--border)",
            position: "relative",
          }}
        >
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ink-faint)",
                fontSize: 64,
              }}
              aria-hidden
            >
              📷
            </div>
          )}
        </div>
        <div style={{ padding: "1rem 1.25rem" }}>
          <h1 className="page-title" style={{ marginBottom: 8 }}>
            {moment.title || "Untitled"}
          </h1>
          {(moment.created_at || moment.source) && (
            <p style={{ fontSize: 14, color: "var(--ink-faint)", margin: "0 0 1rem" }}>
              {moment.created_at && !Number.isNaN(new Date(moment.created_at).getTime()) &&
                new Date(moment.created_at).toLocaleDateString(undefined, { dateStyle: "long" })}
              {moment.source && ` · ${moment.source.replace(/_/g, " ")}`}
            </p>
          )}
          {moment.summary && (
            <p style={{ margin: 0, color: "var(--ink-muted)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {moment.summary}
            </p>
          )}
          {moment.assets && moment.assets.some((a) => a.playback_url && (a.type === "audio" || a.role === "session_audio")) && (
            <div style={{ marginTop: "1rem" }}>
              {moment.assets
                .filter((a) => a.playback_url && (a.type === "audio" || a.role === "session_audio"))
                .map((a) => (
                  <div key={a.id} style={{ marginBottom: 12 }}>
                    <audio
                      controls
                      src={a.playback_url!}
                      style={{ width: "100%", maxWidth: 400 }}
                      preload="metadata"
                    >
                      Your browser does not support audio playback.
                    </audio>
                    {a.duration_sec != null && a.duration_sec > 0 && (
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-faint)" }}>
                        {Math.round(a.duration_sec)}s
                      </p>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      </article>

      <AddComment momentId={momentId} />

      <p style={{ marginTop: 24 }}>
        <a href="/bank">Memory Bank</a> · <a href="/">Home</a>
      </p>
    </>
  );
}
