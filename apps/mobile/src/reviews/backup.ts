import { z } from 'zod'
import { readText, type SqlDatabase } from '../storage/database'
import { keepsakeSchema, reviewId, reviewSettingsSchema, savedQuarterSchema } from './keepsake-model'
import { reviewFingerprint } from './updates'

export const reviewBackupSchema = z.object({
  version: z.literal(1), settings: reviewSettingsSchema.nullable(),
  quarters: z.array(savedQuarterSchema), keepsakes: z.array(keepsakeSchema),
  suppressions: z.array(z.object({ quarterId: z.string().regex(/^review:\d{4}-Q[1-4]$/), suppressedAt: z.iso.datetime({ offset: true }) }).strict()),
}).strict().superRefine((data, ctx) => {
  const ids = data.quarters.map(reviewId)
  if (new Set(ids).size !== ids.length || new Set(data.keepsakes.map(k => k.id)).size !== data.keepsakes.length
    || new Set(data.suppressions.map(s => s.quarterId)).size !== data.suppressions.length
    || (!data.settings && (ids.length || data.keepsakes.length))) ctx.addIssue({ code: 'custom', message: 'Invalid review backup identities or settings' })
  for (const saved of data.keepsakes) {
    const quarter = data.quarters.find(q => reviewId(q) === saved.id)
    if (!quarter || reviewFingerprint(quarter) !== reviewFingerprint(saved.facts.quarter)) ctx.addIssue({ code: 'custom', message: 'Review quarter assignment is missing or inconsistent' })
  }
})
export type ReviewBackup = z.infer<typeof reviewBackupSchema>
export const emptyReviewBackup = (): ReviewBackup => ({ version: 1, settings: null, quarters: [], keepsakes: [], suppressions: [] })

/** Caller owns the surrounding library transaction. Historical evidence refs may legitimately be gone. */
export async function readReviewBackup(database: SqlDatabase): Promise<ReviewBackup> {
  if (!(await database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'review_settings'")).length) return emptyReviewBackup()
  const [settings] = await database.query('SELECT payload_json FROM review_settings WHERE id = 1')
  const quarters = await database.query('SELECT id, payload_json FROM review_quarters ORDER BY id')
  const keepsakes = await database.query('SELECT id, payload_json FROM review_keepsakes ORDER BY id')
  const suppressions = await database.query('SELECT quarter_id, suppressed_at FROM review_invitation_suppressions ORDER BY quarter_id')
  const data = reviewBackupSchema.parse({ version: 1,
    settings: settings ? JSON.parse(readText(settings, 'payload_json')) : null,
    quarters: quarters.map(row => JSON.parse(readText(row, 'payload_json'))),
    keepsakes: keepsakes.map(row => JSON.parse(readText(row, 'payload_json'))),
    suppressions: suppressions.map(row => ({ quarterId: readText(row, 'quarter_id'), suppressedAt: readText(row, 'suppressed_at') })),
  })
  if (data.quarters.some((q, i) => reviewId(q) !== quarters[i]!.id) || data.keepsakes.some((k, i) => k.id !== keepsakes[i]!.id)) throw new Error('Review backup storage key mismatch')
  return data
}
export async function replaceReviewBackup(database: SqlDatabase, input: ReviewBackup) {
  const data = reviewBackupSchema.parse(input)
  if (!(await database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'review_settings'")).length) {
    if (reviewFingerprint(data) !== reviewFingerprint(emptyReviewBackup())) throw new Error('Initialize review storage before restoring reviews')
    return // A pre-review rollback can run before additive migrations on launch.
  }
  for (const table of ['review_keepsakes', 'review_quarters', 'review_settings', 'review_invitation_suppressions']) await database.run(`DELETE FROM ${table}`)
  if (data.settings) await database.run('INSERT INTO review_settings(id, payload_json) VALUES (1, ?)', [JSON.stringify(data.settings)])
  for (const quarter of data.quarters) await database.run('INSERT INTO review_quarters(id, payload_json) VALUES (?, ?)', [reviewId(quarter), JSON.stringify(quarter)])
  for (const saved of data.keepsakes) await database.run('INSERT INTO review_keepsakes(id, payload_json) VALUES (?, ?)', [saved.id, JSON.stringify(saved)])
  for (const suppression of data.suppressions) await database.run('INSERT INTO review_invitation_suppressions(quarter_id, suppressed_at) VALUES (?, ?)', [suppression.quarterId, suppression.suppressedAt])
}
