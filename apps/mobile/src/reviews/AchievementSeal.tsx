import { achievementSymbols } from './achievement-art'

type SealBadge = { id: string; tier: number; personalBest: boolean }
/** Decorative only: the adjacent title, factual caption and best-record text own semantics. */
export function AchievementSeal({ badge }: { badge: SealBadge }) {
  const tier = Math.min(6, Math.max(1, Math.floor(badge.tier)))
  const symbol = achievementSymbols[badge.id]
  return <div className="review-seal" data-tier={tier} aria-hidden="true">
    <svg viewBox="0 0 128 128" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <circle cx="64" cy="64" r="56" />
      <circle cx="64" cy="64" r="52" strokeWidth=".65" />
      {tier >= 2 && <circle cx="64" cy="64" r="48" strokeWidth=".65" />}
      {tier >= 3 && <g strokeWidth=".7">{Array.from({ length: 48 }, (_, i) => <path key={i} transform={`rotate(${i * 7.5} 64 64)`} d="M64 9V12" />)}</g>}
      {tier >= 4 && <g strokeWidth="1">{[-1, 1].map(side => <g key={side} transform={side === -1 ? 'translate(128 0) scale(-1 1)' : undefined}>
        <path d="M35 96Q16 79 24 49" />
        {[0, 1, 2, 3].map(i => <path key={i} transform={`rotate(${i * 15} 64 64)`} d="M24 54Q15 48 20 43Q27 47 24 54M24 54Q25 44 32 44Q33 51 24 54" />)}
      </g>)}</g>}
      {tier >= 5 && <path d="M52 20L55 15L58 20L55 25ZM70 20L73 15L76 20L73 25Z" strokeWidth=".8" />}
      {tier >= 6 && <path d="M57 26L55 15L61 20L64 12L67 20L73 15L71 26ZM59 29H69" />}
      <g transform="translate(32 29)" strokeWidth="1.65"><path d={symbol?.path ?? 'M12 16H52V48H12ZM20 24H44M20 32H44M20 40H35'} /></g>
      <g fill="currentColor" stroke="none">{Array.from({ length: tier }, (_, i) => <circle key={i} cx={64 + (i - (tier - 1) / 2) * 6} cy="100" r="1.3" />)}</g>
      {badge.personalBest && <g><circle cx="104" cy="101" r="13" fill="var(--surface-page, #f4f0e6)" /><path d="M104 91L106.5 98.5L114 101L106.5 103.5L104 111L101.5 103.5L94 101L101.5 98.5Z" /><circle cx="104" cy="101" r="2" /></g>}
    </svg>
  </div>
}
