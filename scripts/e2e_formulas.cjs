// Prueba de punta a punta de la pantalla Fórmulas: botón "+ Nueva fórmula" arriba y siempre a la vista, buscador
// (nombre, rubro o número; todas las palabras, sin tildes), número chico delante del nombre, orden natural por número,
// fórmula nueva con el rubro elegido (queda resaltada y a la vista) y quien solo mira no ve el botón.
// Corre contra vite (5179) + scripts/serve_fake.py (8000), con el servidor falso recién levantado.
// Uso: NODE_PATH=<node_modules con playwright> node scripts/e2e_formulas.cjs
const path = require('path')
const { chromium } = require('playwright')
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots-formulas')
require('fs').mkdirSync(SHOTS, { recursive: true })
const B = 'http://127.0.0.1:5179', API = 'http://127.0.0.1:8000'
let ok = 0, bad = 0
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); c ? ok++ : bad++ }
const j = async (method, url, body) => (await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()
const RUBRO = 'Yeseria y durleria'
// Como lo muestra la pantalla (entrega 7): con tildes; el dato guardado no cambia
const RUBRO_VISTO = 'Yesería y durlería'

// ¿El elemento está entero dentro de la ventana?
async function aLaVista(page, loc) {
  const bb = await loc.boundingBox()
  const vp = page.viewportSize()
  return !!bb && bb.y >= 0 && bb.y + bb.height <= vp.height && bb.x >= 0 && bb.x + bb.width <= vp.width
}

;(async () => {
  // La fórmula 6.11 (el Maestro de prueba llega a 6.10; la API no deja crear con número)
  await j('POST', '/__fake/insert/item_templates', [{
    codigo: '6.11', nombre: 'CIELORRASO APLICADO DE YESO', unidad: 'm2', categoria: RUBRO,
    descripcion: 'Importado del Maestro TERRAC (solapa 6.11).', origen: 'maestro_terrac', desperdicio_pct: null,
    recursos: [{ tipo: 'material', codigo: 'M-YESO', descripcion: 'Yeso', unidad: 'kg', formula: 'Q * 12' }], parametros: [],
  }])
  const total = (await j('GET', '/templates')).length

  const b = await chromium.launch()
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${B}/app/templates`)
  await page.getByTestId('formula').first().waitFor({ timeout: 15000 })

  // 1. El botón está arriba, a la vista sin bajar, y es el único (se fue el recuadro punteado del final)
  const boton = page.getByRole('button', { name: 'Nueva fórmula' })
  check(await boton.count() === 1, `hay un solo botón "Nueva fórmula" (vino ${await boton.count()})`)
  const bb = await boton.boundingBox()
  check(!!bb && bb.y < 200 && bb.x > 600, `el botón está arriba a la derecha (x=${bb && Math.round(bb.x)}, y=${bb && Math.round(bb.y)})`)
  check(await page.getByText(`${total} fórmulas`, { exact: true }).first().count() > 0, `muestra "${total} fórmulas"`)
  await page.screenshot({ path: SHOTS + '/01_formulas_arriba.png' })
  // Al bajar hasta el fondo la cabecera queda fija
  await page.locator('main').evaluate((m) => m.scrollTo(0, m.scrollHeight))
  await page.waitForTimeout(400)
  check(await aLaVista(page, boton), 'después de bajar hasta el fondo, el botón sigue a la vista')
  check(await aLaVista(page, page.getByPlaceholder(/Buscá una fórmula/)), 'el buscador también sigue a la vista')
  await page.screenshot({ path: SHOTS + '/02_abajo_cabecera_fija.png' })
  await page.locator('main').evaluate((m) => m.scrollTo(0, 0))

  // 2. Buscador
  const buscar = page.getByPlaceholder('Buscá una fórmula: nombre, rubro o número (ej. 6.11)')
  check(await buscar.count() === 1, 'buscador con el texto "Buscá una fórmula: nombre, rubro o número (ej. 6.11)"')
  await buscar.fill('cielorraso aplicado'); await page.waitForTimeout(300)
  let cards = page.getByTestId('formula')
  check(await cards.count() >= 1 && /CIELORRASO APLICADO DE YESO/.test(await cards.first().innerText()), '"cielorraso aplicado" encuentra la 6.11')
  const contador = (await page.getByTestId('contador-formulas').innerText()).trim()
  check(new RegExp(`^${await cards.count()} de ${total} fórmulas`).test(contador), `contador "${contador}"`)
  await buscar.fill('aplicado cielorraso'); await page.waitForTimeout(300)
  check(/CIELORRASO APLICADO/.test(await page.getByTestId('formula').first().innerText()), 'las palabras en otro orden también')
  await buscar.fill('Cielorráso APLICADO'); await page.waitForTimeout(300)
  check(await page.getByTestId('formula').count() >= 1, 'con tilde y mayúsculas también')
  await buscar.fill('6.11'); await page.waitForTimeout(300)
  cards = page.getByTestId('formula')
  check(await cards.count() === 1 && (await cards.first().getByTestId('formula-codigo').innerText()).trim() === '6.11', '"6.11" encuentra la fórmula 6.11, con su número')
  const cod = cards.first().getByTestId('formula-codigo')
  const estilo = await cod.evaluate((e) => { const c = getComputedStyle(e); return { size: parseFloat(c.fontSize), color: c.color } })
  const nombre = await cards.first().getByText('CIELORRASO APLICADO DE YESO').evaluate((e) => { const c = getComputedStyle(e); return { size: parseFloat(c.fontSize), color: c.color } })
  check(estilo.size < nombre.size && estilo.color !== nombre.color, `el número va chico (${estilo.size}px < ${nombre.size}px) y en otro color, gris (${estilo.color})`)
  const ordenEnTarjeta = await cards.first().evaluate((el) => { const t = el.innerText; return t.indexOf('6.11') < t.indexOf('CIELORRASO') })
  check(ordenEnTarjeta, 'el número va delante del nombre')
  await page.screenshot({ path: SHOTS + '/03_busca_6_11.png' })
  await buscar.fill('yeseria'); await page.waitForTimeout(300)
  check(await page.getByTestId('formula').count() >= 11, 'busca por rubro: "yeseria" trae las de Yesería')
  await buscar.fill('zzzz cosa'); await page.waitForTimeout(300)
  const vacio = page.getByTestId('sin-resultados')
  check(await vacio.getByText('Ninguna fórmula dice «zzzz cosa».').count() === 1, 'sin resultados: "Ninguna fórmula dice «zzzz cosa»."')
  check(await vacio.getByText(/Probá con otra palabra o creá una nueva/).count() === 1 && await vacio.getByRole('button', { name: 'Nueva fórmula' }).count() === 1,
    'sin resultados: "Probá con otra palabra o creá una nueva" con el botón')
  await page.screenshot({ path: SHOTS + '/04_sin_resultados.png' })
  await vacio.getByRole('button', { name: 'Borrar la búsqueda' }).click(); await page.waitForTimeout(300)
  check(await page.getByTestId('formula').count() === total, '"Borrar la búsqueda" vuelve a mostrar todas')

  // 3. Rubro + orden natural por número
  await page.getByRole('button', { name: RUBRO_VISTO, exact: true }).click(); await page.waitForTimeout(300)
  const codigos = await page.getByTestId('formula-codigo').allInnerTexts()
  const esperado = ['6.1', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.8', '6.9', '6.10', '6.11']
  check(JSON.stringify(codigos.map((c) => c.trim())) === JSON.stringify(esperado), `orden por número: ${codigos.join(', ')}`)
  await buscar.fill('aplicado'); await page.waitForTimeout(300)
  check(await page.getByTestId('formula').count() === 1, 'el buscador se combina con el rubro elegido')

  // 4. Fórmula nueva con el rubro elegido (y una búsqueda que la escondería)
  await boton.click()
  const modal = page.locator('div.fixed.inset-0')
  await modal.getByText('Nueva fórmula', { exact: true }).waitFor({ timeout: 5000 })
  check(true, 'la ventana dice "Nueva fórmula"')
  const catInput = modal.locator('label', { hasText: 'Categoría' }).locator('input')
  check(await catInput.inputValue() === RUBRO, `arranca con el rubro elegido en "Categoría" (vino "${await catInput.inputValue()}")`)
  await modal.locator('label', { hasText: 'Nombre' }).first().locator('input').fill('Buña perimetral de prueba')
  await modal.locator('label', { hasText: 'Unidad' }).locator('input').fill('ml')
  await page.screenshot({ path: SHOTS + '/05_nueva_formula.png' })
  await modal.getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.getByText('Fórmula creada').waitFor({ timeout: 8000 })
  await page.waitForTimeout(900)
  const nueva = page.locator('[data-testid="formula"]', { hasText: 'Buña perimetral de prueba' })
  check(await nueva.count() === 1, 'la fórmula nueva aparece en la lista')
  check(await buscar.inputValue() === '', 'la búsqueda que la escondía se limpió')
  check(await page.getByRole('button', { name: RUBRO_VISTO, exact: true }).getAttribute('aria-pressed') === 'true', 'el rubro sigue elegido (no la escondía)')
  check(await nueva.getByText('Fórmula creada').count() === 1, 'queda marcada "Fórmula creada"')
  check(await aLaVista(page, nueva), 'la lista bajó hasta ella: está a la vista')
  await page.screenshot({ path: SHOTS + '/06_formula_creada.png' })
  await page.waitForTimeout(5000)
  check(await page.getByText('Fórmula creada').count() === 0, 'la marca se va sola después de un momento')
  // Creada con otro rubro elegido: se vuelve a "Todos los rubros" para que se vea
  await page.getByRole('button', { name: 'Albañilería', exact: true }).click(); await page.waitForTimeout(200)
  await boton.click()
  await modal.getByText('Nueva fórmula', { exact: true }).waitFor()
  await modal.locator('label', { hasText: 'Nombre' }).first().locator('input').fill('Prueba sin rubro')
  await modal.locator('label', { hasText: 'Categoría' }).locator('input').fill('')
  await modal.getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.getByText('Fórmula creada').waitFor({ timeout: 8000 }); await page.waitForTimeout(900)
  check(await page.getByRole('button', { name: 'Todos los rubros' }).getAttribute('aria-pressed') === 'true', 'si el rubro elegido la escondía, vuelve a "Todos los rubros"')
  const sinNumero = page.locator('[data-testid="formula"]', { hasText: 'Prueba sin rubro' })
  check(await aLaVista(page, sinNumero), 'la nueva (sin número) queda a la vista, al final de la lista')

  // 5. Celular (400 px): la cabecera se apila, el botón a lo ancho debajo del título, sin barra horizontal
  const m = await b.newPage({ viewport: { width: 400, height: 800 } })
  await m.goto(`${B}/app/templates`)
  await m.getByTestId('formula').first().waitFor({ timeout: 15000 })
  const h1 = await m.getByRole('heading', { name: 'FÓRMULAS' }).boundingBox()
  const bm = await m.getByRole('button', { name: 'Nueva fórmula' }).boundingBox()
  const cab = await m.getByTestId('cabecera-formulas').boundingBox()
  check(!!h1 && !!bm && bm.y > h1.y + h1.height - 2, 'celular: el botón va debajo del título')
  check(!!bm && !!cab && bm.width > cab.width - 60, `celular: el botón va a lo ancho (${bm && Math.round(bm.width)} de ${cab && Math.round(cab.width)} px)`)
  const anchos = await m.evaluate(() => {
    const main = document.querySelector('main')
    return { doc: document.documentElement.scrollWidth, win: window.innerWidth, main: main.scrollWidth, mainVisible: main.clientWidth }
  })
  check(anchos.doc <= anchos.win && anchos.main <= anchos.mainVisible + 1, `celular: sin barra horizontal (${JSON.stringify(anchos)})`)
  await m.screenshot({ path: SHOTS + '/07_celular.png' })

  // 6. Quien solo mira: no ve el botón (ni en el vacío de la búsqueda), pero puede buscar
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  const v = await ctx.newPage()
  await v.route('**/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    user_id: 'mira', email: 'mira@terrac.com', org_id: 'test-org-uuid', role: 'member',
    orgs: [{ id: 'test-org-uuid', name: 'TERRAC SA', slug: 'terrac', role: 'member' }],
  }) }))
  await v.goto(`${B}/app/templates`)
  await v.getByTestId('formula').first().waitFor({ timeout: 15000 })
  check(await v.getByRole('button', { name: 'Nueva fórmula' }).count() === 0, 'quien solo mira no ve "Nueva fórmula"')
  await v.getByPlaceholder(/Buscá una fórmula/).fill('6.11'); await v.waitForTimeout(300)
  check(await v.getByTestId('formula').count() === 1, 'quien solo mira puede buscar')
  await v.getByPlaceholder(/Buscá una fórmula/).fill('zzzz'); await v.waitForTimeout(300)
  check(await v.getByTestId('sin-resultados').getByRole('button', { name: 'Nueva fórmula' }).count() === 0
    && await v.getByText('Probá con otra palabra.', { exact: true }).count() === 1, 'quien solo mira: el vacío no ofrece crear')
  await v.screenshot({ path: SHOTS + '/08_solo_mira.png' })

  console.log(`\n${ok} OK, ${bad} FALLAS`); await b.close(); if (bad) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
