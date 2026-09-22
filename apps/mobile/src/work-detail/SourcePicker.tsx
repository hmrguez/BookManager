import { useEffect, useId, useRef, useState } from 'react'
import { BookOpen, Check, ChevronDown, Headphones, Library } from 'lucide-react'

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
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const options = sources.filter(source => includeLibby || source.value !== 'libby')
  const selected = options.find(source => source.value === value) ?? sources[0]!
  const Icon = selected.icon
  const focusOption = (index: number) => root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[index]?.focus()

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  return <div className="source-picker" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
  }}>
    <button ref={trigger} type="button" className="source-picker__trigger" aria-label={`Attach to: ${selected.label}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={() => {
        setOpen(current => !current)
        if (!open) requestAnimationFrame(() => focusOption(Math.max(0, options.findIndex(option => option.value === value))))
      }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setOpen(true)
          requestAnimationFrame(() => focusOption(event.key === 'ArrowUp' ? options.length - 1 : 0))
        }
      }}>
      <Icon size={18} aria-hidden="true" /><span>{selected.label}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div id={id} className="source-picker__menu" role="menu" aria-label="Reading source" onKeyDown={event => {
      const index = Array.from(event.currentTarget.querySelectorAll('button')).indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'ArrowDown' ? (index + 1) % options.length : event.key === 'ArrowUp' ? (index - 1 + options.length) % options.length : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : undefined
      if (next !== undefined) { event.preventDefault(); focusOption(next) }
    }}>
      {options.map(({ value: key, label, detail, icon: OptionIcon }) => <button key={key} type="button" role="menuitemradio"
        aria-checked={value === key} onClick={() => { onChange(key); setOpen(false); trigger.current?.focus() }}>
        <OptionIcon size={18} aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span>
        {value === key && <Check size={16} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>
}
