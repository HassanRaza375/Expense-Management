// Cutover test: an OLD build and the NEW build on the SAME origin (http://127.0.0.1:3002) in ONE Chrome profile, as a real user experiences a deploy.
//   1. check the old commit out into a temporary git worktree OUTSIDE this repo, `npm ci && npm run build` there (it must be a Vite build: `vite preview`)
//   2. `npm run build` here, then:  HISAAB_OLD_DIR=<that folder> node scripts/measure/cutover.mjs
// It proves: the old app announces the update, Reload opens the new app, every hisaab:* key is byte-identical, the IndexedDB databases keep their names and versions,
// and a full backup made by the OLD app restores into a fresh new app (records and stored file). Remove the worktree afterwards (`git worktree remove --force <folder>`).
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { launch, Page, sleep } from './cdp.mjs'

import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const SCR = `${os.tmpdir().replace(/\\/g, "/")}/hisaab-measure`
const OLD_DIR = process.env.HISAAB_OLD_DIR
if (!OLD_DIR) {
  console.error('Set HISAAB_OLD_DIR to a built checkout of the OLD (Vite) version. See the header of this file.')
  process.exit(2)
}
const NEW_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PORT = 3002
const ORIGIN = `http://127.0.0.1:${PORT}`
mkdirSync(`${SCR}/cutover`, { recursive: true })

let fails = 0
const check = (name, ok, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
}

let server = null
const startOld = async () => {
  server = spawn('npx.cmd', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { cwd: OLD_DIR, shell: true, stdio: 'ignore' })
  await waitUp()
}
const startNew = async () => {
  server = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: NEW_DIR, env: { ...process.env, PORT: String(PORT), NITRO_PORT: String(PORT) }, stdio: 'ignore' })
  await waitUp()
}
const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(ORIGIN + '/'); if (r.ok) return } catch { /* not up yet */ }
    await sleep(250)
  }
  throw new Error('server did not start')
}
const stop = () => new Promise((res) => {
  if (!server) return res()
  spawn('taskkill', ['/F', '/T', '/PID', String(server.pid)], { stdio: 'ignore' }).on('exit', () => setTimeout(res, 800))
  server = null
})

const SEED = `(() => {
  try {
    sessionStorage.setItem('hisaab:session-unlocked', 'true')
    if (localStorage.getItem('__seeded')) return
    localStorage.setItem('__seeded', '1')
    const noon = (n) => { const x = new Date(); x.setDate(x.getDate() - n); x.setHours(12, 0, 0, 0); return x.toISOString() }
    const set = (k, v) => localStorage.setItem('hisaab:' + k, JSON.stringify(v))
    set('meta', { version: 3 })
    set('settings', { cycleResetDay: 1, currencySymbol: '₨', theme: 'light', overallBudget: 50000, categoryBudgets: {} })
    set('expenses', [
      { id: 'e1', date: noon(1), amount: 900, categoryId: 'cat-food', note: 'Groceries', source: 'manual', createdAt: noon(1), accountId: 'acc1', receipts: [{ id: 'rc1', filename: 'r.png', mimeType: 'image/png', size: 4 }] },
      { id: 'e2', date: noon(2), amount: 120, categoryId: 'cat-food', note: 'Lunch', source: 'manual', createdAt: noon(2) } ])
    set('income', [{ id: 'i1', date: noon(3), amount: 5000, sourceType: 'salary', note: 'Salary', createdAt: noon(3), accountId: 'acc1' }])
    set('accounts', { accounts: [{ id: 'acc1', name: 'Meezan', type: 'bank', openingBalance: 10000, openingDate: '2026-09-01', archived: false, notes: '', order: 0, createdAt: noon(50) }], transfers: [], adjustments: [] })
    set('goals', [{ id: 'g1', name: 'Holiday', targetAmount: 1000, targetDate: null, startDay: '2026-10-01', savings: [{ id: 's1', date: '2026-11-01', amount: 150, note: '', createdAt: noon(3) }], note: '', createdAt: noon(20) }])
    localStorage.setItem('hisaab:ui:sidebarOpen', 'true')
    localStorage.setItem('hisaab:applock', JSON.stringify({ passwordHash: 'x', salt: 'y', createdAt: noon(9) }))
  } catch (e) {}
})()`

const hisaabDump = (p) => p.eval(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('hisaab:')).sort().map(k => [k, localStorage.getItem(k)])))`)
const idbFiles = (p) => p.eval(`(async () => { const dbs = await indexedDB.databases(); const out = { dbs: dbs.map(d => d.name + '@' + d.version).sort() }; if (dbs.some(d => d.name === 'hisaab-attachments')) { out.files = await new Promise((res) => { const r = indexedDB.open('hisaab-attachments'); r.onsuccess = () => { const db = r.result; const q = db.transaction('files').objectStore('files').getAll(); q.onsuccess = () => { db.close(); res(q.result.map(f => f.id + ':' + f.blob.size)) } } }) } return JSON.stringify(out) })()`)

try {
  // ============ 1. the OLD app, with data and a stored file
  await startOld()
  const { proc, wsUrl } = await launch({ profile: `${SCR}/chrome-profile-cutover`, port: 9580 })
  const p = new Page(wsUrl)
  await p.open()
  await p.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Karachi' })
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: SEED })
  await p.setViewport(1280, 900, false)
  await p.send('Page.navigate', { url: ORIGIN + '/#/dashboard' })
  await p.waitFor(`document.body.textContent.includes('Spent this cycle') || document.body.textContent.includes('Income this cycle')`, { timeout: 15000 })
  // a stored receipt file through the app's own database
  await p.eval(`new Promise((res) => { const r = indexedDB.open('hisaab-attachments', 1); r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' }); r.onsuccess = () => { const db = r.result; const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put({ id: 'rc1', expenseId: 'e1', kind: 'receipt', filename: 'r.png', mimeType: 'image/png', size: 4, blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }) }); tx.oncomplete = () => { db.close(); res(true) } } })`)
  // the old app also takes its migration snapshot at startup: give it time
  await sleep(1500)
  const registered = await p.eval(`navigator.serviceWorker.ready.then(r => !!r.active)`)
  check('OLD app: dashboard rendered and its service worker is active', registered)
  const before = await hisaabDump(p)
  const filesBefore = await idbFiles(p)
  console.log('   before:', JSON.parse(before) && Object.keys(JSON.parse(before)).length, 'hisaab keys;', filesBefore)

  // a REAL full backup, made by the old app's own Settings screen
  await p.eval(`location.hash = '#/settings'`)
  await p.waitFor(`document.body.textContent.includes('Backup & restore')`)
  await sleep(500)
  await p.eval(`window.__bk = null; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then(t => window.__bk = t); return orig.call(URL, b) }`)
  await p.clickText('Export full backup', 'button')
  await p.waitFor(`window.__bk !== null`, { timeout: 15000 })
  const oldBackup = await p.eval(`window.__bk`)
  writeFileSync(`${SCR}/cutover/old-app-backup.json`, oldBackup)
  const parsed = JSON.parse(oldBackup)
  check('OLD app exported a full backup (data version 3, attachments included)', parsed.kind === 'hisaab-full-backup' && parsed.schemaVersion === 3 && parsed.attachments?.length === 1, `${oldBackup.length} bytes`)

  // ============ 2. swap the server: the NEW app on the SAME origin
  await stop()
  await startNew()
  await p.send('Page.reload')
  await sleep(2500)
  await sleep(6000)
  // the old worker serves the old shell once; the new worker is found and the old app offers its update prompt
  const toast = await p.waitFor(`document.body.textContent.includes('A new version of Hisaab is available')`, { timeout: 20000 }).catch(() => false)
  check('the old app announces the new version (prompt-to-reload flow works across the cutover)', !!toast)
  await p.clickText('Reload', 'button')
  await sleep(3500)
  const nowNuxt = await p.eval(`!!document.querySelector('#__nuxt')`)
  check('after Reload the NEW (Nuxt) app is running', nowNuxt)
  const url1 = await p.eval(`location.pathname + location.hash`)
  check('the old hash address (#/settings) became the real path /settings', url1 === '/settings', url1)
  await p.waitFor(`document.body.textContent.includes('Backup & restore')`, { timeout: 15000 })
  const after = await hisaabDump(p)
  check('every hisaab:* localStorage key is unchanged byte for byte', before === after, before === after ? '' : 'differs')
  {
    const b = JSON.parse(filesBefore)
    const n = JSON.parse(await idbFiles(p))
    check('hisaab-attachments is still at version 1 with the same file, and no database was renamed or re-versioned', b.dbs.every((d) => n.dbs.includes(d)) && JSON.stringify(b.files) === JSON.stringify(n.files) && n.dbs.every((d) => /^hisaab-(attachments|backups)@1$/.test(d)), JSON.stringify(n))
  }
  await p.send('Page.navigate', { url: ORIGIN + '/expenses?cycle=all' })
  await sleep(3000)
  const t = await p.eval(`document.body.textContent.replace(/\\s+/g,' ')`)
  check('Expenses shows the seeded expenses with the receipt badge', t.includes('Groceries') && t.includes('Lunch') && (await p.eval(`!!document.querySelector('[data-testid=row-receipt]')`)))
  check('the saved light theme is applied', (await p.eval(`document.documentElement.getAttribute('data-theme')`)) === 'light')
  check('no page errors in the new app after the cutover', p.errors.length === 0, p.errors.slice(0, 2).join(' | '))
  proc.kill()

  // ============ 3. a real old-app backup file restored into a FRESH new app
  const fresh = await launch({ profile: `${SCR}/chrome-profile-cutover-fresh`, port: 9581 })
  const q = new Page(fresh.wsUrl)
  await q.open()
  await q.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Karachi' })
  await q.send('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('hisaab:session-unlocked','true')` })
  await q.setViewport(1280, 900, false)
  await q.send('Page.navigate', { url: ORIGIN + '/settings' })
  await q.waitFor(`document.body.textContent.includes('Backup & restore')`, { timeout: 15000 })
  await sleep(800)
  await q.send('DOM.enable')
  const { root } = await q.send('DOM.getDocument')
  const { nodeId } = await q.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
  await q.send('DOM.setFileInputFiles', { files: [`${SCR}/cutover/old-app-backup.json`], nodeId })
  await q.waitFor(`document.body.textContent.includes('Replace my data')`, { timeout: 10000 })
  const preview = await q.eval(`document.body.textContent.replace(/\\s+/g,' ')`)
  check('the import preview of the OLD app\'s file lists its records (expenses, accounts, goals)', /Expenses/.test(preview) && /Accounts/.test(preview) && /Goals/.test(preview) && !/did not|cannot be read/i.test(preview))
  await q.clickText('Replace my data', 'button')
  await sleep(3500)
  const ex = await q.eval(`JSON.parse(localStorage.getItem('hisaab:expenses') || '[]').map(e => e.id).join(',')`)
  const accts = await q.eval(`(JSON.parse(localStorage.getItem('hisaab:accounts') || '{}').accounts || []).length`)
  const goals = await q.eval(`JSON.parse(localStorage.getItem('hisaab:goals') || '[]').length`)
  check('restored: both expenses, the account and the goal', ex === 'e1,e2' && accts === 1 && goals === 1, `${ex} / ${accts} / ${goals}`)
  check('restored: the stored receipt file came back (4 bytes)', (await idbFiles(q)).includes('rc1:4'), await idbFiles(q))
  check('no page errors during the restore', q.errors.length === 0, q.errors.slice(0, 2).join(' | '))
  fresh.proc.kill()
} catch (e) {
  fails++
  console.log('SCENARIO ERROR', e.message)
} finally {
  await stop()
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
