"use client";

import { Suspense } from "react";
import StudioScreen from "@/app/components/StudioScreen";

export default function StoryDetailPage() {
  return (
    <Suspense
      fallback={
        <>
          <h1 className="page-title">Script</h1>
          <p className="text-muted">Loading…</p>
        </>
      }
    >
      <StudioScreen routeKind="story" />
    </Suspense>
  );
}
