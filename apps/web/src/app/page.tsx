import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <h1 className="page-title">Keep family stories alive</h1>
      <p className="page-lead">
        Add photos and voice, and talk with a gentle voice companion. Share with the family when you're ready.
      </p>
      <p style={{ marginTop: 0, marginBottom: 24, fontSize: 14, color: "var(--ink-muted)" }}>
        A place for the whole family to contribute, listen, and support each other.
      </p>

      <div className="home-cards">
        <Link
          href="/talk/session"
          className="card"
          style={{ textDecoration: "none", color: "inherit", display: "block", cursor: "pointer" }}
        >
          <span style={{ fontSize: "2rem", marginBottom: 8, display: "block" }}>➕</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", margin: "0 0 8px" }}>
            Create Memories
          </h2>
          <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: "0.95rem" }}>
            Start a voice session and capture new stories with the gentle voice companion.
          </p>
        </Link>

        <Link
          href="/talk/memories"
          className="card"
          style={{ textDecoration: "none", color: "inherit", display: "block", cursor: "pointer" }}
        >
          <span style={{ fontSize: "2rem", marginBottom: 8, display: "block" }}>📂</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", margin: "0 0 8px" }}>
            My Memories
          </h2>
          <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: "0.95rem" }}>
            Recall past voice conversations and stories you’ve saved.
          </p>
        </Link>

        <Link
          href="/bank"
          className="card"
          style={{ textDecoration: "none", color: "inherit", display: "block", cursor: "pointer" }}
        >
          <span style={{ fontSize: "2rem", marginBottom: 8, display: "block" }}>📚</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", margin: "0 0 8px" }}>
            Shared Memories
          </h2>
          <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: "0.95rem" }}>
            Moments shared with the family. View and add comments.
          </p>
        </Link>
      </div>

      <p style={{ marginTop: 48, fontSize: 14, color: "var(--ink-faint)" }}>
        We're in discovery — core features will change based on what you find useful.
      </p>
    </>
  );
}
