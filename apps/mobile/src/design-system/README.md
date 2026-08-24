# Pulp design system

Pulp is the visual foundation for Wovenleaf. It takes its cues from e-ink readers and
well-made paperback books: warm paper, carbon-black type, one bookmark-red accent, compact
interface copy, and generous reading space.

The app's main page is a live specimen. Run `bun run dev` to see every token and component in
warm, white, and night paper modes.

## Files

- `tokens.css` contains raw palette values, semantic color aliases, typography, spacing,
  shape, elevation, and motion.
- `components.tsx` contains the reusable React components.
- `components.css` contains component styles. Components only consume semantic tokens.
- `index.ts` is the public component barrel.

## Setup

Import the bundled, Latin-subset fonts and global design-system tokens once at the app entry point:

```tsx
import './design-system/fonts.css'
import './index.css'
```

`src/index.css` imports `tokens.css`. Feature code can then import primitives from the barrel:

```tsx
import {
  Badge,
  BookRow,
  Button,
  IconButton,
  ReadingProgress,
  SegmentedControl,
  TextField,
  Toggle,
} from './design-system'
```

## Paper modes

Set `data-paper-mode` on the root element. `warm` is the default token set.

```ts
document.documentElement.dataset.paperMode = 'night'
```

Available values:

| Mode | Intended use |
| --- | --- |
| `warm` | Default library and long daytime reading |
| `white` | Higher-contrast neutral screens |
| `night` | Low-light reading without pure black or pure white |

Always consume semantic tokens such as `--surface-page`, `--text-primary`, and
`--action-accent`. Raw tokens such as `--paper-50` are palette ingredients, not component
contracts.

## Components

### Button

```tsx
<Button variant="ink" icon={Plus}>Add title</Button>
<Button variant="outline">Save note</Button>
<Button variant="quiet" size="small">Cancel</Button>
```

Variants are `ink`, `outline`, and `quiet`. Sizes are `regular` and `small`. Native button
attributes are forwarded.

### IconButton and Badge

```tsx
<IconButton
  icon={Bookmark}
  label="Add bookmark"
  selected={bookmarked}
/>
<Badge tone="accent">Reading</Badge>
```

`label` is required on icon-only buttons. Badge tones are `neutral`, `accent`, and `inverse`.

### TextField

```tsx
<TextField
  label="Find a book"
  hint="Title, author, or ISBN"
  icon={Search}
  placeholder="The Dispossessed"
/>
```

The component generates a stable accessible id when one is not supplied and forwards native
input attributes.

### Toggle and SegmentedControl

```tsx
<Toggle
  checked={rules}
  label="Reading rules"
  description="Guide the eye across long passages"
  onChange={setRules}
/>

<SegmentedControl
  label="Content density"
  options={['Compact', 'Comfortable', 'Spacious'] as const}
  value={density}
  onChange={setDensity}
/>
```

### ReadingProgress and BookRow

```tsx
<ReadingProgress label="Chapter four" value={63} />

<BookRow
  mark="LH"
  title="The Left Hand of Darkness"
  author="Ursula K. Le Guin"
  meta="Page 206 of 304"
  coverTone="clay"
/>
```

Progress values are clamped between 0 and 100. Book cover tones are `charcoal`, `clay`, and
`moss`; `trailing` accepts any React node.

## Design rules

1. Use Literata for reading copy, book titles, and expressive headings. Use IBM Plex Sans for
   controls, metadata, and short instructions.
2. Prefer whitespace and a single hairline before adding a container or shadow.
3. Reserve bookmark red for current state, progress, and one high-value accent per region.
4. Keep controls at least 44px on touch surfaces. The small button is for compact compositions,
   not the primary mobile action.
5. Treat movement like a page turn: short, deliberate, and optional. Reduced-motion preferences
   are honored by the token layer.
