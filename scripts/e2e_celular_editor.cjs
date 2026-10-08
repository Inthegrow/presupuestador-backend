// Prueba de punta a punta del editor en el celular y en una notebook chica (PLAN_CELULAR.md, 1.B y 1.C):
// - Celular 390×844: tarjetas en vez de tabla, tocar una abre el detalle, el botón Rubro abre el árbol en una hoja y
//   cambiar de rubro cambia las tarjetas, la cantidad se cambia desde la tarjeta y el total se actualiza, agregar un
//   trabajo, "Más" ofrece Exportar y Diferencias, la escalera abre los 6 escalones; el detalle de un trabajo,
//   Diferencias con el Excel y Análisis con tarjetas; nada más ancho que la ventana (salvo cajas que se deslizan),
//   lo que se toca mide 40 px o más y los campos tienen letra de 16 px.
// - 768×1024: el editor con la tabla a lo ancho y el árbol en una hoja (como en el celular), sin nada que se salga.
// - 1280×720: el primer trabajo se ve sin bajar, "Ver la escalera" abre la escalera completa (y la app se acuerda),
//   la tabla se desliza de costado con Código y Trabajo fijos, el encabezado y "Agregá un trabajo" en un renglón.
// - 1366×768: lo mismo que la notebook baja, sin nada que se salga.
// Corre contra vite (5179) + scripts/serve_fake.py (8000), con el servidor falso recién levantado.
// Uso: EXCEL_DIR=<carpeta con ginkgo.xlsx> SHOTS_DIR=<carpeta> NODE_PATH=<node_modules con playwright> node scripts/e2e_celular_editor.cjs
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const EXCEL = process.env.EXCEL_DIR || path.join(__dirname, 'excel')
const SHOTS = process.env.SHOTS_DIR || path.join(EXCEL, 'shots-celular-editor')
fs.mkdirSync(SHOTS, { recursive: true })
const B = 'http://127.0.0.1:5179', API = 'http://127.0.0.1:8000'
let ok = 0, bad = 0
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); c ? ok++ : bad++ }
const j = async (method, url, body) => (await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()
const valor = async (loc) => Number(await loc.getAttribute('data-valor'))
const cerca = (a, b, tol = 0.05) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol

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

/** Lo que se sale de la ventana sin estar dentro de una caja que se desliza (o que recorta) */
async function desborde(page) {
  return page.evaluate(() => {
    const W = window.innerWidth
    const malos = []
    for (const el of document.querySelectorAll('main *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right <= W + 1 && r.left >= -1) continue
      let p = el.parentElement, dentro = false
      while (p && p.tagName !== 'MAIN') {
        const ox = getComputedStyle(p).overflowX
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') { dentro = true; break }
        p = p.parentElement
      }
      if (!dentro) malos.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} (${Math.round(r.left)}–${Math.round(r.right)})`)
    }
    const main = document.querySelector('main')
    return {
      doc: document.documentElement.scrollWidth,
      W,
      main: main ? main.scrollWidth - main.clientWidth : 0,
      malos: malos.slice(0, 4),
      n: malos.length,
    }
  })
}
async function sinDesborde(page, donde) {
  const d = await desborde(page)
  check(d.doc <= d.W && d.main <= 1 && d.n === 0, `${donde}: nada más ancho que la ventana ${d.n ? JSON.stringify(d.malos) : `(${d.doc} ≤ ${d.W})`}`)
}

/** Botones y campos a la vista en <main> (o en la hoja abierta) que miden menos de 40 px de alto */
async function chicos(page, sel = 'main') {
  return page.evaluate((sel) => {
    const out = []
    for (const root of document.querySelectorAll(sel)) {
      for (const el of root.querySelectorAll('button, input:not([type=checkbox]):not([type=radio]), select, [role=menuitem]')) {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || el.closest('[aria-hidden=true]') || el.closest('[inert]')) continue
        if (el.closest('nav') || el.closest('[data-pestanas-proyecto]')) continue
        if (r.height < 39.5) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 30)}" ${Math.round(r.height)}px`)
      }
    }
    return out
  }, sel)
}
async function letra16(page, sel = 'main') {
  return page.evaluate((sel) => {
    const out = []
    for (const root of document.querySelectorAll(sel)) {
      for (const el of root.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, textarea')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0) continue
        const fs = parseFloat(getComputedStyle(el).fontSize)
        if (fs < 16) out.push(`${el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.tagName} ${fs}px`)
      }
    }
    return out
  }, sel)
}

async function captura(page, nombre, entera = false) {
  if (entera) {
    const vp = page.viewportSize()
    const alto = await page.evaluate(() => { const m = document.querySelector('main'); return m ? m.scrollHeight + m.getBoundingClientRect().top : document.body.scrollHeight })
    await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, Math.ceil(alto)) })
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(SHOTS, nombre) })
    await page.setViewportSize(vp)
    await page.waitForTimeout(300)
  } else {
    await page.screenshot({ path: path.join(SHOTS, nombre) })
  }
}

;(async () => {
  const id = await cargarGinkgo()
  const items = await j('GET', `/budgets/${id}/items`)
  const conRecursos = items.find((i) => i.template_id && i.notas !== 'Seccion' && i.directo_total > 0)
  const b = await chromium.launch()

  // ───────────── Celular 390×844 ─────────────
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const m = await ctx.newPage()
  m.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  await m.goto(`${B}/app/budgets/${id}/editor`)
  await m.evaluate(() => { try { localStorage.removeItem('presupuestador.escaleraAbierta') } catch { /* nada */ } })
  await m.reload()
  await m.getByTestId('tarjeta-trabajo').first().waitFor({ timeout: 20000 })
  await m.waitForTimeout(800)
  const tarjetas = m.getByTestId('tarjeta-trabajo')
  check(await tarjetas.count() > 0 && await m.locator('main table').count() === 0, `celular: tarjetas (${await tarjetas.count()}) en vez de la tabla`)
  await sinDesborde(m, 'celular, editor')
  const anchoEscalera = (await m.getByTestId('escalera').boundingBox())?.width ?? 0
  check(anchoEscalera >= 390 - 32 - 1, `celular: la escalera usa el ancho de la ventana menos 32 px (${Math.round(anchoEscalera)} px)`)
  check(await m.getByTestId('precio-sin-iva').isVisible() && await m.getByTestId('precio-con-iva').isVisible(), 'celular: la tarjeta muestra el precio sin IVA y con IVA')
  check(await m.getByTestId('escalera-indirectos').count() === 0, 'celular: la escalera arranca cerrada')
  const altoEscalera = (await m.getByTestId('escalera').boundingBox())?.height ?? 999
  check(altoEscalera <= 140, `celular: la escalera cerrada es compacta (${Math.round(altoEscalera)} px)`)
  check(/con IVA\s+\$[\d.]+/.test(await m.getByTestId('escalera').innerText()) && /costo directo\s+\$[\d.]+/.test(await m.getByTestId('escalera').innerText()),
    'celular: la tarjeta dice "con IVA $… · costo directo $…"')
  const primera = await tarjetas.first().boundingBox()
  const bajado = await m.evaluate(() => document.querySelector('main').scrollTop)
  check(!!primera && primera.y < 640 && bajado === 0, `celular: la primera tarjeta de trabajo arranca antes de los 640 px, sin bajar (${primera && Math.round(primera.y)} px)`)
  check(await m.getByTestId('desplegar-agregar').isVisible() && await m.getByPlaceholder('hueco 18, contrapiso, pintura…').count() === 0,
    'celular: "Agregar un trabajo" arranca plegado como un botón')
  // El encabezado: nombre, estado, Guardar versión y "Más"
  check(await m.getByRole('button', { name: 'Guardar versión' }).isVisible() && await m.getByRole('button', { name: 'Más', exact: true }).isVisible(),
    'celular: el encabezado tiene "Guardar versión" y "Más"')
  check(await m.getByRole('button', { name: 'Exportar', exact: true }).count() === 0, 'celular: Exportar no está suelto en el encabezado (va en "Más")')
  const chicosEditor = await chicos(m)
  check(chicosEditor.length === 0, `celular, editor: todo lo que se toca mide 40 px o más ${JSON.stringify(chicosEditor.slice(0, 6))}`)
  const letraEditor = await letra16(m)
  check(letraEditor.length === 0, `celular, editor: los campos tienen letra de 16 px ${JSON.stringify(letraEditor)}`)
  await captura(m, '01_celular_editor.png')
  await captura(m, '01b_celular_editor_entero.png', true)

  // "Ver la escalera": los 6 escalones apilados; la app se acuerda
  await m.getByRole('button', { name: /Ver la escalera/ }).click()
  await m.getByTestId('escalera-indirectos').waitFor({ timeout: 5000 })
  const escalones = []
  for (const t of ['escalera-directo', 'escalera-indirectos', 'escalera-beneficio', 'escalera-impuestos', 'precio-sin-iva', 'precio-con-iva']) escalones.push(await m.getByTestId(t).boundingBox())
  check(escalones.every((e, i) => e && Math.abs(e.x - escalones[0].x) < 1 && (i === 0 || e.y > escalones[i - 1].y + escalones[i - 1].height - 1)),
    'celular: "Ver la escalera" abre los 6 escalones, uno debajo del otro')
  await sinDesborde(m, 'celular, escalera abierta')
  await m.getByTestId('escalera').scrollIntoViewIfNeeded()
  const chicosEsc = await chicos(m)
  check(chicosEsc.length === 0, `celular, escalera abierta: todo lo que se toca mide 40 px o más ${JSON.stringify(chicosEsc.slice(0, 6))}`)
  await captura(m, '02_celular_escalera_abierta.png')
  await m.reload()
  await m.getByTestId('escalera-indirectos').waitFor({ timeout: 15000 }).catch(() => {})
  check(await m.getByTestId('escalera-indirectos').isVisible().catch(() => false), 'celular: al volver a entrar la escalera sigue abierta')
  await m.getByRole('button', { name: /Ocultar la escalera/ }).click()
  check(await m.getByTestId('escalera-indirectos').count() === 0, 'celular: "Ocultar la escalera" la vuelve a cerrar')

  // "Más": Recálculo completo, Planos con IA, Diferencias con el Excel y Exportar
  await m.getByRole('button', { name: 'Más', exact: true }).click()
  const menuMas = m.getByRole('dialog')
  await menuMas.getByRole('menuitem').first().waitFor({ timeout: 5000 })
  await m.waitForTimeout(400)
  const opciones = await menuMas.getByRole('menuitem').allInnerTexts()
  check(opciones.some((o) => /^Exportar/.test(o)) && opciones.some((o) => /^Diferencias con el Excel/.test(o)) && opciones.some((o) => /^Recálculo completo/.test(o)) && opciones.some((o) => /^Planos con IA/.test(o)),
    `celular: "Más" ofrece Recálculo completo, Planos con IA, Diferencias y Exportar (${opciones.map((o) => o.split('\n')[0]).join(' | ')})`)
  const chicosMas = await chicos(m, '[role=dialog]')
  check(chicosMas.length === 0, `celular, "Más": botones de 40 px o más ${JSON.stringify(chicosMas)}`)
  await captura(m, '03_celular_mas.png')
  await menuMas.getByRole('menuitem', { name: /^Exportar/ }).click()
  await m.waitForURL(/\/export$/, { timeout: 10000 }).catch(() => {})
  check(/\/export$/.test(m.url()), '"Más" → Exportar abre Exportar')
  await m.goto(`${B}/app/budgets/${id}/editor`)
  await m.getByTestId('tarjeta-trabajo').first().waitFor({ timeout: 20000 })
  await m.getByRole('button', { name: 'Más', exact: true }).click()
  await m.getByRole('dialog').getByRole('menuitem', { name: /^Diferencias con el Excel/ }).click()
  await m.waitForURL(/\/diferencias$/, { timeout: 10000 }).catch(() => {})
  check(/\/diferencias$/.test(m.url()), '"Más" → Diferencias con el Excel abre la comparación')

  // Diferencias con el Excel en el celular: tarjetas, filtros que se deslizan, cuadros en 2 columnas
  await m.getByTestId('diferencia-tarjeta').first().waitFor({ timeout: 20000 })
  check(await m.locator('main table').count() === 0 && await m.getByTestId('diferencia-tarjeta').count() > 0, `celular, Diferencias: cada trabajo es una tarjeta (${await m.getByTestId('diferencia-tarjeta').count()})`)
  const t1 = await m.getByTestId('diferencia-tarjeta').first().innerText()
  check(/Excel/.test(t1) && /App/.test(t1) && /Diferencia/.test(t1), 'celular, Diferencias: la tarjeta dice Excel / App / Diferencia')
  const cExcel = await m.locator('div.rounded-xl').filter({ hasText: 'Excel de Sol' }).first().boundingBox()
  const cApp = await m.locator('div.rounded-xl').filter({ hasText: /^La app/ }).first().boundingBox()
  check(!!cExcel && !!cApp && Math.abs(cExcel.y - cApp.y) < 2 && cApp.x > cExcel.x, 'celular, Diferencias: los cuadros de arriba van en 2 columnas')
  const filtros = await m.getByTestId('filtros-diferencias').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX, alto: el.getBoundingClientRect().height }))
  check(filtros.ox === 'auto' && filtros.alto < 60, `celular, Diferencias: los filtros van en un renglón que se desliza (${JSON.stringify(filtros)})`)
  await sinDesborde(m, 'celular, Diferencias')
  const chicosDif = await chicos(m)
  check(chicosDif.length === 0, `celular, Diferencias: todo lo que se toca mide 40 px o más ${JSON.stringify(chicosDif.slice(0, 6))}`)
  await m.getByTestId('diferencia-tarjeta').first().locator('button').first().click()
  await m.waitForTimeout(300)
  check(await m.getByTestId('diferencia-tarjeta').first().locator('li').count() > 0, 'celular, Diferencias: tocar la tarjeta muestra el detalle por piso')
  await captura(m, '04_celular_diferencias.png')
  await captura(m, '04b_celular_diferencias_entera.png', true)
  await m.getByRole('button', { name: 'Al nivel del Excel' }).click()
  await m.waitForTimeout(300)
  await sinDesborde(m, 'celular, Diferencias al nivel del Excel')

  // Análisis en el celular
  await m.goto(`${B}/app/budgets/${id}/analysis`)
  await m.getByTestId('analisis-tarjeta').first().waitFor({ timeout: 20000 })
  check(await m.locator('main table').count() === 0 && await m.getByTestId('analisis-tarjeta').count() > 0, `celular, Análisis: tarjetas por rubro (${await m.getByTestId('analisis-tarjeta').count()})`)
  const pS = await m.getByTestId('precio-sin-iva').boundingBox()
  const pC = await m.getByTestId('precio-con-iva').boundingBox()
  check(!!pS && !!pC && Math.abs(pS.y - pC.y) < 2, 'celular, Análisis: los cuadros de arriba van en 2 columnas')
  await sinDesborde(m, 'celular, Análisis')
  await m.getByRole('button', { name: 'Piso', exact: true }).click()
  await m.waitForTimeout(300)
  await sinDesborde(m, 'celular, Análisis por piso')
  await captura(m, '05_celular_analisis.png')
  await captura(m, '05b_celular_analisis_entero.png', true)

  // De vuelta al editor: el botón Rubro abre el árbol; elegir otro rubro cambia las tarjetas
  await m.goto(`${B}/app/budgets/${id}/editor`)
  await m.getByTestId('tarjeta-trabajo').first().waitFor({ timeout: 20000 })
  const rubroAntes = (await m.getByTestId('elegir-rubro').innerText()).replace(/\s+/g, ' ')
  const primeraAntes = await tarjetas.first().getAttribute('data-id')
  check(/^Rubro: 1 /.test(rubroAntes), `celular: el botón dice "${rubroAntes}"`)
  await m.getByTestId('elegir-rubro').click()
  const hoja = m.getByTestId('hoja-arbol')
  await hoja.waitFor({ timeout: 5000 })
  await m.waitForTimeout(400)
  const caja = await hoja.getByRole('dialog').boundingBox()
  check(!!caja && Math.abs(caja.y + caja.height - 844) < 2 && caja.width >= 389, 'celular: el árbol se abre en una hoja desde abajo, a lo ancho')
  const chicosHoja = await chicos(m, '[data-testid=hoja-arbol]')
  check(chicosHoja.length === 0, `celular, hoja del árbol: renglones de 40 px o más ${JSON.stringify(chicosHoja.slice(0, 5))}`)
  await captura(m, '06_celular_arbol.png')
  const otro = hoja.getByText(/^EXCAVACIONES$/).first()
  await otro.click()
  await hoja.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  check(await m.getByTestId('hoja-arbol').count() === 0, 'celular: elegir un rubro cierra la hoja')
  await m.waitForTimeout(400)
  const rubroDespues = (await m.getByTestId('elegir-rubro').innerText()).replace(/\s+/g, ' ')
  const codigos = await tarjetas.evaluateAll((els) => els.map((e) => e.querySelector('.font-mono')?.textContent?.trim()))
  check(/EXCAVACIONES/.test(rubroDespues) && (await tarjetas.first().getAttribute('data-id')) !== primeraAntes && codigos.every((c) => /^2\./.test(c)),
    `celular: elegir otro rubro cambia las tarjetas (${rubroDespues}: ${codigos.join(', ')})`)

  // La cantidad desde la tarjeta: recalcula el trabajo y el total
  const t0 = tarjetas.first()
  const idTrabajo = await t0.getAttribute('data-id')
  const tarjetaDe = () => m.locator(`[data-testid=tarjeta-trabajo][data-id="${idTrabajo}"]`)
  const netoAntes = await valor(m.getByTestId('precio-sin-iva'))
  const precioAntes = await valor(tarjetaDe().getByTestId('tarjeta-precio'))
  const itemAntes = (await j('GET', `/budgets/${id}/items`)).find((i) => i.id === idTrabajo)
  await tarjetaDe().getByTestId('tarjeta-cambiar-cantidad').click()
  const campo = tarjetaDe().getByTestId('tarjeta-cantidad')
  await campo.waitFor({ timeout: 3000 })
  const cajaCampo = await campo.boundingBox()
  const letraCampo = await campo.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  check(!!cajaCampo && cajaCampo.height >= 44 && letraCampo >= 16, `celular: la cantidad se cambia en un campo grande (${cajaCampo && Math.round(cajaCampo.height)} px de alto, letra ${letraCampo} px)`)
  check(await campo.getAttribute('inputmode') === 'decimal', 'celular: el campo abre el teclado numérico')
  await captura(m, '07_celular_cambiar_cantidad.png')
  const nueva = Math.round((itemAntes.cantidad || 1) * 2 * 100) / 100
  await campo.fill(String(nueva).replace('.', ','))
  await tarjetaDe().getByRole('button', { name: 'Guardar' }).click()
  await m.waitForFunction((n) => Number(document.querySelector('[data-testid="precio-sin-iva"]')?.getAttribute('data-valor')) !== n, netoAntes, { timeout: 15000 }).catch(() => {})
  await m.waitForTimeout(300)
  const netoDespues = await valor(m.getByTestId('precio-sin-iva'))
  const precioDespues = await valor(tarjetaDe().getByTestId('tarjeta-precio'))
  const itemDespues = (await j('GET', `/budgets/${id}/items`)).find((i) => i.id === idTrabajo)
  check(cerca(itemDespues.cantidad, nueva, 0.001), `celular: la cantidad quedó guardada (${itemAntes.cantidad} → ${itemDespues.cantidad})`)
  check(precioDespues !== precioAntes && cerca(precioDespues, itemDespues.neto_total, 0.01), `celular: la tarjeta muestra el precio recalculado (${Math.round(precioAntes)} → ${Math.round(precioDespues)})`)
  check(cerca(netoDespues - netoAntes, precioDespues - precioAntes, 0.05), `celular: el total del presupuesto cambió en lo mismo que el trabajo (${Math.round(netoDespues - netoAntes)})`)
  check(await m.getByText(/^Cantidad: .* → /).count() > 0, 'celular: el aviso dice la cantidad vieja y la nueva')
  await captura(m, '08_celular_cantidad_guardada.png')

  // Agregar un trabajo: se despliega desde el botón, apilado
  const seccion = m.locator('section[aria-label="Agregá un trabajo"]')
  const bDesp = await m.getByTestId('desplegar-agregar').boundingBox()
  check(!!bDesp && bDesp.width >= 390 - 32 - 1 && bDesp.height >= 44, `celular: el botón "Agregar un trabajo" va a lo ancho (${bDesp && Math.round(bDesp.width)}×${bDesp && Math.round(bDesp.height)})`)
  await m.getByTestId('desplegar-agregar').click()
  await m.waitForTimeout(200)
  check(await m.evaluate(() => document.activeElement?.getAttribute('placeholder') === 'hueco 18, contrapiso, pintura…'), 'celular: al tocarlo se despliega el formulario con el foco en el buscador')
  const buscador = seccion.getByPlaceholder('hueco 18, contrapiso, pintura…')
  const bBus = await buscador.boundingBox()
  const bCant = await seccion.getByLabel('Cantidad').boundingBox()
  const bAgr = await seccion.getByRole('button', { name: /^Agregar$/ }).boundingBox()
  check(!!bBus && !!bCant && !!bAgr && bCant.y > bBus.y + bBus.height - 1 && bAgr.y > bCant.y + bCant.height - 1 && bAgr.width > 300,
    'celular: "Agregá un trabajo" va apilado: buscador, cantidad y unidad, Agregar a lo ancho')
  const cuantasAntes = await tarjetas.count()
  await buscador.click()
  await buscador.pressSequentially('hueco 18', { delay: 20 })
  await m.waitForTimeout(1200)
  await captura(m, '09_celular_agregar_quizas.png')
  await buscador.press('Enter')
  await seccion.getByLabel('Cantidad').fill('12')
  await seccion.getByRole('button', { name: /^Agregar$/ }).click()
  await seccion.getByRole('status').waitFor({ timeout: 15000 }).catch(() => {})
  await m.waitForTimeout(1200)
  check(/^Agregado/.test(await seccion.getByRole('status').innerText().catch(() => '')), 'celular: agregar un trabajo funciona ("Agregado")')
  check(await tarjetas.count() === cuantasAntes + 1 && await tarjetas.filter({ hasText: /hueco del 18/i }).count() > 0,
    `celular: el trabajo nuevo aparece como tarjeta en el rubro elegido (${cuantasAntes} → ${await tarjetas.count()})`)
  check(await m.getByTestId('desplegar-agregar').isVisible() && await m.getByPlaceholder('hueco 18, contrapiso, pintura…').count() === 0, 'celular: después de agregar, el formulario se vuelve a plegar')
  const marcaNueva = m.getByTestId('recien-agregado')
  const bNueva = await marcaNueva.boundingBox().catch(() => null)
  check(!!bNueva && /hueco del 18/i.test(await tarjetas.filter({ has: marcaNueva }).innerText()) && bNueva.y > 0 && bNueva.y < 844,
    'celular: y muestra el trabajo agregado, resaltado y a la vista')
  await captura(m, '10a_celular_agregado_a_la_vista.png')
  await sinDesborde(m, 'celular, después de agregar')
  await captura(m, '10_celular_agregado.png', true)

  // Tocar una tarjeta abre el detalle del trabajo
  await m.goto(`${B}/app/budgets/${id}/editor`)
  await m.getByTestId('tarjeta-trabajo').first().waitFor({ timeout: 20000 })
  await m.getByTestId('elegir-rubro').click()
  const rubroDelTrabajo = items.find((i) => i.notas === 'Seccion' && i.code === conRecursos.code.split('.')[0])
  await m.getByTestId('hoja-arbol').getByText(rubroDelTrabajo.description, { exact: true }).first().click()
  await m.waitForTimeout(500)
  await m.locator(`[data-testid=tarjeta-trabajo][data-id="${conRecursos.id}"]`).locator('button').first().scrollIntoViewIfNeeded()
  await m.locator(`[data-testid=tarjeta-trabajo][data-id="${conRecursos.id}"]`).locator('button').first().click()
  await m.waitForURL(new RegExp(`/item/${conRecursos.id}$`), { timeout: 10000 }).catch(() => {})
  check(new RegExp(`/item/${conRecursos.id}$`).test(m.url()), `celular: tocar la tarjeta abre el detalle (${conRecursos.code})`)

  // Detalle de un trabajo en el celular
  await m.getByTestId('resumen-costos').waitFor({ timeout: 20000 })
  await m.waitForTimeout(800)
  check(await m.locator('main table').count() === 0 && await m.getByTestId('recurso-tarjeta').count() > 0, `celular, detalle: cada recurso es una tarjeta (${await m.getByTestId('recurso-tarjeta').count()})`)
  const rec = await m.getByTestId('recurso-tarjeta').first().innerText()
  check(/×/.test(rec) && /=/.test(rec) && /desperdicio|cargas sociales/.test(rec), `celular, detalle: la tarjeta dice "cantidad × precio = subtotal" y el desperdicio (${rec.replace(/\n/g, ' | ').slice(0, 120)})`)
  const imp = []
  for (const l of ['Materiales por', 'Mano de obra por']) imp.push(await m.locator('main div.text-center', { hasText: l }).first().boundingBox())
  check(!!imp[0] && !!imp[1] && Math.abs(imp[0].y - imp[1].y) < 2 && imp[1].x > imp[0].x, 'celular, detalle: los importes por unidad van en 2 columnas')
  await sinDesborde(m, 'celular, detalle de un trabajo')
  const chicosDet = await chicos(m)
  check(chicosDet.length === 0, `celular, detalle: todo lo que se toca mide 40 px o más ${JSON.stringify(chicosDet.slice(0, 6))}`)
  await captura(m, '11_celular_detalle.png')
  await captura(m, '11b_celular_detalle_entero.png', true)
  // ⋯ de un recurso: Editar y Borrar con botones grandes; Editar abre la hoja con los campos de 16 px
  await m.getByTestId('recurso-tarjeta').first().getByRole('button', { name: /^Opciones de/ }).click()
  const hojaRec = m.getByRole('dialog')
  await hojaRec.getByRole('menuitem', { name: 'Editar' }).waitFor({ timeout: 5000 })
  check(await hojaRec.getByRole('menuitem', { name: 'Borrar' }).count() === 1, 'celular, detalle: el ⋯ ofrece Editar y Borrar')
  await hojaRec.getByRole('menuitem', { name: 'Editar' }).click()
  await m.getByTestId('hoja-recurso').waitFor({ timeout: 5000 })
  await m.waitForTimeout(400)
  const letraRec = await letra16(m, '[data-testid=hoja-recurso]')
  check(letraRec.length === 0, `celular, editar un recurso: campos de 16 px ${JSON.stringify(letraRec)}`)
  await captura(m, '12_celular_editar_recurso.png')
  await m.getByTestId('hoja-recurso').getByRole('button', { name: 'Cancelar' }).click()
  // Cambiar fórmula: ventana a pantalla completa
  await m.getByRole('button', { name: /Cambiar fórmula|Cargar fórmula/ }).click()
  await m.getByText('Fórmulas', { exact: true }).waitFor({ timeout: 5000 })
  await m.waitForTimeout(300)
  const ventana = await m.locator('div.fixed.inset-0 > div').first().boundingBox()
  check(!!ventana && ventana.width >= 389 && ventana.height >= 843, 'celular: elegir la fórmula ocupa toda la pantalla')
  await captura(m, '13_celular_formulas.png')
  await m.getByRole('button', { name: 'Cerrar' }).first().click()
  await ctx.close()

  // ───────────── Tablet 768×1024 ─────────────
  const tb = await b.newPage({ viewport: { width: 768, height: 1024 } })
  await tb.goto(`${B}/app/budgets/${id}/editor`)
  await tb.locator('tbody tr').first().waitFor({ timeout: 20000 })
  await tb.waitForTimeout(600)
  check(await tb.getByTestId('tarjeta-trabajo').count() === 0 && await tb.locator('tbody tr').count() > 0, '768: el editor con la tabla (no tarjetas)')
  const anchoTabla = (await tb.getByTestId('tabla-trabajos').boundingBox())?.width ?? 0
  check(anchoTabla > 768 - 32 - 10, `768: la tabla usa todo el ancho; el árbol va en una hoja (${Math.round(anchoTabla)} px)`)
  await tb.getByTestId('elegir-rubro').click()
  await tb.getByTestId('hoja-arbol').waitFor({ timeout: 5000 })
  await tb.waitForTimeout(400)
  await tb.screenshot({ path: path.join(SHOTS, '21_tablet_arbol.png') })
  await tb.getByTestId('hoja-arbol').getByText(/^EXCAVACIONES$/).first().click()
  await tb.waitForTimeout(500)
  check(/EXCAVACIONES/.test(await tb.getByTestId('elegir-rubro').innerText()) && await tb.getByTestId('hoja-arbol').count() === 0, '768: elegir un rubro en la hoja cierra la hoja y cambia la tabla')
  await sinDesborde(tb, '768, editor')
  const gv = await tb.getByRole('button', { name: 'Guardar versión' }).boundingBox()
  const h1 = await tb.locator('main h1').first().boundingBox()
  check(!!gv && !!h1 && Math.abs((gv.y + gv.height / 2) - (h1.y + h1.height / 2)) < 6, '768: "Guardar versión" en el mismo renglón que el nombre')
  await tb.screenshot({ path: path.join(SHOTS, '20_tablet_editor.png') })
  await tb.close()

  // ───────────── Notebook 1280×720 ─────────────
  const nb = await b.newPage({ viewport: { width: 1280, height: 720 } })
  nb.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  await nb.goto(`${B}/app/budgets/${id}/editor`)
  await nb.evaluate(() => { try { localStorage.removeItem('presupuestador.escaleraAbierta') } catch { /* nada */ } })
  await nb.reload()
  await nb.locator('tbody tr').first().waitFor({ timeout: 20000 })
  await nb.waitForTimeout(800)
  const fila1 = await nb.locator('tbody tr').first().boundingBox()
  const scrollMain = await nb.evaluate(() => document.querySelector('main').scrollTop)
  check(!!fila1 && fila1.y + fila1.height <= 720 && scrollMain === 0, `1280×720: el primer trabajo se ve sin bajar (termina en ${fila1 && Math.round(fila1.y + fila1.height)} px)`)
  const escRenglon = await nb.getByTestId('escalera').boundingBox()
  check(!!escRenglon && escRenglon.height <= 56, `1280×720: la escalera va en un renglón (${escRenglon && Math.round(escRenglon.height)} px)`)
  check(/Costo directo \$[\d.]+/.test(await nb.getByTestId('escalera').innerText()) && /Precio sin IVA \$[\d.]+/.test(await nb.getByTestId('escalera').innerText()) && /con IVA \$[\d.]+/.test(await nb.getByTestId('escalera').innerText()),
    '1280×720: dice "Costo directo $X → Precio sin IVA $Y · con IVA $Z"')
  // Encabezado en un renglón, con "Guardar versión" a la vista
  const botonesTitulo = await nb.evaluate(() => {
    const h1 = document.querySelector('main h1')
    const fila = h1.closest('div.relative') || h1.parentElement.parentElement
    return [...fila.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0 && !b.closest('[aria-hidden=true]')).map((b) => { const r = b.getBoundingClientRect(); return Math.round(r.top + r.height / 2) })
  })
  check(botonesTitulo.length > 0 && Math.max(...botonesTitulo) - Math.min(...botonesTitulo) <= 3, `1280×720: los botones del encabezado en un solo renglón (${botonesTitulo.join(', ')})`)
  check(await nb.getByRole('button', { name: 'Guardar versión' }).isVisible(), '1280×720: "Guardar versión" a la vista')
  // "Agregá un trabajo" en un renglón, con la ayuda en "?"
  const sec = nb.locator('section[aria-label="Agregá un trabajo"]')
  const ys = []
  for (const l of [sec.getByPlaceholder('hueco 18, contrapiso, pintura…'), sec.getByLabel('Cantidad'), sec.getByLabel('Unidad'), sec.getByRole('button', { name: /^Agregar$/ })]) {
    const bb = await l.boundingBox(); ys.push(bb ? Math.round(bb.y + bb.height / 2) : -1)
  }
  check(ys.every((y) => Math.abs(y - ys[0]) <= 3), `1280×720: "Agregá un trabajo" en un renglón (${ys.join(', ')})`)
  await sec.getByRole('button', { name: 'Cómo se agrega un trabajo' }).click()
  check(/Escribí como hablás/.test(await sec.getByRole('note').innerText().catch(() => '')), '1280×720: el "?" muestra la ayuda')
  await nb.keyboard.press('Escape')
  await sec.getByRole('button', { name: 'Cómo se agrega un trabajo' }).click()
  await nb.screenshot({ path: path.join(SHOTS, '30_notebook_1280x720.png') })
  await nb.keyboard.press('Escape')
  check(await sec.getByRole('note').count() === 0, '1280×720: Esc cierra la ayuda')
  await sinDesborde(nb, '1280×720, editor')

  // La tabla se desliza de costado con Código y Trabajo fijos y el precio fijo a la derecha
  const tabla = nb.getByTestId('tabla-trabajos')
  const anchos = await tabla.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  check(anchos.sw > anchos.cw, `1280×720: la tabla se desliza de costado dentro de su caja (${anchos.sw} > ${anchos.cw})`)
  const thX = async (t) => (await tabla.locator('th', { hasText: t }).first().boundingBox())?.x
  const antes = { cod: await thX('Código'), trab: await thX('Trabajo'), precio: await thX('Precio sin IVA'), benef: await thX('Beneficio') }
  await tabla.evaluate((el) => { el.scrollLeft = el.scrollWidth })
  await nb.waitForTimeout(300)
  const despues = { cod: await thX('Código'), trab: await thX('Trabajo'), precio: await thX('Precio sin IVA'), benef: await thX('Beneficio') }
  check(Math.abs(antes.cod - despues.cod) < 1 && Math.abs(antes.trab - despues.trab) < 1, '1280×720: al deslizar, Código y Trabajo quedan fijos')
  check(Math.abs(antes.precio - despues.precio) < 1 && despues.benef < antes.benef, '1280×720: el precio sin IVA queda fijo a la derecha y las del medio se mueven')
  const cajaTabla = await tabla.boundingBox()
  const thBenef = await tabla.locator('th', { hasText: 'Beneficio' }).first().boundingBox()
  const thPrecio = await tabla.locator('th', { hasText: 'Precio sin IVA' }).first().boundingBox()
  check(!!thBenef && thBenef.x + thBenef.width <= thPrecio.x + 1 && thBenef.x >= cajaTabla.x, '1280×720: deslizando se llega a "Beneficio" entero')
  await nb.screenshot({ path: path.join(SHOTS, '31_notebook_tabla_deslizada.png') })
  await tabla.evaluate((el) => { el.scrollLeft = 0 })

  // "Ver la escalera" abre la escalera completa; la app se acuerda
  await nb.getByRole('button', { name: /Ver la escalera/ }).click()
  await nb.getByTestId('escalera-indirectos').waitFor({ timeout: 5000 })
  check(await nb.getByTestId('escalera-beneficio').isVisible() && await nb.getByTestId('coeficiente-pase').isVisible(), '1280×720: "Ver la escalera" abre la escalera completa con el Coeficiente de pase')
  await nb.screenshot({ path: path.join(SHOTS, '32_notebook_escalera_abierta.png') })
  await nb.reload()
  await nb.getByTestId('escalera-indirectos').waitFor({ timeout: 15000 }).catch(() => {})
  check(await nb.getByTestId('escalera-indirectos').isVisible().catch(() => false), '1280×720: al volver a entrar la escalera sigue abierta')
  await nb.getByRole('button', { name: /Ocultar la escalera/ }).click()
  await nb.waitForTimeout(300)
  check(await nb.getByTestId('escalera-indirectos').count() === 0, '1280×720: "Ocultar la escalera" la vuelve a un renglón')

  // Detalle, Diferencias y Análisis en 1280×720
  await nb.goto(`${B}/app/budgets/${id}/item/${conRecursos.id}`)
  await nb.getByTestId('resumen-costos').waitFor({ timeout: 20000 })
  await nb.waitForTimeout(500)
  await sinDesborde(nb, '1280×720, detalle')
  await nb.screenshot({ path: path.join(SHOTS, '33_notebook_detalle.png') })
  await nb.goto(`${B}/app/budgets/${id}/diferencias`)
  await nb.locator('tbody tr').first().waitFor({ timeout: 20000 })
  await sinDesborde(nb, '1280×720, Diferencias')
  await nb.screenshot({ path: path.join(SHOTS, '34_notebook_diferencias.png') })
  await nb.goto(`${B}/app/budgets/${id}/analysis`)
  await nb.locator('tbody tr').first().waitFor({ timeout: 20000 })
  await sinDesborde(nb, '1280×720, Análisis')
  await nb.screenshot({ path: path.join(SHOTS, '35_notebook_analisis.png') })
  await nb.close()

  // ───────────── Notebook 1366×768 ─────────────
  const n2 = await b.newPage({ viewport: { width: 1366, height: 768 } })
  await n2.goto(`${B}/app/budgets/${id}/editor`)
  await n2.locator('tbody tr').first().waitFor({ timeout: 20000 })
  await n2.waitForTimeout(800)
  const f2 = await n2.locator('tbody tr').first().boundingBox()
  check(!!f2 && f2.y + f2.height <= 768, `1366×768: el primer trabajo se ve sin bajar (termina en ${f2 && Math.round(f2.y + f2.height)} px)`)
  check(await n2.getByRole('button', { name: 'Guardar versión' }).isVisible() && await n2.getByRole('button', { name: 'Exportar', exact: true }).isVisible(), '1366×768: "Guardar versión" y Exportar a la vista')
  await sinDesborde(n2, '1366×768, editor')
  await n2.screenshot({ path: path.join(SHOTS, '40_notebook_1366x768.png') })
  await n2.close()

  console.log(`\n${ok} OK, ${bad} FALLAS`)
  await b.close()
  process.exit(bad ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
