# Product Vision & Roadmap — LifeBook Multimodal Family Memory Bank (Short / Medium / Long Term)

> Purpose: Give Cursor (and your team) a clear “why + what + when” across phases,
> rooted in LifeBook-style life review and evidence-informed approaches:
> Reminiscence Therapy, Validation Therapy, and CBT-inspired coping micro-skills.
> This document is a requirements guide, not a clinical protocol.

---

## 1) North Star Outcomes

### Primary (Older Adult)
1) Increase **social engagement frequency** (daily/weekly interactions with family and the app).
2) Reduce **loneliness and social isolation** by making family interaction effortless and emotionally rewarding.
3) Support **mood and wellbeing** through positive reminiscence, validation-style responses, and gentle coping prompts.

### Secondary (Family)
4) Create an enduring **Digital Memory Bank** that future generations can search, replay, and remix.
5) Make contribution **frictionless** across devices and languages so kids/grandkids keep returning.

### Tertiary (Clinical/Research readiness)
6) Build a pathway for **measurable, ethically evaluated impact** on mental health outcomes over time
   (without over-claiming in V1).

---

## 2) Evidence-Informed Foundations (Design Requirements)

### Reminiscence Therapy (RT)
RT uses prompts and sensory cues (photos, music, stories) to stimulate long-term memory and support wellbeing.
Evidence suggests RT can improve quality of life, cognition/communication, and possibly mood in dementia contexts,
though effects can vary and may be small depending on how delivered. (Wikipedia overview)

Product implications:
- Prioritize **sensory triggers** (photos, music, objects) and **structured life review** content.
- Focus on **positive, identity-affirming narrative** (not memory testing).

### Validation Therapy (VT)
VT emphasizes empathic communication that validates feelings rather than correcting facts. (Wikipedia overview)

Product implications:
- Assistant must **never argue** about factual accuracy (“That didn’t happen”).
- Reflect emotion first: “That sounds important to you.”

### CBT — inspiration for micro-skills
CBT is structured psychotherapy focused on identifying/challenging unhelpful thoughts and improving coping strategies. (Wikipedia overview)
CBT has evidence as an effective approach for depression, including for older adults vs treatment as usual (systematic review evidence exists).

Product implications:
- Use **CBT-inspired micro-prompts** (non-clinical):
  - reframe, gratitude, strengths recall, gentle behavioral activation (“small step” plans)
- Never present as a replacement for professional care.

---

## 3) Core Product Principles (Hard Requirements)

1) **Delight-first, not therapy-first**
2) **Recognition > recall**
3) **One question at a time**
4) **Validation before exploration**
5) **Multilingual by default** (English, Cantonese, Mandarin, Spanish, Urdu)
6) **Structured memory bank** (Moments/People/Assets)
7) **Privacy & consent by design**

---

## 4) Short-term Vision (V1: 0–8 weeks) — “Minimum Lovable Prototype”

Goal: Prove the core loop:
Family contributes → Older adult delighted → Older adult responds → Memory saved → Family gets feedback → repeat

Must-haves:
- Voice companion session (OpenAI Realtime) with auto language detect + lock
- Daily “Memory Trailer + One Question”
- Family upload: photo + optional voice note
- Memory bank: timeline + moment detail + people list
- SSR share pages for moments/invites

Metrics (behavioral):
- Weekly older adult sessions
- Family contributions/week
- Trailer replay rate
- 7-day retention per family group

---

## 5) Medium-term Vision (V2: 2–6 months) — “Family Memory Engine”

- Quests & rituals (weekly prompts)
- Auto “mini episodes” (2–4 minutes)
- Better People graph (opt-in face clustering)
- Video ingestion + highlights (consider Gemini backend)
- Multilingual sharing: original + English pivot + chosen family-language captions

Clinical readiness (pre-study):
- Optional check-ins (loneliness/wellbeing)
- Research participation consent (opt-in)
- Audit logs + exports for evaluation partners

---

## 6) Long-term Vision (V3: 6–18+ months) — “Clinically Evaluated Wellbeing Companion”

- Adaptive prompting engine based on engagement
- RT chapter-based life review journeys
- VT response library + safer conversational patterns
- CBT-inspired micro-skills (consumer version) and clinical variants with partners
- Clinical studies with IRB oversight (RCT / quasi-experimental)
- Outcome measurement with validated instruments

Constraints:
- No diagnosis/treatment claims unless regulated pathways are satisfied
- Transparency about AI capabilities and limitations
- Strong privacy, consent, export/delete controls
