"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/app/components/AuthContext";
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
        <>
          <VoiceDock
            agentLabel="Talk"
            coachHint="Tap the button, then speak. Tap it again when you are finished."
            status={session.status}
            message={session.message}
            mmss={session.mmss}
            isBusy={session.isBusy}
            isListening={session.isListening}
            onStart={() => void session.start()}
            onEnd={() => void session.endSession()}
          />
          {session.status === "saved" ? <p className="text-muted">Opening your story…</p> : null}
        </>
      ) : (
        <>
          <h1 className="page-title">Record a memory</h1>
          <p className="page-lead">
            {me?.display_name ? `Hi ${me.display_name}. ` : ""}
            Tap the button, then speak. Tap it again when you are done. Your family can hear the
            story when you choose to share it.
          </p>
          <div className="stack-12" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => {
                setStartedNew(true);
                void session.start();
              }}
            >
              Start talking
            </button>
            {lastOpen ? (
              <Link
                className="stage-quiet-delete"
                href={`/library/conversations/${encodeURIComponent(lastOpen.id)}`}
              >
                Continue your last talk
              </Link>
            ) : null}
          </div>
        </>
      )}
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
