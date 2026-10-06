// Prueba de punta a punta de "exportar sin sorpresas" (PLAN_EXPORTAR.md, sección 3), con Ginkgo:
// la cabecera de Exportar muestra el mismo precio sin IVA que el editor; las cuatro opciones están en orden, sin jerga,
// y bajan cuatro archivos distintos con los nombres nuevos; el PDF para el cliente dice ese total; la Planilla Terrac
// tiene la hoja 01_C&P y, subida otra vez por /obras/analizar, da la misma cantidad de trabajos; con un trabajo sin
// precio aparece el aviso y "Ver cuáles" lleva al editor; si la consulta de faltantes falla, no hay aviso falso ni
// "todo bien"; un error 500 queda a la vista (y "Probar de nuevo" lo arregla); en 400 px no hay scroll horizontal.
// Corre contra vite (5179) + scripts/serve_fake.py (8000), con el servidor falso recién levantado.
// Uso: EXCEL_DIR=<carpeta con ginkgo.xlsx> NODE_PATH=<node_modules con playwright> node scripts/e2e_exportar.cjs
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { chromium } = require('playwright')

const EXCEL = process.env.EXCEL_DIR || path.join(__dirname, 'excel')
const SHOTS = process.env.SHOTS_DIR || path.join(EXCEL, 'shots-exportar')
fs.mkdirSync(SHOTS, { recursive: true })
const BAJADAS = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-exportar-'))
const B = 'http://127.0.0.1:5179', API = 'http://127.0.0.1:8000'
let ok = 0, bad = 0
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); c ? ok++ : bad++ }
const j = async (method, url, body) => (await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()
const pesos = (n) => '$' + Math.round(n).toLocaleString('es-AR')
const cerca = (a, b, tol = 0.05) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex')
const dd = (n) => String(n).padStart(2, '0')
const HOY = (() => { const d = new Date(); return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}` })()

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

/** Trabajos en rojo, con la misma regla que lib/semaforo.ts (estadoEnTabla) */
async function rojosEsperados(id) {
  const items = (await j('GET', `/budgets/${id}/items`)).filter((i) => i.notas !== 'Seccion')
  const f = await j('GET', `/budgets/${id}/precios-faltantes`)
  let n = 0
  for (const i of items) {
    const rec = f.recursos_por_item?.[i.id]
    if (typeof rec !== 'number') continue
    const faltan = Number(f.por_item?.[i.id]) || 0
    const aMano = ['mat_unitario', 'mo_unitario', 'eq_unitario', 'mat_ind_unitario', 'sub_unitario'].reduce((s, k) => s + (Number(i[k]) || 0), 0)
    if (faltan > 0) n++
    else if (rec === 0 && !(!i.template_id && aMano > 0)) n++
  }
  return n
}

const pdfTexto = (file) => execFileSync('pdftotext', ['-layout', file, '-']).toString()
const totalSinIvaPdf = (txt) => {
  const m = txt.match(/Total sin IVA\s+\$\s*([\d.]+,\d{2})/)
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null
}

/** Hojas de un xlsx y, de la planilla simple, la fila TOTAL en la columna "Precio sin IVA" (o "Neto") */
function leerXlsx(file, conCeldas = false) {
  const py = `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
ws = wb.worksheets[0]
col = None
total = None
for row in ws.iter_rows(values_only=True):
    if col is None:
        for i, c in enumerate(row):
            if isinstance(c, str) and c.strip().lower() in ('precio sin iva', 'neto', 'neto total', 'neto sin iva'):
                col = i
        continue
    if row and isinstance(row[0], str) and row[0].strip().upper().startswith('TOTAL'):
        total = row[col]
celdas = [[str(c) for c in row] for w in wb.worksheets for row in w.iter_rows(values_only=True)] if sys.argv[2] == '1' else None
print(json.dumps({'hojas': wb.sheetnames, 'total': total, 'celdas': celdas}, default=str))
`
  return JSON.parse(execFileSync('python3', ['-c', py, file, conCeldas ? '1' : '0'], { maxBuffer: 256 * 1024 * 1024 }).toString())
}

/** Hace clic en Descargar de una opción y espera el archivo */
async function bajar(page, opcion) {
  const card = page.getByTestId(`opcion-${opcion}`)
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    card.getByRole('button', { name: /^Descargar/ }).click(),
  ])
  const nombre = dl.suggestedFilename()
  const file = path.join(BAJADAS, `${opcion}-${nombre}`)
  await dl.saveAs(file)
  return { nombre, file }
}

const valor = async (loc) => Number(await loc.getAttribute('data-valor'))

;(async () => {
  const id = await cargarGinkgo()
  const trabajosApi = (await j('GET', `/budgets/${id}/items`)).filter((i) => i.notas !== 'Seccion').length
  const b = await chromium.launch()
  const page = await b.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))

  // 1. El precio sin IVA del editor
  await page.goto(`${B}/app/budgets/${id}/editor`)
  await page.getByTestId('pct-indirectos').waitFor({ timeout: 20000 })
  const netoEditor = await valor(page.getByTestId('precio-sin-iva'))
  const conIvaEditor = await valor(page.getByTestId('precio-con-iva'))
  const textoEditor = (await page.getByTestId('precio-sin-iva').innerText()).match(/\$[\d.]+/)?.[0]

  // 2. Cabecera de Exportar: el mismo total, el nombre de la obra y la cantidad de trabajos
  await page.goto(`${B}/app/budgets/${id}/export`)
  const cab = page.getByTestId('export-precio-sin-iva')
  await cab.waitFor({ timeout: 20000 })
  await page.waitForFunction(() => document.querySelector('[data-testid="export-precio-con-iva"]')?.getAttribute('data-valor'), null, { timeout: 10000 }).catch(() => {})
  check((await page.getByTestId('export-obra').innerText()).trim() === 'Ginkgo', 'la cabecera dice el nombre de la obra (Ginkgo)')
  check(cerca(await valor(cab), netoEditor, 0.005), `precio sin IVA de Exportar = editor (${await valor(cab)} / ${netoEditor})`)
  check(!!textoEditor && (await cab.innerText()).includes(textoEditor), `muestra el mismo número que el editor: ${textoEditor}`)
  check(cerca(await valor(page.getByTestId('export-precio-con-iva')), conIvaEditor, 0.005), `precio con IVA de Exportar = editor (${pesos(conIvaEditor)})`)
  check(await valor(page.getByTestId('export-trabajos')) === trabajosApi && trabajosApi === 244, `cuenta ${trabajosApi} trabajos (sin rubros)`)

  // 3. Las cuatro opciones, en orden, con para quién y sin jerga
  const orden = ['cliente', 'terrac', 'interno', 'simple']
  const ys = []
  for (const o of orden) ys.push((await page.getByTestId(`opcion-${o}`).boundingBox())?.y ?? -1)
  check(ys.every((y, i) => y >= 0 && (i === 0 || y > ys[i - 1])), 'las cuatro opciones están en orden: cliente, Terrac, interno, simple')
  const titulos = []
  for (const o of orden) titulos.push((await page.getByTestId(`opcion-${o}`).getByRole('heading').innerText()).replace(/\s+/g, ' ').trim())
  check(JSON.stringify(titulos) === JSON.stringify(['Para el cliente (PDF)', 'Planilla Terrac (Excel)', 'Informe interno (PDF)', 'Planilla simple (Excel)']),
    `títulos: ${titulos.join(' · ')}`)
  const txtCliente = await page.getByTestId('opcion-cliente').innerText()
  check(/Precio de venta de cada trabajo y el total, con y sin IVA\. Sin tus costos\./.test(txtCliente), 'Para el cliente: dice qué lleva')
  check(/01_C&P/.test(await page.getByTestId('opcion-terrac').innerText()) && /Cargar obra/.test(await page.getByTestId('opcion-terrac').innerText()), 'Planilla Terrac: dice 01_C&P y que se puede volver a subir')
  check(/No se lo mandes al cliente/.test(await page.getByTestId('opcion-interno').innerText()), 'Informe interno: "No se lo mandes al cliente"')
  const bordeCliente = await page.getByTestId('opcion-cliente').evaluate((el) => getComputedStyle(el).borderTopWidth)
  const bordeTerrac = await page.getByTestId('opcion-terrac').evaluate((el) => getComputedStyle(el).borderTopWidth)
  check(parseFloat(bordeCliente) > parseFloat(bordeTerrac), `la primera (Para el cliente) está destacada (borde ${bordeCliente} vs ${bordeTerrac})`)
  const todo = await page.locator('main').innerText()
  check(!/UNIVERSAL|BoQ|Bill of Quantities|26 col|logo SOLE|Nota sobre formatos|44\+/i.test(todo), 'sin jerga ni nota de abajo (UNIVERSAL, BoQ, 26 col, logo SOLE)')
  await page.screenshot({ path: SHOTS + '/01_exportar.png', fullPage: true })

  // 4. Aviso de trabajos en rojo, con la misma regla que el editor
  const rojos0 = await rojosEsperados(id)
  if (rojos0 > 0) {
    const aviso = page.getByTestId('aviso-faltantes')
    await aviso.waitFor({ timeout: 10000 }).catch(() => {})
    const re = new RegExp(rojos0 === 1 ? 'Hay 1 trabajo con precios que faltan' : `Hay ${rojos0} trabajos con precios que faltan`)
    check(await aviso.count() === 1 && re.test(await aviso.innerText()), `Ginkgo ya trae ${rojos0} en rojo: el aviso lo dice`)
  } else {
    await page.getByTestId('sin-faltantes').waitFor({ timeout: 10000 }).catch(() => {})
    check(await page.getByTestId('aviso-faltantes').count() === 0 && await page.getByTestId('sin-faltantes').count() === 1, 'sin trabajos en rojo: no hay aviso y dice que están todos los precios')
  }

  // 5. Las cuatro descargas: nombres nuevos, contenido distinto
  const nombres = {
    cliente: `Ginkgo - Para el cliente - ${HOY}.pdf`,
    terrac: `Ginkgo - Planilla Terrac - ${HOY}.xlsx`,
    interno: `Ginkgo - Informe interno - ${HOY}.pdf`,
    simple: `Ginkgo - Planilla simple - ${HOY}.xlsx`,
  }
  const bajados = {}
  for (const o of orden) {
    const r = await bajar(page, o).catch((e) => ({ nombre: null, file: null, e }))
    bajados[o] = r
    check(r.nombre === nombres[o], `${o}: baja "${r.nombre}"`)
    const listo = page.getByTestId(`opcion-${o}`).getByTestId('descargado')
    await listo.waitFor({ timeout: 5000 }).catch(() => {})
    check(await listo.count() === 1 && (await listo.innerText()).includes(nombres[o]), `${o}: queda "Descargado" con el nombre del archivo`)
  }
  // Distintos por lo que llevan (no por el archivo: dos xlsx iguales difieren en la fecha de creación)
  const contenido = (o) => {
    const f = bajados[o].file
    if (!f) return o
    return o === 'cliente' || o === 'interno' ? sha(Buffer.from(pdfTexto(f))) : sha(Buffer.from(JSON.stringify(leerXlsx(f, true))))
  }
  const firmas = orden.map(contenido)
  check(new Set(firmas).size === 4, `los cuatro archivos llevan cosas distintas (${new Set(firmas).size} distintos)`)
  const cabeza = (o) => (bajados[o].file ? fs.readFileSync(bajados[o].file).subarray(0, 4).toString('latin1') : '')
  check(cabeza('cliente') === '%PDF' && cabeza('interno') === '%PDF', 'los dos PDF son PDF')
  check(cabeza('terrac').startsWith('PK') && cabeza('simple').startsWith('PK'), 'las dos planillas son Excel (xlsx)')
  await page.screenshot({ path: SHOTS + '/02_descargados.png', fullPage: true })

  // 6. El PDF para el cliente dice el mismo total; el interno lleva los costos
  if (bajados.cliente.file) {
    const txt = pdfTexto(bajados.cliente.file)
    const t = totalSinIvaPdf(txt)
    check(cerca(t, netoEditor, 0.05), `PDF para el cliente: "Total sin IVA" = cabecera (${t} / ${netoEditor})`)
    check(!/Costo directo/i.test(txt), 'el PDF para el cliente no muestra el costo directo')
  }
  if (bajados.interno.file) check(/directo/i.test(pdfTexto(bajados.interno.file)), 'el informe interno sí habla del costo directo')

  // 7. Planilla simple: misma primera fila (lee la columna de precio) y el total
  if (bajados.simple.file) {
    const s = leerXlsx(bajados.simple.file)
    check(cerca(s.total, netoEditor, 0.05), `Planilla simple: fila TOTAL = cabecera (${s.total} / ${netoEditor})`)
  }

  // 8. Planilla Terrac: hoja 01_C&P; subida otra vez por Cargar obra da los mismos trabajos (depende del servidor nuevo)
  if (bajados.terrac.file) {
    const t = leerXlsx(bajados.terrac.file)
    check(t.hojas.includes('01_C&P'), `Planilla Terrac: tiene la hoja 01_C&P (hojas: ${t.hojas.slice(0, 4).join(', ')}${t.hojas.length > 4 ? ` … ${t.hojas.length}` : ''})`)
    check(t.hojas.includes('Coeficiente de pase'), 'Planilla Terrac: tiene la hoja "Coeficiente de pase"')
    check(t.hojas.length > 2, `Planilla Terrac: una hoja por trabajo con recursos (${t.hojas.length} hojas)`)
    const f = new FormData()
    f.append('file', new Blob([fs.readFileSync(bajados.terrac.file)]), 'terrac.xlsx')
    f.append('asignaciones', '{}')
    const res = await fetch(API + '/obras/analizar', { method: 'POST', body: f })
    const a = res.ok ? await res.json() : null
    check(a?.resumen?.trabajos === trabajosApi, `subida otra vez en Cargar obra: ${a?.resumen?.trabajos ?? `error ${res.status}`} trabajos (hay ${trabajosApi})`)
  }

  // 9. Un error 500 queda a la vista hasta volver a probar
  await page.route('**/export/excel?formato=terrac', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Se cortó la conexión con la base"}' }))
  const cardT = page.getByTestId('opcion-terrac')
  await cardT.getByRole('button', { name: /^Descargar/ }).click()
  const err = cardT.getByTestId('error-descarga')
  await err.waitFor({ timeout: 10000 }).catch(() => {})
  check(await err.count() === 1 && /No se pudo bajar la Planilla Terrac/.test(await err.innerText()) && /Se cortó la conexión con la base/.test(await err.innerText()),
    'error 500: dice qué no se pudo bajar y qué pasó')
  check(await cardT.getByTestId('descargado').count() === 0, 'con el error, ya no dice "Descargado"')
  await page.waitForTimeout(6500)
  check(await err.count() === 1, 'a los 6 segundos el error sigue a la vista')
  await page.screenshot({ path: SHOTS + '/03_error_500.png', fullPage: true })
  await page.unroute('**/export/excel?formato=terrac')
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }).catch(() => null),
    err.getByRole('button', { name: 'Probar de nuevo' }).click(),
  ])
  check(dl2?.suggestedFilename() === nombres.terrac, '"Probar de nuevo" baja la planilla')
  check(await err.count() === 0, 'y el error se va')
  // Un 500 sin explicación: un texto claro, no "500"
  await page.route('**/export/pdf?vista=cliente', (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' }))
  await page.getByTestId('opcion-cliente').getByRole('button', { name: /^Descargar/ }).click()
  const err2 = page.getByTestId('opcion-cliente').getByTestId('error-descarga')
  await err2.waitFor({ timeout: 10000 }).catch(() => {})
  const txtErr2 = err2 ? await err2.innerText().catch(() => '') : ''
  check(/El servidor no pudo armar el archivo/.test(txtErr2) && !/\b500\b|Internal Server Error/.test(txtErr2), `error sin detalle: "${txtErr2.replace(/\s*\n\s*/g, ' / ')}"`)
  await err2.getByRole('button', { name: 'Cerrar' }).click()
  check(await err2.count() === 0, 'el error se cierra con la cruz')
  await page.unroute('**/export/pdf?vista=cliente')

  // 10. Si la consulta de faltantes falla: ni aviso falso ni "todo bien"
  await page.route('**/precios-faltantes', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"x"}' }))
  await page.reload()
  await page.getByTestId('faltantes-sin-revisar').waitFor({ timeout: 15000 }).catch(() => {})
  check(await page.getByTestId('aviso-faltantes').count() === 0 && await page.getByTestId('sin-faltantes').count() === 0
    && await page.getByTestId('faltantes-sin-revisar').count() === 1, 'faltantes que fallan: ni aviso ni "todo bien"; dice que no pudo revisar')
  await page.unroute('**/precios-faltantes')

  // 11. Un trabajo sin precio: aparece el aviso; "Ver cuáles" lleva al editor
  await j('POST', `/budgets/${id}/items`, [{ code: '9.99', description: 'Trabajo de prueba sin precio', unidad: 'm2', cantidad: 5, sort_order: 99999 }])
  const rojos1 = await rojosEsperados(id)
  check(rojos1 === rojos0 + 1, `el trabajo sin precio cuenta como rojo (${rojos0} → ${rojos1})`)
  await page.reload()
  const aviso = page.getByTestId('aviso-faltantes')
  await aviso.waitFor({ timeout: 15000 }).catch(() => {})
  const txtAviso = (await aviso.count()) ? await aviso.innerText() : ''
  check(new RegExp(`Hay ${rojos1} trabajos? con precios? que faltan: el total puede quedar corto`).test(txtAviso), `aparece el aviso: "${txtAviso.split('\n')[0]}"`)
  check(/Se puede exportar igual/.test(txtAviso), 'dice que se puede exportar igual')
  check(await valor(page.getByTestId('export-trabajos')) === trabajosApi + 1, 'la cabecera cuenta el trabajo nuevo')
  await page.screenshot({ path: SHOTS + '/04_aviso_faltantes.png', fullPage: true })
  await aviso.getByRole('link', { name: 'Ver cuáles' }).click()
  await page.waitForURL(new RegExp(`/app/budgets/${id}/editor$`), { timeout: 10000 }).catch(() => {})
  check(new RegExp(`/app/budgets/${id}/editor$`).test(page.url()), `"Ver cuáles" lleva al editor (${page.url().replace(B, '')})`)
  await page.getByTestId('precio-sin-iva').waitFor({ timeout: 15000 }).catch(() => {})
  check(await page.getByTestId('precio-sin-iva').count() === 1, 'el editor se abre con su escalera')

  // 12. Celular (400 px): una columna, sin barra horizontal
  const m = await b.newPage({ viewport: { width: 400, height: 800 } })
  await m.goto(`${B}/app/budgets/${id}/export`)
  await m.getByTestId('export-precio-sin-iva').waitFor({ timeout: 20000 })
  await m.getByTestId('aviso-faltantes').waitFor({ timeout: 10000 }).catch(() => {})
  const anchos = await m.evaluate(() => {
    const main = document.querySelector('main')
    return { doc: document.documentElement.scrollWidth, win: window.innerWidth, main: main.scrollWidth, mainVisible: main.clientWidth }
  })
  check(anchos.doc <= anchos.win && anchos.main <= anchos.mainVisible + 1, `celular: sin barra horizontal (${JSON.stringify(anchos)})`)
  const cajas = []
  for (const o of orden) cajas.push(await m.getByTestId(`opcion-${o}`).boundingBox())
  check(cajas.every((c) => c && Math.abs(c.x - cajas[0].x) < 1 && Math.abs(c.width - cajas[0].width) < 1), 'celular: las opciones van una debajo de la otra, del mismo ancho')
  const tit = await m.getByTestId('opcion-cliente').getByRole('heading').boundingBox()
  const bot = await m.getByTestId('opcion-cliente').getByRole('button', { name: /^Descargar/ }).boundingBox()
  check(!!tit && !!bot && bot.y > tit.y + tit.height - 1, 'celular: el botón Descargar va debajo del texto')
  const sinIva = await m.getByTestId('export-precio-sin-iva').boundingBox()
  const conIva = await m.getByTestId('export-precio-con-iva').boundingBox()
  check(!!sinIva && !!conIva && conIva.y > sinIva.y + sinIva.height - 1, 'celular: los totales van uno debajo del otro')
  await m.screenshot({ path: SHOTS + '/05_celular.png' })
  // Toda la pantalla de una vez (el contenido se desplaza dentro de <main>, no en la página)
  const alto = await m.evaluate(() => document.querySelector('main').scrollHeight + document.querySelector('main').getBoundingClientRect().top)
  await m.setViewportSize({ width: 400, height: Math.ceil(alto) })
  await m.screenshot({ path: SHOTS + '/06_celular_entera.png' })

  console.log(`\n${ok} OK, ${bad} FALLAS`); await b.close(); if (bad) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
