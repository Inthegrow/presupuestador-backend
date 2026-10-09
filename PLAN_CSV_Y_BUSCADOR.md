# Plan: subir una lista de precios en .csv, y el buscador de precios fácil de usar y de probar (entrega 10)

> Fecha: 2026-10-08. Contrato para un solo PR. **Render: Manual Deploy SÍ** (cambia el servidor). Sin migración.

## 1. Qué cambia, para Sol

### A. Subir una lista en .csv (Lista de precios → "Subir un archivo (.csv)")

Hoy no anda nunca, por tres cosas:
- la pantalla manda el archivo como si fuera el nombre;
- lo manda a una dirección que no existe (`/catalogs/upload` en vez de `/catalogs/upload-csv`);
- manda el tipo y el nombre de una forma que el servidor no lee.

Además, el Excel en castellano guarda los .csv **con ";"**, y el servidor solo entiende ",".

Después del arreglo:
- **Se aceptan los .csv con ";", con "," o con tabulador.** Las columnas pueden venir con o sin tildes y en mayúsculas o minúsculas:

  | Columna | Nombres que acepta | ¿Obligatoria? |
  |---|---|---|
  | código | código / codigo / cod | sí |
  | descripción | descripción / descripcion / detalle | no |
  | unidad | unidad / u / unid | no |
  | precio | precio_unitario / precio / precio sin iva / precio unitario | sí |
  | fecha | fecha | no |
  | proveedor | proveedor | no |

- **Los precios se leen como los escribe Sol:** "$ 1.234,50", "1234.5" o "1.234".
- **El nombre de la lista es opcional.** Si no se escribe, va el nombre del archivo, que la pantalla propone apenas se elige el archivo.
- **Al terminar**, la pantalla dice "Se cargaron N precios en «Nombre»". Si hubo renglones salteados, dice cuántos y por qué, por ejemplo "3 renglones sin código o sin precio, no se cargaron". Abre la lista nueva y recuerda: "Para que la app calcule con esta lista, marcala como oficial".
- **Un ejemplo para bajar:** junto al formulario, el botón "Bajar un ejemplo (.csv)" baja un archivo con las columnas y dos renglones, armado en el navegador.
- **Si el archivo no tiene las columnas obligatorias**, el mensaje dice cuáles faltan y cuáles tiene, en palabras.

### B. El buscador de precios en internet: dónde está, cómo se usa y si anda

- **Saber si anda, sin buscar nada.** El servidor dice si el buscador está configurado (`GET /precios/buscador`: configurado sí o no y el modelo; nunca la clave).
  - En **Lista de precios**, junto a "Buscar un precio", se muestra el estado: "Buscador listo" o "El buscador no está configurado: falta la clave de OpenAI en el servidor".
  - Al abrir el panel del buscador sin configurar, se avisa antes de buscar.
- **Errores que dicen qué pasa.** Si OpenAI rechaza la clave, la pantalla dice "La clave de OpenAI del servidor no es válida". Si se terminó el crédito o hay demasiados pedidos, dice "Se terminó el crédito de OpenAI o hay demasiados pedidos: probá más tarde". Si tarda, dice "La búsqueda tardó más de un minuto". El detalle técnico va al registro del servidor.
- **Que funcione con la API real.**
  - Si OpenAI no acepta el pedido tal como va, la búsqueda se reintenta en este orden: sin las fuentes detalladas, con la herramienta de búsqueda anterior (`web_search_preview`) y sin el formato estricto (el texto se lee como JSON con el lector que ya existe).
  - Cada reintento queda en el registro. El anti-invento sigue: solo opciones con un link que vino de la búsqueda.
- **Ayuda nueva**, sección "Buscar un precio en internet", con:
  - dónde están los botones: Lista de precios → "Buscar un precio" arriba y "Buscar en internet" en cada renglón; detalle de un trabajo → recurso en rojo → "Buscar en internet";
  - qué hace: busca en corralones y ferreterías, pasa a sin IVA y a la unidad de la lista, y muestra la cuenta y el link;
  - qué guarda: precio, comercio, fecha y link, que se ven en el origen y en el historial;
  - que son precios de venta al público;
  - qué hacer si dice que no está configurado.

## 2. Servidor
- `app/routers/catalogs.py` `upload-csv`:
  - `tipo` y `name` se aceptan por la URL o en el formulario;
  - el separador se detecta solo (",", ";" o tabulador);
  - los encabezados se normalizan sin tildes y con los alias de arriba;
  - el precio se lee con "$" y espacios;
  - la respuesta trae `entradas`, `salteadas` y `warnings`.
- Tests:
  - ";" con encabezados con tildes;
  - "$ 1.234,50";
  - tipo y nombre en el formulario;
  - faltan columnas, con el mensaje claro;
  - renglones salteados contados;
  - los tests de siempre siguen pasando.
- `app/price_search.py` y `app/routers/precios.py`:
  - `GET /precios/buscador` (cualquier usuario de la empresa): `{configurado, modelo}`;
  - errores de OpenAI por tipo (clave, crédito o límite, tiempo, otro) con su mensaje;
  - los reintentos de arriba.
- Tests con el cliente falso, sin red: cada error, cada reintento y el estado.
- `python3 -m pytest -q` todo verde. `ruff` sin errores nuevos. `check_textos` en 0.

## 3. Pantalla
- `lib/api.ts`:
  - `catalogApi.uploadCsv(file, {nombre?, tipo})` a `/catalogs/upload-csv`;
  - `preciosApi.estado()`.
- `pages/Catalogs.tsx`:
  - formulario del .csv con el nombre propuesto desde el archivo y el texto de las columnas aceptadas;
  - "Bajar un ejemplo (.csv)";
  - resultado con cantidad, salteadas y el aviso de oficial;
  - estado del buscador junto a "Buscar un precio".
- `components/BuscarPrecio.tsx`: el aviso de no configurado al abrir.
- `pages/Ayuda.tsx`: la sección nueva.
- e2e nuevo `scripts/e2e_csv_buscador.cjs`:
  1. subir un .csv con ";", tildes y "$ 1.234,50" → la lista nueva con sus precios bien leídos y el mensaje;
  2. un .csv sin columna de precio → el error dice qué falta;
  3. "Bajar un ejemplo" baja un .csv con las columnas;
  4. el estado del buscador se ve: con `FAKE_BUSCADOR=1` dice listo y sin eso dice no configurado;
  5. la Ayuda tiene la sección nueva;
  6. en el celular (390 px) nada se sale.
- Los e2e de siempre con sus OK. `npm run build` pasa; tsc sin errores nuevos. Se arregla además el error viejo de Catalogs:28.
