import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <nav className="app-nav">
            <a href="/" className="brand">
              LifeBook
            </a>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <a href="/older">Older</a>
              <a href="/family">Family</a>
              <a href="/bank">Memory Bank</a>
            </div>
          </nav>
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
