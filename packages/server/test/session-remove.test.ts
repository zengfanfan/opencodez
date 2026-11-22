import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Session } from "@opencode/core/session"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { serveRoutes } from "./fixture/routes"

const boot = Effect.gen(function* () {
  const directory = yield* tmpdirScoped("opencode-session-remove-")
  const server = yield* serveRoutes(
    {
      app: { version: "test" },
      database: { path: path.join(directory.path, "opencode.db") },
      models: { fetch: false },
      fs: { filewatcher: false },
    },
    [Global.node.replace(tempGlobalLayer)],
  )
  return {
    context: server.context,
    location: { directory: directory.path },
    request: (method: string, route: string) =>
      Effect.promise(async () => {
        const response = await server.fetch(`http://opencode.local${route}`, { method })
        return { status: response.status, body: await response.text() }
      }),
    api: OpenCode.make({
      baseUrl: "http://opencode.local",
      fetch: Object.assign(
        (input: string | URL | Request, init?: RequestInit) => server.handler(new Request(input, init)),
        { preconnect: fetch.preconnect },
      ),
    }),
  }
})

it.live("refuses to delete a session with queued input", () =>
  Effect.gen(function* () {
    const server = yield* boot
    const session = yield* Effect.promise(() => server.api.session.create({ location: server.location }))
    const sessionID = Session.ID.make(session.id)
    const inbox = yield* SessionInbox.make().pipe(Effect.provide(server.context))

    yield* inbox.admit({
      id: SessionMessage.ID.create(),
      sessionID,
      item: { type: "user", delivery: "queue", payload: { text: "queued" } },
    })

    const response = yield* server.request("DELETE", `/api/session/${sessionID}`)
    expect(response.status).toBe(409)
    expect(JSON.parse(response.body)).toMatchObject({ _tag: "SessionBusyError", sessionID })
  }),
)
