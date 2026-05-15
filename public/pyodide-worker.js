/* Pyodide in a Web Worker. Loaded on demand from the main thread.
   Handles two messages:
   - { type: 'run', code }            → execute Python, return stdout/stderr/result
   - { type: 'writeFile', path, bytes } → write bytes into the virtual FS (MEMFS) */

const PYODIDE_VERSION = '0.27.7'
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

let pyodideReady = null

async function ensurePyodide() {
  if (!pyodideReady) {
    self.importScripts(`${INDEX_URL}pyodide.js`)
    pyodideReady = self.loadPyodide({ indexURL: INDEX_URL })
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
      // Resolve `import pandas` / `import pyarrow` etc. against the Pyodide
      // package index before executing.
      await py.loadPackagesFromImports(code)
      const value = await py.runPythonAsync(code)
      result = reprResult(value)
    } catch (err) {
      ok = false
      stderr += String(err?.message ?? err)
    }
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
    self.postMessage({ id, ok: true, path })
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) })
  }
}

self.onmessage = async (event) => {
  const { id, type } = event.data ?? {}
  if (type === 'run') return handleRun(id, event.data.code)
  if (type === 'writeFile') return handleWriteFile(id, event.data.path, event.data.bytes)
}
