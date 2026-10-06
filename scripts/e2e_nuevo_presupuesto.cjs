// Prueba de punta a punta del asistente "Nuevo Presupuesto" (entrega 3, PLAN_ASISTENTE.md):
// sin paso Precios (línea de la lista oficial en Datos), lo tildado no se pierde al ir y volver,
// indirectos de la empresa con los nueve conceptos y "Precio final por cada $100" igual al del servidor,
// errores a la vista, y create-full deja cada trabajo dentro de su rubro con los % de esta obra.
// Corre contra vite (5179) + scripts/serve_fake.py (8000), con el servidor falso recién levantado.
// Uso: NODE_PATH=<node_modules con playwright> node scripts/e2e_nuevo_presupuesto.cjs
const path = require('path')
const { execFileSync } = require('child_process')
const { chromium } = require('playwright')
const ROOT = path.join(__dirname, '..')
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots-asistente')
require('fs').mkdirSync(SHOTS, { recursive: true })
const B = 'http://127.0.0.1:5179', API = 'http://127.0.0.1:8000'
let ok = 0, bad = 0
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); c ? ok++ : bad++ }
const j = async (method, url, body) => (await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()
const CLAVES = ['imprevistos_pct', 'estructura_pct', 'jefatura_pct', 'logistica_pct', 'herramientas_pct', 'beneficio_pct', 'ingresos_brutos_pct', 'imp_cheque_pct', 'iva_pct']
const NOMBRE = 'Casa Prueba Asistente'
// Lo que cobra el servidor por $100 de directo: la misma calc_cascade_indirects de app/calculations.py
const precioServidor = (cfg) => Number(execFileSync('python3', ['-c',
  'import json, sys; sys.path.insert(0, sys.argv[2]); from app.calculations import calc_cascade_indirects; ' +
  'print(calc_cascade_indirects({"directo_total": 100}, json.loads(sys.argv[1]))["total_final"])',
  JSON.stringify(cfg), ROOT]).toString().trim())
const pesosANumero = (t) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'))
const TILDES = [
  ['Tareas Preliminares', 'Obrador e instalaciones provisorias', null],
  ['Tareas Preliminares', 'Limpieza y preparación del terreno', null],
  ['Tareas Preliminares', 'Cerco perimetral de obra', '40'],
  ['Albañilería', 'Contrapiso', '120'],
  ['Albañilería', 'Revoques gruesos', '300'],
]

;(async () => {
  const generalAntes = await j('GET', '/indirects/general')
  const b = await chromium.launch()
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } })
  // The page scrolls inside <main>: go to the top (or to `sel`) before each capture
  const shot = async (n, sel) => {
    if (sel) await page.locator(sel).first().scrollIntoViewIfNeeded()
    else await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 0))
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${SHOTS}/${n}.png` })
  }

  // 1. Datos: sin paso Precios; sin lista oficial lo dice; el nombre es obligatorio y se avisa
  await page.goto(`${B}/app/new-project`); await page.waitForTimeout(1500)
  const pasos = await page.locator('span.mt-2.text-xs').allTextContents()
  check(JSON.stringify(pasos) === JSON.stringify(['Datos', 'Estructura', 'Indirectos', 'Resultado']), `pasos: ${pasos.join(' → ')}`)
  check(/todavía no hay lista oficial/.test(await page.getByTestId('linea-precios').textContent()), 'sin lista oficial: lo dice en Datos')
  check(await page.getByText(/Superficie|Duración/).count() === 0, 'no pide superficie ni duración (no hay dónde guardarlas)')
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(300)
  check(await page.getByRole('alert').filter({ hasText: 'Falta el nombre del presupuesto.' }).count() === 1, 'sin nombre: error en rojo y no avanza')
  await shot('00_datos_sin_nombre_sin_oficial')
  // con lista oficial: la nombra con la fecha de hoy
  const cats = await j('GET', '/catalogs')
  for (const c of cats) if (c.name.startsWith('Maestro')) await j('PATCH', `/catalogs/${c.id}`, { oficial: true })
  await page.reload(); await page.waitForTimeout(1500)
  const linea = await page.getByTestId('linea-precios').textContent()
  const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  check(/se usa la lista oficial Maestro TERRAC \(Materiales, Mano de obra, Equipos y Subcontratos\), con precios al /.test(linea) && linea.includes(`precios al ${hoy}.`), `línea de precios: "${linea}"`)
  await page.getByLabel(/Nombre del presupuesto/).fill(NOMBRE)
  await page.getByLabel('Descripción').fill('PH en dos plantas')
  await shot('01_datos')

  // 2. Estructura: 5 trabajos en 2 rubros
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(500)
  check(await page.getByRole('button', { name: /Subir plano \(IA\)/ }).count() === 1 && await page.getByRole('button', { name: /Importar JSON/ }).count() === 1, 'siguen "Subir plano (IA)" e "Importar JSON"')
  for (const [, desc, cant] of TILDES) {
    await page.getByRole('checkbox', { name: desc, exact: true }).click()
    if (cant) await page.getByLabel(`Cantidad de ${desc}`, { exact: true }).fill(cant)
  }
  await page.waitForTimeout(300)
  check(/Se van a crear 2 rubros con 5 trabajos/.test(await page.getByTestId('resumen-estructura').textContent()), 'resumen: 2 rubros con 5 trabajos')
  await shot('02_estructura')
  await shot('02b_estructura_tildados', 'text=Revoques gruesos')

  // 3. Indirectos: los de la empresa, los nueve
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(1000)
  const enPantalla = {}
  for (const k of CLAVES) enPantalla[k] = Number(await page.locator(`#ind-${k}`).inputValue())
  check(CLAVES.every((k) => enPantalla[k] === generalAntes[k]), `arranca con los de la empresa: ${JSON.stringify(enPantalla)}`)
  for (const t of ['Imprevistos', 'Estructura', 'Jefatura', 'Logística', 'Herramientas', 'Beneficio', 'Ingresos Brutos', 'Impuesto al cheque', 'IVA'])
    check(await page.locator('label', { hasText: new RegExp(`^${t}`) }).count() === 1, `muestra "${t}"`)
  check(await page.getByText(/Total sobre costo directo/).count() === 0, 'sin el "Total sobre costo directo"')
  let precio = pesosANumero(await page.getByTestId('precio-final-100').textContent())
  let esperado = precioServidor(generalAntes)
  check(precio === esperado, `precio final por $100 = ${precio} (servidor: ${esperado})`)
  await shot('03_indirectos_empresa')

  // 4. Ir y volver: lo tildado y las cantidades siguen
  await page.getByRole('button', { name: /Anterior/ }).click(); await page.waitForTimeout(400)
  let tildados = 0
  for (const [, desc] of TILDES) if (await page.getByRole('checkbox', { name: desc, exact: true }).getAttribute('aria-checked') === 'true') tildados++
  check(tildados === 5, `al volver a Estructura siguen tildados ${tildados} de 5`)
  check(await page.getByLabel('Cantidad de Contrapiso', { exact: true }).inputValue() === '120', 'la cantidad del contrapiso sigue en 120')
  await page.getByRole('button', { name: /Anterior/ }).click(); await page.waitForTimeout(400)
  check(await page.getByLabel(/Nombre del presupuesto/).inputValue() === NOMBRE, 'el nombre sigue en Datos')
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(400)
  check(/2 rubros con 5 trabajos/.test(await page.getByTestId('resumen-estructura').textContent()), 'ida y vuelta: siguen 2 rubros con 5 trabajos')
  await shot('04_estructura_al_volver', 'text=Cerco perimetral de obra')
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(400)

  // 5. Beneficio 20 %: vale solo para este presupuesto
  await page.locator('#ind-beneficio_pct').fill('20'); await page.waitForTimeout(300)
  check(await page.getByText(`(empresa: ${generalAntes.beneficio_pct} %)`).count() === 1, 'al cambiar el beneficio muestra el de la empresa al lado')
  precio = pesosANumero(await page.getByTestId('precio-final-100').textContent())
  esperado = precioServidor({ ...generalAntes, beneficio_pct: 20 })
  check(precio === esperado, `con beneficio 20 %: precio final por $100 = ${precio} (servidor: ${esperado})`)
  await shot('05_indirectos_beneficio_20')

  // 6. Un error del servidor se ve arriba del botón y no avanza
  await page.route('**/budgets/create-full', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Se cortó la conexión con la base"}' }))
  await page.getByRole('button', { name: 'Crear presupuesto' }).click(); await page.waitForTimeout(800)
  check(await page.getByRole('alert').filter({ hasText: 'No se pudo crear el presupuesto: Se cortó la conexión con la base' }).count() === 1, 'error del servidor: en rojo, con lo que dijo')
  check(await page.getByRole('button', { name: 'Crear presupuesto' }).count() === 1, 'con error no avanza (sigue en Indirectos)')
  await shot('06_error_servidor', '[role=alert]')
  await page.unroute('**/budgets/create-full')
  // un % fuera de rango tampoco avanza
  await page.locator('#ind-iva_pct').fill('140')
  await page.getByRole('button', { name: 'Crear presupuesto' }).click(); await page.waitForTimeout(300)
  check(await page.getByRole('alert').filter({ hasText: 'IVA tiene que estar entre 0 y 100 %.' }).count() === 1, 'IVA 140 %: lo avisa y no crea')
  await page.locator('#ind-iva_pct').fill(String(generalAntes.iva_pct))

  // 7. Crear
  await page.getByRole('button', { name: 'Crear presupuesto' }).click(); await page.waitForTimeout(1500)
  check(await page.getByTestId('rubros-creados').textContent() === '2' && await page.getByTestId('trabajos-creados').textContent() === '5', 'resultado: 2 rubros, 5 trabajos')
  await shot('07_resultado')

  // 8. Por la API: cada trabajo dentro de su rubro, los % de esta obra, los de la empresa sin cambios
  const budgets = (await j('GET', '/budgets')).filter((x) => x.name === NOMBRE)
  check(budgets.length === 1, `se creó un solo presupuesto "${NOMBRE}" (hay ${budgets.length})`)
  const bud = budgets[0]
  const items = await j('GET', `/budgets/${bud.id}/items`)
  const rubros = Object.fromEntries(items.filter((i) => !i.parent_id).map((i) => [i.description, i.id]))
  check(Object.keys(rubros).sort().join('|') === 'Albañilería|Tareas Preliminares', `rubros: ${Object.keys(rubros).join(', ')}`)
  for (const [rubro, desc, cant] of TILDES) {
    const it = items.find((i) => i.description === desc)
    check(!!it && it.parent_id === rubros[rubro] && (!cant || Number(it.cantidad) === Number(cant)),
      `"${desc}" queda dentro de "${rubro}"${cant ? ` con cantidad ${cant}` : ''}`)
  }
  const ind = bud.indirectos || {}
  check(ind.beneficio_pct === 20, `el presupuesto guardó beneficio 20 (guardó ${ind.beneficio_pct})`)
  check(CLAVES.filter((k) => k !== 'beneficio_pct').every((k) => ind[k] === generalAntes[k]), `guardó los otros ocho conceptos: ${JSON.stringify(ind)}`)
  const generalDespues = await j('GET', '/indirects/general')
  check(CLAVES.every((k) => generalDespues[k] === generalAntes[k]), 'los indirectos generales de la empresa no cambiaron')

  // 9. El editor muestra los trabajos adentro de sus rubros
  await page.getByRole('button', { name: 'Abrir en el editor' }).click(); await page.waitForTimeout(2500)
  check(page.url().includes(`/app/budgets/${bud.id}/editor`), 'abre el editor del presupuesto nuevo')
  await shot('08_editor')

  // 10. Subir plano (IA) + Definir manual: si la IA falla no queda nada creado; Cancelar no crea nada;
  //     al confirmar, los rubros del plano van después de los armados a mano
  const PLANO = 'Prueba plano'
  const conNombre = async () => (await j('GET', '/budgets')).filter((x) => x.name === PLANO)
  await page.goto(`${B}/app/new-project`); await page.waitForTimeout(1500)
  await page.getByLabel(/Nombre del presupuesto/).fill(PLANO)
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Definir manual/ }).click()
  await page.getByPlaceholder(/Nombre del rubro/).fill('Demolición')
  await page.getByRole('button', { name: /Agregar trabajo/ }).click()
  await page.getByPlaceholder('Descripción del trabajo').fill('Picado de revoques')
  await page.getByPlaceholder('Cant.').fill('30')
  await page.getByRole('button', { name: /Subir plano \(IA\)/ }).click()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  await page.locator('input[type=file]').setInputFiles({ name: 'plano.png', mimeType: 'image/png', buffer: png })
  await page.waitForTimeout(300)
  check(/1 rubro con 1 trabajo, más los que encuentre la IA en el plano plano\.png/.test(await page.getByTestId('resumen-estructura').textContent()), 'resumen con el plano: 1 rubro con 1 trabajo, más los de la IA')
  await shot('09_estructura_plano_y_manual')
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(800)
  // sin IA en el servidor falso: error a la vista y no queda un presupuesto a medias
  await page.getByRole('button', { name: 'Analizar plano y crear' }).click(); await page.waitForTimeout(1500)
  check(await page.getByRole('alert').filter({ hasText: /No se pudo analizar el plano: .*OPENAI_API_KEY/ }).count() === 1, 'la IA no anda: lo dice en rojo, con lo que dijo el servidor')
  check((await conNombre()).length === 0, 'la IA no anda: no queda un presupuesto a medias')
  await shot('10_plano_error_ia', '[role=alert]')
  // con lo que contestaría la IA
  await page.route('**/analyze-plan', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    budget_id: 'x', proyecto: {}, total_items: 2, secciones: [{ nombre: 'Estructura', codigo: '1', items: [
      { codigo: '1.1', descripcion: 'Platea de fundación', unidad: 'm2', cantidad: 80, notas: '', notas_calculo: '' },
      { codigo: '1.2', descripcion: 'Columnas de hormigón', unidad: 'm3', cantidad: 6, notas: '', notas_calculo: '' },
    ] }] }) }))
  await page.getByRole('button', { name: 'Analizar plano y crear' }).click(); await page.waitForTimeout(1500)
  check(await page.getByText('REVISIÓN DE LOS TRABAJOS QUE ENCONTRÓ LA IA').count() === 1, 'muestra la revisión de lo que encontró la IA')
  await page.getByRole('button', { name: /Cancelar \(no se crea nada\)/ }).click(); await page.waitForTimeout(800)
  check((await conNombre()).length === 0, 'Cancelar en la revisión: no queda ningún presupuesto')
  await page.getByRole('button', { name: 'Analizar plano y crear' }).click(); await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOTS}/11_revision_ia.png` })
  await page.getByRole('button', { name: /Confirmar y crear \(2 trabajos\)/ }).click(); await page.waitForTimeout(2000)
  check(await page.getByTestId('rubros-creados').textContent() === '2' && await page.getByTestId('trabajos-creados').textContent() === '3', 'plano + manual: 2 rubros, 3 trabajos')
  await page.unroute('**/analyze-plan')
  const planos = await conNombre()
  check(planos.length === 1, `plano + manual: un solo presupuesto "${PLANO}" (hay ${planos.length})`)
  if (planos.length) {
    const its = await j('GET', `/budgets/${planos[0].id}/items`)
    const rub = Object.fromEntries(its.filter((i) => !i.parent_id).map((i) => [i.description, i]))
    const dentro = (d, r) => its.some((i) => i.description === d && rub[r] && i.parent_id === rub[r].id)
    check(dentro('Picado de revoques', 'Demolición') && dentro('Platea de fundación', 'Estructura') && dentro('Columnas de hormigón', 'Estructura'),
      'plano + manual: cada trabajo dentro de su rubro')
    check(rub['Demolición']?.code === '1' && rub['Estructura']?.code === '2', `códigos de rubro: Demolición ${rub['Demolición']?.code}, Estructura ${rub['Estructura']?.code}`)
  }

  // 11. Usuario que no es administrador (no puede borrar presupuestos): nunca queda un presupuesto escondido ni duplicado
  await page.route(/\/budgets\/[0-9a-f-]{36}$/, (r) => r.request().method() === 'DELETE'
    ? r.fulfill({ status: 403, contentType: 'application/json', body: '{"detail":"Esta acción es solo para administradores"}' })
    : r.continue())
  const conPlano = async (nombre) => {
    await page.goto(`${B}/app/new-project`); await page.waitForTimeout(1500)
    await page.getByLabel(/Nombre del presupuesto/).fill(nombre)
    await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(400)
    await page.getByRole('checkbox', { name: 'Contrapiso', exact: true }).click()
    await page.getByRole('button', { name: /Subir plano \(IA\)/ }).click()
    await page.locator('input[type=file]').setInputFiles({ name: 'plano.png', mimeType: 'image/png', buffer: png })
    await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(800)
  }
  const cuantos = async (nombre) => (await j('GET', '/budgets')).filter((x) => x.name === nombre).length
  // la IA falla y no se puede deshacer: muestra lo creado con el aviso, no se queda en un paso que crearía otro
  await conPlano('Plano editor falla')
  await page.getByRole('button', { name: 'Analizar plano y crear' }).click(); await page.waitForTimeout(1500)
  check(await page.getByRole('status').filter({ hasText: /La IA no pudo analizar el plano .*se creó con los demás trabajos/ }).count() === 1
    && await page.getByTestId('trabajos-creados').textContent() === '1', 'editor, la IA falla: resultado con 1 trabajo y el aviso de que el plano no se leyó')
  check(await cuantos('Plano editor falla') === 1, 'editor, la IA falla: queda un solo presupuesto, a la vista')
  await shot('12_editor_ia_falla')
  // Cancelar en la revisión no puede borrar: lo dice, y se puede seguir sin los trabajos del plano
  await page.route('**/analyze-plan', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    budget_id: 'x', proyecto: {}, total_items: 1, secciones: [{ nombre: 'Estructura', codigo: '1', items: [
      { codigo: '1.1', descripcion: 'Platea de fundación', unidad: 'm2', cantidad: 80, notas: '', notas_calculo: '' }] }] }) }))
  await conPlano('Plano editor cancela')
  await page.getByRole('button', { name: 'Analizar plano y crear' }).click(); await page.waitForTimeout(1500)
  await page.getByRole('button', { name: /Cancelar \(no se crea nada\)/ }).click(); await page.waitForTimeout(800)
  check(await page.getByRole('alert').filter({ hasText: /solo un administrador puede borrarlo/ }).count() === 1, 'editor, Cancelar: explica que no se puede borrar y qué hacer')
  await page.getByRole('button', { name: 'Destildar todos' }).last().click()
  await page.screenshot({ path: `${SHOTS}/13_editor_no_puede_cancelar.png` })
  await page.getByRole('button', { name: 'Crear sin los trabajos del plano' }).click(); await page.waitForTimeout(1500)
  check(await page.getByTestId('trabajos-creados').textContent() === '1' && await cuantos('Plano editor cancela') === 1, 'editor: crea sin los trabajos del plano, un solo presupuesto')
  await page.unroute('**/analyze-plan')

  // 8. Importar JSON (Codex, PR #39): tipos inválidos se rechazan con error visible, sin romper el asistente
  //    y sin pisar lo ya importado; un JSON válido arma sus rubros
  const subirJson = async (nombre, contenido) => {
    await page.locator('input[type="file"][accept=".json"]').setInputFiles({ name: nombre, mimeType: 'application/json', buffer: Buffer.from(contenido) })
    await page.waitForTimeout(600)
  }
  await page.goto(`${B}/app/new-project`); await page.waitForTimeout(1500)
  await page.getByLabel(/Nombre del presupuesto/).fill('JSON raro')
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Importar JSON/ }).click(); await page.waitForTimeout(300)
  await subirJson('nombre_numero.json', '[{"nombre":123,"items":[]}]')
  check(await page.getByRole('alert').filter({ hasText: 'Rubro 1: el nombre tiene que ser texto.' }).count() === 1, 'JSON con nombre numérico: error visible')
  check(await page.getByText('Estructura importada').count() === 0 && await page.getByRole('button', { name: /Importar JSON/ }).count() === 1, 'JSON con nombre numérico: no importa y el asistente sigue andando')
  await subirJson('valido.json', '[{"nombre":"Pintura","items":[{"descripcion":"Pintura interior","unidad":"m2","cantidad":120}]}]')
  check(await page.getByText(/Estructura importada: 1 rubros,\s*1 trabajos/).count() === 1 && await page.getByRole('alert').count() === 0, 'JSON válido: arma su rubro y borra el error')
  await subirJson('descripcion_numero.json', '[{"nombre":"Rubro","items":[{"descripcion":123}]}]')
  check(await page.getByRole('alert').filter({ hasText: 'Rubro 1, trabajo 1: la descripción tiene que ser texto.' }).count() === 1, 'JSON con descripción numérica: error visible')
  check(await page.getByText(/Estructura importada: 1 rubros,\s*1 trabajos/).count() === 1, 'el JSON rechazado no pisa el que ya estaba importado')
  await page.screenshot({ path: `${SHOTS}/14_json_rechazado.png` })
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(800)
  await page.getByRole('button', { name: /Crear presupuesto/i }).click(); await page.waitForTimeout(1500)
  const jsonBud = (await j('GET', '/budgets')).find((x) => x.name === 'JSON raro')
  const jsonItems = jsonBud ? await j('GET', `/budgets/${jsonBud.id}/items`) : []
  check(!!jsonBud && jsonItems.some((i) => i.description === 'Pintura interior' && i.parent_id), 'crea el presupuesto con el JSON válido (trabajo dentro de su rubro)')

  console.log(`\n${ok} OK, ${bad} FALLAS`); await b.close(); if (bad) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
