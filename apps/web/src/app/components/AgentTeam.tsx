/** Shared specialist-agent copy for Create (full) and Me (same list, shorter intro). */

export const AGENT_TEAM: { name: string; role: string }[] = [
  {
    name: "Conversation",
    role: "Dialogue to get thoughts out. Exact transcript you can continue anytime.",
  },
  {
    name: "Storyteller",
    role: "One professional Script per talk — edit and hear until the wording feels right.",
  },
  {
    name: "Curator",
    role: "Music, tone, your voice, and one optional photo — memorable presentation.",
  },
  {
    name: "Content Manager",
    role: "Share access for Scripts only — passwords, revoke, who can listen and see the photo.",
  },
  {
    name: "Chief-of-Staff",
    role: "Coordinates handoffs and learns preferences behind the scenes.",
  },
];

type Props = {
  className?: string;
};

export default function AgentTeam({ className }: Props) {
  return (
    <ul className={`me-team-list${className ? ` ${className}` : ""}`}>
      {AGENT_TEAM.map((agent) => (
        <li key={agent.name}>
          <div className="me-team-name">{agent.name}</div>
          <div className="me-team-role">{agent.role}</div>
        </li>
      ))}
    </ul>
  );
}
