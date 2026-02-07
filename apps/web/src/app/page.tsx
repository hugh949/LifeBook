import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <h1 className="page-title">Keep family stories alive</h1>
      <p className="page-lead">
        Add photos and voice, watch short memory trailers, and talk with a gentle voice companion.
      </p>

      <a
        href="/family/upload"
        className="btn btn-primary"
        style={{
          display: "inline-block",
          marginBottom: 32,
          textDecoration: "none",
          color: "white",
          fontSize: "1.1rem",
          padding: "16px 28px",
        }}
      >
        Add a memory — one photo, optional note
      </a>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 20,
          marginTop: 32,
        }}
      >
        <a
          href="/older"
          className="card"
          style={{
            textDecoration: "none",
            color: "inherit",
            display: "block",
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: "2rem", marginBottom: 8, display: "block" }}>🎧</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", margin: "0 0 8px" }}>
            Older Mode
          </h2>
          <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: "0.95rem" }}>
            Lean back: play a memory trailer, then talk with a voice companion.
          </p>
        </a>

        <a
          href="/family/upload"
          className="card"
          style={{
            textDecoration: "none",
            color: "inherit",
            display: "block",
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: "2rem", marginBottom: 8, display: "block" }}>📸</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", margin: "0 0 8px" }}>
            Family
          </h2>
          <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: "0.95rem" }}>
            Upload a photo or voice note to add to the family memory bank.
          </p>
        </a>

        <a
          href="/bank"
          className="card"
          style={{
            textDecoration: "none",
            color: "inherit",
            display: "block",
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: "2rem", marginBottom: 8, display: "block" }}>📚</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", margin: "0 0 8px" }}>
            Memory Bank
          </h2>
          <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: "0.95rem" }}>
            Browse and share saved moments — photos, stories, and voice.
          </p>
        </a>
      </div>

      <p style={{ marginTop: 48, fontSize: 14, color: "var(--ink-faint)" }}>
        We’re in discovery — core features will change based on what you find useful.
      </p>
    </>
  );
}
