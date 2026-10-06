// Prueba de punta a punta del renglón "Agregá un trabajo" del editor: escribir como se habla, "Quizás sea",
// cantidad + Enter, rubro de la fórmula, pregunta de conversión, punto de color de la tabla, rubro elegido en el
// árbol, el formulario sin fórmula, errores visibles y la tabla sin puntos cuando falla la consulta de precios.
// Corre contra vite (5179) + scripts/serve_fake.py (8000), con el servidor falso recién levantado.
// Uso: NODE_PATH=<node_modules con playwright> node scripts/e2e_agregar_trabajo.cjs
const path = require('path')
const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots-agregar')
require('fs').mkdirSync(SHOTS, { recursive: true })
const B = 'http://127.0.0.1:5179', API = 'http://127.0.0.1:8000';
let ok = 0, bad = 0;
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); c ? ok++ : bad++; };
const j = async (method, url, body) => (await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
(async () => {
  const cats = await j('GET', '/catalogs'); for (const c of (Array.isArray(cats) ? cats : cats.catalogs)) if (c.name.includes('Maestro')) await j('PATCH', `/catalogs/${c.id}`, { oficial: true });
  const bud = (await j('POST', '/budgets/create-full', { name: 'Prueba agregar trabajo' })).budget;
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const buscador = page.getByPlaceholder('hueco 18, contrapiso, pintura…');
  const cantidad = page.getByLabel('Cantidad', { exact: true });
  const unidad = page.getByLabel('Unidad', { exact: true });
  const aviso = page.getByRole('status');
  const fila = (re) => page.locator('tbody tr', { hasText: re });
  const punto = (re) => fila(re).locator('[data-semaforo]');
  const focoEnBuscador = () => page.evaluate(() => document.activeElement?.getAttribute('placeholder') === 'hueco 18, contrapiso, pintura…');

  // 0. presupuesto vacío: el renglón está arriba de la tabla
  await page.goto(`${B}/app/budgets/${bud.id}/editor`); await page.waitForTimeout(2000);
  check(await page.getByText(/^Agregá un trabajo: escribí como hablás$/).count() > 0 && await buscador.count() > 0, 'presupuesto vacío: renglón "Agregá un trabajo" con el buscador');
  check(await page.getByText(/todavía no tiene trabajos/).count() > 0, 'presupuesto vacío: dice que todavía no tiene trabajos');
  check(await page.getByRole('button', { name: /^Item$/ }).count() === 0, 'ya no está el botón "+ Item"');
  await page.screenshot({ path: SHOTS + '/01_vacio.png' });

  // 1. "hueco 18": Quizás sea → ladrillo hueco del 18, 40, Enter → Albañilería, verde
  await buscador.click(); await buscador.pressSequentially('hueco 18', { delay: 40 }); await page.waitForTimeout(1200);
  check(await page.getByText(/Quizás sea/).count() > 0, '"hueco 18": aparece "Quizás sea"');
  await page.screenshot({ path: SHOTS + '/02_quizas_hueco.png' });
  const quizas = page.getByText('Quizás sea:', { exact: true }).locator('..');
  await quizas.getByRole('button', { name: /HUECO DEL 18/ }).first().click(); await page.waitForTimeout(300);
  check(await unidad.inputValue() === 'm2', `unidad prellenada con la de la fórmula (vino "${await unidad.inputValue()}")`);
  check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Cantidad'), 'después de elegir, el foco va a la cantidad');
  await cantidad.fill('40'); await cantidad.press('Enter'); await page.waitForTimeout(2500);
  check(/^Agregado\.$/.test((await aviso.textContent().catch(() => '')).trim()), `dice "Agregado." (vino "${(await aviso.textContent().catch(() => '')).trim()}")`);
  check(await page.getByText('Albañileria', { exact: true }).count() > 0, 'el árbol muestra el rubro "Albañilería" (creado)');
  check(await fila(/hueco del 18/i).count() > 0, 'la tabla muestra el trabajo nuevo');
  check(await punto(/hueco del 18/i).getAttribute('data-semaforo').catch(() => null) === 'verde', 'hueco 18: punto verde');
  check(await punto(/hueco del 18/i).getAttribute('title').catch(() => null) === 'Con fórmula y con todos los precios', 'punto verde con su frase al pasar el mouse');
  check(await focoEnBuscador() && await buscador.inputValue() === '' && await cantidad.inputValue() === '', 'renglón limpio y el foco vuelve al buscador');
  await page.screenshot({ path: SHOTS + '/03_hueco_agregado.png' });

  // 2. "contrapiso e=8cm": la propuesta, 30 → pregunta con 0,08 → agregado
  await buscador.pressSequentially('contrapiso e=8cm', { delay: 30 }); await page.waitForTimeout(1200);
  check(await page.getByText('Propuesta', { exact: true }).count() > 0, 'contrapiso: hay una propuesta');
  await page.locator('button', { has: page.getByText('Propuesta', { exact: true }) }).first().click(); await page.waitForTimeout(300);
  check(await unidad.inputValue() === 'm2', `contrapiso: se mide en m2 (vino "${await unidad.inputValue()}")`);
  await cantidad.fill('30'); await cantidad.press('Enter'); await page.waitForTimeout(1500);
  const conv = await page.locator('section[aria-label="Agregá un trabajo"] input[inputmode="decimal"]:not([aria-label])').inputValue().catch(() => '');
  check(/^0[.,]08$/.test(conv), `contrapiso e=8cm: pregunta con 0,08 (vino "${conv}")`);
  check(await page.getByText(/¿Cuántos m³ hay en 1 m²\?/).count() > 0, 'la pregunta dice la conversión del servidor');
  check(await fila(/contrapiso/i).count() === 0, 'mientras pregunta, no se creó nada');
  await page.screenshot({ path: SHOTS + '/04_pregunta_conversion.png' });
  await page.getByText(/Para contrapisos y carpetas/).locator('..').getByRole('button', { name: /^Agregar$/ }).click(); await page.waitForTimeout(2500);
  check(/^Agregado/.test((await aviso.textContent().catch(() => '')).trim()), 'contrapiso: agregado después de responder');
  check(await fila(/Contrapiso e=8cm/).count() > 0, 'contrapiso: aparece en la tabla con el nombre que escribió Sol');
  check(await page.getByText(/Para contrapisos y carpetas/).count() === 0, 'la pregunta se cierra');
  check(await focoEnBuscador(), 'el foco vuelve al buscador');

  // 3. "lija": pintura en paredes, 120, botón Agregar → Terminaciones, rojo "Faltan N precios"
  await buscador.pressSequentially('lija', { delay: 40 }); await page.waitForTimeout(1200);
  const pint = page.getByRole('button', { name: /PINTURA EN PAREDES \(yeso, lija \+ 3 manos\)/ }).first();
  check(await pint.count() > 0, '"lija" encuentra pintura en paredes');
  await pint.click(); await cantidad.fill('120');
  await page.locator('section[aria-label="Agregá un trabajo"]').getByRole('button', { name: /^Agregar$/ }).click(); await page.waitForTimeout(2500);
  const av3 = (await aviso.textContent().catch(() => '')).trim();
  check(/^Agregado\. Faltan \d+ precios: .+/.test(av3), `pintura: "Agregado. Faltan N precios: …" (vino "${av3.slice(0, 80)}…")`);
  check(await page.getByText(/^Terminaciones$/).count() > 0, 'pintura: cae en el rubro "Terminaciones" (creado)');
  check(await punto(/Pintura en paredes/i).getAttribute('data-semaforo').catch(() => null) === 'rojo', 'pintura: punto rojo');
  check(/^Faltan \d+ precios$/.test(await punto(/Pintura en paredes/i).getAttribute('title').catch(() => '') || ''), 'punto rojo dice "Faltan N precios"');
  check(await focoEnBuscador(), 'el foco vuelve al buscador');
  await page.screenshot({ path: SHOTS + '/05_pintura_rojo.png' });

  // 4. rubro elegido en el árbol: el trabajo va ahí y no al de su fórmula
  await page.getByText('Albañileria', { exact: true }).first().click(); await page.waitForTimeout(500);
  check(await page.getByText(/el rubro elegido en el árbol/).count() > 0, 'con un rubro elegido, el renglón dice adónde va');
  await buscador.pressSequentially('pintura cieloraso', { delay: 20 }); await page.waitForTimeout(1200);
  await buscador.press('Enter'); await page.waitForTimeout(400);
  await cantidad.fill('15'); await cantidad.press('Enter'); await page.waitForTimeout(2500);
  check(/^Agregado/.test((await aviso.textContent().catch(() => '')).trim()), 'Enter en el buscador elige y Enter en la cantidad agrega');
  check(await fila(/cielorraso|cieloraso/i).count() > 0 && await fila(/hueco del 18/i).count() > 0, 'la pintura quedó en Albañilería (el rubro elegido)');
  await page.getByRole('button', { name: 'Que vaya al rubro de su fórmula' }).click();
  check(await page.getByText(/el rubro elegido en el árbol/).count() === 0, '"Que vaya al rubro de su fórmula" suelta el rubro');

  // 5. error visible
  await page.route('**/trabajos', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: { codigo: 'NO_SE_APLICO', mensaje: 'No se agregó el trabajo; quedó todo como estaba.' } }) }));
  await buscador.pressSequentially('hueco 12', { delay: 20 }); await page.waitForTimeout(1200);
  await buscador.press('Enter'); await page.waitForTimeout(300); await cantidad.fill('5'); await cantidad.press('Enter'); await page.waitForTimeout(1200);
  check(await page.getByRole('alert').filter({ hasText: /No se agregó el trabajo; quedó todo como estaba/ }).count() > 0, 'si el servidor falla, el error se ve');
  await page.screenshot({ path: SHOTS + '/06_error.png' });
  await page.unroute('**/trabajos');
  await page.getByRole('button', { name: /Cambiar/ }).click(); await page.waitForTimeout(200);
  check(await unidad.inputValue() === '' && await focoEnBuscador(), '"Cambiar" vuelve al buscador y suelta la unidad de la fórmula');
  await buscador.fill(''); await cantidad.fill('');

  // 6. el formulario sin fórmula sigue andando, con etiquetas en castellano
  await page.getByRole('button', { name: 'Agregar un trabajo sin fórmula (precio a mano)' }).click(); await page.waitForTimeout(300);
  for (const l of ['Código', 'Descripción', 'Unidad', 'Cantidad', 'Materiales por unidad', 'Mano de obra por unidad']) {
    check(await page.locator('label', { hasText: new RegExp(`^${l}`) }).count() > 0, `formulario sin fórmula: etiqueta "${l}"`);
  }
  const form = page.getByText('Trabajo sin fórmula (precio a mano)', { exact: true }).locator('../..');
  await form.getByLabel('Descripción').fill('Limpieza final de obra');
  await form.getByLabel('Cantidad').fill('1');
  await form.getByLabel('Materiales por unidad').fill('1000');
  await form.getByLabel('Mano de obra por unidad').fill('500');
  await page.screenshot({ path: SHOTS + '/07_sin_formula.png' });
  await form.getByRole('button', { name: /^Agregar$/ }).click(); await page.waitForTimeout(2500);
  check(await fila(/Limpieza final de obra/).count() > 0, 'formulario sin fórmula: el trabajo aparece en la tabla');
  check(await punto(/Limpieza final de obra/).getAttribute('data-semaforo').catch(() => null) === 'amarillo', 'precio a mano: punto amarillo');

  // 7. la consulta de faltantes falla: sin puntos (nunca verde sin saber)
  await page.route('**/precios-faltantes', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }));
  await page.reload(); await page.waitForTimeout(2500);
  check(await fila(/hueco del 18/i).count() > 0 && await page.locator('[data-semaforo]').count() === 0, 'consulta de faltantes caída: la tabla queda sin puntos');
  await page.unroute('**/precios-faltantes');

  // 8. pantallas: ancho 1280 y celular
  await page.reload(); await page.waitForTimeout(2500);
  await page.getByText('Terminaciones', { exact: true }).first().click(); await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/08_terminaciones.png' });
  await buscador.pressSequentially('revoque', { delay: 20 }); await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOTS + '/09_lista_abierta.png' });
  const m = await b.newPage({ viewport: { width: 400, height: 800 } });
  await m.goto(`${B}/app/budgets/${bud.id}/editor`); await m.waitForTimeout(2500);
  await m.screenshot({ path: SHOTS + '/10_celular.png', fullPage: true });
  await m.getByPlaceholder('hueco 18, contrapiso, pintura…').pressSequentially('hueco 18', { delay: 20 }); await m.waitForTimeout(1200);
  await m.screenshot({ path: SHOTS + '/11_celular_quizas.png', fullPage: true });
  console.log(`\n${ok} OK, ${bad} FALLAS`); await b.close(); if (bad) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
