import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib'

export async function createPdf(options: { title?: string; pages?: number; encrypted?: boolean; variant?: string } = {}) {
  const pdf = await PDFDocument.create()
  if (options.title !== '') pdf.setTitle(options.title ?? 'The Quiet Page')
  pdf.setAuthor('Wovenleaf Test Library')
  pdf.setLanguage('en')
  const serif = await pdf.embedFont(StandardFonts.TimesRoman)
  for (let index = 0; index < (options.pages ?? 4); index++) {
    const page = pdf.addPage([420, 595])
    page.drawRectangle({ x: 0, y: 0, width: 420, height: 595, color: rgb(0.99, 0.98, 0.95) })
    page.drawText(options.title || 'The Quiet Page', { x: 36, y: 510, size: 28, font: serif })
    page.drawText(`Chapter ${index + 1}`, { x: 36, y: 459, size: 18, font: serif })
    for (let line = 0; line < 11; line++) {
      page.drawText(line % 2 === 0 ? 'A quiet place to read, with room to think.' : 'Every page keeps its shape and its place.', { x: 36, y: 412 - line * 23, size: 14, font: serif })
    }
    page.drawText(`${index + 1} / ${options.pages ?? 4} ${options.variant ?? ''}`, { x: 180, y: 40, size: 12, font: serif })
  }
  if (options.encrypted) pdf.context.trailerInfo.Encrypt = pdf.context.register(pdf.context.obj({ Filter: PDFName.of('Standard') }))
  return pdf.save({ addDefaultPage: false })
}
