#!/usr/bin/env node
// Control de textos visibles (PLAN_PALABRAS.md, entrega 7): busca palabras sin tilde y jerga en lo que ve Sol.
// Recorre frontend/src/**/*.tsx y *.ts (texto JSX, atributos visibles como title/placeholder/aria-label/label,
// strings dentro de setError/setMsg/confirm/alert/new Error(...), y valores de propiedades visibles como
// label/title/nombre/descripcion) y app/**/*.py (strings dentro de HTTPException(...)).
// Sin dependencias. Uso: node scripts/check_textos.cjs [--solo-frontend | --solo-app]
// Sale con 1 si hay hallazgos (archivo:línea + palabra). Para una excepción justificada, poner un comentario
// "textos-ok" en la misma línea o en la de arriba (// textos-ok, {/* textos-ok */} o # textos-ok).
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

// Palabras que en castellano llevan tilde: sin tilde son un error
const SIN_TILDE = [
  'analisis', 'codigo', 'codigos', 'descripcion', 'seccion', 'secciones', 'configuracion', 'calculo', 'calculos',
  'revision', 'version', 'informacion', 'duracion', 'logistica', 'automaticamente', 'valido', 'valida', 'podes',
  'subi', 'revisa', 'selecciona', 'albanileria', 'mamposteria', 'hormigon', 'numero', 'categoria', 'categorias',
  'parametro', 'parametros', 'unico', 'pagina', 'maximo', 'minimo', 'vacio', 'invalido', 'invalida', 'ultimo',
  'ultima', 'tambien', 'aqui', 'edicion', 'importacion', 'esta listo', 'yeseria', 'durleria', 'herreria',
  'carpinteria', 'zingueria', 'pintureria', 'demolicion', 'excavacion', 'aislacion', 'instalacion', 'nivelacion',
  'preparacion', 'sesion', 'electrica', 'electricas', 'basica', 'basico', 'tecnica', 'tecnico', 'periodo',
  'imagenes', 'dia', 'dias', 'mas', 'despues', 'asi', 'aca', 'ahi', 'ademas', 'todavia', 'facil', 'rapido',
  'proximo', 'proxima', 'area', 'areas', 'unica', 'unicos', 'tenes', 'queres', 'elegi', 'indice', 'linea', 'lineas',
  'metodo', 'generico', 'generica', 'genericas', 'genericos', 'automatico', 'automatica', 'estandar', 'grafico',
  'graficos', 'telefono', 'credito', 'economico', 'publico', 'perimetro', 'electrico', 'electricos', 'util',
  'utiles', 'despues', 'deposito', 'organizacion', 'contrasena', 'contrasenas', 'ano', 'anos', 'diseno', 'tamano',
  'pequeno', 'companero', 'compania', 'senal', 'dueno', 'espanol', 'senor', 'manana',
]
// Toda palabra terminada en -cion/-sion/-xion/-gion sin tilde (configuracion, version, conexion, region)
const SUFIJOS = [{ w: '…ción/…sión', re: /(?<![\p{L}\p{N}_])\p{L}*[csxg]ion(?![\p{L}\p{N}_])/giu, tipo: 'sin tilde' }]
// Jerga que Sol no usa (tabla 1.A del plan)
const JERGA = [
  'dashboard', 'click', 'inline', 'boq', 'qty', 'mat unit', 'mo unit', 'eq unit', 'sub unit', 'item', 'items',
  'ítem', 'ítems', 'sección', 'secciones', 'partida', 'partidas', 'neto total',
]

const L = '[\\p{L}\\p{N}_]'
const reWord = (w) => new RegExp(`(?<!${L})${w.replace(/ /g, '\\s+')}(?!${L})`, 'giu')
const REGLAS = [
  ...SIN_TILDE.map((w) => ({ w, re: reWord(w), tipo: 'sin tilde' })),
  ...JERGA.map((w) => ({ w, re: reWord(w), tipo: 'jerga' })),
  ...SUFIJOS,
]

// Atributos JSX que no se ven (todo otro atributo con string se revisa)
const ATTR_INVISIBLES = new Set([
  'className', 'class', 'style', 'key', 'to', 'href', 'src', 'type', 'id', 'name', 'htmlFor', 'role', 'value',
  'defaultValue', 'accept', 'autoComplete', 'inputMode', 'method', 'target', 'rel', 'd', 'viewBox', 'fill', 'stroke',
  'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'width', 'height', 'cx', 'cy', 'r', 'x', 'y', 'rx', 'ry',
  'x1', 'x2', 'y1', 'y2', 'points', 'transform', 'xmlns', 'pattern', 'step', 'min', 'max', 'form', 'lang', 'dir',
  'download', 'encType', 'sizes', 'media', 'path', 'element', 'mode', 'variant', 'size', 'color', 'icon', 'campo',
  'clave', 'modo', 'tipo', 'tab', 'vista', 'testId',
])
const esAttrVisible = (n) => !ATTR_INVISIBLES.has(n) && !n.startsWith('data-') && !/^on[A-Z]/.test(n)
// Llamadas cuyos strings se muestran
const LLAMADA_VISIBLE = /^(set(Error|Err|Msg|Mensaje|Aviso|Info|Ok|Exito|Status|Estado|Warning|Alerta|Nota|Toast)\w*|alert|confirm|prompt|toast\w*|avisar|Error)$/
// Propiedades de objetos cuyos strings se muestran
const PROP_VISIBLE = new Set([
  'label', 'title', 'titulo', 'subtitulo', 'description', 'descripcion', 'desc', 'hint', 'ayuda', 'help', 'mensaje',
  'message', 'msg', 'texto', 'text', 'placeholder', 'tooltip', 'detalle', 'aviso', 'error', 'nombre', 'name',
  'linea', 'cuando', 'que', 'accion', 'confirmar', 'vacio', 'etiqueta',
])

function lineStarts(src) {
  const ls = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') ls.push(i + 1)
  return ls
}
function lineOf(ls, idx) {
  let lo = 0, hi = ls.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ls[mid] <= idx) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

// ─── TS/TSX: un lexer chico que separa código, strings, templates y JSX ─────────────────────────
function candidatosTs(src, esTsx) {
  const out = [] // { start, text }
  let i = 0
  const n = src.length
  const isId = (c) => c !== undefined && /[\p{L}\p{N}_$]/u.test(c)

  // Last significant (non-space, non-comment) char and word before position p, looking at the source
  function prevSig(p) {
    let k = p - 1
    while (k >= 0 && /\s/.test(src[k])) k--
    if (k < 0) return { ch: '', word: '' }
    let word = ''
    if (isId(src[k])) {
      let s = k
      while (s > 0 && isId(src[s - 1])) s--
      word = src.slice(s, k + 1)
    }
    return { ch: src[k], word, at: k }
  }
  function nextSig(p) {
    let k = p
    while (k < n && /\s/.test(src[k])) k++
    return src.slice(k, k + 3)
  }

  function skipComment() {
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++
      return true
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      i = e < 0 ? n : e + 2
      return true
    }
    return false
  }

  function stringVisible(start, end, ctx, parens) {
    const prev = prevSig(start)
    const next = nextSig(end + 1)
    if (/^[=!]=/.test(next)) return false
    if (prev.ch === '=' && /[=!]=$/.test(src.slice(Math.max(0, prev.at - 2), prev.at + 1))) return false
    if (prev.ch === '[' || prev.word === 'case' || prev.word === 'import' || prev.word === 'from') return false
    if (/^\s*\]/.test(next) && prev.ch === '[') return false
    if (ctx.visible) return true
    if (parens.some((p) => LLAMADA_VISIBLE.test(p))) return true
    if (prev.ch === ':') {
      const before = prevSig(prev.at)
      if (before.word && PROP_VISIBLE.has(before.word) && before.at === prev.at - 1 - (src.slice(before.at + 1, prev.at).length)) return true
      if (before.word && PROP_VISIBLE.has(before.word)) return true
    }
    return false
  }

  function readString(q, ctx, parens) {
    const start = i + 1
    i++
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') i++
      else if (src[i] === '\n') break
      i++
    }
    const end = i
    i++
    if (stringVisible(start - 1, end, ctx, parens)) out.push({ start, text: src.slice(start, end) })
  }

  function readTemplate(ctx, parens) {
    const tplStart = i
    i++ // `
    let segStart = i
    const segs = []
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue }
      if (src[i] === '$' && src[i + 1] === '{') {
        segs.push({ start: segStart, text: src.slice(segStart, i) })
        i += 2
        parseJS(true, { visible: ctx.visible }, parens.slice())
        segStart = i
        continue
      }
      i++
    }
    segs.push({ start: segStart, text: src.slice(segStart, i) })
    const end = i
    i++
    if (stringVisible(tplStart, end, ctx, parens)) for (const s of segs) out.push(s)
  }

  function regexAllowed(p) {
    const prev = prevSig(p)
    if (!prev.ch) return true
    if (prev.word) return ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'else', 'do'].includes(prev.word)
    return '(,=:[!&|?{};+-*%<>~^'.includes(prev.ch)
  }
  function jsxAllowed(p) {
    if (!esTsx) return false
    const c = src[p + 1]
    if (!(c === '>' || /[A-Za-z]/.test(c || ''))) return false
    const prev = prevSig(p)
    if (!prev.ch) return true
    if (prev.word) return ['return', 'default', 'case', 'else', 'do', 'yield', 'await'].includes(prev.word)
    if (prev.ch === '>') return src[prev.at - 1] === '=' // arrow =>
    return '(,=:[!&|?{};'.includes(prev.ch)
  }
  function readRegex() {
    i++
    let inClass = false
    while (i < n) {
      const c = src[i]
      if (c === '\\') { i += 2; continue }
      if (c === '\n') break
      if (inClass) { if (c === ']') inClass = false }
      else if (c === '[') inClass = true
      else if (c === '/') { i++; break }
      i++
    }
    while (i < n && /[a-z]/.test(src[i])) i++
  }

  // Code until the matching } (when untilBrace) or end of file
  function parseJS(untilBrace, ctx, parens) {
    let depth = 0
    while (i < n) {
      const c = src[i]
      if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) { skipComment(); continue }
      if (c === '"' || c === "'") { readString(c, ctx, parens); continue }
      if (c === '`') { readTemplate(ctx, parens); continue }
      if (c === '/' && regexAllowed(i)) { readRegex(); continue }
      if (c === '<' && jsxAllowed(i)) { parseJSXElement(); continue }
      if (c === '{') { depth++; i++; continue }
      if (c === '}') {
        if (depth === 0 && untilBrace) { i++; return }
        depth--; i++; continue
      }
      if (c === '(') {
        const prev = prevSig(i)
        parens.push(prev.word || '')
        i++; continue
      }
      if (c === ')') { parens.pop(); i++; continue }
      i++
    }
  }

  function parseJSXElement() {
    i++ // <
    let name = ''
    while (i < n && /[A-Za-z0-9_.:-]/.test(src[i])) name += src[i++]
    if (src[i] === '<') {
      // type arguments: <Buscador<Formula, Sugerida> ...>
      let d = 0
      do {
        if (src[i] === '<') d++
        else if (src[i] === '>') d--
        i++
      } while (i < n && d > 0)
    }
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++
      if (i >= n) return
      if (src[i] === '/' && src[i + 1] === '>') { i += 2; return }
      if (src[i] === '>') { i++; parseJSXChildren(); return }
      if (src[i] === '{') { i++; parseJS(true, { visible: false }, []); continue }
      if (src[i] === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) { skipComment(); continue }
      let attr = ''
      while (i < n && /[A-Za-z0-9_:-]/.test(src[i])) attr += src[i++]
      if (!attr) { i++; continue }
      while (i < n && /\s/.test(src[i])) i++
      if (src[i] !== '=') continue
      i++
      while (i < n && /\s/.test(src[i])) i++
      const q = src[i]
      if (q === '"' || q === "'") {
        const start = i + 1
        const end = src.indexOf(q, start)
        i = end + 1
        if (esAttrVisible(attr)) out.push({ start, text: src.slice(start, end) })
      } else if (q === '{') {
        i++
        parseJS(true, { visible: esAttrVisible(attr) }, [])
      } else if (q === '<') {
        parseJSXElement()
      }
    }
  }

  function parseJSXChildren() {
    let textStart = i
    const flush = () => {
      const t = src.slice(textStart, i)
      if (t.trim()) out.push({ start: textStart, text: t })
    }
    while (i < n) {
      const c = src[i]
      if (c === '<') {
        flush()
        if (src[i + 1] === '/') {
          const e = src.indexOf('>', i)
          i = e < 0 ? n : e + 1
          return
        }
        parseJSXElement()
        textStart = i
        continue
      }
      if (c === '{') {
        flush()
        i++
        parseJS(true, { visible: true }, [])
        textStart = i
        continue
      }
      i++
    }
    flush()
  }

  parseJS(false, { visible: false }, [])
  return out
}

// ─── Python: strings dentro de HTTPException(...) ─────────────────────────────────────────────
function candidatosPy(src) {
  const out = []
  const re = /HTTPException\s*\(/g
  let m
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length
    let depth = 1
    while (i < src.length && depth > 0) {
      const c = src[i]
      if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue }
      const sm = /^([rRbBfFuU]{0,2})("""|'''|"|')/.exec(src.slice(i, i + 5))
      if (sm && (sm[1] === '' || /[\s(,=+]/.test(src[i - 1]))) {
        const pref = sm[1].toLowerCase()
        const q = sm[2]
        const start = i + sm[0].length
        let k = start
        while (k < src.length && src.slice(k, k + q.length) !== q) {
          if (src[k] === '\\') k++
          k++
        }
        let text = src.slice(start, k)
        if (pref.includes('f')) {
          // f-string: the {expressions} are code, not text (keep offsets by blanking them)
          text = text.replace(/\{\{|\}\}|\{[^{}]*\}/g, (x) => (x === '{{' || x === '}}' ? x : ' '.repeat(x.length)))
        }
        out.push({ start, text })
        i = k + q.length
        continue
      }
      if (c === '(') depth++
      else if (c === ')') depth--
      i++
    }
    re.lastIndex = i
  }
  return out
}

function revisar(file, src, cands, hallazgos) {
  const vistos = new Set()
  const ls = lineStarts(src)
  const lines = src.split('\n')
  for (const c of cands) {
    for (const r of REGLAS) {
      r.re.lastIndex = 0
      let m
      while ((m = r.re.exec(c.text))) {
        const line = lineOf(ls, c.start + m.index)
        const aca = lines[line - 1] || ''
        const arriba = lines[line - 2] || ''
        if (aca.includes('textos-ok') || arriba.includes('textos-ok')) continue
        const k = c.start + m.index
        if (vistos.has(k)) continue
        vistos.add(k)
        hallazgos.push({ file: path.relative(ROOT, file), line, w: m[0], tipo: r.tipo, frag: aca.trim().slice(0, 110) })
      }
    }
  }
}

function listar(dir, exts, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__pycache__' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) listar(p, exts, acc)
    else if (exts.some((x) => e.name.endsWith(x)) && !e.name.endsWith('.d.ts')) acc.push(p)
  }
  return acc
}

function main() {
  const args = process.argv.slice(2)
  const front = !args.includes('--solo-app')
  const back = !args.includes('--solo-frontend')
  const t0 = Date.now()
  const hallazgos = []
  let archivos = 0
  if (front) {
    for (const f of listar(path.join(ROOT, 'frontend', 'src'), ['.tsx', '.ts'])) {
      const src = fs.readFileSync(f, 'utf8')
      archivos++
      revisar(f, src, candidatosTs(src, f.endsWith('.tsx')), hallazgos)
    }
  }
  if (back) {
    for (const f of listar(path.join(ROOT, 'app'), ['.py'])) {
      const src = fs.readFileSync(f, 'utf8')
      archivos++
      revisar(f, src, candidatosPy(src), hallazgos)
    }
  }
  hallazgos.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))
  for (const h of hallazgos) console.log(`${h.file}:${h.line}: ${h.tipo} "${h.w}"  ${h.frag}`)
  const ms = Date.now() - t0
  const enFront = hallazgos.filter((h) => h.file.startsWith('frontend')).length
  console.log(`\n${hallazgos.length} hallazgos (frontend: ${enFront}, app: ${hallazgos.length - enFront}) en ${archivos} archivos, ${ms} ms`)
  process.exitCode = hallazgos.length ? 1 : 0
}

if (require.main === module) main()
module.exports = { candidatosTs, candidatosPy }
