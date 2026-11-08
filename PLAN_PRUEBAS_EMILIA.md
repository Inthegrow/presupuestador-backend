# Plan: lo que encontró Emilia el 19/10 (entrega 11)

> Fecha: 2026-10-19. Contrato para un solo PR. **Render: Manual Deploy SÍ** (cambia el servidor). **Migración 013** (una
> columna). Origen: reunión «Vemos App Terrac» (Carlos + Emilia, 54 min) y sus tres archivos. Ninguna prueba anduvo
> bien. Este plan convierte cada cosa que hizo Emilia en una prueba automática (`scripts/e2e_emilia.cjs`) que corre
> Claude antes de entregar, y dice qué se corrige para que pase.

## 0. Los archivos de Emilia (fuera del repo, en `EXCEL_DIR`)

| Archivo | Qué es | Qué hizo la app el 19/10 |
|---|---|---|
| `emilia_hoja1.xlsx` | 4 columnas (código, descripción, unidad, cantidad), solapa «Hoja1», títulos en la fila 1. Armado a partir de su «Prueba 3», como su primera prueba | Importar Excel: «Listo», 0 trabajos y un presupuesto vacío |
| `emilia_prueba3.xlsx` | Solapa «01_C&P», títulos de columna en la fila 8, trabajos desde la 9, códigos que Excel convirtió en fechas (1.1 → 1/1/2026), «3.1-1» con guion | Importar Excel: 280 renglones en $0 (los títulos de columna como un rubro); el editor no trajo nada |
| `emilia_modelo.xlsx` | El «modelo de presupuestación» de Terrac: 68 solapas, cómputo en «CYP», títulos de rubro en la columna A («4 -1 FUNDACIONES»), una hoja por trabajo con el código de la fórmula (4.1.1…), listas 00_Mat/MO/Eq/Sub | Importar Excel: creó una lista de 438 precios y 0 trabajos |
| `ginkgo.xlsx` | La obra de siempre | Anda (regresión) |

## 1. Las pruebas (cada una es un bloque de `e2e_emilia.cjs`)

| # | Lo que hizo Emilia | Tiene que pasar |
|---|---|---|
| E1 | Importar Excel con `emilia_hoja1` | **No se crea nada.** La pantalla dice: «Este Excel trae el cómputo sin precios. Para que la app lo calcule con las fórmulas, cargalo en Cargar obra» y un botón «Cargarlo en Cargar obra» que abre Cargar obra **con el archivo ya elegido** |
| E2 | Importar Excel con `emilia_prueba3` | Igual que E1 (cómputo sin precios) |
| E3 | Cargar obra con `emilia_hoja1` | Lee la solapa aunque no se llame 01_C&P: busca en las primeras 15 filas de cada solapa un renglón de títulos con Descripción y Cantidad (Código y Unidad opcionales, con o sin tilde, mayúsculas o no). Arma los trabajos desde el renglón siguiente |
| E4 | Cargar obra con `emilia_prueba3` | La fila «CODIGO / DESCRIPCIÓN…» no es un trabajo. Los códigos-fecha vuelven a ser 1.1, 1.2, 2.1 (día.mes). «3.1-1» se lee 3.1.1. «1- TAREAS PRELIMINARES» es el rubro 1 y «3.1- FUNDACIONES» el piso 3.1 |
| E5 | Cargar obra con un Excel sin precios | Los trabajos **sin fórmula y sin precio** no frenan la carga: cada tarjeta ofrece «Cargarlo sin precio ($0)» y arriba «Cargar los N sin fórmula en $0». Se carga y el editor los muestra en rojo con «Elegir fórmula» en el renglón |
| E6 | Cargar obra con `emilia_modelo` | Lee «CYP» (y «C&P», «01_C&P», «CYP E1»…): rubros con el título en la columna A («2- MOVIMIENTO DE SUELO», «4 -1 FUNDACIONES», «7-1 REVESTIMIENTO»). Renglones sin código («Replicar puntos…», «Dejar un item libre…») no son trabajos: van como aviso. **Un trabajo cuyo código es el de una fórmula y cuya descripción se le parece usa esa fórmula** (4.1.3 Bases aisladas → fórmula 4.1.3). Los precios que trae el archivo (00_Mat…) se ofrecen en «Precios para corregir» como hoy |
| E7 | Importar Excel con `emilia_modelo` | Arma los trabajos de «CYP» (mismas reglas de títulos que E6) con sus recursos de las hojas de detalle y la lista de sus 00_. Si un trabajo no tiene detalle ni precio, igual entra |
| E8 | Abrir el presupuesto recién importado | El editor muestra el nombre y los trabajos. **Si el servidor no contesta**, dice «No pude traer el presupuesto: {motivo}» con «Reintentar» (nunca «todavía no tiene trabajos» si no pudo leerlo). Igual para la lista de fórmulas: «No pude traer la lista de fórmulas» con «Reintentar» |
| E9 | Importar no traba el servidor | Mientras corre una importación grande, `/templates` contesta en menos de 3 s (el endpoint deja de bloquear: corre en un hilo y graba en tandas) |
| E10 | Nuevo presupuesto → Trabajos típicos | La lista sale del **modelo de Terrac** (`app/data/modelo_terrac.json`, armado de la hoja CYP de `emilia_modelo`): 1 Tareas preliminares, 2 Movimiento de suelo, 3 Demolición, 4 Estructura (4.1 Fundaciones…), 5 Albañilería… 9 Cubierta, con los mismos códigos. Cada trabajo con fórmula (4.1.3, 5.1.4…) **entra con su fórmula y sus precios**; los demás entran sin fórmula, en rojo, con «Elegir fórmula». La cantidad la pone Sol (por defecto vacía → 0, no 1) |
| E11 | Borrar un presupuesto de prueba | Admin y «Carga y edita» pueden borrar desde Mis presupuestos (tachito) y desde el editor (menú). **Doble verificación**: una ventana que pide escribir el nombre del presupuesto; recién ahí se habilita «Borrar para siempre» |
| E12 | Vista Piso de `emilia_prueba3` | Cada piso del Excel (3.1 Fundaciones, 3.2 Sobre planta baja…) aparece en la vista Piso con sus trabajos. Hoy dijo «sólo piso 7»: se reproduce y se corrige |
| E13 | Precio viejo (pregunta de Emilia, 06:02) | Cada empresa define «un precio es viejo después de N días» (por defecto 90) en Lista de precios. Un recurso con precio más viejo se marca en ámbar «Precio de hace N días» en el detalle del trabajo, en la lista de precios y como aviso en Exportar. No bloquea nada |
| E14 | Actualizar a precios de otra fecha (05:27) | Versiones → «Actualizar precios» sigue andando (guarda la versión, recalcula, cambia «Precios al…»). La Ayuda lo explica en una sección nueva «La fecha de los precios» |
| E15 | Entrar con clave | Si el sistema de claves rechaza, el mensaje dice la causa real: clave incorrecta, mail sin confirmar, demasiados intentos o sin conexión. Debajo: «Si entrás a SOLÉ con Google, tocá “Olvidé mi clave” para armarte una» |
| E16 | Regresión | Ginkgo por Cargar obra y por Importar Excel da lo mismo que hoy; los e2e de siempre con sus OK |

## 2. Servidor (`app/`, `tests/`, `migrations/`)

- `app/obra_import.py`:
  - `find_computo(wb)`: la solapa del cómputo, en este orden: `01_C&P`, `CYP`, `C&P`, nombres que empiezan con «01_C&P» o «CYP», y si no, la primera solapa con un renglón de títulos (Descripción + Cantidad) en las primeras 15 filas. Devuelve la solapa, la fila de títulos y las columnas (código, descripción, unidad, cantidad, y las de precio si están: E/J/N/Z del formato Terrac).
  - Títulos de rubro/piso: el texto puede estar en A o en B; acepta «1- X», «1 - X», «4 -1 X», «4-2 X», «3.1- X», «7 X». Un renglón sin código, sin cantidad útil y sin unidad cuyo texto no empieza con número es una nota (aviso), no un trabajo.
  - Códigos: fecha → «día.mes»; «3.1-1» → «3.1.1»; se salta la fila de títulos de columna.
  - `analyze`: si el código del trabajo es el de una fórmula y la descripción se le parece (la misma medida de parecido que ya usa «Quizás sea»), propone esa fórmula como verde/amarillo (regla «código del modelo»).
  - Trabajos sin fórmula y sin precio: nuevo estado de asignación `{"sin_precio": true}` (se cargan en $0, nota «Sin fórmula y sin precio: completalo»).
- `app/routers/obras.py`: acepta la asignación `sin_precio`; `analizar` devuelve `hoja` (qué solapa leyó) y `sin_formula_sin_precio` (cuántos).
- `app/routers/excel.py` `import-excel`:
  - usa `find_computo`; títulos como arriba; no inserta la fila de títulos de columna;
  - **si no hay cómputo** o **el cómputo no trae ningún precio** (E, J, N y Z en 0 en todos los trabajos) → 422 `{"codigo": "CARGAR_OBRA", "mensaje": …}` y **no crea** presupuesto ni lista;
  - pasa de `async def` a `def` (FastAPI lo corre en un hilo) y graba los trabajos en tandas de 100, resolviendo los padres por orden.
- Borrar presupuesto: `DELETE /budgets/{id}` con `require_editor` (admin y leader).
- `app/data/modelo_terrac.json` + `GET /modelo-terrac`: rubros, pisos y trabajos del modelo (código, descripción, unidad, `plantilla` = código de fórmula si existe en la empresa). `POST /budgets/create-full` acepta en cada trabajo `plantilla` (código de fórmula): el trabajo se crea con la fórmula aplicada y sus precios de la lista oficial (la misma función que usa `/trabajos`).
- Precio viejo: migración `013_precio_viejo.sql` (`indirect_config.precio_viejo_dias integer default 90`); `GET/PATCH` en el endpoint de configuración que ya existe; `precios-faltantes` suma `viejos` por trabajo; los recursos traen `precio_dias` (días desde `precio_fecha`).
- Tests (pytest): cada regla de títulos y códigos con planillas chicas armadas en el test; `find_computo` con las 4 formas; import-excel 422 sin precios y sin cómputo (no crea nada); `sin_precio` en cargar; `create-full` con `plantilla`; borrar con leader; precio viejo. `python3 -m pytest -q` todo verde; ruff sin errores nuevos.

## 3. Pantalla (`frontend/`, `scripts/`)

- `ImportExcel.tsx`: el 422 `CARGAR_OBRA` muestra la tarjeta de E1 con «Cargarlo en Cargar obra»; el archivo pasa a Cargar obra en memoria (`lib/archivoPendiente.ts`) y Cargar obra lo toma al abrir.
- `CargarObra.tsx`: «Cargarlo sin precio ($0)» por tarjeta y «Cargar los N sin fórmula en $0» arriba (E5); muestra «Leí la solapa «X»» cuando no es 01_C&P.
- `Editor.tsx`: error de carga con «Reintentar» (E8); la fila de un trabajo sin fórmula muestra «Elegir fórmula» que abre el buscador de fórmulas y la aplica.
- `AgregarTrabajo.tsx`: «No pude traer la lista de fórmulas» con «Reintentar».
- `NewProject.tsx` + `GenericTaskSelector.tsx`: Trabajos típicos desde `GET /modelo-terrac` (E10), con el código y una marca «con fórmula»; cantidad vacía por defecto.
- Borrar con doble verificación (E11): `components/ConfirmarBorrado.tsx` usado en Dashboard y en el menú del editor.
- Precio viejo (E13): campo en Lista de precios; chip ámbar en el detalle y en la lista; aviso en Exportar.
- `Login.tsx` (E15) y `Ayuda.tsx` (E14: «La fecha de los precios»; y en «Cargar obra» qué Excel acepta, con E3/E6).
- `scripts/e2e_emilia.cjs`: E1–E15 con los archivos de arriba (E9 con un tiempo medido; E8 cortando los pedidos con `page.route`). Más los e2e de siempre con sus OK.
- `node scripts/check_textos.cjs` en 0. `npm run build` pasa; tsc sin errores nuevos.

## 4. Fuera de este PR (anotado en el handoff)

- Entrar desde SOLÉ sin volver a poner la clave: es un cambio en el repo de SOLÉ (que el botón pase la sesión).
- Precio de una obra distinto al oficial (42:32): decisión de Carlos.
- Recordatorios a los jefes de obra para actualizar precios (14:18).
- Servidor que despierta: se va cuando Render pase a pago (decisión de Carlos).
