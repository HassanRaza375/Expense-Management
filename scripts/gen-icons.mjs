import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pub = join(__dirname, '..', 'public')
const src = join(__dirname, '..', 'assets-src')

const maskableSvg = readFileSync(join(src, 'icon-maskable-source.svg'))
const iconSvg = readFileSync(join(src, 'icon-source.svg'))

async function run() {
  await sharp(iconSvg).resize(192, 192).png().toFile(join(pub, 'pwa-192x192.png'))
  await sharp(iconSvg).resize(512, 512).png().toFile(join(pub, 'pwa-512x512.png'))
  await sharp(iconSvg).resize(180, 180).flatten({ background: '#1B4A4D' }).png().toFile(join(pub, 'apple-touch-icon.png'))
  await sharp(iconSvg).resize(32, 32).png().toFile(join(pub, 'favicon-32x32.png'))
  await sharp(iconSvg).resize(16, 16).png().toFile(join(pub, 'favicon-16x16.png'))

  await sharp(maskableSvg).resize(512, 512).png().toFile(join(pub, 'maskable-icon-512x512.png'))

  console.log('icons generated')
}

run()
