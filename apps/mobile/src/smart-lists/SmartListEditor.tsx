import { useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Braces,
  Check,
  ListFilter,
  Pin,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { ActionButton } from '../design-system'
import {
  cloneSmartListDefinition,
  createBlankSmartListDefinition,
  operatorsForField,
  parseSmartListDefinition,
  SMART_LIST_RULE_SCHEMA_VERSION,
  SMART_LIST_TEMPLATES,
  smartListId,
  type SavedSmartList,
  type SmartListCondition,
  type SmartListDefinition,
  type SmartListGroupField,
  type SmartListRuleField,
  type SmartListRuleOperator,
  type SmartListSortField,
} from './model'
import type { SmartListDraft } from './use-smart-lists'
import type { SmartListDocument } from './query'
import { querySmartList } from './query'

export function SmartListEditor({
  list,
  documents,
  onSave,
  onArchive,
  onDelete,
}: {
  list?: SavedSmartList
  documents: readonly SmartListDocument[]
  onSave: (draft: SmartListDraft) => void
  onArchive: (list: SavedSmartList) => void
  onDelete: (list: SavedSmartList) => void
}) {
  const storedValidation = useMemo(() => parseSmartListDefinition(list?.definition), [list?.definition])
  const storedDefinition = storedValidation.definition
  const simpleDefinition = storedDefinition?.root.rules.every(
    (rule) => rule.kind === 'condition',
  ) ? storedDefinition : undefined
  const editable = !list || Boolean(simpleDefinition)
  const [name, setName] = useState(list?.name ?? '')
  const [description, setDescription] = useState(list?.description ?? '')
  const [pinned, setPinned] = useState(list?.pinned ?? false)
  const [definition, setDefinition] = useState<SmartListDefinition>(
    simpleDefinition ?? createBlankSmartListDefinition(),
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const query = useMemo(() => querySmartList(definition, documents), [definition, documents])
  const conditions = definition.root.rules.filter(
    (rule): rule is SmartListCondition => rule.kind === 'condition',
  )

  const applyTemplate = (templateId: (typeof SMART_LIST_TEMPLATES)[number]['id']) => {
    const template = SMART_LIST_TEMPLATES.find(({ id }) => id === templateId)
    if (!template) return
    setDefinition(cloneSmartListDefinition(template.definition))
    setName(template.name)
    setDescription(template.description)
  }

  const updateCondition = (id: string, update: Partial<SmartListCondition>) => {
    setDefinition((current) => ({
      ...current,
      root: {
        ...current.root,
        rules: current.root.rules.map((rule) => rule.id === id && rule.kind === 'condition'
          ? { ...rule, ...update }
          : rule),
      },
    }))
  }

  const changeField = (condition: SmartListCondition, field: SmartListRuleField) => {
    updateCondition(condition.id, {
      field,
      operator: defaultOperator(field),
      value: defaultValue(field),
    })
  }

  const addCondition = () => {
    const added: SmartListCondition = {
      id: smartListId('rule'),
      kind: 'condition',
      field: 'status',
      operator: 'is',
      value: 'tbr',
      negate: false,
    }
    setDefinition((current) => ({
      ...current,
      root: { ...current.root, rules: [...current.root.rules, added] },
    }))
  }

  const removeCondition = (id: string) => {
    setDefinition((current) => ({
      ...current,
      root: { ...current.root, rules: current.root.rules.filter((rule) => rule.id !== id) },
    }))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!editable || !name.trim() || !query.ok) return
    onSave({
      id: list?.id,
      name,
      description,
      pinned,
      archived: list?.archived,
      definition: query.definition,
    })
  }

  if (!editable) {
    const issues = storedValidation.issues.length
      ? storedValidation.issues
      : [{ path: 'definition.root', message: 'Nested rule groups require the advanced editor' }]
    return (
      <div className="smart-list-preserved" role="alert">
        <AlertTriangle aria-hidden="true" />
        <div>
          <span>Configuration preserved</span>
          <h3>This smart list cannot be edited on this version</h3>
          <p>Its saved rules are still intact. Nothing was reset or removed.</p>
        </div>
        <ul>
          {issues.map((issue) => <li key={`${issue.path}:${issue.message}`}><strong>{issue.path}</strong> {issue.message}</li>)}
        </ul>
        <details>
          <summary><Braces aria-hidden="true" /> Show saved configuration</summary>
          <pre>{JSON.stringify(list?.definition, null, 2)}</pre>
        </details>
        {list && <SmartListDanger list={list} confirmDelete={confirmDelete} onConfirmDelete={setConfirmDelete} onArchive={onArchive} onDelete={onDelete} />}
      </div>
    )
  }

  return (
    <form className="smart-list-editor" onSubmit={submit}>
      <div className="smart-list-editor__intro">
        <span><Sparkles aria-hidden="true" /> Live, local, explainable</span>
        <p>Rules recalculate on this device. Books remain on their reading and custom shelves.</p>
      </div>

      <section className="smart-list-templates" aria-labelledby="smart-list-template-title">
        <header>
          <span>Start with a useful pattern</span>
          <small>Each template remains fully editable</small>
        </header>
        <div>
          {SMART_LIST_TEMPLATES.map((template) => (
            <button type="button" key={template.id} onClick={() => applyTemplate(template.id)}>
              <strong>{template.name}</strong>
              <small>{template.description}</small>
            </button>
          ))}
        </div>
      </section>

      <div className="smart-list-basics">
        <label className="shelf-field">
          <span>List name</span>
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Quiet weekend reads"
          />
        </label>
        <label className="shelf-field">
          <span>Note <i>optional</i></span>
          <textarea
            maxLength={1_000}
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this view is for"
          />
        </label>
        <label className="shelf-pin-field smart-list-pin-field">
          <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
          <Pin aria-hidden="true" />
          <span><strong>Pin this smart list</strong><small>Keep it above your other automatic views</small></span>
        </label>
      </div>

      <section className="smart-rule-builder" aria-labelledby="smart-rule-title">
        <header>
          <div>
            <span>Rules · schema v{SMART_LIST_RULE_SCHEMA_VERSION}</span>
            <h3 id="smart-rule-title">Include books matching</h3>
          </div>
          <label>
            <span className="sr-only">How rules are combined</span>
            <select
              value={definition.root.combinator}
              onChange={(event) => setDefinition((current) => ({
                ...current,
                root: { ...current.root, combinator: event.target.value as 'all' | 'any' },
              }))}
              aria-label="How rules are combined"
            >
              <option value="all">All rules</option>
              <option value="any">Any rule</option>
            </select>
          </label>
        </header>

        <div className="smart-rule-list">
          {conditions.map((condition, index) => (
            <div className="smart-rule-row" key={condition.id}>
              <span className="smart-rule-row__number">{String(index + 1).padStart(2, '0')}</span>
              <label>
                <span className="sr-only">Field for rule {index + 1}</span>
                <select
                  value={condition.field}
                  onChange={(event) => changeField(condition, event.target.value as SmartListRuleField)}
                  aria-label={`Field for rule ${index + 1}`}
                >
                  {FIELD_GROUPS.map((group) => (
                    <optgroup label={group.label} key={group.label}>
                      {group.fields.map((field) => <option value={field} key={field}>{FIELD_LABELS[field]}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">Operator for rule {index + 1}</span>
                <select
                  value={condition.operator}
                  onChange={(event) => updateCondition(condition.id, {
                    operator: event.target.value as SmartListRuleOperator,
                    value: valueForOperator(condition.field, event.target.value as SmartListRuleOperator, condition.value),
                  })}
                  aria-label={`Operator for rule ${index + 1}`}
                >
                  {operatorsForField(condition.field).map((operator) => (
                    <option value={operator} key={operator}>{OPERATOR_LABELS[operator]}</option>
                  ))}
                </select>
              </label>
              <RuleValueEditor condition={condition} index={index} onChange={(value) => updateCondition(condition.id, { value })} />
              <button
                className="smart-rule-row__remove"
                type="button"
                disabled={conditions.length === 1}
                onClick={() => removeCondition(condition.id)}
                aria-label={`Remove rule ${index + 1}`}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <button className="smart-rule-add" type="button" onClick={addCondition} disabled={conditions.length >= 50}>
          <Plus aria-hidden="true" /> Add rule
        </button>
      </section>

      <section className="smart-list-arrangement">
        <header>
          <span>Arrangement</span>
          <small>Applied after the rules match</small>
        </header>
        <div>
          <label>
            <span>Sort by</span>
            <select
              value={definition.sort.field}
              onChange={(event) => setDefinition((current) => ({
                ...current,
                sort: { ...current.sort, field: event.target.value as SmartListSortField },
              }))}
            >
              {SORT_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span>Direction</span>
            <select
              value={definition.sort.direction}
              onChange={(event) => setDefinition((current) => ({
                ...current,
                sort: { ...current.sort, direction: event.target.value as 'ascending' | 'descending' },
              }))}
            >
              <option value="ascending">Ascending</option>
              <option value="descending">Descending</option>
            </select>
          </label>
          <label>
            <span>Group by</span>
            <select
              value={definition.groupBy}
              onChange={(event) => setDefinition((current) => ({
                ...current,
                groupBy: event.target.value as SmartListGroupField,
              }))}
            >
              {GROUP_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className={`smart-list-preview${query.ok ? '' : ' smart-list-preview--error'}`} aria-live="polite">
        <div className="smart-list-preview__count">
          {query.ok ? <ListFilter aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <span><strong>{query.ok ? query.items.length : '—'}</strong><small>{query.ok ? `of ${documents.length} books` : 'Rules need attention'}</small></span>
        </div>
        <div>
          <span>Plain-language rule</span>
          {query.ok
            ? <p>{query.explanation}</p>
            : <ul>{query.issues.map((issue) => <li key={`${issue.path}:${issue.message}`}><strong>{issue.path}</strong> {issue.message}</li>)}</ul>}
        </div>
      </section>

      <ActionButton type="submit" disabled={!name.trim() || !query.ok}>
        <Check aria-hidden="true" /> {list ? 'Save smart list' : 'Create smart list'}
      </ActionButton>

      {list && <SmartListDanger list={list} confirmDelete={confirmDelete} onConfirmDelete={setConfirmDelete} onArchive={onArchive} onDelete={onDelete} />}
    </form>
  )
}

function RuleValueEditor({
  condition,
  index,
  onChange,
}: {
  condition: SmartListCondition
  index: number
  onChange: (value: unknown) => void
}) {
  if (condition.operator === 'is-missing') return <span className="smart-rule-value smart-rule-value--empty">No value</span>
  if (condition.field === 'status') {
    return (
      <select className="smart-rule-value" value={String(condition.value)} onChange={(event) => onChange(event.target.value)} aria-label={`Value for rule ${index + 1}`}>
        <option value="tbr">To Be Read</option>
        <option value="next">Up Next</option>
        <option value="reading">Reading</option>
        <option value="finished">Finished</option>
      </select>
    )
  }
  if (condition.field === 'ownership') {
    return (
      <select className="smart-rule-value" value={String(condition.value)} onChange={(event) => onChange(event.target.value)} aria-label={`Value for rule ${index + 1}`}>
        <option value="owned">Owned</option>
        <option value="borrowed">Borrowed</option>
        <option value="subscription">Subscription</option>
        <option value="public-domain">Public domain</option>
        <option value="none">No access record</option>
      </select>
    )
  }
  if (condition.field === 'availability') {
    return (
      <select className="smart-rule-value" value={String(condition.value)} onChange={(event) => onChange(event.target.value)} aria-label={`Value for rule ${index + 1}`}>
        <option value="available">Available</option>
        <option value="expiring-soon">Expiring soon</option>
        <option value="expired">Expired</option>
        <option value="unavailable">Unavailable</option>
      </select>
    )
  }
  if (condition.operator === 'between') {
    const [minimum, maximum] = Array.isArray(condition.value) ? condition.value : [0, 100]
    return (
      <span className="smart-rule-value smart-rule-value--between">
        <input type="number" value={Number(minimum)} onChange={(event) => onChange([Number(event.target.value), Number(maximum)])} aria-label={`Minimum for rule ${index + 1}`} />
        <i>to</i>
        <input type="number" value={Number(maximum)} onChange={(event) => onChange([Number(minimum), Number(event.target.value)])} aria-label={`Maximum for rule ${index + 1}`} />
      </span>
    )
  }
  if (['progress', 'rating', 'durationMinutes'].includes(condition.field)
    || ['within-next-days', 'within-last-days', 'older-than-days'].includes(condition.operator)) {
    return (
      <input
        className="smart-rule-value"
        type="number"
        min={condition.field === 'rating' ? 0 : undefined}
        max={condition.field === 'rating' ? 5 : condition.field === 'progress' ? 100 : undefined}
        value={Number(condition.value)}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={`Value for rule ${index + 1}`}
      />
    )
  }
  if (condition.operator === 'before' || condition.operator === 'after') {
    return (
      <input
        className="smart-rule-value"
        type="date"
        value={String(condition.value).slice(0, 10)}
        onChange={(event) => onChange(`${event.target.value}T00:00:00.000Z`)}
        aria-label={`Value for rule ${index + 1}`}
      />
    )
  }
  return (
    <input
      className="smart-rule-value"
      value={String(condition.value ?? '')}
      onChange={(event) => onChange(event.target.value)}
      list={condition.field === 'format' ? 'smart-list-format-suggestions' : undefined}
      placeholder={VALUE_PLACEHOLDERS[condition.field]}
      aria-label={`Value for rule ${index + 1}`}
    />
  )
}

function SmartListDanger({
  list,
  confirmDelete,
  onConfirmDelete,
  onArchive,
  onDelete,
}: {
  list: SavedSmartList
  confirmDelete: boolean
  onConfirmDelete: (value: boolean) => void
  onArchive: (list: SavedSmartList) => void
  onDelete: (list: SavedSmartList) => void
}) {
  return (
    <div className="custom-shelf-editor__danger smart-list-danger">
      <button type="button" onClick={() => onArchive(list)}>
        {list.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
        <span><strong>{list.archived ? 'Restore smart list' : 'Archive smart list'}</strong><small>{list.archived ? 'Return it to My Books' : 'Hide it without losing its rules'}</small></span>
      </button>
      <button className="remove-action" type="button" onClick={() => confirmDelete ? onDelete(list) : onConfirmDelete(true)}>
        <Trash2 aria-hidden="true" />
        <span><strong>{confirmDelete ? 'Tap again to delete list' : 'Delete smart list'}</strong><small>Deletes the saved rules only—not any books</small></span>
      </button>
    </div>
  )
}

function defaultOperator(field: SmartListRuleField): SmartListRuleOperator {
  if (['dateAdded', 'dateStarted', 'dateFinished', 'dateUpdated'].includes(field)) return 'older-than-days'
  if (field === 'loanDueAt') return 'within-next-days'
  return 'is'
}

function defaultValue(field: SmartListRuleField): unknown {
  if (field === 'status') return 'tbr'
  if (field === 'format') return 'ebook'
  if (['source', 'tag', 'author', 'series'].includes(field)) return ''
  if (field === 'rating') return 4
  if (field === 'durationMinutes') return 480
  if (field === 'progress') return 0
  if (field === 'ownership') return 'owned'
  if (field === 'availability') return 'available'
  if (field === 'loanDueAt') return 7
  return 30
}

function valueForOperator(
  field: SmartListRuleField,
  operator: SmartListRuleOperator,
  previous: unknown,
): unknown {
  if (operator === 'is-missing') return undefined
  if (operator === 'between') return [0, field === 'rating' ? 5 : field === 'durationMinutes' ? 480 : 100]
  if (operator === 'before' || operator === 'after') return new Date().toISOString()
  if (['within-next-days', 'within-last-days', 'older-than-days'].includes(operator)) return 30
  if (['progress', 'rating', 'durationMinutes'].includes(field) && typeof previous !== 'number') {
    return defaultValue(field)
  }
  if (['format', 'source', 'tag', 'author', 'series', 'status', 'ownership', 'availability'].includes(field)
    && typeof previous !== 'string') {
    return defaultValue(field)
  }
  return previous ?? defaultValue(field)
}

const FIELD_LABELS: Record<SmartListRuleField, string> = {
  status: 'Reading status', format: 'Format', source: 'Source', tag: 'Tag', author: 'Author',
  series: 'Series', dateAdded: 'Date added', dateStarted: 'Date started', dateFinished: 'Date finished',
  dateUpdated: 'Last updated', progress: 'Progress', rating: 'Rating', ownership: 'Ownership',
  loanDueAt: 'Loan due date', availability: 'Availability', durationMinutes: 'Audio duration',
}

const FIELD_GROUPS: readonly { readonly label: string; readonly fields: readonly SmartListRuleField[] }[] = [
  { label: 'Reading', fields: ['status', 'progress', 'rating'] },
  { label: 'Book', fields: ['format', 'author', 'series', 'tag', 'source', 'durationMinutes'] },
  { label: 'Dates', fields: ['dateAdded', 'dateStarted', 'dateFinished', 'dateUpdated'] },
  { label: 'Access', fields: ['ownership', 'loanDueAt', 'availability'] },
]

const OPERATOR_LABELS: Record<SmartListRuleOperator, string> = {
  is: 'is', 'is-not': 'is not', contains: 'contains', 'not-contains': 'does not contain',
  'at-least': 'at least', 'at-most': 'at most', 'greater-than': 'greater than',
  'less-than': 'less than', between: 'between', before: 'before', after: 'after',
  'within-next-days': 'within next days', 'within-last-days': 'within last days',
  'older-than-days': 'older than days', 'is-missing': 'is missing',
}

const VALUE_PLACEHOLDERS: Partial<Record<SmartListRuleField, string>> = {
  format: 'EPUB, audiobook…', source: 'Libby', tag: 'Short', author: 'Le Guin', series: 'Earthsea',
}

const SORT_OPTIONS: readonly [SmartListSortField, string][] = [
  ['title', 'Title'], ['author', 'Author'], ['date-added', 'Date added'], ['date-updated', 'Last updated'],
  ['progress', 'Progress'], ['rating', 'Rating'], ['loan-due', 'Loan due date'], ['duration', 'Duration'],
]

const GROUP_OPTIONS: readonly [SmartListGroupField, string][] = [
  ['none', 'No grouping'], ['status', 'Reading status'], ['format', 'Format'], ['author', 'Author'],
  ['series', 'Series'], ['source', 'Source'], ['ownership', 'Ownership'], ['availability', 'Availability'],
]
