const MAX_SOURCE_BYTES = 25 * 1024 * 1024
const MAX_COVER_EDGE = 1_400
const COMPACT_COVER_EDGE = 900
const MAX_ENCODED_LENGTH = 2_500_000

export class ManualCoverError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManualCoverError'
  }
}

export async function prepareManualCover(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new ManualCoverError('Choose an image from Photos, Camera, or Files.')
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ManualCoverError('That image is too large. Choose one under 25 MB.')
  }

  const image = await loadImage(file)
  try {
    const firstPass = encodeCover(image, MAX_COVER_EDGE, 0.86)
    return firstPass.length <= MAX_ENCODED_LENGTH
      ? firstPass
      : encodeCover(image, COMPACT_COVER_EDGE, 0.78)
  } finally {
    URL.revokeObjectURL(image.src)
  }
}

export function fitCoverDimensions(
  width: number,
  height: number,
  maximumEdge: number,
): { readonly width: number; readonly height: number } {
  const scale = Math.min(1, maximumEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => {
      URL.revokeObjectURL(image.src)
      reject(new ManualCoverError('Wovenleaf could not read that image. Try another one.'))
    }
    image.src = URL.createObjectURL(file)
  })
}

function encodeCover(image: HTMLImageElement, maximumEdge: number, quality: number): string {
  const dimensions = fitCoverDimensions(image.naturalWidth, image.naturalHeight, maximumEdge)
  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext('2d')
  if (!context) throw new ManualCoverError('Wovenleaf could not prepare that cover image.')

  context.fillStyle = '#f5f1e8'
  context.fillRect(0, 0, dimensions.width, dimensions.height)
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
  try {
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    throw new ManualCoverError('Wovenleaf could not save that cover image.')
  }
}
