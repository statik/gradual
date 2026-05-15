/* Pyodide in a Web Worker. Loaded on demand from the main thread. */

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

self.onmessage = async (event) => {
  const { id, type, code } = event.data ?? {}
  if (type !== 'run') return

  let stdout = ''
  let stderr = ''
  let result = null
  let ok = true

  try {
    const py = await ensurePyodide()
    py.setStdout({ batched: (s) => { stdout += s + '\n' } })
    py.setStderr({ batched: (s) => { stderr += s + '\n' } })

    try {
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
