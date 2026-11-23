import path from "node:path"
import { Effect, FileSystem, Option } from "effect"
import type { SaveFileAsResult } from "../../shared/ipc-contract"

export type { SaveFileAsResult }

export type FileIdentity = { readonly dev: bigint; readonly ino: bigint }

type TargetState =
  | { readonly kind: "file"; readonly identity: FileIdentity | undefined }
  | { readonly kind: "missing" }
  | { readonly kind: "unverified" }

const comparable = (value: string) => {
  const resolved = path.resolve(value).replaceAll("\\", "/")

  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

/**
 * Decides what Save As does once both paths are known. A destination that exists but whose
 * identity cannot be compared is left alone instead of risking a copy onto the source.
 */
export function saveFileAsStep(input: {
  readonly source: string
  readonly sourceIdentity: FileIdentity | undefined
  readonly target: string
  readonly targetState: TargetState
}): "copy" | "sameFile" | "unverified" {
  if (comparable(input.source) === comparable(input.target)) return "sameFile"

  if (input.targetState.kind === "unverified") return "unverified"

  if (input.targetState.kind === "missing") return "copy"

  const source = input.sourceIdentity
  const target = input.targetState.identity

  // A zero inode means the filesystem did not report one; different files can share it.
  if (!source || !target || source.ino === 0n || target.ino === 0n) return "unverified"

  return source.dev === target.dev && source.ino === target.ino ? "sameFile" : "copy"
}

const identityOf = (info: FileSystem.File.Info): FileIdentity | undefined => {
  const ino = Option.getOrUndefined(info.ino)

  return ino === undefined ? undefined : { dev: info.dev, ino }
}

export const copyFileForSaveAs = Effect.fn("DesktopFiles.copyFileForSaveAs")(function* (source: string, target: string) {
  const fs = yield* FileSystem.FileSystem

  // Check the source first: a missing source must never touch the destination.
  const sourceInfo = yield* fs.stat(source)

  const targetState = yield* fs.stat(target).pipe(
    Effect.map((info): TargetState => ({ kind: "file", identity: identityOf(info) })),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed<TargetState>({ kind: "missing" })),
    Effect.catch(() => Effect.succeed<TargetState>({ kind: "unverified" })),
  )

  const step = saveFileAsStep({
    source,
    sourceIdentity: identityOf(sourceInfo),
    target,
    targetState,
  })

  if (step === "sameFile") return "sameFile" as const

  if (step === "unverified") return "unverified" as const

  yield* fs.copyFile(source, target)

  return "saved" as const
})
