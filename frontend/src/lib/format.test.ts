// Pruebas de la regla única del costo por unidad (PR 53, auditorías de Codex).
// Correr: npm test   (node --test, sin dependencias: Node ≥ 22.6 lee TypeScript)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cuentaPorUnidad, fmtCantidad, fmtUnitario, unitarioRedondeado } from './format.ts'

const sinEspacios = (s: string) => s.replace(/\s/g, ' ')

test('un costo por unidad que cuesta nunca se lee $0', () => {
  for (const [total, cantidad] of [[1, 1000], [123, 10000], [1, 3_000_000], [1, 3000], [0.01, 1e9]]) {
    const unitario = total / cantidad
    const texto = fmtUnitario(unitario)
    assert.notEqual(Number(texto.replace('$', '').replace(/\./g, '').replace(',', '.')), 0, `${total}/${cantidad}: ${texto}`)
  }
  assert.equal(fmtUnitario(1 / 1000), '$0,001')
  assert.equal(fmtUnitario(123 / 10000), '$0,0123')
  assert.equal(fmtUnitario(1 / 3_000_000), '$0,000000333') // Codex, ronda e0085dd
  assert.equal(fmtUnitario(0), '$0')
})

test('"=" solo cuando total, cantidad y costo por unidad que se leen son exactos', () => {
  const exactos: Array<[number, number, string]> = [
    [1, 1000, '$0,001'],
    [123, 10000, '$0,0123'], // Codex, ronda 80a8813
    [3500, 35, '$ 100'],
  ]
  for (const [total, cantidad, unitario] of exactos) {
    const c = cuentaPorUnidad(total, cantidad)
    assert.equal(c.signo, '=', `${total}/${cantidad}`)
    assert.equal(sinEspacios(c.unitario), unitario)
  }
})

test('"≈" cuando alguno de los tres está redondeado', () => {
  // Bases aisladas: $17.260.023,89 ÷ 35 = $493.143,5397… → se lee $493.144
  const bases = cuentaPorUnidad(17260023.89, 35)
  assert.equal(bases.signo, '≈')
  assert.equal(sinEspacios(bases.total), '$ 17.260.023,89')
  // $1 ÷ 3.000.000: se lee $0,000000333, que es redondeado
  assert.equal(cuentaPorUnidad(1, 3_000_000).signo, '≈')
  // $1 ÷ 3000 = $0,000333…
  assert.equal(cuentaPorUnidad(1, 3000).signo, '≈')
})

test('la cantidad se lee con sus decimales: 0,004 no es 0,00', () => {
  // Codex, ronda e0085dd: antes se leía "$1 ÷ 0,00 = $250"
  const c = cuentaPorUnidad(1, 0.004)
  assert.equal(c.cantidad, '0,004')
  assert.equal(sinEspacios(c.unitario), '$ 250')
  assert.equal(c.signo, '=') // 1 ÷ 0,004 = 250 exacto, y los tres se leen exactos
  // Más de 6 decimales: la cantidad que se lee está redondeada → "≈"
  const larga = cuentaPorUnidad(1, 0.0040001)
  assert.equal(larga.signo, '≈')
  assert.equal(cuentaPorUnidad(100, 35).cantidad, '35,00')
})

test('importes grandes: un centavo de diferencia ya no es "="', () => {
  // Codex, ronda 618f467: «$1.000.000.000,10 ÷ 1,00 = $1.000.000.000»
  const c = cuentaPorUnidad(1_000_000_000.1, 1)
  assert.equal(c.signo, '≈')
  assert.equal(sinEspacios(c.total), '$ 1.000.000.000,10')
  assert.equal(cuentaPorUnidad(1_000_000_000, 1).signo, '=')
  assert.equal(cuentaPorUnidad(999_999_999.99, 3).signo, '≈')
})

test('una cantidad positiva nunca se lee 0', () => {
  // Codex, ronda 618f467: «$1 ÷ 0,00 ≈ $10.000.000» con cantidad 0,0000001
  const c = cuentaPorUnidad(1, 0.0000001)
  assert.equal(c.cantidad, '0,0000001')
  assert.equal(sinEspacios(c.unitario), '$ 10.000.000')
  assert.equal(c.signo, '=')
  assert.equal(cuentaPorUnidad(1, 1.234567e-9).cantidad, '0,00000000123457')
  assert.equal(cuentaPorUnidad(1, 1.234567e-9).signo, '≈')
})

// Comprobación independiente, en fracciones exactas (BigInt) — no usa el código que prueba.
// Lo que se lee: "$ 1.234,5" → [12345n, 10n]
function leer(s: string): [bigint, bigint] {
  const [entera, frac = ''] = s.replace(/[$\s.]/g, '').split(',')
  return [BigInt(entera + frac), 10n ** BigInt(frac.length)]
}
// Un número de JS, por su forma más corta: 1e-7 → [1n, 10000000n]
function real(x: number): [bigint, bigint] {
  const [m, e = '0'] = String(x).split('e')
  const [entera, frac = ''] = m.split('.')
  const d = frac.length - Number(e)
  const n = BigInt(entera + frac)
  return d >= 0 ? [n, 10n ** BigInt(d)] : [n * 10n ** BigInt(-d), 1n]
}
const mismaFraccion = ([a, b]: [bigint, bigint], [c, d]: [bigint, bigint]) => a * d === c * b
const esCero = ([a]: [bigint, bigint]) => a === 0n

test('con miles de casos al azar: "=" siempre es una cuenta cierta, y nada positivo se lee 0', () => {
  let semilla = 7
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647)
  const totales = [0.01, 1, 123, 3500, 17260023.89, 1_000_000_000.1, 10_000_000_000_000.01, 1e15 + 0.5]
  const cantidades = [1e-7, 0.004, 0.5, 1, 3, 35, 1000, 10000, 3_000_000]
  const casos: Array<[number, number]> = []
  for (const t of totales) for (const q of cantidades) casos.push([t, q])
  for (let i = 0; i < 5000; i++) {
    const t = Math.round(azar() * 10 ** Math.floor(azar() * 16)) / 100 // $0,00 … $10 billones
    const q = Number((azar() * 10 ** (Math.floor(azar() * 12) - 6)).toPrecision(1 + Math.floor(azar() * 8)))
    if (q > 0) casos.push([t, q])
  }
  for (const [total, cantidad] of casos) {
    const c = cuentaPorUnidad(total, cantidad)
    const [lt, lq, lu] = [leer(c.total), leer(c.cantidad), leer(c.unitario)]
    assert.ok(!esCero(lq), `cantidad ${cantidad} se lee ${c.cantidad}`)
    if (total > 0) assert.ok(!esCero(lu), `${total} ÷ ${cantidad}: unitario se lee ${c.unitario}`)
    if (c.signo === '=') {
      // total = cantidad × unitario, con los números que se leen, y la cantidad que se lee es la real
      assert.ok(mismaFraccion(lt, [lq[0] * lu[0], lq[1] * lu[1]]),
        `"${c.total} ÷ ${c.cantidad} = ${c.unitario}" no es cierto`)
      assert.ok(mismaFraccion(lq, real(cantidad)), `cantidad ${cantidad} se lee ${c.cantidad} con "="`)
    }
  }
})

test('importes de billones: «=» solo si la cuenta que se lee es cierta', () => {
  // Codex, ronda 43fc0fa: «$10.000.000.000.000,01 ÷ 1,00 = $10.000.000.000.000»
  assert.equal(cuentaPorUnidad(10_000_000_000_000.01, 1).signo, '≈')
  assert.equal(cuentaPorUnidad(10_000_000_000_000, 1).signo, '=')
  assert.equal(cuentaPorUnidad(10_000_000_000_000.5, 2).signo, '≈')
})

test('unitarioRedondeado', () => {
  assert.equal(unitarioRedondeado(0.001), false)
  assert.equal(unitarioRedondeado(0.0123), false)
  assert.equal(unitarioRedondeado(1 / 3_000_000), true)
  assert.equal(unitarioRedondeado(100), false)
  assert.equal(unitarioRedondeado(493143.54), true)
  assert.equal(unitarioRedondeado(0), false)
})

test('fmtCantidad: ninguna cantidad positiva se lee 0 ni se redondea a entero', () => {
  assert.equal(fmtCantidad(35), '35')
  assert.equal(fmtCantidad(35, 2), '35,00')
  assert.equal(fmtCantidad(2.5), '2,5') // la columna «Cant.» del editor lo mostraba 3
  assert.equal(fmtCantidad(0.004), '0,004') // y esto, 0
  assert.equal(fmtCantidad(0.0000001, 2), '0,0000001')
  assert.equal(fmtCantidad(0), '0')
})
