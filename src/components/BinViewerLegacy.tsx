import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PITCH, type BinMesh } from '@/lib/gridfinity'

const LIFT = 8 // bin hovers over the plate so the feet and magnet holes stay visible

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose()
  })
  g.removeFromParent()
}

export default function BinViewer({ mesh }: { mesh: BinMesh | null }) {
  const host = useRef<HTMLDivElement>(null)
  const setMeshRef = useRef<((m: BinMesh) => void) | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = host.current!
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    el.prepend(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 10000)
    camera.position.set(-0.6, 0.55, 0.8) // only the direction matters; frame() sets distance
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
    const applyTheme = () => {
      binMat.color.set(css('--brand'))
      plateMat.color.set(css('--plate'))
      ridgeMat.color.set(css('--plate-ridge'))
      render()
    }

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false

    let pending = 0
    function render() {
      if (pending || document.hidden) return
      pending = requestAnimationFrame(() => {
        pending = 0
        renderer.render(scene, camera)
      })
    }
    controls.addEventListener('change', render)

    let bin: THREE.Group | null = null
    let plate: THREE.Group | null = null
    let plateKey = ''
    let radius = 100

    // Keeps the current view direction, sets distance so the bin + plate fit.
    function frame(dir = camera.position.clone().sub(controls.target).normalize()) {
      const fov = THREE.MathUtils.degToRad(camera.fov / 2)
      const dist = (radius / Math.sin(fov)) * Math.max(1, 1.2 / camera.aspect)
      camera.position.copy(controls.target).addScaledVector(dir, dist)
      controls.minDistance = dist * 0.4
      controls.maxDistance = dist * 2.5
      controls.update()
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

    setMeshRef.current = (m: BinMesh) => {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(m.positions.slice(), 3)) // copy: transforms below mutate, and the STL export reads m.positions
      geo.setIndex(new THREE.BufferAttribute(m.indices, 1))
      geo.rotateX(-Math.PI / 2) // Z-up (print space) to Y-up (three.js)
      geo.computeBoundingBox()
      const bb = geo.boundingBox!
      geo.translate(-(bb.min.x + bb.max.x) / 2, LIFT - bb.min.y, -(bb.min.z + bb.max.z) / 2)

      if (bin) disposeGroup(bin)
      bin = new THREE.Group()
      bin.add(new THREE.Mesh(geo, binMat))
      bin.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat))
      scene.add(bin)

      const w = Math.round(m.size[0] / PITCH), d = Math.round(m.size[1] / PITCH)
      const k = `${w}x${d}x${m.size[2].toFixed(1)}`
      if (k !== plateKey) {
        plateKey = k
        if (plate) disposeGroup(plate)
        plate = buildPlate(w, d)
        scene.add(plate)
        const h = m.size[2] + LIFT
        const dir = camera.position.clone().sub(controls.target).normalize()
        controls.target.set(0, h * 0.4, 0)
        radius = 0.5 * Math.hypot((w + 1) * PITCH, (d + 1) * PITCH, h)
        frame(dir)
      }
      render()
    }

    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      if (!width || !height) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      frame()
      render()
    })
    ro.observe(el)

    const scheme = matchMedia('(prefers-color-scheme: dark)')
    scheme.addEventListener('change', applyTheme)
    const onVis = () => !document.hidden && render()
    document.addEventListener('visibilitychange', onVis)
    applyTheme()

    return () => {
      setMeshRef.current = null
      ro.disconnect()
      scheme.removeEventListener('change', applyTheme)
      document.removeEventListener('visibilitychange', onVis)
      cancelAnimationFrame(pending)
      controls.dispose()
      if (bin) disposeGroup(bin)
      if (plate) disposeGroup(plate)
      for (const mat of [binMat, edgeMat, plateMat, ridgeMat]) mat.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  useEffect(() => {
    if (mesh) setMeshRef.current?.(mesh)
  }, [mesh])

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
