# Plan: el asistente de "Nuevo Presupuesto" no rompe ni pisa nada (entrega 3)

> Fecha: 2026-10-06. Contrato para un solo PR. **Render: Manual Deploy SÍ** solo si se toca el servidor (ver 2).
> Origen: auditoría de "armar un presupuesto a mano" (https://claude.ai/artifact/3KfqizZ6HkfNGqtUmSpDiL), fricciones
> B-3, B-7, B-8 y B-11. Las tres formas de empezar (Cargar obra, Nuevo Presupuesto, Importar Excel) quedan como están.
> "Subir plano (IA)" e "Importar JSON" se mantienen.

## 1. Qué cambia, para Sol

| Hoy | Después |
|---|---|
| Paso 2 "Precios": 4 tarjetas (Subir CSVs, Subir Excel, Lista existente, Cargar después). Elegir una lista **no hace nada** (el servidor contesta 404 y la pantalla se lo calla); subir crea listas nuevas para toda la empresa. | El paso **desaparece**. En el paso de datos, una línea gris: "Precios: se usa la lista oficial **{nombre}** (precios al {fecha de hoy})." Si no hay lista oficial: "Todavía no hay lista oficial: los materiales van a quedar sin precio hasta que marques una en Lista de precios." (con enlace). Subir listas sigue estando en Lista de precios. |
| Paso "Indirectos" arranca siempre en 15/8/5/3/10 (fijos en la pantalla), pisa los de la empresa y **no guarda el beneficio** (20% queda en 10%). Muestra "Total sobre costo directo 41%", que suma porcentajes que van en cascada. | Arranca con **los de la empresa** (los de Cadena de Markups). Muestra todos los conceptos de la cascada: Imprevistos, Estructura, Jefatura, Logística, Herramientas, Beneficio, Ingresos Brutos, Impuesto al cheque e IVA. Lo que Sol cambie vale **solo para este presupuesto** y se guarda todo, beneficio incluido. Sin el "Total 41%": en su lugar, "Precio final por cada $100 de costo directo: $X" calculado con la misma cascada que usa la app. |
| Los trabajos quedan **sueltos** en el árbol, al mismo nivel que los rubros (el asistente espera un id que el servidor no devuelve). | El asistente crea todo con `POST /budgets/create-full` (que ya existe y arma rubros con sus trabajos adentro): cada trabajo queda dentro de su rubro. |
| Volver atrás borra lo tildado (el contrapiso desapareció del presupuesto sin aviso). | Lo tildado y las cantidades se conservan al ir y volver entre pasos. |
| Superficie y duración se piden y no se guardan. | Se guardan en el presupuesto (`create-full` ya los acepta) — o, si el presupuesto no tiene dónde guardarlos, se sacan del paso. Decide el agente leyendo el modelo; lo dice en el informe. |
| Los errores se tragan (la pantalla sigue como si nada). | Un error se muestra en rojo arriba del botón, con lo que dijo el servidor, y no se avanza. |

## 2. Servidor
- Usar lo que ya hay: `POST /budgets/create-full` (`CreateFullBudget` en `app/schemas.py`: `secciones`, `indirectos`,
  `superficie_m2`, `duracion_meses`) y `GET` de los indirectos generales de la empresa (el que usa Cadena de Markups).
  Verificar que `create-full` guarda **todos** los conceptos de `indirectos` que mande la pantalla, beneficio incluido;
  si alguno se pierde, arreglarlo con un test.
- La lista oficial: si ya hay un endpoint que la devuelve (Lista de precios la marca), usarlo; si no, la pantalla la saca
  del listado de listas (`oficial: true`). No hace falta endpoint nuevo.
- Si no se toca el servidor, el PR dice "Render: Manual Deploy NO".
- Tests (si se toca): `create-full` con secciones deja los trabajos con `parent_id` de su rubro; guarda beneficio e
  indirectos distintos de los de la empresa sin cambiar los de la empresa. `python3 -m pytest -q` todo verde (hoy 643
  passed, 14 skipped); `ruff check` sin errores nuevos.

## 3. Pantalla (`frontend/src/pages/NewProject.tsx`, `components/ui/GenericTaskSelector.tsx`, `lib/api.ts`)
- Sacar el paso Precios (y su estado/código muerto). Los pasos quedan: Datos → Estructura → Indirectos → Resultado.
- Línea de precios en Datos (punto 1).
- Indirectos: cargar los de la empresa al entrar; mostrar los nueve conceptos con sus valores; enviar todo en `indirectos`
  de `create-full`; "Precio final por cada $100 de costo directo" con la cascada (reusar la función de cascada que ya
  exista en la pantalla, p. ej. la de Cadena de Markups o del Editor; no inventar otra cuenta).
- Crear el presupuesto con `create-full` (`secciones: [{nombre, items: [{descripcion, unidad, cantidad}]}]` o lo que pida
  `SeccionInput`), no con `POST /budgets` + `/sections` + `/items` sueltos. "Definir manual", "Subir plano (IA)" e
  "Importar JSON" que hoy arman ítems también pasan por `create-full` si arman rubros; si alguno no encaja, decirlo.
- `GenericTaskSelector` recibe la selección y las cantidades desde afuera (controlado), así no se pierden al volver.
- Errores visibles (punto 1). Tildes en todos los textos de los pasos que se tocan.
- e2e nuevo `scripts/e2e_nuevo_presupuesto.cjs` (patrón de `scripts/e2e_detalle_trabajo.cjs`): crear un presupuesto con
  5 trabajos en 2 rubros, ir y volver entre pasos (lo tildado sigue), cambiar el beneficio a 20%, crear; verificar por la
  API que cada trabajo tiene `parent_id` de su rubro y que el presupuesto guardó beneficio 20 y los demás conceptos; y que
  los indirectos generales de la empresa no cambiaron.
- `npm run build` pasa; tsc con sus 13 errores viejos, ninguno nuevo.

## 4. Fuera de este PR
Agregar trabajo en un renglón del editor y que "Nuevo Presupuesto" vaya directo al editor (4), un solo total (5),
exportar (6), coherencia y tildes del resto (7), celular (8).
