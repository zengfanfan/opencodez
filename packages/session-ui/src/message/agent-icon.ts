const icons = new Map([
  ["plan", "post-skill"],
  ["build", "flask"],
])

const tones = new Map([
  ["plan", "text-v2-agent-plan-solid"],
  ["build", "text-v2-agent-build-solid"],
])

export function agentIcon(agent: string | undefined) {
  return icons.get((agent ?? "").toLowerCase()) ?? "outline-brain"
}

export function agentTone(agent: string | undefined) {
  return tones.get((agent ?? "").toLowerCase())
}
