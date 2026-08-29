import {
  AlertTriangle,
  Check,
  ChevronRight,
  FileKey2,
  FileUp,
  HardDrive,
  Link2,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import type {
  EpubCleanupPreview,
  EpubRelinkPreview,
  EpubStorageInventory,
} from '../epub/lifecycle'
import { tw } from '../tailwind/styles'

export type EpubStorageViewState = {
  readonly inventory?: EpubStorageInventory
  readonly cleanupPreview?: EpubCleanupPreview
  readonly relinkPreview?: EpubRelinkPreview
  readonly busy: boolean
  readonly error?: string
}

export function EpubStorageCard({
  state,
  onRefresh,
  onPreviewCleanup,
  onConfirmCleanup,
  onCancelReview,
  onPreviewRelink,
  onConfirmRelink,
}: {
  readonly state: EpubStorageViewState
  readonly onRefresh: () => void
  readonly onPreviewCleanup: (assetIds?: readonly string[]) => void
  readonly onConfirmCleanup: () => void
  readonly onCancelReview: () => void
  readonly onPreviewRelink: (assetId: string, file: File) => void
  readonly onConfirmRelink: () => void
}) {
  const inventory = state.inventory
  const obsoleteAssetIds = inventory?.items.filter(({ active, state: itemState }) =>
    !active && itemState !== 'missing',
  ).map(({ assetId }) => assetId) ?? []

  return (
    <section className={tw('settings-card epub-storage-card')}>
      <div className={tw('settings-card__icon')}><HardDrive aria-hidden="true" /></div>
      <div className={tw('settings-card__heading')}>
        <span>EPUB storage · Managed copies</span><h2>Files can leave. Your reading stays.</h2>
        <p>Wovenleaf verifies each private copy against its SHA-256 fingerprint. Removing bytes never removes the Edition, progress, bookmarks, or notes.</p>
      </div>

      {inventory ? (
        <>
          <dl className={tw('epub-storage-tally')} aria-label="EPUB storage use">
            <div><dt>On device</dt><dd>{formatBytes(inventory.totalManagedBytes)}</dd></div>
            <div><dt>Current copies</dt><dd>{formatBytes(inventory.activeManagedBytes)}</dd></div>
            <div><dt>Safe to review</dt><dd>{formatBytes(inventory.reclaimableBytes)}</dd></div>
            <div><dt>Needs attention</dt><dd>{inventory.attentionCount}</dd></div>
          </dl>

          <div className={tw('epub-storage-policy')}>
            <FileKey2 aria-hidden="true" />
            <span>
              <strong>{platformLabel(inventory.policy.platform)} · private managed copy</strong>
              <small>{inventory.policy.sourceHandling} {inventory.policy.storageLocation}</small>
            </span>
            <span><b>System backup</b> Excluded</span>
          </div>

          {inventory.items.length > 0 ? (
            <div className={tw('epub-asset-ledger')} role="region" aria-label="Managed EPUB files">
              <header>
                <span>Asset ledger</span>
                <button type="button" disabled={state.busy} onClick={onRefresh}>
                  <RotateCcw aria-hidden="true" /> Verify again
                </button>
              </header>
              {inventory.items.map((item) => (
                <article className={tw(`epub-asset-row is-${item.state}`)} key={item.assetId}>
                  <span className={tw('epub-asset-row__state')} aria-label={stateLabel(item.state)}>
                    {item.state === 'available' ? <Check aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
                  </span>
                  <span className={tw('epub-asset-row__identity')}>
                    <strong>{item.title}</strong>
                    <small>{item.active ? 'Current reading copy' : 'Superseded copy'} · {formatBytes(item.actualByteSize || item.expectedByteSize)}</small>
                    <code title={item.expectedFingerprint}>sha256:{shortFingerprint(item.expectedFingerprint)}</code>
                  </span>
                  <span className={tw('epub-asset-row__status')}>
                    <b>{stateLabel(item.state)}</b>
                    {item.state === 'available' && item.active ? (
                      <button type="button" disabled={state.busy} onClick={() => onPreviewCleanup([item.assetId])}>Review removal</button>
                    ) : item.state !== 'available' ? (
                      <label className={tw('epub-relink-picker')}>
                        <Link2 aria-hidden="true" /> Choose file
                        <input
                          type="file"
                          accept=".epub,application/epub+zip"
                          disabled={state.busy}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0]
                            if (file) onPreviewRelink(item.assetId, file)
                            event.currentTarget.value = ''
                          }}
                        />
                      </label>
                    ) : null}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className={tw('epub-storage-empty')}>No managed EPUB copies yet. Imported files will appear here with their verified storage use.</p>
          )}

          {obsoleteAssetIds.length > 0 && !state.cleanupPreview && !state.relinkPreview && (
            <button
              className={tw('epub-cleanup-action')}
              type="button"
              disabled={state.busy}
              onClick={() => onPreviewCleanup(obsoleteAssetIds)}
            >
              <Trash2 aria-hidden="true" />
              <span><strong>Review superseded copies</strong><small>Preview {formatBytes(inventory.reclaimableBytes)} before anything is removed</small></span>
              <ChevronRight aria-hidden="true" />
            </button>
          )}
        </>
      ) : (
        <button className={tw('epub-storage-load')} type="button" disabled={state.busy} onClick={onRefresh}>
          <RotateCcw aria-hidden="true" />
          {state.busy ? 'Verifying managed copies…' : 'Review EPUB storage'}
        </button>
      )}

      {state.cleanupPreview && (
        <div className={tw('epub-lifecycle-review')} role="dialog" aria-labelledby="epub-cleanup-title">
          <header>
            <span>Storage cleanup · Preview</span>
            <h3 id="epub-cleanup-title">Free {formatBytes(state.cleanupPreview.freedBytes)}?</h3>
            <p>{state.cleanupPreview.consequence}</p>
          </header>
          <dl>
            <div><dt>Files selected</dt><dd>{state.cleanupPreview.selections.length}</dd></div>
            <div><dt>Books losing offline access</dt><dd>{state.cleanupPreview.offlineBookCount}</dd></div>
            <div><dt>Reading events retained</dt><dd>{state.cleanupPreview.retainedReadingEventCount}</dd></div>
            <div><dt>Checkpoints & annotations retained</dt><dd>{state.cleanupPreview.retainedCheckpointCount + state.cleanupPreview.retainedAnnotationCount}</dd></div>
          </dl>
          <div>
            <button type="button" disabled={state.busy} onClick={onCancelReview}>Keep files</button>
            <button type="button" disabled={state.busy} onClick={onConfirmCleanup}><Trash2 aria-hidden="true" /> Remove selected copies</button>
          </div>
        </div>
      )}

      {state.relinkPreview && (
        <div className={tw(`epub-lifecycle-review is-${state.relinkPreview.match}`)} role="dialog" aria-labelledby="epub-relink-title">
          <header>
            <span>Re-link review · {relinkLabel(state.relinkPreview.match)}</span>
            <h3 id="epub-relink-title">{state.relinkPreview.title}</h3>
            <p>{state.relinkPreview.sourceName}</p>
          </header>
          <dl>
            <div><dt>Expected</dt><dd><code>{shortFingerprint(state.relinkPreview.expectedFingerprint)}</code></dd></div>
            <div><dt>Selected file</dt><dd><code>{shortFingerprint(state.relinkPreview.candidateFingerprint)}</code></dd></div>
            <div><dt>Selected size</dt><dd>{formatBytes(state.relinkPreview.candidateByteSize)}</dd></div>
            <div><dt>History & notes</dt><dd>Retained</dd></div>
          </dl>
          <ul>
            {state.relinkPreview.evidence.map((evidence) => <li key={evidence}>{state.relinkPreview?.canRelink ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}{evidence}</li>)}
          </ul>
          <div>
            <button type="button" disabled={state.busy} onClick={onCancelReview}>Choose another</button>
            <button type="button" disabled={state.busy || !state.relinkPreview.canRelink} onClick={onConfirmRelink}>
              <FileUp aria-hidden="true" />
              {state.relinkPreview.match === 'edition-metadata' ? 'Link as reviewed revision' : 'Restore this copy'}
            </button>
          </div>
        </div>
      )}

      {state.error && <p className={tw('settings-hint settings-hint--error epub-storage-error')} role="alert">{state.error}</p>}
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${Math.ceil(bytes / 1_024)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function shortFingerprint(fingerprint: string): string {
  return `${fingerprint.slice(0, 8)}…${fingerprint.slice(-6)}`
}

function stateLabel(state: 'available' | 'missing' | 'replaced'): string {
  return state === 'available' ? 'Verified' : state === 'missing' ? 'Missing' : 'Content changed'
}

function relinkLabel(match: EpubRelinkPreview['match']): string {
  return match === 'exact-fingerprint' ? 'Exact fingerprint' : match === 'edition-metadata' ? 'Metadata match' : 'Not a match'
}

function platformLabel(platform: 'ios' | 'android' | 'web'): string {
  return platform === 'ios' ? 'iPhone & iPad' : platform === 'android' ? 'Android' : 'Web'
}
