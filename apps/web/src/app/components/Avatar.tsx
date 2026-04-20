"use client";

import { useEffect, useRef, useState } from "react";
import {
  createClientAvatarProvider,
  type ClientAvatarProvider,
  type MouthShape,
} from "@/lib/avatarProvider";

type Props = {
  /** URL of the pencil-sketch portrait (square, face-centered). */
  imageUrl: string | null;
  /** The <audio> element whose playback drives the mouth animation. */
  audio: HTMLAudioElement | null;
  /** Whether audio is currently playing. Controls the animation loop. */
  playing: boolean;
  /** CSS size for the square avatar (px). */
  size?: number;
  /** Optional alt text. */
  alt?: string;
};

/**
 * Animated pencil-sketch avatar.
 *
 * Renders the user's pencil-sketch portrait and overlays a simple mouth
 * animation driven by the amplitude of the current narration. Two mouth
 * shapes (closed / open) cross-fade with a short hold to avoid flicker.
 *
 * If no imageUrl is provided we fall back to a neutral placeholder so the
 * share page never crashes when a user hasn't set up their avatar yet.
 */
export default function Avatar({ imageUrl, audio, playing, size = 220, alt }: Props) {
  const [shape, setShape] = useState<MouthShape>("closed");
  const providerRef = useRef<ClientAvatarProvider | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!audio) return;
    const provider = createClientAvatarProvider();
    providerRef.current = provider;
    try {
      provider.attach(audio);
    } catch {
      // Safari may throw if we already attached a node to this element.
      providerRef.current = null;
    }
    return () => {
      provider.detach();
      providerRef.current = null;
    };
  }, [audio]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setShape("closed");
      return;
    }
    const loop = () => {
      const p = providerRef.current;
      if (p) {
        const { shape: next } = p.sample();
        setShape((prev) => (prev === next ? prev : next));
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing]);

  return (
    <div
      className="share-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        position: "relative",
        border: "1px solid var(--border)",
        background: "var(--accent-soft)",
        margin: "0 auto",
      }}
      aria-hidden={alt ? undefined : true}
      aria-label={alt}
    >
      {imageUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={imageUrl}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink-muted)",
            fontFamily: "var(--font-display)",
            fontSize: size * 0.32,
          }}
        >
          ✎
        </div>
      )}
      {/*
        Mouth overlay: positioned in the lower third of the face. We draw a
        small SVG so we can cleanly animate between closed and open shapes.
        The absolute pixel numbers scale with `size` so the overlay looks
        right at any display size.
      */}
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          // Slight upward offset so the mouth sits a little above center.
          transform: "translateY(2%)",
          opacity: imageUrl ? 0.85 : 0.4,
        }}
      >
        {shape === "open" ? (
          <ellipse
            cx={50}
            cy={72}
            rx={8}
            ry={4.5}
            fill="#3a2f2a"
            style={{ transition: "rx 120ms ease, ry 120ms ease" }}
          />
        ) : (
          <path
            d="M 42 73 Q 50 76 58 73"
            fill="none"
            stroke="#3a2f2a"
            strokeWidth={1.8}
            strokeLinecap="round"
            style={{ transition: "d 120ms ease" }}
          />
        )}
      </svg>
      {/* Subtle pulsing halo while playing, so users see that the avatar is "speaking". */}
      {playing ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -6,
            borderRadius: "50%",
            border: "2px solid var(--primary)",
            opacity: 0.35,
            animation: "avatarPulse 1.6s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
      ) : null}
      <style jsx>{`
        @keyframes avatarPulse {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.04); opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
