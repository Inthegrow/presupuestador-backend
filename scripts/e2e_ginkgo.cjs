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

let fallas = 0
function check(nombre, ok, extra = '') {
  console.log(ok ? 'OK   ' : 'FALLA', nombre, extra)
  if (!ok) fallas++
}

const rojosDe = async (page) => Number((await page.locator('body').innerText()).match(/Rojos \((\d+)\)/)?.[1] ?? -1)
const sinRevisando = (page) => page.waitForFunction(() => !document.body.innerText.includes('Revisando'), null, { timeout: 120000 })

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

  // 2d. "Cambiar" explica qué es el buscador de recetas (PLAN_UX_2, 3.4)
  const botonCambiar = page.getByRole('button', { name: /^(Cambiar|Elegir receta)$/ }).first()
  await botonCambiar.click()
  check('buscador explica qué es', await page.getByText('Elegí la receta correcta para este trabajo. Si ninguna sirve, usá el precio del Excel.').isVisible())
  check('opción verde en dos líneas',
    await page.getByText('Usar el precio del Excel (sin receta)').isVisible()
    && await page.getByText('Se carga con lo que cobró tu Excel; la app no desglosa materiales.').isVisible())
  await page.getByRole('button', { name: 'Cerrar', exact: true }).first().click()

  // 2e. Confirmo un amarillo (queda en las asignaciones) y recargo: el borrador sigue en el navegador (3.2)
  const confirmar = page.getByRole('button', { name: 'Confirmar', exact: true })
  const hayConfirmar = (await confirmar.count()) > 0
  console.log('amarillos para confirmar:', await confirmar.count())
  if (hayConfirmar) {
    await confirmar.first().click()
    await sinRevisando(page)
  }
  const rojosAntes = await rojosDe(page)
  const confirmarAntes = await confirmar.count() // one less than before the click
  console.log('rojos antes de recargar:', rojosAntes, '| amarillos sin confirmar:', confirmarAntes)
  await page.waitForTimeout(1500) // the draft is saved 500 ms after the last change
  await page.reload()
  await page.getByText('Tenías una carga a medias').waitFor({ timeout: 30000 })
  const tarjetaBorrador = await page.locator('body').innerText()
  check('tarjeta con el nombre del archivo', tarjetaBorrador.includes('ginkgo.xlsx'))
  check('tarjeta con "hace"', /hace (un momento|\d+ minutos?)/.test(tarjetaBorrador))
  await shot(page, '05b_borrador')
  const pedidoSeguir = page.waitForRequest((r) => r.url().includes('/obras/analizar'), { timeout: 30000 })
  await page.getByRole('button', { name: 'Seguir', exact: true }).click()
  await pedidoSeguir
  await page.getByText('trabajos distintos').waitFor({ timeout: 120000 })
  await sinRevisando(page)
  // The multipart body is not readable from Playwright: check the effect instead (the confirmed task stays confirmed)
  if (hayConfirmar) check('Seguir manda las asignaciones guardadas', (await confirmar.count()) === confirmarAntes,
    `(${confirmarAntes} sin confirmar antes y ${await confirmar.count()} después)`)
  const rojosDespues = await rojosDe(page)
  check('mismos rojos después de Seguir', rojosDespues === rojosAntes, `(${rojosAntes} -> ${rojosDespues})`)
  check('la tarjeta del borrador desaparece al seguir', (await page.getByText('Tenías una carga a medias').count()) === 0)
  await shot(page, '05c_despues_de_seguir')

  // 3. Cargar el presupuesto
  const nombre = page.getByPlaceholder('Nombre del presupuesto')
  await nombre.fill('')
  await nombre.fill('EDIFICIO GINKGO')
  const permitir = page.getByLabel(/Cargar igual/)
  if (await permitir.count()) await permitir.check()
  // 3.5: contador mientras calcula (la espera arranca antes del clic para no perder el estado)
  const calculando = page.getByText(/Calculando \d+ trabajos?… \d+ s/).waitFor({ timeout: 30000 }).then(() => true, () => false)
  await page.getByRole('button', { name: 'Cargar presupuesto' }).click()
  check('botón con contador al cargar', await calculando)
  check('aviso de espera al cargar', await page.getByText('Puede tardar un minuto: la app arma los materiales de cada trabajo y recalcula la obra.').isVisible().catch(() => false))
  await page.getByText('Total calculado por la app').waitFor({ timeout: 180000 })
  await shot(page, '07_cargado')
  // 3.6: qué pasó con los amarillos
  const sinConfirmar = await page.getByText(/entr(aron|ó) sin confirmar/).first().innerText().catch(() => '')
  check('el resultado dice qué pasó con los amarillos', /entr(aron|ó) sin confirmar/.test(sinConfirmar) && /Para confirmar/.test(sinConfirmar), sinConfirmar)

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

  // 4b. Costo directo y margen (PLAN_UX_2, 3.7)
  const botonDirecto = page.getByRole('button', { name: 'Costo directo (sin margen)' })
  const botonFinal = page.getByRole('button', { name: 'Precio final' })
  check('el conmutador arranca en costo directo', (await botonDirecto.getAttribute('aria-pressed')) === 'true')
  check('línea de costo directo', await page.getByText('Acá se ven las recetas: lo que cuesta hacer cada trabajo, sin margen.').isVisible())
  check('columnas de costo', /EXCEL \(COSTO\)/i.test(t3) && /APP \(COSTO\)/i.test(t3))
  const tarjetaMargen = page.locator('div.rounded-xl').filter({ hasText: 'Si querés que coincidan, ajustá la cadena de markups del presupuesto.' }).first()
  const textoMargen = await tarjetaMargen.innerText()
  check('tarjeta Margen con los dos porcentajes', /Tu Excel: [\d.,]+% promedio · La app: [\d.,]+%/.test(textoMargen), textoMargen.replace(/\n/g, ' | '))
  const tarjetas = async () => ({
    excel: await page.locator('div.rounded-xl').filter({ hasText: 'Excel de Sol' }).first().innerText(),
    app: await page.locator('div.rounded-xl').filter({ hasText: /^La app/ }).first().innerText(),
  })
  const directo = await tarjetas()
  const filasDirecto = await page.locator('tbody tr').first().innerText()
  await shot(page, '08b_diferencias_directo')
  await botonFinal.click()
  await page.waitForTimeout(300)
  check('"Precio final" está activo', (await botonFinal.getAttribute('aria-pressed')) === 'true')
  check('línea de precio final', await page.getByText('Lo que cobra cada uno, con su margen.').isVisible())
  const final = await tarjetas()
  check('"Precio final" cambia los números', final.app !== directo.app, `(${directo.app.replace(/\n/g, ' ')} -> ${final.app.replace(/\n/g, ' ')})`)
  check('"Precio final" cambia las filas', (await page.locator('tbody tr').first().innerText()) !== filasDirecto)
  check('columnas sin "(costo)" en precio final', !/\(COSTO\)/i.test(await page.locator('thead').first().innerText()))
  await shot(page, '08c_diferencias_precio_final')
  await botonDirecto.click()
  await page.waitForTimeout(300)
  check('volver a costo directo restaura los números', (await tarjetas()).app === directo.app)

  // 4c. Al cargar, el borrador se borró (PLAN_UX_2, 3.2)
  await page.goto(BASE + '/app/cargar-obra')
  await page.getByText('1. SUBÍ EL EXCEL').waitFor()
  await page.waitForTimeout(1000)
  check('sin borrador después de cargar', (await page.getByText('Tenías una carga a medias').count()) === 0)

  console.log(fallas ? `\n${fallas} verificaciones FALLARON` : '\nTodas las verificaciones nuevas pasaron')
  if (fallas) process.exitCode = 1

  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
