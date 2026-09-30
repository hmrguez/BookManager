import { t, translateCopy, useLanguage } from '../localization'
import { AlertTriangle, BookOpen, History, ShieldCheck } from 'lucide-react'
import { Sheet } from '../app/components/Sheet'
import { tw } from '../tailwind/styles'

export type ReaderRecovery = {
  readonly title: string
  readonly message: string
  readonly canRetry: boolean
}

export function ReaderRecoverySheet({
  recovery,
  onClose,
  onRetry,
  onChooseFile,
}: {
  readonly recovery: ReaderRecovery
  readonly onClose: () => void
  readonly onRetry: () => void
  readonly onChooseFile?: () => void
}) {
  useLanguage()
  return (
    <Sheet title={t("Reader recovery")} onClose={onClose}>
      <div className={tw('reader-recovery')}>
        <span className={tw('reader-recovery__mark')} aria-hidden="true">
          <AlertTriangle />
        </span>
        <div className={tw('reader-recovery__copy')}>
          <span>{t("Publication unavailable")}</span>
          <h3>{recovery.title}</h3>
          <p>{translateCopy(recovery.message ?? '')}</p>
        </div>
        <ul className={tw('reader-recovery__assurances')}>
          <li><History aria-hidden="true" /><span><strong>{t("Reading history kept")}</strong><small>{t("The failed open did not replace your last trusted locator.")}</small></span></li>
          <li><ShieldCheck aria-hidden="true" /><span><strong>{t("Annotations kept")}</strong><small>{t("Recovery never deletes notes, highlights, or the library record.")}</small></span></li>
        </ul>
        {onChooseFile && <button className={tw('primary-button')} type="button" onClick={onChooseFile}>{t("Choose file")}</button>}
        <button type="button" onClick={onClose}>{t("Cancel")}</button>
        {recovery.canRetry && (
          <button className={tw('primary-button')} type="button" onClick={onRetry}>
            <BookOpen aria-hidden="true" /> {t(" Try opening again")}</button>
        )}
      </div>
    </Sheet>
  )
}
