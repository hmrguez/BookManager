import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SAMPLE_RATE = 44_100
const OUTPUT_DIRECTORY = fileURLToPath(new URL('../public/feedback/', import.meta.url))

type SoundRecipe = {
  readonly filename: string
  readonly description: string
  readonly durationSeconds: number
  readonly peak: number
  readonly render: (samples: Float64Array) => void
}

const recipes: readonly SoundRecipe[] = [
  {
    filename: 'graphite-tick.wav',
    description: 'A short graphite contact for one discrete selection.',
    durationSeconds: 0.085,
    peak: 0.12,
    render(samples) {
      addBandNoise(samples, 0, 0.075, 0x71a9, 1_200, 8_200, 0.75, fastEnvelope)
      addDampedTone(samples, 0.004, 1_680, 0.035, 0.12)
    },
  },
  {
    filename: 'paper-slide.wav',
    description: 'A restrained paper slip and landing for ordinary successful moves.',
    durationSeconds: 0.24,
    peak: 0.14,
    render(samples) {
      addBandNoise(samples, 0.008, 0.19, 0x52d1, 360, 5_800, 0.7, paperEnvelope, 13)
      addBandNoise(samples, 0.12, 0.1, 0xa114, 160, 1_900, 0.28, fastEnvelope)
      addDampedTone(samples, 0.17, 185, 0.06, 0.16)
    },
  },
  {
    filename: 'paper-edge.wav',
    description: 'A pencil meeting a dry page edge without an alarm-like pitch.',
    durationSeconds: 0.14,
    peak: 0.15,
    render(samples) {
      addBandNoise(samples, 0, 0.085, 0xbe21, 700, 5_200, 0.5, fastEnvelope)
      addDampedTone(samples, 0.012, 310, 0.085, 0.22)
      addDampedTone(samples, 0.014, 970, 0.045, 0.09)
    },
  },
  {
    filename: 'page-settle.wav',
    description: 'One quiet page turn followed by a soft paper landing.',
    durationSeconds: 0.46,
    peak: 0.16,
    render(samples) {
      addSweptPaperNoise(samples, 0.015, 0.36, 0x319f, 0.72)
      addBandNoise(samples, 0.3, 0.13, 0x7712, 150, 2_100, 0.24, fastEnvelope)
      addDampedTone(samples, 0.335, 145, 0.105, 0.18)
    },
  },
  {
    filename: 'soft-error.wav',
    description: 'Two low dry paper taps for a failed user-requested operation.',
    durationSeconds: 0.25,
    peak: 0.15,
    render(samples) {
      addBandNoise(samples, 0.01, 0.07, 0x921b, 340, 3_200, 0.32, fastEnvelope)
      addDampedTone(samples, 0.018, 205, 0.065, 0.18)
      addBandNoise(samples, 0.13, 0.075, 0x448a, 300, 2_800, 0.27, fastEnvelope)
      addDampedTone(samples, 0.138, 176, 0.08, 0.2)
    },
  },
  {
    filename: 'shelf-transfer.wav',
    description: 'Eraser at 220 ms and pencil at 1180 ms, synchronized to the shelf-transfer motion grammar.',
    durationSeconds: 1.72,
    peak: 0.16,
    render(samples) {
      // Source focus 220 ms → erase 520 ms → settle 220 ms → destination focus 220 ms → write 520 ms.
      addEraser(samples, 0.22, 0.52, 0x1e45)
      addPencilStroke(samples, 1.18, 0.52, 0xc421)
      addDampedTone(samples, 1.655, 170, 0.06, 0.11)
    },
  },
]

await mkdir(OUTPUT_DIRECTORY, { recursive: true })
const manifest: Array<{
  filename: string
  description: string
  durationMs: number
  sampleRate: number
  channels: number
  bitDepth: number
  sha256: string
}> = []

for (const recipe of recipes) {
  const samples = new Float64Array(Math.round(recipe.durationSeconds * SAMPLE_RATE))
  recipe.render(samples)
  normalizeAndFade(samples, recipe.peak)
  const wav = encodeMonoWav(samples)
  await writeFile(`${OUTPUT_DIRECTORY}/${recipe.filename}`, wav)
  manifest.push({
    filename: recipe.filename,
    description: recipe.description,
    durationMs: Math.round(samples.length / SAMPLE_RATE * 1_000),
    sampleRate: SAMPLE_RATE,
    channels: 1,
    bitDepth: 16,
    sha256: createHash('sha256').update(wav).digest('hex'),
  })
}

await writeFile(
  `${OUTPUT_DIRECTORY}/manifest.json`,
  `${JSON.stringify({ generatedBy: 'scripts/generate-feedback-sounds.ts', sounds: manifest }, null, 2)}\n`,
)

function addEraser(target: Float64Array, start: number, duration: number, seed: number): void {
  const offset = Math.round(start * SAMPLE_RATE)
  const count = Math.round(duration * SAMPLE_RATE)
  const noise = bandNoise(count, seed, 160, 2_700)
  for (let index = 0; index < count && offset + index < target.length; index += 1) {
    const progress = index / Math.max(1, count - 1)
    const pressure = Math.sin(Math.PI * progress) ** 0.45
    const hand = 0.7 + 0.22 * Math.sin(progress * Math.PI * 9.5)
      + 0.08 * Math.sin(progress * Math.PI * 31)
    target[offset + index] += noise[index]! * pressure * hand * 0.78
  }
}

function addPencilStroke(target: Float64Array, start: number, duration: number, seed: number): void {
  const offset = Math.round(start * SAMPLE_RATE)
  const count = Math.round(duration * SAMPLE_RATE)
  const grain = bandNoise(count, seed, 950, 8_400)
  const body = bandNoise(count, seed ^ 0x9e37, 280, 2_400)
  for (let index = 0; index < count && offset + index < target.length; index += 1) {
    const progress = index / Math.max(1, count - 1)
    const pressure = Math.sin(Math.PI * progress) ** 0.35
    const hand = 0.78 + 0.14 * Math.sin(progress * Math.PI * 11)
      + 0.08 * Math.sin(progress * Math.PI * 37)
    target[offset + index] += (grain[index]! * 0.68 + body[index]! * 0.18) * pressure * hand
  }
}

function addSweptPaperNoise(
  target: Float64Array,
  start: number,
  duration: number,
  seed: number,
  amount: number,
): void {
  const offset = Math.round(start * SAMPLE_RATE)
  const count = Math.round(duration * SAMPLE_RATE)
  const low = bandNoise(count, seed, 190, 2_100)
  const high = bandNoise(count, seed ^ 0x45ad, 1_100, 7_200)
  for (let index = 0; index < count && offset + index < target.length; index += 1) {
    const progress = index / Math.max(1, count - 1)
    const envelope = Math.sin(Math.PI * progress) ** 0.55
    const sweep = smoothstep(progress)
    const flutter = 0.76 + 0.19 * Math.sin(progress * Math.PI * 7)
      + 0.05 * Math.sin(progress * Math.PI * 29)
    target[offset + index] += (
      low[index]! * (1 - sweep) * 0.62
      + high[index]! * (0.28 + sweep * 0.72)
    ) * envelope * flutter * amount
  }
}

function addBandNoise(
  target: Float64Array,
  start: number,
  duration: number,
  seed: number,
  lowCut: number,
  highCut: number,
  amount: number,
  envelope: (progress: number) => number,
  pulseHz = 0,
): void {
  const offset = Math.round(start * SAMPLE_RATE)
  const count = Math.round(duration * SAMPLE_RATE)
  const noise = bandNoise(count, seed, lowCut, highCut)
  for (let index = 0; index < count && offset + index < target.length; index += 1) {
    const progress = index / Math.max(1, count - 1)
    const pulse = pulseHz > 0
      ? 0.82 + 0.18 * Math.sin(index / SAMPLE_RATE * Math.PI * 2 * pulseHz)
      : 1
    target[offset + index] += noise[index]! * envelope(progress) * amount * pulse
  }
}

function addDampedTone(
  target: Float64Array,
  start: number,
  frequency: number,
  duration: number,
  amount: number,
): void {
  const offset = Math.round(start * SAMPLE_RATE)
  const count = Math.round(duration * SAMPLE_RATE)
  for (let index = 0; index < count && offset + index < target.length; index += 1) {
    const progress = index / Math.max(1, count - 1)
    const envelope = Math.exp(-progress * 7.5) * Math.sin(Math.PI * Math.min(1, progress * 10))
    target[offset + index] += Math.sin(index / SAMPLE_RATE * Math.PI * 2 * frequency) * envelope * amount
  }
}

function bandNoise(length: number, seed: number, lowCut: number, highCut: number): Float64Array {
  const random = mulberry32(seed)
  const result = new Float64Array(length)
  const highAlpha = 1 - Math.exp(-Math.PI * 2 * highCut / SAMPLE_RATE)
  const lowAlpha = 1 - Math.exp(-Math.PI * 2 * lowCut / SAMPLE_RATE)
  let highPassedBase = 0
  let lowPassed = 0
  for (let index = 0; index < length; index += 1) {
    const white = random() * 2 - 1
    highPassedBase += lowAlpha * (white - highPassedBase)
    const highPassed = white - highPassedBase
    lowPassed += highAlpha * (highPassed - lowPassed)
    result[index] = lowPassed
  }
  return result
}

function normalizeAndFade(samples: Float64Array, targetPeak: number): void {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  const gain = peak > 0 ? targetPeak / peak : 1
  const fadeSamples = Math.min(Math.round(SAMPLE_RATE * 0.008), Math.floor(samples.length / 2))
  for (let index = 0; index < samples.length; index += 1) {
    const fadeIn = Math.min(1, index / Math.max(1, fadeSamples))
    const fadeOut = Math.min(1, (samples.length - 1 - index) / Math.max(1, fadeSamples))
    samples[index] = Math.tanh(samples[index]! * gain) * fadeIn * fadeOut
  }
}

function encodeMonoWav(samples: Float64Array): Buffer {
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const output = Buffer.alloc(44 + dataSize)
  output.write('RIFF', 0)
  output.writeUInt32LE(36 + dataSize, 4)
  output.write('WAVE', 8)
  output.write('fmt ', 12)
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(1, 22)
  output.writeUInt32LE(SAMPLE_RATE, 24)
  output.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28)
  output.writeUInt16LE(bytesPerSample, 32)
  output.writeUInt16LE(16, 34)
  output.write('data', 36)
  output.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const bounded = Math.max(-1, Math.min(1, samples[index]!))
    output.writeInt16LE(Math.round(bounded * 32_767), 44 + index * bytesPerSample)
  }
  return output
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
  }
}

function fastEnvelope(progress: number): number {
  const attack = Math.min(1, progress / 0.08)
  return smoothstep(attack) * (1 - smoothstep(Math.max(0, (progress - 0.18) / 0.82)))
}

function paperEnvelope(progress: number): number {
  return Math.sin(Math.PI * progress) ** 0.7
}

function smoothstep(value: number): number {
  const bounded = Math.max(0, Math.min(1, value))
  return bounded * bounded * (3 - 2 * bounded)
}
