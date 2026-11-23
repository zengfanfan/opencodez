import { describe, expect, test } from "bun:test"
import { agentIcon, agentTone } from "./agent-icon"

describe("agent icons", () => {
  test("uses the composer's Plan and Build icons", () => {
    expect(agentIcon("plan")).toBe("post-skill")
    expect(agentIcon("build")).toBe("flask")
  })

  test("falls back for custom and missing agents", () => {
    expect(agentIcon("review")).toBe("outline-brain")
    expect(agentIcon(undefined)).toBe("outline-brain")
  })

  test("tones only Plan and Build", () => {
    expect(agentTone("plan")).toBe("text-v2-agent-plan-solid")
    expect(agentTone("build")).toBe("text-v2-agent-build-solid")
    expect(agentTone("review")).toBeUndefined()
  })
})
