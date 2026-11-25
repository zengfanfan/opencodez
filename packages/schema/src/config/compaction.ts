export * as ConfigCompaction from "./compaction.js"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, optional } from "../schema.js"

export class Keep extends Schema.Class<Keep>("Config.Compaction.Keep")({
  tokens: NonNegativeInt.pipe(optional),
}) {}

/** A share of the model's window such as "20%" or "12.5%", from 1% up to but not including 100%. */
export const Percent = Schema.String.check(Schema.isPattern(/^([1-9]\d?(\.\d+)?)%$/u)).annotate({
  identifier: "Config.Compaction.Percent",
})
export type Percent = typeof Percent.Type

/** A decimal token count such as "128K" or "1.5M"; K is 1000 and M is 1,000,000. */
export const Tokens = Schema.String.check(Schema.isPattern(/^\d+(?:\.\d+)?[KkMm]$/u)).annotate({
  identifier: "Config.Compaction.Tokens",
})
export type Tokens = typeof Tokens.Type

/** Room kept free before automatic compaction: a window share, a token count, or a K/M token string. */
export const Buffer = Schema.Union([Percent, NonNegativeInt, Tokens]).annotate({
  identifier: "Config.Compaction.Buffer",
})
export type Buffer = typeof Buffer.Type

/** The share or token count of the window used before automatic compaction: the forward form of `Buffer`. */
export const Threshold = Schema.Union([Percent, PositiveInt, Tokens]).annotate({
  identifier: "Config.Compaction.Threshold",
})
export type Threshold = typeof Threshold.Type

/** A per-model key in `provider/model` form. Model IDs may contain `/`; variants are not supported here. */
export const ModelKey = Schema.String.check(Schema.isPattern(/^[^/#]+\/[^#]+$/u)).annotate({
  identifier: "Config.Compaction.ModelKey",
})
export type ModelKey = typeof ModelKey.Type

export class Override extends Schema.Class<Override>("Config.Compaction.Override")({
  buffer: Buffer.pipe(optional),
  threshold: Threshold.pipe(optional),
}) {}

export class Info extends Schema.Class<Info>("Config.Compaction")({
  auto: Schema.Boolean.pipe(optional),
  background: Schema.Boolean.annotate({
    description:
      "Write the summary in the background as the session nears automatic compaction, so it does not wait for one (default: true). A summary that is never used still costs tokens.",
  }).pipe(optional),
  keep: Keep.pipe(optional),
  buffer: Buffer.annotate({
    description:
      'Room kept free below the model\'s context window before automatic compaction, as a share of the window from "1%" to "99%", such as "20%" to compact at 80% full. A token count is also accepted, including K/M forms such as "128K" or "1.5M".',
  }).pipe(optional),
  threshold: Threshold.annotate({
    description:
      'Compact once the conversation uses this share of the model\'s input window, from "1%" to "99%", such as "85%". A token count is also accepted, including K/M forms such as "700K" or "1.5M". Set this or buffer; this wins when both are set.',
  }).pipe(optional),
  models: Schema.Record(ModelKey, Override).annotate({
    description:
      "Per-model buffer or threshold overrides keyed by provider/model. Unlisted models use the top-level values.",
  }).pipe(optional),
}) {}
