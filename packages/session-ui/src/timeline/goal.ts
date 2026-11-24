import type { SessionMessageInfo } from "@opencode/client/promise"

/** A goal kickoff opens a turn that reads as the user's own message; continuations stay inside it. */
export function goalKickoff(
  message: SessionMessageInfo | undefined,
): message is Extract<SessionMessageInfo, { type: "synthetic" }> {
  return message?.type === "synthetic" && message.metadata?.source === "goal" && !!message.description?.trim()
}
