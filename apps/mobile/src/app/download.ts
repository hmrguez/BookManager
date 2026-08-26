export function downloadTextFile(contents: string, filename: string, mediaType: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mediaType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
