// Tiny Chrome DevTools Protocol client (no dependencies) used by the measurement scripts in this folder. Set CHROME_PATH if Chrome is elsewhere.
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ port = 9333, profile }) {
  rmSync(profile, { recursive: true, force: true })
  mkdirSync(profile, { recursive: true })
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const pages = (await res.json()).filter((t) => t.type === 'page')
      if (pages.length) return { proc, wsUrl: pages[0].webSocketDebuggerUrl }
    } catch { /* try again */ }
    await sleep(200)
  }
  proc.kill()
  throw new Error('Chrome did not start')
}

export class Page {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.pending = new Map()
    this.errors = []
    this.logs = []
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res)
      this.ws.addEventListener('error', rej)
    })
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result)
      } else if (msg.method) {
        if (msg.method === 'Runtime.exceptionThrown') this.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)
        if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) this.logs.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
      }
    })
    await this.send('Runtime.enable')
    await this.send('Page.enable')
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n' + expression.slice(0, 200))
    return r.result.value
  }
  async waitFor(expression, { timeout = 8000, label } = {}) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      try {
        const v = await this.eval(expression)
        if (v) return v
      } catch { /* try again */ }
      await sleep(20)
    }
    throw new Error(`timeout waiting for: ${label || expression}`)
  }
  async rect(selector, nth = 0) {
    return this.eval(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}]; if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2, w:r.width, h:r.height} })()`)
  }
  async click(selector, nth = 0) {
    const r = await this.rect(selector, nth)
    if (!r) throw new Error('click: not found ' + selector)
    await this.clickAt(r.x, r.y)
  }
  async clickAt(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(150)
  }
  async clickText(text, selector = 'button, [role=option], label') {
    const pos = await this.eval(`(() => { const norm = (e) => e.textContent.replace(/\\s+/g,' ').trim(); const els=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.getClientRects().length); const i = els.findIndex(e => norm(e) === ${JSON.stringify(text)}); const k = i >= 0 ? i : els.findIndex(e => norm(e).startsWith(${JSON.stringify(text)})); const j = k >= 0 ? k : els.findIndex(e => norm(e).includes(${JSON.stringify(text)})); if (j<0) return null; els[j].scrollIntoView({block:'center'}); const r = els[j].getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
    if (!pos) throw new Error(`clickText: no "${text}" (${selector})`)
    await this.clickAt(pos.x, pos.y)
  }
  async type(text) {
    await this.send('Input.insertText', { text })
    await sleep(60)
  }
  async setViewport(width, height, mobile) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
  }
  async screenshot(file, { full = true } = {}) {
    let params = { format: 'png' }
    if (full) {
      const m = await this.send('Page.getLayoutMetrics')
      const { width, height } = m.cssContentSize || m.contentSize
      params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(height, 6000), scale: 1 } }
    }
    const { data } = await this.send('Page.captureScreenshot', params)
    writeFileSync(file, Buffer.from(data, 'base64'))
  }
}
