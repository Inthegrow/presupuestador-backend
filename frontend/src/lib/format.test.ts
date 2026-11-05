// Pruebas de la regla única del costo por unidad (PR 53, auditorías de Codex).
// Correr: npm test   (node --test, sin dependencias: Node ≥ 22.6 lee TypeScript)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cuentaPorUnidad, fmtUnitario, unitarioRedondeado } from './format.ts'

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

test('unitarioRedondeado', () => {
  assert.equal(unitarioRedondeado(0.001), false)
  assert.equal(unitarioRedondeado(0.0123), false)
  assert.equal(unitarioRedondeado(1 / 3_000_000), true)
  assert.equal(unitarioRedondeado(100), false)
  assert.equal(unitarioRedondeado(493143.54), true)
  assert.equal(unitarioRedondeado(0), false)
})
