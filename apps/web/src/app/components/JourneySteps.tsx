"use client";

export type JourneyStepId = 1 | 2 | 3 | 4;

export const JOURNEY_STEPS: {
  id: JourneyStepId;
  title: string;
  agent: string;
  body: string;
}[] = [
  {
    id: 1,
    title: "Conversation",
    agent: "Conversation companion",
    body: "Talk freely and continue anytime. We keep an exact transcript — private.",
  },
  {
    id: 2,
    title: "Script",
    agent: "Storyteller",
    body: "One professional script from that talk. See it, hear it, edit until the wording feels right.",
  },
  {
    id: 3,
    title: "Curate",
    agent: "Curator",
    body: "Music, speaking tone, your voice, and one optional photo — the memorable finish.",
  },
  {
    id: 4,
    title: "Share later",
    agent: "Content manager",
    body: "Optional access control. Password link; recipients hear (and see the photo) — not the app.",
  },
];

type Props = {
  active?: JourneyStepId | null;
  compact?: boolean;
  className?: string;
};

export default function JourneySteps({ active = null, compact = false, className }: Props) {
  return (
    <ol
      className={`journey-steps${compact ? " journey-steps-compact" : ""}${className ? ` ${className}` : ""}`}
      aria-label="How LifeBook works"
    >
      {JOURNEY_STEPS.map((step, index) => {
        const isActive = active === step.id;
        const isPast = active != null && step.id < active;
        const isLast = index === JOURNEY_STEPS.length - 1;
        return (
          <li
            key={step.id}
            className={`journey-step${isActive ? " is-active" : ""}${isPast ? " is-past" : ""}${isLast ? " is-last" : ""}`}
            aria-current={isActive ? "step" : undefined}
          >
            <div className="journey-step-rail" aria-hidden="true">
              <div className="journey-step-num">{step.id}</div>
              {!isLast ? <div className="journey-step-connector" /> : null}
            </div>
            <div className="journey-step-body">
              <div className="journey-step-title">{step.title}</div>
              {!compact ? (
                <>
                  <div className="journey-step-agent">{step.agent}</div>
                  <p className="journey-step-text">{step.body}</p>
                </>
              ) : (
                <p className="journey-step-text">{step.body}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
