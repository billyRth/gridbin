// Gridfinity bin geometry, built with manifold-3d (WASM).
// Dimensions follow gridfinity-rebuilt-openscad (src/core/standard.scad).
import type { ManifoldToplevel, Manifold, CrossSection } from 'manifold-3d'

export const PITCH = 42 // grid unit, mm
export const HEIGHT_UNIT = 7 // mm per height unit
const CLEARANCE = 0.5 // bin is 41.5 per cell
const TOP_R = 3.75 // outer corner radius
const BASE_H = 7 // base (feet + bridge) height
const WALL = 0.95
const DIVIDER = 1.2
const LIP_H = 0.7 + 1.8 + 1.9 // 4.4
const LIP_W = 0.7 + 1.9 // 2.6 inset at lip bottom
const MAGNET_R = 6.5 / 2
const MAGNET_DEPTH = 2 + 0.2 * 2
const HOLE_FROM_SIDE = 8
const TAB_DEPTH = 13
const TAB_THICK = 1.2
const TAB_ANGLE = 36 // support angle, degrees
const SEG = 32 // circular segments

export interface BinParams {
  width: number // grid units, X
  depth: number // grid units, Y
  height: number // height units (7 mm each), excluding the stacking lip
  dividersX: number // walls splitting the X axis
  dividersY: number // walls splitting the Y axis
  labelTab: boolean
  magnets: boolean
  stackingLip: boolean
}

export const DEFAULT_PARAMS: BinParams = {
  width: 2, depth: 1, height: 6, dividersX: 1, dividersY: 0,
  labelTab: true, magnets: true, stackingLip: true,
}

export interface BinMesh {
  positions: Float32Array // xyz per vertex, mm, Z up
  indices: Uint32Array
  size: [number, number, number] // overall mm
  volume: number // mm³
}

/** Outer height in mm (floor of feet to top of lip). */
export function outerHeight(p: BinParams) {
  return p.height * HEIGHT_UNIT + (p.stackingLip ? LIP_H : 0)
}

export function buildBin(wasm: ManifoldToplevel, p: BinParams): BinMesh {
  const { Manifold, CrossSection } = wasm
  const trash: { delete(): void }[] = []
  const t = <T extends { delete(): void }>(x: T): T => (trash.push(x), x)

  // Rounded rectangle centered at origin, radius clamped so tiny insets stay valid.
  const rrect = (w: number, d: number, r: number): CrossSection => {
    const rr = Math.max(r, 0.05)
    return t(t(CrossSection.square([w - 2 * rr, d - 2 * rr], true)).offset(rr, 'Round', 2, SEG))
  }
  // Thin slab of a rounded rect at height z (used as a hull key frame).
  const slice = (w: number, d: number, r: number, z: number): Manifold =>
    t(t(rrect(w, d, r).extrude(0.001)).translate(0, 0, z))
  // Loft between key frames [inset, z] of a rounded rect, as a union of convex hulls.
  const loft = (w: number, d: number, frames: [number, number][]): Manifold => {
    const parts = frames.slice(1).map(([i1, z1], k) => {
      const [i0, z0] = frames[k]
      return t(Manifold.hull([
        slice(w - 2 * i0, d - 2 * i0, TOP_R - i0, z0),
        slice(w - 2 * i1, d - 2 * i1, TOP_R - i1, z1),
      ]))
    })
    return t(Manifold.union(parts))
  }

  const W = p.width * PITCH - CLEARANCE
  const D = p.depth * PITCH - CLEARANCE
  const H = p.height * HEIGHT_UNIT
  const cell = PITCH - CLEARANCE

  // Feet: one base profile per grid cell (inset 2.95 → 0.8 → 0.8 → 0 going up).
  const foot = loft(cell, cell, [[2.95, 0], [2.15, 0.8], [2.15, 2.6], [0, 4.75]])
  const feet: Manifold[] = []
  for (let x = 0; x < p.width; x++)
    for (let y = 0; y < p.depth; y++)
      feet.push(t(foot.translate((x - (p.width - 1) / 2) * PITCH, (y - (p.depth - 1) / 2) * PITCH, 0)))

  // Body: from the top of the feet profile up to H (+ lip).
  const top = H + (p.stackingLip ? LIP_H : 0)
  const body = t(t(rrect(W, D, TOP_R).extrude(top - 4.75)).translate(0, 0, 4.75))
  let bin = t(Manifold.union([...feet, body]))

  // Cavity: floor at BASE_H, walls WALL thick. With a lip, the wall thickens to LIP_W
  // below the lip on a 45° support, then the lip opens back out (mirrors the base profile).
  const cavityFrames: [number, number][] = p.stackingLip
    ? [[WALL, BASE_H], [WALL, H - 2.85], [LIP_W, H - 1.2], [LIP_W, H], [1.9, H + 0.7], [1.9, H + 2.5], [0, top + 0.01]]
    : [[WALL, BASE_H], [WALL, top + 0.01]]
  bin = t(bin.subtract(loft(W, D, cavityFrames)))

  const innerW = W - 2 * WALL
  const innerD = D - 2 * WALL
  const wallTop = H - (p.stackingLip ? 1.2 : 0) // keep dividers below the lip opening
  const extras: Manifold[] = []

  // Dividers: evenly spaced walls across the cavity.
  const divH = wallTop - BASE_H
  for (let i = 1; i <= p.dividersX; i++) {
    const x = -innerW / 2 + (innerW * i) / (p.dividersX + 1)
    extras.push(t(t(Manifold.cube([DIVIDER, innerD, divH], true)).translate(x, 0, BASE_H + divH / 2)))
  }
  for (let i = 1; i <= p.dividersY; i++) {
    const y = -innerD / 2 + (innerD * i) / (p.dividersY + 1)
    extras.push(t(t(Manifold.cube([innerW, DIVIDER, divH], true)).translate(0, y, BASE_H + divH / 2)))
  }

  // Label tab: a ledge along the back (+Y) wall with an angled support under it.
  if (p.labelTab) {
    const drop = TAB_THICK + TAB_DEPTH * Math.tan((TAB_ANGLE * Math.PI) / 180)
    const tabDepth = Math.min(TAB_DEPTH, innerD / (p.dividersY + 1) - 2)
    // Convex prism: hull of its 8 corners (back wall at +Y, 0.1 mm overlap into it).
    const yb = innerD / 2 + 0.1, zt = wallTop, hx = innerW / 2 + 0.1
    const pts: [number, number, number][] = []
    for (const x of [-hx, hx])
      pts.push([x, yb, zt], [x, yb, zt - drop], [x, yb - tabDepth, zt - TAB_THICK], [x, yb - tabDepth, zt])
    extras.push(t(Manifold.hull(pts)))
  }
  if (extras.length) bin = t(Manifold.union([bin, ...extras]))

  // Magnet holes: 4 per cell, 8 mm in from each cell edge, 2.4 mm deep.
  if (p.magnets) {
    const holes: Manifold[] = []
    const off = cell / 2 - HOLE_FROM_SIDE + CLEARANCE / 2
    const hole = t(Manifold.cylinder(MAGNET_DEPTH + 0.01, MAGNET_R, MAGNET_R, SEG))
    for (let x = 0; x < p.width; x++)
      for (let y = 0; y < p.depth; y++) {
        const cx = (x - (p.width - 1) / 2) * PITCH, cy = (y - (p.depth - 1) / 2) * PITCH
        for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
          holes.push(t(hole.translate(cx + sx * off, cy + sy * off, -0.01)))
      }
    bin = t(bin.subtract(t(Manifold.union(holes))))
  }

  const status = bin.status()
  if (status !== 'NoError') {
    for (const o of trash) o.delete()
    throw new Error(`Bin geometry invalid: ${status}`)
  }
  const mesh = bin.getMesh()
  const n = mesh.numProp
  const positions = new Float32Array((mesh.vertProperties.length / n) * 3)
  for (let v = 0, o = 0; v < mesh.vertProperties.length; v += n, o += 3) {
    positions[o] = mesh.vertProperties[v]
    positions[o + 1] = mesh.vertProperties[v + 1]
    positions[o + 2] = mesh.vertProperties[v + 2]
  }
  const result: BinMesh = {
    positions,
    indices: new Uint32Array(mesh.triVerts),
    size: [W, D, top],
    volume: bin.volume(),
  }
  for (const o of trash) o.delete()
  return result
}

/** Binary STL (little-endian), millimetres. */
export function toSTL(m: BinMesh): ArrayBuffer {
  const triCount = m.indices.length / 3
  const buf = new ArrayBuffer(84 + triCount * 50)
  const dv = new DataView(buf)
  const header = 'Gridbin - Gridfinity bin'
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i))
  dv.setUint32(80, triCount, true)
  let o = 84
  const P = m.positions
  for (let t = 0; t < triCount; t++) {
    const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    for (const val of [nx, ny, nz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]]) {
      dv.setFloat32(o, val, true); o += 4
    }
    dv.setUint16(o, 0, true); o += 2
  }
  return buf
}
