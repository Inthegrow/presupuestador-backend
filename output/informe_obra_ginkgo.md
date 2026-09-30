# Fase 5: cómputo de la obra contra el Maestro

Archivo: `EDIFICIO GINKGO_Computo y Presupuesto_V2.xlsx` (hoja `01_C&P`). Título de la hoja: "EDIFICIO LAS HERAS".

## Resumen

- **5 rubros**, **30 subrubros** (pisos o partes de la estructura) y **244 ítems**.
- Total neto del Excel: **$2.154.836.047**.
- **163 ítems con receta** del Maestro: el sistema calcula el precio con las cantidades.
- **81 ítems sin receta**: se cargan con el precio del Excel ($610.137.379, 28% del total).

| Rubro | Ítems | Con receta | Total neto Excel |
|---|---:|---:|---:|
| 1 TAREAS PRELIMINARES | 9 | 0 | $53.988.168 |
| 2 EXCAVACIONES | 2 | 0 | $11.194.372 |
| 3 ESTRUCTURA DE HOMIGÓN ARMADO | 23 | 5 | $97.633.588 |
| 4 ALBAÑILERIA | 135 | 114 | $1.308.108.321 |
| 5 TERMINACIONES | 75 | 44 | $683.911.598 |

Ojo: 3 ítems con receta están en $0 en el Excel (3.1.1, 3.1.2, 3.1.3): ahí la comparación no sirve.

## Ítems sin receta en el Maestro

Agrupados por tarea (la misma tarea se repite en varios pisos).

| Tarea | Veces | Total neto Excel | Receta más parecida |
|---|---:|---:|---|
| ARISTAS DE YESO EN PAREDES (4.2.4.2, 4.3.4.2, 4.4.4.2, 4.5.4.2…) | 6 | $111.411.036 | no hay receta de aristas de yeso |
| REVESTIMIENTO TEXTURADO EXTERIOR MEDIANO EN FACHADA (5.9.2) | 1 | $100.391.186 | no hay receta de revestimiento texturado |
| REVESTIMIENTO TEXTURADO EXTERIOR MEDIANO EN FACHADA CON SILLETA (5.9.1) | 1 | $99.437.969 | no hay receta de revestimiento texturado |
| EJECUCION DE REVESTIMIENTO TEXTURADO FINO EN INTERIOR Y MEDIANO EN EXTERIOR EN P (5.1.2) | 1 | $46.044.361 | no hay receta de revestimiento texturado |
| GARDEN BLOCK. EN ESTACIONAMIENTO. INCLUYE COLOCACION DE LADRILLO SOBRE CAMA DE A (4.1.10) | 1 | $39.153.633 | no hay receta parecida en el Maestro |
| ESCALERA DE HORMIGON ARMADO EN NUCLEO VERTICAL. 16 ESCALONES h3m (3.11.1) | 1 | $35.382.798 | 4.2.6 escaleras (gl): no está claro si es por tramo o completa |
| COLOCACION DE PUERTAS (4.1.12, 4.2.13, 4.3.13, 4.4.13…) | 9 | $23.176.440 | 7.3.1 es solo el premarco, no la colocación |
| MORIBLOCK INTERTRABADO EN ACCESO. INCLUYE COLOCACION DE LADRILLO SOBRE CAMA DE A (4.1.9) | 1 | $18.797.696 | no hay receta parecida en el Maestro |
| EJECUCION DE REVESTIMIENTO TEXTURADO FINO EN PAREDES EN PALIER (5.2.7, 5.3.7, 5.4.7, 5.5.7…) | 6 | $17.582.738 | no hay receta de revestimiento texturado |
| ESMALTE EN PUERTAS DE INTERIOR (5.1.4, 5.2.10, 5.3.10, 5.4.10…) | 7 | $13.297.680 | no hay receta parecida en el Maestro |
| EJECUCION DE VEREDAS EN CON TERMINACION EN HORMIGON ESCOBEDO. NO INCLUYE DEMOLIC (4.1.11) | 1 | $12.421.695 | no hay receta parecida en el Maestro |
| REVESTIMIENTO TEXTURADO EXTERIOR MEDIANO EN PAREDES (5.8.2) | 1 | $11.974.707 | no hay receta de revestimiento texturado |
| AYUDA DE GREMIOS (PLOMERIA / AA / ELECTRICIDAD) (1.6) | 1 | $11.588.220 | 1.6 (sin solapa en el Maestro) |
| PERFILADO DE EXCAVACIÓN DE BASES Y TRONCOS 2mx2m (2.1) | 1 | $10.603.600 | rubro 2 (sin solapa en el Maestro) |
| LIMPIEZA PERIODICA DE OBRA (1.4) | 1 | $9.694.720 | 1.4 (sin solapa en el Maestro) |
| PROGRAMA + TECNICO SEGURIDAD E HIGIENTE (1.5) | 1 | $8.482.880 | 1.12 (sin solapa en el Maestro) |
| BANOS QUIMICOS (3) (1.2) | 1 | $5.816.832 | 1.2 (sin solapa en el Maestro) |
| ESCALERA DE HORMIGON ARMADO ENTRE PISO 7 Y SALA DE MAQUINAS (3.11.2) | 1 | $5.408.969 | 4.2.6 escaleras (gl): no está claro si es por tramo o completa |
| DEFENSAS REGLAMENTARIAS (1.8) | 1 | $4.771.620 | no hay receta parecida en el Maestro |
| ESMALTE EN BARANDAS DE BALCONES (5.2.9, 5.3.9, 5.4.9, 5.5.9…) | 6 | $4.537.296 | no hay receta parecida en el Maestro |
| CERCO DE OBRA (1.9) | 1 | $4.317.876 | 1.10 (sin solapa en el Maestro) |
| OBRADOR (1.1) | 1 | $3.256.820 | 1.1 (sin solapa en el Maestro) |
| BARNIZ EN PUERTAS DE ACCESO A DEPARTAMENTOS (5.2.11, 5.3.11, 5.4.11, 5.5.11…) | 6 | $3.062.168 | no hay receta parecida en el Maestro |
| INSTALACIONES PROVISORIAS (1.3) | 1 | $3.029.600 | 1.3 (sin solapa en el Maestro) |
| LIMPIEZA FINAL (1.7) | 1 | $3.029.600 | 1.7 (sin solapa en el Maestro) |
| PINTURA CON MEMBRANA LIQUIDA SOBRE ROLLO DE MEMBRANA GEOTEXTIL (3 MANOS) (4.9.4, 4.9.10, 4.10.8) | 3 | $2.874.468 | no hay receta de membrana líquida |
| EXCAVACION TENSORES - INCLUYE EXCAVACIÓN + PERFILADO MANUAL + CARGA + RETIRO. (2.2) | 1 | $590.772 | rubro 2 (sin solapa en el Maestro) |
| ESTRUCTURA EN HORMIGON ARMADO. LOSA, VIGAS Y COLUMNAS (3.2.1, 3.3.1, 3.4.1, 3.5.1…) | 9 | $0 | 4.2.1 losas / 4.2.2 columnas / 4.2.3 vigas, en m³: falta separar el m² en volúmenes |
| VIGAS (balcon: viga de borde semi-invertida/ % extra) (3.2.2, 3.3.2, 3.4.2, 3.5.2…) | 7 | $0 | 4.2.3 vigas, en m³: falta la sección de la viga |
| ESMALTE EN ESCALERA COMPLETA (5.9.3) | 1 | $0 | no hay receta parecida en el Maestro |
| ESMALTE EN FRENTE INTEGRADO (5.9.4) | 1 | $0 | no hay receta parecida en el Maestro |

## Ítems con receta

| Tarea | Veces | Receta | Qué revisar |
|---|---:|---|---|
| BASES AISLADAS 2,5m x 2,5m. | 1 | 4.1.3 | 1 m³ por base: en la solapa 3.1-1 de la obra son 35 m³ para 35 bases, llenadas junto con los troncos. |
| TRONCOS 80 cm x 40 cm h 1m. | 1 | 4.1.4 | 0,80 × 0,40 × 1 m = 0,32 m³ por tronco. En la obra el hormigón de los troncos va con las bases: revisar que no se cuente dos veces. |
| TENSORES 20 cm x 40 cm. | 1 | 4.1.7 | 0,20 × 0,40 = 0,08 m³ por ml. |
| TABIQUE DE HORMIGON ARMADO EN PLANTA BAJA e 16cm. 17,6m2 | 1 | 4.2.4 | 17,6 m² × 0,16 m = 2,816 m³ por tramo. |
| TABIQUE DE HORMIGON ARMADO EN NUCLEO DE ESCALERA e 16cm. 42m2 | 1 | 4.2.4 | 42 m² × 0,16 m = 6,72 m³ por tramo. |
| MURO DIVISORIO. MAMPOSTERIA EN LADRILLO HUECO DEL 18. h 4,4m | 1 | 5.1.4 |  |
| MURO MEDIANERO. MAMPOSTERIA EN LADRILLO HUECO DEL 12. h 3m | 1 | 5.1.5 |  |
| MURO DIVISORIO INTERIOR. MAMPOSTERIA EN LADRILLO HUECO DEL 12. h 4,4m | 1 | 5.1.5 |  |
| REVOQUE INTERIOR | 2 | 5.5.4 | ¿Lleva también fino interior (5.5.2)? |
| REVOQUE EXTERIOR CON HIDROFUGO EN PAREDES Y COLUMNAS | 1 | 5.5.3 |  |
| CONTRAPISO EN HALL + RAMPAS. ESP.=10cm. | 1 | 5.2.3 | Contrapiso de cascote de 10 cm: 0,10 m³ por m². |
| CARPETA . ESP.=4cm | 1 | 5.4.1 | La receta no tiene espesor: es la misma para 3 y 4 cm. |
| COLOCACION DE REVESTIMIENTOS EN PISOS DE HALL Y RAMPA. PORCELANATO 120 | 1 | 7.1.1 | No incluye el porcelanato: queda como material que compra el cliente. |
| MURO DE MAMPOSTERIA EN LADRILLO HUECO DEL 18. h 3m | 8 | 5.1.4 |  |
| MURO DIVISORIO DE UNIDADES . MAMPOSTERIA EN LADRILLO HUECO DEL 12. h 3 | 5 | 5.1.5 |  |
| MURO DIVISORIO DE AMBIENTES. MAMPOSTERIA EN LADRILLO HUECO DEL 8. h 3m | 5 | 5.1.6 |  |
| YESO PROYECTADO EN PAREDES INTERIORES | 6 | 5.5.5 |  |
| REVOQUE INTERIOR GRUESO FRATAZADO + HIDROFUGO EN AMBIENTES HUMEDOS | 5 | 5.5.4 | La receta de grueso interior no lleva hidrófugo. |
| REVOQUE EXTERIOR CON HIDROFUGO CON SILLETA | 8 | 5.5.3 | La silleta no está en la receta: el Excel de la obra cobra este ítem bastante más caro. |
| REVOQUE EXTERIOR CON HIDROFUGO | 8 | 5.5.3 |  |
| CONTRAPISO e=10cm | 6 | 5.2.3 | Contrapiso de cascote de 10 cm: 0,10 m³ por m². |
| CARPETA . e=3cm | 6 | 5.4.1 | La receta no tiene espesor: es la misma para 3 y 4 cm. |
| CONTRAPISO/CARPETA EN BALCONES e=4cm | 6 | 5.4.1 | En el Excel de la obra lleva el precio de la carpeta. ¿Va con hidrófugo (5.4.2)? |
| COLOCACION DE REVESTIMIENTOS EN PISOS PORCELANATO 1,20X60. NO INCLUYE  | 6 | 7.1.1 | No incluye el porcelanato: queda como material que compra el cliente. |
| COLOCACION DE REVESTIMIENTOS EN PAREDES. (EN BAÑOS) h=2,40m. 1,20X60.  | 7 | 7.1.5 | No incluye el porcelanato: queda como material que compra el cliente. |
| COLOCACION DE REVESTIMIENTOS EN PAREDES. (EN COCINA Y LAVADEROS) h=1,5 | 6 | 7.1.5 | No incluye el porcelanato: queda como material que compra el cliente. |
| MURO DIVISORIO DE UNIDADES. MAMPOSTERIA EN LADRILLO HUECO DEL 12. h 3m | 1 | 5.1.5 |  |
| MURO DIVISORIO DE AMBIENTES MAMPOSTERIA EN LADRILLO HUECO DEL 8. h 3m | 1 | 5.1.6 |  |
| REVOQUE GRUESO FRATAZADO + HIDROFUGO EN AMBIENTES HUMEDOS | 2 | 5.5.4 | La receta de grueso interior no lleva hidrófugo. |
| MURO DIVISORIO. MAMPOSTERIA EN LADRILLO HUECO DEL 12. h 3m | 1 | 5.1.5 |  |
| MURO DIVISORIO. MAMPOSTERIA EN LADRILLO HUECO DEL 8. h 3m | 1 | 5.1.6 |  |
| MURO DE CARGA. MAMPOSTERIA EN LADRILLO HUECO DEL 18. h 0.2m/1.8m | 2 | 5.1.4 | Muro de carga: ¿es hueco del 18 (5.1.4) o portante del 18 (5.1.1)? |
| CONTRAPISO EN INTERIOR e: 10cm | 1 | 5.2.3 | Contrapiso de cascote de 10 cm: 0,10 m³ por m². |
| CARPETA EN INTERIOR e: 3cm | 1 | 5.4.1 | La receta no tiene espesor: es la misma para 3 y 4 cm. |
| COLOCACION DE REVESTIMIENTOS EN PISOS PORCELANATO 1,20X60 EN INTERIOR. | 1 | 7.1.1 | No incluye el porcelanato: queda como material que compra el cliente. |
| AZOTADO HIDROFUGO + PINTURA ASFALTICA EN AZOTEA ACCESIBLE | 2 | 8.1 |  |
| TELGOPOR 50 mm + CONTRAPISO EN AZOTEA ACCESIBLE e: 8cm | 1 | 8.3 + 5.2.3 | Compuesto: placas EPS (8.3) + contrapiso de cascote (5.2.3) de 8 cm. |
| PINTURA ASFALTICA + MEMBRANA ASFALTICA + GEOTEXTIL ESP: 4MM EN AZOTEA  | 2 | 8.2 + 8.4 | Compuesto: pintura asfáltica (8.2) + membrana con geotextil (8.4). |
| CARPETA EN AZOTEA ACCESIBLE e: 3cm | 1 | 5.4.1 | La receta no tiene espesor: es la misma para 3 y 4 cm. |
| COLOCACION DE REVESTIMIENTOS EN PISOS PORCELANATO 1,20X60 EN EXTERIOR | 1 | 7.1.1 | No incluye el porcelanato: queda como material que compra el cliente. |
| AZOTADO HIDROFUGO + PINTURA ASFALTICA EN AZOTEA INACCESIBLE | 1 | 8.1 |  |
| TELGOPOR 50 mm + CONTRAPISO/CARPETA EN AZOTEA INACCESIBLE (BALCONES) e | 1 | 8.3 + 5.2.3 | Compuesto: placas EPS (8.3) + contrapiso de cascote (5.2.3) de 4 cm. |
| PINTURA ASFALTICA + MEMBRANA ASFALTICA + GEOTEXTIL ESP: 4MM EN AZOTEA  | 1 | 8.2 + 8.4 | Compuesto: pintura asfáltica (8.2) + membrana con geotextil (8.4). |
| CONTRAPISO/ CARPETA e=10cm | 1 | 5.2.3 | Contrapiso de cascote de 10 cm: 0,10 m³ por m². |
| TELGOPOR 50 mm + CONTRAPISO/ CARPETA EN AZOTEA ACCESIBLE e: 8cm | 1 | 8.3 + 5.2.3 | Compuesto: placas EPS (8.3) + contrapiso de cascote (5.2.3) de 8 cm. |
| EJECUCION DE CIELORRASOS DE YESO SUSPENDIDO EN BAÑOS, COCINAS, PASOS Y | 7 | 6.5 | Cielorraso suspendido de placa. En baños y cocinas, ¿placa verde (6.6)? |
| EJECUCION DE PINTURA EN CIELORRASOS. INCLUYE ENDUIDO PARA POSTERIR LIJ | 7 | 7.4.1 |  |
| CIELORRASOS APLICADOS EN YESO EN AMBIENTES PRINCIPALES (ESTAR Y DORMIT | 6 | 6.1 |  |
| BUÑA PERIMETRAL EN ESTAR Y DORMITORIOS | 6 | 6.2 |  |
| CAJONES CORTINEROS DE YESO FRENTE A MUROS EXTERIORES EN DORMITORIOS Y  | 1 | 6.3 |  |
| CAJONES DE YESO SOBRE PLACARES | 6 | 6.3 |  |
| EJECUCION DE PINTURA EN PAREDES. INCLUYE ENDUIDO PARA POSTERIR LIJADO  | 6 | 7.4.2 |  |
| CAJONES CORTNEROS DE YESO FRENTE A MUROS EXTERIORES EN DORMITORIOS Y E | 5 | 6.3 |  |

## Datos del Excel que se corrigieron al cargar

- Fila 158: código 4.8-6.2 dentro de 4.7 → 4.7.6.2.
- Fila 113: sin unidad, se tomó m².
