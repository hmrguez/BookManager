import { t } from '../localization'
import type { ShelfId } from '../library-model'

const actions: readonly { shelf: ShelfId; verbs: readonly string[] }[] = [
  { shelf: 'reading', verbs: ['start', 'read', 'leer', 'empezar', 'comenzar', 'lesen', 'starten', 'leggi', 'leggere', 'inizia', 'iniziare', 'lire', 'commencer'] },
  { shelf: 'finished', verbs: ['finish', 'complete', 'done', 'terminar', 'finalizar', 'beenden', 'abschließen', 'finisci', 'finire', 'termina', 'terminare', 'finir', 'terminer'] },
  { shelf: 'next', verbs: ['next', 'queue', 'siguiente', 'próximo', 'nächste', 'nächstes', 'weiter', 'prossimo', 'coda', 'suivant', 'suivante'] },
]
const normalizeVerb = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

/** Human command aliases map to stable shelf IDs; the book query stays verbatim. */
export function parseBookAction(query: string): { readonly label: string; readonly query: string; readonly shelf: ShelfId } | undefined {
  const match = /^(\S+)\s+(.+)$/u.exec(query)
  if (!match) return undefined
  const verb = normalizeVerb(match[1]!)
  const action = actions.find(({ verbs }) => verbs.some(candidate => normalizeVerb(candidate) === verb))
  if (!action) return undefined
  return {
    label: action.shelf === 'finished' ? t('Mark finished') : action.shelf === 'next' ? t('Move to Up Next') : t('Start reading'),
    query: match[2]!.trim(),
    shelf: action.shelf,
  }
}
