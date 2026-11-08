import type { ReactNode } from 'react'
import { CircleHelp } from 'lucide-react'

// Pantalla de ayuda: texto fijo, sin llamadas al servidor. Visible para todos los roles.

const SECCIONES = [
  { id: 'cargar-obra', titulo: 'Cargar una obra desde el Excel' },
  { id: 'colores', titulo: 'Qué quiere decir cada color' },
  { id: 'formula', titulo: 'Cómo encuentra la app la fórmula de cada trabajo' },
  { id: 'otro-formato', titulo: 'Qué Excel acepta Cargar obra' },
  { id: 'lista-precios', titulo: 'Lista de precios: cuál se usa' },
  { id: 'fecha-precios', titulo: 'La fecha de los precios' },
  { id: 'buscar-precio', titulo: 'Buscar un precio en internet' },
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
        <ol className="space-y-1.5 max-md:space-y-0 text-sm">
          {SECCIONES.map((s, i) => (
            <li key={s.id} className="flex items-baseline gap-2">
              <span className="text-gray-400 w-4 shrink-0">{i + 1}.</span>
              <a href={`#${s.id}`} onClick={(e) => irA(e, s.id)} className="text-[#1B5E4B] hover:underline max-md:inline-block max-md:py-2">{s.titulo}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Seccion id="cargar-obra" n={1} titulo="Cargar una obra desde el Excel">
        <Pasos>
          <li>
            <b>Entrar a Cargar obra.</b> Desde SOLÉ: Crecer → Presupuestador → Abrir el Presupuestador, con el mismo mail
            y clave de SOLÉ. En el menú de la izquierda (en el celular, ☰), Cargar obra.
          </li>
          <li>
            <b>Arrastrar el Excel de la obra.</b> El de siempre, con la hoja 01_C&amp;P o CYP, o cualquier planilla con
            las columnas Descripción y Cantidad (más abajo, en «Qué Excel acepta Cargar obra»). No hay que agregarle
            nada. Si se recarga la página, la app ofrece seguir donde quedaste. Si probaste primero en Importar Excel y
            el Excel no trae precios, el botón «Cargarlo en Cargar obra» lo trae acá ya elegido.
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
            correcta, "Cambiar". Si no hay fórmula y el trabajo se cobra con el precio del Excel, "Confirmar". Si no
            tiene fórmula ni precio, "Elegir fórmula" o "Cargarlo sin precio ($0)" (arriba, "Cargar los N sin fórmula
            en $0" los carga a todos): entran en rojo y en el presupuesto cada uno tiene "Elegir fórmula".
          </li>
          <li>
            <b>Los amarillos, si hay tiempo.</b> Confirmarlos deja todo verde, pero no hace falta para cargar.
          </li>
          <li>
            <b>Poner el nombre y Cargar presupuesto.</b> Si quedan materiales sin precio, marcar "Cargar igual": esos
            materiales quedan en $0 y después se completan en Lista de precios. Puede tardar un minuto.
          </li>
          <li>
            <b>Ver diferencias con el Excel.</b> Arranca en costo directo: ahí se ven las fórmulas. "Al nivel del Excel"
            compara la app hasta donde llega tu Excel (por ejemplo, hasta los indirectos), sin sumarle el beneficio ni
            los impuestos que el Excel no tiene. Si el Excel no traía precios, no hay con qué comparar.
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

      <Seccion id="otro-formato" n={4} titulo="Qué Excel acepta Cargar obra">
        <ul className="list-disc pl-5 space-y-2.5 text-sm text-gray-700 leading-relaxed marker:text-[#2D8D68]">
          <li>
            <b>La hoja del cómputo.</b> Busca, en este orden, la hoja 01_C&amp;P, CYP o C&amp;P (también «01_C&amp;P obra»
            o «CYP E1»). Si no hay ninguna, usa la primera hoja que tenga en sus primeras 15 filas un renglón de títulos
            con <b>Descripción</b> y <b>Cantidad</b>; <b>Código</b> y <b>Unidad</b> son opcionales, con o sin tilde,
            en mayúsculas o no. Arriba de las tarjetas dice qué solapa leyó.
          </li>
          <li>
            <b>Los códigos.</b> Si Excel convirtió un código en fecha (1.1 → 1/1/2026), vuelve a ser 1.1. «3.1-1» se
            lee 3.1.1. Un trabajo cuyo código es el de una fórmula y cuyo nombre se le parece usa esa fórmula
            (4.1.3 Bases aisladas → fórmula 4.1.3).
          </li>
          <li>
            <b>Los títulos de rubro y de piso.</b> Un renglón como «1- TAREAS PRELIMINARES», «4 -1 FUNDACIONES» o
            «3.1- FUNDACIONES», en la columna A o en la B, es un rubro o un piso, no un trabajo. Un renglón sin código,
            sin cantidad y sin unidad («Replicar puntos…») es una nota: aparece como aviso.
          </li>
          <li>
            <b>Los precios no son obligatorios.</b> Si el Excel trae precios (columnas E, J, N y Z del formato de
            Terrac), se comparan con los de la app. Si no, la app calcula todo con las fórmulas y la lista de precios.
            Un Excel sin precios no se puede copiar con Importar Excel: va por Cargar obra.
          </li>
        </ul>
      </Seccion>

      <Seccion id="lista-precios" n={5} titulo="Lista de precios: cuál se usa">
        <p className="text-sm text-gray-700 leading-relaxed">
          La app calcula con la lista <b>oficial</b>. Las demás son para consultar. Si un material tiene varios precios,
          usa el que estaba vigente a la fecha "precios al" del presupuesto (o el de hoy). Un precio en $0 solo vale si
          tiene fecha: si no, el material cuenta como sin precio. Importar dos veces el mismo Excel actualiza su lista;
          no crea otra.
        </p>
      </Seccion>

      <Seccion id="fecha-precios" n={6} titulo="La fecha de los precios">
        <Pasos>
          <li>
            <b>Un presupuesto es una foto.</b> Guarda los precios del día en que se creó (dice «Precios al …»). Si
            después cambia un precio en la Lista de precios, el presupuesto no cambia solo: así no se mueve un número
            que ya le pasaste al cliente.
          </li>
          <li>
            <b>Traer los precios de hoy.</b> En el presupuesto, Versiones → «Actualizar a precios de hoy». La app guarda antes
            una versión con los precios viejos, recalcula todo con los de la lista y cambia la fecha de «Precios al».
            Si algo sale distinto, la versión anterior queda para comparar.
          </li>
          <li>
            <b>Precio viejo.</b> En Lista de precios se elige después de cuántos días un precio es viejo (por defecto,
            90). Los más viejos se marcan en ámbar, «Precio de hace N días», en la lista, en el detalle de cada trabajo
            y al exportar. No frena nada: es un aviso para actualizarlos.
          </li>
        </Pasos>
      </Seccion>

      <Seccion id="buscar-precio" n={7} titulo="Buscar un precio en internet">
        <Pasos>
          <li>
            <b>Dónde están los botones.</b> En <b>Lista de precios</b>: "Buscar un precio", arriba, para uno que todavía
            no está en la lista, y el botón del globo con la lupa ("Buscar en internet") en cada renglón, para
            actualizarlo. En el detalle de un trabajo: el recurso que está en rojo, sin precio, tiene "Buscar en
            internet".
          </li>
          <li>
            <b>Qué hace.</b> Busca el material en corralones y ferreterías, pasa cada precio a sin IVA y a la unidad de
            la lista (por ejemplo, de bolsa de 50 kg a bolsa de 25 kg) y muestra la cuenta y el link de donde salió.
            Si la unidad no coincide, avisa y deja corregir el número. Puede tardar hasta un minuto.
          </li>
          <li>
            <b>Qué guarda.</b> Nada, hasta tocar "Usar este precio". Entonces guarda el precio, el comercio, la fecha y
            el link, que se ven en el origen del precio y en su historial (el reloj de cada renglón).
          </li>
          <li>
            <b>Son precios de venta al público.</b> Un corralón que vende por volumen suele cobrar menos: sirven de
            referencia o para un material que no está en la lista.
          </li>
          <li>
            <b>Si dice "Buscador sin configurar".</b> Junto a "Buscar un precio" se ve si el buscador está listo. Si no
            lo está, falta la clave de OpenAI en el servidor (Render): la agrega quien administra la app. Mientras
            tanto, el precio se carga a mano en la lista y el resto de la app funciona igual. Si dice que la clave no
            es válida o que se terminó el crédito, también lo resuelve quien administra la app.
          </li>
        </Pasos>
      </Seccion>
    </div>
  )
}
