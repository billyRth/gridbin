import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { BinMesh } from '@/lib/gridfinity'

// Browsers without OffscreenCanvas (older Safari) render on the main thread instead.
const Legacy = lazy(() => import('./BinViewerLegacy'))

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const colors = () => ({ brand: css('--brand'), plate: css('--plate'), ridge: css('--plate-ridge') })

export default function BinViewer({ mesh }: { mesh: BinMesh | null }) {
  const host = useRef<HTMLDivElement>(null)
  const worker = useRef<Worker | null>(null)
  const [mode] = useState(() =>
    typeof HTMLCanvasElement !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype ? 'offscreen' : 'legacy')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (mode !== 'offscreen') return
    // Fresh canvas per mount: a canvas can only be transferred once (StrictMode remounts in dev).
    const el = host.current!, cv = document.createElement('canvas')
    cv.tabIndex = 0
    cv.setAttribute('aria-label', '3D bin preview. Drag or use arrow keys to rotate, scroll or +/- to zoom.')
    cv.className = 'block h-full w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]'
    el.prepend(cv)
    const w = new Worker(new URL('../lib/render.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e) => e.data?.type === 'failed' && setFailed(true)
    const off = cv.transferControlToOffscreen()
    const r = el.getBoundingClientRect()
    w.postMessage({ type: 'init', canvas: off, w: r.width || 1, h: r.height || 1, dpr: devicePixelRatio, colors: colors() }, [off])

    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      if (width && height) w.postMessage({ type: 'resize', w: width, h: height })
    })
    ro.observe(el)

    // Drag to orbit, wheel / pinch to zoom, arrow keys and +/- for keyboard users.
    const pts = new Map<number, { x: number; y: number }>()
    let pinch = 0
    const down = (e: PointerEvent) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }) }
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId)
      if (!p) return
      if (pts.size === 1) w.postMessage({ type: 'orbit', dx: e.clientX - p.x, dy: e.clientY - p.y })
      p.x = e.clientX; p.y = e.clientY
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch) w.postMessage({ type: 'zoom', factor: pinch / d })
        pinch = d
      }
    }
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0 }
    const wheel = (e: WheelEvent) => { e.preventDefault(); w.postMessage({ type: 'zoom', factor: Math.exp(e.deltaY * 0.001) }) }
    const key = (e: KeyboardEvent) => {
      const k: Record<string, object> = {
        ArrowLeft: { type: 'orbit', dx: -20, dy: 0 }, ArrowRight: { type: 'orbit', dx: 20, dy: 0 },
        ArrowUp: { type: 'orbit', dx: 0, dy: -20 }, ArrowDown: { type: 'orbit', dx: 0, dy: 20 },
        '+': { type: 'zoom', factor: 0.9 }, '=': { type: 'zoom', factor: 0.9 }, '-': { type: 'zoom', factor: 1.1 },
      }
      if (k[e.key]) { e.preventDefault(); w.postMessage(k[e.key]) }
    }
    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)
    cv.addEventListener('wheel', wheel, { passive: false })
    cv.addEventListener('keydown', key)

    const scheme = matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => w.postMessage({ type: 'colors', colors: colors() })
    scheme.addEventListener('change', onScheme)
    const onVis = () => w.postMessage({ type: 'visible', on: !document.hidden })
    document.addEventListener('visibilitychange', onVis)

    return () => {
      ro.disconnect()
      scheme.removeEventListener('change', onScheme)
      document.removeEventListener('visibilitychange', onVis)
      w.terminate()
      cv.remove()
      worker.current = null
    }
  }, [mode])

  useEffect(() => {
    // Copy: the STL export still needs the originals on this thread.
    if (mesh && worker.current)
      worker.current.postMessage({ type: 'mesh', mesh: { ...mesh, positions: mesh.positions.slice(), indices: mesh.indices.slice() } })
  }, [mesh])

  if (mode === 'legacy')
    return (
      <Suspense fallback={<div className="fallback">Loading the 3D preview...</div>}>
        <Legacy mesh={mesh} />
      </Suspense>
    )

  return (
    <div ref={host} className="absolute inset-0">
      {failed ? (
        <div className="fallback">WebGL is off in this browser, so the 3D preview is unavailable. Your settings and the STL download still work.</div>
      ) : !mesh ? (
        <div className="fallback">Building your bin...</div>
      ) : null}
    </div>
  )
}
