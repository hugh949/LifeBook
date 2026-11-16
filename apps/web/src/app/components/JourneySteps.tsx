"use client";

export type JourneyStepId = 1 | 2 | 3;

export const JOURNEY_STEPS: {
  id: JourneyStepId;
  title: string;
  agent: string;
  body: string;
}[] = [
  {
    id: 1,
    title: "Talk",
    agent: "Conversation companion",
    body: "Tap Talk first, then speak. The microphone is off until you do. When you finish, the script starts on its own.",
  },
  {
    id: 2,
    title: "Script",
    agent: "Storyteller",
    body: "Your words, shaped into a story. Change anything that doesn’t sound like you.",
  },
  {
    id: 3,
    title: "Finish",
    agent: "Curator",
    body: "Music, tone, your voice, and an optional photo — then the story is ready to share.",
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
