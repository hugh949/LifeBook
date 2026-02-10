import Link from "next/link";

export default function CreatePage() {
  return (
    <>
      <h1 className="page-title">Create</h1>
      <p className="page-lead">
        Talk with the voice companion or add a photo or voice note. It stays in My memories until you share with the family.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 20,
          marginTop: 24,
        }}
      >
        <Link
          href="/talk"
          className="card"
          style={{ textDecoration: "none", color: "inherit", display: "block", cursor: "pointer" }}
        >
          <span style={{ fontSize: "2rem", marginBottom: 8, display: "block" }}>🎧</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", margin: "0 0 8px" }}>
            Talk
          </h2>
          <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: "0.95rem" }}>
            Have a voice conversation. Your stories can be saved and shared with the family.
          </p>
        </Link>
        <Link
          href="/create/upload"
          className="card"
          style={{ textDecoration: "none", color: "inherit", display: "block", cursor: "pointer" }}
        >
          <span style={{ fontSize: "2rem", marginBottom: 8, display: "block" }}>📸</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", margin: "0 0 8px" }}>
            Add photo or voice note
          </h2>
          <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: "0.95rem" }}>
            Upload a photo or record a voice note. It goes to My memories until you share with the family.
          </p>
        </Link>
      </div>
      <p style={{ marginTop: 32 }}>
        <Link href="/bank">Shared</Link> · <Link href="/">Home</Link>
      </p>
    </>
  );
}
