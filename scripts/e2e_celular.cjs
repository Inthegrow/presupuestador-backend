// Prueba de punta a punta de "la app en el celular y en una notebook chica" (PLAN_CELULAR.md, sección 3), parte del
// menú, la barra y todas las pantallas menos el editor (el editor, el detalle de un trabajo, Diferencias y Análisis los
// controla scripts/e2e_celular_editor.cjs: acá de esas cuatro se controla solo el menú, la barra y las pestañas).
// - Recorre las pantallas en 390×844, 768×1024, 1280×720 y 1366×768: nada más ancho que la ventana (salvo adentro de
//   una caja que se desliza) y, en el celular, el contenido usa al menos el ancho menos 32 px.
// - Celular: ☰ abre el cajón con todas las entradas (y la empresa); elegir una navega y lo cierra; Esc, tocar afuera y la
//   X lo cierran. NUEVO es un "+" que abre las tres formas de empezar a lo ancho. Las pestañas del proyecto arriba.
//   El buscador de precios ocupa toda la pantalla y se cierra. Los campos usan letra de 16 px y lo que se toca mide
//   40 px o más.
// - Entre 1024 y 1279 px el menú arranca angosto (64 px, el nombre al pasar el mouse), «/» lo agranda y al recargar se
//   acuerda. Desde 1280 px y en 1366×768: igual que siempre.
// - Cargar obra: "Confirmar" deja la tarjeta confirmada al instante y las otras no esconden sus botones mientras se
//   revisa; "Deshacer" la vuelve a amarillo; "Confirmar los N" deja 0 para confirmar con un solo pedido; si la revisión
//   falla queda el error con "Probar de nuevo" y lo confirmado no se pierde.
// Corre contra vite (5179) + scripts/serve_fake.py (8000), con el servidor falso recién levantado.
// Uso: EXCEL_DIR=<carpeta con ginkgo.xlsx> SHOTS_DIR=<carpeta> NODE_PATH=<node_modules con playwright> node scripts/e2e_celular.cjs
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const EXCEL = process.env.EXCEL_DIR || path.join(__dirname, 'excel')
const SHOTS = process.env.SHOTS_DIR || path.join(EXCEL, 'shots-celular')
fs.mkdirSync(SHOTS, { recursive: true })
const B = 'http://127.0.0.1:5179', API = 'http://127.0.0.1:8000'
let ok = 0, bad = 0
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); c ? ok++ : bad++ }
const info = (m) => console.log('INFO  ' + m)
const j = async (method, url, body) => (await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()

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

const MEDIDAS = [
  { w: 390, h: 844, nombre: 'celular' },
  { w: 768, h: 1024, nombre: 'tablet' },
  { w: 1280, h: 720, nombre: 'notebook' },
  { w: 1366, h: 768, nombre: 'notebook14' },
]

// Lo que tiene que estar en el menú (en el mismo orden que el menú fijo)
const ENTRADAS = [
  ['Mis presupuestos', '/app/dashboard'],
  ['Cargar obra', '/app/cargar-obra'],
  ['Nuevo presupuesto', '/app/new-project'],
  ['Importar Excel', '/app/import'],
  ['Coeficiente de pase', '/app/settings/markups'],
  ['Lista de precios', '/app/catalogs'],
  ['Fórmulas', '/app/templates'],
  ['Ayuda', '/app/ayuda'],
]
const ENTRADAS_PROYECTO = [
  ['Editor de obra', 'editor'],
  ['Análisis', 'analysis'],
  ['Planos con IA', 'ai'],
  ['Exportar', 'export'],
  ['Versiones', 'versions'],
]

/** Nada más ancho que la ventana, salvo adentro de una caja que se desliza de costado (la de la página no cuenta) */
async function seSale(page, soloLayout) {
  return page.evaluate((soloLayout) => {
    const W = innerWidth
    const enCaja = (el) => {
      for (let a = el.parentElement; a && a !== document.body && a.tagName !== 'MAIN'; a = a.parentElement) {
        const s = getComputedStyle(a)
        const r = a.getBoundingClientRect()
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && r.right <= W + 1 && r.left >= -1) return true
      }
      return false
    }
    const raices = soloLayout
      ? [...document.querySelectorAll('header, aside, [data-testid="pestanas-proyecto"]')]
      : [document.body]
    const fuera = []
    for (const raiz of raices) {
      for (const el of [raiz, ...raiz.querySelectorAll('*')]) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (getComputedStyle(el).visibility === 'hidden') continue
        if ((r.right > W + 1 || r.left < -1) && !enCaja(el)) {
          fuera.push(`${el.tagName.toLowerCase()}.${String(el.className || '').slice(0, 40)} (${Math.round(r.left)}–${Math.round(r.right)}) "${(el.innerText || '').slice(0, 30).replace(/\n/g, ' ')}"`)
        }
      }
    }
    const main = document.querySelector('main')
    const paginaAncha = main ? main.scrollWidth > main.clientWidth + 1 : false
    return { fuera: fuera.slice(0, 4), n: fuera.length, paginaAncha }
  }, soloLayout)
}

/** Ancho útil del contenido: el de la página adentro de main (o la tarjeta de entrada), sin sus márgenes */
async function anchoContenido(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    const raiz = main ? main.lastElementChild : document.querySelector('#root > div > div') || document.querySelector('#root > div')
    if (!raiz) return 0
    const r = raiz.getBoundingClientRect()
    const s = getComputedStyle(raiz)
    return Math.round(r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight))
  })
}

async function esperarPantalla(page) {
  await page.waitForLoadState('domcontentloaded')
  // la app ya armada: el lugar del contenido (o, en las de entrada, la tarjeta)
  await page.waitForSelector('main, #root h2', { timeout: 30000 }).catch(() => {})
  await page.waitForFunction(() => !/Cargando/.test(document.querySelector('main')?.innerText ?? document.body.innerText), null, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(900)
}

/** Captura de la ventana y, en el celular, también de la pantalla entera (alto de todo el contenido) */
async function captura(page, nombre, larga = false) {
  await page.screenshot({ path: path.join(SHOTS, nombre + '.png') })
  if (!larga) return
  const vp = page.viewportSize()
  const alto = await page.evaluate(() => {
    const m = document.querySelector('main')
    return m ? m.scrollHeight + 56 + (document.querySelector('[data-testid="pestanas-proyecto"]') ? 0 : 0) : document.body.scrollHeight
  })
  if (alto > vp.height + 20) {
    await page.setViewportSize({ width: vp.width, height: Math.min(alto, 6000) })
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(SHOTS, nombre + '_entera.png') })
    await page.setViewportSize(vp)
    await page.waitForTimeout(150)
  }
}

/** Los campos visibles con letra de menos de 16 px */
async function camposChicos(page) {
  return page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (['checkbox', 'radio', 'file', 'hidden', 'range', 'color'].includes(el.type)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs < 16) out.push(`${el.tagName.toLowerCase()}[${el.placeholder || el.getAttribute('aria-label') || el.name || ''}] ${fs}px`)
    }
    return { total: document.querySelectorAll('input, select, textarea').length, chicos: out }
  })
}

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

const solapan = (a, b) => a && b && a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5

;(async () => {
  const id = await cargarGinkgo()
  const items = (await j('GET', `/budgets/${id}/items`)).filter((i) => i.notas !== 'Seccion')
  const itemId = (items.find((i) => i.template_id) || items[0]).id
  const b = await chromium.launch()

  // ─── 1. Recorrido de las pantallas en las cuatro medidas ────────────────────────────────────────────────────
  const PANTALLAS = [
    { n: 'dashboard', r: '/app/dashboard' },
    { n: 'editor', r: `/app/budgets/${id}/editor`, editor: true },
    { n: 'item', r: `/app/budgets/${id}/item/${itemId}`, editor: true },
    { n: 'analysis', r: `/app/budgets/${id}/analysis`, editor: true },
    { n: 'export', r: `/app/budgets/${id}/export` },
    { n: 'versions', r: `/app/budgets/${id}/versions` },
    { n: 'diferencias', r: `/app/budgets/${id}/diferencias`, editor: true },
    { n: 'ai', r: `/app/budgets/${id}/ai` },
    { n: 'new-project', r: '/app/new-project' },
    { n: 'import', r: '/app/import' },
    { n: 'cargar-obra', r: '/app/cargar-obra' },
    { n: 'markups', r: '/app/settings/markups' },
    { n: 'catalogs', r: '/app/catalogs' },
    { n: 'templates', r: '/app/templates' },
    { n: 'correcciones', r: '/app/templates/correcciones' },
    { n: 'ayuda', r: '/app/ayuda' },
    { n: 'login', r: '/login', fuera: true },
    { n: 'olvide-mi-clave', r: '/olvide-mi-clave', fuera: true },
    { n: 'nueva-clave', r: '/nueva-clave', fuera: true },
  ]
  for (const m of MEDIDAS) {
    const ctx = await b.newContext({ viewport: { width: m.w, height: m.h } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
    const celular = m.w < 768
    for (const p of PANTALLAS) {
      await page.goto(B + p.r)
      await esperarPantalla(page)
      const s = await seSale(page, !!p.editor)
      const donde = `${m.w}×${m.h} ${p.n}`
      if (p.editor) {
        check(s.n === 0, `${donde}: el menú, la barra y las pestañas entran en la ventana${s.n ? ' — ' + s.fuera.join(' | ') : ''}`)
        const todo = await seSale(page, false)
        if (todo.n || todo.paginaAncha) info(`${donde}: lo de adentro del editor lo controla e2e_celular_editor (${todo.n} cosas salidas${todo.paginaAncha ? ', página más ancha' : ''})`)
      } else {
        check(s.n === 0 && !s.paginaAncha, `${donde}: nada más ancho que la ventana${s.n ? ' — ' + s.fuera.join(' | ') : ''}${s.paginaAncha ? ' (la página se desliza de costado)' : ''}`)
        if (celular) {
          const ancho = await anchoContenido(page)
          check(ancho >= m.w - 32, `${donde}: el contenido usa ${ancho} px de ${m.w} (≥ ${m.w - 32})`)
        }
      }
      if (!p.fuera) {
        const mainW = await page.evaluate(() => Math.round(document.querySelector('main').getBoundingClientRect().width))
        if (m.w < 1024) check(mainW === m.w, `${donde}: sin menú al costado, el contenido va de lado a lado (${mainW} px)`)
        else check(mainW === m.w - 224, `${donde}: el menú fijo de 224 px como siempre (contenido ${mainW} px)`)
      }
      if (m.w === 390 || (m.w === 1280 && m.h === 720)) await captura(page, `${m.w}_${p.n}`, m.w === 390 && !p.editor)
    }
    await ctx.close()
  }

  // ─── 2. Celular: la barra, el cajón, NUEVO "+" y las pestañas del proyecto ───────────────────────────────────
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
    await page.goto(`${B}/app/budgets/${id}/export`)
    await esperarPantalla(page)
    const header = page.locator('header')
    const hb = await header.boundingBox()
    const menu = await page.getByTestId('abrir-menu').boundingBox()
    const logo = await header.getByRole('button', { name: 'Ir a Mis presupuestos' }).boundingBox()
    const ia = await header.getByRole('img', { name: 'Asistente con IA' }).boundingBox()
    const mas = await page.getByTestId('boton-nuevo').boundingBox()
    const avatar = await header.locator('div.rounded-full').filter({ hasText: /^[A-Z]{2}$/ }).last().boundingBox()
    const partes = [menu, logo, ia, mas, avatar]
    check(partes.every(Boolean), 'barra del celular: ☰, el logo, la IA, "+" y el avatar a la vista')
    check(partes.every((x) => x && x.x >= 0 && x.x + x.width <= 390 && x.y >= hb.y && x.y + x.height <= hb.y + hb.height),
      'barra del celular: todo entra en la barra')
    let solap = false
    for (let i = 0; i < partes.length; i++) for (let k = i + 1; k < partes.length; k++) if (solapan(partes[i], partes[k])) solap = true
    check(!solap, 'barra del celular: nada se superpone')
    check(!(await header.getByText('PRESUPUESTADOR PRO').isVisible()) && !(await header.getByText('TERRAC SA').isVisible()),
      'barra del celular: sin "PRESUPUESTADOR PRO" ni la empresa (van en el cajón)')
    check(await page.locator('aside').count() === 0, 'celular: el menú del costado no está (el contenido usa todo el ancho)')
    const chicosBarra = await botonesChicos(page, 'header button')
    check(chicosBarra.length === 0, `barra del celular: los botones miden 40 px o más${chicosBarra.length ? ' — ' + chicosBarra.join(', ') : ''}`)

    // Pestañas del proyecto
    const pest = page.getByTestId('pestanas-proyecto')
    check(await pest.isVisible(), 'celular: arriba del contenido de Exportar están las pestañas del proyecto')
    const textos = (await pest.getByRole('link').allInnerTexts()).map((t) => t.trim())
    check(JSON.stringify(textos) === JSON.stringify(['Editor', 'Análisis', 'Planos con IA', 'Exportar', 'Versiones']), `pestañas: ${textos.join(' · ')}`)
    check(await pest.getByRole('link', { name: 'Exportar' }).getAttribute('aria-current') === 'page', 'pestañas: "Exportar" marcada')
    const caja = await pest.locator('div').first().evaluate((d) => ({ s: getComputedStyle(d).overflowX, sw: d.scrollWidth, cw: d.clientWidth }))
    check(caja.s === 'auto' && caja.sw > caja.cw, `pestañas: se deslizan de costado (${caja.sw} en ${caja.cw} px)`)
    const chicasPest = await botonesChicos(page, '[data-testid="pestanas-proyecto"] a')
    check(chicasPest.length === 0, `pestañas: miden 40 px o más${chicasPest.length ? ' — ' + chicasPest.join(', ') : ''}`)
    await pest.getByRole('link', { name: 'Versiones' }).click()
    await page.waitForURL(/\/versions$/)
    check(await page.getByTestId('pestanas-proyecto').getByRole('link', { name: 'Versiones' }).getAttribute('aria-current') === 'page', 'pestañas: tocar "Versiones" lleva a Versiones')

    // El cajón: todas las entradas, la empresa, el tamaño y cómo se cierra
    await page.getByTestId('abrir-menu').click()
    const cajon = page.getByRole('dialog', { name: 'Menú' })
    await cajon.waitFor({ timeout: 3000 })
    await page.waitForTimeout(300)
    await captura(page, '390_cajon_abierto')
    const enlaces = (await cajon.getByRole('link').allInnerTexts()).map((t) => t.trim())
    const esperadas = [...ENTRADAS.slice(0, 4).map((e) => e[0]), ...ENTRADAS_PROYECTO.map((e) => e[0]), ...ENTRADAS.slice(4).map((e) => e[0])]
    check(JSON.stringify(enlaces) === JSON.stringify(esperadas), `cajón: todas las entradas en el orden del menú (${enlaces.join(' · ')})`)
    check(await cajon.getByTestId('cajon-empresa').getByText('TERRAC SA').isVisible(), 'cajón: la empresa está adentro del cajón')
    check(await cajon.getByText('Ginkgo', { exact: true }).isVisible(), 'cajón: el proyecto actual con su nombre')
    check(await cajon.getByRole('button', { name: /CERRAR SESIÓN/ }).count() === 1, 'cajón: "Cerrar sesión" al final')
    const cb = await cajon.boundingBox()
    check(cb && cb.x === 0 && cb.width <= 320 && cb.width >= 300 && cb.height >= 843, `cajón: desde la izquierda, ${cb && Math.round(cb.width)} px de ancho y todo el alto`)
    const chicasCajon = await botonesChicos(page, '[role="dialog"][aria-label="Menú"] a, [role="dialog"][aria-label="Menú"] button')
    check(chicasCajon.length === 0, `cajón: cada entrada mide 40 px o más${chicasCajon.length ? ' — ' + chicasCajon.join(', ') : ''}`)
    check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Cerrar el menú', 'cajón: el foco arranca en la X')
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    check(await cajon.count() === 0, 'cajón: Esc lo cierra')
    check(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')) === 'abrir-menu', 'cajón: al cerrarlo el foco vuelve a ☰')
    await page.getByTestId('abrir-menu').click(); await cajon.waitFor()
    await page.mouse.click(375, 500); await page.waitForTimeout(200)
    check(await cajon.count() === 0, 'cajón: tocar afuera lo cierra')
    await page.getByTestId('abrir-menu').click(); await cajon.waitFor()
    await page.getByTestId('cerrar-menu').click(); await page.waitForTimeout(200)
    check(await cajon.count() === 0, 'cajón: la X lo cierra')

    // Cada entrada navega y cierra el cajón
    for (const [texto, ruta] of ENTRADAS) {
      await page.getByTestId('abrir-menu').click(); await cajon.waitFor()
      await cajon.getByRole('link', { name: texto, exact: true }).click()
      await page.waitForURL((u) => u.pathname === ruta, { timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(250)
      check(new URL(page.url()).pathname === ruta && await cajon.count() === 0, `cajón: "${texto}" lleva a ${ruta} y se cierra`)
    }
    for (const [texto, ruta] of ENTRADAS_PROYECTO) {
      await page.goto(`${B}/app/budgets/${id}/export`); await esperarPantalla(page)
      await page.getByTestId('abrir-menu').click(); await cajon.waitFor()
      await cajon.getByRole('link', { name: texto, exact: true }).click()
      await page.waitForURL((u) => u.pathname.endsWith('/' + ruta), { timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(250)
      check(new URL(page.url()).pathname === `/app/budgets/${id}/${ruta}` && await cajon.count() === 0, `cajón: "${texto}" lleva a .../${ruta} y se cierra`)
    }

    // NUEVO "+": el mismo menú de tres formas, a lo ancho
    await page.goto(`${B}/app/dashboard`); await esperarPantalla(page)
    const nuevo = page.getByTestId('boton-nuevo')
    const nb = await nuevo.boundingBox()
    check(nb && Math.abs(nb.width - nb.height) < 1 && nb.width >= 40, `NUEVO en el celular es un botón redondo "+" (${nb && Math.round(nb.width)}×${nb && Math.round(nb.height)})`)
    check(await page.locator('header').getByRole('button', { name: 'NUEVO' }).count() === 1, 'NUEVO: se sigue llamando "NUEVO" (para el lector de pantalla)')
    await nuevo.click()
    const menuNuevo = page.getByRole('menu', { name: 'Formas de empezar un presupuesto' })
    await menuNuevo.waitFor({ timeout: 3000 })
    await page.waitForTimeout(300)
    await captura(page, '390_nuevo_abierto')
    const opciones = (await menuNuevo.getByRole('menuitem').allInnerTexts()).map((t) => t.split('\n')[0].trim())
    check(JSON.stringify(opciones) === JSON.stringify(['Cargar obra', 'Nuevo presupuesto', 'Importar Excel']), `NUEVO "+": las tres formas de empezar (${opciones.join(' · ')})`)
    const mb = await menuNuevo.boundingBox()
    check(mb && mb.width >= 390 - 32 && mb.x >= 0 && mb.x + mb.width <= 390, `NUEVO "+": el menú va a lo ancho (${mb && Math.round(mb.width)} px)`)
    const chicasNuevo = await botonesChicos(page, '[role="menuitem"]')
    check(chicasNuevo.length === 0, 'NUEVO "+": cada opción mide 40 px o más')
    await page.mouse.click(200, 700); await page.waitForTimeout(200)
    check(await menuNuevo.count() === 0, 'NUEVO "+": tocar afuera lo cierra')
    for (const [texto, ruta] of [['Cargar obra', '/app/cargar-obra'], ['Nuevo presupuesto', '/app/new-project'], ['Importar Excel', '/app/import']]) {
      await page.goto(`${B}/app/dashboard`); await esperarPantalla(page)
      await page.getByTestId('boton-nuevo').click()
      await page.getByRole('menuitem', { name: new RegExp(`^${texto}`) }).click()
      await page.waitForURL((u) => u.pathname === ruta, { timeout: 10000 }).catch(() => {})
      check(new URL(page.url()).pathname === ruta && await page.getByRole('menu').count() === 0, `NUEVO "+" → "${texto}" lleva a ${ruta}`)
    }

    // Dashboard: los filtros se tocan fácil
    await page.goto(`${B}/app/dashboard`); await esperarPantalla(page)
    const chicosFiltros = await botonesChicos(page, 'main button')
    check(chicosFiltros.length === 0, `Mis presupuestos: lo que se toca mide 40 px o más${chicosFiltros.length ? ' — ' + chicosFiltros.join(', ') : ''}`)

    // El buscador de precios a pantalla completa
    await page.goto(`${B}/app/catalogs`); await esperarPantalla(page)
    await page.getByRole('button', { name: 'Buscar un precio' }).click()
    const buscador = page.getByTestId('buscar-precio')
    await buscador.waitFor({ timeout: 5000 })
    const bb = await buscador.boundingBox()
    check(bb && bb.x === 0 && bb.y === 0 && Math.round(bb.width) === 390 && Math.round(bb.height) === 844, `buscador de precios: ocupa toda la pantalla (${bb && `${Math.round(bb.width)}×${Math.round(bb.height)}`})`)
    const cerrarB = await buscador.getByRole('button', { name: 'Cerrar' }).boundingBox()
    check(cerrarB && cerrarB.height >= 40 && cerrarB.y < 60, 'buscador de precios: la X arriba, de 40 px')
    const chicosB = await camposChicos(page)
    check(chicosB.chicos.length === 0, `buscador de precios: los campos con letra de 16 px${chicosB.chicos.length ? ' — ' + chicosB.chicos.join(', ') : ''}`)
    await buscador.getByPlaceholder(/cemento/).fill('cemento portland 50 kg')
    await buscador.getByRole('button', { name: /^Buscar/ }).click()
    await page.waitForFunction(() => !document.querySelector('[data-testid="buscando"]'), null, { timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(300)
    const opcionesB = await buscador.getByTestId('opcion-precio').count()
    const sB = await seSale(page, false)
    check(sB.n === 0, `buscador de precios: con ${opcionesB} opciones, nada se sale de la pantalla${sB.n ? ' — ' + sB.fuera.join(' | ') : ''}`)
    await captura(page, '390_buscador_precios')
    await buscador.getByRole('button', { name: 'Cerrar' }).click(); await page.waitForTimeout(200)
    check(await buscador.count() === 0, 'buscador de precios: la X lo cierra')

    // Campos con letra de 16 px (el iPhone no agranda la pantalla)
    for (const [ruta, preparar] of [
      ['/app/dashboard', null],
      ['/app/new-project', null],
      ['/app/templates', null],
      ['/app/settings/markups', null],
      ['/app/catalogs', async () => { await page.getByText('Maestro TERRAC - Materiales').first().click(); await page.waitForTimeout(1200) }],
      ['/login', null],
    ]) {
      await page.goto(B + ruta); await esperarPantalla(page)
      if (preparar) await preparar()
      const c = await camposChicos(page)
      check(c.chicos.length === 0 && c.total > 0, `${ruta}: los campos con letra de 16 px${c.chicos.length ? ' — ' + c.chicos.slice(0, 4).join(', ') : ''}`)
    }
    // Fórmulas: la ventana de editar ocupa toda la pantalla
    await page.goto(`${B}/app/templates`); await esperarPantalla(page)
    await page.getByLabel('Editar fórmulas y parámetros').first().click()
    const editorF = page.getByRole('dialog', { name: 'Editar fórmula' })
    await editorF.waitFor({ timeout: 5000 })
    const eb = await editorF.boundingBox()
    check(eb && eb.x === 0 && eb.y === 0 && Math.round(eb.width) === 390 && Math.round(eb.height) === 844, 'Fórmulas: la ventana de editar ocupa toda la pantalla')
    const guardarF = await editorF.getByRole('button', { name: 'Guardar' }).boundingBox()
    check(guardarF && guardarF.y + guardarF.height <= 844 && guardarF.y > 844 - 90 && guardarF.height >= 40, 'Fórmulas: "Guardar" fijo abajo, de 40 px o más')
    const sF = await seSale(page, false)
    check(sF.n === 0, `Fórmulas: en la ventana nada se sale${sF.n ? ' — ' + sF.fuera.join(' | ') : ''}`)
    const cF = await camposChicos(page)
    check(cF.chicos.length === 0, `Fórmulas: los campos de la ventana con letra de 16 px${cF.chicos.length ? ' — ' + cF.chicos.slice(0, 3).join(', ') : ''}`)
    await captura(page, '390_formula_editar')
    await editorF.getByRole('button', { name: 'Cerrar' }).click()
    await ctx.close()
  }

  // ─── 3. Tablet (768): también con ☰ y el cajón ──────────────────────────────────────────────────────────────
  {
    const ctx = await b.newContext({ viewport: { width: 768, height: 1024 } })
    const page = await ctx.newPage()
    await page.goto(`${B}/app/dashboard`); await esperarPantalla(page)
    check(await page.getByTestId('abrir-menu').isVisible() && await page.locator('aside').count() === 0, '768: el menú se abre con ☰ (no ocupa el costado)')
    check(await page.locator('header').getByText('PRESUPUESTADOR PRO').isVisible(), '768: la barra completa (con "PRESUPUESTADOR PRO")')
    await page.getByTestId('abrir-menu').click()
    const cajon = page.getByRole('dialog', { name: 'Menú' })
    await cajon.waitFor()
    await cajon.getByRole('link', { name: 'Lista de precios' }).click()
    await page.waitForURL(/\/app\/catalogs$/)
    check(await cajon.count() === 0, '768: elegir en el cajón navega y lo cierra')
    check(await page.getByTestId('pestanas-proyecto').count() === 0, '768: fuera de un proyecto no hay pestañas')
    await page.goto(`${B}/app/budgets/${id}/export`); await esperarPantalla(page)
    check(!(await page.getByTestId('pestanas-proyecto').isVisible()), '768: las pestañas del proyecto son solo del celular')
    await ctx.close()
  }

  // ─── 4. Notebook chica (1024 a 1279): el menú angosto y «/» que se recuerda ────────────────────────────────
  {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 720 } })
    const page = await ctx.newPage()
    await page.goto(`${B}/app/budgets/${id}/export`); await esperarPantalla(page)
    const aside = page.locator('aside')
    let ab = await aside.boundingBox()
    check(ab && Math.round(ab.width) === 64 && await aside.getAttribute('data-modo') === 'angosto', `1100: el menú arranca angosto (${ab && Math.round(ab.width)} px, solo íconos)`)
    check(!(await page.getByTestId('abrir-menu').isVisible()), '1100: sin ☰ (el menú queda fijo)')
    const linksAngosto = await aside.getByRole('link').evaluateAll((ls) => ls.map((l) => l.getAttribute('aria-label')))
    check(linksAngosto.length === 13 && linksAngosto.includes('Lista de precios') && linksAngosto.includes('Exportar'), `1100: el menú angosto tiene las mismas ${linksAngosto.length} entradas`)
    // en 720 px de alto, con el proyecto abierto, el medio del menú se desliza: primero se lo trae a la vista
    await aside.getByRole('link', { name: 'Lista de precios' }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    await aside.getByRole('link', { name: 'Lista de precios' }).hover()
    await page.waitForTimeout(100)
    const pista = page.getByRole('tooltip')
    check(await pista.isVisible().catch(() => false) && (await pista.innerText()).trim() === 'Lista de precios', '1100: al pasar el mouse se ve el nombre ("Lista de precios")')
    await captura(page, '1100_menu_angosto')
    await page.mouse.move(600, 400)
    const boton = page.getByTestId('menu-ancho')
    check(await boton.getAttribute('aria-label') === 'Agrandar el menú', '1100: el botón «/» dice "Agrandar el menú"')
    await boton.click(); await page.waitForTimeout(250)
    ab = await aside.boundingBox()
    check(ab && Math.round(ab.width) === 224 && (await aside.innerText()).includes('Lista de precios'), `1100: «/» lo agranda (${ab && Math.round(ab.width)} px, con los nombres)`)
    await page.reload(); await esperarPantalla(page)
    ab = await aside.boundingBox()
    check(ab && Math.round(ab.width) === 224, `1100: al recargar se acuerda de que estaba grande (${ab && Math.round(ab.width)} px)`)
    await captura(page, '1100_menu_agrandado')
    await page.getByTestId('menu-ancho').click(); await page.waitForTimeout(250)
    await page.reload(); await esperarPantalla(page)
    ab = await aside.boundingBox()
    check(ab && Math.round(ab.width) === 64, `1100: lo achico, recargo y sigue angosto (${ab && Math.round(ab.width)} px)`)
    await aside.getByRole('link', { name: 'Fórmulas' }).click()
    await page.waitForURL(/\/app\/templates$/)
    check(true, '1100: las entradas del menú angosto navegan')
    const s = await seSale(page, false)
    check(s.n === 0, `1100: con el menú angosto nada se sale${s.n ? ' — ' + s.fuera.join(' | ') : ''}`)
    // Exactamente en 1024 también arranca angosto; en 1023 ya es el cajón
    await page.setViewportSize({ width: 1024, height: 720 }); await page.waitForTimeout(300)
    check(Math.round((await aside.boundingBox())?.width ?? 0) === 64, '1024: el menú angosto')
    await page.setViewportSize({ width: 1023, height: 720 }); await page.waitForTimeout(300)
    check(await page.locator('aside').count() === 0 && await page.getByTestId('abrir-menu').isVisible(), '1023: el menú pasa a ser el cajón con ☰')
    // Si el navegador no deja guardar, el menú funciona igual (arranca angosto)
    await page.setViewportSize({ width: 1100, height: 720 })
    await page.addInitScript(() => {
      // el navegador no deja leer ni guardar la preferencia del menú (modo privado, sitio bloqueado)
      const leer = Storage.prototype.getItem, guardar = Storage.prototype.setItem
      Storage.prototype.getItem = function (k) { if (String(k).startsWith('presupuestador:menu-angosto')) throw new Error('bloqueado'); return leer.call(this, k) }
      Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('presupuestador:menu-angosto')) throw new Error('bloqueado'); return guardar.call(this, k, v) }
    })
    await page.reload(); await esperarPantalla(page)
    check(Math.round((await page.locator('aside').boundingBox())?.width ?? 0) === 64, '1100 sin poder guardar en el navegador: arranca angosto y no se rompe')
    await page.getByTestId('menu-ancho').click(); await page.waitForTimeout(200)
    check(Math.round((await page.locator('aside').boundingBox())?.width ?? 0) === 224, '1100 sin poder guardar: «/» igual lo agranda')
    await ctx.close()
  }

  // ─── 5. 1280 y 1366: igual que siempre ─────────────────────────────────────────────────────────────────────
  for (const [w, h] of [[1280, 720], [1366, 768]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    // aunque haya quedado guardado "angosto", desde 1280 el menú va completo
    await page.addInitScript(() => { try { localStorage.setItem('presupuestador:menu-angosto:sin-usuario', '1') } catch { /* nada */ } })
    await page.goto(`${B}/app/budgets/${id}/export`); await esperarPantalla(page)
    const ab = await page.locator('aside').boundingBox()
    check(ab && Math.round(ab.width) === 224 && await page.locator('aside').getAttribute('data-modo') === 'fijo', `${w}×${h}: el menú fijo de 224 px, como siempre`)
    check(await page.getByTestId('menu-ancho').count() === 0, `${w}×${h}: sin botón «/»`)
    check(!(await page.getByTestId('abrir-menu').isVisible()), `${w}×${h}: sin ☰`)
    const header = page.locator('header')
    check(await header.getByText('PRESUPUESTADOR PRO').isVisible() && await header.getByText('TERRAC SA').isVisible(), `${w}×${h}: la barra con "PRESUPUESTADOR PRO" y la empresa`)
    const nb = await header.getByRole('button', { name: 'NUEVO' }).boundingBox()
    check(nb && nb.width > 80 && (await header.getByRole('button', { name: 'NUEVO' }).innerText()).includes('NUEVO'), `${w}×${h}: el botón "NUEVO" con su texto`)
    check(!(await page.getByTestId('pestanas-proyecto').isVisible()), `${w}×${h}: sin pestañas del proyecto (están en el menú)`)
    const menuTxt = await page.locator('aside').innerText()
    check(/PROYECTO ACTUAL/.test(menuTxt) && /CONFIGURACIÓN/.test(menuTxt) && /CERRAR SESIÓN/.test(menuTxt), `${w}×${h}: el menú con sus grupos de siempre`)
    if (w === 1366) await captura(page, '1366_export')
    await ctx.close()
  }

  // ─── 6. Cargar obra: confirmar sin esperar al servidor ─────────────────────────────────────────────────────
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
    await page.goto(`${B}/app/cargar-obra`)
    await page.setInputFiles('input[type=file]', path.join(EXCEL, 'ginkgo.xlsx'))
    await page.getByText('trabajos distintos').waitFor({ timeout: 120000 })
    await page.waitForFunction(() => !document.body.innerText.includes('Revisando'), null, { timeout: 120000 })
    const contador = async () => Number(await page.getByTestId('contador-para-confirmar').innerText())
    const confirmarBtns = page.getByRole('button', { name: 'Confirmar', exact: true })
    const antes = await contador()
    const botonesAntes = await confirmarBtns.count()
    const donde = `Cargar obra ${w}`
    check(antes > 2 && botonesAntes === antes, `${donde}: ${antes} para confirmar, cada uno con su "Confirmar"`)
    if (w === 390) {
      const c = await camposChicos(page)
      check(c.chicos.length === 0, `${donde}: los campos con letra de 16 px${c.chicos.length ? ' — ' + c.chicos.slice(0, 3).join(', ') : ''}`)
      const chicos = await botonesChicos(page, '[data-testid="tarea-obra"] button:not([title])')
      check(chicos.length === 0, `${donde}: los botones de las tarjetas miden 40 px o más${chicos.length ? ' — ' + chicos.slice(0, 3).join(', ') : ''}`)
      const s = await seSale(page, false)
      check(s.n === 0, `${donde}: con el Excel revisado nada se sale${s.n ? ' — ' + s.fuera.join(' | ') : ''}`)
      await captura(page, '390_cargar_obra_revisar', true)
    }

    // El servidor tarda: la tarjeta se confirma igual al instante y las otras siguen con sus botones
    let pedidos = 0
    await page.route('**/obras/analizar', async (r) => { pedidos++; await new Promise((res) => setTimeout(res, 2500)); await r.continue() })
    const primera = page.locator('[data-testid="tarea-obra"]', { has: confirmarBtns }).first()
    const clave = await primera.innerText()
    await primera.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await page.waitForTimeout(150)
    const tarjeta = page.locator('[data-testid="tarea-obra"]', { hasText: clave.split('\n')[0] }).first()
    check(await tarjeta.getAttribute('data-estado') === 'verde' && await tarjeta.getByTestId('confirmado').isVisible(),
      `${donde}: "Confirmar" deja la tarjeta confirmada al instante ("Confirmado ✓")`)
    check(await contador() === antes - 1, `${donde}: el contador "para confirmar" baja enseguida (${antes} → ${await contador()})`)
    check(await tarjeta.getByRole('button', { name: 'Deshacer' }).isVisible(), `${donde}: la tarjeta confirmada ofrece "Deshacer"`)
    await page.waitForTimeout(900) // ya salió el pedido (se agrupa ~700 ms) y el servidor sigue pensando
    check(await page.getByTestId('revisando').isVisible(), `${donde}: mientras revisa dice "Revisando…" (chico, sin bloquear)`)
    const durante = await confirmarBtns.count()
    const habilitados = await confirmarBtns.evaluateAll((bs) => bs.filter((x) => !x.disabled).length)
    check(durante === botonesAntes - 1 && habilitados === durante, `${donde}: durante la revisión las otras tarjetas siguen con "Confirmar" (${durante}, todos habilitados)`)
    // Se pueden confirmar varias seguidas: un solo pedido al final
    pedidos = 0
    const segunda = page.locator('[data-testid="tarea-obra"]', { has: confirmarBtns }).first()
    await segunda.getByRole('button', { name: 'Confirmar', exact: true }).click()
    const tercera = page.locator('[data-testid="tarea-obra"]', { has: confirmarBtns }).first()
    await tercera.getByRole('button', { name: 'Confirmar', exact: true }).click()
    check(await contador() === antes - 3, `${donde}: dos más seguidas, sin esperar (${await contador()} para confirmar)`)
    await page.waitForFunction(() => !document.body.innerText.includes('Revisando'), null, { timeout: 60000 })
    check(pedidos === 1, `${donde}: las dos seguidas van en un solo pedido al servidor (${pedidos})`)
    check(await contador() === antes - 3 && await tarjeta.getByTestId('confirmado').isVisible(), `${donde}: cuando contesta el servidor siguen confirmadas y en su lugar`)
    if (w === 390) await captura(page, '390_cargar_obra_confirmada')

    // Deshacer: vuelve a amarillo
    await tarjeta.getByRole('button', { name: 'Deshacer' }).click()
    await page.waitForTimeout(100)
    check(await tarjeta.getAttribute('data-estado') === 'amarillo' && await tarjeta.getByRole('button', { name: 'Confirmar', exact: true }).isVisible(),
      `${donde}: "Deshacer" la vuelve a amarillo con su "Confirmar"`)
    check(await contador() === antes - 2, `${donde}: y el contador vuelve a subir (${await contador()})`)
    await page.waitForFunction(() => !document.body.innerText.includes('Revisando'), null, { timeout: 60000 })
    check(await tarjeta.getAttribute('data-estado') === 'amarillo', `${donde}: el servidor también la deja para confirmar`)

    // Si la revisión falla: el error a la vista, con "Probar de nuevo", y lo confirmado no se pierde
    await page.unroute('**/obras/analizar')
    let falla = true
    await page.route('**/obras/analizar', async (r) => {
      if (falla) { falla = false; await r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Se cortó la conexión.' }) }) }
      else await r.continue()
    })
    const otra = page.locator('[data-testid="tarea-obra"]', { has: confirmarBtns }).first()
    const otraTxt = (await otra.innerText()).split('\n')[0]
    await otra.getByRole('button', { name: 'Confirmar', exact: true }).click()
    const err = page.getByTestId('error-revision')
    await err.waitFor({ timeout: 10000 }).catch(() => {})
    check(await err.isVisible() && /Se cortó la conexión/.test(await err.innerText()), `${donde}: si la revisión falla, el error queda a la vista`)
    const otraT = page.locator('[data-testid="tarea-obra"]', { hasText: otraTxt }).first()
    check(await otraT.getAttribute('data-estado') === 'verde', `${donde}: lo confirmado no se pierde con el error`)
    await err.getByRole('button', { name: 'Probar de nuevo' }).click()
    await page.waitForFunction(() => !document.body.innerText.includes('Revisando'), null, { timeout: 60000 })
    check(await err.count() === 0 && await otraT.getAttribute('data-estado') === 'verde', `${donde}: "Probar de nuevo" revisa y sigue confirmada`)
    await page.unroute('**/obras/analizar')

    // "Confirmar los N para confirmar": todos juntos, un solo pedido
    pedidos = 0
    await page.route('**/obras/analizar', async (r) => { pedidos++; await r.continue() })
    const n = await contador()
    const todos = page.getByRole('button', { name: new RegExp(`^Confirmar los ${n} para confirmar$`) })
    check(await todos.count() === 1, `${donde}: botón "Confirmar los ${n} para confirmar"`)
    await todos.click()
    check(await page.getByText(/tal como los propone la app: los que tienen fórmula, con esa fórmula; los que no, con el precio del Excel\. Podés cambiar cualquiera después\./).isVisible(),
      `${donde}: pide confirmación en la misma página, con lo que va a hacer`)
    if (w === 390) await captura(page, '390_cargar_obra_confirmar_todos')
    await page.getByRole('button', { name: new RegExp(`^Sí, confirmar los ${n}$`) }).click()
    await page.waitForTimeout(100)
    check(await contador() === 0, `${donde}: "Confirmar los ${n}" deja 0 para confirmar al instante`)
    await page.waitForFunction(() => !document.body.innerText.includes('Revisando'), null, { timeout: 60000 })
    await page.waitForTimeout(300)
    check(await contador() === 0 && pedidos === 1, `${donde}: y después de revisar sigue en 0, con un solo pedido al servidor (${pedidos})`)
    check(await page.getByTestId('confirmar-todos').count() === 0, `${donde}: ya no ofrece "Confirmar los N"`)
    await page.unroute('**/obras/analizar')
    await ctx.close()
  }

  await b.close()
  console.log(`\n${ok} OK, ${bad} FALLAS`)
  if (bad) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
