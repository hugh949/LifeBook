import Link from "next/link";

export default function TalkPage() {
  return (
    <>
      <h1 className="page-title">Talk</h1>
      <p className="page-lead">
        Have a gentle voice conversation. Your stories can be saved and shared with the family when you’re ready.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 400 }}>
        <Link
          href="/talk/session"
          className="btn btn-primary"
          style={{ fontSize: "1.1rem", padding: "16px 28px" }}
        >
          Start voice session
        </Link>
        <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: 14 }}>
          One question at a time, in your language. Your stories matter — we&rsquo;re here to listen.
        </p>

        <button
          type="button"
          className="btn btn-ghost"
          disabled
          style={{ justifyContent: "center" }}
        >
          Play Memory Trailer
        </button>
        <p style={{ margin: 0, color: "var(--ink-faint)", fontSize: 14 }}>
          Coming next: short photo montage with music and a prompt.
        </p>
      </div>

      <p style={{ marginTop: 32 }}>
        <Link href="/bank">Shared</Link> · <Link href="/">Home</Link>
      </p>
    </>
  );
}
