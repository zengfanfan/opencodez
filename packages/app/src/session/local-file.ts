import { parsePathLineSuffix } from "@opencode/util/path"

export type LocalFileAction = "open" | "saveAs" | "copy" | "reveal"

export type LocalFileResolution =
  | { kind: "file"; path: string }
  | { kind: "multiple" }
  | { kind: "missing" }

/** The path a user sees, without the line suffix the file viewer appends. */
export function displayedLocalPath(href: string) {
  return parsePathLineSuffix(href).path
}

export function absoluteLocalPath(path: string) {
  return /^[a-z]:\//i.test(path) || path.startsWith("/")
}

const control = /[\u0000-\u001f\u007f]/

const scheme = /^[a-z][a-z\d+.-]*:/i

export type LocalPathTarget = { readonly absolute: boolean; readonly path: string }

/**
 * The path the file menu may resolve. Absolute paths (`C:/...`, `/...`) stay supported; a leading
 * backslash is a UNC/rooted path, never a workspace file. Everything else is Copy Path only.
 */
export function resolvableLocalPath(input: string): LocalPathTarget | undefined {
  if (!input || control.test(input) || input.startsWith("\\")) return

  let value = input.replaceAll("\\", "/")

  // `./x` names the same file; `.//server` does not, so stop before the doubled slash.
  while (value.startsWith("./") && !value.startsWith(".//")) value = value.slice(2)

  if (!value || value.startsWith("~") || value.startsWith("//")) return

  const absolute = absoluteLocalPath(value)

  if (!absolute && scheme.test(value)) return

  const rest = absolute ? (value.startsWith("/") ? value.slice(1) : value.slice(3)) : value

  if (rest.split("/").some((part) => !part || part === "." || part === "..")) return

  return { absolute, path: value }
}

/** Picks the menu entries for a path: file actions only where the desktop can act on this machine. */
export function localFileActions(input: {
  readonly desktop: boolean
  readonly local: boolean
  readonly path: string
}): readonly LocalFileAction[] {
  if (!input.desktop || !input.local) return ["copy"]
  const target = resolvableLocalPath(input.path)

  if (!target || target.path.startsWith("/builtin/")) return ["copy"]

  return ["open", "saveAs", "copy", "reveal"]
}

/**
 * Picks the workspace file a link names. An exact match wins, then one matching suffix; several matches stay
 * ambiguous instead of guessing, the same way the left-click picker does.
 */
export function selectLocalFile(
  directory: string,
  path: string,
  files: readonly string[],
): LocalFileResolution {
  const query = path.replaceAll("\\", "/")

  const matches = files.reduce<string[]>((acc, file) => {
    const normalized = file.replaceAll("\\", "/")

    if (normalized === query || normalized.endsWith(`/${query}`)) acc.push(normalized)

    return acc
  }, [])

  if (matches.includes(query)) return { kind: "file", path: joinLocalPath(directory, query) }

  if (matches.length === 1) return { kind: "file", path: joinLocalPath(directory, matches[0]!) }

  if (matches.length > 1) return { kind: "multiple" }

  return { kind: "missing" }
}

/** Joins a workspace-relative path to its root, keeping drive letters and collapsing `.` and `..`. */
export function joinLocalPath(directory: string, path: string) {
  const value = path.replaceAll("\\", "/")

  if (absoluteLocalPath(value)) return normalizeLocalPath(value)

  const base = directory.replaceAll("\\", "/").replace(/\/+$/, "")

  return normalizeLocalPath(`${base}/${value}`)
}

function normalizeLocalPath(path: string) {
  const drive = /^([a-z]:)\//i.exec(path)
  const prefix = drive ? `${drive[1]}/` : path.startsWith("/") ? "/" : ""
  const rest = drive ? path.slice(drive[0].length) : prefix ? path.slice(1) : path

  const parts = rest.split("/").reduce<string[]>((acc, part) => {
    if (!part || part === ".") return acc

    if (part === "..") {
      if (acc.length > 0 && acc.at(-1) !== "..") acc.pop()

      return acc
    }

    acc.push(part)

    return acc
  }, [])

  return `${prefix}${parts.join("/")}`
}
