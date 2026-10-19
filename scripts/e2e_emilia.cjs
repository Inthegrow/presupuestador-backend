// Entrega 11 (PLAN_PRUEBAS_EMILIA.md): cada cosa que hizo Emilia el 19/10 como una prueba (E1–E15), más el celular
// (390 px) de lo nuevo. E16 son los e2e de siempre.
// Corre contra vite (5179, sin login) + scripts/serve_fake.py (8000), con los archivos de Emilia en EXCEL_DIR:
// emilia_hoja1.xlsx, emilia_prueba3.xlsx, emilia_modelo.xlsx y ginkgo.xlsx.
// Uso: EXCEL_DIR=<carpeta> SHOTS_DIR=<carpeta> NODE_PATH=<node_modules con playwright> node scripts/e2e_emilia.cjs
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const B = 'http://127.0.0.1:5179', API = 'http://127.0.0.1:8000'
const EXCEL = process.env.EXCEL_DIR || path.join(__dirname, 'excel')
const SHOTS = path.join(process.env.SHOTS_DIR || path.join(EXCEL, 'shots'), 'emilia')
fs.mkdirSync(SHOTS, { recursive: true })
const archivo = (n) => path.join(EXCEL, n)

let ok = 0, bad = 0
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); c ? ok++ : bad++ }
const info = (m) => console.log('INFO  ' + m)

async function api(method, url, body) {
  const r = await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined })
  const t = await r.text()
  let data = t
  try { data = JSON.parse(t) } catch { /* texto */ }
  return { status: r.status, data }
}
async function subirApi(url, nombre, extra = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([fs.readFileSync(archivo(nombre))]), nombre)
  for (const [k, v] of Object.entries(extra)) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v))
  const r = await fetch(API + url, { method: 'POST', body: fd })
  const t = await r.text()
  let data = t
  try { data = JSON.parse(t) } catch { /* texto */ }
  return { status: r.status, data }
}
const presupuestos = async () => { const r = await api('GET', '/budgets'); return Array.isArray(r.data) ? r.data : [] }
const listas = async () => { const r = await api('GET', '/catalogs'); return Array.isArray(r.data) ? r.data : [] }
const shot = (page, nombre, full = false) => page.screenshot({ path: path.join(SHOTS, nombre + '.png'), fullPage: full }).catch(() => {})
const corto = (e) => (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e))

async function bloque(nombre, fn) {
  console.log(`\n── ${nombre}`)
  try {
    await fn()
  } catch (e) {
    check(false, `${nombre}: el recorrido se cortó: ${corto(e)}`)
  }
}

/** Nada más ancho que la ventana, salvo adentro de una caja que se desliza de costado (como en e2e_celular) */
async function seSale(page) {
  return page.evaluate(() => {
    const W = innerWidth
    const enCaja = (el) => {
      for (let a = el.parentElement; a && a !== document.body && a.tagName !== 'MAIN'; a = a.parentElement) {
        const s = getComputedStyle(a)
        const r = a.getBoundingClientRect()
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') && r.right <= W + 1 && r.left >= -1) return true
      }
      return false
    }
    const fuera = []
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (getComputedStyle(el).visibility === 'hidden' || el.closest('[aria-hidden=true]') || el.closest('[inert]')) continue
      if ((r.right > W + 1 || r.left < -1) && !enCaja(el)) {
        fuera.push(`${el.tagName.toLowerCase()}.${String(el.className || '').slice(0, 40)} (${Math.round(r.left)}–${Math.round(r.right)}) "${(el.innerText || '').slice(0, 30).replace(/\n/g, ' ')}"`)
      }
    }
    const main = document.querySelector('main')
    const ancha = (main ? main.scrollWidth > main.clientWidth + 1 : false) || document.documentElement.scrollWidth > W + 1
    return { n: fuera.length, fuera: fuera.slice(0, 4), ancha }
  })
}
const textoSeSale = (s) => (s.n ? ' — ' + s.fuera.join(' | ') : '') + (s.ancha ? ' (la página se desliza de costado)' : '')
async function sinDesborde(page, donde) {
  const s = await seSale(page)
  check(s.n === 0 && !s.ancha, `390, ${donde}: nada se sale de la pantalla${textoSeSale(s)}`)
}
/** Lo que se toca y mide menos de 40 px de alto */
async function chicos(page, selector) {
  return page.evaluate((selector) => {
    const out = []
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || el.closest('[aria-hidden=true]') || el.closest('[inert]')) continue
      if (r.height < 39.5) out.push(`"${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 25)}" ${Math.round(r.height)}px`)
    }
    return out
  }, selector)
}
/** Campos de texto con letra de menos de 16 px (el celular hace zoom al tocarlos) */
async function letraChica(page, selector) {
  return page.evaluate((selector) => {
    const out = []
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs < 16) out.push(`${el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.id || el.tagName} ${fs}px`)
    }
    return out
  }, selector)
}

// ─── Importar Excel y Cargar obra ──────────────────────────────────────────────

/** Sube un Excel en Importar Excel y devuelve la respuesta del servidor (status y cuerpo) */
async function importarEnPantalla(page, nombre) {
  await page.goto(`${B}/app/import`)
  await page.locator('input[type=file]').first().waitFor({ state: 'attached', timeout: 20000 })
  await page.locator('input[type=file]').first().setInputFiles(archivo(nombre))
  const resp = page.waitForResponse((r) => r.url().includes('/budgets/import-excel') && r.request().method() === 'POST', { timeout: 300000 })
  await page.getByRole('button', { name: 'Importar como presupuesto nuevo' }).click()
  const r = await resp
  let body = null
  try { body = await r.json() } catch { /* sin cuerpo */ }
  return { status: r.status(), body }
}

/** Espera a que Cargar obra termine de revisar (la primera vez o después de un cambio) */
async function esperarRevision(page, timeout = 180000) {
  const fin = Date.now() + timeout
  await page.waitForTimeout(300)
  while (Date.now() < fin) {
    const revisando = await page.getByTestId('revisando').count()
    const primera = await page.getByText('Revisando el Excel…').count()
    if (!revisando && !primera) return true
    await page.waitForTimeout(400)
  }
  return false
}

async function subirEnCargarObra(page, nombre) {
  await page.goto(`${B}/app/cargar-obra`)
  await page.locator('input[type=file]').first().waitFor({ state: 'attached', timeout: 20000 })
  // Si quedó un borrador de antes, se descarta (la prueba sube el archivo de nuevo)
  if (await page.getByRole('button', { name: 'Descartar' }).count()) await page.getByRole('button', { name: 'Descartar' }).click()
  await page.locator('input[type=file]').first().setInputFiles(archivo(nombre))
  await page.getByTestId('tarea-obra').first().waitFor({ timeout: 180000 })
  await esperarRevision(page)
}

/** Lo que queda en rojo en Cargar obra: preguntas con 1, sin fórmula ni precio en $0; y "Cargar igual" si falta un precio */
async function resolverRojos(page) {
  const hechos = new Set()
  for (let k = 0; k < 80; k++) {
    const cards = page.locator('[data-testid=tarea-obra][data-estado=rojo]')
    const n = await cards.count()
    let hizo = false
    for (let i = 0; i < n; i++) {
      const c = cards.nth(i)
      const clave = await c.getAttribute('data-clave').catch(() => null)
      if (!clave || hechos.has(clave)) continue
      hechos.add(clave)
      const sp = c.getByTestId('cargar-sin-precio')
      const inp = c.locator('input[type=number]')
      if (await inp.count()) {
        await inp.first().fill('1')
        await inp.first().press('Enter')
        hizo = true
      } else if (await sp.count()) {
        await sp.click()
        hizo = true
      }
      if (hizo) break
    }
    if (!hizo) break
    await page.waitForTimeout(150)
  }
  await esperarRevision(page)
  const igual = page.locator('label', { hasText: 'Cargar igual' }).locator('input[type=checkbox]')
  if (await igual.count() && await igual.isEnabled() && !(await igual.isChecked())) await igual.check()
}

/** Carga una obra por el servidor (lo mismo que Cargar obra): lo rojo sin fórmula o con pregunta va sin precio ($0) */
async function cargarPorApi(nombreArchivo, nombre) {
  let asign = {}
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const an = await subirApi('/obras/analizar', nombreArchivo, { asignaciones: asign })
    if (an.status !== 200) return { status: an.status, data: an.data }
    const rojos = an.data.tareas.filter((t) => t.estado === 'rojo' && t.motivo_rojo !== 'precio' && !asign[t.clave])
    if (!rojos.length) break
    asign = { ...asign }
    for (const t of rojos) asign[t.clave] = { plantillas: [], confirmada: true, sin_precio: true }
  }
  return subirApi('/obras/cargar', nombreArchivo, { asignaciones: asign, nombre, permitir_sin_precio: 'true' })
}

const nombreDe = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

;(async () => {
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const errores = []
  page.on('pageerror', (e) => errores.push(e.message))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  const ctxM = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const m = await ctxM.newPage()
  m.on('dialog', (d) => d.accept().catch(() => {}))

  // La lista oficial: los precios de las fórmulas salen de ahí (E10)
  for (const c of await listas()) if (String(c.name).startsWith('Maestro')) await api('PATCH', `/catalogs/${c.id}`, { oficial: true })

  let idModelo = null // E7: el presupuesto importado del modelo
  let idTipicos = null // E10: el de Trabajos típicos
  let idHoja1 = null // E5: el de Cargar obra con emilia_hoja1

  // ─── E1. Importar Excel con emilia_hoja1: no se crea nada, va a Cargar obra con el archivo ya elegido ───────
  await bloque('E1 Importar Excel con emilia_hoja1', async () => {
    const antes = { p: (await presupuestos()).length, l: (await listas()).length }
    const r = await importarEnPantalla(page, 'emilia_hoja1.xlsx')
    check(r.status === 422 && r.body?.detail?.codigo === 'CARGAR_OBRA', `E1: el servidor contesta 422 CARGAR_OBRA (${r.status} ${JSON.stringify(r.body?.detail ?? r.body).slice(0, 120)})`)
    await page.getByTestId('ir-a-cargar-obra').waitFor({ timeout: 15000 })
    const msg = (await page.getByTestId('mensaje-cargar-obra').innerText()).replace(/\s+/g, ' ')
    check(/cómputo sin precios/i.test(msg) && /Cargar obra/.test(msg), `E1: la pantalla dice que trae el cómputo sin precios y que va por Cargar obra ("${msg.slice(0, 140)}")`)
    const despues = { p: (await presupuestos()).length, l: (await listas()).length }
    check(despues.p === antes.p && despues.l === antes.l, `E1: no se creó nada (presupuestos ${antes.p} → ${despues.p}, listas ${antes.l} → ${despues.l})`)
    check(await page.getByText('Listo: quedó importado').count() === 0, 'E1: no dice «Listo»')
    await shot(page, 'E1_importar_hoja1')
    await page.getByRole('button', { name: 'Cargarlo en Cargar obra' }).click()
    await page.waitForURL(/\/app\/cargar-obra$/, { timeout: 10000 })
    check(await page.getByText('emilia_hoja1.xlsx').count() > 0, 'E1: Cargar obra abre con emilia_hoja1.xlsx ya elegido')
    await page.getByTestId('tarea-obra').first().waitFor({ timeout: 180000 })
    await esperarRevision(page)
    check(await page.getByTestId('tarea-obra').count() > 0, 'E1: y lo revisa solo, como si lo hubiera elegido ahí (aparecen las tarjetas)')
  })

  // ─── E3. Cargar obra con emilia_hoja1: lee la solapa aunque no se llame 01_C&P ──────────────────────────
  await bloque('E3 Cargar obra con emilia_hoja1', async () => {
    const an = await subirApi('/obras/analizar', 'emilia_hoja1.xlsx', { asignaciones: {} })
    check(an.status === 200, `E3: el servidor analiza emilia_hoja1 (${an.status} ${an.status !== 200 ? JSON.stringify(an.data).slice(0, 160) : ''})`)
    if (an.status !== 200) return
    const d = an.data
    check(d.hoja === 'Hoja1', `E3: dice qué solapa leyó: «${d.hoja}»`)
    check(d.resumen.trabajos >= 100, `E3: arma los trabajos desde el renglón de títulos (${d.resumen.trabajos} trabajos, ${d.resumen.rubros} rubros, ${d.resumen.pisos} pisos)`)
    check(!d.tareas.some((t) => /^descripci[oó]n$/i.test(String(t.descripcion).trim())), 'E3: el renglón de títulos (CODIGO / DESCRIPCIÓN…) no es un trabajo')
    // En pantalla (la de E1): «Leí la solapa «Hoja1»»
    if (!/cargar-obra/.test(page.url())) await subirEnCargarObra(page, 'emilia_hoja1.xlsx')
    const hoja = await page.getByTestId('hoja-leida').innerText().catch(() => '')
    check(/Leí la solapa «Hoja1»/.test(hoja), `E3: la pantalla dice «Leí la solapa «Hoja1»» ("${hoja}")`)
    await shot(page, 'E3_cargar_obra_hoja1')
  })

  // ─── E5. Sin fórmula y sin precio: «Cargarlo sin precio ($0)» y «Cargar los N sin fórmula en $0» ───────────
  await bloque('E5 Cargar obra: los sin fórmula y sin precio no frenan', async () => {
    if (!/cargar-obra/.test(page.url()) || !(await page.getByTestId('tarea-obra').count())) await subirEnCargarObra(page, 'emilia_hoja1.xlsx')
    const banner = page.getByTestId('banner-sin-precio')
    await banner.waitFor({ timeout: 15000 })
    const tb = (await banner.innerText()).replace(/\s+/g, ' ')
    const mN = /Cargar los (\d+) sin fórmula en \$0/.exec(tb)
    check(!!mN, `E5: arriba dice «Cargar los N sin fórmula en $0» ("${tb.slice(0, 160)}")`)
    const an = await subirApi('/obras/analizar', 'emilia_hoja1.xlsx', { asignaciones: {} })
    const nServidor = an.data?.sin_formula_sin_precio
    check(typeof nServidor === 'number' && mN && Number(mN[1]) === nServidor, `E5: N es lo que cuenta el servidor (pantalla ${mN && mN[1]}, servidor ${nServidor})`)
    check(await page.getByTestId('cargar-sin-precio').count() > 0, 'E5: cada tarjeta sin fórmula y sin precio ofrece «Cargarlo sin precio ($0)»')
    await shot(page, 'E5_banner_sin_precio')
    // Uno solo: la tarjeta deja de estar en rojo enseguida
    const tarjeta = page.locator('[data-testid=tarea-obra]').filter({ has: page.getByTestId('cargar-sin-precio') }).first()
    const clave = await tarjeta.getAttribute('data-clave')
    await tarjeta.getByTestId('cargar-sin-precio').click()
    const unaCard = page.locator(`[data-testid=tarea-obra][data-clave="${clave}"]`)
    check(await unaCard.getAttribute('data-estado') !== 'rojo', `E5: «Cargarlo sin precio ($0)» la saca del rojo enseguida (${await unaCard.getAttribute('data-estado')})`)
    await page.getByTestId('cargar-todos-sin-precio').click()
    await page.waitForTimeout(300)
    check(await page.getByTestId('banner-sin-precio').count() === 0 && await page.getByTestId('cargar-sin-precio').count() === 0, 'E5: «Cargar los N…» los saca a todos del rojo enseguida')
    await esperarRevision(page)
    check(await page.getByTestId('banner-sin-precio').count() === 0, 'E5: después de revisar con el servidor siguen fuera del rojo (el servidor acepta sin_precio)')
    await resolverRojos(page)
    await shot(page, 'E5_resueltos')
    const nombre = `Emilia hoja1 E2E ${Date.now() % 100000}`
    await page.getByLabel('Nombre del presupuesto').fill(nombre)
    const boton = page.getByRole('button', { name: 'Cargar presupuesto' })
    check(await boton.isEnabled(), `E5: se puede cargar (${(await page.locator('text=/Te falta|Falta resolver/').allInnerTexts().catch(() => [])).join(' | ').slice(0, 160)})`)
    await boton.click()
    await page.getByRole('button', { name: 'Abrir el presupuesto' }).waitFor({ timeout: 300000 })
    const pres = (await presupuestos()).find((x) => x.name === nombre)
    idHoja1 = pres?.id ?? null
    check(!!idHoja1, `E5: quedó cargado «${nombre}»`)
    await page.getByRole('button', { name: 'Abrir el presupuesto' }).click()
    await page.waitForURL(/\/editor$/, { timeout: 15000 })
    await page.locator('[data-testid=tabla-trabajos] tbody tr').first().waitFor({ timeout: 30000 })
    await page.waitForTimeout(1500)
    const botones = page.getByTestId('elegir-formula-renglon')
    check(await botones.count() > 0, `E5: en el editor, los trabajos sin fórmula tienen «Elegir fórmula» en el renglón (${await botones.count()} en el rubro elegido)`)
    const fila = page.locator('[data-testid=tabla-trabajos] tbody tr').filter({ has: page.getByTestId('elegir-formula-renglon') }).first()
    check(await fila.locator('[data-semaforo=rojo]').count() === 1, 'E5: y están en rojo')
    await shot(page, 'E5_editor_elegir_formula')
    // «Elegir fórmula» abre el buscador de fórmulas y la aplica
    const desc = (await fila.locator('td').nth(1).innerText()).split('\n')[0].trim()
    await fila.getByTestId('elegir-formula-renglon').click()
    const dlg = page.getByTestId('elegir-formula')
    await dlg.waitFor({ timeout: 10000 })
    await dlg.locator('[data-testid=lista-formulas] button').first().waitFor({ timeout: 20000 })
    await dlg.getByPlaceholder(/Buscá como hablás/).fill('hueco 18')
    await dlg.locator('[data-testid=lista-formulas] button').first().click()
    const pregunta = dlg.locator('input[inputmode=decimal]')
    await Promise.race([dlg.waitFor({ state: 'detached', timeout: 30000 }), pregunta.waitFor({ timeout: 30000 })]).catch(() => {})
    if (await dlg.count() && await pregunta.count()) {
      await pregunta.fill('1')
      await dlg.getByRole('button', { name: 'Aplicar' }).click()
    }
    if (await dlg.count() && await dlg.getByRole('button', { name: 'Reemplazar' }).count()) await dlg.getByRole('button', { name: 'Reemplazar' }).click()
    await dlg.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
    check(await dlg.count() === 0, 'E5: al elegir la fórmula, la ventana se cierra')
    const items = (await api('GET', `/budgets/${idHoja1}/items`)).data
    const it = Array.isArray(items) ? items.find((i) => (i.description || '').trim() === desc) : null
    check(!!it?.template_id, `E5: «${desc}» quedó con la fórmula (template_id ${it?.template_id ?? 'ninguno'})`)
    await page.waitForTimeout(800)
    const filaDespues = page.locator('[data-testid=tabla-trabajos] tbody tr').filter({ hasText: desc }).first()
    check(await filaDespues.getByTestId('elegir-formula-renglon').count() === 0, 'E5: y su renglón ya no ofrece «Elegir fórmula» (la tabla se refrescó)')
  })

  // ─── E2. Importar Excel con emilia_prueba3: igual que E1 ─────────────────────────────────────────────────
  await bloque('E2 Importar Excel con emilia_prueba3', async () => {
    const antes = { p: (await presupuestos()).length, l: (await listas()).length }
    const r = await importarEnPantalla(page, 'emilia_prueba3.xlsx')
    check(r.status === 422 && r.body?.detail?.codigo === 'CARGAR_OBRA', `E2: 422 CARGAR_OBRA (${r.status})`)
    await page.getByTestId('ir-a-cargar-obra').waitFor({ timeout: 15000 })
    const despues = { p: (await presupuestos()).length, l: (await listas()).length }
    check(despues.p === antes.p && despues.l === antes.l, `E2: no se creó nada (presupuestos ${antes.p} → ${despues.p}, listas ${antes.l} → ${despues.l})`)
    check(await page.getByRole('button', { name: 'Cargarlo en Cargar obra' }).isVisible(), 'E2: ofrece «Cargarlo en Cargar obra»')
    await page.getByRole('button', { name: 'Cargarlo en Cargar obra' }).click()
    await page.waitForURL(/\/app\/cargar-obra$/, { timeout: 10000 })
    await page.getByTestId('tarea-obra').first().waitFor({ timeout: 180000 })
    check(await page.getByText('emilia_prueba3.xlsx').count() > 0, 'E2: Cargar obra abre con emilia_prueba3.xlsx y lo revisa')
  })

  // ─── E4. Cargar obra con emilia_prueba3: títulos, códigos-fecha y «3.1-1» ─────────────────────────────────
  await bloque('E4 Cargar obra con emilia_prueba3', async () => {
    const an = await subirApi('/obras/analizar', 'emilia_prueba3.xlsx', { asignaciones: {} })
    check(an.status === 200, `E4: el servidor analiza emilia_prueba3 (${an.status})`)
    if (an.status !== 200) return
    const d = an.data
    const codigos = new Set(d.tareas.flatMap((t) => t.codigos || []))
    check(['1.1', '1.2', '2.1'].every((c) => codigos.has(c)), `E4: los códigos-fecha vuelven a ser 1.1, 1.2, 2.1 (${[...codigos].slice(0, 8).join(', ')}…)`)
    check(![...codigos].some((c) => /\/|20\d\d|:/.test(c)), 'E4: ningún código quedó como fecha')
    check(codigos.has('3.1.1') && ![...codigos].some((c) => /-/.test(c)), `E4: «3.1-1» se lee 3.1.1 (${[...codigos].filter((c) => c.startsWith('3.1')).join(', ')})`)
    check(!d.tareas.some((t) => /^descripci[oó]n$/i.test(String(t.descripcion).trim())), 'E4: la fila «CODIGO / DESCRIPCIÓN…» no es un trabajo')
    check(!d.tareas.some((t) => /^\d+(\.\d+)?\s*-\s/.test(String(t.descripcion)) || /tareas preliminares|^fundaciones$/i.test(String(t.descripcion).trim())),
      'E4: «1- TAREAS PRELIMINARES» y «3.1- FUNDACIONES» son títulos, no trabajos')
    check(d.resumen.rubros >= 4 && d.resumen.pisos >= 11, `E4: rubros y pisos del Excel (${d.resumen.rubros} rubros, ${d.resumen.pisos} pisos)`)
    check(d.hoja === '01_C&P' || !d.hoja, `E4: leyó la solapa 01_C&P («${d.hoja}»)`)
    if (/cargar-obra/.test(page.url())) {
      await esperarRevision(page)
      check(await page.getByTestId('hoja-leida').count() === 0, 'E4: con 01_C&P no hace falta decir qué solapa leyó')
      await shot(page, 'E4_cargar_obra_prueba3')
    }
  })

  // ─── E6. Cargar obra con emilia_modelo: CYP, títulos en la columna A, notas y la fórmula por código ──────────
  await bloque('E6 Cargar obra con emilia_modelo', async () => {
    const an = await subirApi('/obras/analizar', 'emilia_modelo.xlsx', { asignaciones: {} })
    check(an.status === 200, `E6: el servidor analiza emilia_modelo (${an.status} ${an.status !== 200 ? JSON.stringify(an.data).slice(0, 160) : ''})`)
    if (an.status !== 200) return
    const d = an.data
    check(d.hoja === 'CYP', `E6: lee la solapa «CYP» («${d.hoja}»)`)
    check(d.resumen.rubros >= 8, `E6: los rubros con el título en la columna A (${d.resumen.rubros} rubros, ${d.resumen.pisos} pisos)`)
    check(!d.tareas.some((t) => /^\d+\s*-\s*\d*\s*[A-ZÁÉÍÓÚÑ]/.test(String(t.descripcion).trim())), 'E6: «2- MOVIMIENTO DE SUELO», «4 -1 FUNDACIONES», «7-1 REVESTIMIENTO» no son trabajos')
    check(!d.tareas.some((t) => /replicar puntos|dejar un item libre/i.test(String(t.descripcion))), 'E6: «Replicar puntos…» y «Dejar un item libre…» no son trabajos')
    check(/replicar puntos/i.test(JSON.stringify(d)), 'E6: van como aviso')
    const t413 = d.tareas.find((t) => (t.codigos || []).includes('4.1.3'))
    const rec = t413?.receta
    const usa413 = !!rec && ((rec.codigo === '4.1.3') || (rec.partes || []).some((p) => p.codigo === '4.1.3'))
    check(usa413 && t413.estado !== 'rojo', `E6: 4.1.3 Bases aisladas usa la fórmula 4.1.3 (${rec ? rec.codigo : 'sin fórmula'}, ${t413?.estado})`)
    // «Precios para corregir» como hoy: cada código que falta trae lo que dice el archivo (lista 00_ u hoja de detalle)
    const precios = d.precios || []
    const conPropuesta = precios.filter((p) => p.propuesta && p.propuesta.precio > 0)
    info(`E6: precios para corregir ${precios.length}; con lo que trae el archivo ${conPropuesta.length} (${[...new Set(conPropuesta.map((p) => p.propuesta.hoja))].slice(0, 6).join(', ')})`)
    check(precios.length === 0 || conPropuesta.length > 0, `E6: los precios que trae el archivo se ofrecen en «Precios para corregir» (${conPropuesta.length} de ${precios.length})`)
    await subirEnCargarObra(page, 'emilia_modelo.xlsx')
    const hoja = await page.getByTestId('hoja-leida').innerText().catch(() => '')
    check(/Leí la solapa «CYP»/.test(hoja), `E6: la pantalla dice «Leí la solapa «CYP»» ("${hoja}")`)
    await page.getByRole('button', { name: /^Todos \(/ }).click()
    await page.waitForTimeout(400)
    check(/replicar puntos/i.test(await page.locator('main').innerText()), 'E6: el aviso «Replicar puntos…» se ve en la pantalla')
    await shot(page, 'E6_cargar_obra_modelo')
  })

  // ─── E9. Importar no traba el servidor: /templates contesta en menos de 3 s ──────────────────────────────
  await bloque('E9 Importar no traba el servidor', async () => {
    let terminoEn = 0
    const t0 = Date.now()
    const imp = subirApi('/budgets/import-excel', 'emilia_modelo.xlsx').then((r) => { terminoEn = Date.now(); return r })
    await new Promise((res) => setTimeout(res, 400))
    const tiempos = []
    for (let i = 0; i < 4 && !terminoEn; i++) {
      const s = Date.now()
      const r = await fetch(API + '/templates')
      await r.text()
      tiempos.push({ ms: Date.now() - s, durante: !terminoEn, status: r.status })
    }
    const r = await imp
    info(`E9: la importación tardó ${((terminoEn - t0) / 1000).toFixed(1)} s; /templates: ${tiempos.map((t) => `${t.ms} ms${t.durante ? '' : ' (después)'}`).join(', ')}`)
    const durante = tiempos.filter((t) => t.durante)
    check(durante.length > 0, 'E9: se pidió /templates mientras la importación seguía')
    check(durante.length > 0 && durante.every((t) => t.ms < 3000 && t.status === 200), `E9: /templates contesta en menos de 3 s durante la importación (máx. ${Math.max(0, ...durante.map((t) => t.ms))} ms)`)
    check(r.status === 200, `E9: la importación terminó bien (${r.status})`)
  })

  // ─── E7. Importar Excel con emilia_modelo: trabajos de CYP con sus recursos ──────────────────────────────
  await bloque('E7 Importar Excel con emilia_modelo', async () => {
    const r = await importarEnPantalla(page, 'emilia_modelo.xlsx')
    check(r.status === 200, `E7: importa (${r.status} ${r.status !== 200 ? JSON.stringify(r.body).slice(0, 160) : ''})`)
    if (r.status !== 200) return
    idModelo = r.body.budget_id
    check(r.body.items_inserted > 50 && r.body.resources_inserted > 0, `E7: arma los trabajos de CYP con sus recursos (${r.body.items_inserted} trabajos, ${r.body.resources_inserted} recursos, ${r.body.catalog_entries} precios)`)
    await page.getByRole('button', { name: 'Abrir el presupuesto' }).waitFor({ timeout: 15000 })
    await shot(page, 'E7_importado_modelo')
    const items = (await api('GET', `/budgets/${idModelo}/items`)).data
    const trabajos = items.filter((i) => i.notas !== 'Seccion')
    check(trabajos.some((i) => i.code === '4.1.3') && trabajos.some((i) => i.code === '5.1.4'), 'E7: están 4.1.3 y 5.1.4')
    check(trabajos.some((i) => i.code === '2.1'), 'E7: 2.1 (sin detalle ni precio) igual entra')
    check(!items.some((i) => /^descripci[oó]n$/i.test(String(i.description).trim()) || /replicar puntos/i.test(String(i.description))), 'E7: ni la fila de títulos ni «Replicar puntos…» son trabajos')
    const conRec = trabajos.find((i) => i.code === '4.1.3')
    if (conRec) {
      const recs = (await api('GET', `/budgets/${idModelo}/items/${conRec.id}/resources`)).data
      check(Array.isArray(recs) && recs.length > 0, `E7: 4.1.3 trae los recursos de su hoja de detalle (${Array.isArray(recs) ? recs.length : 0})`)
    }
  })

  // ─── E8. Abrir el presupuesto importado; si el servidor no contesta, lo dice y se reintenta ──────────────
  await bloque('E8 Abrir el presupuesto y errores de carga', async () => {
    if (!idModelo) { check(false, 'E8: no hay presupuesto de E7 para abrir'); return }
    await page.goto(`${B}/app/budgets/${idModelo}/editor`)
    await page.locator('[data-testid=tabla-trabajos] tbody tr').first().waitFor({ timeout: 30000 })
    const nombre = (await api('GET', `/budgets/${idModelo}`)).data.name
    check((await page.locator('h1').first().innerText()).includes(String(nombre).toUpperCase()), `E8: el editor muestra el nombre («${nombre}»)`)
    check(await page.locator('[data-testid=tabla-trabajos] tbody tr').count() > 0, 'E8: y los trabajos')
    // /full falla una vez (500 con mensaje)
    let falla = 1
    await page.route('**/budgets/*/full', (r) => {
      if (falla-- > 0) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Se cortó la conexión con la base"}' })
      return r.continue()
    })
    await page.reload()
    const err = page.getByTestId('error-presupuesto')
    await err.waitFor({ timeout: 20000 })
    const t = (await err.innerText()).replace(/\s+/g, ' ')
    check(/No pude traer el presupuesto: se cortó la conexión con la base/i.test(t), `E8: dice «No pude traer el presupuesto: {motivo}» ("${t.slice(0, 120)}")`)
    check(await page.getByText(/todavía no tiene trabajos/).count() === 0 && await page.getByText('Elegí un rubro en el árbol').count() === 0, 'E8: nunca «todavía no tiene trabajos» si no lo pudo leer')
    await shot(page, 'E8_error_presupuesto')
    await err.getByRole('button', { name: 'Reintentar' }).click()
    await page.locator('[data-testid=tabla-trabajos] tbody tr').first().waitFor({ timeout: 30000 })
    check(await page.getByTestId('error-presupuesto').count() === 0, 'E8: «Reintentar» lo trae y el aviso se va')
    await page.unroute('**/budgets/*/full')
    // Sin conexión: el motivo lo dice
    falla = 1
    await page.route('**/budgets/*/items', (r) => {
      if (r.request().method() === 'GET' && falla-- > 0) return r.abort('failed')
      return r.continue()
    })
    await page.reload()
    await page.getByTestId('error-presupuesto').waitFor({ timeout: 20000 })
    const t2 = (await page.getByTestId('error-presupuesto').innerText()).replace(/\s+/g, ' ')
    check(/No pude traer el presupuesto: no me pude comunicar con el servidor/i.test(t2), `E8: sin conexión, el motivo es la conexión ("${t2.slice(0, 120)}")`)
    await page.getByTestId('error-presupuesto').getByRole('button', { name: 'Reintentar' }).click()
    await page.locator('[data-testid=tabla-trabajos] tbody tr').first().waitFor({ timeout: 30000 })
    await page.unroute('**/budgets/*/items')
    // La lista de fórmulas de «Agregá un trabajo»
    falla = 1
    await page.route('**/api/templates', (r) => {
      if (r.request().method() === 'GET' && falla-- > 0) return r.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' })
      return r.continue()
    })
    await page.reload()
    const errF = page.getByTestId('error-lista-formulas')
    await errF.waitFor({ timeout: 20000 })
    check(/No pude traer la lista de fórmulas/.test(await errF.innerText()), 'E8: «No pude traer la lista de fórmulas»…')
    await shot(page, 'E8_error_lista_formulas')
    await errF.getByRole('button', { name: 'Reintentar' }).click()
    await page.waitForTimeout(1500)
    check(await page.getByTestId('error-lista-formulas').count() === 0, 'E8: …con «Reintentar», que la trae')
    await page.unroute('**/api/templates')
  })

  // ─── E10. Nuevo presupuesto → Trabajos típicos del modelo de Terrac ─────────────────────────────────────
  await bloque('E10 Trabajos típicos del modelo de Terrac', async () => {
    const mod = await api('GET', '/modelo-terrac')
    check(mod.status === 200, `E10: GET /modelo-terrac contesta (${mod.status})`)
    const rubrosApi = Array.isArray(mod.data) ? mod.data : mod.data?.rubros
    check(Array.isArray(rubrosApi) && rubrosApi.map((r) => String(r.codigo)).join(',') === '1,2,3,4,5,6,7,8,9', `E10: rubros 1…9 en el orden de Terrac (${Array.isArray(rubrosApi) ? rubrosApi.map((r) => `${r.codigo} ${r.nombre}`).join(' · ') : 'sin rubros'})`)
    const nombre = `Típicos Terrac E2E ${Date.now() % 100000}`
    await page.goto(`${B}/app/new-project`)
    if (await page.getByRole('button', { name: 'Descartar' }).count()) await page.getByRole('button', { name: 'Descartar' }).click()
    await page.getByLabel(/Nombre del presupuesto/).fill(nombre)
    await page.getByRole('button', { name: /Siguiente/ }).click()
    await page.getByTestId('trabajos-tipicos').waitFor({ timeout: 20000 })
    const codigos = await page.getByTestId('rubro-tipico').evaluateAll((els) => els.map((e) => e.getAttribute('data-codigo')))
    check(codigos.join(',') === '1,2,3,4,5,6,7,8,9', `E10: la pantalla muestra los rubros 1…9 (${codigos.join(',')})`)
    const fila413 = page.locator('[data-testid=trabajo-tipico][data-codigo="4.1.3"]')
    const fila11 = page.locator('[data-testid=trabajo-tipico][data-codigo="1.1"]')
    check(await fila413.count() === 1 && /4\.1\.3/.test(await fila413.innerText()), 'E10: cada trabajo con su código (4.1.3)')
    check(await fila413.getByTestId('con-formula').count() === 1, 'E10: 4.1.3 tiene la marca «con fórmula»')
    check(await fila11.getByTestId('con-formula').count() === 0, 'E10: 1.1 Obrador no (entra sin fórmula)')
    await fila413.getByRole('checkbox').click()
    const cant413 = fila413.locator('input[type=number]')
    check(await cant413.inputValue() === '', `E10: la cantidad arranca vacía, no en 1 ("${await cant413.inputValue()}")`)
    await cant413.fill('12')
    const fila514 = page.locator('[data-testid=trabajo-tipico][data-codigo="5.1.4"]')
    await fila514.getByRole('checkbox').click()
    await fila514.locator('input[type=number]').fill('80')
    await fila11.getByRole('checkbox').click()
    await shot(page, 'E10_trabajos_tipicos')
    check(/3 rubros con 3 trabajos/.test(await page.getByTestId('resumen-estructura').innerText()), `E10: resumen: 3 rubros con 3 trabajos ("${(await page.getByTestId('resumen-estructura').innerText()).trim()}")`)
    await page.getByRole('button', { name: /Siguiente/ }).click()
    await page.getByRole('button', { name: 'Crear presupuesto' }).waitFor({ timeout: 15000 })
    const pedido = page.waitForRequest((r) => r.url().includes('/budgets/create-full'), { timeout: 30000 })
    await page.getByRole('button', { name: 'Crear presupuesto' }).click()
    const body = (await pedido).postDataJSON()
    const enviados = body.secciones.flatMap((s) => s.items.map((i) => ({ ...i, rubro: s.codigo })))
    const e413 = enviados.find((i) => i.codigo === '4.1.3'), e514 = enviados.find((i) => i.codigo === '5.1.4'), e11 = enviados.find((i) => i.codigo === '1.1')
    check(e413?.plantilla === '4.1.3' && e514?.plantilla === '5.1.4' && !e11?.plantilla, `E10: se manda la fórmula de cada trabajo (${JSON.stringify(enviados.map((i) => [i.codigo, i.plantilla ?? null]))})`)
    check(e413?.rubro === '4' && e514?.rubro === '5' && e11?.rubro === '1' && e11?.cantidad === 0, `E10: con los códigos de Terrac y la cantidad vacía en 0 (1.1 cantidad ${e11?.cantidad})`)
    await page.getByTestId('trabajos-creados').waitFor({ timeout: 60000 })
    idTipicos = (await presupuestos()).find((x) => x.name === nombre)?.id ?? null
    const items = idTipicos ? (await api('GET', `/budgets/${idTipicos}/items`)).data : []
    const i413 = items.find((i) => i.code === '4.1.3'), i514 = items.find((i) => i.code === '5.1.4'), i11 = items.find((i) => i.code === '1.1')
    check(!!i413?.template_id && Number(i413.neto_total) > 0 && Number(i413.cantidad) === 12, `E10: 4.1.3 entra con su fórmula y sus precios (fórmula ${!!i413?.template_id}, $${Math.round(i413?.neto_total ?? 0)})`)
    check(!!i514?.template_id && Number(i514.neto_total) > 0 && Number(i514.cantidad) === 80, `E10: 5.1.4 también (fórmula ${!!i514?.template_id}, $${Math.round(i514?.neto_total ?? 0)})`)
    check(!!i11 && !i11.template_id && Number(i11.cantidad) === 0, 'E10: 1.1 entra sin fórmula y con cantidad 0')
    // En el editor: el precio de 4.1.3 y «Elegir fórmula» en 1.1
    await page.getByRole('button', { name: 'Abrir el presupuesto' }).click()
    await page.waitForURL(/\/editor$/, { timeout: 15000 })
    await page.locator('[data-testid=tabla-trabajos] tbody tr').first().waitFor({ timeout: 30000 })
    const fila1 = page.locator('[data-testid=tabla-trabajos] tbody tr').filter({ hasText: '1.1' }).first()
    await page.waitForTimeout(1200)
    check(await fila1.getByTestId('elegir-formula-renglon').count() === 1, 'E10: en el editor, 1.1 (sin fórmula) tiene «Elegir fórmula»')
    const rub4 = items.find((i) => i.notas === 'Seccion' && i.code === '4')
    if (rub4) await page.getByText(rub4.description, { exact: true }).first().click().catch(() => {})
    await page.waitForTimeout(600)
    const fila4 = page.locator('[data-testid=tabla-trabajos] tbody tr').filter({ hasText: '4.1.3' }).first()
    if (await fila4.count()) {
      const precio = await fila4.locator('td').nth(9).innerText()
      check(/\$\s?[1-9]/.test(precio.replace(/\./g, '')), `E10: en la tabla, 4.1.3 tiene precio (${precio.trim()})`)
      check(await fila4.getByTestId('elegir-formula-renglon').count() === 0, 'E10: y no pide fórmula')
    } else info('E10: no pude elegir el rubro 4 en el árbol para ver 4.1.3 en la tabla')
    await shot(page, 'E10_editor')
  })

  // ─── E11. Borrar un presupuesto con doble verificación ───────────────────────────────────────────────────
  await bloque('E11 Borrar con doble verificación', async () => {
    const me = (rol) => ({ user_id: 'sol', email: 'sol@terrac.com', org_id: 'test-org-uuid', role: rol, orgs: [{ id: 'test-org-uuid', name: 'TERRAC SA', slug: 'terrac', role: rol }] })
    const nombre = 'Borrar E2E Tablero'
    const creado = (await api('POST', '/budgets', { name: nombre })).data
    // «Carga y edita» (leader) también borra
    await page.route('**/api/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(me('leader')) }))
    await page.goto(`${B}/app/dashboard`)
    const tacho = page.getByRole('button', { name: `Borrar el presupuesto ${nombre}` })
    await tacho.waitFor({ timeout: 20000 })
    check(await tacho.isVisible(), 'E11: «Carga y edita» ve el tachito en Mis presupuestos')
    await tacho.click()
    const dlg = page.getByTestId('confirmar-borrado')
    await dlg.waitFor({ timeout: 5000 })
    check(new RegExp(`Para borrar «${nombre}», escribí su nombre`).test((await dlg.innerText()).replace(/\s+/g, ' ')), 'E11: pide «Para borrar «Nombre», escribí su nombre»')
    const boton = dlg.getByRole('button', { name: 'Borrar para siempre' })
    check(await boton.isDisabled(), 'E11: «Borrar para siempre» arranca deshabilitado')
    await dlg.getByTestId('confirmar-borrado-nombre').fill('Borrar E2E')
    check(await boton.isDisabled(), 'E11: con otro nombre sigue deshabilitado')
    await dlg.getByTestId('confirmar-borrado-nombre').fill(`  ${nombre.toLowerCase()}  `)
    check(await boton.isEnabled(), 'E11: con el nombre (sin importar mayúsculas ni espacios) se habilita')
    await shot(page, 'E11_confirmar_borrado')
    await boton.click()
    await dlg.waitFor({ state: 'detached', timeout: 15000 })
    await page.getByTestId('presupuesto-borrado').waitFor({ timeout: 10000 })
    check(!(await presupuestos()).some((x) => x.id === creado.id), 'E11: se borró (ya no está en el servidor)')
    check(await page.getByRole('button', { name: `Borrar el presupuesto ${nombre}` }).count() === 0, 'E11: y no está en Mis presupuestos')
    // «Solo mira» no ve el tachito
    await page.unroute('**/api/me')
    await page.route('**/api/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(me('member')) }))
    await page.goto(`${B}/app/dashboard`)
    await page.getByTestId('tarjeta-precio-sin-iva').first().waitFor({ timeout: 20000 }).catch(() => {})
    check(await page.getByTestId('borrar-presupuesto').count() === 0, 'E11: «Solo mira» no ve el tachito')
    await page.unroute('**/api/me')
    // Desde el editor: «Más» → «Borrar el presupuesto»; después, Mis presupuestos
    const nombre2 = 'Borrar E2E Editor'
    const creado2 = (await api('POST', '/budgets', { name: nombre2 })).data
    await page.goto(`${B}/app/budgets/${creado2.id}/editor`)
    await page.locator('h1').filter({ hasText: nombre2.toUpperCase() }).waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: 'Más', exact: true }).click()
    await page.getByRole('menuitem', { name: /Borrar el presupuesto/ }).click()
    const dlg2 = page.getByTestId('confirmar-borrado')
    await dlg2.waitFor({ timeout: 5000 })
    await dlg2.getByTestId('confirmar-borrado-nombre').fill(nombre2)
    await dlg2.getByRole('button', { name: 'Borrar para siempre' }).click()
    await page.waitForURL(/\/app\/dashboard$/, { timeout: 15000 })
    check(/se borró «Borrar E2E Editor»/.test(await page.getByTestId('presupuesto-borrado').innerText().catch(() => '')), 'E11: desde el editor, borra y vuelve a Mis presupuestos diciéndolo')
    check(!(await presupuestos()).some((x) => x.id === creado2.id), 'E11: el del editor tampoco está en el servidor')
  })

  // ─── E12. Vista Piso de emilia_prueba3 (cargado por Cargar obra) ─────────────────────────────────────────
  await bloque('E12 Vista Piso de emilia_prueba3', async () => {
    const nombre = `Emilia prueba3 E2E ${Date.now() % 100000}`
    const r = await cargarPorApi('emilia_prueba3.xlsx', nombre)
    check(r.status === 200 && r.data.budget_id, `E12: Cargar obra carga emilia_prueba3 (${r.status} ${r.status !== 200 ? JSON.stringify(r.data).slice(0, 160) : `${r.data.items} trabajos`})`)
    if (r.status !== 200) return
    const id = r.data.budget_id
    const items = (await api('GET', `/budgets/${id}/items`)).data
    const pisos = items.filter((i) => i.notas === 'Seccion' && /^\d+\.\d+$/.test(String(i.code || '')))
    const vacios = pisos.filter((p) => !items.some((i) => i.parent_id === p.id))
    check(pisos.length >= 11 && vacios.length === 0, `E12: cada piso del Excel con sus trabajos (${pisos.length} pisos${vacios.length ? `; sin trabajos: ${vacios.map((p) => p.code).join(', ')}` : ''})`)
    await page.goto(`${B}/app/budgets/${id}/editor`)
    await page.locator('[data-testid=tabla-trabajos] tbody tr').first().waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: 'Piso', exact: true }).click()
    await page.waitForTimeout(800)
    const esperados = ['Fundaciones / Subsuelo', 'Planta Baja', 'Piso 1', 'Piso 2', 'Piso 3', 'Piso 4', 'Piso 5', 'Piso 6', 'Piso 7']
    const faltan = []
    const vaciosVista = []
    for (const label of esperados) {
      const nodo = page.getByText(label, { exact: true }).first()
      if (!(await nodo.count())) { faltan.push(label); continue }
      await nodo.click()
      await page.waitForTimeout(250)
      const n = await page.locator('[data-testid=tabla-trabajos] tbody tr').count()
      if (!n) vaciosVista.push(label)
    }
    check(faltan.length === 0, `E12: la vista Piso tiene fundaciones, planta baja y los pisos 1 a 7${faltan.length ? ` (faltan: ${faltan.join(', ')})` : ''}`)
    check(vaciosVista.length === 0, `E12: cada piso muestra sus trabajos${vaciosVista.length ? ` (vacíos: ${vaciosVista.join(', ')})` : ''}`)
    await shot(page, 'E12_vista_piso')
  })

  // ─── E13. Precio viejo ───────────────────────────────────────────────────────────────────────────────────
  await bloque('E13 Precio viejo', async () => {
    const g = (await api('GET', '/indirects/general')).data
    check(typeof g?.precio_viejo_dias === 'number', `E13: la empresa tiene «precio viejo» (${g?.precio_viejo_dias} días)`)
    await page.goto(`${B}/app/catalogs`)
    const cfg = page.getByTestId('precio-viejo-config')
    await cfg.waitFor({ timeout: 20000 })
    const campo = cfg.locator('input[type=number]')
    check(/Un precio es viejo después de/.test(await cfg.innerText()) && await campo.inputValue() === String(g?.precio_viejo_dias ?? 90), `E13: Lista de precios: «Un precio es viejo después de N días» (${await campo.inputValue()})`)
    // Abrir la lista del Maestro: sus precios son de hace más de 90 días
    await page.getByText('Maestro TERRAC - Materiales').first().click()
    await page.getByTestId('precio-renglon').first().waitFor({ timeout: 20000 })
    const chips90 = await page.getByTestId('precio-viejo').count()
    check(chips90 > 0 && /Precio de hace \d+ días/.test(await page.getByTestId('precio-viejo').first().innerText()), `E13: en la lista, ámbar «Precio de hace N días» (${chips90} a la vista)`)
    await shot(page, 'E13_lista_precio_viejo')
    // Con 3650 días ninguno es viejo; se guarda en el servidor
    await campo.fill('3650')
    await cfg.getByRole('button', { name: 'Guardar' }).click()
    await cfg.getByText('Guardado').waitFor({ timeout: 10000 }).catch(() => {})
    const g2 = (await api('GET', '/indirects/general')).data
    check(g2?.precio_viejo_dias === 3650, `E13: se guarda para la empresa (${g2?.precio_viejo_dias})`)
    await page.waitForTimeout(300)
    check(await page.getByTestId('precio-viejo').count() === 0, 'E13: con 3650 días no queda ninguno en ámbar')
    await campo.fill('90')
    await cfg.getByRole('button', { name: 'Guardar' }).click()
    await page.waitForTimeout(800)
    check((await api('GET', '/indirects/general')).data?.precio_viejo_dias === 90, 'E13: vuelve a 90')
    // Detalle del trabajo y Exportar (presupuesto de E10)
    if (!idTipicos) { check(false, 'E13: no hay presupuesto de E10 para mirar el detalle'); return }
    const it = (await api('GET', `/budgets/${idTipicos}/items`)).data.find((i) => i.code === '4.1.3')
    const recs = (await api('GET', `/budgets/${idTipicos}/items/${it.id}/resources`)).data
    check(Array.isArray(recs) && recs.some((x) => typeof x.precio_dias === 'number'), `E13: los recursos traen precio_dias (${Array.isArray(recs) ? recs.map((x) => x.precio_dias).slice(0, 5).join(', ') : '—'})`)
    await page.goto(`${B}/app/budgets/${idTipicos}/item/${it.id}`)
    await page.getByText('Materiales').first().waitFor({ timeout: 20000 })
    await page.waitForTimeout(1500)
    const viejosRec = Array.isArray(recs) ? recs.filter((x) => typeof x.precio_dias === 'number' && x.precio_dias > 90 && x.precio_unitario > 0).length : 0
    const chipsDet = await page.getByTestId('precio-viejo').count()
    check(viejosRec > 0 ? chipsDet > 0 : chipsDet === 0, `E13: en el detalle del trabajo, ámbar en los recursos viejos (${chipsDet} en pantalla, ${viejosRec} viejos según el servidor)`)
    await shot(page, 'E13_detalle_precio_viejo')
    const pf = (await api('GET', `/budgets/${idTipicos}/precios-faltantes`)).data
    check(pf && pf.viejos !== undefined, `E13: precios-faltantes trae «viejos» (${JSON.stringify(pf?.viejos)?.slice(0, 80)})`)
    await page.goto(`${B}/app/budgets/${idTipicos}/export`)
    await page.getByTestId('export-cabecera').waitFor({ timeout: 20000 })
    await page.waitForTimeout(1500)
    check(viejosRec > 0 ? await page.getByTestId('aviso-precios-viejos').count() === 1 : true, `E13: Exportar avisa que hay precios viejos (${await page.getByTestId('aviso-precios-viejos').innerText().catch(() => 'sin aviso')})`)
    await shot(page, 'E13_exportar_precio_viejo')
  })

  // ─── E14. Actualizar a precios de otra fecha: Versiones sigue andando y la Ayuda lo explica ───────────────
  await bloque('E14 Versiones → Actualizar precios y la Ayuda', async () => {
    if (idTipicos) {
      const vAntes = (await api('GET', `/budgets/${idTipicos}/versions`)).data.length
      await page.goto(`${B}/app/budgets/${idTipicos}/versions`)
      await page.getByRole('button', { name: /Actualizar a precios de hoy/ }).click()
      await page.getByText(/recursos actualizados/).waitFor({ timeout: 60000 })
      const t = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
      const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      check(/Nueva versión v\d+ \(la anterior quedó en v\d+\)/.test(t), 'E14: «Actualizar precios» guarda la versión anterior y crea una nueva')
      const vDespues = (await api('GET', `/budgets/${idTipicos}/versions`)).data.length
      check(vDespues >= vAntes + 1, `E14: hay más versiones (${vAntes} → ${vDespues})`)
      const pres = (await api('GET', `/budgets/${idTipicos}`)).data
      check(!!pres.precios_al && t.includes(`Precios al ${hoy}`), `E14: «Precios al» cambia a hoy (${pres.precios_al})`)
      await shot(page, 'E14_versiones')
    } else check(false, 'E14: no hay presupuesto de E10')
    await page.goto(`${B}/app/ayuda`)
    const sec = page.locator('#fecha-precios')
    await sec.waitFor({ timeout: 15000 })
    check(await page.getByRole('navigation', { name: 'Índice' }).getByRole('link', { name: 'La fecha de los precios' }).count() === 1, 'E14: la Ayuda tiene «La fecha de los precios» en el índice')
    const ts = (await sec.innerText()).replace(/\s+/g, ' ')
    check(/foto/.test(ts) && /Precios al/.test(ts) && /Versiones/.test(ts) && /Actualizar a precios de hoy/.test(ts) && /90/.test(ts) && /Precio de hace N días/.test(ts),
      'E14: explica la foto, «Actualizar a precios de hoy» en Versiones y el precio viejo')
    const tc = (await page.locator('#otro-formato').innerText()).replace(/\s+/g, ' ')
    check(/01_C&P/.test(tc) && /CYP/.test(tc) && /Descripción/.test(tc) && /Cantidad/.test(tc) && /3\.1\.1/.test(tc) && /4 -1 FUNDACIONES/.test(tc), 'E14: la Ayuda dice qué Excel acepta Cargar obra (solapas, títulos, códigos)')
    await sec.screenshot({ path: path.join(SHOTS, 'E14_ayuda_fecha_precios.png') }).catch(() => {})
  })

  // ─── E15. Entrar con clave: la causa real y la ayuda de Google ───────────────────────────────────────────
  await bloque('E15 Entrar con clave', async () => {
    const casos = [
      ['clave incorrecta', { status: 400, body: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } }, /El mail o la clave no son correctos/],
      ['mail sin confirmar', { status: 400, body: { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' } }, /mail todavía no está confirmado/],
      ['demasiados intentos', { status: 429, body: { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' } }, /demasiados intentos/],
      ['sin conexión', null, /No me pude conectar .*conexión a internet/],
    ]
    const lp = await ctx.newPage()
    for (const [nombre, resp, re] of casos) {
      await lp.unroute('**/auth/v1/token**').catch(() => {})
      await lp.route('**/auth/v1/token**', (r) => (resp
        ? r.fulfill({ status: resp.status, contentType: 'application/json', body: JSON.stringify(resp.body) })
        : r.abort('internetdisconnected')))
      await lp.goto(`${B}/login`)
      await lp.getByLabel('Mail').fill('sol@terrac.com')
      await lp.getByLabel('Clave').fill('una-clave')
      await lp.getByRole('button', { name: 'Ingresar' }).click()
      const err = lp.getByTestId('error-login')
      await err.waitFor({ timeout: 15000 }).catch(() => {})
      const t = await err.innerText().catch(() => '')
      check(re.test(t), `E15: ${nombre}: «${t}»`)
    }
    check(/Si entrás a SOLÉ con Google, tocá “Olvidé mi clave” para armarte una/.test(await lp.getByTestId('ayuda-google').innerText()), 'E15: debajo dice «Si entrás a SOLÉ con Google, tocá “Olvidé mi clave” para armarte una»')
    await shot(lp, 'E15_login')
    await lp.close()
  })

  // ─── Celular (390 px): lo nuevo no se sale de la pantalla ───────────────────────────────────────────────
  await bloque('Celular 390 px', async () => {
    // Importar Excel: la tarjeta de «Cargarlo en Cargar obra»
    await importarEnPantalla(m, 'emilia_hoja1.xlsx')
    await m.getByTestId('ir-a-cargar-obra').waitFor({ timeout: 15000 })
    await sinDesborde(m, 'Importar Excel, «Cargarlo en Cargar obra»')
    const chicosImp = await chicos(m, '[data-testid=ir-a-cargar-obra] button')
    check(chicosImp.length === 0, `390: los botones de la tarjeta miden 40 px o más ${JSON.stringify(chicosImp)}`)
    await shot(m, '390_importar_cargar_obra')
    // Cargar obra: el aviso de arriba y «Cargarlo sin precio ($0)»
    await m.getByRole('button', { name: 'Cargarlo en Cargar obra' }).click()
    await m.getByTestId('tarea-obra').first().waitFor({ timeout: 180000 })
    await esperarRevision(m)
    await m.getByTestId('banner-sin-precio').waitFor({ timeout: 10000 }).catch(() => {})
    await sinDesborde(m, 'Cargar obra con el aviso de los sin fórmula')
    const chicosCO = await chicos(m, '[data-testid=cargar-sin-precio], [data-testid=cargar-todos-sin-precio]')
    check(await m.getByTestId('cargar-sin-precio').count() > 0 && chicosCO.length === 0, `390: «Cargarlo sin precio ($0)» y «Cargar los N…» miden 40 px o más ${JSON.stringify(chicosCO.slice(0, 3))}`)
    await shot(m, '390_cargar_obra_sin_precio')
    // Editor: la tarjeta con «Elegir fórmula» y «Más» → «Borrar el presupuesto»
    if (idTipicos) {
      await m.goto(`${B}/app/budgets/${idTipicos}/editor`)
      await m.getByTestId('elegir-rubro').waitFor({ timeout: 20000 })
      await m.waitForTimeout(1500)
      const tarjetas = m.locator('[data-testid=tarjeta-trabajo]')
      if (!(await m.getByTestId('elegir-formula-renglon').count())) {
        const rub1 = (await api('GET', `/budgets/${idTipicos}/items`)).data.find((i) => i.notas === 'Seccion' && i.code === '1')
        await m.getByTestId('elegir-rubro').click()
        if (rub1) await m.getByTestId('hoja-arbol').getByText(rub1.description, { exact: true }).first().click().catch(() => {})
        await m.waitForTimeout(800)
      }
      check(await m.getByTestId('elegir-formula-renglon').count() > 0, `390: la tarjeta del trabajo sin fórmula tiene «Elegir fórmula» (${await tarjetas.count()} tarjetas)`)
      const chicosEd = await chicos(m, '[data-testid=elegir-formula-renglon]')
      check(chicosEd.length === 0, `390: «Elegir fórmula» mide 40 px o más ${JSON.stringify(chicosEd)}`)
      await sinDesborde(m, 'editor con «Elegir fórmula»')
      await shot(m, '390_editor_elegir_formula')
      await m.getByRole('button', { name: 'Más', exact: true }).click()
      const borrar = m.getByRole('menuitem', { name: /Borrar el presupuesto/ })
      await borrar.waitFor({ timeout: 5000 })
      check(await borrar.isVisible(), '390: «Más» ofrece «Borrar el presupuesto»')
      await borrar.click()
      const dlg = m.getByTestId('confirmar-borrado')
      await dlg.waitFor({ timeout: 5000 })
      await sinDesborde(m, 'ventana de borrar')
      const letra = await letraChica(m, '[data-testid=confirmar-borrado] input')
      check(letra.length === 0, `390: el campo del nombre tiene letra de 16 px ${JSON.stringify(letra)}`)
      const chicosB = await chicos(m, '[data-testid=confirmar-borrado] button')
      check(chicosB.length === 0, `390: los botones de la ventana miden 40 px o más ${JSON.stringify(chicosB)}`)
      await shot(m, '390_confirmar_borrado')
      await dlg.getByRole('button', { name: 'Cancelar' }).click()
      check(await m.getByTestId('confirmar-borrado').count() === 0 && (await presupuestos()).some((x) => x.id === idTipicos), '390: «Cancelar» no borra nada')
    }
    // Mis presupuestos: el tachito
    await m.goto(`${B}/app/dashboard`)
    await m.getByTestId('borrar-presupuesto').first().waitFor({ timeout: 20000 })
    const chicosT = await chicos(m, '[data-testid=borrar-presupuesto]')
    check(chicosT.length === 0, `390: el tachito de cada tarjeta mide 40 px o más ${JSON.stringify(chicosT.slice(0, 2))}`)
    await sinDesborde(m, 'Mis presupuestos')
    // Nuevo presupuesto: Trabajos típicos
    await m.goto(`${B}/app/new-project`)
    if (await m.getByRole('button', { name: 'Descartar' }).count()) await m.getByRole('button', { name: 'Descartar' }).click()
    await m.getByLabel(/Nombre del presupuesto/).fill('Celular típicos')
    await m.getByRole('button', { name: /Siguiente/ }).click()
    await m.getByTestId('trabajos-tipicos').waitFor({ timeout: 20000 })
    await m.locator('[data-testid=trabajo-tipico][data-codigo="4.1.3"]').getByRole('checkbox').click()
    await sinDesborde(m, 'Trabajos típicos')
    const letraT = await letraChica(m, '[data-testid=trabajos-tipicos] input')
    check(letraT.length === 0, `390: la cantidad de Trabajos típicos tiene letra de 16 px ${JSON.stringify(letraT)}`)
    await m.locator('[data-testid=trabajo-tipico][data-codigo="4.1.3"]').scrollIntoViewIfNeeded()
    await shot(m, '390_trabajos_tipicos')
    await m.goto(`${B}/app/dashboard`)
    // Lista de precios: el campo de precio viejo y los chips
    await m.goto(`${B}/app/catalogs`)
    await m.getByTestId('precio-viejo-config').waitFor({ timeout: 20000 })
    await m.getByText('Maestro TERRAC - Materiales').first().click()
    await m.getByTestId('precio-renglon').first().waitFor({ timeout: 20000 })
    await sinDesborde(m, 'Lista de precios con «precio viejo»')
    const letraP = await letraChica(m, '[data-testid=precio-viejo-config] input')
    check(letraP.length === 0, `390: el campo de días tiene letra de 16 px ${JSON.stringify(letraP)}`)
    await shot(m, '390_lista_precio_viejo')
    // Entrar
    await m.goto(`${B}/login`)
    await m.getByTestId('ayuda-google').waitFor({ timeout: 10000 })
    await sinDesborde(m, 'Entrar')
    const letraL = await letraChica(m, 'form input')
    check(letraL.length === 0, `390: mail y clave con letra de 16 px ${JSON.stringify(letraL)}`)
    await shot(m, '390_login')
  })

  check(errores.length === 0, `sin errores de la página${errores.length ? ': ' + errores.slice(0, 3).join(' | ') : ''}`)
  await b.close()
  console.log(`\n${ok} OK, ${bad} FALLAS`)
  process.exitCode = bad ? 1 : 0
})().catch((e) => { console.error(e); process.exit(1) })
