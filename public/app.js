/* Pi Agent demo — browser loop.
   - Anonymous sign-in on load
   - Stream completions from /api/inference
   - Gate python_run tool calls behind a Run/Skip cell
   - Subscribe to quota_buckets via Electric for live token meter */

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel))

const SYSTEM_PROMPT = `You are Pi, a coding agent running inside a browser demo.
You have one tool: python_run(code). It executes Python in a sandboxed Pyodide kernel
that persists state between calls. Use it for any computation, data wrangling, or plotting.
Print results with print(); the final expression's repr is also returned.
Keep responses short. When a tool is the right move, call it instead of describing it.`

/** @type {{ user: any | null, sessionId: string | null, messages: any[], pyodideWorker: Worker | null, busy: boolean }} */
const state = {
  user: null,
  sessionId: null,
  messages: [],
  pyodideWorker: null,
  busy: false,
}

// ---------- bootstrap ----------

async function init() {
  await ensureSignedIn()
  bindUI()
  subscribeQuota().catch((err) => console.warn('[quota subscription] stopped', err))
}

async function ensureSignedIn() {
  const me = await fetch('/api/me', { credentials: 'include' }).then((r) => r.json())
  if (me.user) {
    state.user = me.user
  } else {
    const r = await fetch('/api/auth/sign-in/anonymous', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const data = await r.json()
    state.user = data.user ?? data.data?.user ?? null
  }
  renderUser()
}

function renderUser() {
  const pill = $('#user-pill')
  if (!state.user) { pill.textContent = 'signed out'; return }
  pill.textContent = state.user.isAnonymous
    ? 'anonymous'
    : (state.user.email ?? state.user.name ?? 'signed in')
  pill.title = state.user.id ?? ''
}

function bindUI() {
  const form = /** @type {HTMLFormElement} */ ($('#composer-form'))
  const input = /** @type {HTMLTextAreaElement} */ ($('#composer-input'))
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    void submitTurn()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      form.requestSubmit()
    }
  })
}

// ---------- agent loop ----------

async function submitTurn() {
  if (state.busy) return
  const input = /** @type {HTMLTextAreaElement} */ ($('#composer-input'))
  const text = input.value.trim()
  if (!text) return
  input.value = ''

  pushMessage({ role: 'user', content: text })
  await runInference()
}

function modelChoice() {
  return /** @type {HTMLSelectElement} */ ($('#model-select')).value
}

async function runInference() {
  setBusy(true)
  const assistantMsg = newAssistantMessage()
  pushMessage(assistantMsg)

  try {
    const payload = {
      model: modelChoice(),
      max_tokens: 1024,
      messages: buildWireMessages(),
      tools: [pythonRunSchema()],
      ...(state.sessionId ? { session_id: state.sessionId } : {}),
    }

    const res = await fetch('/api/inference', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: `http_${res.status}` }))
      assistantMsg.content = `[error: ${err.error ?? 'stream_failed'}]`
      renderMessage(assistantMsg)
      return
    }

    const returnedSession = res.headers.get('x-session-id')
    if (returnedSession) state.sessionId = returnedSession

    const finishReason = await consumeStream(res.body, assistantMsg)

    if (finishReason === 'tool_calls' && assistantMsg.toolCalls.length) {
      await runToolCalls(assistantMsg)
      await runInference()
    }
  } catch (err) {
    assistantMsg.content = `[error: ${err instanceof Error ? err.message : String(err)}]`
    renderMessage(assistantMsg)
  } finally {
    setBusy(false)
  }
}

/**
 * @param {ReadableStream<Uint8Array>} body
 * @param {ReturnType<typeof newAssistantMessage>} assistantMsg
 */
async function consumeStream(body, assistantMsg) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let finishReason = null

  outer: while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    let nl
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') break outer

      let chunk
      try { chunk = JSON.parse(payload) } catch { continue }
      const choice = chunk.choices?.[0]
      if (!choice) continue

      if (typeof choice.delta?.content === 'string') {
        assistantMsg.content += choice.delta.content
      }
      for (const tc of choice.delta?.tool_calls ?? []) {
        const slot = assistantMsg.toolCalls[tc.index] ?? { id: '', name: '', args: '' }
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name = tc.function.name
        if (tc.function?.arguments) slot.args += tc.function.arguments
        assistantMsg.toolCalls[tc.index] = slot
      }
      if (choice.finish_reason) finishReason = choice.finish_reason
      renderMessage(assistantMsg)
    }
  }
  return finishReason
}

/** @param {ReturnType<typeof newAssistantMessage>} assistantMsg */
async function runToolCalls(assistantMsg) {
  for (const tc of assistantMsg.toolCalls) {
    if (!tc || tc.name !== 'python_run') {
      pushMessage({
        role: 'tool',
        tool_call_id: tc?.id ?? '',
        content: JSON.stringify({ error: `unsupported tool: ${tc?.name}` }),
      })
      continue
    }
    let params = {}
    try { params = JSON.parse(tc.args || '{}') } catch {}
    const proposed = typeof params.code === 'string' ? params.code : ''

    const outcome = await renderToolCell({ id: tc.id, proposed })

    pushMessage({
      role: 'tool',
      tool_call_id: tc.id,
      content: JSON.stringify(outcome.toolResult),
    })

    if (tc.id) {
      // Best-effort persistence; ignore failure so the agent loop keeps moving.
      fetch(`/api/tool-calls/${encodeURIComponent(tc.id)}/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: outcome.status,
          executedCode: outcome.executedCode,
          result: outcome.toolResult,
        }),
      }).catch(() => {})
    }
  }
}

// ---------- tool cell ----------

/**
 * @param {{ id: string, proposed: string }} args
 * @returns {Promise<{ status: 'succeeded' | 'failed' | 'skipped', executedCode: string | null, toolResult: any }>}
 */
function renderToolCell({ id, proposed }) {
  return new Promise((resolve) => {
    const lines = proposed.split('\n').length
    const cell = document.createElement('section')
    cell.className = 'tool-cell'
    cell.innerHTML = `
      <div class="tool-cell__header">
        <strong>python_run</strong>
        <span class="tool-cell__status" data-state="proposed">proposed by agent</span>
      </div>
      <textarea class="tool-cell__code" spellcheck="false" rows="${Math.min(24, Math.max(3, lines + 1))}"></textarea>
      <div class="tool-cell__actions">
        <button type="button" data-action="run">Run</button>
        <button type="button" data-action="skip">Skip</button>
      </div>
      <pre class="tool-cell__output" hidden></pre>
    `
    /** @type {HTMLTextAreaElement} */
    const codeEl = cell.querySelector('.tool-cell__code')
    codeEl.value = proposed
    const runBtn = cell.querySelector('button[data-action="run"]')
    const skipBtn = cell.querySelector('button[data-action="skip"]')
    const statusEl = cell.querySelector('.tool-cell__status')
    const outEl = cell.querySelector('.tool-cell__output')

    $('#transcript').appendChild(cell)
    cell.scrollIntoView({ block: 'end', behavior: 'smooth' })

    runBtn.addEventListener('click', async () => {
      const executed = codeEl.value
      codeEl.disabled = true
      runBtn.setAttribute('disabled', '')
      skipBtn.setAttribute('disabled', '')
      statusEl.textContent = 'running…'
      statusEl.dataset.state = 'running'

      if (id) {
        fetch(`/api/tool-calls/${encodeURIComponent(id)}/complete`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'running', executedCode: executed }),
        }).catch(() => {})
      }

      const out = await runPython(executed)
      outEl.hidden = false
      outEl.textContent = formatOutput(out)
      statusEl.textContent = out.ok ? 'succeeded' : 'failed'
      statusEl.dataset.state = out.ok ? 'succeeded' : 'failed'

      resolve({
        status: out.ok ? 'succeeded' : 'failed',
        executedCode: executed,
        toolResult: {
          stdout: out.stdout,
          stderr: out.stderr,
          result: out.result,
        },
      })
    })

    skipBtn.addEventListener('click', () => {
      codeEl.disabled = true
      runBtn.setAttribute('disabled', '')
      skipBtn.setAttribute('disabled', '')
      statusEl.textContent = 'skipped'
      statusEl.dataset.state = 'skipped'
      resolve({
        status: 'skipped',
        executedCode: null,
        toolResult: { skipped: true },
      })
    })
  })
}

function formatOutput(out) {
  const parts = []
  if (out.stdout) parts.push(out.stdout.trimEnd())
  if (out.stderr) parts.push(`stderr:\n${out.stderr.trimEnd()}`)
  if (out.result !== null && out.result !== undefined) parts.push(`=> ${out.result}`)
  return parts.length ? parts.join('\n') : '(no output)'
}

// ---------- pyodide ----------

async function runPython(code) {
  if (!state.pyodideWorker) {
    state.pyodideWorker = new Worker('/pyodide-worker.js')
  }
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2)
    const handler = (event) => {
      if (event.data?.id !== id) return
      state.pyodideWorker.removeEventListener('message', handler)
      resolve(event.data)
    }
    state.pyodideWorker.addEventListener('message', handler)
    state.pyodideWorker.postMessage({ id, type: 'run', code })
  })
}

// ---------- message bookkeeping ----------

function newAssistantMessage() {
  return { role: 'assistant', content: '', toolCalls: [], _el: null }
}

function buildWireMessages() {
  const wire = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const m of state.messages) {
    if (m.role === 'assistant') {
      const entry = { role: 'assistant', content: m.content }
      if (m.toolCalls?.length) {
        entry.tool_calls = m.toolCalls
          .filter(Boolean)
          .map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.args || '{}' },
          }))
      }
      wire.push(entry)
    } else if (m.role === 'tool') {
      wire.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content })
    } else if (m.role === 'user') {
      wire.push({ role: 'user', content: m.content })
    }
  }
  return wire
}

function pushMessage(m) {
  state.messages.push(m)
  renderMessage(m)
}

function renderMessage(m) {
  if (!m._el) {
    if (m.role === 'tool') return // tool result message is rendered by the cell
    const el = document.createElement('article')
    el.className = `msg msg--${m.role}`
    el.innerHTML = `<header class="msg__role">${m.role}</header><div class="msg__content"></div>`
    $('#transcript').appendChild(el)
    m._el = el
  }
  m._el.querySelector('.msg__content').textContent = m.content
  m._el.scrollIntoView({ block: 'end', behavior: 'smooth' })
}

function pythonRunSchema() {
  return {
    type: 'function',
    function: {
      name: 'python_run',
      description: 'Execute Python code in a persistent Pyodide kernel. Returns stdout, stderr, and a repr of the last expression. Use print() for visible output.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Python source to execute.' },
        },
        required: ['code'],
        additionalProperties: false,
      },
    },
  }
}

function setBusy(b) {
  state.busy = b
  /** @type {HTMLButtonElement} */
  const btn = $('#composer-submit')
  btn.disabled = b
  btn.textContent = b ? 'Streaming…' : 'Send'
}

// ---------- quota meter via Electric shape ----------

async function subscribeQuota() {
  let handle = ''
  let offset = '-1'

  while (true) {
    const url = new URL('/api/sync/quota_buckets', location.origin)
    url.searchParams.set('offset', offset)
    if (handle) url.searchParams.set('handle', handle)
    url.searchParams.set('live', offset === '-1' ? 'false' : 'true')

    let res
    try {
      res = await fetch(url, { credentials: 'include' })
    } catch {
      await sleep(2000); continue
    }
    if (!res.ok) { await sleep(2000); continue }

    handle = res.headers.get('electric-handle') ?? handle
    offset = res.headers.get('electric-offset') ?? offset

    let body
    try { body = await res.json() } catch { body = [] }
    if (Array.isArray(body)) {
      for (const msg of body) {
        const op = msg?.headers?.operation
        if (op === 'insert' || op === 'update') {
          paintQuota(msg.value)
        }
        if (msg?.headers?.control === 'must-refetch') {
          offset = '-1'; handle = ''
        }
      }
    }
  }
}

function paintQuota(row) {
  const used = Number(row.used_tokens ?? 0)
  const limit = Number(row.limit_tokens ?? 0)
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  $('#quota-fill').style.width = pct + '%'
  $('#quota-text').textContent = `${used.toLocaleString()} / ${limit.toLocaleString()} tokens`
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

init().catch((err) => console.error('[init]', err))
