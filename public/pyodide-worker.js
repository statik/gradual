/* Pyodide in a Web Worker. Loaded on demand from the main thread.

   The /data directory is an Emscripten IDBFS mount, so files written
   there (mounted datasets, or files the agent writes from Python)
   survive a page reload. syncfs(true) restores from IndexedDB on
   init; syncfs(false) persists after every write.

   Messages:
   - { type: 'run', code }              → execute Python
   - { type: 'writeFile', path, bytes } → write bytes, then persist
   - { type: 'listFiles' }              → names currently in /data
   - { type: 'clearFiles' }             → wipe /data, then persist */

const PYODIDE_VERSION = '0.27.7'
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`
const DATA_DIR = '/data'

let pyodideReady = null

function syncfs(py, populate) {
  return new Promise((resolve, reject) => {
    py.FS.syncfs(populate, (err) => (err ? reject(err) : resolve()))
  })
}

async function ensurePyodide() {
  if (!pyodideReady) {
    self.importScripts(`${INDEX_URL}pyodide.js`)
    pyodideReady = self.loadPyodide({ indexURL: INDEX_URL }).then(async (py) => {
      py.FS.mkdirTree(DATA_DIR)
      py.FS.mount(py.FS.filesystems.IDBFS, {}, DATA_DIR)
      // Pull anything persisted from a previous session into memory.
      await syncfs(py, true).catch(() => {})
      return py
    })
  }
  return pyodideReady
}

function reprResult(value) {
  if (value === undefined || value === null) return null
  try {
    if (value && typeof value.toJs === 'function') {
      const js = value.toJs({ create_proxies: false, dict_converter: Object.fromEntries })
      try { value.destroy?.() } catch {}
      return JSON.stringify(js)
    }
    return String(value)
  } catch (err) {
    return `<repr error: ${String(err)}>`
  }
}

function listDataFiles(py) {
  try {
    return py.FS.readdir(DATA_DIR).filter((n) => n !== '.' && n !== '..')
  } catch {
    return []
  }
}

async function handleRun(id, code) {
  let stdout = ''
  let stderr = ''
  let result = null
  let ok = true

  try {
    const py = await ensurePyodide()
    py.setStdout({ batched: (s) => { stdout += s + '\n' } })
    py.setStderr({ batched: (s) => { stderr += s + '\n' } })

    try {
      await py.loadPackagesFromImports(code)
      const value = await py.runPythonAsync(code)
      result = reprResult(value)
    } catch (err) {
      ok = false
      stderr += String(err?.message ?? err)
    }
    // The agent may have written into /data; persist it.
    await syncfs(py, false).catch(() => {})
  } catch (err) {
    ok = false
    stderr += `[pyodide load failed] ${String(err?.message ?? err)}`
  }

  self.postMessage({ id, ok, stdout, stderr, result })
}

async function handleWriteFile(id, path, bytes) {
  try {
    const py = await ensurePyodide()
    const slash = path.lastIndexOf('/')
    if (slash > 0) py.FS.mkdirTree(path.slice(0, slash))
    py.FS.writeFile(path, new Uint8Array(bytes))
    await syncfs(py, false)
    self.postMessage({ id, ok: true, path })
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) })
  }
}

async function handleListFiles(id) {
  try {
    const py = await ensurePyodide()
    self.postMessage({ id, ok: true, files: listDataFiles(py) })
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err), files: [] })
  }
}

async function handleClearFiles(id) {
  try {
    const py = await ensurePyodide()
    for (const name of listDataFiles(py)) {
      try { py.FS.unlink(`${DATA_DIR}/${name}`) } catch {}
    }
    await syncfs(py, false)
    self.postMessage({ id, ok: true })
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) })
  }
}

self.onmessage = async (event) => {
  const { id, type } = event.data ?? {}
  if (type === 'run') return handleRun(id, event.data.code)
  if (type === 'writeFile') return handleWriteFile(id, event.data.path, event.data.bytes)
  if (type === 'listFiles') return handleListFiles(id)
  if (type === 'clearFiles') return handleClearFiles(id)
}
