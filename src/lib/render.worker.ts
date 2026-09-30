// Renders the bin preview on an OffscreenCanvas so three.js never touches the main thread.
// Messages in: init {canvas,w,h,dpr,colors} · resize {w,h} · mesh {mesh} · orbit {dx,dy} · zoom {factor} · colors {colors} · visible {on}
import * as THREE from 'three'
import { PITCH, type BinMesh } from './gridfinity'

type Colors = { brand: string; plate: string; ridge: string }
type Msg =
  | { type: 'init'; canvas: OffscreenCanvas; w: number; h: number; dpr: number; colors: Colors }
  | { type: 'resize'; w: number; h: number }
  | { type: 'mesh'; mesh: BinMesh }
  | { type: 'orbit'; dx: number; dy: number }
  | { type: 'zoom'; factor: number }
  | { type: 'colors'; colors: Colors }
  | { type: 'visible'; on: boolean }

const LIFT = 8 // bin hovers over the plate so the feet and magnet holes stay visible

let renderer: THREE.WebGLRenderer
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(32, 1, 1, 10000)
const target = new THREE.Vector3()
// Orbit state: yaw/pitch around target, distance = fit * zoom.
let yaw = -0.64, pitch = 0.5, zoom = 1, fit = 300, radius = 100
let visible = true, pending = false

scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 1.6))
const key = new THREE.DirectionalLight(0xffffff, 1.6)
key.position.set(-120, 260, 180)
const rim = new THREE.DirectionalLight(0xffffff, 0.5)
rim.position.set(200, 80, -200)
scene.add(key, rim)

const binMat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, flatShading: true })
const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 })
const plateMat = new THREE.MeshStandardMaterial({ roughness: 0.85 })
const ridgeMat = new THREE.MeshStandardMaterial({ roughness: 0.8 })

let bin: THREE.Group | null = null
let plate: THREE.Group | null = null
let plateKey = ''

function dispose(g: THREE.Object3D) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose()
  })
  g.removeFromParent()
}

function render() {
  if (pending || !visible || !renderer) return
  pending = true
  requestAnimationFrame(() => {
    pending = false
    const fov = THREE.MathUtils.degToRad(camera.fov / 2)
    fit = (radius / Math.sin(fov)) * Math.max(1, 1.2 / camera.aspect)
    const dist = fit * zoom
    camera.position.set(
      target.x + dist * Math.cos(pitch) * Math.sin(yaw),
      target.y + dist * Math.sin(pitch),
      target.z + dist * Math.cos(pitch) * Math.cos(yaw),
    )
    camera.lookAt(target)
    renderer.render(scene, camera)
  })
}

function buildPlate(w: number, d: number) {
  const g = new THREE.Group()
  const pw = (w + 2) * PITCH, pd = (d + 2) * PITCH
  const box = (x: number, y: number, z: number, px: number, py: number, pz: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), m)
    b.position.set(px, py, pz)
    g.add(b)
  }
  box(pw, 2, pd, 0, -1, 0, plateMat)
  for (let i = 0; i <= w + 2; i++) box(1.6, 3, pd, -pw / 2 + i * PITCH, 1.5, 0, ridgeMat)
  for (let j = 0; j <= d + 2; j++) box(pw, 3, 1.6, 0, 1.5, -pd / 2 + j * PITCH, ridgeMat)
  return g
}

function setMesh(m: BinMesh) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1))
  geo.rotateX(-Math.PI / 2) // Z-up (print space) to Y-up (three.js)
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  geo.translate(-(bb.min.x + bb.max.x) / 2, LIFT - bb.min.y, -(bb.min.z + bb.max.z) / 2)

  if (bin) dispose(bin)
  bin = new THREE.Group()
  bin.add(new THREE.Mesh(geo, binMat))
  bin.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat))
  scene.add(bin)

  const w = Math.round(m.size[0] / PITCH), d = Math.round(m.size[1] / PITCH)
  const k = `${w}x${d}x${m.size[2].toFixed(1)}`
  if (k !== plateKey) {
    plateKey = k
    if (plate) dispose(plate)
    plate = buildPlate(w, d)
    scene.add(plate)
    const h = m.size[2] + LIFT
    target.set(0, h * 0.4, 0)
    radius = 0.5 * Math.hypot((w + 1) * PITCH, (d + 1) * PITCH, h)
  }
  render()
}

function setColors(c: Colors) {
  binMat.color.set(c.brand)
  plateMat.color.set(c.plate)
  ridgeMat.color.set(c.ridge)
  render()
}

function resize(w: number, h: number) {
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  render()
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data
  switch (m.type) {
    case 'init':
      try {
        renderer = new THREE.WebGLRenderer({ canvas: m.canvas, antialias: true, alpha: true })
      } catch {
        self.postMessage({ type: 'failed' })
        return
      }
      renderer.setPixelRatio(Math.min(m.dpr || 1, 2))
      setColors(m.colors)
      resize(m.w, m.h)
      break
    case 'resize': return resize(m.w, m.h)
    case 'mesh': return setMesh(m.mesh)
    case 'colors': return setColors(m.colors)
    case 'orbit':
      yaw -= m.dx * 0.008
      pitch = Math.min(1.45, Math.max(-0.2, pitch + m.dy * 0.008))
      return render()
    case 'zoom':
      zoom = Math.min(2.5, Math.max(0.4, zoom * m.factor))
      return render()
    case 'visible':
      visible = m.on
      return render()
  }
}
