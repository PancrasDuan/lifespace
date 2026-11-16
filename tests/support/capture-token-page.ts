import type { Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'

async function capture(page: Page, path: string, fullPage: boolean) {
  const files = [...(await readdir('src/token')).filter(file => /\.(tsx?|css)$/.test(file)).map(file => `src/token/${file}`), 'src/app/App.tsx', 'src/auth/token-confirmation-return.ts', 'src/auth/AuthGate.tsx', 'src/app/AppLayout.tsx', 'src/app/AppNavigation.tsx', 'src/shared/token-backend-contract.ts'].sort()
  const source = createHash('sha256')
  for (const file of files) source.update(file).update(await readFile(file))
  const state = await page.evaluate(() => ({ scrollY, touch: navigator.maxTouchPoints > 0, coarsePointer: matchMedia('(pointer:coarse)').matches, focusedElement: document.activeElement?.tagName }))
  await page.screenshot({ path, fullPage })
  await writeFile(path + '.json', JSON.stringify({ viewport: page.viewportSize(), fullPage, ...state, sourceSha256: source.digest('hex') }, null, 2) + '\n')
}

export async function captureTokenPage(page: Page, path: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
  await capture(page, path, true)
}

export const captureTokenViewport = (page: Page, path: string) => capture(page, path, false)
