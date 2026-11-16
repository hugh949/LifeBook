"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/app/components/AuthContext";
import JourneySteps from "@/app/components/JourneySteps";
import AgentTeam from "@/app/components/AgentTeam";
import VoiceDock from "@/app/components/VoiceDock";
import { useRealtimeSession } from "@/lib/useRealtimeSession";

type LibraryItem = {
  id: string;
  kind: "conversation" | "story";
  title: string | null;
  script_id?: string | null;
  created_at: string;
};

function CreateInner() {
  const { me } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeId = searchParams.get("conversation_id");
  const autostart = searchParams.get("autostart") === "1";
  const [lastOpen, setLastOpen] = useState<LibraryItem | null>(null);
  const [startedNew, setStartedNew] = useState(Boolean(resumeId));

  useEffect(() => {
    apiGet<LibraryItem[]>("/library")
      .then((items) => {
        const open = items
          .filter((it) => it.kind === "conversation" && !it.script_id)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        setLastOpen(open[0] ?? null);
      })
      .catch(() => setLastOpen(null));
  }, []);

  const session = useRealtimeSession({
    conversationId: resumeId,
    mode: "conversing",
    persistConversation: true,
    allowHandoff: false,
    onConversationSaved: (conversationId) => {
      router.replace(`/library/conversations/${encodeURIComponent(conversationId)}?advance=script`);
    },
    onReadyForScript: () => {
      // After first save redirects; derive happens in Conversation Studio
    },
  });

  useEffect(() => {
    if (autostart && resumeId && session.status === "idle") {
      void session.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot autostart
  }, [autostart, resumeId]);

  const showDock = startedNew || Boolean(resumeId) || session.isListening || session.status === "saving" || session.status === "saved" || session.status === "connecting" || session.status === "error";

  return (
    <>
      {showDock ? (
        <VoiceDock
          agentLabel="Talk"
          coachHint="Tap to talk, then speak. Tap to finish and the script starts."
          status={session.status}
          message={session.message}
          mmss={session.mmss}
          isBusy={session.isBusy}
          isListening={session.isListening}
          onStart={() => void session.start()}
          onEnd={() => void session.endSession()}
        />
      ) : null}
      <h1 className="page-title">Create</h1>
      <p className="page-lead">
        {me?.display_name ? `Hi ${me.display_name}. ` : ""}
        Start a new memory. Talk, then the script, then a few finishing touches — until it’s ready to share.
      </p>

      {!showDock ? (
        <div className="stack-12" style={{ marginBottom: 20 }}>
          <div className="ceremony-next detail-next" style={{ marginBottom: 0 }}>
            <p className="detail-next-label">New memory</p>
            <p className="detail-next-title">Start a Conversation</p>
            <p className="detail-next-text">
              Tap Talk, then speak. The microphone stays off until you do. When you finish, the script
              is written on the same screen, and finishing touches come after that.
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setStartedNew(true);
                  void session.start();
                }}
              >
                Start a new memory
              </button>
              {lastOpen ? (
                <Link
                  className="btn btn-ghost"
                  href={`/library/conversations/${encodeURIComponent(lastOpen.id)}`}
                >
                  Continue unfinished
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="stack-12" style={{ marginBottom: 16 }}>
          {session.status === "saved" ? (
            <p className="text-muted" style={{ fontSize: 14 }}>
              Opening your story screen…
            </p>
          ) : null}
          {!session.isListening && session.status !== "connecting" && session.status !== "saving" ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setStartedNew(false);
                session.setMessage("");
              }}
            >
              Back
            </button>
          ) : null}
        </div>
      )}

      <h2 className="section-title" style={{ marginTop: 8 }}>
        How it works
      </h2>
      <p className="text-muted" style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.45 }}>
        Talk, Script, then Finish. Share is part of the last step, on the same screen.
      </p>
      <JourneySteps active={1} compact={!showDock} />

      {!showDock ? (
        <div className="card create-about" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            About LifeBook
          </div>
          <p className="text-muted" style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.45 }}>
            LifeBook is private and personal — a quiet place to talk through memories and shape them
            into stories worth keeping. Nothing leaves your vault unless you create a share link.
          </p>
          <div className="me-team-heading">Your team</div>
          <AgentTeam />
        </div>
      ) : null}
    </>
  );
}

export default function TalkPage() {
  return (
    <Suspense
      fallback={
        <div className="talk-shell">
          <p className="text-muted">Loading…</p>
        </div>
      }
    >
      <CreateInner />
    </Suspense>
  );
}
