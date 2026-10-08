// Prueba de punta a punta de la entrega 7 (PLAN_PALABRAS.md): las mismas palabras en toda la app, con tildes.
// - "NUEVO" abre un menú con las tres formas de empezar y cada una lleva a su pantalla (también con el teclado).
// - El tablero vacío muestra las tres como tarjetas; el menú de la izquierda dice "Nuevo presupuesto" sin "+ +".
// - El asistente: pastillas "1 Datos · 2 Trabajos · 3 Indirectos · 4 Listo"; cerrarlo a mitad y volver ofrece
//   "Tenés un presupuesto a medias" (Seguir trae lo cargado, Descartar lo borra); el botón final "Abrir el presupuesto".
// - Editor: un presupuesto hecho a mano no tiene "Diferencias con el Excel" (Ginkgo sí), la versión es la real
//   ("Sin versiones" → "v1") y mientras carga no aparece un nombre inventado.
// - Fórmulas: "Yeseria y durleria" del Maestro se ve "Yesería y durlería" y la búsqueda "yeseria" la encuentra.
// - Los mensajes del servidor se leen enteros: el aviso de la planilla simple en Cargar obra, y comillas, tildes y saltos
//   de línea en "Diferencias con el Excel" y "Versiones" (sin \" ni cortes).
// Corre contra vite (5179) + scripts/serve_fake.py (8000), con el servidor falso recién levantado (sin presupuestos).
// Uso: EXCEL_DIR=<carpeta con ginkgo.xlsx> SHOTS_DIR=<carpeta> NODE_PATH=<node_modules con playwright> node scripts/e2e_palabras.cjs
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const EXCEL = process.env.EXCEL_DIR || path.join(__dirname, 'excel')
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots-palabras')
fs.mkdirSync(SHOTS, { recursive: true })
const B = 'http://127.0.0.1:5179', API = 'http://127.0.0.1:8000'
let ok = 0, bad = 0
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); c ? ok++ : bad++ }
const j = async (method, url, body) => (await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()
const NOMBRE = 'Casa de Sol a medias'

const FORMAS = [
  { titulo: 'Cargar obra', linea: 'Subís el cómputo y la app le pone fórmulas y precios', ruta: '/app/cargar-obra', h1: 'CARGAR UNA OBRA' },
  { titulo: 'Nuevo presupuesto', linea: 'Armás los trabajos uno por uno', ruta: '/app/new-project', h1: 'CREAR PRESUPUESTO' },
  { titulo: 'Importar Excel', linea: 'Copiás un presupuesto ya hecho, con sus precios', ruta: '/app/import', h1: 'IMPORTAR EXCEL' },
]

// Ginkgo por la API, como e2e_un_solo_total (los rojos que no son de precio van "sin fórmula")
async function cargarGinkgo() {
  const buf = fs.readFileSync(path.join(EXCEL, 'ginkgo.xlsx'))
  const form = (asig, extra = {}) => {
    const f = new FormData()
    f.append('file', new Blob([buf]), 'ginkgo.xlsx')
    f.append('asignaciones', JSON.stringify(asig))
    for (const [k, v] of Object.entries(extra)) f.append(k, v)
    return f
  }
  const a = await (await fetch(API + '/obras/analizar', { method: 'POST', body: form({}) })).json()
  const asig = {}
  for (const t of a.tareas) if (t.estado === 'rojo' && t.motivo_rojo !== 'precio') asig[t.clave] = { plantillas: [] }
  const r = await fetch(API + '/obras/cargar', { method: 'POST', body: form(asig, { nombre: 'Ginkgo', permitir_sin_precio: 'true' }) })
  if (!r.ok) throw new Error('No se pudo cargar Ginkgo: ' + r.status + ' ' + (await r.text()))
  return (await r.json()).budget_id
}

;(async () => {
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  let page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  const shot = async (n, sel) => {
    if (sel) await page.locator(sel).first().scrollIntoViewIfNeeded()
    else await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 0))
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${SHOTS}/${n}.png` })
  }

  // 1. Tablero vacío: las tres formas de empezar como tarjetas
  check((await j('GET', '/budgets')).length === 0, 'el servidor falso arranca sin presupuestos')
  await page.goto(`${B}/app/dashboard`)
  const vacio = page.getByTestId('tablero-vacio')
  await vacio.waitFor({ timeout: 15000 })
  check(await vacio.getByText('Todavía no hay presupuestos.').count() === 1, 'tablero vacío: "Todavía no hay presupuestos."')
  check(await vacio.getByText('Elegí cómo querés empezar:').count() === 1, 'tablero vacío: "Elegí cómo querés empezar:"')
  const tarjetas = vacio.getByRole('button')
  check(await tarjetas.count() === 3, `tablero vacío: tres tarjetas (hay ${await tarjetas.count()})`)
  for (let i = 0; i < FORMAS.length; i++) {
    const t = (await tarjetas.nth(i).innerText()).replace(/\s+/g, ' ').trim()
    check(t === `${FORMAS[i].titulo} ${FORMAS[i].linea}`, `tarjeta ${i + 1}: "${t}"`)
  }
  await shot('01_tablero_vacio')
  for (const f of FORMAS) {
    await page.goto(`${B}/app/dashboard`)
    await vacio.getByRole('button', { name: new RegExp(`^${f.titulo}`) }).click()
    await page.getByRole('heading', { name: f.h1 }).waitFor({ timeout: 10000 }).catch(() => {})
    check(page.url().endsWith(f.ruta) && await page.getByRole('heading', { name: f.h1 }).count() === 1, `tarjeta "${f.titulo}" lleva a ${f.ruta} (${f.h1})`)
  }

  // 2. Menú de la izquierda: "Nuevo presupuesto" con el ícono, sin "+ +"
  const menuIzq = await page.locator('aside').innerText()
  check(/Nuevo presupuesto/.test(menuIzq) && !/\+\s*\+|\+ Nuevo/.test(menuIzq), 'menú de la izquierda: "Nuevo presupuesto", sin "+ +"')
  check(!/Dashboard|Analisis|CONFIGURACION|SESION/.test(menuIzq), 'menú de la izquierda: sin "Dashboard" y con tildes')

  // 3. "NUEVO": un menú con las tres formas; cada una lleva a su pantalla
  await page.goto(`${B}/app/dashboard`)
  const nuevo = page.locator('header').getByRole('button', { name: 'NUEVO' })
  await nuevo.click()
  const menu = page.getByRole('menu', { name: 'Formas de empezar un presupuesto' })
  await menu.waitFor({ timeout: 3000 })
  check(await nuevo.getAttribute('aria-expanded') === 'true', '"NUEVO" abre su menú (aria-expanded)')
  check(await menu.getByText('¿CÓMO QUERÉS EMPEZAR?').count() === 1, 'el menú pregunta "¿Cómo querés empezar?"')
  const opciones = menu.getByRole('menuitem')
  check(await opciones.count() === 3, `el menú tiene tres formas (hay ${await opciones.count()})`)
  for (let i = 0; i < FORMAS.length; i++) {
    const t = (await opciones.nth(i).innerText()).replace(/\s+/g, ' ').trim()
    check(t === `${FORMAS[i].titulo} ${FORMAS[i].linea}`, `opción ${i + 1}: "${t}"`)
  }
  await page.waitForTimeout(400) // que termine de aparecer
  await page.screenshot({ path: `${SHOTS}/02_menu_nuevo.png` })
  await page.mouse.click(640, 600); await page.waitForTimeout(200)
  check(await menu.count() === 0, 'un clic afuera cierra el menú')
  for (const f of FORMAS) {
    await page.goto(`${B}/app/dashboard`)
    await page.locator('header').getByRole('button', { name: 'NUEVO' }).click()
    await page.getByRole('menuitem', { name: new RegExp(`^${f.titulo}`) }).click()
    await page.getByRole('heading', { name: f.h1 }).waitFor({ timeout: 10000 }).catch(() => {})
    check(page.url().endsWith(f.ruta) && await page.getByRole('heading', { name: f.h1 }).count() === 1, `NUEVO → "${f.titulo}" lleva a ${f.ruta}`)
    check(await page.getByRole('menu').count() === 0, `NUEVO → "${f.titulo}": el menú se cierra`)
  }
  // con el teclado: ↓ abre en la primera, ↓ pasa a la segunda, Escape cierra y vuelve al botón
  await page.goto(`${B}/app/dashboard`)
  await nuevo.focus(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150)
  check(await page.evaluate(() => document.activeElement?.textContent?.startsWith('Cargar obra')), 'teclado: ↓ abre el menú en "Cargar obra"')
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100)
  check(await page.evaluate(() => document.activeElement?.textContent?.startsWith('Nuevo presupuesto')), 'teclado: ↓ pasa a "Nuevo presupuesto"')
  await page.keyboard.press('Escape'); await page.waitForTimeout(100)
  check(await page.getByRole('menu').count() === 0 && await page.evaluate(() => document.activeElement?.textContent?.includes('NUEVO')),
    'teclado: Escape cierra el menú y vuelve a "NUEVO"')
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150)
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100)
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: 'CREAR PRESUPUESTO' }).waitFor({ timeout: 10000 }).catch(() => {})
  check(page.url().endsWith('/app/new-project'), 'teclado: Enter en "Nuevo presupuesto" abre el asistente')

  // 4. Asistente: pastillas; cerrarlo a mitad y volver → "Tenés un presupuesto a medias"
  await page.waitForTimeout(800)
  const pastillas = (await page.getByTestId('pasos').locator('li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  check(JSON.stringify(pastillas) === JSON.stringify(['1 Datos', '2 Trabajos', '3 Indirectos', '4 Listo']), `pastillas: ${pastillas.join(' · ')}`)
  check(await page.getByTestId('pasos').locator('li[aria-current=step]').innerText() === '1\nDatos' ||
    /1\s*Datos/.test(await page.getByTestId('pasos').locator('li[aria-current=step]').innerText()), 'la pastilla del paso actual es "1 Datos"')
  check(await page.locator('span.mt-2.text-xs').count() === 0, 'ya no hay pasos en círculos')
  check(await page.getByTestId('borrador-nuevo').count() === 0, 'sin borrador: no ofrece seguir nada')
  await page.getByLabel(/Nombre del presupuesto/).fill(NOMBRE)
  await page.getByLabel('Descripción').fill('PH con patio')
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(500)
  check(/2\s*Trabajos/.test(await page.getByTestId('pasos').locator('li[aria-current=step]').innerText()), 'al seguir, la pastilla actual es "2 Trabajos"')
  check(await page.getByTestId('pasos').locator('li').first().locator('svg').count() === 1, 'el paso hecho ("Datos") lleva la tilde')
  await page.getByRole('checkbox', { name: 'Contrapiso', exact: true }).click()
  await page.getByLabel('Cantidad de Contrapiso', { exact: true }).fill('85')
  await shot('03_asistente_pastillas')
  await page.waitForTimeout(900) // el borrador se guarda medio segundo después del último cambio
  // "cerrar" el asistente: otra pestaña del mismo navegador
  await page.close()
  page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  await page.goto(`${B}/app/new-project`)
  const aviso = page.getByTestId('borrador-nuevo')
  await aviso.waitFor({ timeout: 10000 }).catch(() => {})
  const textoAviso = (await aviso.innerText().catch(() => '')).replace(/\s+/g, ' ')
  check(/Tenés un presupuesto a medias/.test(textoAviso) && textoAviso.includes(NOMBRE), `al volver: "${textoAviso}"`)
  check(await aviso.getByRole('button', { name: 'Seguir' }).count() === 1 && await aviso.getByRole('button', { name: 'Descartar' }).count() === 1, 'ofrece "Seguir" y "Descartar"')
  await page.screenshot({ path: `${SHOTS}/04_borrador_a_medias.png` })
  await aviso.getByRole('button', { name: 'Seguir' }).click(); await page.waitForTimeout(500)
  check(/2\s*Trabajos/.test(await page.getByTestId('pasos').locator('li[aria-current=step]').innerText()), 'Seguir: vuelve al paso "Trabajos"')
  check(await page.getByRole('checkbox', { name: 'Contrapiso', exact: true }).getAttribute('aria-checked') === 'true' &&
    await page.getByLabel('Cantidad de Contrapiso', { exact: true }).inputValue() === '85', 'Seguir: el contrapiso sigue tildado con 85')
  await page.getByRole('button', { name: /Anterior/ }).click(); await page.waitForTimeout(300)
  check(await page.getByLabel(/Nombre del presupuesto/).inputValue() === NOMBRE && await page.getByLabel('Descripción').inputValue() === 'PH con patio', 'Seguir: el nombre y la descripción siguen')
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Crear presupuesto' }).click()
  await page.getByRole('button', { name: 'Abrir el presupuesto' }).waitFor({ timeout: 10000 }).catch(() => {})
  check(/4\s*Listo/.test(await page.getByTestId('pasos').locator('li[aria-current=step]').innerText()), 'creado: la pastilla actual es "4 Listo"')
  check(await page.getByRole('button', { name: 'Abrir el presupuesto' }).count() === 1 && await page.getByText('Abrir en el editor').count() === 0, 'el botón final dice "Abrir el presupuesto"')
  const manual = (await j('GET', '/budgets')).find((x) => x.name === NOMBRE)
  check(!!manual, 'se creó el presupuesto hecho a mano')
  // creado: el borrador ya no está
  await page.goto(`${B}/app/new-project`); await page.waitForTimeout(1500)
  check(await page.getByTestId('borrador-nuevo').count() === 0, 'después de crear, no queda nada a medias')
  // Descartar: borra el borrador (y al volver ya no está)
  await page.getByLabel(/Nombre del presupuesto/).fill('Para descartar'); await page.waitForTimeout(900)
  await page.reload()
  await page.getByTestId('borrador-nuevo').waitFor({ timeout: 10000 }).catch(() => {})
  check(/Para descartar/.test(await page.getByTestId('borrador-nuevo').innerText().catch(() => '')), 'otro a medias: lo ofrece al recargar')
  await page.getByTestId('borrador-nuevo').getByRole('button', { name: 'Descartar' }).click(); await page.waitForTimeout(300)
  check(await page.getByTestId('borrador-nuevo').count() === 0 && await page.getByLabel(/Nombre del presupuesto/).inputValue() === '', 'Descartar: se va el aviso y arranca vacío')
  await page.reload(); await page.waitForTimeout(1500)
  check(await page.getByTestId('borrador-nuevo').count() === 0, 'Descartar: al volver ya no está')

  // Codex PR #44: el último cambio antes de irse no se pierde (sin esperar el medio segundo del guardado)
  await page.getByLabel(/Nombre del presupuesto/).fill('Trabajo anterior'); await page.waitForTimeout(900)
  await page.getByLabel(/Nombre del presupuesto/).fill('Trabajo corregido')
  await page.getByRole('link', { name: 'Mis presupuestos' }).first().click() // enseguida, sin esperar
  await page.waitForTimeout(800)
  await page.getByRole('link', { name: 'Nuevo presupuesto' }).first().click()
  await page.getByTestId('borrador-nuevo').waitFor({ timeout: 10000 }).catch(() => {})
  const ultimo = (await page.getByTestId('borrador-nuevo').innerText().catch(() => '')).replace(/\s+/g, ' ')
  check(/Trabajo corregido/.test(ultimo) && !/Trabajo anterior/.test(ultimo), `irse enseguida guarda el último cambio: "${ultimo}"`)
  // y al cerrar la pestaña enseguida, también
  await page.getByTestId('borrador-nuevo').getByRole('button', { name: 'Seguir' }).click(); await page.waitForTimeout(300)
  await page.getByLabel(/Nombre del presupuesto/).fill('Trabajo al cerrar')
  await page.close()
  page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  await page.goto(`${B}/app/new-project`)
  await page.getByTestId('borrador-nuevo').waitFor({ timeout: 10000 }).catch(() => {})
  check(/Trabajo al cerrar/.test(await page.getByTestId('borrador-nuevo').innerText().catch(() => '')), 'cerrar la pestaña enseguida guarda el último cambio')
  await page.getByTestId('borrador-nuevo').getByRole('button', { name: 'Descartar' }).click(); await page.waitForTimeout(300)
  await page.reload(); await page.waitForTimeout(1500)
  check(await page.getByTestId('borrador-nuevo').count() === 0, 'Descartar después de irse: no vuelve a aparecer')

  // 5. Editor del hecho a mano: sin "Diferencias con el Excel", versión real, sin nombre inventado mientras carga
  let soltar
  const espera = new Promise((r) => { soltar = r })
  // la API va por el proxy de vite (/api/...): se reconoce por el final de la dirección
  const esFull = (u) => u.pathname.endsWith(`/budgets/${manual.id}/full`)
  await page.route(esFull, async (r) => { await espera; await r.continue() })
  await page.goto(`${B}/app/budgets/${manual.id}/editor`)
  await page.getByTestId('nombre-cargando').waitFor({ timeout: 10000 }).catch(() => {})
  const cargando = await page.locator('main').innerText()
  check(await page.getByTestId('nombre-cargando').count() === 1, 'mientras carga: un renglón gris en lugar del nombre')
  check(!/Edificio Las Heras|EDIFICIO LAS HERAS|Obra Gris/.test(cargando), 'mientras carga: no aparece "Edificio Las Heras — Obra Gris"')
  check(!/\bv3\b/.test(cargando), 'mientras carga: no dice "v3"')
  await page.screenshot({ path: `${SHOTS}/05_editor_cargando.png` })
  soltar()
  await page.getByRole('heading', { name: NOMBRE.toUpperCase() }).waitFor({ timeout: 10000 })
  await page.unroute(esFull)
  await page.getByTestId('version-editor').waitFor({ timeout: 10000 }).catch(() => {})
  check(await page.getByTestId('nombre-cargando').count() === 0, 'cargado: muestra el nombre del presupuesto')
  check((await page.getByTestId('version-editor').innerText().catch(() => '')) === 'Sin versiones', 'sin versiones guardadas dice "Sin versiones"')
  check(await page.getByRole('button', { name: 'Diferencias con el Excel' }).count() === 0, 'hecho a mano: no ofrece "Diferencias con el Excel"')
  check(await page.getByRole('button', { name: 'Planos con IA' }).count() === 1 && await page.getByText('Estructura de obra', { exact: true }).locator('..').getByRole('button', { name: 'Rubro', exact: true }).count() === 1, 'el editor dice "Planos con IA" y "+ Rubro"')
  await page.getByRole('button', { name: 'Guardar versión' }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid=version-editor]')?.textContent === 'v1', null, { timeout: 8000 }).catch(() => {})
  check((await page.getByTestId('version-editor').innerText()) === 'v1', 'al guardar una versión pasa a "v1"')
  await shot('06_editor_a_mano')
  await page.reload(); await page.getByTestId('version-editor').waitFor({ timeout: 10000 }).catch(() => {})
  check((await page.getByTestId('version-editor').innerText().catch(() => '')) === 'v1', 'al volver a entrar sigue "v1" (la última guardada)')
  // si alguien entra por la dirección, la pantalla dice entero por qué no hay totales
  await page.goto(`${B}/app/budgets/${manual.id}/diferencias`)
  await page.getByRole('button', { name: /Cargar obra/ }).waitFor({ timeout: 10000 }).catch(() => {})
  const sinTot = await page.locator('main').innerText()
  check(/no tiene guardados los totales del Excel/i.test(sinTot) && !sinTot.includes('\\'), 'por la dirección: dice que no hay totales del Excel, entero')

  // 6. Mensajes enteros: comillas, tildes y saltos de línea (Diferencias y Versiones)
  const RARO = 'Este presupuesto no tiene los "totales" del Excel.\nSubilo de nuevo con «Cargar obra» y elegí la versión según «Ginkgo».'
  const esDif = (u) => u.pathname.endsWith(`/obras/${manual.id}/diferencias`)
  await page.route(esDif, (r) => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: { codigo: 'SIN_TOTALES', mensaje: RARO } }) }))
  await page.goto(`${B}/app/budgets/${manual.id}/diferencias`)
  await page.getByText(/Subilo de nuevo/).waitFor({ timeout: 10000 }).catch(() => {})
  const pDif = await page.getByText(/Subilo de nuevo/).innerText().catch(() => '')
  check(pDif === RARO, `Diferencias: el mensaje sale entero, con comillas y salto de línea (${JSON.stringify(pDif)})`)
  await page.unroute(esDif)
  const RARO2 = 'No hay precios nuevos para "Contrapiso H°8".\nRevisá la lista «Maestro» y probá de nuevo.'
  const esActualizar = (u) => u.pathname.endsWith(`/budgets/${manual.id}/actualizar-precios`)
  await page.route(esActualizar, (r) => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: RARO2 }) }))
  await page.goto(`${B}/app/budgets/${manual.id}/versions`)
  await page.getByRole('button', { name: /Actualizar a precios de hoy/ }).click()
  await page.getByText(/No hay precios nuevos/).waitFor({ timeout: 10000 }).catch(() => {})
  const pVer = await page.getByText(/No hay precios nuevos/).innerText().catch(() => '')
  check(pVer === RARO2, `Versiones: el mensaje sale entero (${JSON.stringify(pVer)})`)
  check(await page.getByRole('button', { name: 'Guardar versión' }).count() === 1, 'Versiones: el botón dice "Guardar versión"')
  await page.unroute(esActualizar)

  // 7. Ginkgo (vino de un Excel con totales): sí tiene "Diferencias con el Excel"
  const ginkgo = await cargarGinkgo()
  await page.goto(`${B}/app/budgets/${ginkgo}/editor`)
  await page.getByRole('heading', { name: 'GINKGO' }).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'Diferencias con el Excel' }).waitFor({ timeout: 10000 }).catch(() => {})
  check(await page.getByRole('button', { name: 'Diferencias con el Excel' }).count() === 1, 'Ginkgo: ofrece "Diferencias con el Excel"')
  await page.getByRole('button', { name: 'Diferencias con el Excel' }).click()
  await page.waitForTimeout(2500)
  check(page.url().endsWith(`/app/budgets/${ginkgo}/diferencias`) && !/no tiene guardados los totales/i.test(await page.locator('main').innerText()), 'Ginkgo: "Diferencias con el Excel" abre la comparación')

  // 8. Cargar obra con la planilla simple que baja la app: desde el PR #46 se acepta (antes era un error). Se analiza
  //    y la pantalla avisa, con el texto entero, que se compara contra los precios de esa planilla.
  const simple = path.join(SHOTS, 'ginkgo_planilla_simple.xlsx')
  fs.writeFileSync(simple, Buffer.from(await (await fetch(`${API}/budgets/${ginkgo}/export/excel`)).arrayBuffer()))
  await page.goto(`${B}/app/cargar-obra`)
  await page.setInputFiles('input[type=file]', simple)
  const avisoSimple = page.getByTestId('aviso-planilla-simple')
  await avisoSimple.waitFor({ timeout: 60000 }).catch(() => {})
  const msg = (await avisoSimple.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
  console.log('      aviso: ' + JSON.stringify(msg))
  check(msg.startsWith('Es la planilla simple que bajó la app (Exportar)') && await page.getByTestId('error-cargar-obra').count() === 0,
    'Cargar obra: la planilla simple se acepta y dice que es la que bajó la app (sin error)')
  check(await page.getByText('trabajos distintos').isVisible(), 'Cargar obra: con la planilla simple muestra los trabajos para revisar')
  check(msg.endsWith('no contra el Excel original de la obra.'), 'Cargar obra: el aviso sale entero (termina en "no contra el Excel original de la obra.")')
  check(!msg.includes('\\') && !msg.includes('{'), 'Cargar obra: sin \\" ni pedazos de JSON')
  await shot('07_cargar_obra_planilla_simple', '[data-testid=aviso-planilla-simple]')

  // 9. Fórmulas: las categorías del Maestro con tildes y la búsqueda sin tildes
  await page.goto(`${B}/app/templates`)
  await page.getByTestId('formula').first().waitFor({ timeout: 15000 })
  check(await page.getByRole('button', { name: 'Yesería y durlería', exact: true }).count() === 1, 'rubro "Yeseria y durleria" se ve "Yesería y durlería"')
  check(await page.getByRole('button', { name: 'Albañilería', exact: true }).count() === 1, 'rubro "Albañileria" se ve "Albañilería"')
  check(!/Yeseria y durleria|Albañileria/.test(await page.locator('main').innerText()), 'no queda "Yeseria y durleria" ni "Albañileria" a la vista')
  const buscar = page.getByPlaceholder(/Buscá una fórmula/)
  await buscar.fill('yeseria'); await page.waitForTimeout(300)
  const sinTilde = await page.getByTestId('formula').count()
  check(sinTilde >= 1 && await page.getByTestId('formula').filter({ hasText: 'Yesería y durlería' }).count() === sinTilde, `"yeseria" encuentra las de Yesería (${sinTilde}), con tildes`)
  await buscar.fill('yesería'); await page.waitForTimeout(300)
  check(await page.getByTestId('formula').count() === sinTilde, '"yesería" (con tilde) encuentra las mismas')
  await shot('08_formulas_con_tildes')
  await buscar.fill('')
  await page.getByRole('button', { name: 'Yesería y durlería', exact: true }).click(); await page.waitForTimeout(300)
  check(await page.getByTestId('formula').count() >= sinTilde, 'elegir "Yesería y durlería" filtra por ese rubro')

  console.log(`\n${ok} OK, ${bad} FALLAS`); await b.close(); if (bad) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
