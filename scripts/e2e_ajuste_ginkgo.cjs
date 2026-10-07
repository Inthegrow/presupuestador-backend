// Prueba de punta a punta de la entrega 8 (PLAN_AJUSTE_GINKGO.md): correcciones de la revisión de Ginkgo con un botón
// (aviso en Fórmulas, tarjetas con la respuesta supuesta y sus fuentes, aplicar / deshacer, la nota en la fórmula,
// una que no coincide no se deja aplicar, "Aplicar todas" con confirmación en la página), cada precio con su origen
// y el buscador de precios en internet (en Precios por renglón, "Buscar un precio" arriba y en un recurso en rojo del
// detalle de un trabajo; sin resultados, falla y sin configurar). Celular (400 px) sin barra horizontal.
// Corre contra vite (5179) + scripts/serve_fake.py (8000) con FAKE_BUSCADOR=1, con el servidor falso recién levantado.
// Uso: FAKE_BUSCADOR=1 python3 scripts/serve_fake.py (y vite), luego NODE_PATH=<node_modules con playwright> node scripts/e2e_ajuste_ginkgo.cjs
const path = require('path')
const { chromium } = require('playwright')
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots-ajuste')
require('fs').mkdirSync(SHOTS, { recursive: true })
const B = 'http://127.0.0.1:5179', API = 'http://127.0.0.1:8000'
let ok = 0, bad = 0
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); c ? ok++ : bad++ }
const j = async (method, url, body) => (await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()
const hoyCorto = (() => { const d = new Date(); return `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` })()

async function sinBarra(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    return document.documentElement.scrollWidth <= window.innerWidth && (!main || main.scrollWidth <= main.clientWidth + 1)
  })
}
const arriba = (page) => page.evaluate(() => { document.querySelector('main')?.scrollTo(0, 0); window.scrollTo(0, 0) })

;(async () => {
  // Datos: el Maestro como lista oficial; una fórmula con un material sin precio y un presupuesto que la usa
  const cats = await j('GET', '/catalogs')
  for (const c of cats) if (c.name.startsWith('Maestro')) await j('PATCH', `/catalogs/${c.id}`, { oficial: true })
  const [tpl] = await j('POST', '/__fake/insert/item_templates', [{
    codigo: '9.90', nombre: 'CONTRAPISO CON MALLA (PRUEBA BUSCADOR)', unidad: 'm2', categoria: 'Pruebas',
    origen: 'manual', desperdicio_pct: null, editado: false, parametros: [],
    recursos: [{ tipo: 'material', codigo: 'M-MALLA-Q188', descripcion: 'Malla sima Q188 15x15 4,2 mm', unidad: 'u', formula: 'Q/12' }],
  }])
  const bud = (await j('POST', '/budgets/create-full', { name: 'Prueba buscador de precios' })).budget
  const trabajo = await j('POST', `/budgets/${bud.id}/trabajos`, { template_id: tpl.id, cantidad: 120 })
  const itemId = trabajo.item.id
  const lote = await j('GET', '/correcciones')
  const total = lote.correcciones.length
  const paraAplicar = lote.correcciones.filter((c) => c.estado === 'para_aplicar').length
  const plantilla84 = (await j('GET', '/templates')).find((t) => t.codigo === '8.4')

  const b = await chromium.launch()
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } })
  const dialogos = []
  page.on('dialog', (d) => { dialogos.push(d.message()); d.dismiss() })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))

  // 1. Fórmulas: el aviso arriba lleva a Correcciones
  await page.goto(`${B}/app/templates`)
  const aviso = page.getByTestId('aviso-correcciones')
  await aviso.waitFor({ timeout: 15000 })
  const textoAviso = (await aviso.innerText()).replace(/\s+/g, ' ')
  check(new RegExp(`Revisión de Ginkgo: ${paraAplicar} correcci(ón|ones) para aplicar`).test(textoAviso) && /Ver/.test(textoAviso), `aviso en Fórmulas: "${textoAviso}"`)
  await aviso.click()
  await page.getByTestId('correccion').first().waitFor({ timeout: 10000 })
  check(page.url().endsWith('/app/templates/correcciones'), `"Ver" lleva a Fórmulas → Correcciones (${page.url().replace(B, '')})`)
  check(await page.getByRole('heading', { name: 'REVISIÓN DE GINKGO' }).count() === 1, 'la pantalla se llama "REVISIÓN DE GINKGO"')

  // 2. Cada tarjeta: respuesta supuesta a la vista, en su color, y sus fuentes
  const tarjetas = page.getByTestId('correccion')
  check(await tarjetas.count() === total, `una tarjeta por corrección (${await tarjetas.count()} de ${total})`)
  let conSupuesto = 0, conFuentes = 0
  for (let i = 0; i < total; i++) {
    const t = tarjetas.nth(i)
    const sup = (await t.getByTestId('supuesto').innerText().catch(() => '')).replace(/\s+/g, ' ')
    if (/Supuesto por Claude · a confirmar por (Emilia|Sol)/i.test(sup) && /Supuesto por Claude el \d+\/\d+\/\d{4} · a confirmar por (Emilia|Sol):/.test(sup) && /Razón:/.test(sup)) conSupuesto++
    if (await t.getByTestId('fuentes').locator('li').count() > 0) conFuentes++
  }
  check(conSupuesto === total, `todas dicen "Supuesto por Claude · a confirmar por" Emilia o Sol, con fecha y razón (${conSupuesto} de ${total})`)
  check(conFuentes === total, `todas muestran "De dónde sale" (${conFuentes} de ${total})`)
  const colorSupuesto = await tarjetas.first().getByTestId('supuesto').evaluate((e) => getComputedStyle(e).backgroundColor + ' ' + getComputedStyle(e).borderStyle)
  check(/dashed/.test(colorSupuesto) && !/rgb\(232, 245, 238\)/.test(colorSupuesto), `lo supuesto va en su color, con borde punteado, no en el verde de lo confirmado (${colorSupuesto})`)
  const cifra = async (id) => Number(await page.getByTestId(id).getAttribute('data-valor'))
  check(await cifra('cifra-para-aplicar') === paraAplicar && await cifra('cifra-aplicadas') === 0, `resumen: 0 aplicadas, ${paraAplicar} para aplicar`)
  await arriba(page)
  await page.screenshot({ path: `${SHOTS}/01_correcciones_1280.png` })

  // 3. Ver los cambios de A1: renglón por renglón, antes → después, con nombres en palabras
  const a1 = page.locator('[data-testid="correccion"][data-id="A1"]')
  check(/−\$19,7 millones/.test(await a1.getByTestId('efecto').innerText()), 'A1: efecto en Ginkgo "−$19,7 millones"')
  await a1.getByRole('button', { name: /Ver los cambios/ }).click()
  const cambioA1 = (await a1.getByTestId('cambios').innerText()).replace(/\s+/g, ' ')
  check(/C-MEM/.test(cambioA1) && /Fórmula 8\.4/.test(cambioA1) && /Cantidad: Q → Q\/10/.test(cambioA1.replace(/ ?pasa a ?/, ' → ')), `A1: "Ver los cambios" dice fórmula, recurso y Q → Q/10 ("${cambioA1.slice(0, 120)}…")`)
  await a1.scrollIntoViewIfNeeded(); await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/02_ver_los_cambios_1280.png` })

  // 4. Aplicar A1 → "Aplicada"; la fórmula 8.4 tiene el valor nuevo y la nota
  await a1.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await page.locator('[data-testid="correccion"][data-id="A1"][data-estado="aplicada"]').waitFor({ timeout: 10000 })
  const chipA1 = (await a1.getByTestId('estado-correccion').innerText()).trim()
  check(/^Aplicada el \d+\/\d+ por Sol$/.test(chipA1), `A1 queda "${chipA1}"`)
  check(await a1.getByRole('button', { name: 'Deshacer' }).count() === 1, 'A1 ofrece "Deshacer"')
  const volver = page.getByTestId('aviso-volver-a-cargar')
  check(/Los presupuestos ya cargados no cambian solos/.test(await volver.innerText()) && await volver.getByRole('link', { name: 'Cargar obra' }).count() === 1,
    'después de aplicar: "Los presupuestos ya cargados no cambian solos…" con el link a Cargar obra')
  const api84 = (await j('GET', `/templates/${plantilla84.id}`)).recursos.find((r) => r.codigo === 'C-MEM')
  check(api84.formula === 'Q/10' && /A1/.test(api84.correccion?.texto || ''), `en la base, C-MEM de la 8.4 queda Q/10 con la nota (${api84.formula})`)
  await page.goto(`${B}/app/templates`)
  await page.getByPlaceholder(/Buscá una fórmula/).fill('8.4'); await page.waitForTimeout(300)
  const f84 = page.getByTestId('formula').first()
  await f84.click()
  const nota = f84.getByTestId('nota-correccion')
  check(await nota.count() === 1 && /Corregido por la revisión de Ginkgo \(A1\), supuesto por Claude el 7\/10\/2026, a confirmar por Emilia/.test(await nota.innerText()),
    `la fórmula 8.4 muestra la nota: "${await nota.innerText().catch(() => '')}"`)
  check(await f84.locator('tr', { hasText: 'C-MEM' }).first().getByText('Q/10', { exact: true }).count() === 1, 'y el valor nuevo: C-MEM = Q/10')
  await f84.screenshot({ path: `${SHOTS}/03_formula_con_nota.png` })
  await f84.getByTitle('Editar fórmulas y parámetros').click()
  const editor = page.locator('div.fixed.inset-0')
  await editor.getByText('Editar fórmula', { exact: true }).waitFor()
  check(await editor.getByTestId('nota-correccion').count() === 1, 'en el editor de la fórmula, el renglón corregido muestra la línea chica')
  await page.screenshot({ path: `${SHOTS}/04_editor_con_nota.png` })
  await editor.getByRole('button', { name: 'Cancelar' }).click()

  // 5. Deshacer A1 → vuelve a como estaba
  await page.goto(`${B}/app/templates/correcciones`)
  await a1.waitFor()
  await a1.getByRole('button', { name: 'Deshacer' }).click()
  await page.locator('[data-testid="correccion"][data-id="A1"][data-estado="para_aplicar"]').waitFor({ timeout: 10000 })
  const deshecha = (await j('GET', `/templates/${plantilla84.id}`)).recursos.find((r) => r.codigo === 'C-MEM')
  check(deshecha.formula === 'Q' && !deshecha.correccion, `Deshacer: C-MEM vuelve a Q y sin nota (${deshecha.formula})`)
  check(/Deshecha/.test(await a1.innerText()) && await a1.getByRole('button', { name: 'Aplicar', exact: true }).count() === 1, 'A1 dice "Deshecha" y vuelve a ofrecer "Aplicar"')

  // 6. Una que no coincide (se editó la fórmula a mano antes): no deja aplicar y dice qué encontró
  const rec84 = (await j('GET', `/templates/${plantilla84.id}`)).recursos
  await j('PATCH', `/templates/${plantilla84.id}`, { recursos: rec84.map((r) => (r.codigo === 'C-MEM' ? { ...r, formula: 'Q/5' } : r)) })
  await page.reload()
  await page.locator('[data-testid="correccion"][data-id="A1"][data-estado="no_coincide"]').waitFor({ timeout: 10000 })
  check(/^No coincide$/.test((await a1.getByTestId('estado-correccion').innerText()).trim()), 'A1 editada a mano: "No coincide"')
  const detalle = (await a1.getByTestId('detalle-estado').innerText()).replace(/\s+/g, ' ')
  check(/^No coincide: /.test(detalle) && /cambió desde la revisión/.test(detalle) && /C-MEM/.test(detalle) && /Q\/5/.test(detalle), `dice qué renglón y qué valor encontró: "${detalle}"`)
  check(await a1.getByRole('button', { name: 'Aplicar', exact: true }).count() === 0, 'no hay botón "Aplicar" en la que no coincide')
  check(await cifra('cifra-no-coinciden') === 1, 'el resumen cuenta 1 que no coincide')
  await a1.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/05_no_coincide.png` })

  // 7. "Aplicar todas las que se pueden": confirmación en la página, después todas aplicadas
  const pueden = paraAplicar - 1
  const todas = page.getByRole('button', { name: `Aplicar todas las que se pueden (${pueden})` })
  check(await todas.count() === 1, `botón "Aplicar todas las que se pueden (${pueden})"`)
  await arriba(page)
  await todas.click()
  const conf = page.getByTestId('confirmar-todas')
  check(await conf.count() === 1 && /Las que no coinciden \(1\) quedan como están/.test(await conf.innerText()), 'pide confirmar en la misma pantalla (y dice que la que no coincide queda)')
  await page.screenshot({ path: `${SHOTS}/06_confirmar_todas.png` })
  await conf.getByRole('button', { name: /^Sí, aplicar/ }).click()
  await page.getByTestId('resultado-todas').waitFor({ timeout: 20000 })
  const res = (await page.getByTestId('resultado-todas').innerText()).trim()
  check(new RegExp(`Se aplic(ó|aron) ${pueden} correcci`).test(res), `resultado: "${res}"`)
  check(await cifra('cifra-aplicadas') === pueden && await cifra('cifra-para-aplicar') === 0, `resumen: ${pueden} aplicadas, 0 para aplicar`)
  check(dialogos.length === 0, `ninguna ventana del navegador (alert/confirm): ${dialogos.length}`)
  await page.screenshot({ path: `${SHOTS}/07_todas_aplicadas.png` })
  // la 8.4 vuelve a como estaba (para no dejarla tocada)
  await j('PATCH', `/templates/${plantilla84.id}`, { recursos: rec84 })

  // 8. Precios: el precio que cargó la corrección dice de dónde salió
  await page.goto(`${B}/app/catalogs`)
  const listaSub = page.locator('[data-testid="lista-precios"]', { hasText: 'Maestro TERRAC - Subcontratos' })
  await listaSub.getByText('Maestro TERRAC - Subcontratos').first().click()
  await listaSub.getByPlaceholder('Buscar por código o descripción...').fill('cajon'); await page.waitForTimeout(800)
  const cajon = listaSub.getByTestId('precio-renglon').filter({ hasText: 'SUB-YES-CAJON' })
  const origenCajon = (await cajon.getByTestId('origen-precio').innerText().catch(() => '')).replace(/\s+/g, ' ')
  check(/Excel de Sol, Ginkgo, hoja 00_Sub/.test(origenCajon) && /EVER/.test(origenCajon) && /18\/09\/2026/.test(origenCajon), `SUB-YES-CAJON (de la corrección A6) dice de dónde salió: "${origenCajon}"`)

  // 9. Precios: "Buscar en internet" en un renglón → opciones con link y cuenta → "Usar este precio"
  await page.reload()
  const listaMat = page.locator('[data-testid="lista-precios"]', { hasText: 'Maestro TERRAC - Materiales' })
  await listaMat.getByText('Maestro TERRAC - Materiales').first().click()
  await listaMat.getByPlaceholder('Buscar por código o descripción...').fill('Cemento'); await page.waitForTimeout(800)
  // un precio que ninguna corrección toca (la piedra) muestra lo que se sabe de antes
  await listaMat.getByPlaceholder('Buscar por código o descripción...').fill('Piedra a granel'); await page.waitForTimeout(800)
  const piedra = listaMat.getByTestId('precio-renglon').filter({ hasText: 'Piedra a granel' }).first()
  const origenViejo = (await piedra.getByTestId('origen-precio').innerText()).replace(/\s+/g, ' ')
  check(/Proveedor: Su Corralon · 3\/06\/2026/.test(origenViejo), `un precio viejo sin origen muestra lo que se sabe: "${origenViejo}"`)
  await listaMat.getByPlaceholder('Buscar por código o descripción...').fill('Cemento'); await page.waitForTimeout(800)
  const cem = listaMat.getByTestId('precio-renglon').filter({ hasText: 'Loma Negra' }).first()
  await cem.getByTestId('buscar-en-internet').click()
  const panel = page.getByTestId('buscar-precio')
  await panel.waitFor()
  check(/Bolsa Cemento "Loma Negra" 25 k/.test(await panel.getByLabel('Qué buscar').inputValue()) && await panel.getByLabel('Unidad').inputValue() === 'u',
    'el panel arma la búsqueda con la descripción y la unidad (editables)')
  await panel.getByRole('button', { name: 'Buscar', exact: true }).click()
  await panel.getByTestId('resultados-precio').waitFor({ timeout: 15000 })
  const opciones = panel.getByTestId('opcion-precio')
  check(await opciones.count() === 3, `3 opciones (${await opciones.count()})`)
  const links = await panel.getByTestId('ver-en-el-sitio').evaluateAll((as) => as.map((a) => a.href))
  check(links.length === 3 && links.every((h) => /^https:\/\/.+ejemplo=prueba/.test(h)), `cada opción tiene "Ver en el sitio" con su link (${links.length})`)
  const cuenta = (await opciones.first().getByTestId('opcion-cuenta').innerText()).trim()
  check(/\$8\.990 bolsa de 25 kg con IVA → \$7\.430 sin IVA/.test(cuenta), `la cuenta a la vista: "${cuenta}"`)
  check((await opciones.first().getByTestId('opcion-precio-app').innerText()).trim() === '$7.430', 'precio por la unidad de la app, sin IVA: $7.430')
  const distinta = opciones.nth(2)
  check(await distinta.getByTestId('unidad-distinta').count() === 1 && await distinta.getByLabel(/Precio por unidad, sin IVA/).count() === 1,
    'la de 50 kg (otra presentación) queda marcada y deja corregir el número')
  check(/un corralón por volumen suele ser más barato/.test(await panel.innerText()), 'abajo: "Precios de venta al público: un corralón por volumen suele ser más barato."')
  await page.screenshot({ path: `${SHOTS}/08_buscador_resultados_1280.png` })
  await opciones.first().getByRole('button', { name: /Usar este precio/ }).click()
  await panel.waitFor({ state: 'detached', timeout: 10000 })
  await page.waitForTimeout(400)
  const precioNuevo = (await cem.getByTestId('precio-sin-iva').innerText()).trim()
  const origenNuevo = cem.getByTestId('origen-precio')
  const textoOrigen = (await origenNuevo.innerText()).replace(/\s+/g, ' ')
  check(precioNuevo === '$7.430', `el renglón queda con el precio nuevo (${precioNuevo})`)
  check(new RegExp(`Internet: Easy · Cemento Portland Loma Negra x 25 kg · consultado el ${hoyCorto.replace(/\//g, '\\/')}`).test(textoOrigen), `y su origen: "${textoOrigen}"`)
  check(/easy\.com\.ar.+ejemplo=prueba/.test(await origenNuevo.getByRole('link').getAttribute('href')), 'con el link "Ver" al sitio')
  await cem.getByRole('button', { name: 'Historial del precio' }).click()
  const hist = page.getByTestId('historial-precio')
  await hist.getByText('actual').waitFor({ timeout: 5000 })
  const textoHist = (await hist.innerText()).replace(/\s+/g, ' ')
  check(/\$7\.430/.test(textoHist) && /Internet: Easy/.test(textoHist), `el historial muestra el origen de cada valor: "${textoHist.slice(0, 140)}"`)
  await cem.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/09_precios_con_origen_1280.png` })

  // 10. "Buscar un precio" arriba: sin configurar, sin resultados, falla y uno nuevo
  await arriba(page)
  await page.getByRole('button', { name: 'Buscar un precio' }).click()
  await panel.waitFor()
  const que = panel.getByLabel('Qué buscar')
  await que.fill('sin configurar'); await panel.getByRole('button', { name: 'Buscar', exact: true }).click()
  await panel.getByTestId('buscador-no-configurado').waitFor({ timeout: 10000 })
  check(/El buscador de precios no está configurado/.test(await panel.getByTestId('buscador-no-configurado').innerText()), 'sin configurar: "El buscador de precios no está configurado"')
  await que.fill('zzz nada'); await panel.getByRole('button', { name: /Buscar/ }).first().click()
  await panel.getByTestId('sin-opciones').waitFor({ timeout: 10000 })
  check(/No encontré precios con su link/.test(await panel.getByTestId('sin-opciones').innerText()) && await panel.getByTestId('sin-opciones').getByRole('button', { name: 'Buscar de nuevo' }).count() === 1,
    'sin resultados: lo dice y deja buscar de nuevo')
  await que.fill('falla'); await panel.getByRole('button', { name: /Buscar/ }).first().click()
  await panel.getByTestId('buscador-error').waitFor({ timeout: 10000 })
  check(/tardó más de un minuto/.test(await panel.getByTestId('buscador-error').innerText()) && await panel.getByRole('button', { name: 'Probar de nuevo' }).count() === 1,
    'falla: muestra el mensaje y "Probar de nuevo"')
  await que.fill('Malla sima Q188 2,40 x 6')
  await panel.getByLabel('Unidad').fill('u')
  await panel.getByLabel('Código (opcional)').fill('M-MALLA-WEB')
  check(await panel.getByLabel('Va en la lista').locator('option:checked').innerText() === 'Maestro TERRAC - Materiales', 'para un material propone la lista oficial de materiales')
  await panel.getByRole('button', { name: /Buscar/ }).first().click()
  await panel.getByTestId('resultados-precio').waitFor({ timeout: 10000 })
  await panel.getByTestId('opcion-precio').nth(1).getByRole('button', { name: /Usar este precio/ }).click()
  await page.getByTestId('precio-guardado').waitFor({ timeout: 10000 })
  const guardado = (await page.getByTestId('precio-guardado').innerText()).replace(/\s+/g, ' ')
  check(/Guardado en «Maestro TERRAC - Materiales»/.test(guardado) && /M-MALLA-WEB/.test(guardado) && /Internet: Corralón El Puente/.test(guardado), `"Buscar un precio" lo guarda en la lista oficial: "${guardado.slice(0, 160)}"`)
  const nuevo = page.locator('[data-entry-id]', { hasText: 'M-MALLA-WEB' })
  await nuevo.waitFor({ timeout: 5000 })
  check(/Internet: Corralón El Puente/.test(await nuevo.getByTestId('origen-precio').innerText()), 'el renglón nuevo aparece en la lista con su origen')

  // 11. Detalle de un trabajo: el recurso sin precio (en rojo) → "Buscar en internet" → lo toma
  await page.goto(`${B}/app/budgets/${bud.id}/item/${itemId}`)
  const rojo = page.getByTestId('recurso-sin-precio')
  await rojo.waitFor({ timeout: 15000 })
  check(await rojo.count() === 1 && /Sin precio/.test(await rojo.innerText()), 'el recurso sin precio dice "Sin precio" en rojo')
  await rojo.getByRole('button', { name: 'Buscar en internet' }).click()
  await panel.waitFor()
  await panel.getByText(/no está en ninguna lista oficial/).waitFor({ timeout: 10000 }).catch(() => {})
  check(/M-MALLA-Q188 no está en ninguna lista oficial: se agrega a «Maestro TERRAC - Materiales»/.test((await panel.innerText()).replace(/\s+/g, ' ')), 'dice dónde lo guarda (no está: lo agrega a la lista oficial)')
  await panel.getByRole('button', { name: 'Buscar', exact: true }).click()
  await panel.getByTestId('resultados-precio').waitFor({ timeout: 10000 })
  check(await panel.getByTestId('opcion-precio').count() === 2, 'opciones para la malla')
  await page.screenshot({ path: `${SHOTS}/10_buscador_desde_trabajo_1280.png` })
  await panel.getByTestId('opcion-precio').first().getByRole('button', { name: /Usar este precio/ }).click()
  await page.getByTestId('precio-buscado').waitFor({ timeout: 10000 })
  await page.waitForTimeout(800)
  const okTrabajo = (await page.getByTestId('precio-buscado').innerText()).replace(/\s+/g, ' ')
  check(/M-MALLA-Q188: \$\s?43\.719 sin IVA/.test(okTrabajo) && /Este trabajo ya lo usa/.test(okTrabajo) && /Internet: Hierros Avellaneda/.test(okTrabajo), `el trabajo toma el precio: "${okTrabajo.slice(0, 170)}"`)
  check(await page.getByTestId('recurso-sin-precio').count() === 0, 'el recurso ya no está en rojo')
  check(/Listo|Tiene todos/.test(await page.getByTestId('estado-trabajo').innerText().catch(() => '')) || await page.getByText(/Faltan precios/).count() === 0, 'ya no faltan precios en el trabajo')
  await page.screenshot({ path: `${SHOTS}/11_trabajo_con_precio_1280.png` })

  // 12. Celular (400 px): sin barra horizontal; capturas de Correcciones, el buscador y Precios
  const m = await b.newPage({ viewport: { width: 400, height: 860 } })
  m.on('dialog', (d) => { dialogos.push(d.message()); d.dismiss() })
  await m.goto(`${B}/app/templates/correcciones`)
  await m.getByTestId('correccion').first().waitFor({ timeout: 15000 })
  await m.locator('[data-testid="correccion"][data-id="A1"]').getByRole('button', { name: /Ver los cambios/ }).click()
  await m.waitForTimeout(400)
  check(await sinBarra(m), 'celular, Correcciones: sin barra horizontal')
  await m.screenshot({ path: `${SHOTS}/12_correcciones_400.png` })
  await m.locator('[data-testid="correccion"][data-id="A1"]').scrollIntoViewIfNeeded()
  await m.screenshot({ path: `${SHOTS}/12b_correcciones_400_tarjeta.png` })
  await m.goto(`${B}/app/catalogs`)
  const listaM = m.locator('[data-testid="lista-precios"]', { hasText: 'Maestro TERRAC - Materiales' })
  await listaM.getByText('Maestro TERRAC - Materiales').first().click()
  await listaM.getByPlaceholder('Buscar por código o descripción...').fill('Cemento'); await m.waitForTimeout(800)
  const cemM = listaM.getByTestId('precio-renglon').filter({ hasText: 'Loma Negra' }).first()
  await cemM.scrollIntoViewIfNeeded()
  check(await sinBarra(m), 'celular, Precios con el origen: sin barra horizontal')
  check(await cemM.getByTestId('origen-precio').isVisible(), 'celular: el origen se ve debajo del precio')
  await m.screenshot({ path: `${SHOTS}/13_precios_con_origen_400.png` })
  await cemM.getByTestId('buscar-en-internet').click()
  const panelM = m.getByTestId('buscar-precio')
  await panelM.getByRole('button', { name: 'Buscar', exact: true }).click()
  await panelM.getByTestId('resultados-precio').waitFor({ timeout: 10000 })
  check(await sinBarra(m) && await panelM.evaluate((p) => p.scrollWidth <= p.clientWidth + 1), 'celular, buscador con resultados: sin barra horizontal')
  await m.screenshot({ path: `${SHOTS}/14_buscador_resultados_400.png` })
  await panelM.getByTestId('opcion-precio').nth(2).scrollIntoViewIfNeeded()
  await m.screenshot({ path: `${SHOTS}/14b_buscador_otra_presentacion_400.png` })
  check(dialogos.length === 0, 'ninguna ventana del navegador en toda la prueba')

  await b.close()
  console.log(`\n${ok} OK, ${bad} FALLA`)
  process.exit(bad ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
