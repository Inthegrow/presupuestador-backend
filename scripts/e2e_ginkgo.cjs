// Prueba de punta a punta con el Excel de Ginkgo. Corre contra vite (5179) + scripts/serve_fake.py (8000).
// Uso: EXCEL_DIR=<carpeta con ginkgo.xlsx> NODE_PATH=<node_modules con playwright> node scripts/e2e_ginkgo.cjs
// Deja las capturas en EXCEL_DIR/shots.
const { chromium } = require('playwright')
const path = require('path')

const S = process.env.EXCEL_DIR || path.join(__dirname, 'excel')
const XLSX = path.join(S, 'ginkgo.xlsx')
const BASE = 'http://127.0.0.1:5179'
const shots = path.join(S, 'shots')
require('fs').mkdirSync(shots, { recursive: true })

async function shot(page, name) {
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true })
  console.log('shot', name)
}

async function subir(page) {
  await page.goto(BASE + '/app/cargar-obra')
  await page.setInputFiles('input[type=file]', XLSX)
  await page.getByText('trabajos distintos').waitFor({ timeout: 120000 })
  await page.waitForFunction(() => !document.body.innerText.includes('Revisando'), null, { timeout: 120000 })
}

;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })

  // 1. Catálogos: todo "solo consulta" al principio; marcamos el Maestro como oficial
  await page.goto(BASE + '/app/catalogs')
  await page.getByText('Maestro TERRAC - Materiales').waitFor()
  await shot(page, '01_catalogos_sin_oficial')
  const botones = page.getByRole('button', { name: 'Marcar como oficial' })
  console.log('botones marcar:', await botones.count())
  for (let i = 0; i < 4; i++) {
    // los 4 del Maestro son los primeros de la lista (más nuevos)
    await page.getByRole('button', { name: 'Marcar como oficial' }).first().click()
    await page.waitForTimeout(400)
  }
  await shot(page, '02_catalogos_maestro_oficial')
  console.log('chips Oficial:', await page.getByText('Oficial', { exact: true }).count())

  // 2. Cargar obra: análisis con el Excel de Ginkgo
  await subir(page)
  await shot(page, '03_analisis')
  const texto = await page.locator('body').innerText()
  console.log(texto.match(/\d+ trabajos distintos[^\n]*/)?.[0], '|', texto.match(/Falta resolver[^\n]*|Todo listo[^\n]*/)?.[0])

  // 2b. Conversión como dato: buscar una tarjeta con "cambiar"
  const cambiar = page.getByRole('button', { name: 'cambiar', exact: true })
  console.log('enlaces cambiar:', await cambiar.count())
  if (await cambiar.count()) {
    const card = page.locator('div.border-l-4').filter({ has: cambiar.first() }).first()
    const titulo = await card.locator('div.text-sm.font-medium').first().innerText()
    await card.screenshot({ path: path.join(shots, '04_conversion_como_dato.png') })
    await cambiar.first().click()
    const misma = page.locator('div.border-l-4').filter({ hasText: titulo }).first()
    await misma.screenshot({ path: path.join(shots, '04b_conversion_editar.png') })
    console.log('campo visible tras cambiar:', await misma.locator('input[type=number]').count())
  }

  // 2b'. Fallas de UX (PLAN_UX_CARGAR_OBRA): aviso del título, espesor del nombre, frase de estado, membrana amarilla
  console.log('aviso título dudoso:', texto.includes("El Excel dice 'EDIFICIO LAS HERAS'"))
  console.log('espesor del nombre:', texto.includes('(por los 8 cm del nombre)'), texto.includes('(por los 4 cm del nombre)'))
  console.log('frase de estado:', texto.match(/Te faltan[^\n]*|Faltan? \d+ precios?[^\n]*/)?.[0])
  const membrana = page.locator('div.border-l-4').filter({ hasText: 'MEMBRANA LIQUIDA' }).first()
  console.log('membrana líquida:', (await membrana.innerText()).split('\n').filter((l) => /Para confirmar|Falta resolver|Sin receta|Quizás/.test(l)).join(' | '))

  // 2c. Panel de precios con las propuestas del Excel (ahora arriba de las tarjetas, abierto si hay rojos)
  const guardarVisible = await page.getByRole('button', { name: /Guardar los \d+ precios que trae el Excel/ }).isVisible().catch(() => false)
  if (!guardarVisible) { await page.getByText('Precios para corregir').click(); await page.waitForTimeout(300) }
  const panelBox = await page.getByText('Precios para corregir').boundingBox()
  const primeraTarjeta = await page.locator('div.border-l-4').first().boundingBox()
  console.log('panel arriba de las tarjetas:', panelBox && primeraTarjeta && panelBox.y < primeraTarjeta.y)
  await page.evaluate(() => { const m = document.querySelector('main'); if (m) m.scrollTo(0, 0); window.scrollTo(0, 0) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, '05a_panel_arriba.png') })
  await shot(page, '05_precios_propuestos')

  // 2c'. "Va en $0" para un perfil que Sol también tiene en $0
  const filaY = page.locator('tr').filter({ hasText: 'Y-M4X1' }).first()
  await filaY.getByRole('button', { name: 'Va en $0' }).click()
  // La fila desaparece cuando el análisis vuelve sin ese código
  await filaY.waitFor({ state: 'detached', timeout: 120000 })
  await page.waitForFunction(() => !document.body.innerText.includes('Revisando'), null, { timeout: 120000 })
  const t1 = await page.locator('body').innerText()
  console.log('Y-M4X1 después de "Va en $0":', t1.includes('Y-M4X1') ? 'sigue en pantalla (mal)' : 'ya no está (bien)')
  console.log('frase de estado:', t1.match(/Te faltan[^\n]*|Faltan? \d+ precios?[^\n]*/)?.[0])
  const guardarTodos = page.getByRole('button', { name: /Guardar los \d+ precios que trae el Excel/ })
  console.log('guardar todos:', await guardarTodos.count(), await guardarTodos.count() ? await guardarTodos.first().innerText() : '')
  if (await guardarTodos.count()) {
    await guardarTodos.first().click()
    await page.waitForFunction(() => !/Guardando/.test(document.body.innerText), null, { timeout: 120000 })
    await page.waitForFunction(() => !document.body.innerText.includes('Revisando'), null, { timeout: 120000 })
    await page.waitForTimeout(500)
    await shot(page, '06_despues_de_guardar')
    const t2 = await page.locator('body').innerText()
    console.log(t2.match(/Falta resolver[^\n]*|Todo listo[^\n]*/)?.[0], '|', t2.match(/Precios para corregir \(\d+\)|Todos los materiales tienen precio/)?.[0])
  }

  // 3. Cargar el presupuesto
  const nombre = page.getByPlaceholder('Nombre del presupuesto')
  await nombre.fill('')
  await nombre.fill('EDIFICIO GINKGO')
  const permitir = page.getByLabel(/Cargar igual/)
  if (await permitir.count()) await permitir.check()
  await page.getByRole('button', { name: 'Cargar presupuesto' }).click()
  await page.getByText('Total calculado por la app').waitFor({ timeout: 180000 })
  await shot(page, '07_cargado')

  // 4. Diferencias con el Excel
  await page.getByRole('button', { name: 'Ver diferencias con el Excel' }).click()
  await page.waitForURL(/diferencias/)
  await page.waitForTimeout(1500)
  await shot(page, '08_diferencias')
  const filas = page.locator('tbody tr')
  console.log('filas diferencias:', await filas.count())
  if (await filas.count()) {
    await filas.first().click()
    await page.waitForTimeout(300)
    await shot(page, '09_diferencias_detalle')
  }
  const t3 = await page.locator('body').innerText()
  console.log(t3.split('\n').slice(0, 30).join(' | '))

  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
