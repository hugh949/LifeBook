import { apiPost } from "./api";

export type RealtimeTokenResponse = {
  value?: string;
  client_secret?: string;
  model?: string;
  expires_at?: number;
  stubbed?: boolean;
};

export async function getRealtimeToken(): Promise<RealtimeTokenResponse> {
  return apiPost<RealtimeTokenResponse>("/realtime/token", {});
}

/**
 * Connect to OpenAI Realtime API over WebRTC using an ephemeral client secret.
 * SDP handshake is done via our backend proxy to avoid CORS.
 * - Gets mic stream, creates peer connection, creates data channel "oai-events".
 * - POSTs SDP offer to /realtime/calls, sets answer, wires remote audio to the given audio element.
 */
export async function connectRealtimeWebRTC(
  ephemeralKey: string,
  audioElement: HTMLAudioElement
): Promise<{ pc: RTCPeerConnection; dc: RTCDataChannel }> {
  const pc = new RTCPeerConnection();
  const dc = pc.createDataChannel("oai-events");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
