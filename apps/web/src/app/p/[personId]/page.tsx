import Link from "next/link";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  return (
    <>
      <h1 className="page-title">Person</h1>
      <p className="page-lead">Profile and moments for this person. (Coming soon.)</p>
      <p style={{ color: "var(--ink-faint)" }}>ID: {personId}</p>
      <p style={{ marginTop: 24 }}>
        <Link href="/bank">Memory Bank</Link> · <Link href="/">Home</Link>
      </p>
    </>
  );
}
