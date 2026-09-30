import { useEffect, useRef, useState } from 'react'
import { Download, Link2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Toaster } from '@/components/ui/sonner'
import { DEFAULT_PARAMS, HEIGHT_UNIT, outerHeight, toSTL, type BinMesh, type BinParams } from '@/lib/gridfinity'

import BinViewer from '@/components/BinViewer'

type NumKey = 'width' | 'depth' | 'height' | 'dividersX' | 'dividersY'
type BoolKey = 'labelTab' | 'magnets' | 'stackingLip'
const RANGES: Record<NumKey, [number, number]> = {
  width: [1, 6], depth: [1, 6], height: [2, 12], dividersX: [0, 5], dividersY: [0, 5],
}
// URL hash keys
const HASH: Record<keyof BinParams, string> = {
  width: 'w', depth: 'd', height: 'h', dividersX: 'dx', dividersY: 'dy', labelTab: 'tab', magnets: 'mag', stackingLip: 'lip',
}

function fromHash(): BinParams {
  const q = new URLSearchParams(location.hash.slice(1))
  const p = { ...DEFAULT_PARAMS }
  for (const k of Object.keys(RANGES) as NumKey[]) {
    const v = Number(q.get(HASH[k]))
    if (q.has(HASH[k]) && Number.isInteger(v)) p[k] = Math.min(RANGES[k][1], Math.max(RANGES[k][0], v))
  }
  for (const k of ['labelTab', 'magnets', 'stackingLip'] as BoolKey[]) {
    if (q.has(HASH[k])) p[k] = q.get(HASH[k]) === '1'
  }
  return p
}

function toHash(p: BinParams) {
  return new URLSearchParams(
    (Object.keys(HASH) as (keyof BinParams)[]).map((k) => [HASH[k], String(typeof p[k] === 'boolean' ? +p[k] : p[k])]),
  ).toString()
}

const fileName = (p: BinParams) =>
  `gridbin-${p.width}x${p.depth}x${p.height}-div${p.dividersX}x${p.dividersY}.stl`

// PLA 1.24 g/cm3, scaled for walls + ~15% infill. Rough on purpose.
const grams = (m: BinMesh) => Math.round((m.volume / 1000) * 1.24 * 0.35)

function useBinMesh(params: BinParams) {
  const [result, setResult] = useState<{ mesh: BinMesh; params: BinParams } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const worker = useRef<Worker | null>(null)
  const seq = useRef(0)
  const sent = useRef(new Map<number, BinParams>())

  useEffect(() => {
    const w = new Worker(new URL('./lib/bin.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; mesh?: BinMesh; error?: string }>) => {
      const { id, mesh, error } = e.data
      const p = sent.current.get(id)
      sent.current.delete(id)
      if (id !== seq.current || !p) return // stale
      if (mesh) {
        setResult({ mesh, params: p })
        setError(null)
      } else {
        setError(error ?? 'Unknown error')
      }
    }
    w.onerror = () => setError('The geometry engine failed to load.')
    worker.current = w
    return () => w.terminate()
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      const id = ++seq.current
      sent.current.set(id, params)
      worker.current?.postMessage({ id, params })
    }, 80)
    return () => clearTimeout(t)
  }, [params])

  return { result, error, building: result?.params !== params && !error }
}

function RangeField({ id, label, value, onChange, unit, suffix }: {
  id: NumKey; label: string; value: number; onChange: (v: number) => void; unit?: string; suffix?: string
}) {
  const [min, max] = RANGES[id]
  return (
    <div className="field">
      <div className="row">
        <Label id={`${id}-label`}>{label}</Label>
        <output className="mono">
          <b>{value}</b>{unit ? ` ${unit}` : ''}{suffix}
        </output>
      </div>
      <Slider
        label={label}
        min={min}
        max={max}
        step={1}
        value={value}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  )
}

function ToggleField({ label, hint, checked, onChange }: {
  label: string; hint: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <Label className="switch">
      <span>{label}<small>{hint}</small></span>
      <Switch checked={checked} onCheckedChange={onChange} className="data-[size=default]:h-[22px] data-[size=default]:w-[38px]" />
    </Label>
  )
}

export default function App() {
  // Start from defaults so the prerendered HTML hydrates cleanly, then apply the link's hash.
  const [params, setParams] = useState<BinParams>(DEFAULT_PARAMS)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setParams(fromHash())
    setMounted(true)
  }, [])
  const { result, error, building } = useBinMesh(params)
  const set = <K extends keyof BinParams>(k: K) => (v: BinParams[K]) => setParams((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    if (mounted) history.replaceState(null, '', `#${toHash(params)}`)
  }, [params, mounted])

  useEffect(() => {
    if (error) toast.error(`Could not build this bin. ${error}`)
  }, [error])

  const download = () => {
    if (!result) return
    const url = URL.createObjectURL(new Blob([toSTL(result.mesh)], { type: 'model/stl' }))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName(result.params)
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`Saved ${a.download}`)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      toast.success('Link copied. It opens this exact bin.')
    } catch {
      toast.error('Could not copy. The link is in your address bar.')
    }
  }

  const heightMm = outerHeight(params)
  const d = DEFAULT_PARAMS
  const mesh = result?.mesh

  return (
    <>
      <div className="wrap">
        <header className="nav">
          <a className="brand" href="#tool" aria-label="Gridbin home">
            <span className="mark" aria-hidden="true"><i /><i /><i /><i /></span>Gridbin
          </a>
          <nav aria-label="Primary">
            <a href="#gridfinity">What is Gridfinity</a>
            <a href="#printing">Print settings</a>
            <a href="#tool">Generator</a>
          </nav>
        </header>

        <main id="tool" className="tool">
          <div className="stage-col">
            <div className="intro">
              <h1>Make a Gridfinity bin that fits your stuff.</h1>
              <p>Set the size, split it up, preview it in 3D and download the STL. Free, in your browser, no account.</p>
            </div>
            <div className="stage" role="img" aria-label="3D preview of the bin. Drag to rotate, scroll to zoom.">
              {mounted && <BinViewer mesh={mesh ?? null} />}
              <span className="hint">{building && mesh ? 'Updating...' : 'Drag to rotate'}</span>
              <div className="readout mono" aria-live="polite">
                <span>Size <b>{mesh ? mesh.size.map((n) => n.toFixed(1)).join(' x ') : '...'} mm</b></span>
                <span>Compartments <b>{(params.dividersX + 1) * (params.dividersY + 1)}</b></span>
                <span>Filament <b>{mesh ? `≈ ${grams(mesh)} g PLA` : '...'}</b>, rough</span>
              </div>
            </div>
          </div>

          <form className="panel" onSubmit={(e) => e.preventDefault()} aria-label="Bin settings">
            <div className="group">
              <h2>Size in grid units</h2>
              <div className="pair">
                <RangeField id="width" label="Width" unit="u" value={params.width} onChange={set('width')} />
                <RangeField id="depth" label="Depth" unit="u" value={params.depth} onChange={set('depth')} />
              </div>
              <RangeField id="height" label="Height" unit="u" suffix={`, ${+heightMm.toFixed(1)} mm`} value={params.height} onChange={set('height')} />
            </div>

            <div className="group">
              <h2>Dividers</h2>
              <div className="pair">
                <RangeField id="dividersX" label="Across width" value={params.dividersX} onChange={set('dividersX')} />
                <RangeField id="dividersY" label="Across depth" value={params.dividersY} onChange={set('dividersY')} />
              </div>
            </div>

            <div className="group">
              <h2>Features</h2>
              <ToggleField label="Label tab" hint="Angled shelf for a printed or written label" checked={params.labelTab} onChange={set('labelTab')} />
              <ToggleField label="Magnet holes" hint="6 x 2 mm, four per cell on the base" checked={params.magnets} onChange={set('magnets')} />
              <ToggleField label="Stacking lip" hint="Lets another bin sit on top" checked={params.stackingLip} onChange={set('stackingLip')} />
            </div>

            <div className="actions">
              <Button className="btn-main" type="button" onClick={download} disabled={!result}>
                <Download className="size-4" aria-hidden="true" />Download STL
              </Button>
              <div className="sub">
                <Button className="btn-ghost" variant="outline" type="button" onClick={copyLink}>
                  <Link2 aria-hidden="true" />Copy link
                </Button>
                <Button className="btn-ghost" variant="outline" type="button" onClick={() => setParams(DEFAULT_PARAMS)}>
                  <RotateCcw aria-hidden="true" />Reset to {d.width} x {d.depth} x {d.height}
                </Button>
              </div>
            </div>

            <div className="ai">
              <div className="row"><label htmlFor="prompt">Describe it with AI</label><span className="tag">Coming soon</span></div>
              <textarea id="prompt" disabled placeholder="A bin for 6 screwdrivers and a tape measure" />
              <small>Type what goes in the drawer and get a bin laid out for it.</small>
            </div>
          </form>
        </main>
      </div>

      <section className="explain" id="gridfinity">
        <div className="wrap">
          <span className="eyebrow">Gridfinity, briefly</span>
          <h2>An open storage system built on one 42 mm square.</h2>
          <p className="lede">Zack Freedman released Gridfinity in 2022 as an open standard. Bins lock onto a printed baseplate, so a drawer can be rearranged without glue or dividers, and any bin from any generator fits.</p>
          <div className="specs">
            <div className="spec big">
              <div className="n">42<small>mm</small></div>
              <p>One grid unit. A 2 x 3 bin covers two by three squares on the baseplate. Bins are made 0.5 mm smaller so they drop in cleanly.</p>
            </div>
            <div className="spec">
              <div className="n">{HEIGHT_UNIT}<small>mm</small></div>
              <p>One height unit. A 6u bin is 42 mm tall before the stacking lip.</p>
            </div>
            <div className="spec">
              <div className="n">6 x 2<small>mm</small></div>
              <p>Optional disc magnets that hold bins to a magnetic baseplate.</p>
            </div>
            <div className="spec wide">
              <div className="n">Baseplate</div>
              <p>A printed grid screwed or taped into a drawer. Bins sit on it by their stepped feet and stay put when the drawer slams.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="print" id="printing">
        <div className="wrap">
          <h2>Printing your bin</h2>
          <div className="print-grid">
            <div>
              <h3>Slicer settings</h3>
              <dl>
                <dt>0.2 mm</dt><dd>Layer height. Fine for every bin this tool makes.</dd>
                <dt>2 to 3</dt><dd>Wall loops. Thin bin walls print as solid perimeters.</dd>
                <dt>15%</dt><dd>Infill is plenty. Most of the bin is walls anyway.</dd>
              </dl>
            </div>
            <div>
              <h3>Supports</h3>
              <dl>
                <dt>None</dt><dd>Plain bins, dividers and the stacking lip print without supports.</dd>
                <dt>Tab</dt><dd>The label tab is angled so it prints without support.</dd>
                <dt>Magnets</dt><dd>Holes open onto the bed, so they need no support either.</dd>
              </dl>
            </div>
            <div>
              <h3>Fit</h3>
              <dl>
                <dt>Foot</dt><dd>Turn on elephant's foot compensation if bins sit high on the baseplate.</dd>
                <dt>Glue</dt><dd>Press magnets in. Add a drop of CA glue if one is loose.</dd>
                <dt>PLA</dt><dd>PLA or PETG both work. Use PETG for a hot garage.</dd>
              </dl>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <span>Gridbin is free and runs entirely in your browser.</span>
          <span>Gridfinity by Zack Freedman, MIT</span>
        </div>
      </footer>

      <Toaster position="bottom-center" />
    </>
  )
}
