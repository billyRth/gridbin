// Smoke check for the bin geometry: every variant must be a valid solid with sane size.
// Run: npx tsx scripts/check-geometry.ts
import Module from 'manifold-3d'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { buildBin, toSTL, DEFAULT_PARAMS, type BinParams } from '../src/lib/gridfinity'

const wasm = await Module()
wasm.setup()

const variants: Partial<BinParams>[] = [
  {},
  { width: 1, depth: 1, height: 3, dividersX: 0, labelTab: false, magnets: false, stackingLip: false },
  { width: 6, depth: 6, height: 12, dividersX: 5, dividersY: 5 },
  { width: 3, depth: 2, height: 2, dividersY: 2, stackingLip: false },
]

for (const v of variants) {
  const p = { ...DEFAULT_PARAMS, ...v }
  const t0 = performance.now()
  const m = buildBin(wasm, p)
  const ms = performance.now() - t0
  const [w, d, h] = m.size
  assert.ok(m.indices.length > 0 && m.volume > 0, 'empty mesh')
  assert.equal(w, p.width * 42 - 0.5)
  assert.equal(d, p.depth * 42 - 0.5)
  assert.ok(Math.abs(h - (p.height * 7 + (p.stackingLip ? 4.4 : 0))) < 1e-6)
  // Mesh bounds match the declared size (feet start at z=0).
  let minZ = Infinity, maxZ = -Infinity, maxX = -Infinity
  for (let i = 0; i < m.positions.length; i += 3) {
    minZ = Math.min(minZ, m.positions[i + 2]); maxZ = Math.max(maxZ, m.positions[i + 2]); maxX = Math.max(maxX, m.positions[i])
  }
  assert.ok(Math.abs(minZ) < 0.02 && Math.abs(maxZ - h) < 0.02 && Math.abs(maxX - w / 2) < 0.02, `bounds off: z ${minZ}..${maxZ}, x ${maxX}`)
  // Hollow: at least most of the expected cavity (above the 7 mm base) is empty.
  const cavity = (w - 2) * (d - 2) * (p.height * 7 - 7)
  assert.ok(m.volume < w * d * h - cavity * 0.7, 'bin not hollow')
  console.log(`ok ${p.width}x${p.depth}x${p.height} tris=${m.indices.length / 3} vol=${(m.volume / 1000).toFixed(1)}cm³ ${ms.toFixed(0)}ms`)
}

writeFileSync('scripts/sample-2x1x6.stl', new Uint8Array(toSTL(buildBin(wasm, DEFAULT_PARAMS))))
console.log('wrote scripts/sample-2x1x6.stl')
