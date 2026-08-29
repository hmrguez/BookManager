import JSZip from 'jszip'
import type { EpubCompatibilityProfile } from '../../../src/epub'

type CorpusResource = {
  readonly id: string
  readonly href: string
  readonly mediaType: string
  readonly content: string
  readonly properties?: string
  readonly fallback?: string
  readonly mediaOverlay?: string
  readonly spine?: boolean
  readonly spineProperties?: string
}

export type EpubCorpusCase = {
  readonly id: string
  readonly title: string
  readonly language: string
  readonly severity: 'normal' | 'high'
  readonly purpose: string
  readonly packageMetadata: string
  readonly pageProgressionDirection?: 'ltr' | 'rtl'
  readonly resources: readonly CorpusResource[]
  readonly expected: {
    readonly level: EpubCompatibilityProfile['support']['level']
    readonly layout: EpubCompatibilityProfile['layout']
    readonly direction: EpubCompatibilityProfile['pageProgressionDirection']
    readonly features?: Partial<EpubCompatibilityProfile['features']>
    readonly unsupportedSpineMediaTypes?: readonly string[]
  }
  readonly provenance: {
    readonly source: 'wovenleaf-authored'
    readonly license: 'CC0-1.0'
  }
}

const accessibleMetadata = `
  <meta property="schema:accessMode">textual</meta>
  <meta property="schema:accessibilityFeature">structuralNavigation</meta>
  <meta property="schema:accessibilityHazard">none</meta>
  <meta property="dcterms:conformsTo">EPUB Accessibility 1.1 - WCAG 2.2 Level AA</meta>`

export const EPUB_CORPUS_CASES: readonly EpubCorpusCase[] = [
  {
    id: 'semantic-structure',
    title: 'Semantic structure, math, SVG, and tables',
    language: 'en',
    severity: 'normal',
    purpose: 'Exercises headings, landmarks, footnotes, MathML, SVG alternatives, and complex table semantics.',
    packageMetadata: `${accessibleMetadata}
      <meta property="schema:accessMode">visual</meta>
      <meta property="schema:accessibilityFeature">MathML</meta>
      <meta property="schema:accessibilityFeature">alternativeText</meta>`,
    resources: [{
      id: 'chapter',
      href: 'chapter.xhtml',
      mediaType: 'application/xhtml+xml',
      spine: true,
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
          <body><main epub:type="bodymatter"><h1>Accessible chapter</h1>
            <p>Euler wrote <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>e</mi><mo>=</mo><mn>1</mn></math>.</p>
            <figure><svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A circle"><circle cx="10" cy="10" r="8" /></svg><figcaption>A circle.</figcaption></figure>
            <table><tr><th scope="col">Language</th><th scope="col">Direction</th></tr><tr><td>English</td><td>Left to right</td></tr></table>
            <a epub:type="noteref" href="#note">Read note</a><aside id="note" epub:type="footnote">A concise footnote.</aside>
          </main></body>
        </html>`,
    }],
    expected: {
      level: 'supported',
      layout: 'reflowable',
      direction: 'default',
      features: { semanticStructure: true, footnotes: true, mathml: true, svg: true, complexTables: true },
    },
    provenance: { source: 'wovenleaf-authored', license: 'CC0-1.0' },
  },
  {
    id: 'rtl-bidi',
    title: 'RTL progression with bidirectional text',
    language: 'ar',
    severity: 'high',
    purpose: 'Guards reading-order navigation and inline bidirectional isolation.',
    packageMetadata: accessibleMetadata,
    pageProgressionDirection: 'rtl',
    resources: [{
      id: 'chapter', href: 'rtl.xhtml', mediaType: 'application/xhtml+xml', spine: true,
      content: `<html xmlns="http://www.w3.org/1999/xhtml" lang="ar" dir="rtl"><body><main><h1>الفصل الأول</h1><p>النص <bdi dir="ltr">Wovenleaf 39</bdi> مستمر.</p></main></body></html>`,
    }],
    expected: { level: 'supported', layout: 'reflowable', direction: 'rtl', features: { bidirectionalText: true } },
    provenance: { source: 'wovenleaf-authored', license: 'CC0-1.0' },
  },
  {
    id: 'cjk-vertical-ruby',
    title: 'CJK vertical writing and ruby',
    language: 'ja',
    severity: 'high',
    purpose: 'Prevents appearance overrides from flattening vertical Japanese reading order or ruby annotations.',
    packageMetadata: accessibleMetadata,
    pageProgressionDirection: 'rtl',
    resources: [{
      id: 'chapter', href: 'vertical.xhtml', mediaType: 'application/xhtml+xml', spine: true,
      content: `<html xmlns="http://www.w3.org/1999/xhtml" lang="ja"><head><style>html { writing-mode: vertical-rl; }</style></head><body><main><h1><ruby>葉<rt>は</rt></ruby>の本</h1><p>縦書きの読書順序を確認します。</p></main></body></html>`,
    }],
    expected: { level: 'limited', layout: 'reflowable', direction: 'rtl', features: { verticalWriting: true, ruby: true } },
    provenance: { source: 'wovenleaf-authored', license: 'CC0-1.0' },
  },
  {
    id: 'fixed-layout',
    title: 'Fixed-layout spread',
    language: 'en',
    severity: 'high',
    purpose: 'Ensures fixed pages stay paginated and never expose ineffective reflow controls.',
    packageMetadata: `${accessibleMetadata}<meta property="rendition:layout">pre-paginated</meta>`,
    resources: [{
      id: 'page', href: 'page.xhtml', mediaType: 'application/xhtml+xml', spine: true,
      content: `<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="viewport" content="width=1200,height=1600" /></head><body><main><h1>Fixed page</h1></main></body></html>`,
    }],
    expected: { level: 'limited', layout: 'fixed-layout', direction: 'default' },
    provenance: { source: 'wovenleaf-authored', license: 'CC0-1.0' },
  },
  {
    id: 'media-overlay',
    title: 'Discoverable media overlay',
    language: 'en',
    severity: 'high',
    purpose: 'Detects synchronized narration without hiding the readable text fallback.',
    packageMetadata: `${accessibleMetadata}<meta property="schema:accessMode">auditory</meta>`,
    resources: [
      {
        id: 'chapter', href: 'chapter.xhtml', mediaType: 'application/xhtml+xml', mediaOverlay: 'overlay', spine: true,
        content: `<html xmlns="http://www.w3.org/1999/xhtml"><body><main><h1 id="heading">Narrated text</h1><p id="line">The visible text remains readable.</p></main></body></html>`,
      },
      {
        id: 'overlay', href: 'overlay.smil', mediaType: 'application/smil+xml',
        content: `<smil xmlns="http://www.w3.org/ns/SMIL"><body><seq><par><text src="chapter.xhtml#line" /><audio src="voice.mp3" clipBegin="0s" clipEnd="1s" /></par></seq></body></smil>`,
      },
    ],
    expected: { level: 'limited', layout: 'reflowable', direction: 'default', features: { mediaOverlays: true } },
    provenance: { source: 'wovenleaf-authored', license: 'CC0-1.0' },
  },
  {
    id: 'scripted-content',
    title: 'Scripted interaction with readable fallback',
    language: 'en',
    severity: 'high',
    purpose: 'Detects unsupported scripted interaction while preserving ordinary text and images.',
    packageMetadata: accessibleMetadata,
    resources: [{
      id: 'chapter', href: 'scripted.xhtml', mediaType: 'application/xhtml+xml', properties: 'scripted', spine: true,
      content: `<html xmlns="http://www.w3.org/1999/xhtml"><body><main><h1>Safe fallback</h1><p id="answer">The answer is present without scripting.</p><script>document.querySelector('#answer').textContent = 'changed'</script></main></body></html>`,
    }],
    expected: { level: 'limited', layout: 'reflowable', direction: 'default', features: { scriptedContent: true } },
    provenance: { source: 'wovenleaf-authored', license: 'CC0-1.0' },
  },
  {
    id: 'foreign-spine-without-fallback',
    title: 'Unsupported foreign spine',
    language: 'en',
    severity: 'high',
    purpose: 'Regression fixture for blank readers caused by a foreign spine resource without a fallback.',
    packageMetadata: accessibleMetadata,
    resources: [{
      id: 'foreign', href: 'chapter.custom', mediaType: 'application/vnd.wovenleaf.unsupported', spine: true,
      content: 'This resource intentionally has no EPUB content-document fallback.',
    }],
    expected: {
      level: 'unsupported', layout: 'reflowable', direction: 'default',
      unsupportedSpineMediaTypes: ['application/vnd.wovenleaf.unsupported'],
    },
    provenance: { source: 'wovenleaf-authored', license: 'CC0-1.0' },
  },
  {
    id: 'auditory-only',
    title: 'Auditory-only publication',
    language: 'en',
    severity: 'high',
    purpose: 'Prevents an auditory-only edition from being presented as supported without media-overlay playback.',
    packageMetadata: `
      <meta property="schema:accessMode">auditory</meta>
      <meta property="schema:accessibilityFeature">synchronizedAudioText</meta>
      <meta property="schema:accessibilityHazard">none</meta>`,
    resources: [
      {
        id: 'chapter', href: 'chapter.xhtml', mediaType: 'application/xhtml+xml', mediaOverlay: 'overlay', spine: true,
        content: `<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="cue">Audio cue only.</p></body></html>`,
      },
      {
        id: 'overlay', href: 'overlay.smil', mediaType: 'application/smil+xml',
        content: `<smil xmlns="http://www.w3.org/ns/SMIL"><body><seq><par><text src="chapter.xhtml#cue" /><audio src="voice.mp3" /></par></seq></body></smil>`,
      },
    ],
    expected: { level: 'unsupported', layout: 'reflowable', direction: 'default', features: { mediaOverlays: true } },
    provenance: { source: 'wovenleaf-authored', license: 'CC0-1.0' },
  },
] as const

export async function createCorpusEpub(fixture: EpubCorpusCase): Promise<Uint8Array> {
  const archive = new JSZip()
  archive.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  archive.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml" /></rootfiles>
    </container>`)
  archive.file('OPS/package.opf', `<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" prefix="schema: https://schema.org/ dcterms: http://purl.org/dc/terms/ rendition: http://www.idpf.org/vocab/rendition/#" version="3.0" unique-identifier="book-id">
      <metadata>
        <dc:identifier id="book-id">urn:wovenleaf:corpus:${fixture.id}</dc:identifier>
        <dc:title>${fixture.title}</dc:title>
        <dc:creator>Wovenleaf test corpus</dc:creator>
        <dc:language>${fixture.language}</dc:language>
        ${fixture.packageMetadata}
      </metadata>
      <manifest>${fixture.resources.map((resource) => `<item id="${resource.id}" href="${resource.href}" media-type="${resource.mediaType}"${resource.properties ? ` properties="${resource.properties}"` : ''}${resource.fallback ? ` fallback="${resource.fallback}"` : ''}${resource.mediaOverlay ? ` media-overlay="${resource.mediaOverlay}"` : ''} />`).join('')}</manifest>
      <spine${fixture.pageProgressionDirection ? ` page-progression-direction="${fixture.pageProgressionDirection}"` : ''}>${fixture.resources.filter(({ spine }) => spine).map((resource) => `<itemref idref="${resource.id}"${resource.spineProperties ? ` properties="${resource.spineProperties}"` : ''} />`).join('')}</spine>
    </package>`)
  for (const resource of fixture.resources) archive.file(`OPS/${resource.href}`, resource.content)
  return archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
