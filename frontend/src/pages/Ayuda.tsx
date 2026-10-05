import type { ReactNode } from 'react'
import { CircleHelp } from 'lucide-react'

// Pantalla de ayuda: texto fijo, sin llamadas al servidor. Visible para todos los roles.

const SECCIONES = [
  { id: 'cargar-obra', titulo: 'Cargar una obra desde el Excel' },
  { id: 'colores', titulo: 'Qué quiere decir cada color' },
  { id: 'formula', titulo: 'Cómo encuentra la app la fórmula de cada trabajo' },
  { id: 'otro-formato', titulo: 'Si el Excel tiene otro formato' },
  { id: 'lista-precios', titulo: 'Lista de precios: cuál se usa' },
]

// El router puede interceptar el "#": scrollIntoView a mano, y el href queda como respaldo.
function irA(e: React.MouseEvent, id: string) {
  e.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function Seccion({ id, n, titulo, children }: { id: string; n: number; titulo: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 bg-white border border-gray-200 rounded-xl p-4 sm:p-5 mb-4">
      <h2 className="flex items-start gap-2.5 text-base font-bold text-[#143D34] mb-3">
        <span className="shrink-0 w-6 h-6 rounded-full bg-[#E8F5EE] text-[#2D8D68] text-xs font-bold flex items-center justify-center mt-px">{n}</span>
        <span>{titulo}</span>
      </h2>
      {children}
    </section>
  )
}

function Pasos({ children }: { children: ReactNode }) {
  return <ol className="list-decimal pl-5 space-y-2.5 text-sm text-gray-700 leading-relaxed marker:font-bold marker:text-[#2D8D68]">{children}</ol>
}

function Color({ chip, texto, children }: { chip: string; texto: string; children: ReactNode }) {
  return (
    <li className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3">
      <span className={`self-start shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${chip}`}>{texto}</span>
      <span className="text-sm text-gray-700 leading-relaxed">{children}</span>
    </li>
  )
}

export default function Ayuda() {
  return (
    <div className="p-4 sm:p-6 fade-in max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <CircleHelp size={14} /> AYUDA
      </div>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <h1 className="text-xl font-extrabold text-gray-900">AYUDA</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6 pl-4">Cómo se usa la app, paso a paso.</p>

      {/* Índice */}
      <nav aria-label="Índice" className="bg-[#F0FAF5] border border-[#CFE8DB] rounded-xl p-4 mb-6">
        <div className="text-[10px] font-bold text-[#2D8D68] tracking-wider mb-2">EN ESTA PÁGINA</div>
        <ol className="space-y-1.5 text-sm">
          {SECCIONES.map((s, i) => (
            <li key={s.id} className="flex gap-2">
              <span className="text-gray-400 w-4 shrink-0">{i + 1}.</span>
              <a href={`#${s.id}`} onClick={(e) => irA(e, s.id)} className="text-[#1B5E4B] hover:underline">{s.titulo}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Seccion id="cargar-obra" n={1} titulo="Cargar una obra desde el Excel">
        <Pasos>
          <li>
            <b>Entrar a Cargar obra.</b> Desde SOLÉ: Crecer → Presupuestador → Abrir el Presupuestador, con el mismo mail
            y clave de SOLÉ. En el menú de la izquierda, Cargar obra.
          </li>
          <li>
            <b>Arrastrar el Excel de la obra.</b> El de siempre, el que tiene la hoja 01_C&amp;P. No hay que agregarle
            nada. Si se recarga la página, la app ofrece seguir donde quedaste.
          </li>
          <li>
            <b>Leer el resumen.</b> Cuántos trabajos hay, cuántos listos (verde), para confirmar (amarillo) y en rojo.
          </li>
          <li>
            <b>Resolver los precios.</b> En el panel "Precios para corregir", tocar "Guardar los precios que trae el
            Excel". Para un material que no se cotiza, "Va en $0". Para los demás, escribir el precio sin IVA y "Guardar".
          </li>
          <li>
            <b>Mirar las tarjetas rojas que queden.</b> Si hay una pregunta, responderla. Si la fórmula no es la
            correcta, "Cambiar". Si no hay fórmula y el trabajo se cobra con el precio del Excel, "Confirmar".
          </li>
          <li>
            <b>Los amarillos, si hay tiempo.</b> Confirmarlos deja todo verde, pero no hace falta para cargar.
          </li>
          <li>
            <b>Poner el nombre y Cargar presupuesto.</b> Si quedan materiales sin precio, marcar "Cargar igual": esos
            materiales quedan en $0 y después se completan en Lista de precios. Puede tardar un minuto.
          </li>
          <li>
            <b>Ver diferencias con el Excel.</b> Arranca en costo directo: ahí se ven las fórmulas. "Precio final" suma
            el margen de cada uno. Si el Excel no traía precios, no hay con qué comparar.
          </li>
        </Pasos>
      </Seccion>

      <Seccion id="colores" n={2} titulo="Qué quiere decir cada color">
        <ul className="space-y-3">
          <Color chip="bg-[#E8F5EE] text-[#2D8D68]" texto="Verde · Listo">
            La app encontró la fórmula y todos los precios. No hay que hacer nada.
          </Color>
          <Color chip="bg-amber-50 text-amber-700" texto="Amarillo · Para confirmar">
            La app no está segura (sin fórmula, o una duda escrita en el Maestro). Se puede cargar igual.
          </Color>
          <Color chip="bg-red-50 text-red-600" texto="Rojo · Falta resolver">
            Falta un precio, una conversión o una fórmula. Hay que resolverlo, o marcar "Cargar igual" si es solo un precio.
          </Color>
        </ul>
      </Seccion>

      <Seccion id="formula" n={3} titulo="Cómo encuentra la app la fórmula de cada trabajo">
        <p className="text-sm text-gray-700 mb-3">Prueba tres cosas, en este orden:</p>
        <Pasos>
          <li>
            <b>Lo que ya se eligió antes.</b> Si en otra obra se eligió una fórmula para un trabajo con el mismo nombre
            y la misma unidad, usa esa.
          </li>
          <li>
            <b>Las reglas por nombre.</b> Busca palabras en el nombre del trabajo (por ejemplo, "hueco del 18" → fórmula
            5.1.4 Ladrillo cerámico hueco del 18). Si el trabajo dice un espesor ("e=10cm"), lo usa para pasar de m³ a m².
          </li>
          <li>
            <b>Las parecidas.</b> Si ninguna regla aplica, muestra "Quizás sea…" con las fórmulas de nombre más
            parecido. Esas nunca se ponen solas: hay que elegirlas.
          </li>
        </Pasos>
        <p className="text-sm text-gray-700 leading-relaxed mt-3">
          Las fórmulas salen del Maestro y se pueden ver y corregir en <b>Fórmulas</b>. Una corrección vale para las
          obras que se carguen después; las ya cargadas no cambian.
        </p>
      </Seccion>

      <Seccion id="otro-formato" n={4} titulo="Si el Excel tiene otro formato">
        <p className="text-sm text-gray-700 leading-relaxed">
          Cargar obra lee la hoja <b>01_C&amp;P</b> con el formato de Terrac: código en la columna A, descripción en B,
          unidad en C y cantidad en D, desde la fila 8. Si el Excel no tiene esa hoja, la app avisa y no carga nada. Si
          tiene la hoja pero con otras columnas, los trabajos salen mal: conviene pasar las cantidades a la planilla de
          Terrac. Los precios (columnas E, J, N y Z) no son obligatorios: si no están, la app calcula todo con las
          fórmulas y la lista de precios.
        </p>
      </Seccion>

      <Seccion id="lista-precios" n={5} titulo="Lista de precios: cuál se usa">
        <p className="text-sm text-gray-700 leading-relaxed">
          La app calcula con la lista <b>oficial</b>. Las demás son para consultar. Si un material tiene varios precios,
          usa el que estaba vigente a la fecha "precios al" del presupuesto (o el de hoy). Un precio en $0 solo vale si
          tiene fecha: si no, el material cuenta como sin precio. Importar dos veces el mismo Excel actualiza su lista;
          no crea otra.
        </p>
      </Seccion>
    </div>
  )
}
