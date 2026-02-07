import Link from "next/link";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <>
      <h1 className="page-title">Join the family</h1>
      <p className="page-lead">You’ve been invited to join a LifeBook family. (Join flow coming soon.)</p>
      <p style={{ color: "var(--ink-faint)", fontSize: 14 }}>Invite: {token}</p>
      <p style={{ marginTop: 24 }}>
        <Link href="/">Home</Link>
      </p>
    </>
  );
}
