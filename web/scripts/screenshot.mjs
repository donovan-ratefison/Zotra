// One PNG of one page, at 1366 x 768.
import { chromium } from 'playwright'

/* global process, console */

const [url, out] = process.argv.slice(2)
if (!url || !out) {
  console.error('usage: node scripts/screenshot.mjs <url> <out.png>')
  process.exit(1)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.screenshot({ path: out })
await browser.close()
