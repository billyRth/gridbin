// Builds bin meshes off the main thread. Request: {id, params}. Reply: {id, mesh} or {id, error}.
import Module from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { buildBin, type BinParams } from './gridfinity'

const ready = Module({ locateFile: () => wasmUrl }).then((wasm) => {
  wasm.setup()
  return wasm
})

let latest = 0

self.onmessage = async (e: MessageEvent<{ id: number; params: BinParams }>) => {
  const { id, params } = e.data
  latest = id
  const wasm = await ready
  if (id !== latest) return // a newer request arrived while wasm was loading
  try {
    const mesh = buildBin(wasm, params)
    self.postMessage({ id, mesh }, { transfer: [mesh.positions.buffer, mesh.indices.buffer] })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}
