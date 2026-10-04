// Prueba del login multiempresa en el navegador, contra vite (5179) + scripts/serve_fake.py
// levantado con FAKE_DOS_EMPRESAS=1 (usuario con dos empresas: TERRAC SA como leader y Obra Demo como admin).
// Uso: EXCEL_DIR=<carpeta> NODE_PATH=<node_modules con playwright> node scripts/e2e_login.cjs
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const S = process.env.EXCEL_DIR || path.join(__dirname, 'excel')
const BASE = 'http://127.0.0.1:5179'
const shots = path.join(S, 'shots-login')
fs.mkdirSync(shots, { recursive: true })

async function shot(page, name) {
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true })
  console.log('shot', name)
}

;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/CERT/.test(m.text())) console.log('CONSOLE', m.text()) })

  // 1. Login y "olvidé mi clave"
  await page.goto(BASE + '/login')
  await page.getByText('Olvidé mi clave').waitFor()
  await shot(page, '01_login')
  await page.getByText('Olvidé mi clave').click()
  await page.waitForURL(/olvide-mi-clave/)
  await shot(page, '02_olvide_mi_clave')
  await page.goto(BASE + '/nueva-clave?invite=1')
  // Sin sesión de recuperación de Supabase la página dice que el enlace no sirve: es lo esperado
  await page.getByText(/Creá tu clave|El enlace ya no sirve/).waitFor()
  await shot(page, '03_crea_tu_clave')

  // 2. Dos empresas: selector
  await page.goto(BASE + '/app/dashboard')
  await page.getByText('¿Con qué empresa entrás?').waitFor({ timeout: 30000 })
  const texto = await page.locator('body').innerText()
  console.log('selector:', texto.includes('TERRAC SA'), texto.includes('Obra Demo'), texto.includes('Carga y edita'), texto.includes('Administra'))
  await shot(page, '04_elegir_empresa')
  await page.getByText('TERRAC SA').first().click()
  await page.waitForURL(/dashboard/)
  await page.getByLabel('Cambiar de empresa').waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)
  await shot(page, '05_dashboard_terrac')
  const top = await page.locator('header').innerText()
  console.log('topbar:', top.replace(/\n/g, ' | '))

  // 3. Como leader en TERRAC: Catálogos sin "Marcar como oficial" (solo admin)
  await page.goto(BASE + '/app/catalogs')
  await page.getByText('Maestro TERRAC - Materiales').waitFor({ timeout: 30000 })
  console.log('botones oficial (leader, debe ser 0):', await page.getByRole('button', { name: /Marcar como oficial|Dejar solo para consulta/ }).count())
  await shot(page, '06_catalogos_leader')

  // 4. Cambiar a Obra Demo (admin) desde la barra
  await page.getByLabel('Cambiar de empresa').selectOption({ label: 'Obra Demo' })
  await page.waitForURL(/dashboard/)
  await page.waitForTimeout(1200)
  const top2 = await page.locator('header').innerText()
  console.log('topbar demo:', top2.replace(/\n/g, ' | '))
  await shot(page, '07_dashboard_obra_demo')
  const header = await page.evaluate(() => sessionStorage.getItem('presu_org_actual'))
  console.log('X-Org-Id de esta pestaña:', header)

  // 5. Dos pestañas (Codex, PR #27): cambiar de empresa en una NO cambia los pedidos de la otra
  const ctx = context
  const tab1 = await ctx.newPage()
  await tab1.goto(BASE + '/app/dashboard')
  await tab1.getByLabel('Cambiar de empresa').waitFor({ timeout: 30000 })
  await tab1.getByLabel('Cambiar de empresa').selectOption({ label: 'TERRAC SA' })
  await tab1.waitForTimeout(1200)
  const tab2 = await ctx.newPage()
  await tab2.goto(BASE + '/app/dashboard')
  await tab2.getByLabel('Cambiar de empresa').waitFor({ timeout: 30000 })
  await tab2.getByLabel('Cambiar de empresa').selectOption({ label: 'Obra Demo' })
  await tab2.waitForTimeout(1200)
  console.log('pestaña 2 en:', await tab2.getByLabel('Cambiar de empresa').inputValue())
  const enviados = []
  tab1.on('request', (r) => { if (r.url().includes('/api/')) enviados.push(r.headers()['x-org-id']) })
  await tab1.getByRole('link', { name: 'Catalogos' }).click()
  await tab1.getByText('Maestro TERRAC - Materiales').waitFor({ timeout: 30000 })
  const soloTerrac = enviados.length > 0 && enviados.every((h) => h === 'test-org-uuid')
  console.log('pestaña 1 sigue pidiendo como TERRAC:', soloTerrac, enviados.slice(0, 3))
  await tab1.reload()
  await tab1.getByLabel('Cambiar de empresa').waitFor({ timeout: 30000 })
  console.log('pestaña 1 tras recargar:', await tab1.getByLabel('Cambiar de empresa').inputValue(), '(debe seguir test-org-uuid)')
  await tab1.screenshot({ path: path.join(shots, '08_dos_pestanas_tab1_terrac.png') })
  await tab2.screenshot({ path: path.join(shots, '08_dos_pestanas_tab2_demo.png') })
  if (!soloTerrac) { console.error('FALLA: una pestaña mandó pedidos con la empresa de la otra'); process.exitCode = 1 }

  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
