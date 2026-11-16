"use client";

import { Suspense } from "react";
import StudioScreen from "@/app/components/StudioScreen";

export default function ConversationStudioPage() {
  return (
    <Suspense
      fallback={
        <>
          <h1 className="page-title">Conversation</h1>
          <p className="text-muted">Loading…</p>
        </>
      }
    >
      <StudioScreen routeKind="conversation" />
    </Suspense>
  );
}
