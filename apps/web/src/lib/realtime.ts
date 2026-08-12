import { apiPost, apiGet } from "./api";

export type RealtimeTokenResponse = {
  value?: string;
  client_secret?: string;
  model?: string;
  expires_at?: number;
  stubbed?: boolean;
  mode?: "conversing" | "storytelling" | "curating";
};

export type RealtimeTokenRequest = {
  conversation_id?: string;
  story_id?: string;
  mode?: "conversing" | "storytelling" | "curating";
};

export async function getRealtimeToken(
  options: RealtimeTokenRequest = {}
): Promise<RealtimeTokenResponse> {
  return apiPost<RealtimeTokenResponse>("/realtime/token", {
    conversation_id: options.conversation_id ?? undefined,
    story_id: options.story_id ?? undefined,
    mode: options.mode ?? undefined,
  });
}

export type AgentPack = {
  mode: "conversing" | "storytelling" | "curating";
  instructions: string;
  tools: unknown[];
};

export async function getAgentPack(
  mode: "conversing" | "storytelling" | "curating",
  options: { conversation_id?: string; story_id?: string } = {}
): Promise<AgentPack> {
  const qs = new URLSearchParams({ mode });
  if (options.conversation_id) qs.set("conversation_id", options.conversation_id);
  if (options.story_id) qs.set("story_id", options.story_id);
  return apiGet<AgentPack>(`/realtime/agent-pack?${qs.toString()}`);
}

/**
 * Connect to OpenAI Realtime API over WebRTC using an ephemeral client secret.
 * SDP handshake is done via our backend proxy to avoid CORS.
 * - Uses the provided stream or gets mic, creates peer connection, creates data channel "oai-events".
 * - POSTs SDP offer to /realtime/calls, sets answer, wires remote audio to the given audio element.
 */
export async function connectRealtimeWebRTC(
  ephemeralKey: string,
  audioElement: HTMLAudioElement,
  existingStream?: MediaStream
): Promise<{ pc: RTCPeerConnection; dc: RTCDataChannel }> {
  const pc = new RTCPeerConnection();
  const dc = pc.createDataChannel("oai-events");

  try {
    const stream = existingStream ?? (await navigator.mediaDevices.getUserMedia({ audio: true }));
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    audioElement.autoplay = true;
    pc.ontrack = (e) => {
      if (e.streams?.[0]) audioElement.srcObject = e.streams[0];
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const res = await apiPost<{ sdp: string }>(`/realtime/calls`, {
      client_secret: ephemeralKey,
      sdp: offer.sdp ?? "",
    });

    const answerSdp = res.sdp;
    if (!answerSdp) throw new Error("No SDP answer from server");

    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: "answer", sdp: answerSdp })
    );

    return { pc, dc };
  } catch (err) {
    pc.close();
    throw err;
  }
}
