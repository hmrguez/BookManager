import { useCallback, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Languages } from 'lucide-react'
import { AnchoredMenu } from '../design-system/AnchoredMenu'
import { LANGUAGES, LANGUAGE_NAMES, getLanguagePreference, setLanguagePreference, t, useLanguage } from '../localization'
import { tw } from '../tailwind/styles'

export function LanguagePicker() {
  useLanguage()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [initialFocus, setInitialFocus] = useState(0)
  const preference = getLanguagePreference()
  const options = [
    { value: 'system' as const, label: t('System'), lang: undefined },
    ...LANGUAGES.map(language => ({ value: language, label: LANGUAGE_NAMES[language], lang: language })),
  ]
  const selected = options.find(option => option.value === preference)!
  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }, [])
  const show = (index: number) => { setInitialFocus(index); setOpen(true) }

  return <div className={tw('appearance-field') + ' language-picker'}>
    <span id={`${id}-label`}>{t('Language')}</span>
    <button ref={trigger} type="button" className="language-picker__trigger"
      aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? id : undefined}
      onClick={() => open ? close() : show(options.findIndex(option => option.value === preference))}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          show(event.key === 'ArrowUp' ? options.length - 1 : 0)
        }
      }}>
      <Languages size={18} aria-hidden="true" />
      <span id={`${id}-value`} lang={selected.lang}>{selected.label}</span>
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <AnchoredMenu id={id} label={t('Language')} triggerRef={trigger} initialFocus={initialFocus} followScroll onClose={close}>
      {options.map(option => <button key={option.value} type="button" role="menuitemradio" tabIndex={-1}
        aria-checked={preference === option.value} onClick={() => { close(); setLanguagePreference(option.value) }}>
        <span className="flex-1"><strong lang={option.lang}>{option.label}</strong></span>
        {preference === option.value && <Check aria-hidden="true" />}
      </button>)}
    </AnchoredMenu>}
  </div>
}
