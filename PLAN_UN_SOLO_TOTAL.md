# Plan: un solo total en toda la app (entrega 5) + Fórmulas con el botón arriba

> Fecha: 2026-10-06. Contrato para un solo PR. **Render: Manual Deploy SÍ** (cambia el servidor).
> Origen: auditoría de "armar un presupuesto a mano" (https://claude.ai/artifact/3KfqizZ6HkfNGqtUmSpDiL), entrega 5.
> Y el pedido de Carlos del 05/10, que repitió el 06/10: "por qué está al final cargar una nueva fórmula" → botón arriba.

## 1. Qué cambia, para Sol

### A. Un solo total

<!-- TOTALES -->

### B. Pantalla Fórmulas

| Hoy | Después |
|---|---|
| "Nueva fórmula" es un recuadro punteado **al final de la lista**: con cientos de fórmulas hay que bajar hasta el fondo para encontrarlo. | Botón verde **"+ Nueva fórmula"** arriba a la derecha, al lado del título, siempre a la vista (la cabecera queda fija al bajar). El recuadro del final se va. |
| No hay buscador: para encontrar "cielorraso aplicado" hay que tocar el rubro y mirar una por una. | Buscador arriba de los rubros: **"Buscá una fórmula: nombre, rubro o número (ej. 6.11)"**. Mismo criterio que el buscador del detalle: todas las palabras, en cualquier orden, sin tildes. Se combina con el rubro elegido. Debajo: "12 de 340 fórmulas". Si no hay ninguna: "Ninguna fórmula dice «…». Probá con otra palabra o creá una nueva" con el botón. |
| El número de la fórmula (6.8, 5.1.4) no se ve; solo aparece escondido en la descripción ("solapa 6.8"). El cuestionario de Emilia y Sol habla por número. | El número va **chico y gris** delante del nombre (principio "palabras, no códigos": el nombre manda). Las fórmulas se ordenan por número dentro de cada rubro (6.1, 6.2 … 6.10, 6.11; no 6.1, 6.10, 6.11, 6.2). |
| La ventana de crear/editar dice "Nueva plantilla" / "Editar plantilla" (palabra vieja). Un recurso dice "de la plantilla". | "Nueva fórmula" / "Editar fórmula" / "de la fórmula". |
| Al crear una fórmula, aparece al final de la lista, quizás escondida por el filtro. | Al guardar una nueva: si el filtro o la búsqueda la esconden, se limpian; la lista baja hasta ella y queda resaltada un momento ("Fórmula creada"). Si había un rubro elegido, la ventana nueva arranca con ese rubro en "Categoría". |

## 2. Servidor

<!-- SERVIDOR -->

## 3. Pantalla (`frontend/src/`)

- `pages/Templates.tsx`: cabecera fija con título, contador y botón "+ Nueva fórmula" (solo si `puedeEditar`; quien
  solo mira no lo ve); buscador (reusar `sinTildes` y el criterio de "todas las palabras" de
  `components/ui/BuscadorFormulas.tsx`: moverlo a `lib/` si hace falta, no copiarlo); número chico y gris; orden por
  número natural; resaltado al crear; categoría inicial. Sacar el recuadro punteado del final. El vacío sin filtro
  ("No hay fórmulas cargadas") ofrece el mismo botón.
- `components/ui/TemplateEditor.tsx`: textos "fórmula" (título y `ORIGEN_LABEL.plantilla`); acepta una categoría
  inicial.
- En celular (400 px) la cabecera no se rompe: el botón pasa abajo del título a lo ancho.
