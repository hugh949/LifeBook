import Link from "next/link";

export default function Page() {
  return (
    <>
      <h1 className="page-title">Older Mode</h1>
      <p className="page-lead">
        A calm, lean-back experience. Play a short memory trailer, then have a gentle voice
        conversation.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 400 }}>
        <Link
          href="/older/session"
          className="btn btn-primary"
          style={{ fontSize: "1.1rem", padding: "16px 28px" }}
        >
          Talk
        </Link>
        <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: 14 }}>
          Start a voice session. One question at a time, in your language.
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
        <Link href="/">Home</Link>
      </p>
    </>
  );
}
