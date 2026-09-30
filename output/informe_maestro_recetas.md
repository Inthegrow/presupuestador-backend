# Informe de carga del Maestro TERRAC: recetas y árbol

Archivo: `MODELO DE PRESUPUESTACION RESUMEN.xlsx`

## Resumen

- **61 plantillas** con **491 recursos**: 289 bien y **202 para revisar**.
- Plantillas sin nada para revisar: 14. Con algo para revisar: 47.
- **Árbol CYP**: 105 filas (rubros, subrubros e ítems). Ítems con plantilla: 61.

Cómo se tradujo:
- La cantidad del ítem (celda H3) es **Q**.
- Las celdas auxiliares (altura, ml de vigas…) son **parámetros** con el valor del Excel: se cambian en cada presupuesto.
- Mano de obra: los días `=H3/15` son **rendimiento 15 por día**. El % de la columna Desperdicio de la MO se cargó como cargas sociales.
- Los materiales se redondean a unidades enteras **sobre el total de la obra**, no por ítem.
- **Revisar** = número fijo del ejemplo, código que no está en el catálogo, o fórmula que no se pudo traducir.

## Decisiones de la reunión con Sol

- 7.2 y 7.3 premarcos: la mano de obra va siempre; el material es opcional (parámetro `con_material`: 1 = sí, 0 = no; por defecto 0).
- Zócalo (solapa AGREGADO) va en **7.1.4**.
- 5.6 Recuadros se elimina (ya está en revoques). No estaba en este Excel.
- Cubiertas (9.1) y Otras terminaciones (7.5.1) quedan como ítems libres, vacíos.

Solapas que no se cargaron:

- `7.1.4.`: Se usó la solapa AGREGADO para el zócalo (decisión con Sol). Esta solapa tenía solo mano de obra (25 ml/día) y el material sin cantidad.

Notas del árbol:

- 4.3 SOBRE SUBSUELO: no se cargó. El Excel dice 'replicar'; el sistema lo resuelve con los pisos.
- 4.4 SOBRE PLANTA BAJA: no se cargó. El Excel dice 'replicar'; el sistema lo resuelve con los pisos.
- 4.5 SOBRE N PISO: no se cargó. El Excel dice 'replicar'; el sistema lo resuelve con los pisos.

## Ítem por ítem

✅ = bien · ⚠️ = hay algo para revisar · ⬜ = sin receta

### 1 Tareas preliminares

- ⬜ **1.1 OBRADOR**: sin solapa en el Excel.
- ⬜ **1.2 BAÑOS QUÍMICOS**: sin solapa en el Excel.
- ⬜ **1.3 INSTALACIONES PROVISORIAS**: sin solapa en el Excel.
- ⬜ **1.4 LIMPIEZA PERIÓDICA DE OBRA**: sin solapa en el Excel.
- ⬜ **1.5 ACARREO DE MATERIALES**: sin solapa en el Excel.
- ⬜ **1.6 AYUDA DE GREMIOS**: sin solapa en el Excel.
- ⬜ **1.7 LIMPIEZA FINAL**: sin solapa en el Excel.
- ⬜ **1.8 ESTRUCTURA DE ENCOFRADO Y APUNTALAMIENTO PROVISORIO**: sin solapa en el Excel.
- ⬜ **1.9 CARTEL DE OBRA**: sin solapa en el Excel.
- ⬜ **1.10 CERCO PERIMETRAL**: sin solapa en el Excel.
- ⬜ **1.11 REPLANTEO Y NIVELACIÓN INICIAL**: sin solapa en el Excel.
- ⬜ **1.12 PROGRAMA DE SEGURIDAD E HIGIENE**: sin solapa en el Excel.
- ⬜ **1.13 ACARREO DE MATERIALES**: sin solapa en el Excel.
### 2 Movimiento de suelo

- ⬜ **2.1 EXCAVACIÓN MECÁNICA (SOLO EQUIPOS)**: sin solapa en el Excel.
- ⬜ **2.2 EXCAVACIÓN MANUAL (MANO DE OBRA)**: sin solapa en el Excel.
- ⬜ **2.3 MOVIMIENTO DE SUELO POR SUBCONTRATO**: sin solapa en el Excel.
- ⬜ **2.4 EXCAVACIÓN CON APUNTALAMIENTO Y ENTIBADO**: sin solapa en el Excel.
- ⬜ **2.5 EXCAVACIÓN CON APOYO DE BANDERILLERO**: sin solapa en el Excel.
- ⬜ **2.6 EXCAVACIÓN COMBINADA (MIXTA)**: sin solapa en el Excel.
### 3 Demolición

- ⬜ **3.1 DEMOLICIÓN A NIVEL (ESTRUCTURAS BAJAS)**: sin solapa en el Excel.
- ⬜ **3.2 DEMOLICIÓN EN ALTURA (EDIFICACIONES)**: sin solapa en el Excel.
### 4 Estructura

#### 4.1 Fundaciones

- ⚠️ **4.1.1 PLATEA DE FUNDACIÓN h 20cm + VIGAS DE FUNDACION h 40cm (con hierros)** (m2): 19 recursos, 7 bien.
  - Parámetros: `ml_viga_h_20` = 121.
  - Revisar material **HADN8** (`(107+530)*0.9`): Número fijo (573.3): no cambia con la cantidad del ítem.
  - Revisar material **HADN10** (`(12+29)*0.9`): Número fijo (36.9): no cambia con la cantidad del ítem.
  - Revisar material **HADN12** (`9*0.9`): Número fijo (8.1): no cambia con la cantidad del ítem.
  - Revisar material **HADN8** (`253*0.9`): Número fijo (227.7): no cambia con la cantidad del ítem.
  - Revisar material **HADN10** (`117*0.9`): Número fijo (105.3): no cambia con la cantidad del ítem.
  - Revisar material **HADN12** (`112*0.9`): Número fijo (100.8): no cambia con la cantidad del ítem.
  - Revisar material **HADN16** (`7*0.9`): Número fijo (6.3): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 194/día): Días fijos: 1 días para 194 unidades del ejemplo. Se cargó como rendimiento de 194 por día.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 9.7/día): Días fijos: 20 días para 194 unidades del ejemplo. Se cargó como rendimiento de 9.7 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 9.7/día): Días fijos: 20 días para 194 unidades del ejemplo. Se cargó como rendimiento de 9.7 por día.
  - Revisar mano de obra **MO-AY** (1 pers., rendimiento 9.7/día): Días fijos: 20 días para 194 unidades del ejemplo. Se cargó como rendimiento de 9.7 por día.
  - Revisar mo - material **DIS** (`10`): Número fijo (10): no cambia con la cantidad del ítem.
- ⚠️ **4.1.2 PLATEA DE FUNDACIÓN h 20cm + VIGAS DE FUNDACION h 40cm (con malla)** (m2): 19 recursos, 8 bien.
  - Parámetros: `ml_viga_h_20` = 121.
  - Revisar material **HADN10** (`(12+29)*0.9`): Número fijo (36.9): no cambia con la cantidad del ítem.
  - Revisar material **HADN12** (`9*0.9`): Número fijo (8.1): no cambia con la cantidad del ítem.
  - Revisar material **HADN8** (`253*0.9`): Número fijo (227.7): no cambia con la cantidad del ítem.
  - Revisar material **HADN10** (`117*0.9`): Número fijo (105.3): no cambia con la cantidad del ítem.
  - Revisar material **HADN12** (`112*0.9`): Número fijo (100.8): no cambia con la cantidad del ítem.
  - Revisar material **HADN16** (`7*0.9`): Número fijo (6.3): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 194/día): Días fijos: 1 días para 194 unidades del ejemplo. Se cargó como rendimiento de 194 por día.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 14.923077/día): Días fijos: 13 días para 194 unidades del ejemplo. Se cargó como rendimiento de 14.923077 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 14.923077/día): Días fijos: 13 días para 194 unidades del ejemplo. Se cargó como rendimiento de 14.923077 por día.
  - Revisar mano de obra **MO-AY** (1 pers., rendimiento 14.923077/día): Días fijos: 13 días para 194 unidades del ejemplo. Se cargó como rendimiento de 14.923077 por día.
  - Revisar mo - material **DIS** (`10`): Número fijo (10): no cambia con la cantidad del ítem.
- ⚠️ **4.1.3 BASES AISLADAS** (m3): 15 recursos, 6 bien.
  - Revisar material **HADN10** (`30`): Número fijo (30): no cambia con la cantidad del ítem.
  - Revisar material **HADN12** (`120`): Número fijo (120): no cambia con la cantidad del ítem.
  - Revisar material **HADN16** (`90`): Número fijo (90): no cambia con la cantidad del ítem.
  - Revisar material **HADN20** (`20`): Número fijo (20): no cambia con la cantidad del ítem.
  - Revisar material **H-PL-TI** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 15.428571/día): Días fijos: 7 días para 108 unidades del ejemplo. Se cargó como rendimiento de 15.428571 por día.
  - Revisar mano de obra **MO-PU** (2 pers., rendimiento 15.428571/día): Días fijos: 7 días para 108 unidades del ejemplo. Se cargó como rendimiento de 15.428571 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 15.428571/día): Días fijos: 7 días para 108 unidades del ejemplo. Se cargó como rendimiento de 15.428571 por día.
  - Revisar mano de obra **MO-AY** (3 pers., rendimiento 15.428571/día): Días fijos: 7 días para 108 unidades del ejemplo. Se cargó como rendimiento de 15.428571 por día.
- ⚠️ **4.1.4 Troncos de columna** (m3): 11 recursos, 4 bien.
  - ℹ️ El título de la solapa ('TRONCOS') no coincide con el CYP ('Troncos de columna'). Se usó el nombre del CYP.
  - Revisar material **HADN12** (`12`): Número fijo (12): no cambia con la cantidad del ítem.
  - Revisar material **HADN16** (`40`): Número fijo (40): no cambia con la cantidad del ítem.
  - Revisar material **F-GR2** (`5`): Número fijo (5): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 2.857143/día): Días fijos: 7 días para 20 unidades del ejemplo. Se cargó como rendimiento de 2.857143 por día.
  - Revisar mano de obra **MO-PU** (2 pers., rendimiento 2.857143/día): Días fijos: 7 días para 20 unidades del ejemplo. Se cargó como rendimiento de 2.857143 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 2.857143/día): Días fijos: 7 días para 20 unidades del ejemplo. Se cargó como rendimiento de 2.857143 por día.
  - Revisar mano de obra **MO-AY** (3 pers., rendimiento 2.857143/día): Días fijos: 7 días para 20 unidades del ejemplo. Se cargó como rendimiento de 2.857143 por día.
- ⚠️ **4.1.5 PILOTINES** (m3): 12 recursos, 5 bien.
  - Revisar material **HADN12** (`12`): Número fijo (12): no cambia con la cantidad del ítem.
  - Revisar material **HADN16** (`40`): Número fijo (40): no cambia con la cantidad del ítem.
  - Revisar material **H-PL-TI** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 2.857143/día): Días fijos: 7 días para 20 unidades del ejemplo. Se cargó como rendimiento de 2.857143 por día.
  - Revisar mano de obra **MO-PU** (2 pers., rendimiento 2.857143/día): Días fijos: 7 días para 20 unidades del ejemplo. Se cargó como rendimiento de 2.857143 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 2.857143/día): Días fijos: 7 días para 20 unidades del ejemplo. Se cargó como rendimiento de 2.857143 por día.
  - Revisar mano de obra **MO-AY** (3 pers., rendimiento 2.857143/día): Días fijos: 7 días para 20 unidades del ejemplo. Se cargó como rendimiento de 2.857143 por día.
- ⚠️ **4.1.6 PILOTES** (m3): 11 recursos, 4 bien.
  - Revisar material **HADN12** (`12`): Número fijo (12): no cambia con la cantidad del ítem.
  - Revisar material **HADN16** (`40`): Número fijo (40): no cambia con la cantidad del ítem.
  - Revisar material **H-PL-TI** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 2.857143/día): Días fijos: 7 días para 20 unidades del ejemplo. Se cargó como rendimiento de 2.857143 por día.
  - Revisar mano de obra **MO-PU** (2 pers., rendimiento 2.857143/día): Días fijos: 7 días para 20 unidades del ejemplo. Se cargó como rendimiento de 2.857143 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 2.857143/día): Días fijos: 7 días para 20 unidades del ejemplo. Se cargó como rendimiento de 2.857143 por día.
  - Revisar mano de obra **MO-AY** (3 pers., rendimiento 2.857143/día): Días fijos: 7 días para 20 unidades del ejemplo. Se cargó como rendimiento de 2.857143 por día.
- ⚠️ **4.1.7 TENSORES** (m3): 11 recursos, 4 bien.
  - Revisar material **HADN6** (`35`): Número fijo (35): no cambia con la cantidad del ítem.
  - Revisar material **HADN10** (`23`): Número fijo (23): no cambia con la cantidad del ítem.
  - Revisar material **H-PL-TI** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 2.7/día): Días fijos: 2 días para 5.4 unidades del ejemplo. Se cargó como rendimiento de 2.7 por día.
  - Revisar mano de obra **MO-PU** (2 pers., rendimiento 2.7/día): Días fijos: 2 días para 5.4 unidades del ejemplo. Se cargó como rendimiento de 2.7 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 2.7/día): Días fijos: 2 días para 5.4 unidades del ejemplo. Se cargó como rendimiento de 2.7 por día.
  - Revisar mano de obra **MO-AY** (3 pers., rendimiento 2.7/día): Días fijos: 2 días para 5.4 unidades del ejemplo. Se cargó como rendimiento de 2.7 por día.
- ⚠️ **4.1.8 Vigas de encadenado** (m3): 11 recursos, 4 bien.
  - ℹ️ El título de la solapa ('VGAS DE ENCADENADO') no coincide con el CYP ('Vigas de encadenado'). Se usó el nombre del CYP.
  - Revisar: Tiene la misma receta que 4.1.7: ¿es una copia?
  - Revisar material **HADN6** (`35`): Número fijo (35): no cambia con la cantidad del ítem.
  - Revisar material **HADN10** (`23`): Número fijo (23): no cambia con la cantidad del ítem.
  - Revisar material **H-PL-TI** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 2.7/día): Días fijos: 2 días para 5.4 unidades del ejemplo. Se cargó como rendimiento de 2.7 por día.
  - Revisar mano de obra **MO-PU** (2 pers., rendimiento 2.7/día): Días fijos: 2 días para 5.4 unidades del ejemplo. Se cargó como rendimiento de 2.7 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 2.7/día): Días fijos: 2 días para 5.4 unidades del ejemplo. Se cargó como rendimiento de 2.7 por día.
  - Revisar mano de obra **MO-AY** (3 pers., rendimiento 2.7/día): Días fijos: 2 días para 5.4 unidades del ejemplo. Se cargó como rendimiento de 2.7 por día.
#### 4.2 Subsuelo

- ⚠️ **4.2.1 Losas** (m3): 13 recursos, 4 bien.
  - ℹ️ El título de la solapa ('LOSA') no coincide con el CYP ('Losas'). Se usó el nombre del CYP.
  - Revisar material **HADN6** (`32`): Número fijo (32): no cambia con la cantidad del ítem.
  - Revisar material **HADN8** (`143`): Número fijo (143): no cambia con la cantidad del ítem.
  - Revisar material **HADN10** (`305`): Número fijo (305): no cambia con la cantidad del ítem.
  - Revisar material **F-GR2** (`145/2`): Número fijo (72.5): no cambia con la cantidad del ítem.
  - Revisar material **H-PL-TI** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 2.85/día): Días fijos: 20 días para 57 unidades del ejemplo. Se cargó como rendimiento de 2.85 por día.
  - Revisar mano de obra **MO-PU** (2 pers., rendimiento 2.85/día): Días fijos: 20 días para 57 unidades del ejemplo. Se cargó como rendimiento de 2.85 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 2.85/día): Días fijos: 20 días para 57 unidades del ejemplo. Se cargó como rendimiento de 2.85 por día.
  - Revisar mano de obra **MO-AY** (3 pers., rendimiento 2.85/día): Días fijos: 20 días para 57 unidades del ejemplo. Se cargó como rendimiento de 2.85 por día.
- ⚠️ **4.2.2 COLUMNAS** (m3): 16 recursos, 4 bien.
  - Revisar material **HADN6** (`206`): Número fijo (206): no cambia con la cantidad del ítem.
  - Revisar material **HADN8** (`52`): Número fijo (52): no cambia con la cantidad del ítem.
  - Revisar material **HADN10** (`9`): Número fijo (9): no cambia con la cantidad del ítem.
  - Revisar material **HADN12** (`54`): Número fijo (54): no cambia con la cantidad del ítem.
  - Revisar material **HADN16** (`37`): Número fijo (37): no cambia con la cantidad del ítem.
  - Revisar material **HADN20** (`9`): Número fijo (9): no cambia con la cantidad del ítem.
  - Revisar material **F-GR2** (`92/2`): Número fijo (46): no cambia con la cantidad del ítem.
  - Revisar material **H-PL-TI** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 1.642857/día): Días fijos: 14 días para 23 unidades del ejemplo. Se cargó como rendimiento de 1.642857 por día.
  - Revisar mano de obra **MO-PU** (2 pers., rendimiento 1.642857/día): Días fijos: 14 días para 23 unidades del ejemplo. Se cargó como rendimiento de 1.642857 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 1.642857/día): Días fijos: 14 días para 23 unidades del ejemplo. Se cargó como rendimiento de 1.642857 por día.
  - Revisar mano de obra **MO-AY** (3 pers., rendimiento 1.642857/día): Días fijos: 14 días para 23 unidades del ejemplo. Se cargó como rendimiento de 1.642857 por día.
- ⚠️ **4.2.3 VIGAS** (m3): 13 recursos, 3 bien.
  - Revisar material **HADN6** (`147`): Número fijo (147): no cambia con la cantidad del ítem.
  - Revisar material **HADN10** (`67`): Número fijo (67): no cambia con la cantidad del ítem.
  - Revisar material **HADN12** (`20`): Número fijo (20): no cambia con la cantidad del ítem.
  - Revisar material **HADN16** (`21`): Número fijo (21): no cambia con la cantidad del ítem.
  - Revisar material **HADN20** (`9`): Número fijo (9): no cambia con la cantidad del ítem.
  - Revisar material **F-GR2** (`77/2`): Número fijo (38.5): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 1.142857/día): Días fijos: 14 días para 16 unidades del ejemplo. Se cargó como rendimiento de 1.142857 por día.
  - Revisar mano de obra **MO-PU** (2 pers., rendimiento 1.142857/día): Días fijos: 14 días para 16 unidades del ejemplo. Se cargó como rendimiento de 1.142857 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 1.142857/día): Días fijos: 14 días para 16 unidades del ejemplo. Se cargó como rendimiento de 1.142857 por día.
  - Revisar mano de obra **MO-AY** (3 pers., rendimiento 1.142857/día): Días fijos: 14 días para 16 unidades del ejemplo. Se cargó como rendimiento de 1.142857 por día.
- ⚠️ **4.2.4 TABIQUES** (m3): 16 recursos, 4 bien.
  - Revisar: Tiene la misma receta que 4.2.2: ¿es una copia?
  - Revisar material **HADN6** (`206`): Número fijo (206): no cambia con la cantidad del ítem.
  - Revisar material **HADN8** (`52`): Número fijo (52): no cambia con la cantidad del ítem.
  - Revisar material **HADN10** (`9`): Número fijo (9): no cambia con la cantidad del ítem.
  - Revisar material **HADN12** (`54`): Número fijo (54): no cambia con la cantidad del ítem.
  - Revisar material **HADN16** (`37`): Número fijo (37): no cambia con la cantidad del ítem.
  - Revisar material **HADN20** (`9`): Número fijo (9): no cambia con la cantidad del ítem.
  - Revisar material **F-GR2** (`92/2`): Número fijo (46): no cambia con la cantidad del ítem.
  - Revisar material **H-PL-TI** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 1.642857/día): Días fijos: 14 días para 23 unidades del ejemplo. Se cargó como rendimiento de 1.642857 por día.
  - Revisar mano de obra **MO-PU** (2 pers., rendimiento 1.642857/día): Días fijos: 14 días para 23 unidades del ejemplo. Se cargó como rendimiento de 1.642857 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 1.642857/día): Días fijos: 14 días para 23 unidades del ejemplo. Se cargó como rendimiento de 1.642857 por día.
  - Revisar mano de obra **MO-AY** (3 pers., rendimiento 1.642857/día): Días fijos: 14 días para 23 unidades del ejemplo. Se cargó como rendimiento de 1.642857 por día.
- ⚠️ **4.2.5 tabiques de submuración** (m3): 10 recursos, 3 bien.
  - Revisar material **HADN8** (`255`): Número fijo (255): no cambia con la cantidad del ítem.
  - Revisar material **HADN12** (`320`): Número fijo (320): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 3.053571/día): Días fijos: 14 días para 42.75 unidades del ejemplo. Se cargó como rendimiento de 3.053571 por día.
  - Revisar mano de obra **MO-PU** (2 pers., rendimiento 3.053571/día): Días fijos: 14 días para 42.75 unidades del ejemplo. Se cargó como rendimiento de 3.053571 por día.
  - Revisar mano de obra **MO-OF** (3 pers., rendimiento 3.053571/día): Días fijos: 14 días para 42.75 unidades del ejemplo. Se cargó como rendimiento de 3.053571 por día.
  - Revisar mano de obra **MO-AY** (3 pers., rendimiento 3.053571/día): Días fijos: 14 días para 42.75 unidades del ejemplo. Se cargó como rendimiento de 3.053571 por día.
  - Revisar mano de obra **Ismael- GUNITADO** (2 pers., rendimiento 42.75/día): Recurso sin código: no va a traer precio del catálogo. En el Excel tenía un precio escrito a mano: 1000000. Días fijos: 1 días para 42.75 unidades del ejemplo. Se cargó como rendimiento de 42.75 por día.
- ⚠️ **4.2.6 escaleras** (gl): 12 recursos, 1 bien.
  - ℹ️ El título de la solapa ('ESCALERA DE HORMIGON NO VISTO SOBRE PLANTA BAJA (UN TRAMO) 90cm DE ANCHO h 3,2') no coincide con el CYP ('escaleras'). Se usó el nombre del CYP.
  - Revisar material **H30** (`1.5*0.9`): Número fijo (1.35): no cambia con la cantidad del ítem.
  - Revisar material **HADN8** (`(6.5*6/12)*1.1`): Número fijo (3.575): no cambia con la cantidad del ítem.
  - Revisar material **HADN10** (`(6.5*6/12)*1.1`): Número fijo (3.575): no cambia con la cantidad del ítem.
  - Revisar material **HADN8** (`19.6`): Número fijo (19.6): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 0.2/día): Días fijos: 5 días para 1 unidades del ejemplo. Se cargó como rendimiento de 0.2 por día.
  - Revisar mano de obra **MO-OF** (2 pers., rendimiento 0.2/día): Días fijos: 5 días para 1 unidades del ejemplo. Se cargó como rendimiento de 0.2 por día.
  - Revisar mano de obra **MO-AY** (1 pers., rendimiento 0.2/día): Días fijos: 5 días para 1 unidades del ejemplo. Se cargó como rendimiento de 0.2 por día.
  - Revisar mo - material **DIS** (`2`): Código normalizado: 'dis' → 'DIS'. Número fijo (2): no cambia con la cantidad del ítem.
  - Revisar mo - material **CL2.5** (`5`): Número fijo (5): no cambia con la cantidad del ítem.
  - Revisar mo - material **CL2** (`5`): Número fijo (5): no cambia con la cantidad del ítem.
  - Revisar mo - material **F-PI** (`4`): Número fijo (4): no cambia con la cantidad del ítem.
### 5 Albañileria

#### 5.1 Mamposteria

- ⚠️ **5.1.1 LADRILLO CERAMICO PORTANTE DEL 18** (m2): 8 recursos, 7 bien.
  - Parámetros: `altura_m` = 2.8.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 40/día): Días fijos: 1 días para 40 unidades del ejemplo. Se cargó como rendimiento de 40 por día.
- ⚠️ **5.1.2 LADRILLO CERAMICO PORTANTE DEL 12** (m2): 8 recursos, 6 bien.
  - Parámetros: `altura_m` = 2.8.
  - Revisar material **HADN6** (`(((Q/altura_m)*4)/12)*2`): La celda L5 dice =30/K5: 30 es la cantidad de ejemplo escrita a mano en vez de H3. Se tomó como Q.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 30/día): Días fijos: 1 días para 30 unidades del ejemplo. Se cargó como rendimiento de 30 por día.
- ⚠️ **5.1.3 LADRILLO CERAMICO PORTANTE DEL 8** (m2): 8 recursos, 6 bien.
  - Parámetros: `altura_m` = 2.8.
  - Revisar material **HADN6** (`(((Q/altura_m)*4)/12)*2`): La celda L5 dice =30/K5: 30 es la cantidad de ejemplo escrita a mano en vez de H3. Se tomó como Q.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 30/día): Días fijos: 1 días para 30 unidades del ejemplo. Se cargó como rendimiento de 30 por día.
- ⚠️ **5.1.4 LADRILLO CERAMICO HUECO DEL 18** (m2): 8 recursos, 6 bien.
  - Parámetros: `altura_m` = 2.8.
  - ℹ️ El título de la solapa ('MAMPOSTERIA. LADRILLO CERAMICO PORTANTE DEL 18') no coincide con el CYP ('LADRILLO CERAMICO HUECO DEL 18'). Se usó el nombre del CYP.
  - Revisar material **HADN6** (`(((Q/altura_m)*4)/12)*2`): La celda L5 dice =30/K5: 30 es la cantidad de ejemplo escrita a mano en vez de H3. Se tomó como Q.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 30/día): Días fijos: 1 días para 30 unidades del ejemplo. Se cargó como rendimiento de 30 por día.
- ⚠️ **5.1.5 LADRILLO CERAMICO HUECO DEL 12** (m2): 8 recursos, 6 bien.
  - Parámetros: `altura_m` = 2.8.
  - ℹ️ El título de la solapa ('MAMPOSTERIA. LADRILLO CERAMICO PORTANTE DEL 12') no coincide con el CYP ('LADRILLO CERAMICO HUECO DEL 12'). Se usó el nombre del CYP.
  - Revisar material **HADN6** (`(((Q/altura_m)*4)/12)*2`): La celda L5 dice =30/K5: 30 es la cantidad de ejemplo escrita a mano en vez de H3. Se tomó como Q.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 30/día): Días fijos: 1 días para 30 unidades del ejemplo. Se cargó como rendimiento de 30 por día.
- ⚠️ **5.1.6 LADRILLO CERAMICO HUECO DEL 8** (m2): 8 recursos, 6 bien.
  - Parámetros: `altura_m` = 2.8.
  - ℹ️ El título de la solapa ('MAMPOSTERIA. LADRILLO CERAMICO PORTANTE DEL 8') no coincide con el CYP ('LADRILLO CERAMICO HUECO DEL 8'). Se usó el nombre del CYP.
  - Revisar material **HADN6** (`(((Q/altura_m)*4)/12)*2`): La celda L5 dice =30/K5: 30 es la cantidad de ejemplo escrita a mano en vez de H3. Se tomó como Q.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 30/día): Días fijos: 1 días para 30 unidades del ejemplo. Se cargó como rendimiento de 30 por día.
- ⚠️ **5.1.7 LADRILLO COMUN** (m2): 8 recursos, 6 bien.
  - Parámetros: `altura_m` = 2.8.
  - Revisar material **HADN6** (`(((Q/altura_m)*9)/12)*2`): La celda L5 dice =30/K5: 30 es la cantidad de ejemplo escrita a mano en vez de H3. Se tomó como Q.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 15/día): Días fijos: 2 días para 30 unidades del ejemplo. Se cargó como rendimiento de 15 por día.
- ⚠️ **5.1.8 LADRILLO COMUN VISTO** (m2): 8 recursos, 6 bien.
  - Parámetros: `altura_m` = 2.8.
  - Revisar material **HADN6** (`(((Q/altura_m)*9)/12)*2`): La celda L5 dice =30/K5: 30 es la cantidad de ejemplo escrita a mano en vez de H3. Se tomó como Q.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 15/día): Días fijos: 2 días para 30 unidades del ejemplo. Se cargó como rendimiento de 15 por día.
- ⚠️ **5.1.9 MURO DOBLE CERAMICO DEL 18 + LADRILLO COMUN VISTO** (m2): 12 recursos, 7 bien.
  - Parámetros: `altura_m` = 2.8.
  - Revisar material **HADN6** (`((((Q/altura_m)*9)/12)*2)+((((Q/altura_m)*4)/12)*2)`): La celda L5 dice =30/K5: 30 es la cantidad de ejemplo escrita a mano en vez de H3. Se tomó como Q.
  - Revisar material **LH18** (`3480.125`): No se pudo traducir la fórmula (usa la celda H8 (columna H de otro recurso: precio o subtotal)): se cargó el valor del Excel como número fijo.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 7.5/día): Días fijos: 4 días para 30 unidades del ejemplo. Se cargó como rendimiento de 7.5 por día.
  - Revisar mano de obra **MO-OF** (1 pers., rendimiento 7.5/día): Días fijos: 4 días para 30 unidades del ejemplo. Se cargó como rendimiento de 7.5 por día.
  - Revisar mano de obra **MO-AY** (1 pers., rendimiento 7.5/día): Días fijos: 4 días para 30 unidades del ejemplo. Se cargó como rendimiento de 7.5 por día.
- ⚠️ **5.1.10 MURO DE STEEL FRAME. HASTA 3m DE h (NO CONTEMPLA REVOQUE EXTERIOR)** (m2): 13 recursos, 11 bien.
  - Parámetros: `celda_l4` = 0.
  - ℹ️ El título de la solapa ('MURO DE STEEL FRAME ALTURA MAXIMA 3m') no coincide con el CYP ('MURO DE STEEL FRAME. HASTA 3m DE h (NO CONTEMPLA REVOQUE EXTERIOR)'). Se usó el nombre del CYP.
  - Revisar material **SF-PGU100** (`((celda_l4*2)/6)`): La celda L4 está vacía: se cargó el parámetro en 0.
  - Revisar material **D-FIJ** (`Q*8`): El código D-FIJ está repetido en el catálogo: puede traer otro precio.
#### 5.2 Contrapiso

- ⚠️ **5.2.1 BOMBEADO ALIVIANADO** (m3): 5 recursos, 4 bien.
  - Revisar mano de obra **MO-AY** (1 pers., rendimiento 1/día): Código normalizado: 'mo-ay' → 'MO-AY'. Días fijos: 1 días para 1 unidades del ejemplo. Se cargó como rendimiento de 1 por día.
- ⚠️ **5.2.2 BOMBEADO ALIVIANADO CON TERMINACION DE CARPETA** (m3): 5 recursos, 4 bien.
  - Revisar mano de obra **MO-AY** (1 pers., rendimiento 1/día): Días fijos: 1 días para 1 unidades del ejemplo. Se cargó como rendimiento de 1 por día.
- ✅ **5.2.3 DE CASCOTE** (m3): 7 recursos.
#### 5.3 Aislación

- ✅ **5.3.1 AISLACIÓN HIDROFUGA HORIZONTAL FUNDACIONES** (m2): 2 recursos.
- ✅ **5.3.2 AISLACIÓN HIDROFUGA HORIZONTAL LOSA** (m2): 3 recursos.
  - ℹ️ El título de la solapa ('AISLACIÓN HIDROFUGA HORIZONTAL AZOTEA') no coincide con el CYP ('AISLACIÓN HIDROFUGA HORIZONTAL LOSA'). Se usó el nombre del CYP.
#### 5.4 Carpeta

- ✅ **5.4.1 CARPETA TRADICIONAL** (m2): 5 recursos.
- ✅ **5.4.2 CARPETA TRADICIONAL CON HIDRÓFUGO** (m2): 8 recursos.
  - Parámetros: `litros` = 0.4.
#### 5.5 Revoque

- ✅ **5.5.1 FINO EXTERIOR** (m2): 4 recursos.
- ✅ **5.5.2 FINO INTERIOR** (m2): 5 recursos.
- ✅ **5.5.3 GRUESO EXTERIOR HIDROFUGO** (m2): 5 recursos.
- ✅ **5.5.4 GRUESO INTERIOR** (m2): 5 recursos.
- ✅ **5.5.5 Yeso interior** (m2): 2 recursos.
### 6 Yeseria y durleria

- ⚠️ **6.1 CIELORRASO** (m2): 5 recursos, 3 bien.
  - ℹ️ El título de la solapa ('CIELORASO DE YESO') no coincide con el CYP ('CIELORRASO'). Se usó el nombre del CYP.
  - Revisar material **Y-M4X1** (`4/0.4`): Número fijo (10): no cambia con la cantidad del ítem.
  - Revisar material **Y-L1X1** (`20`): Número fijo (20): no cambia con la cantidad del ítem.
- ✅ **6.2 BUÑAS** (m): 1 recursos.
  - ℹ️ El título de la solapa ('CIELORASO DE YESO BUÑA/ ARISTA') no coincide con el CYP ('BUÑAS'). Se usó el nombre del CYP.
- ⚠️ **6.3 GARGANTAS / CAJON 20X20** (m): 5 recursos, 3 bien.
  - ℹ️ El título de la solapa ('CIELORASO DE YESO CAJON/ GARGANTA 20x20') no coincide con el CYP ('GARGANTAS / CAJON 20X20'). Se usó el nombre del CYP.
  - Revisar material **Y-M4X1** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar material **Y-L1X1** (`2`): Número fijo (2): no cambia con la cantidad del ítem.
- ⚠️ **6.4 TABIQUE DE PLACA DE YESO** (m2): 10 recursos, 7 bien.
  - Revisar material **D-S70** (`4*2`): Número fijo (8): no cambia con la cantidad del ítem.
  - Revisar material **D-M69** (`4/0.4`): Número fijo (10): no cambia con la cantidad del ítem.
  - Revisar material **D-FIJ** (`200`): El código D-FIJ está repetido en el catálogo: puede traer otro precio. Número fijo (200): no cambia con la cantidad del ítem.
- ⚠️ **6.5 CIELOS RAZOS PLACA YESO** (m2): 9 recursos, 3 bien.
  - ℹ️ El título de la solapa ('CIELORRAZO DE PLACA DE YESO') no coincide con el CYP ('CIELOS RAZOS PLACA YESO'). Se usó el nombre del CYP.
  - Revisar material **D-PL12.5** (`10`): Número fijo (10): no cambia con la cantidad del ítem.
  - Revisar material **D-S35** (`28/2.6`): Número fijo (10.769231): no cambia con la cantidad del ítem.
  - Revisar material **D-M34** (`30`): Número fijo (30): no cambia con la cantidad del ítem.
  - Revisar material **D-T2** (`(10)*80`): Número fijo (800): no cambia con la cantidad del ítem.
  - Revisar material **D-CIN** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar material **D-FIJ** (`200`): El código D-FIJ está repetido en el catálogo: puede traer otro precio. Número fijo (200): no cambia con la cantidad del ítem.
- ⚠️ **6.6 CIELOS RAZOS PLACA VERDE DE YESO** (m2): 9 recursos, 3 bien.
  - ℹ️ El título de la solapa ('CIELORRAZO DE PLACA VERDE DE YESO') no coincide con el CYP ('CIELOS RAZOS PLACA VERDE DE YESO'). Se usó el nombre del CYP.
  - Revisar material **D-PLV12.5** (`10`): Número fijo (10): no cambia con la cantidad del ítem.
  - Revisar material **D-S35** (`28/2.6`): Número fijo (10.769231): no cambia con la cantidad del ítem.
  - Revisar material **D-M34** (`30`): Número fijo (30): no cambia con la cantidad del ítem.
  - Revisar material **D-T2** (`(10)*80`): Número fijo (800): no cambia con la cantidad del ítem.
  - Revisar material **D-CIN** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar material **D-FIJ** (`200`): El código D-FIJ está repetido en el catálogo: puede traer otro precio. Número fijo (200): no cambia con la cantidad del ítem.
- ⚠️ **6.7 CIELOS RAZOS PLACA SEMICUBIERTOS** (m2): 8 recursos, 3 bien.
  - ℹ️ El título de la solapa ('CIELORRAZO DE PLACA DE YESO SEMICUBIERTO') no coincide con el CYP ('CIELOS RAZOS PLACA SEMICUBIERTOS'). Se usó el nombre del CYP.
  - Revisar material **D-PLSC12.5** (`10`): Número fijo (10): no cambia con la cantidad del ítem.
  - Revisar material **D-S35** (`28/2.6`): Número fijo (10.769231): no cambia con la cantidad del ítem.
  - Revisar material **D-M34** (`30`): Número fijo (30): no cambia con la cantidad del ítem.
  - Revisar material **D-T2** (`(10)*80`): Número fijo (800): no cambia con la cantidad del ítem.
  - Revisar material **D-FIJ** (`200`): El código D-FIJ está repetido en el catálogo: puede traer otro precio. Número fijo (200): no cambia con la cantidad del ítem.
- ⚠️ **6.8 BUÑAS PLACA YESO** (m2): 3 recursos, 2 bien.
  - ℹ️ El título de la solapa ('BUÑA PERIMETRAL CIELORRAZO DE PLACA DE YESO') no coincide con el CYP ('BUÑAS PLACA YESO'). Se usó el nombre del CYP.
  - Revisar material **D-BUN** (`Q/2.6`): El código D-BUN está repetido en el catálogo: puede traer otro precio.
- ⚠️ **6.9 GARGANTAS PLACA YESO 20X20** (m): 6 recursos, 4 bien.
  - ℹ️ El título de la solapa ('GARGANTA PLACA DE YESO 20X20') no coincide con el CYP ('GARGANTAS PLACA YESO 20X20'). Se usó el nombre del CYP.
  - Revisar material **D-CIN** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar material **D-FIJ** (`Q*8`): El código D-FIJ está repetido en el catálogo: puede traer otro precio.
- ⚠️ **6.10 CAJON/ MOCHETA DE PLACA DE YESO 20X20** (m): 6 recursos, 4 bien.
  - Revisar material **D-CIN** (`1`): Número fijo (1): no cambia con la cantidad del ítem.
  - Revisar material **D-FIJ** (`Q*8`): El código D-FIJ está repetido en el catálogo: puede traer otro precio.
### 7 Terminaciones

#### 7.1 Revestimiento

- ⚠️ **7.1.1 REVESTIMIENTO HORIZANTAL** (m2): 8 recursos, 7 bien.
  - ℹ️ El título de la solapa ('COLOCACION DE REVESTIMIENTO EN PISOS') no coincide con el CYP ('REVESTIMIENTO HORIZANTAL'). Se usó el nombre del CYP.
  - Revisar material **RP-TUER** (`20`): Número fijo (20): no cambia con la cantidad del ítem.
- ⚠️ **7.1.2 REVESTIMIENTO HORIZANTAL EN AMABIENTE MENOR A 2X2** (m2): 8 recursos, 7 bien.
  - ℹ️ El título de la solapa ('REVESTIMIENTO EN PISOS EN AMABIENTE MENOR A 2X2') no coincide con el CYP ('REVESTIMIENTO HORIZANTAL EN AMABIENTE MENOR A 2X2'). Se usó el nombre del CYP.
  - Revisar material **RP-TUER** (`20`): Número fijo (20): no cambia con la cantidad del ítem.
- ⚠️ **7.1.3 REVESTIMIENTO HORIZANTAL EN MABIENTE DE BAÑO O COCINA** (m2): 8 recursos, 7 bien.
  - ℹ️ El título de la solapa ('REVESTIMIENTO EN PISOS EN MABIENTE DE BAÑO O COCINA') no coincide con el CYP ('REVESTIMIENTO HORIZANTAL EN MABIENTE DE BAÑO O COCINA'). Se usó el nombre del CYP.
  - Revisar: Tiene la misma receta que 7.1.2: ¿es una copia?
  - Revisar material **RP-TUER** (`20`): Número fijo (20): no cambia con la cantidad del ítem.
- ✅ **7.1.4 REVESTIMIENTO HORIZONTAL ZOCALO** (ml): 3 recursos.
  - ℹ️ Viene de la solapa AGREGADO (decisión con Sol: el zócalo va en 7.1.4).
  - ℹ️ El título de la solapa ('REVESREVESTIMIENTO HORIZONTAL ZOCALO CERAMICO / PORCELANATO') no coincide con el CYP ('REVESTIMIENTO HORIZONTAL ZOCALO'). Se usó el nombre del CYP.
- ⚠️ **7.1.5 REVESTIMIENTO VERTICAL** (m2): 8 recursos, 4 bien.
  - Revisar: Tiene la misma receta que 7.1.1: ¿es una copia?
  - Revisar material **RP-TUER** (`20`): Número fijo (20): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 30/día): La fórmula usaba H3, que está vacía; la cantidad está en H1. Se tomó como Q.
  - Revisar mano de obra **MO-OF** (2 pers., rendimiento 30/día): La fórmula usaba H3, que está vacía; la cantidad está en H1. Se tomó como Q.
  - Revisar mano de obra **MO-AY** (2 pers., rendimiento 30/día): La fórmula usaba H3, que está vacía; la cantidad está en H1. Se tomó como Q.
- ⚠️ **7.1.6 REVESTIMIENTO ESCALERA** (gl): 8 recursos, 4 bien.
  - Parámetros: `escalera_std_de_16` = 7.2.
  - Revisar material **RP-TUER** (`20`): Número fijo (20): no cambia con la cantidad del ítem.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 30/día): La fórmula usaba H3, que está vacía; la cantidad está en H1. Se tomó como Q.
  - Revisar mano de obra **MO-OF** (1 pers., rendimiento 0.5/día): Días fijos: 2 días para 1 unidades del ejemplo. Se cargó como rendimiento de 0.5 por día.
  - Revisar mano de obra **MO-AY** (1 pers., rendimiento 0.5/día): Días fijos: 2 días para 1 unidades del ejemplo. Se cargó como rendimiento de 0.5 por día.
#### 7.2 Ventanas

- ⚠️ **7.2.1 PREMARCOS VENTANAS** (u): 4 recursos, 2 bien.
  - Parámetros: `con_material` = 0.
  - ℹ️ Premarcos: la mano de obra va siempre; el material es opcional con el parámetro con_material.
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 30/día): La fórmula usaba H3, que está vacía; la cantidad está en H1. Se tomó como Q.
  - Revisar material **Premarco (material opcional)** (`Q*con_material`): Material opcional (con_material = 1). No hay código de premarco en 00_Mat: falta el código y el precio.
#### 7.3 Puertas

- ⚠️ **7.3.1 PREMARCOS PUERTAS** (u): 4 recursos, 2 bien.
  - Parámetros: `con_material` = 0.
  - ℹ️ Premarcos: la mano de obra va siempre; el material es opcional con el parámetro con_material.
  - Revisar: Tiene la misma receta que 7.2.1: ¿es una copia?
  - Revisar mano de obra **MO-CA** (1 pers., rendimiento 30/día): La fórmula usaba H3, que está vacía; la cantidad está en H1. Se tomó como Q.
  - Revisar material **Premarco (material opcional)** (`Q*con_material`): Material opcional (con_material = 1). No hay código de premarco en 00_Mat: falta el código y el precio.
#### 7.4 Pintura

- ⚠️ **7.4.1 PINTURA CIELORASO** (m2): 11 recursos, 10 bien.
  - Revisar subcontrato **SUB-PI** (`Q`): El código SUB-PI está repetido en el catálogo: puede traer otro precio. Código normalizado: 'sub-pi' → 'SUB-PI'.
- ⚠️ **7.4.2 PINTURA EN PAREDES (yeso, lija + 3 manos)** (m2): 11 recursos, 10 bien.
  - Revisar: Tiene la misma receta que 7.4.1: ¿es una copia?
  - Revisar subcontrato **SUB-PI** (`Q`): El código SUB-PI está repetido en el catálogo: puede traer otro precio. Código normalizado: 'sub-pi' → 'SUB-PI'.
- ✅ **7.4.3 PINTURA EN PAREDES (3 manos)** (m2): 10 recursos.
  - ℹ️ El título de la solapa ('PINTURA EN PAREDES (una mano de enduido, lijado, fijado y pintado)') no coincide con el CYP ('PINTURA EN PAREDES (3 manos)'). Se usó el nombre del CYP.
#### 7.5 Otras terminaciones

- ⬜ **7.5.1 Otras terminaciones (ítem libre)**: ítem libre, vacío.
### 8 Aislaciones

- ⚠️ **8.1 AZOTADO HIDROFUGO + PINTURA ASFALTICA EN AZOTEA** (m2): 6 recursos, 4 bien.
  - ℹ️ El título de la solapa ('AZOTADO HIDROFUGO + PINTURA ASFALICA') no coincide con el CYP ('AZOTADO HIDROFUGO + PINTURA ASFALTICA EN AZOTEA'). Se usó el nombre del CYP.
  - Revisar mano de obra **MO-OF** (1 pers., rendimiento 50/día): Días fijos: 2 días para 100 unidades del ejemplo. Se cargó como rendimiento de 50 por día.
  - Revisar mano de obra **MO-AY** (1 pers., rendimiento 100/día): Días fijos: 1 días para 100 unidades del ejemplo. Se cargó como rendimiento de 100 por día.
- ⚠️ **8.2 PINTURA ASFALTICA EN AZOTEA** (m2): 2 recursos, 1 bien.
  - ℹ️ El título de la solapa ('PINTURA ASFALICA') no coincide con el CYP ('PINTURA ASFALTICA EN AZOTEA'). Se usó el nombre del CYP.
  - Revisar mano de obra **MO-OF** (1 pers., rendimiento 100/día): Días fijos: 1 días para 100 unidades del ejemplo. Se cargó como rendimiento de 100 por día.
- ⚠️ **8.3 COLOCACION DE PLACAS EPS 5cm** (m2): 2 recursos, 1 bien.
  - Revisar mano de obra **MO-AY** (1 pers., rendimiento 100/día): Días fijos: 1 días para 100 unidades del ejemplo. Se cargó como rendimiento de 100 por día.
- ✅ **8.4 MEMBRANA ASFALTICA + GEOTEXTIL ESP: 4MM.** (m2): 2 recursos.
### 9 Cubierta

- ⬜ **9.1 Cubierta (ítem libre)**: ítem libre, vacío.

## Filas sin cantidad (no se cargaron)

Tienen código pero la cantidad o los días están vacíos o en 0.

- 4.1.1: MO-PU
- 4.1.2: MO-PU
- 4.1.3: HADN6, HADN8, F-MIR, F-GR2, A-NY200100M2
- 4.1.4: HADN6, HADN8, HADN10, HADN20, F-MIR, H-PL-TI
- 4.1.5: HADN6, HADN8, HADN10, HADN20, F-MIR, F-GR2
- 4.1.6: HADN6, HADN8, HADN10, HADN20, F-MIR, F-GR2, E-MCM, PIL
- 4.1.7: HADN8, HADN12, HADN16, HADN20, F-MIR, F-GR2, CL2
- 4.1.8: HADN8, HADN12, HADN16, HADN20, F-MIR, F-GR2, CL2
- 4.2.1: HADN12, HADN16, HADN20, F-MIR
- 4.2.2: F-MIR
- 4.2.3: HADN8, F-MIR
- 4.2.4: F-MIR
- 4.2.5: HADN6, HADN10, HADN16, HADN20, F-MIR, F-GR2
- 5.1.1: MO-PU
- 5.1.2: MO-PU
- 5.1.3: MO-PU
- 5.1.4: MO-PU
- 5.1.5: MO-PU
- 5.1.6: MO-PU
- 5.1.7: MO-PU
- 5.1.8: MO-PU
- 5.1.9: MO-PU
- 5.3.1: MO-CA, MO-OF, MO-AY
- 5.3.2: MO-CA, MO-OF, MO-AY
- 5.5.5: MO-CA, MO-OF, MO-AY
- 6.7: D-CIN
- 7.1.4: MO-CA
- 7.1.5: CL2, AL-50K
- 7.1.6: CL2, AL-50K
- 7.2.1: CL2, AL-50K
- 7.3.1: CL2, AL-50K
- 8.1: MO-CA
- 8.2: MO-CA, MO-AY
- 8.3: MO-CA, MO-OF
