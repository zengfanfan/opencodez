import { describe, expect } from "bun:test"
import { Effect, Layer, RcMap, Scope } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Instance } from "@opencode/core/instance/service"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionModelTransport } from "@opencode/core/session/model-transport"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionEnvironment } from "@opencode/core/session/environment"
import { LocationServiceMap } from "@opencode/core/location-services"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"

const closed: Session.ID[] = []
const transportScopes = new Set<Scope.Scope>()
const transport = Layer.effect(
  SessionModelTransport.Service,
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    transportScopes.add(scope)
    yield* Effect.addFinalizer(() => Effect.sync(() => transportScopes.delete(scope)))
    return SessionModelTransport.Service.of({
      bind: () => ({ execute: () => Effect.die("Unexpected WebSocket execution") }),
      close: (sessionID) => Effect.sync(() => closed.push(sessionID)),
      closeAll: Effect.void,
    })
  }),
)
const harness = (execution: Layer.Layer<SessionExecution.Service>) =>
  testEffect(
    AppNodeBuilder.build(
      LayerNode.group([
        Database.node,
        Bus.node,
        SessionProjector.node,
        SessionStore.node,
        SessionEnvironment.node,
        SessionInbox.node,
        Session.node,
        Instance.node,
        LocationServiceMap.node,
      ]),
      [
        Project.node.replace(globalProjectNode),
        SessionExecution.node.replace(execution),
        SessionModelTransport.node.replace(transport),
        offlineModels,
      ],
    ),
  )

const it = harness(SessionExecution.noopLayer)

const active = new Set<Session.ID>()
const activeExecution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => active),
    isActive: (id) => Effect.sync(() => active.has(id)),
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.succeed(false),
    awaitIdle: () => Effect.void,
  }),
)
const itActive = harness(activeExecution)

describe("Session.remove", () => {
  it.effect("removes a session and its children", () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const location = Location.Ref.make({ directory: AbsolutePath.make(temporary.path) })
      const session = yield* Session.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({ parentID: parent.id })
      yield* session.environment({ sessionID: parent.id, variables: { SESSION_ENV: "parent" } })
      yield* session.environment({ sessionID: child.id, variables: { SESSION_ENV: "child" } })
      const locations = yield* LocationServiceMap.Service
      yield* Effect.acquireRelease(locations.contextEffect(location), () => locations.invalidate(location))
      closed.length = 0

      yield* session.remove(parent.id)

      expect((yield* session.list()).data).toEqual([])
      expect(closed).toEqual([parent.id, child.id])
      const environments = yield* SessionEnvironment.Service
      expect(yield* environments.get(parent.id)).toBeUndefined()
      expect(yield* environments.get(child.id)).toBeUndefined()
      expect(yield* Effect.result(session.get(parent.id))).toMatchObject({ _tag: "Failure" })
      expect(yield* Effect.result(session.get(child.id))).toMatchObject({ _tag: "Failure" })
    }),
  )

  it.live("removes unloaded sessions and children without initializing an instance", () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const locations = yield* LocationServiceMap.Service
      const parent = yield* sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(temporary.path) }),
      })
      const child = yield* sessions.create({ parentID: parent.id })
      closed.length = 0
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])

      yield* sessions.remove(parent.id)

      expect(closed).toEqual([parent.id, child.id])
      expect(transportScopes.size).toBe(1)
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])
      expect((yield* sessions.list()).data).toEqual([])
    }),
  )

  it.effect("fails when the session does not exist", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const sessionID = Session.ID.make("ses_missing")

      expect(yield* Effect.result(session.remove(sessionID))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "Session.NotFoundError", sessionID },
      })
    }),
  )

  it.effect("refuses to remove a session with queued input", () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const session = yield* Session.Service
      const created = yield* session.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(temporary.path) }),
      })
      const inbox = yield* SessionInbox.Service

      yield* inbox.admit({
        id: SessionMessage.ID.create(),
        sessionID: created.id,
        item: { type: "user", delivery: "queue", payload: { text: "queued" } },
      })

      expect(yield* Effect.result(session.remove(created.id))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "Session.BusyError", sessionID: created.id },
      })
      expect((yield* session.list()).data.map((item) => item.id)).toEqual([created.id])
    }),
  )

  it.effect("ignores parked synthetic input when removing", () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const session = yield* Session.Service
      const created = yield* session.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(temporary.path) }),
      })
      const inbox = yield* SessionInbox.Service

      yield* inbox.admit({
        id: SessionMessage.ID.create(),
        sessionID: created.id,
        item: { type: "synthetic", delivery: "queue", payload: { text: "parked" } },
      })

      yield* session.remove(created.id)

      expect((yield* session.list()).data).toEqual([])
    }),
  )

  itActive.effect("refuses to remove a parent while a child is executing", () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const session = yield* Session.Service
      const parent = yield* session.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(temporary.path) }),
      })
      const child = yield* session.create({ parentID: parent.id })

      active.clear()
      active.add(child.id)

      expect(yield* Effect.result(session.remove(parent.id))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "Session.BusyError", sessionID: parent.id },
      })
      expect((yield* session.list()).data.map((item) => item.id).sort()).toEqual([parent.id, child.id].sort())
    }),
  )
})
