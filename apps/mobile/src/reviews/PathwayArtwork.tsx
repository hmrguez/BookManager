import { useEffect, useRef, useState } from 'react'
import type { ReviewArtwork } from './keepsake-model'

/** Only this mounted pathway owns decoded images. No cache retains inactive frame references. */
export function PathwayArtwork({ artwork, animate = false, paused = false }: { artwork: ReviewArtwork; animate?: boolean; paused?: boolean }) {
  const [source, setSource] = useState(artwork.finishedStill)
  const [failed, setFailed] = useState(false)
  const [replay, setReplay] = useState(0)
  const pausedRef = useRef(paused)
  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => {
    let disposed = false
    let request = 0
    const frames: HTMLImageElement[] = []
    if (animate && artwork.animation) {
      void (async () => {
        await Promise.all(Array.from({ length: 32 }, async (_, index) => {
          const frame = new Image()
          frames[index] = frame
          frame.src = `${artwork.animation}/${String(index).padStart(2, '0')}.webp`
          await frame.decode()
        }))
        if (disposed) return
        let elapsed = 0
        let previous = performance.now()
        const tick = (now: number) => {
          if (disposed) return
          if (!pausedRef.current && !document.hidden) elapsed += Math.min(now - previous, 100)
          previous = now
          setSource(frames[Math.min(31, Math.floor(elapsed / 2500 * 32))]!.src)
          if (elapsed < 2500) request = requestAnimationFrame(tick)
          else setSource(`${artwork.animation}/finished.png`)
        }
        request = requestAnimationFrame(tick)
      })().catch(() => {
        if (!disposed) setSource(artwork.finishedStill)
        frames.forEach(frame => { frame.src = '' })
        frames.length = 0
      })
    }
    return () => {
      disposed = true
      cancelAnimationFrame(request)
      frames.forEach(frame => { frame.src = '' })
      frames.length = 0
    }
  }, [artwork, animate, replay])
  return <div className="review-artwork">
    {failed ? <p>Illustration unavailable. Your pathway is saved.</p> : <img src={paused ? artwork.finishedStill : source} alt="" onError={() => {
      if (source !== artwork.finishedStill) setSource(artwork.finishedStill)
      else setFailed(true)
    }} />}
    {animate && artwork.animation && <button type="button" className="review-quiet" onClick={() => { setSource(artwork.finishedStill); setFailed(false); setReplay(n => n + 1) }}>Replay illustration</button>}
  </div>
}
