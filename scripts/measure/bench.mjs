// A/B startup benchmark: interleaved cold runs of two builds (time until the Dashboard shows content, 300 seeded expenses).
//   node scripts/measure/bench.mjs <urlA> <urlB> [runs]
// A first run right after launching Chrome adds hundreds of ms of jitter, so every run waits a moment before navigating and the two builds alternate.
import { launch, Page, sleep } from './cdp.mjs'
import os from 'node:os'
const SCR = `${os.tmpdir().replace(/\\/g, "/")}/hisaab-measure`
const A = process.argv[2]
const B = process.argv[3]
const RUNS = Number(process.argv[4] || 12)
const SEED = `(() => { try { sessionStorage.setItem('hisaab:session-unlocked','true'); if (localStorage.getItem('__s')) return; localStorage.setItem('__s','1'); localStorage.setItem('hisaab:meta', JSON.stringify({version:3})); localStorage.setItem('hisaab:settings', JSON.stringify({cycleResetDay:1,currencySymbol:'₨',theme:'dark',overallBudget:50000,categoryBudgets:{}})); const ex=[]; for(let i=0;i<300;i++){ const d=new Date(); d.setDate(d.getDate()-(i%40)); ex.push({id:'e'+i,date:d.toISOString(),amount:100+i%17*10,categoryId:'cat-food',note:'n'+i,source:'manual',createdAt:d.toISOString()}) } localStorage.setItem('hisaab:expenses', JSON.stringify(ex)) } catch(e){} })()`

async function once(url, i) {
  const { proc, wsUrl } = await launch({ profile: `${SCR}/chrome-profile-bench-${Date.now()}-${i}`, port: 9620 + (i % 60) })
  const p = new Page(wsUrl)
  try {
    await p.open()
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: SEED })
    await p.setViewport(1280, 900, false)
    await sleep(700) // let the browser settle so launch jitter is not counted
    await p.send('Page.navigate', { url })
    const t = await p.waitFor(`(() => { const t = document.body ? document.body.textContent : ''; return (t.includes('Spent this cycle') || t.includes('Nothing tracked yet')) ? Math.round(performance.now()) : 0 })()`, { timeout: 20000 })
    return t
  } finally {
    proc.kill()
    await sleep(300)
  }
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const ra = []
const rb = []
for (let i = 0; i < RUNS; i++) {
  ra.push(await once(A, i * 2))
  rb.push(await once(B, i * 2 + 1))
}
const stats = (a) => `median ${median(a)} ms (min ${Math.min(...a)}, max ${Math.max(...a)})`
console.log('A', A, stats(ra))
console.log('B', B, stats(rb))
