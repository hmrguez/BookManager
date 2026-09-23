import {
  ChevronRight,
  FileKey2,
  HardDrive,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import type {
  EpubCleanupPreview,
  EpubStorageInventory,
} from '../epub/lifecycle'
import { tw } from '../tailwind/styles'

export type EpubStorageViewState = {
  readonly inventory?: EpubStorageInventory
  readonly cleanupPreview?: EpubCleanupPreview
  readonly busy: boolean
  readonly error?: string
}

export function EpubStorageCard({
  state,
  onRefresh,
  onPreviewCleanup,
  onConfirmCleanup,
  onCancelReview,
}: {
  readonly state: EpubStorageViewState
  readonly onRefresh: () => void
  readonly onPreviewCleanup: (assetIds?: readonly string[]) => void
  readonly onConfirmCleanup: () => void
  readonly onCancelReview: () => void
}) {
  const inventory = state.inventory
  const obsoleteAssetIds = inventory?.items.filter(({ active, managed, retainedCopy, state: itemState }) =>
    retainedCopy || (managed !== false && !active && itemState !== 'missing'),
  ).map(({ assetId }) => assetId) ?? []

  return (
    <section className={tw('settings-card epub-storage-card')}>
      <div className={tw('settings-card__icon')}><HardDrive aria-hidden="true" /></div>
      <div className={tw('settings-card__heading')}>
        <h2>Book storage</h2>
        <p>Original files stay where you keep them. Cleanup only removes private copies; your originals, progress, bookmarks, and notes stay safe.</p>
      </div>

      {inventory ? (
        <>
          <dl className={tw('epub-storage-tally')} aria-label="Book storage use">
            <div><dt>Private content</dt><dd>{formatBytes(inventory.totalManagedBytes)}</dd></div>
            <div><dt>Current copies</dt><dd>{formatBytes(inventory.activeManagedBytes)}</dd></div>
            <div><dt>Safe to review</dt><dd>{formatBytes(inventory.reclaimableBytes)}</dd></div>
            <div><dt>Linked originals</dt><dd>{formatBytes(inventory.linkedBytes ?? 0)}</dd></div>
            <div><dt>Needs attention</dt><dd>{inventory.attentionCount}</dd></div>
          </dl>

          <div className={tw('epub-storage-policy')}>
            <FileKey2 aria-hidden="true" />
            <span>
              <strong>{platformLabel(inventory.policy.platform)} · {inventory.policy.mode === 'original-file' ? 'original files' : 'private copies'}</strong>
              <small>{inventory.policy.sourceHandling} {inventory.policy.storageLocation}</small>
            </span>
            <span><b>System backup</b> Excluded</span>
          </div>

          {inventory.items.length === 0 && (
            <p className={tw('epub-storage-empty')}>No book files yet. Add an EPUB or PDF to see its storage use.</p>
          )}

          {obsoleteAssetIds.length > 0 && !state.cleanupPreview && (
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
          {state.busy ? 'Checking book files…' : 'Review Book storage'}
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

      {state.error && <p className={tw('settings-hint settings-hint--error epub-storage-error')} role="alert">{state.error}</p>}
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${Math.ceil(bytes / 1_024)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function platformLabel(platform: 'ios' | 'android' | 'web'): string {
  return platform === 'ios' ? 'iPhone & iPad' : platform === 'android' ? 'Android' : 'Web'
}
