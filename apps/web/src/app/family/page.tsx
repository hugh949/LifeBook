import Link from "next/link";

export default function Page() {
  return (
    <>
      <h1 className="page-title">Family</h1>
      <p className="page-lead">
        Add a photo and an optional note. It becomes part of the family story and can show up in memory trailers — no account needed.
      </p>

      <section style={{ marginBottom: 32 }}>
        <a
          href="/family/upload"
          className="btn btn-primary"
          style={{ marginBottom: 16, display: "inline-block", textDecoration: "none", color: "white", fontSize: "1.1rem", padding: "16px 24px" }}
        >
          Add a memory
        </a>
        <p style={{ margin: 0, fontSize: 14, color: "var(--ink-muted)", maxWidth: 360 }}>
          One photo, an optional note (e.g. &ldquo;Grandpa, tell us about this day!&rdquo;), and you&rsquo;re done.
        </p>
      </section>

      <p style={{ color: "var(--ink-muted)", marginTop: 16 }}>
        <a href="/bank">View Memory Bank</a> · <a href="/">Home</a>
      </p>
    </>
  );
}
