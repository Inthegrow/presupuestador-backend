// Prueba de punta a punta de "un solo total": el precio sin IVA del editor es el mismo en el tablero, en el PDF para
// el cliente y en el Excel exportado; guardar una nota no lo cambia; agregar un recurso cambia el trabajo y el total en
// lo mismo; cambiar el beneficio en Coeficiente de pase avisa a quién toca, actualiza y todo sigue cerrando; la barra
// dice 34% (y mientras carga no dice ningún %); "Recálculo completo" muestra el error en rojo.
// Corre contra vite (5179) + scripts/serve_fake.py (8000), con el servidor falso recién levantado.
// Uso: EXCEL_DIR=<carpeta con ginkgo.xlsx> NODE_PATH=<node_modules con playwright> node scripts/e2e_un_solo_total.cjs
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { chromium } = require('playwright')

const EXCEL = process.env.EXCEL_DIR || path.join(__dirname, 'excel')
const SHOTS = process.env.SHOTS_DIR || path.join(EXCEL, 'shots-un-solo-total')
fs.mkdirSync(SHOTS, { recursive: true })
const B = 'http://127.0.0.1:5179', API = 'http://127.0.0.1:8000'
let ok = 0, bad = 0
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); c ? ok++ : bad++ }
const j = async (method, url, body) => (await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()
const pesos = (n) => '$' + Math.round(n).toLocaleString('es-AR')
const cerca = (a, b, tol = 0.05) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol

// La misma cuenta que app/calculations.py calc_cascade_indirects (y frontend/src/lib/cascada.ts)
const c2 = (n) => Number(n.toFixed(2))
function cascada(directo, cfg) {
  const ind = c2(directo * (cfg.imprevistos_pct + cfg.estructura_pct + cfg.jefatura_pct + cfg.logistica_pct + cfg.herramientas_pct) / 100)
  const s2 = directo + ind
  const ben = c2(s2 * cfg.beneficio_pct / 100)
  const s3 = s2 + ben
  const imp = c2(s3 * (cfg.ingresos_brutos_pct + cfg.imp_cheque_pct) / 100)
  return c2(s3 + imp)
}

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
  // Los rojos que no son de precio van "sin fórmula" (con el precio del Excel), como en e2e_ginkgo
  const asig = {}
  for (const t of a.tareas) if (t.estado === 'rojo' && t.motivo_rojo !== 'precio') asig[t.clave] = { plantillas: [] }
  const r = await fetch(API + '/obras/cargar', { method: 'POST', body: form(asig, { nombre: 'Ginkgo', permitir_sin_precio: 'true' }) })
  if (!r.ok) throw new Error('No se pudo cargar Ginkgo: ' + r.status + ' ' + (await r.text()))
  return (await r.json()).budget_id
}

/** "Total sin IVA" del PDF para el cliente */
async function totalPdfCliente(id) {
  const res = await fetch(`${API}/budgets/${id}/export/pdf?vista=cliente`)
  const file = path.join(os.tmpdir(), `cliente-${id}.pdf`)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  const txt = execFileSync('pdftotext', ['-layout', file, '-']).toString()
  const m = txt.match(/Total sin IVA\s+\$\s*([\d.]+,\d{2})/)
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null
}

/** Fila TOTAL, columna "Precio sin IVA" (o "Neto") del Excel exportado */
async function totalExcel(id) {
  const res = await fetch(`${API}/budgets/${id}/export/excel`)
  const file = path.join(os.tmpdir(), `export-${id}.xlsx`)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  const py = `
import json, sys, openpyxl
ws = openpyxl.load_workbook(sys.argv[1], data_only=True).worksheets[0]
col = None
out = None
for row in ws.iter_rows(values_only=True):
    if col is None:
        for i, c in enumerate(row):
            if isinstance(c, str) and c.strip().lower() in ('precio sin iva', 'neto', 'neto total', 'neto sin iva'):
                col = i
        continue
    if row and isinstance(row[0], str) and row[0].strip().upper().startswith('TOTAL'):
        out = row[col]
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python3', ['-c', py, file]).toString())
}

const valor = async (loc) => Number(await loc.getAttribute('data-valor'))

;(async () => {
  const id = await cargarGinkgo()
  const items = await j('GET', `/budgets/${id}/items`)
  const conFormula = items.find((i) => i.template_id && i.notas !== 'Seccion' && i.directo_total > 0)
  const b = await chromium.launch()
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))

  // 1. Mientras cargan los %, la barra no muestra ninguno (antes decía 41%); después, 34%
  await page.route('**/indirects', async (r) => { await new Promise((ok) => setTimeout(ok, 2500)); await r.continue().catch(() => {}) })
  await page.goto(`${B}/app/budgets/${id}/editor`)
  await page.getByTestId('precio-sin-iva').waitFor({ timeout: 20000 })
  const txtCargando = await page.getByTestId('escalera').innerText()
  check(await page.getByTestId('pct-indirectos').count() === 0 && !/41\s*%/.test(txtCargando), 'mientras cargan los %, la barra no muestra ningún % (ni 41%)')
  await page.getByTestId('pct-indirectos').waitFor({ timeout: 10000 })
  await page.unroute('**/indirects')
  await page.getByTestId('pct-indirectos').waitFor({ timeout: 10000 })
  check((await page.getByTestId('pct-indirectos').innerText()).trim() === '34%', `la barra dice 34% de indirectos (dice ${await page.getByTestId('pct-indirectos').innerText()})`)
  check(/34% indirectos/.test(await page.getByTestId('coeficiente-pase').innerText()), 'el Coeficiente de pase de la barra dice "34% indirectos"')

  // 2. La escalera suma y el precio sin IVA del editor
  const leerEscalera = async (p) => ({
    directo: await valor(p.getByTestId('escalera-directo')),
    ind: await valor(p.getByTestId('escalera-indirectos')),
    ben: await valor(p.getByTestId('escalera-beneficio')),
    imp: await valor(p.getByTestId('escalera-impuestos')),
    neto: await valor(p.getByTestId('precio-sin-iva')),
    final: await valor(p.getByTestId('precio-con-iva')),
  })
  const e0 = await leerEscalera(page)
  check(cerca(e0.directo + e0.ind + e0.ben + e0.imp, e0.neto, 0.05), `los renglones suman: ${pesos(e0.directo)} + ${pesos(e0.ind)} + ${pesos(e0.ben)} + ${pesos(e0.imp)} = ${pesos(e0.neto)}`)
  check(e0.final > e0.neto, `precio con IVA ${pesos(e0.final)} > sin IVA ${pesos(e0.neto)}`)
  const textoEditor = (await page.getByTestId('precio-sin-iva').innerText()).match(/\$[\d.]+/)?.[0]
  await page.screenshot({ path: SHOTS + '/01_editor_escalera.png' })

  // 3. El mismo número en el tablero, el PDF para el cliente y el Excel exportado
  const analisis = await j('GET', `/budgets/${id}/analysis`)
  check(cerca(analisis.neto_total, e0.neto, 0.05), `resumen del servidor = editor (${analisis.neto_total} / ${e0.neto})`)
  check(cerca(analisis.impuestos_total, e0.imp, 0.05), 'el resumen del servidor trae los impuestos y coinciden')
  await page.goto(`${B}/app/dashboard`)
  const card = page.locator('div', { has: page.getByRole('heading', { name: 'Ginkgo' }) }).last()
  const tarjeta = card.getByTestId('tarjeta-precio-sin-iva')
  await tarjeta.waitFor({ timeout: 15000 })
  check(cerca(await valor(tarjeta), e0.neto, 0.05), `tablero = editor (${await valor(tarjeta)} / ${e0.neto})`)
  check((await tarjeta.innerText()).includes(textoEditor), `el tablero muestra el mismo número: ${textoEditor}`)
  check(/Precio sin IVA/.test(await tarjeta.innerText()), 'la tarjeta dice "Precio sin IVA"')
  check(/244 trabajos/.test(await card.innerText()), 'la tarjeta cuenta solo trabajos (244), no rubros')
  await page.screenshot({ path: SHOTS + '/02_tablero.png' })
  const pdf0 = await totalPdfCliente(id)
  check(cerca(pdf0, e0.neto, 0.05), `PDF para el cliente "Total sin IVA" = editor (${pdf0} / ${e0.neto})`)
  const xls0 = await totalExcel(id)
  check(cerca(xls0, e0.neto, 0.05), `Excel exportado, fila TOTAL = editor (${xls0} / ${e0.neto})`)

  // 4. Detalle de un trabajo: la escalera suma; una nota no cambia nada
  const leerDetalle = async () => ({
    directo: await valor(page.getByTestId('detalle-directo')),
    ind: await valor(page.getByTestId('detalle-indirectos')),
    ben: await valor(page.getByTestId('detalle-beneficio')),
    imp: await valor(page.getByTestId('detalle-impuestos')),
    neto: await valor(page.getByTestId('detalle-precio-sin-iva')),
  })
  await page.goto(`${B}/app/budgets/${id}/item/${conFormula.id}`)
  await page.getByTestId('detalle-precio-sin-iva').waitFor({ timeout: 15000 })
  const d0 = await leerDetalle()
  check(cerca(d0.directo, conFormula.directo_total, 0.005), `detalle: "Costo directo" es el guardado del trabajo (${d0.directo})`)
  check(cerca(d0.directo + d0.ind + d0.ben + d0.imp, d0.neto, 0.02), 'detalle: los renglones suman')
  check(await page.getByTestId('detalle-indirectos').getByText('(34%)').count() === 1, 'detalle: "Indirectos (34%)"')
  await page.getByRole('button', { name: /Memoria de Calculo/ }).click()
  await page.getByRole('button', { name: /Agregar memoria de calculo|Editar memoria/ }).click()
  await page.locator('textarea').fill('Largo 4,50 × alto 2,80 (prueba: un texto no toca los números)')
  await page.locator('div.space-y-3', { has: page.locator('textarea') }).getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.getByText(/prueba: un texto no toca los números/).first().waitFor({ timeout: 8000 })
  await page.waitForTimeout(800)
  const d1 = await leerDetalle()
  check(d1.neto === d0.neto && d1.imp === d0.imp, `guardar una nota no cambia el precio (${pesos(d0.neto)} → ${pesos(d1.neto)})`)
  const tras = (await j('GET', `/budgets/${id}/items`)).find((i) => i.id === conFormula.id)
  check(tras.neto_total === conFormula.neto_total && tras.impuestos_total === conFormula.impuestos_total, 'y en el servidor tampoco (neto e impuestos iguales)')

  // 5. Agregar un recurso: la escalera del detalle suma y el total del editor cambia en lo mismo
  await page.getByRole('button', { name: 'Agregar recurso' }).first().click()
  const fila = page.locator('tr', { has: page.getByPlaceholder('COD') })
  await fila.getByPlaceholder('COD').fill('E2E-1')
  await fila.getByPlaceholder('Descripcion').fill('Material de prueba')
  await fila.getByPlaceholder('m2').fill('u')
  const nums = fila.locator('input[type=number]')
  await nums.nth(0).fill('10')
  await nums.last().fill('1000')
  await fila.locator('button').first().click()
  await page.waitForFunction((n) => Number(document.querySelector('[data-testid="detalle-precio-sin-iva"]')?.getAttribute('data-valor')) !== n, d1.neto, { timeout: 10000 })
  const d2 = await leerDetalle()
  check(d2.directo > d1.directo, `el costo directo del trabajo subió (${pesos(d1.directo)} → ${pesos(d2.directo)})`)
  check(cerca(d2.directo + d2.ind + d2.ben + d2.imp, d2.neto, 0.02), 'después del recurso, la escalera del detalle sigue sumando')
  const cfg0 = await j('GET', `/budgets/${id}/indirects`)
  check(cerca(d2.neto, cascada(d2.directo, cfg0), 0.02), `precio sin IVA = costo directo por el Coeficiente de pase, al centavo (${d2.neto} / ${cascada(d2.directo, cfg0)})`)
  await page.screenshot({ path: SHOTS + '/03_detalle_con_recurso.png', fullPage: true })
  await page.goto(`${B}/app/budgets/${id}/editor`)
  await page.getByTestId('pct-indirectos').waitFor({ timeout: 15000 })
  const e1 = await leerEscalera(page)
  check(cerca(e1.neto - e0.neto, d2.neto - d0.neto, 0.05), `el total del editor cambió en lo mismo que el trabajo (${pesos(e1.neto - e0.neto)} / ${pesos(d2.neto - d0.neto)})`)

  // 6. "Recálculo completo": si falla, en rojo; si anda, no mueve los números
  await page.route('**/cascade-recalculate', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Se cortó la conexión con la base"}' }))
  await page.getByRole('button', { name: 'Recálculo completo' }).click()
  const errRecalc = page.getByTestId('error-recalculo')
  await errRecalc.waitFor({ timeout: 8000 }).catch(() => {})
  check(await errRecalc.count() === 1 && /Se cortó la conexión con la base/.test(await errRecalc.innerText()), 'Recálculo completo que falla: lo dice en rojo')
  await page.screenshot({ path: SHOTS + '/04_recalculo_error.png' })
  await page.unroute('**/cascade-recalculate')
  const pedido = page.waitForRequest((r) => r.url().includes('/cascade-recalculate'), { timeout: 30000 })
  await errRecalc.getByRole('button', { name: 'Probar de nuevo' }).click()
  check(!!(await pedido.catch(() => null)), '"Recálculo completo" usa el mismo recálculo que Coeficiente de pase (cascade-recalculate)')
  await page.getByText('Listo: precios recalculados').waitFor({ timeout: 60000 }).catch(() => {})
  check(await errRecalc.count() === 0, 'al volver a probar y andar, el aviso rojo se va')
  const e2 = await leerEscalera(page)
  check(cerca(e2.neto, e1.neto, 10), `recalcular todo no mueve el total (más que redondeos de centavos) (${pesos(e1.neto)} → ${pesos(e2.neto)})`)

  // 7. Coeficiente de pase general: beneficio 20% → aviso con Ginkgo → Seguir → actualizados
  await j('POST', `/budgets/${id}/versions`)
  await page.goto(`${B}/app/settings/markups`)
  const filaBeneficio = page.locator('div.flex.items-center.justify-between', { hasText: 'sobre el subtotal con indirectos' })
  await filaBeneficio.locator('input').waitFor({ timeout: 10000 })
  await page.waitForTimeout(500)
  await filaBeneficio.locator('input').fill('20')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  const aviso = page.getByTestId('confirmar-afectados')
  const huboAviso = await aviso.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)
  check(huboAviso && /Esto cambia el precio de \d+ presupuestos? que usa/.test(await aviso.innerText()) && /Ginkgo/.test(await aviso.innerText()),
    `aparece el aviso "Esto cambia el precio de N presupuestos…" con Ginkgo${huboAviso ? '' : ' (no apareció: ¿Ginkgo quedó con porcentajes propios?)'}`)
  await page.screenshot({ path: SHOTS + '/05_aviso_afectados.png' })
  if (huboAviso) await aviso.getByRole('button', { name: 'Seguir' }).click()
  const resultado = page.getByTestId('resultado-guardar')
  await resultado.waitFor({ timeout: 60000 })
  const txtRes = await resultado.innerText()
  check(/Listo: \d+ presupuestos? actualizados?/.test(txtRes), `"${txtRes.trim()}"`)
  await page.screenshot({ path: SHOTS + '/06_listo_actualizados.png' })
  await page.goto(`${B}/app/budgets/${id}/editor`)
  await page.getByTestId('pct-indirectos').waitFor({ timeout: 15000 })
  const e3 = await leerEscalera(page)
  check(cerca(e3.neto / e2.neto, 1.2 / 1.1, 0.0005), `el editor muestra el precio nuevo (× 1,20/1,10: ${pesos(e2.neto)} → ${pesos(e3.neto)})`)
  check((await page.getByTestId('pct-indirectos').innerText()).trim() === '34%', 'la barra sigue diciendo 34%')
  check(cerca(e3.directo + e3.ind + e3.ben + e3.imp, e3.neto, 0.05), 'y los renglones siguen sumando')
  const pdf1 = await totalPdfCliente(id)
  check(cerca(pdf1, e3.neto, 0.05), `el PDF para el cliente también (${pdf1} / ${e3.neto})`)
  await page.screenshot({ path: SHOTS + '/07_editor_beneficio_20.png' })

  // 8. Los % propios del presupuesto (desde el editor): se actualiza solo, sin aviso
  await page.getByRole('button', { name: 'Editar porcentajes' }).click()
  await page.waitForURL(/settings\/markups\?budget=/)
  const filaB2 = page.locator('div.flex.items-center.justify-between', { hasText: 'sobre el subtotal con indirectos' })
  await filaB2.locator('input').waitFor({ timeout: 10000 })
  await page.waitForTimeout(500)
  await filaB2.locator('input').fill('15')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await page.getByTestId('resultado-guardar').waitFor({ timeout: 60000 })
  check(await page.getByTestId('confirmar-afectados').count() === 0, 'los % de un presupuesto no piden confirmación')
  check(/Listo: precios actualizados/.test(await page.getByTestId('resultado-guardar').innerText()), '"Listo: precios actualizados"')
  await page.goto(`${B}/app/budgets/${id}/editor`)
  await page.getByTestId('pct-indirectos').waitFor({ timeout: 15000 })
  const e4 = await leerEscalera(page)
  check(cerca(e4.neto / e2.neto, 1.15 / 1.1, 0.0005), `el editor muestra el precio con beneficio 15% (${pesos(e4.neto)})`)
  check(cerca(await totalPdfCliente(id), e4.neto, 0.05), 'y el PDF para el cliente coincide')
  check(cerca(await totalExcel(id), e4.neto, 0.05), 'y el Excel exportado también')

  // 9. Versiones: precio real de cada una y la diferencia
  await j('POST', `/budgets/${id}/versions`)
  await page.goto(`${B}/app/budgets/${id}/versions`)
  await page.getByTestId('version-precio').first().waitFor({ timeout: 15000 })
  const precios = await page.getByTestId('version-precio').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-valor'))))
  check(precios.length >= 2 && precios.every((p) => p > 0), `versiones con precio real (${precios.map(pesos).join(', ')}), no $0`)
  check(cerca(precios[0], e4.neto, 0.05), 'la versión actual tiene el precio del editor')
  check(await page.getByText(/contra v\d+|Igual que v\d+/).count() > 0, 'muestra la diferencia contra la actual')
  await page.screenshot({ path: SHOTS + '/08_versiones.png' })

  // 10. Celular: la escalera no se sale de la pantalla
  const m = await b.newPage({ viewport: { width: 400, height: 900 } })
  await m.goto(`${B}/app/budgets/${id}/editor`)
  await m.getByTestId('precio-sin-iva').waitFor({ timeout: 20000 })
  const anchos = await m.getByTestId('escalera').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  check(anchos.scroll <= anchos.client + 1, `celular: la escalera entra a lo ancho (${anchos.scroll} ≤ ${anchos.client})`)
  await m.getByTestId('escalera').scrollIntoViewIfNeeded()
  await m.screenshot({ path: SHOTS + '/09_celular.png' })

  // Dejar los generales como estaban
  await j('PATCH', '/indirects/general', { beneficio_pct: 10 })
  console.log(`\n${ok} OK, ${bad} FALLAS`); await b.close(); if (bad) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
