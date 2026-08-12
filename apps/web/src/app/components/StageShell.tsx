"use client";

import Link from "next/link";

export type StudioStage = "conversation" | "script" | "curate";

type Props = {
  stage: StudioStage;
  conversationId?: string | null;
  scriptId?: string | null;
  title: string;
  coach: string;
  children: React.ReactNode;
  dock?: React.ReactNode;
  /** Sticky bottom advance — after the agent dock, where “next stage” belongs. */
  advance?: React.ReactNode;
  /** Quiet end-of-page row (optional actions) instead of sticky primary advance. */
  advanceQuiet?: boolean;
};

const STEPS: {
  id: StudioStage;
  label: string;
  agent: string;
}[] = [
  { id: "conversation", label: "Conversation", agent: "Conversation" },
  { id: "script", label: "Script", agent: "Storyteller" },
  { id: "curate", label: "Curate", agent: "Curator" },
];

function hrefFor(
  id: StudioStage,
  conversationId?: string | null,
  scriptId?: string | null
): string | null {
  if (id === "conversation") {
    if (!conversationId) return null;
    return `/library/conversations/${encodeURIComponent(conversationId)}`;
  }
  if (!scriptId) return null;
  if (id === "script") return `/library/stories/${encodeURIComponent(scriptId)}?stage=script`;
  return `/library/stories/${encodeURIComponent(scriptId)}?stage=curate`;
}

export default function StageShell({
  stage,
  conversationId,
  scriptId,
  title,
  coach,
  children,
  dock,
  advance,
  advanceQuiet,
}: Props) {
  const order: StudioStage[] = ["conversation", "script", "curate"];
  const activeIdx = order.indexOf(stage);

  return (
    <div className={`stage-shell${advance ? " has-advance" : ""}`}>
      <nav className="stage-rail" aria-label="Studio stages">
        {STEPS.map((step, i) => {
          const href = hrefFor(step.id, conversationId, scriptId);
          const isActive = step.id === stage;
          const isPast = i < activeIdx;
          const reachable = Boolean(href);
          const className = `stage-rail-item${isActive ? " is-active" : ""}${isPast ? " is-past" : ""}${
            !reachable ? " is-locked" : ""
          }`;
          if (reachable && !isActive) {
            return (
              <Link key={step.id} href={href!} className={className}>
                <span className="stage-rail-num">{i + 1}</span>
                <span className="stage-rail-label">{step.label}</span>
              </Link>
            );
          }
          return (
            <span
              key={step.id}
              className={className}
              aria-current={isActive ? "step" : undefined}
            >
              <span className="stage-rail-num">{i + 1}</span>
              <span className="stage-rail-label">{step.label}</span>
            </span>
          );
        })}
      </nav>

      <header className="stage-header">
        <h1 className="page-title" style={{ marginBottom: 6 }}>
          {title}
        </h1>
        <p className="stage-coach" role="note">
          {coach}
        </p>
      </header>

      <div className="stage-main">{children}</div>

      {dock ? <aside className="stage-dock">{dock}</aside> : null}

      {advance ? (
        <div className={`studio-advance${advanceQuiet ? " is-quiet" : ""}`}>{advance}</div>
      ) : null}
    </div>
  );
}
