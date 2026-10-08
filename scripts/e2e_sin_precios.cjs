// End-to-end check with an Excel that has no prices (ginkgo_sin_precios.xlsx, made by scripts/make_ginkgo_sin_precios.py).
// Runs against vite (5179) + scripts/serve_fake.py (8000).
// Usage: EXCEL_DIR=<folder with ginkgo_sin_precios.xlsx> NODE_PATH=<node_modules with playwright> node scripts/e2e_sin_precios.cjs
// Screenshots go to EXCEL_DIR/shots-sin-precios.
const { chromium } = require('playwright')
const path = require('path')

const S = process.env.EXCEL_DIR || path.join(__dirname, 'excel')
const XLSX = path.join(S, 'ginkgo_sin_precios.xlsx')
const BASE = 'http://127.0.0.1:5179'
const shots = path.join(S, 'shots-sin-precios')
require('fs').mkdirSync(shots, { recursive: true })

async function shot(page, name) {
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true })
  console.log('shot', name)
}

let fallas = 0
function check(nombre, ok, extra = '') {
  console.log(ok ? 'OK   ' : 'FALLA', nombre, extra)
  if (!ok) fallas++
}

const SIN_PRECIO = 'no tiene precio en el Excel'
const sinRevisando = (page) => page.waitForFunction(() => !document.body.innerText.includes('Revisando'), null, { timeout: 120000 })

;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })

  // 1. Upload the Excel without prices
  await page.goto(BASE + '/app/cargar-obra')
  await page.setInputFiles('input[type=file]', XLSX)
  await page.getByText('trabajos distintos').waitFor({ timeout: 120000 })
  await sinRevisando(page)
  await shot(page, '01_analisis')
  const texto = await page.locator('body').innerText()

  check('aviso "Este Excel no trae precios"', texto.includes('Este Excel no trae precios: la app calcula todo con las fórmulas y la lista de precios.'))

  // 2. Red cards: no recipe and no price in the Excel
  const tarjetas = page.locator('div.border-l-4').filter({ hasText: SIN_PRECIO })
  const nRojas = await tarjetas.count()
  check('hay tarjetas rojas con "no tiene precio en el Excel"', nRojas > 0, `(${nRojas})`)
  const textos = await page.locator('div.border-l-4').allInnerTexts()
  check('las tarjetas no muestran "· Excel $"', !textos.some((t) => /· Excel \$/.test(t)))
  if (nRojas === 0) {
    console.log('Sin tarjetas rojas no se puede seguir')
    console.log(`\n${fallas} verificaciones FALLARON`)
    process.exitCode = 1
    await browser.close()
    return
  }

  // 3. Status sentence and load button
  const frase = texto.match(/Te falt(a|an) [^\n]*/)?.[0] ?? ''
  check('la frase de estado menciona "fórmulas"', /fórmulas?/.test(frase), JSON.stringify(frase))
  const cargar = page.getByRole('button', { name: 'Cargar presupuesto' })
  let bloqueado = await cargar.isDisabled()
  if (!bloqueado) {
    await cargar.click()
    bloqueado = await page.getByText('sin fórmula y sin precio en el Excel').first().isVisible({ timeout: 30000 }).catch(() => false)
  }
  check('"Cargar presupuesto" no deja cargar mientras falten fórmulas', bloqueado)

  // 4. A red card offers "Quizás sea" and "Elegir fórmula", but not "Confirmar"
  const roja = tarjetas.first()
  const descripcion = (await roja.locator('div.text-sm.font-medium').first().innerText()).trim()
  check('la tarjeta roja tiene "Elegir fórmula"', (await roja.getByRole('button', { name: 'Elegir fórmula' }).count()) === 1)
  check('la tarjeta roja no tiene "Confirmar"', (await roja.getByRole('button', { name: 'Confirmar', exact: true }).count()) === 0)
  check('la tarjeta roja dice "Falta resolver"', (await roja.innerText()).includes('Falta resolver'))

  // 5. The recipe search does not offer the Excel price
  await roja.getByRole('button', { name: 'Elegir fórmula' }).click()
  const buscador = roja.getByTestId('lista-formulas')
  await buscador.waitFor()
  await shot(page, '02_buscador')
  check('el buscador no ofrece "Usar el precio del Excel"', (await roja.getByText('Usar el precio del Excel').count()) === 0)
  check('el buscador no manda al precio del Excel', !(await roja.innerText()).includes('usá el precio del Excel'))

  // 6. Pick the first recipe: the card stops saying it has no price
  const antes = nRojas
  const primera = buscador.locator('button').first()
  console.log('fórmula elegida:', (await primera.innerText()).replace(/\n/g, ' '))
  await primera.click()
  await page.waitForTimeout(300)
  await sinRevisando(page)
  await shot(page, '03_despues_de_elegir')
  const misma = page.locator('div.border-l-4').filter({ hasText: descripcion }).filter({ hasText: SIN_PRECIO })
  check('la tarjeta deja de decir "no tiene precio en el Excel"', (await misma.count()) === 0)
  const despues = await page.locator('div.border-l-4').filter({ hasText: SIN_PRECIO }).count()
  check('hay una tarjeta roja menos', despues === antes - 1, `(${antes} -> ${despues})`)

  if (fallas) {
    console.log(`\n${fallas} verificaciones FALLARON`)
    process.exitCode = 1
  }

  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
