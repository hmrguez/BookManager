import { useCallback, useId, useRef, useState } from 'react'
import { BookOpen, Check, ChevronDown, Headphones, Library } from 'lucide-react'
import { AnchoredMenu } from '../design-system/AnchoredMenu'

const sources = [
  { value: 'ebook', label: 'E-reader', detail: 'EPUB or PDF', icon: BookOpen },
  { value: 'audio', label: 'Audiobook', detail: 'M4B or MP3', icon: Headphones },
  { value: 'libby', label: 'Libby', detail: 'Connect a library loan', icon: Library },
]

export function SourcePicker({ value, onChange, disabled, includeLibby }: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled: boolean
  readonly includeLibby: boolean
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [initialFocus, setInitialFocus] = useState(0)
  const options = sources.filter(source => includeLibby || source.value !== 'libby')
  const selected = options.find(source => source.value === value) ?? sources[0]!
  const Icon = selected.icon
  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }, [])
  const show = (index: number) => { setInitialFocus(index); setOpen(true) }

  return <div className="source-picker">
    <button ref={trigger} type="button" className="source-picker__trigger" aria-label={`Attach to: ${selected.label}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => open ? close() : show(Math.max(0, options.findIndex(option => option.value === value)))}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          show(event.key === 'ArrowUp' ? options.length - 1 : 0)
        }
      }}>
      <Icon size={18} aria-hidden="true" /><span>{selected.label}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <AnchoredMenu id={id} label="Reading source" triggerRef={trigger} initialFocus={initialFocus} followScroll onClose={close}>
      {options.map(({ value: key, label, detail, icon: OptionIcon }) => <button key={key} type="button" role="menuitemradio" tabIndex={-1}
        aria-checked={value === key} onClick={() => { close(); onChange(key) }}>
        <OptionIcon aria-hidden="true" /><span className="flex-1"><strong>{label}</strong><small>{detail}</small></span>
        {value === key && <Check aria-hidden="true" />}
      </button>)}
    </AnchoredMenu>}
  </div>
}
