import { translateAt } from '../localization'
import { renderToStaticMarkup } from 'react-dom/server'
import { AchievementSeal } from './AchievementSeal'
import type { SnapshotContent } from './snapshot'

const paper = '#faf9f3', ink = '#272923'
export class SnapshotRenderError extends Error {
  readonly reason: 'artwork' | 'overflow' | 'render'
  constructor(reason: 'artwork' | 'overflow' | 'render') { super(reason); this.reason = reason }
}
async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const timer = setTimeout(() => reject(new SnapshotRenderError('render')), 10000)
    image.onload = () => { clearTimeout(timer); resolve(image) }
    image.onerror = () => { clearTimeout(timer); reject(new SnapshotRenderError('render')) }
    image.src = url
  })
}
/** Pixel-measured wrapping. Even unbroken words wrap; export never clips a factual caption. */
export function wrapSnapshotText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = []; let line = ''
  for (const word of text.split(/\s+/)) {
    if (line && measure(`${line} ${word}`) <= width) { line += ` ${word}`; continue }
    if (line) { lines.push(line); line = '' }
    for (const character of Array.from(word)) {
      if (line && measure(line + character) > width) { lines.push(line); line = '' }
      line += character
    }
  }
  if (line) lines.push(line)
  return lines
}
export async function renderSnapshot(content: SnapshotContent): Promise<string> {
  await Promise.all([document.fonts.load('500 64px "Literata Variable"'), document.fonts.load('400 28px "IBM Plex Sans Variable"')])
  const canvas = document.createElement('canvas'); canvas.width = content.width; canvas.height = content.height
  const context = canvas.getContext('2d')
  if (!context) throw new SnapshotRenderError('render')
  const ctx = context
  const story = content.height === 1920, margin = 80, inner = 920
  const font = (size: number, serif = false) => { ctx.font = `${serif ? 500 : 400} ${size}px "${serif ? 'Literata' : 'IBM Plex Sans'} Variable"` }
  const lines = (text: string, width: number, size: number, serif = false) => { font(size, serif); return wrapSnapshotText(text, width, text => ctx.measureText(text).width) }
  const title = lines(content.title, inner, story ? 76 : 64, true)
  const column = (inner - Math.max(0, content.badges.length - 1) * 34) / Math.max(1, content.badges.length)
  const badges = content.badges.map(b => ({ ...b, titles: lines(b.title, story ? 760 : column, story ? 36 : 30, true),
    captions: lines(b.caption, story ? 760 : column, story ? 30 : 26),
    best: b.personalBest ? lines(translateAt('Your best recorded quarter', content.language), story ? 760 : column, 24) : [] }))
  const badgeHeight = (b: typeof badges[number]) => b.titles.length * (story ? 46 : 39) + b.captions.length * (story ? 40 : 35) + b.best.length * 32 + 20
  const badgeArea = badges.length ? (story ? badges.reduce((n, b) => n + Math.max(120, badgeHeight(b)) + 36, 0) : Math.max(...badges.map(badgeHeight)) + 124) + 38 : 0
  const titleY = story ? 230 : 180, titleHeight = title.length * (story ? 96 : 82)
  const artTop = titleY + titleHeight + 16, footerY = content.height - margin
  const bottomBadgeY = footerY - 65 - badgeArea
  const badgeY = content.artwork ? bottomBadgeY : artTop + (bottomBadgeY - artTop) / 2
  const artHeight = badgeY - artTop - 30
  if (badgeY < artTop || content.artwork && artHeight < 100) throw new SnapshotRenderError('overflow')
  let art: HTMLImageElement | null = null
  if (content.artwork) {
    // Saved references are private input, never permission to fetch arbitrary remote/file URLs.
    if (!/^\/reviews\/[a-zA-Z0-9/_-]+\.png$/.test(content.artwork)) throw new SnapshotRenderError('artwork')
    try { art = await loadImage(content.artwork) } catch { throw new SnapshotRenderError('artwork') }
  }
  const seals = await Promise.all(badges.map(async b => {
    const markup = renderToStaticMarkup(<AchievementSeal badge={b} />)
    const svg = markup.slice(markup.indexOf('<svg'), markup.indexOf('</svg>') + 6)
      .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" ')
      .replaceAll('currentColor', ink).replaceAll('var(--surface-page, #f4f0e6)', paper)
    return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  }))
  ctx.fillStyle = paper; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = ink; ctx.textBaseline = 'top'
  function draw(rows: string[], x: number, y: number, size: number, leading: number, serif = false, center = false) {
    font(size, serif); ctx.textAlign = center ? 'center' : 'left'
    for (const row of rows) { ctx.fillText(row, x, y); y += leading }
    return y
  }
  draw([translateAt('A SEASON AMONG PAGES', content.language)], margin, story ? 110 : 80, 22, 30)
  draw([content.period], margin, story ? 153 : 121, 28, 38)
  draw(title, 540, titleY, story ? 76 : 64, story ? 96 : 82, true, true)
  if (art) {
    const ratio = Math.min((story ? 900 : 720) / art.width, artHeight / art.height)
    const w = art.width * ratio, h = art.height * ratio
    // Ink masks preserve the accepted composition while taking the print's ink colour.
    const mask = document.createElement('canvas'); mask.width = art.width; mask.height = art.height
    const m = mask.getContext('2d'); if (!m) throw new SnapshotRenderError('render')
    m.drawImage(art, 0, 0)
    if (content.artwork?.startsWith('/reviews/ink-v1/')) {
      m.globalCompositeOperation = 'source-in'; m.fillStyle = ink; m.fillRect(0, 0, mask.width, mask.height)
    }
    ctx.drawImage(mask, (1080 - w) / 2, artTop + (artHeight - h) / 2, w, h)
  }
  if (badges.length) {
    ctx.strokeStyle = '#b5b6a9'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(margin, badgeY); ctx.lineTo(1000, badgeY); ctx.stroke()
    let y = badgeY + 30
    badges.forEach((b, i) => {
      const x = story ? margin : margin + i * (column + 34), textX = story ? x + 160 : x + column / 2
      ctx.drawImage(seals[i]!, story ? x : textX - 46, y, story ? 112 : 92, story ? 112 : 92)
      let textY = draw(b.titles, textX, story ? y : y + 108, story ? 36 : 30, story ? 46 : 39, true, !story)
      textY = draw(b.captions, textX, textY + 10, story ? 30 : 26, story ? 40 : 35, false, !story)
      draw(b.best, textX, textY + 10, 24, 32, false, !story)
      if (story) y += Math.max(120, badgeHeight(b)) + 36
    })
  }
  draw(['WOVENLEAF'], margin, footerY, 20, 28)
  font(20); ctx.textAlign = 'right'; ctx.fillText(content.quarter, 1000, footerY)
  const url = canvas.toDataURL('image/png')
  if (!url.startsWith('data:image/png;base64,')) throw new SnapshotRenderError('render')
  return url
}
