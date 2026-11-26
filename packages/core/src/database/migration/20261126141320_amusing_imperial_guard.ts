import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261126141320_amusing_imperial_guard",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`time_recency\` integer;`)
      // Backfill ordering from the last user prompt the session already carries.
      yield* tx.run(`
        UPDATE \`session_v2\`
        SET \`time_recency\` = MAX(
          COALESCE((
            SELECT m.\`time_created\` FROM \`session_message\` m
            WHERE m.\`session_id\` = \`session_v2\`.\`id\` AND m.\`type\` = 'user'
            ORDER BY m.\`seq\` DESC LIMIT 1
          ), 0),
          COALESCE((
            SELECT MAX(i.\`time_created\`) FROM \`session_inbox\` i
            WHERE i.\`session_id\` = \`session_v2\`.\`id\` AND i.\`type\` = 'user'
          ), 0),
          \`time_created\`
        )
      `)
      // Backfill display from the last message, the idle marker, or pending work other than a move.
      yield* tx.run(`
        UPDATE \`session_v2\`
        SET \`time_updated\` = MAX(
          COALESCE((
            SELECT m.\`time_updated\` FROM \`session_message\` m
            WHERE m.\`session_id\` = \`session_v2\`.\`id\`
            ORDER BY m.\`seq\` DESC LIMIT 1
          ), 0),
          COALESCE(\`time_idle\`, 0),
          COALESCE((
            SELECT MAX(i.\`time_created\`) FROM \`session_inbox\` i
            WHERE i.\`session_id\` = \`session_v2\`.\`id\` AND i.\`type\` <> 'move'
          ), 0),
          \`time_created\`
        )
      `)
    })
  },
}

export default migration
