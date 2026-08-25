import type { AccessGrant, Loan, Ownership } from './access'
import type { Edition } from './editions'
import type { IsoDateTime } from './shared'
import type { WorkId } from './ids'

export type AccessState = 'not-started' | 'available' | 'expired' | 'returned' | 'ended'

export function accessStateAt(
  grant: AccessGrant,
  ownerships: readonly Ownership[],
  loans: readonly Loan[],
  at: IsoDateTime,
): AccessState {
  const instant = Date.parse(at)

  if (grant.basis === 'public-domain') return 'available'

  if (grant.basis === 'subscription') {
    if (instant < Date.parse(grant.startsAt)) return 'not-started'
    return grant.endsAt && instant >= Date.parse(grant.endsAt) ? 'expired' : 'available'
  }

  if (grant.basis === 'ownership') {
    const ownership = ownerships.find(({ id }) => id === grant.ownershipId)
    if (!ownership) throw new Error(`Missing ownership ${grant.ownershipId}`)
    if (instant < Date.parse(ownership.acquiredAt)) return 'not-started'
    return ownership.disposedAt && instant >= Date.parse(ownership.disposedAt)
      ? 'ended'
      : 'available'
  }

  const loan = loans.find(({ id }) => id === grant.loanId)
  if (!loan) throw new Error(`Missing loan ${grant.loanId}`)
  if (instant < Date.parse(loan.borrowedAt)) return 'not-started'
  if (loan.returnedAt && instant >= Date.parse(loan.returnedAt)) return 'returned'
  return instant >= Date.parse(loan.dueAt) ? 'expired' : 'available'
}

/**
 * A Work merge reparents complete Edition records. Children stay attached to
 * stable Edition IDs. Review history and undo are intentionally owned by QUI-20.
 */
export function reparentEditionsForWorkMerge(
  editions: readonly Edition[],
  absorbedWorkId: WorkId,
  survivingWorkId: WorkId,
): readonly Edition[] {
  return editions.map((edition) =>
    edition.workId === absorbedWorkId ? { ...edition, workId: survivingWorkId } : edition,
  )
}
