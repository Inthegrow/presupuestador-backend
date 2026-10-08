// Entrega 10 (PLAN_CSV_Y_BUSCADOR.md, sección 3): subir una lista en .csv desde Lista de precios, el ejemplo para
// bajar, el estado del buscador de precios, la Ayuda nueva y el celular (390 px).
// Corre contra vite (5179, sin login) + scripts/serve_fake.py (8000).
// El estado del buscador se prueba en los dos casos: el que dice el servidor (con FAKE_BUSCADOR=1, "listo"; sin eso,
// "sin configurar") y el otro, simulado con page.route sobre GET /precios/buscador.
// Uso: SHOTS_DIR=<carpeta> NODE_PATH=<node_modules con playwright> node scripts/e2e_csv_buscador.cjs
const { chromium } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const B = 'http://127.0.0.1:5179', API = 'http://127.0.0.1:8000'
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'excel', 'shots-csv-buscador')
fs.mkdirSync(SHOTS, { recursive: true })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-csv-'))

let ok = 0, bad = 0
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); c ? ok++ : bad++ }
const info = (m) => console.log('INFO  ' + m)
const j = async (method, url, body) => {
  const r = await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return r.json()
}
const shot = (page, nombre) => page.screenshot({ path: path.join(SHOTS, nombre + '.png'), fullPage: true })

/** Nada más ancho que la ventana, salvo adentro de una caja que se desliza de costado (como en e2e_celular) */
async function seSale(page) {
  return page.evaluate(() => {
    const W = innerWidth
    const enCaja = (el) => {
      for (let a = el.parentElement; a && a !== document.body && a.tagName !== 'MAIN'; a = a.parentElement) {
        const s = getComputedStyle(a)
        const r = a.getBoundingClientRect()
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && r.right <= W + 1 && r.left >= -1) return true
      }
      return false
    }
    const fuera = []
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (getComputedStyle(el).visibility === 'hidden') continue
      if ((r.right > W + 1 || r.left < -1) && !enCaja(el)) {
        fuera.push(`${el.tagName.toLowerCase()}.${String(el.className || '').slice(0, 40)} (${Math.round(r.left)}–${Math.round(r.right)}) "${(el.innerText || '').slice(0, 30).replace(/\n/g, ' ')}"`)
      }
    }
    const main = document.querySelector('main')
    const ancha = main ? main.scrollWidth > main.clientWidth + 1 : document.documentElement.scrollWidth > W + 1
    return { n: fuera.length, fuera: fuera.slice(0, 4), ancha }
  })
}
const textoSeSale = (s) => (s.n ? ' — ' + s.fuera.join(' | ') : '') + (s.ancha ? ' (la página se desliza de costado)' : '')

/** Lo que se toca y mide menos de 40 px de alto */
async function botonesChicos(page, selector) {
  return page.evaluate((selector) => {
    const out = []
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.height < 39.5) out.push(`"${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 25)}" ${Math.round(r.height)}px`)
    }
    return out
  }, selector)
}

async function irAPrecios(page) {
  await page.goto(`${B}/app/catalogs`)
  await page.getByText('Maestro TERRAC - Materiales').first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(400)
}

/** Abre el formulario del .csv (los botones para subir arrancan a la vista) */
async function abrirFormularioCsv(page) {
  if (await page.getByTestId('subir-csv').count()) return page.getByTestId('subir-csv')
  if (!(await page.getByRole('button', { name: 'Subir un archivo (.csv)' }).isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Subir una lista nueva' }).click()
  }
  await page.getByRole('button', { name: 'Subir un archivo (.csv)' }).click()
  const form = page.getByTestId('subir-csv')
  await form.waitFor({ timeout: 5000 })
  return form
}

// Un .csv como lo guarda el Excel en castellano: ";", tildes y mayúsculas en los encabezados, precios con "$" y coma.
// 3 renglones buenos y 2 que no se cargan (uno sin código, otro sin precio).
const CSV_BUENO = [
  'Código;Descripción;Unidad;Precio sin IVA;Fecha;Proveedor',
  'E2E-001;Cemento de prueba x 50 kg;bolsa;$ 1.234,50;01/10/2026;Corralón Prueba',
  'E2E-002;Arena fina de prueba;m3;$ 45.000;02/10/2026;',
  'E2E-003;Hierro del 8 de prueba;barra;1234.5;;',
  ';Renglón sin código;u;100;;',
  'E2E-005;Renglón sin precio;u;;;',
].join('\r\n') + '\r\n'
const CSV_SIN_PRECIO = 'código;descripción;unidad\r\nE2E-X1;Algo sin precio;u\r\n'

;(async () => {
  const b = await chromium.launch()
  const creadas = []
  try {
    const estadoReal = await j('GET', '/precios/buscador').catch(() => null)
    check(estadoReal && typeof estadoReal.configurado === 'boolean' && !('clave' in estadoReal) && !Object.values(estadoReal).some((v) => /^sk-/.test(String(v))),
      `GET /precios/buscador dice si está configurado, sin la clave: ${JSON.stringify(estadoReal)}`)
    const listoReal = !!estadoReal?.configurado
    info(`el servidor dice que el buscador ${listoReal ? 'está listo (FAKE_BUSCADOR=1)' : 'no está configurado'}`)

    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
    const page = await ctx.newPage()
    const errores = []
    page.on('pageerror', (e) => errores.push(e.message))

    // ─── 4. Estado del buscador junto a "Buscar un precio" (el real y el otro, simulado) ────────────────────────
    async function probarEstado(listo, como) {
      await irAPrecios(page)
      const chip = page.getByTestId('estado-buscador')
      await chip.waitFor({ timeout: 10000 })
      const t = (await chip.innerText()).replace(/\s+/g, ' ').trim()
      if (listo) {
        check(t === 'Buscador listo' && (await chip.getAttribute('data-configurado')) === 'si', `${como}: junto a "Buscar un precio" dice "Buscador listo" ("${t}")`)
        const color = await chip.locator('span').first().evaluate((e) => getComputedStyle(e).backgroundColor)
        check(/rgb\(45, 141, 104\)/.test(color), `${como}: el punto es verde (${color})`)
      } else {
        check(/^Buscador sin configurar/.test(t) && /Falta la clave de OpenAI en el servidor \(Render\)/.test(t) && (await chip.getAttribute('data-configurado')) === 'no',
          `${como}: dice "Buscador sin configurar" y "Falta la clave de OpenAI en el servidor (Render)" ("${t}")`)
      }
      // Cerca del botón: abajo de "Buscar un precio", a menos de 30 px
      const bb = await page.getByRole('button', { name: 'Buscar un precio' }).boundingBox()
      const cb = await chip.boundingBox()
      check(bb && cb && cb.y >= bb.y + bb.height - 1 && cb.y - (bb.y + bb.height) < 30, `${como}: el estado está justo debajo del botón`)
      await shot(page, `1280_estado_${listo ? 'listo' : 'sin_configurar'}`)
      // Al abrir el buscador: sin configurar se avisa antes de buscar
      await page.getByRole('button', { name: 'Buscar un precio' }).click()
      const panel = page.getByTestId('buscar-precio')
      await panel.waitFor({ timeout: 5000 })
      await page.waitForTimeout(500)
      const aviso = panel.getByTestId('aviso-sin-configurar')
      if (listo) {
        check(await aviso.count() === 0, `${como}: el buscador abre sin aviso`)
      } else {
        const ta = await aviso.innerText().catch(() => '')
        check(/no está configurado/.test(ta) && /clave de OpenAI/.test(ta), `${como}: el buscador avisa al abrir, antes de buscar ("${ta.replace(/\s+/g, ' ').slice(0, 80)}…")`)
        await shot(page, '1280_buscador_aviso_al_abrir')
        await panel.getByPlaceholder(/cemento/).fill('cemento portland')
        check(await panel.getByRole('button', { name: 'Buscar', exact: true }).isEnabled(), `${como}: igual se puede tocar "Buscar"`)
        // Buscar sin la clave: el panel de "no configurado" con el mensaje del servidor
        if (!listoReal) {
          await panel.getByRole('button', { name: 'Buscar', exact: true }).click()
          const nc = panel.getByTestId('buscador-no-configurado')
          await nc.waitFor({ timeout: 15000 }).catch(() => {})
          const tn = await nc.innerText().catch(() => '')
          check(/El buscador de precios no está configurado/.test(tn) && /Render/.test(tn) && await aviso.count() === 0,
            `${como}: al buscar, el aviso de "no está configurado" reemplaza al de arriba`)
        }
      }
      await panel.getByRole('button', { name: 'Cerrar' }).click()
    }
    await probarEstado(listoReal, listoReal ? 'con FAKE_BUSCADOR=1 (servidor)' : 'sin FAKE_BUSCADOR (servidor)')
    await page.route('**/precios/buscador', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ configurado: !listoReal, modelo: 'gpt-de-prueba' }),
    }))
    await probarEstado(!listoReal, listoReal ? 'sin configurar (simulado)' : 'listo (simulado)')
    await page.unroute('**/precios/buscador')
    // Un servidor de antes (sin GET /precios/buscador): no se muestra nada, ni se rompe
    await page.route('**/precios/buscador', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Not Found"}' }))
    await irAPrecios(page)
    await page.waitForTimeout(600)
    check(await page.getByTestId('estado-buscador').count() === 0 && await page.getByRole('button', { name: 'Buscar un precio' }).isVisible(),
      'servidor sin el estado (404): no se muestra el estado y "Buscar un precio" sigue')
    await page.unroute('**/precios/buscador')

    // Errores del buscador por tipo (simulados): título claro y siempre el mensaje del servidor
    const ERRORES = [
      ['CLAVE_INVALIDA', 'La clave de OpenAI del servidor no es válida', 'La clave de OpenAI no anda', /Render/],
      ['SIN_CREDITO', 'Se terminó el crédito de OpenAI o hay demasiados pedidos: probá más tarde', 'OpenAI no atiende ahora', null],
      ['TIEMPO', 'La búsqueda tardó más de un minuto', 'La búsqueda tardó demasiado', null],
      ['MODELO', 'OpenAI no acepta el modelo gpt-de-prueba', 'OpenAI no acepta el modelo configurado', /Render/],
      ['ERROR_BUSQUEDA', 'OpenAI respondió algo que no se pudo leer', 'No pude buscar el precio', null],
    ]
    await irAPrecios(page)
    for (const [codigo, mensaje, titulo, extra] of ERRORES) {
      await page.route('**/precios/buscar', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ detail: { codigo, mensaje } }) }))
      await page.getByRole('button', { name: 'Buscar un precio' }).click()
      const panel = page.getByTestId('buscar-precio')
      await panel.getByPlaceholder(/cemento/).fill('cemento portland')
      await panel.getByRole('button', { name: 'Buscar', exact: true }).click()
      const caja = panel.getByTestId('buscador-error')
      await caja.waitFor({ timeout: 10000 }).catch(() => {})
      const te = (await caja.innerText().catch(() => '')).replace(/\s+/g, ' ')
      check(te.startsWith(titulo) && te.includes(mensaje) && (!extra || extra.test(te)) && !/\{|codigo/.test(te),
        `error ${codigo}: "${titulo}" y el mensaje del servidor ("${te.slice(0, 90)}")`)
      if (codigo === 'CLAVE_INVALIDA') await shot(page, '1280_buscador_clave_invalida')
      await panel.getByRole('button', { name: 'Cerrar' }).click()
      await page.unroute('**/precios/buscar')
    }

    // ─── 3. "Bajar un ejemplo (.csv)" ────────────────────────────────────────────────────────────────────────
    await irAPrecios(page)
    let form = await abrirFormularioCsv(page)
    const columnas = (await form.getByTestId('columnas-csv').innerText()).replace(/\s+/g, ' ')
    check(/código/.test(columnas) && /precio sin IVA/.test(columnas) && /descripción/.test(columnas) && /unidad/.test(columnas) && /fecha/.test(columnas) && /proveedor/.test(columnas),
      'el formulario dice en palabras qué columnas acepta')
    check(/«;»/.test(columnas) && /\$ 1\.234,50/.test(columnas), 'y que sirve el .csv del Excel con «;» y los precios como «$ 1.234,50»')
    const [descarga] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      form.getByRole('button', { name: 'Bajar un ejemplo (.csv)' }).click(),
    ])
    const ejemploPath = path.join(TMP, descarga.suggestedFilename())
    await descarga.saveAs(ejemploPath)
    const ejemplo = fs.readFileSync(ejemploPath, 'utf8')
    const lineas = ejemplo.replace(/^﻿/, '').trim().split(/\r?\n/)
    check(/\.csv$/.test(descarga.suggestedFilename()), `el ejemplo baja como .csv (${descarga.suggestedFilename()})`)
    check(lineas[0] === 'código;descripción;unidad;precio_unitario;fecha;proveedor', `el ejemplo tiene las columnas, separadas con ";" (${lineas[0]})`)
    check(lineas.length === 3 && /cemento/i.test(lineas[1]) && /arena/i.test(lineas[2]), 'el ejemplo trae dos renglones: cemento y arena')
    check(lineas.slice(1).every((l) => /^[^;]+;[^;]+;[^;]+;\d{1,3}(\.\d{3})*,\d{2};\d{2}\/\d{2}\/\d{4};/.test(l)), 'los precios del ejemplo van en formato argentino (12.450,00)')
    check(ejemplo.charCodeAt(0) === 0xfeff, 'el ejemplo empieza con la marca UTF-8 (el Excel lee bien las tildes)')

    // ─── 1. Subir un .csv con ";", tildes y "$ 1.234,50" ─────────────────────────────────────────────────────
    const csvPath = path.join(TMP, 'precios_corralon_octubre.csv')
    fs.writeFileSync(csvPath, '﻿' + CSV_BUENO)
    await form.locator('input[type=file]').setInputFiles(csvPath)
    const nombreInput = form.getByPlaceholder('Si lo dejás vacío, va el del archivo')
    check(await nombreInput.inputValue() === 'precios_corralon_octubre', `al elegir el archivo, el nombre se propone desde el archivo ("${await nombreInput.inputValue()}")`)
    await nombreInput.fill('Corralón Prueba E2E')
    await form.getByRole('combobox').selectOption('material')
    await shot(page, '1280_formulario_csv')
    await form.getByRole('button', { name: 'Subir el archivo' }).click()
    const aviso = page.getByTestId('csv-subido')
    await aviso.waitFor({ timeout: 30000 })
    const tAviso = (await aviso.innerText()).replace(/\s+/g, ' ')
    check(/Se cargaron 3 precios en «Corralón Prueba E2E»\./.test(tAviso), `dice "Se cargaron 3 precios en «Corralón Prueba E2E»" ("${tAviso.slice(0, 70)}")`)
    check(/2 renglones sin código o sin precio, no se cargaron/.test(tAviso), 'dice cuántos renglones no se cargaron y por qué (2, sin código o sin precio)')
    check(/Para que la app calcule con esta lista, marcala como oficial\./.test(tAviso), 'recuerda "Para que la app calcule con esta lista, marcala como oficial"')
    check(await page.getByTestId('subir-csv').count() === 0, 'el formulario se cierra al terminar')
    const cats = await j('GET', '/catalogs')
    const nueva = cats.find((c) => c.name === 'Corralón Prueba E2E')
    check(!!nueva && !nueva.oficial, 'la lista nueva está en el servidor, solo para consulta')
    if (nueva) creadas.push(nueva.id)
    const lista = page.locator(`[data-testid="lista-precios"][data-catalog-id="${nueva?.id}"]`)
    await lista.getByTestId('precio-renglon').first().waitFor({ timeout: 10000 }).catch(() => {})
    check(await lista.getByTestId('precio-renglon').count() === 3, `la lista nueva se abre sola con sus 3 precios (${await lista.getByTestId('precio-renglon').count()})`)
    const enVista = await lista.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 })
    check(enVista, 'la lista nueva queda a la vista')
    const entradas = nueva ? await j('GET', `/catalogs/${nueva.id}/entries`) : []
    const por = Object.fromEntries(entradas.map((e) => [e.codigo, e]))
    check(por['E2E-001']?.precio_sin_iva === 1234.5, `"$ 1.234,50" se lee 1234,5 (${por['E2E-001']?.precio_sin_iva})`)
    check(por['E2E-002']?.precio_sin_iva === 45000, `"$ 45.000" se lee 45000 (${por['E2E-002']?.precio_sin_iva})`)
    check(por['E2E-003']?.precio_sin_iva === 1234.5, `"1234.5" se lee 1234,5 (${por['E2E-003']?.precio_sin_iva})`)
    check(por['E2E-001']?.descripcion === 'Cemento de prueba x 50 kg' && por['E2E-001']?.unidad === 'bolsa' && por['E2E-001']?.proveedor === 'Corralón Prueba' && String(por['E2E-001']?.fecha_precio).startsWith('2026-10-01'),
      'los encabezados con tildes y mayúsculas se leen (descripción, unidad, proveedor y fecha)')
    const textoLista = (await lista.innerText()).replace(/\s+/g, ' ')
    check(/\$1\.235/.test(textoLista) && /\$45\.000/.test(textoLista), 'la pantalla muestra los precios ($1.235 y $45.000)')
    await shot(page, '1280_csv_subido')

    // Marcarla como oficial ahí mismo
    await aviso.getByRole('button', { name: 'Marcarla como oficial' }).click()
    await aviso.getByTestId('csv-ya-oficial').waitFor({ timeout: 10000 }).catch(() => {})
    check(await aviso.getByTestId('csv-ya-oficial').isVisible().catch(() => false), 'el botón "Marcarla como oficial" la marca ahí mismo')
    check((await lista.innerText()).includes('Oficial') && (await j('GET', '/catalogs')).find((c) => c.id === nueva?.id)?.oficial === true, 'la lista dice "Oficial" (y el servidor también)')
    await shot(page, '1280_csv_oficial')
    if (nueva) await j('PATCH', `/catalogs/${nueva.id}`, { oficial: false })

    // Sin nombre: va el del archivo. Se sube el ejemplo que se bajó recién
    form = await abrirFormularioCsv(page)
    await form.locator('input[type=file]').setInputFiles(ejemploPath)
    await form.getByPlaceholder('Si lo dejás vacío, va el del archivo').fill('')
    await form.getByRole('button', { name: 'Subir el archivo' }).click()
    await page.getByTestId('csv-subido').filter({ hasText: 'ejemplo' }).waitFor({ timeout: 30000 }).catch(() => {})
    const tEj = (await page.getByTestId('csv-subido').innerText()).replace(/\s+/g, ' ')
    check(/Se cargaron 2 precios en «ejemplo-lista-de-precios»/.test(tEj), `sin nombre, la lista lleva el del archivo; el ejemplo se sube tal cual ("${tEj.slice(0, 70)}")`)
    const ejCat = (await j('GET', '/catalogs')).find((c) => c.name === 'ejemplo-lista-de-precios')
    if (ejCat) {
      creadas.push(ejCat.id)
      const ee = await j('GET', `/catalogs/${ejCat.id}/entries`)
      check(ee.length === 2 && ee.every((e) => e.precio_sin_iva > 1000 && e.fecha_precio), `los precios del ejemplo se leen bien (${ee.map((e) => e.precio_sin_iva).join(', ')})`)
    }

    // ─── 2. Un .csv sin la columna del precio: el error dice qué falta ───────────────────────────────────────
    form = await abrirFormularioCsv(page)
    const malPath = path.join(TMP, 'sin_precio.csv')
    fs.writeFileSync(malPath, CSV_SIN_PRECIO)
    await form.locator('input[type=file]').setInputFiles(malPath)
    await form.getByRole('button', { name: 'Subir el archivo' }).click()
    const err = form.getByTestId('error-csv')
    await err.waitFor({ timeout: 15000 }).catch(() => {})
    const tErr = (await err.innerText().catch(() => '')).replace(/\s+/g, ' ')
    check(/falta/i.test(tErr) && /precio/i.test(tErr), `sin la columna del precio, el error dice qué falta ("${tErr}")`)
    check(/Tiene:/.test(tErr) && /código/.test(tErr), 'y qué columnas tiene, en palabras')
    check(!/\{|\}|detail|400/.test(tErr), 'el error no muestra código técnico')
    check(await form.isVisible(), 'el formulario sigue abierto para elegir otro archivo')
    await shot(page, '1280_csv_error')
    check(errores.length === 0, `sin errores de la página${errores.length ? ': ' + errores.join(' | ') : ''}`)
    await ctx.close()

    // ─── 5. Ayuda: la sección nueva ─────────────────────────────────────────────────────────────────────────
    const ctxA = await b.newContext({ viewport: { width: 1280, height: 900 } })
    const pa = await ctxA.newPage()
    await pa.goto(`${B}/app/ayuda`)
    const indice = pa.getByRole('navigation', { name: 'Índice' })
    await indice.waitFor({ timeout: 15000 })
    check(await indice.getByRole('link', { name: 'Buscar un precio en internet' }).count() === 1, 'Ayuda: el índice tiene "Buscar un precio en internet"')
    const sec = pa.locator('#buscar-precio')
    const tSec = (await sec.innerText()).replace(/\s+/g, ' ')
    check(/Buscar un precio en internet/.test(tSec), 'Ayuda: la sección tiene su título')
    check(/Lista de precios/.test(tSec) && /"Buscar un precio"/.test(tSec) && /"Buscar en internet"/.test(tSec) && /detalle de un trabajo/.test(tSec) && /rojo/.test(tSec), 'Ayuda: dice dónde están los botones (Lista de precios y detalle de un trabajo)')
    check(/corralones y ferreterías/.test(tSec) && /sin IVA/.test(tSec) && /unidad/.test(tSec) && /cuenta/.test(tSec) && /link/.test(tSec), 'Ayuda: dice qué hace (sin IVA, a la unidad, la cuenta y el link)')
    check(/precio, el comercio, la fecha y el link/.test(tSec) && /historial/.test(tSec), 'Ayuda: dice qué guarda y dónde se ve')
    check(/venta al público/.test(tSec), 'Ayuda: aclara que son precios de venta al público')
    check(/sin configurar/i.test(tSec) && /clave de OpenAI/.test(tSec) && /Render/.test(tSec), 'Ayuda: dice qué hacer si no está configurado')
    await indice.getByRole('link', { name: 'Buscar un precio en internet' }).click()
    await pa.waitForTimeout(900)
    // Es la última sección: la página no da para dejarla arriba de todo, pero tiene que quedar entera a la vista
    const caja = await sec.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight } })
    check(caja.top >= -2 && caja.top < caja.h - 150, `Ayuda: el índice lleva a la sección (queda a la vista: arriba en ${Math.round(caja.top)} px)`)
    await sec.screenshot({ path: path.join(SHOTS, '1280_ayuda_buscar_precio.png') })
    await ctxA.close()

    // ─── 6. Celular (390 px): nada se sale ──────────────────────────────────────────────────────────────────
    const ctxM = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
    const m = await ctxM.newPage()
    await irAPrecios(m)
    const chipM = m.getByTestId('estado-buscador')
    check(await chipM.isVisible().catch(() => false), '390: el estado del buscador se ve debajo de "Buscar un precio"')
    let s = await seSale(m)
    check(s.n === 0 && !s.ancha, `390: Lista de precios, nada se sale${textoSeSale(s)}`)
    await m.screenshot({ path: path.join(SHOTS, '390_precios_estado.png') })
    const formM = await abrirFormularioCsv(m)
    await formM.scrollIntoViewIfNeeded()
    s = await seSale(m)
    check(s.n === 0 && !s.ancha, `390: el formulario del .csv, nada se sale${textoSeSale(s)}`)
    const chicos = await botonesChicos(m, '[data-testid="subir-csv"] button, [data-testid="subir-csv"] input, [data-testid="subir-csv"] select')
    check(chicos.length === 0, `390: lo que se toca en el formulario mide 40 px o más${chicos.length ? ' — ' + chicos.join(', ') : ''}`)
    await formM.screenshot({ path: path.join(SHOTS, '390_formulario_csv.png') })
    const largo = path.join(TMP, 'lista_de_precios_del_corralon_con_un_nombre_muy_largo_para_el_celular_2026.csv')
    fs.writeFileSync(largo, CSV_BUENO)
    await formM.locator('input[type=file]').setInputFiles(largo)
    s = await seSale(m)
    check(s.n === 0 && !s.ancha, `390: con un archivo de nombre largo, nada se sale${textoSeSale(s)}`)
    await formM.getByRole('button', { name: 'Subir el archivo' }).click()
    const avisoM = m.getByTestId('csv-subido')
    await avisoM.waitFor({ timeout: 30000 })
    await m.waitForTimeout(800)
    const largoCat = (await j('GET', '/catalogs')).find((c) => c.name.startsWith('lista_de_precios_del_corralon'))
    if (largoCat) creadas.push(largoCat.id)
    s = await seSale(m)
    check(s.n === 0 && !s.ancha, `390: el aviso de la lista subida y la lista abierta, nada se sale${textoSeSale(s)}`)
    const chicosAviso = await botonesChicos(m, '[data-testid="csv-subido"] button')
    check(chicosAviso.length === 0, `390: los botones del aviso miden 40 px o más${chicosAviso.length ? ' — ' + chicosAviso.join(', ') : ''}`)
    await avisoM.scrollIntoViewIfNeeded()
    await m.screenshot({ path: path.join(SHOTS, '390_csv_subido.png') })
    await m.screenshot({ path: path.join(SHOTS, '390_csv_subido_entera.png'), fullPage: true })
    // El error, en el celular
    const formM2 = await abrirFormularioCsv(m)
    await formM2.locator('input[type=file]').setInputFiles(malPath)
    await formM2.getByRole('button', { name: 'Subir el archivo' }).click()
    await formM2.getByTestId('error-csv').waitFor({ timeout: 15000 }).catch(() => {})
    s = await seSale(m)
    check(await formM2.getByTestId('error-csv').isVisible().catch(() => false) && s.n === 0 && !s.ancha, `390: el error del .csv se ve y nada se sale${textoSeSale(s)}`)
    await formM2.screenshot({ path: path.join(SHOTS, '390_csv_error.png') })
    // El buscador con el aviso de no configurado (simulado si el servidor lo tiene)
    await m.route('**/precios/buscador', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configurado: false, modelo: 'gpt-de-prueba' }) }))
    await irAPrecios(m)
    s = await seSale(m)
    check(s.n === 0 && !s.ancha && /Buscador sin configurar/.test(await m.getByTestId('estado-buscador').innerText()), `390: "Buscador sin configurar" con su línea, nada se sale${textoSeSale(s)}`)
    await m.screenshot({ path: path.join(SHOTS, '390_precios_sin_configurar.png') })
    await m.getByRole('button', { name: 'Buscar un precio' }).click()
    await m.getByTestId('aviso-sin-configurar').waitFor({ timeout: 5000 }).catch(() => {})
    s = await seSale(m)
    check(await m.getByTestId('aviso-sin-configurar').isVisible().catch(() => false) && s.n === 0 && !s.ancha, `390: el buscador avisa al abrir y nada se sale${textoSeSale(s)}`)
    await m.screenshot({ path: path.join(SHOTS, '390_buscador_aviso_al_abrir.png') })
    await m.getByTestId('buscar-precio').getByRole('button', { name: 'Cerrar' }).click()
    await m.unroute('**/precios/buscador')
    // Ayuda
    await m.goto(`${B}/app/ayuda`)
    await m.locator('#buscar-precio').waitFor({ timeout: 15000 })
    await m.locator('#buscar-precio').scrollIntoViewIfNeeded()
    s = await seSale(m)
    check(s.n === 0 && !s.ancha, `390: Ayuda, nada se sale${textoSeSale(s)}`)
    await m.locator('#buscar-precio').screenshot({ path: path.join(SHOTS, '390_ayuda_buscar_precio.png') })
    await ctxM.close()
  } catch (e) {
    check(false, 'el recorrido se cortó: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e))
  } finally {
    for (const id of creadas) await j('DELETE', `/catalogs/${id}`).catch(() => {})
    await b.close()
    fs.rmSync(TMP, { recursive: true, force: true })
  }
  console.log(`\n${ok} OK, ${bad} FALLAS`)
  process.exitCode = bad ? 1 : 0
})()
