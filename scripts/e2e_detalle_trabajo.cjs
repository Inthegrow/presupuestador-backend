// Prueba de punta a punta del detalle de un trabajo armado a mano: buscador "Quizás sea", semáforo,
// "Ver cómo se calcula", conversión con el espesor del nombre y el semáforo cuando falla la consulta de precios.
// Corre contra vite (5179) + scripts/serve_fake.py (8000), con el servidor falso recién levantado.
// Uso: NODE_PATH=<node_modules con playwright> node scripts/e2e_detalle_trabajo.cjs
const path = require('path')
const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots-detalle')
require('fs').mkdirSync(SHOTS, { recursive: true })
const B = 'http://127.0.0.1:5179', API = 'http://127.0.0.1:8000';
let ok = 0, bad = 0;
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); c ? ok++ : bad++; };
const j = async (method, url, body) => (await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
(async () => {
  const cats = await j('GET', '/catalogs'); for (const c of (Array.isArray(cats) ? cats : cats.catalogs)) if (c.name.includes('Maestro')) await j('PATCH', `/catalogs/${c.id}`, { oficial: true });
  const bud = (await j('POST', '/budgets/create-full', { name: 'Prueba buscador' })).budget;
  await j('POST', `/budgets/${bud.id}/items`, [{ code: '1.1', description: 'Muro ladrillo hueco del 18', unidad: 'm2', cantidad: 40, sort_order: 1 }, { code: '1.2', description: 'Contrapiso e=8cm', unidad: 'm2', cantidad: 30, sort_order: 2 }, { code: '1.3', description: 'Pintura interior', unidad: 'm2', cantidad: 120, sort_order: 3 }]);
  const its = await j('GET', `/budgets/${bud.id}/items`); const by = Object.fromEntries((Array.isArray(its) ? its : its.items).map(i => [i.code, i.id]));
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  // 1. muro: rojo sin nada; Quizás sea propone 5.1.4
  await page.goto(`${B}/app/budgets/${bud.id}/item/${by['1.1']}`); await page.waitForTimeout(2000);
  check(await page.getByText('Falta resolver').count() > 0 && await page.getByText(/Sin fórmula: cargá una/).count() > 0, 'trabajo vacío: rojo "Sin fórmula…"');
  check(await page.getByText(/Materiales por m²/).count() > 0, 'tarjetas dicen "Materiales por m²"');
  await page.getByRole('button', { name: /Cargar fórmula/ }).click(); await page.waitForTimeout(1500);
  check(await page.getByText(/Quizás sea/).count() > 0, 'muestra "Quizás sea"');
  check(await page.getByText('Propuesta', { exact: true }).count() > 0, 'hay una propuesta');
  await page.screenshot({ path: SHOTS + '/21_quizas_sea.png' });
  // elegir la propuesta
  await page.locator('button', { has: page.getByText('Propuesta', { exact: true }) }).first().click(); await page.waitForTimeout(2500);
  check(await page.getByText('Listo', { exact: true }).count() > 0, 'después de aplicar: verde "Listo"');
  check(await page.getByText(/= Q/).count() === 0, 'no muestra la cuenta "= Q…" por defecto');
  await page.getByText(/Ver cómo se calcula/).first().click(); await page.waitForTimeout(500);
  check(await page.getByText(/= /).count() > 0 && await page.getByText(/Cantidad con desperdicio/i).count() > 0, '"Ver cómo se calcula" muestra la cuenta');
  await page.screenshot({ path: SHOTS + '/22_muro_listo.png', fullPage: true });
  await page.getByText(/Ocultar cómo se calcula/).first().click();
  // 2. contrapiso e=8cm: propuesta con factor 0,08
  await page.goto(`${B}/app/budgets/${bud.id}/item/${by['1.2']}`); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Cargar fórmula/ }).click(); await page.waitForTimeout(1500);
  await page.locator('button', { has: page.getByText('Propuesta', { exact: true }) }).first().click(); await page.waitForTimeout(1500);
  const v = await page.locator('input[inputmode="decimal"]').first().inputValue().catch(() => '');
  check(/^0[.,]08$/.test(v), `contrapiso e=8cm: pregunta con 0,08 (vino "${v}")`);
  await page.getByRole('button', { name: /^Aplicar$/ }).last().click(); await page.waitForTimeout(2000);
  // 3. pintura: buscar escribiendo, rojo por faltantes
  await page.goto(`${B}/app/budgets/${bud.id}/item/${by['1.3']}`); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Cargar fórmula/ }).click(); await page.waitForTimeout(1500);
  await page.getByPlaceholder(/Buscá como hablás/).fill('lija'); await page.waitForTimeout(500);
  const fila = page.getByRole('button', { name: /PINTURA EN PAREDES \(yeso, lija \+ 3 manos\)/ }).first();
  check(await fila.count() > 0, 'el buscador encuentra "lija" → pintura en paredes');
  await fila.click(); await page.waitForTimeout(2500);
  check(await page.getByText(/Faltan \d+ precios/).count() > 0, 'pintura: rojo "Faltan N precios"');
  await page.screenshot({ path: SHOTS + '/23_pintura_rojo.png' });
  // 5. la consulta de precios falla: nunca verde; Reintentar recupera los faltantes reales (Codex, PR #38)
  await page.route('**/precios-faltantes', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }));
  await page.goto(`${B}/app/budgets/${bud.id}/item/${by['1.1']}`); await page.waitForTimeout(2000);
  check(await page.getByText('Listo', { exact: true }).count() === 0 && await page.getByText('No pude revisar los precios').count() > 0,
    'muro con fórmula y la consulta caída: amarillo "No pude revisar los precios", no verde');
  await page.goto(`${B}/app/budgets/${bud.id}/item/${by['1.3']}`); await page.waitForTimeout(2000);
  check(await page.getByText('No pude revisar los precios').count() > 0 && await page.getByText(/Faltan \d+ precios/).count() === 0,
    'pintura con la consulta caída: amarillo, sin afirmar nada');
  await page.screenshot({ path: SHOTS + '/25_sin_verificar.png' });
  await page.unroute('**/precios-faltantes');
  await page.getByRole('button', { name: 'Reintentar' }).click(); await page.waitForTimeout(1500);
  check(await page.getByText(/Faltan \d+ precios/).count() > 0 && await page.getByText('No pude revisar los precios').count() === 0,
    'Reintentar: vuelve a rojo "Faltan N precios"');
  // 4. celular
  const m = await b.newPage({ viewport: { width: 400, height: 800 } });
  await m.goto(`${B}/app/budgets/${bud.id}/item/${by['1.1']}`); await m.waitForTimeout(2000);
  await m.screenshot({ path: SHOTS + '/24_celular.png' });
  console.log(`\n${ok} OK, ${bad} FALLAS`); await b.close(); if (bad) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
