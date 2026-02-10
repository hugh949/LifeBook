# Voice ID alternatives (post–Microsoft Speaker Recognition)

Microsoft Speaker Recognition is **Limited Access** (gated); without approval, our Voice ID flow returns 401. This doc explores alternatives to build reliable Voice ID for participants (identify who is speaking at session start, enroll from conversation audio).

## Current flow (Azure)

1. **Identify** – At session start, client records ~6s WAV, `POST /voice/identify`. Server matches against enrolled Azure profiles; returns `participant_id` + `label` if matched so the agent can greet by name.
2. **Enroll** – When the agent calls `create_participant` (user said their name), client sends WAV from rolling buffer to `POST /voice/participants/{id}/enroll`. Optional 30s follow-up enrollments. Azure returns `enrollmentStatus` (Enrolling → Enrolled).
3. **Storage** – `voice_participants.azure_speaker_profile_id` (Azure profile UUID) and `enrollment_status` ("Enrolled" | "Enrolling"). Identify only uses profiles with status Enrolled.

We need a replacement that provides: **create profile** (or equivalent), **enroll** (add voice samples), **identify** (match short clip to one of N enrolled speakers), with WAV 16 kHz mono (or we keep conversion).

---

## Option 1: Picovoice Eagle (recommended first try)

**What it is:** On-device speaker recognition (identification + verification). Language-agnostic, text-independent. Runs in process (Python SDK on server or in browser).

**API shape:**

- **Enrollment:** Create a *profiler*, feed it audio chunks, export an **EagleProfile** (serializable blob). Store one profile per participant (e.g. in DB or blob).
- **Identify:** Create a *recognizer* with a list of EagleProfiles, feed the 6s clip, get similarity scores per profile; pick best above threshold.

**Pros:**

- No gated approval; free tier (e.g. 100 min/month non-commercial) or paid.
- Same “enroll then identify” mental model as Azure; can mirror our REST API.
- Python SDK (`pveagle`) runs on Linux/macOS/Windows; we can run it inside the FastAPI service (or a worker).
- Privacy: processing can stay on our server (or client with Eagle Web).

**Cons:**

- **Server-side:** We must run the Python SDK on our API server (or a separate service). Not a REST API in the cloud; we host the logic.
- **Profile storage:** Store serialized EagleProfile per participant (e.g. new column or separate table). No “profile ID” from a third party; we own the blob.
- **Free tier:** 100 min/month; above that, paid plans (see [Picovoice pricing](https://picovoice.ai/pricing)).
- **Audio format:** Eagle expects specific sample rate (e.g. 16 kHz); our WAV is already 16 kHz mono, so minimal change.

**Implementation outline:**

- Add `pveagle` to API dependencies.
- New module `app/services/speaker_recognition_eagle.py`: enroll (create profiler → add chunks → export profile), identify (load profiles → create recognizer → score). Store profile bytes in DB (e.g. `voice_participants.voice_profile_data` BLOB) or in blob storage keyed by participant id.
- Keep `voice_participants.azure_speaker_profile_id` nullable; add `voice_profile_data` (or similar) for Eagle. `enrollment_status` can stay: “Enrolled” when we have a valid Eagle profile.
- Feature flag or config: `VOICE_ID_BACKEND=azure | eagle`. If `eagle`, use Eagle module for identify/enroll; if `azure`, keep current Azure path (for when/if approval is granted).
- Identify endpoint: load all enrolled participants’ Eagle profiles, run recognizer, return best match above threshold (same response shape as today).

**References:** [Eagle docs](https://picovoice.ai/docs/eagle/), [Eagle Python quick start](https://picovoice.ai/docs/quick-start/eagle-python/), [pveagle on PyPI](https://pypi.org/project/pveagle/).

---

## Option 2: Speaker embeddings (SpeechBrain / Resemblyzer) – self‑hosted, no vendor

**What it is:** Extract a fixed-size **speaker embedding** from audio; compare new audio to stored embeddings (e.g. cosine similarity). No per-participant “profile” from a vendor; we store vectors.

**Flow:**

- **Enroll:** For each participant, run embedding model on enrollment WAV(s), average or concatenate embeddings, store in DB (e.g. `voice_participants.embedding` or a small table `voice_embeddings(participant_id, embedding)`).
- **Identify:** Extract embedding from the 6s clip, compare to all enrolled embeddings, return participant with highest similarity above a threshold.

**Libraries:**

- **SpeechBrain** – e.g. `spkrec-resnet-voxceleb` or `spkrec-xvect-voxceleb` on Hugging Face. Strong accuracy; requires PyTorch and optionally GPU.
- **Resemblyzer** – 256‑dim embeddings; simpler, older. [Resemblyzer on PyPI](https://pypi.org/project/Resemblyzer/).

**Pros:**

- No third-party speaker API; no gating. Runs entirely in our stack.
- Open source; we control data and pipeline.
- Same REST contract: enroll by participant, identify returns participant_id.

**Cons:**

- We own tuning: threshold, enrollment quality (single vs multiple clips), sample rate/resampling. More engineering than Eagle.
- Model size and runtime: SpeechBrain/Resemblyzer add weight to the API container; may need GPU for low latency at scale.
- Resemblyzer is not as state-of-the-art as SpeechBrain or Eagle.

**Implementation outline:**

- Add `speechbrain` (or `Resemblyzer`) to API. New module `app/services/speaker_embedding.py`: load model once, function to get embedding from WAV, function to compare embedding to list of (participant_id, embedding).
- DB: add `voice_embedding` (e.g. JSON array or binary) to `voice_participants`, or a small table. Enrollment = append/update embedding; identify = score against all.
- Same identify/enroll endpoints; backend swaps to embedding logic when `VOICE_ID_BACKEND=embedding` (or similar).

---

## Option 3: AWS / Google – cloud speaker APIs

**AWS:** Transcribe has **speaker diarization** (who spoke when), not “this is participant Sarah.” To get Voice ID we’d need a different product (e.g. Amazon Connect Voice ID) or build a mapping layer (e.g. diarization + our own labels). More complex and not a direct drop-in.

**Google:** Cloud Speech-to-Text has diarization; no first-party “speaker identification against enrolled profiles” in the same way as Azure Speaker Recognition. Would require custom mapping or a different Google API if one exists.

**Verdict:** Not a clean replacement without more research; lower priority than Eagle or embeddings.

---

## Option 4: No Voice ID (manual selection only)

Keep “Who is speaking?” as a **manual dropdown** only. No identify call at session start; no enrollment. Participants still have labels and history; we just don’t recognize voice.

**Pros:** No dependency, no new code.  
**Cons:** Loses “greet by name” and automatic recognition; weaker UX for the stated product goal.

---

## Recommendation

1. **Short term:** Implement **Picovoice Eagle** behind a feature flag or config (`VOICE_ID_BACKEND=eagle`). Reuse current identify/enroll API shape and WAV pipeline; store Eagle profiles (or blob refs) per participant. Keeps Voice ID working without Microsoft approval.
2. **Optional later:** Add **SpeechBrain (or Resemblyzer) embedding** path as an alternative backend for fully self-hosted, no-vendor option; same REST API, different backend module.
3. **Fallback:** If Eagle’s free tier is too limited and paid is not an option, prioritize the **embedding** path (Option 2) as the main non-Azure solution.

Next concrete step: implement Eagle in a new `speaker_recognition_eagle` module and wire it to the existing `/voice/identify` and `/voice/participants/{id}/enroll` routes with a config-driven backend switch.
