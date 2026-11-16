"use client";

export type StudioStage = "conversation" | "script" | "curate" | "share";

export type StageMark = "now" | "next" | "done" | "later";

export type StageStep = {
  id: StudioStage;
  label: string;
  mark: StageMark;
  reachable: boolean;
};

type Props = {
  steps: StageStep[];
  onSelect: (id: StudioStage) => void;
  title: string;
  coach: string;
  actions: React.ReactNode;
  children: React.ReactNode;
  dock?: React.ReactNode;
};

const MARK_LABEL: Record<StageMark, string> = {
  now: "Now",
  next: "Next",
  done: "Done",
  later: "Later",
};

export default function StageShell({ steps, onSelect, title, coach, actions, children, dock }: Props) {
  return (
    <div className="stage-shell">
      {dock ? <div className="talk-bar-slot">{dock}</div> : null}

      <nav className="stage-rail" aria-label="Story stages">
        {steps.map((step, i) => {
          const className = [
            "stage-rail-item",
            step.mark === "now" ? "is-active" : "",
            step.mark === "done" ? "is-past" : "",
            step.mark === "next" ? "is-next" : "",
            step.mark === "later" ? "is-later" : "",
            !step.reachable && step.mark !== "now" ? "is-locked" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={step.id}
              type="button"
              className={className}
              aria-current={step.mark === "now" ? "step" : undefined}
              onClick={() => onSelect(step.id)}
            >
              <span className="stage-rail-num">{i + 1}</span>
              <span className="stage-rail-label">{step.label}</span>
              <span className="stage-rail-mark">{MARK_LABEL[step.mark]}</span>
            </button>
          );
        })}
      </nav>

      <header className="stage-header">
        <h1 className="page-title" style={{ marginBottom: 6 }}>
          {title}
        </h1>
        <p className="stage-guide" role="status">
          {coach}
        </p>
      </header>

      {actions ? <div className="stage-next">{actions}</div> : null}

      <div className="stage-main">{children}</div>
    </div>
  );
}
