# Informe de importación del Maestro de precios

Archivo: `MODELO DE PRESUPUESTACION RESUMEN.xlsx`

No se inventaron datos: los precios o fechas que faltan quedan vacíos y figuran acá.

## Resumen

| Hoja | Entradas | Sin fecha | Sin precio | Códigos duplicados | Sin código |
|---|---|---|---|---|---|
| 00_Mat | 311 | 189 | 27 | 10 | 3 |
| 00_MO | 4 | 0 | 0 | 0 | 0 |
| 00_Eq | 27 | 4 | 0 | 0 | 0 |
| 00_Sub | 64 | 13 | 4 | 1 | 0 |

## Códigos duplicados en la misma hoja

Se importaron todas las filas. Hay que dejar un solo código por producto en el Excel (si son productos distintos, cambiarle el código a uno).

| Hoja | Código | Filas |
|---|---|---|
| 00_Mat | HADN6K | fila 78: Hierros ADN 420 Φ 6 (k) ($1.347,48); fila 85: Hierros ADN 420 Φ 6 (k) ($1.455,00) |
| 00_Mat | HADN8K | fila 79: Hierros ADN 420 Φ 8 (k) ($1.310,31); fila 86: Hierros ADN 420 Φ 8 (k) ($1.374,00) |
| 00_Mat | HADN10K | fila 80: Hierros ADN 420Φ 10 (k) ($1.310,31); fila 87: Hierros ADN 420Φ 10 (k) ($1.374,00) |
| 00_Mat | HADN12K | fila 81: Hierros ADN 420 Φ 12 (k) ($1.301,01); fila 88: Hierros ADN 420 Φ 12 (k) ($1.374,00) |
| 00_Mat | HADN16K | fila 82: Hierros ADN 420 Φ 16 (k) ($1.263,84); fila 89: Hierros ADN 420 Φ 16 (k) ($1.322,00) |
| 00_Mat | HADN20K | fila 83: Hierros ADN 420 Φ 20 (k) ($1.263,84); fila 90: Hierros ADN 420 Φ 20 (k) ($1.322,00) |
| 00_Mat | HADN25K | fila 84: Hierros ADN 420 Φ 25 (k) ($1.263,84); fila 91: Hierros ADN 420 Φ 25 (k) ($1.322,00) |
| 00_Mat | INOD | fila 99: Inodoro FERRUM ($600.000,00); fila 111: Inodoro Capea Italiana Largo ($143.129,81) |
| 00_Mat | D-FIJ | fila 203: Fijacion del 8 (Tornillo y Tarugo) X 100u ($6.592,00); fila 212: Fijaciones (—) |
| 00_Mat | D-BUN | fila 204: Buña Z Perimetral 0,36 mm x 2600 mm INSIGNIA ($1.930,00); fila 205: Cantonera Metalica x 2600mm INSIGNIA ($1.402,00) |
| 00_Sub | SUB-PI | fila 4: Pintura Interior: 1Mano Enduido + Yeso, 1 Mano Enduido, 2 a 3 Manos de Pintura ($15.000,00); fila 9: Pintura Interior ($8.000,00) |

## Códigos repetidos entre hojas

| Código | Hojas |
|---|---|
| MS-ARBOL | 00_Eq ($570.000,00); 00_Sub ($200.000,00) |
| MS-ER | 00_Eq ($30.000,00); 00_Sub ($21.000,00) |
| MS-TC | 00_Eq ($25.000,00); 00_Sub ($25.000,00) |
| MS-TCA | 00_Eq ($10.500,00); 00_Sub ($240.000,00) |
| MS-TM3 | 00_Eq ($30.000,00); 00_Sub ($30.000,00) |

## Precios sin fecha

| Hoja | Fila | Código | Descripción | Precio sin IVA |
|---|---|---|---|---|
| 00_Mat | 4 | ARG | Arena a granel (1m3) | — |
| 00_Mat | 7 | PIEP | Bolson de Piedra partida (1m3) | $74.566,00 |
| 00_Mat | 8 | PIE | Bolson de Piedra (1m3) | $61.700,00 |
| 00_Mat | 10 | CEM-GROUT | Sika Grout 25k (u) | $31.900,00 |
| 00_Mat | 11 | CAL | Bolsa Cal "Cacique" 25 k (u) | $5.371,90 |
| 00_Mat | 12 | PLASTICOR | Bolsa Plasticor 40k (u) | $7.024,79 |
| 00_Mat | 13 | CER | Ceresita 20 k (u) | $37.190,08 |
| 00_Mat | 14 | LP18 | Ladrillo Portante 18 (u) | $1.377,00 |
| 00_Mat | 15 | LP12 | Ladrillo Portante 12 (u) | $1.110,20 |
| 00_Mat | 16 | LP8 | Ladrillo Portante 8 (u) | — |
| 00_Mat | 17 | LH18 | Ladrillo Hueco 18 (u) | $837,00 |
| 00_Mat | 18 | LH12 | Ladrillo Hueco 12 (u) | $726,00 |
| 00_Mat | 20 | LDM18 | Ladrillo ceramico doble muro 18 (u) | — |
| 00_Mat | 21 | LDM20 | Ladrillo ceramico doble muro 20 (u) | — |
| 00_Mat | 22 | LDM24 | Ladrillo ceramico doble muro 24 (u) | — |
| 00_Mat | 25 | LREF | Ladrillo refractario | — |
| 00_Mat | 26 | LHOR | Bloque de cemento | — |
| 00_Mat | 45 | DISCO | Disco Ascerradora | $120.000,00 |
| 00_Mat | 48 | VI7 | Vigueta pretensada de hormigon 7m | $34.000,00 |
| 00_Mat | 49 | VI6 | Vigueta pretensada de hormigon 6m | $30.111,00 |
| 00_Mat | 50 | VI4 | Vigueta pretensada de hormigon 4m | $26.000,00 |
| 00_Mat | 51 | VI-EPS | Ladrillos Telgopor 10cm | $3.844,00 |
| 00_Mat | 52 | P-PRO | Protex 215 x 1kg | $18.000,00 |
| 00_Mat | 53 | Z-SELL | Adhesivo Zocalos Sellador Rellenador Atrim 420gr | $13.000,00 |
| 00_Mat | 54 | ME | MECHA ROTOPERCUTORA | $5.000,00 |
| 00_Mat | 55 | EPS | EPS aislante para techos 1x1 30mm 15 Kg Pack 5u | $60.000,00 |
| 00_Mat | 56 | GRO | Sika Grout 22kg | $43.000,00 |
| 00_Mat | 60 | M3,5 | Malla Φ 3,5 (2 m x 5 m) (hierros cada 0,18 x 0,18 m) - menos de 50 u (u) | $19.173,55 |
| 00_Mat | 61 | M5 | Malla Φ 5 (2 m x 5 m) (hierros cada 0,18 x 0,18 m) - menos de 50 u (u) | $29.917,36 |
| 00_Mat | 63 | M3,5M | Malla Φ 3,5 (2 m x 5 m) (hierros cada 0,18 x 0,18 m) - mas de 50 u (u) | $18.677,69 |
| 00_Mat | 64 | M5M | Malla Φ 5 (2 m x 5 m) (hierros cada 0,18 x 0,18 m) - mas de 50 u (u) | $29.586,78 |
| 00_Mat | 66 | M6 | Malla Φ 6 (2 m x 5 m) (hierros cada 0,15 x 0,15 m) | — |
| 00_Mat | 67 | M8 | Malla Φ 8 (2 m x 5 m) (hierros cada 0,15 x 0,15 m) | $50.000,00 |
| 00_Mat | 68 | M8-Q335 | Malla Φ 8 Q335 (2,4 m x 6 m) (hierros cada 0,15 x 0,15 m) | $250.000,00 |
| 00_Mat | 69 | M-ELEC | Malla electrosada (1x1) 250 | $30.000,00 |
| 00_Mat | 70 | HADN6 | Hierros ADN 420 Φ 6 | $5.250,00 |
| 00_Mat | 71 | HADN8 | Hierros ADN 420 Φ 8 | $9.050,00 |
| 00_Mat | 72 | HADN10 | Hierros ADN 420Φ 10 | $11.237,00 |
| 00_Mat | 75 | HADN20 | Hierros ADN 420 Φ 20 | $55.000,00 |
| 00_Mat | 76 | - | Hierros ADN 420 Φ 20 | $40.284,98 |
| 00_Mat | 77 | HADN25 | Hierros ADN 420 Φ 25 | $68.759,07 |
| 00_Mat | 78 | HADN6K | Hierros ADN 420 Φ 6 (k) | $1.347,48 |
| 00_Mat | 79 | HADN8K | Hierros ADN 420 Φ 8 (k) | $1.310,31 |
| 00_Mat | 80 | HADN10K | Hierros ADN 420Φ 10 (k) | $1.310,31 |
| 00_Mat | 81 | HADN12K | Hierros ADN 420 Φ 12 (k) | $1.301,01 |
| 00_Mat | 82 | HADN16K | Hierros ADN 420 Φ 16 (k) | $1.263,84 |
| 00_Mat | 83 | HADN20K | Hierros ADN 420 Φ 20 (k) | $1.263,84 |
| 00_Mat | 84 | HADN25K | Hierros ADN 420 Φ 25 (k) | $1.263,84 |
| 00_Mat | 85 | HADN6K | Hierros ADN 420 Φ 6 (k) | $1.455,00 |
| 00_Mat | 86 | HADN8K | Hierros ADN 420 Φ 8 (k) | $1.374,00 |
| 00_Mat | 87 | HADN10K | Hierros ADN 420Φ 10 (k) | $1.374,00 |
| 00_Mat | 88 | HADN12K | Hierros ADN 420 Φ 12 (k) | $1.374,00 |
| 00_Mat | 89 | HADN16K | Hierros ADN 420 Φ 16 (k) | $1.322,00 |
| 00_Mat | 90 | HADN20K | Hierros ADN 420 Φ 20 (k) | $1.322,00 |
| 00_Mat | 91 | HADN25K | Hierros ADN 420 Φ 25 (k) | $1.322,00 |
| 00_Mat | 92 | HL16 | Hierros Liso Φ 16 - l=6 m | $20.410,00 |
| 00_Mat | 93 | C.E. 40X60 | Caño estructural 40x60x1.6 (6mts) | $60.000,00 |
| 00_Mat | 99 | INOD | Inodoro FERRUM | $600.000,00 |
| 00_Mat | 103 | PDP | Pileta de patio AWADUCT | $12.000,00 |
| 00_Mat | 104 | GRIF-TOI | Grfieria Lavatorio FV | $150.000,00 |
| 00_Mat | 106 | GRIF-CS | Griferia CANILLA DE SERVICIO | $10.000,00 |
| 00_Mat | 107 | GRIF-DUCHA | Grfieria Ducha FV | $360.000,00 |
| 00_Mat | 108 | GRIF-BID | Grfieria Bide FV | $211.000,00 |
| 00_Mat | 109 | PDP-REJ | Rejilla ATRIM Pileta Patio Reversible 12x12 Cuadrada Acero I | $26.000,00 |
| 00_Mat | 110 | INOD-DEP | Deposito Capea Italiana Apoyo | $98.608,68 |
| 00_Mat | 111 | INOD | Inodoro Capea Italiana Largo | $143.129,81 |
| 00_Mat | 112 | PL-E | Embudo Pluvial 110 "Awaduct" | $20.000,00 |
| 00_Mat | 113 | PL-TRI | Tritubo 40 mm (3 mm espesor) | $4.487,71 |
| 00_Mat | 114 | PL-FAJA | Faja Advertencia Blanca | $396,69 |
| 00_Mat | 115 | PL-CAM30 | Tapa y Marco Hormigon para Camara Inspeccion 0,6 x 0,6 m | $26.446,28 |
| 00_Mat | 116 | PL-CAM60 | Tapa y Marco Hormigon para Camara Inspeccion 0,6 x 0,6 m | $33.057,85 |
| 00_Mat | 117 | H-CAM60 | Tapa y Marco SEMILLA DE MELON para Camara Inspeccion 0,6 x 0,6 m | $150.000,00 |
| 00_Mat | 118 | AF-TAN2000 | Tanque De Agua Waterplast Vertical Tricapa 2000l | $450.000,00 |
| 00_Mat | 119 | CL-PPN40 | Caño PVC 40 mm - long= 4 m AWADUCT | $6.000,00 |
| 00_Mat | 120 | CL-PPN63 | Caño PVC 63 mm - long= 4 m AWADUCT | $7.500,00 |
| 00_Mat | 121 | CL-PPN110 | Caño PVC 110 mm - long= 4 m AWADUCT | $13.800,00 |
| 00_Mat | 122 | PL-PVC110 | Caño PVC 110 mm - long= 4 m AWADUCT | — |
| 00_Mat | 123 | PL-PVC110-3.2 | Caño PVC 110 mm - long= 4 m (espesor 3,2mm) | $18.676,00 |
| 00_Mat | 124 | PL-PVC160 | Caño PVC 160 mm - long= 4 m | $27.745,00 |
| 00_Mat | 125 | PL-PVC400 | Caño PVC 400 mm - long= 6 m | $374.120,00 |
| 00_Mat | 126 | PL-PVC600 | Caño PVC 600 mm - por metro | $55.900,83 |
| 00_Mat | 127 | PL-HA400 | Caño Hormigon Armado 400 mm | $14.710,74 |
| 00_Mat | 128 | PL-HA500 | Caño Hormigon Armado 500 mm | $17.355,37 |
| 00_Mat | 129 | PL-CN1/2 | Caño Riego Negro 1/2" - rollo 100 m | $20.661,16 |
| 00_Mat | 130 | PL-CN1 | Caño Riego Negro 1 1/2" - rollo 50 m | $33.057,85 |
| 00_Mat | 131 | PL-CN2 | Caño Riego Negro 2" - rollo 100 m | $123.966,94 |
| 00_Mat | 132 | PL-SAL1 | Caño Saladillo 1" | $13.223,14 |
| 00_Mat | 133 | PL-SAL2 | Caño Saladillo 2" | $32.231,40 |
| 00_Mat | 134 | MN | Manguera Negra Polietileno Agua Riego 3/4 Pulgada K4 100m | $65.200,00 |
| 00_Mat | 135 | C-400LTS | Tanque Cisterna Single Waterplast 400L dim 88 h 82 | $135.607,00 |
| 00_Mat | 136 | C-600LTS | Tanque Cisterna Single Waterplast 600L dim 92 h 109 | $195.628,00 |
| 00_Mat | 142 | MES-TOI | Mesada de granito para toilet (40x100 aprox) | $600.000,00 |
| 00_Mat | 143 | MES-COC | Mesada de granito para COCINA (60x300 aprox) | $800.000,00 |
| 00_Mat | 150 | A-MEAS45 | Membrana Asfaltica Maxiplas MAXI450 x 40 kg | $45.154,55 |
| 00_Mat | 151 | A-EMAS | Emulsion Asfaltica Ormiflex 7 x 200 l | $257.937,19 |
| 00_Mat | 152 | A-MLA | Membrana Liquida Acrilica "Protex" 20 kg (u) | $81.404,96 |
| 00_Mat | 153 | A-MLP | Membrana Liquida Poliuretanica "Protex" 20 kg (u) | $121.900,83 |
| 00_Mat | 159 | PROTEX | PROTEX 20 kg x caja | $19.000,00 |
| 00_Mat | 160 | ME-ASF | INERTOLTECH caja 18 lts Imprimación Membranas Base Asfáltica | $32.260,00 |
| 00_Mat | 161 | ME-LIQ | Protex Techos Acrilico Blanco X 20 Kgs Membrana Liquida Blanco Mate | $73.300,00 |
| 00_Mat | 162 | A-MEAS36 | Membrana Asfaltica Maxiplas MAXI450 x 36 kg | $67.750,00 |
| 00_Mat | 163 | PI-ASF | Pintura Impermeabilizante Asfáltica Secado Rápido X 18 Lts | $70.715,00 |
| 00_Mat | 164 | AGEO | Manto Geotextil 75gr Sinteplast 26,25 m2 | $60.000,00 |
| 00_Mat | 176 | F-IND | Fenolico 18mm Industrial | $32.400,00 |
| 00_Mat | 177 | F-PI | Fenolico scarp 18mm Pino cic | $26.320,00 |
| 00_Mat | 180 | PUN | Puntal | $9.000,00 |
| 00_Mat | 184 | Y-M4X1 | Maestras 4X1 Saligna 4m | — |
| 00_Mat | 185 | Y-L1X1 | Listones 1X1 Saligna 4m | — |
| 00_Mat | 186 | Y-MD200X70 | Metal desplegado 200x70 | — |
| 00_Mat | 197 | D-POM | Perfil Omega | $1,00 |
| 00_Mat | 207 | D-PL60 | Placa Deco Clasic Texturada Clasica 0,060 m x 0,060 m | — |
| 00_Mat | 208 | D-PER | Perimetrales | — |
| 00_Mat | 209 | D-LAR | Largueros | — |
| 00_Mat | 210 | D-TRA | Travesaños 0,61 m | — |
| 00_Mat | 211 | D-AL14 | Alambre Galvanizado Nro 14 | — |
| 00_Mat | 212 | D-FIJ | Fijaciones | — |
| 00_Mat | 213 | D-SELL | Sellador Indifugo Promat | — |
| 00_Mat | 214 | D-MATA | Mat Aislante | — |
| 00_Mat | 218 | SF-PGC200 | Pefil PGC 200 (2,54mm) 200 x 80 x 6000 | — |
| 00_Mat | 219 | SF-PGU150 | Perfil PGU 150 (2,54 mm) 150 x 40 x 6000 | $57.206,20 |
| 00_Mat | 220 | SF-PGC150 | Perfil PGC 150 (2,54 mm) 150 x 40 x 6000 | $64.357,02 |
| 00_Mat | 221 | SF-PGU100 | Perfil PGU 100 (0,94mm) 100 x 35 x 6000 | $13.737,19 |
| 00_Mat | 222 | SF-PGC100 | Perfil PGC 100 (0,94 mm) 100 x 40 x 6000 | $16.789,67 |
| 00_Mat | 223 | SF-OSB | Placa OSB (18,3 mm) 1,22 x 2,44 | $38.473,55 |
| 00_Mat | 224 | SF-POME | Perfil PGO 22 (0,94 mm) x 3,00 m | $8.459,09 |
| 00_Mat | 225 | SF-TYBEK | Barrera de Agua y Viento TYBEK 1,5 x 20 m (30 m2) | $40.204,13 |
| 00_Mat | 226 | EPS-300 | Placas De Telgopor Eps 1x1m 30 Mm | — |
| 00_Mat | 227 | EPS-500 | Placas De Telgopor Eps 1x1m 50 Mm | — |
| 00_Mat | 228 | LV-50 | Lana De Vidrio Isover Rolac Plata 50mm 1,20 X 12,00mts | — |
| 00_Mat | 233 | RE-END20 | Enduido Interior Exterior Talento - Polacrin 20 l (u) | — |
| 00_Mat | 247 | RE-CONVO | Convertidor de Oxido | — |
| 00_Mat | 248 | RE-SINSAT | Sintetico Satinado Blanco 1 l | — |
| 00_Mat | 252 | RE-ANTIOX | Antioxido Blanco 4 l (u) | — |
| 00_Mat | 253 | S-TABLA | ETERNIT Siding Cedral Natural de 8mm x 3,60m x 20cm (Placa cementicia) | — |
| 00_Mat | 254 | S-TORN | Tornillo TORO T2 P. MECHA C/ALAS #8x1 1/4" | — |
| 00_Mat | 255 | S-PGO | PGO OMEGA GALERA 0.90 |28| 3m IMECON | — |
| 00_Mat | 256 | S-T+T | Tornillo TORO FIX Z AMARILLO 5 X 45 UNIDAD + Tarugo - SOBRE TACO COMUN C/TOPE N 8 X 1 | — |
| 00_Mat | 259 | RP-PORC | PORCELANATO VILLAGRES 82X141,5 CATHEDRAL CEMENT (2,32m2 x caja) | $45.000,00 |
| 00_Mat | 260 | RP-CER | CERAMICA 74X74 CER METROPOLE PUL ( 3,24m2 x caja) | $21.000,00 |
| 00_Mat | 261 | PR-PASC1 | Pastina Klaukol para Ceramica x 1kg | $3.000,00 |
| 00_Mat | 262 | PR-PASP1 | Pastina Klaukol para Porcelanato x 1kg | $8.000,00 |
| 00_Mat | 263 | RP-KP | Klaukol Porcellanato 25 k | $32.000,00 |
| 00_Mat | 264 | RP-KC | Klaukol Ceramica 25 k | $11.000,00 |
| 00_Mat | 265 | RP-TORN | Tornillos Niveladores Porcelanato X 50 | $4.100,00 |
| 00_Mat | 266 | RP-TUER | Tuerca Niveladora x 20 | $3.300,00 |
| 00_Mat | 267 | RP-NIVCER | Niveladores Ceramicos - Cuna 150u y Arcos 150u | $15.200,00 |
| 00_Mat | 268 | RP-ZOC | Zocalo de PVC | — |
| 00_Mat | 271 | IE-CC1.5 | Caño Corrugado Blanco 1 1/2" - 38 mm (rollo 25m) | $17.443,18 |
| 00_Mat | 272 | IE-TAB | Tablero con todo. | $2.000.000,00 |
| 00_Mat | 273 | IE-ART | Artefacto de luz. | $30.000,00 |
| 00_Mat | 274 | IE-BOCA | Boca Cambre (caja, cable, modulo) | $45.000,00 |
| 00_Mat | 275 | IE-CU2,5 | CABLE UNIPOLAR 2,5 ROJO + AZUL + VERDE X6M | $12.000,00 |
| 00_Mat | 276 | AA-CP | Caja Pre-instalacion Para Aire Acondicionado Pared 43x11 Cm | $3.500,00 |
| 00_Mat | 277 | IE-TRIT | Caño Tritubo Cano Rollo De 100 Metros Polietileno 40 Mm X 3 | $504.600,00 |
| 00_Mat | 280 | CH-GSINUS28 | Chapa Galvanizada Sinus N27 Color Zinc | $8.388,43 |
| 00_Mat | 281 | CH-GSINUS25 | Chapa Galvanizada Sinus N25 Color Zinc | $9.710,74 |
| 00_Mat | 282 | CH-GT10125 | Chapa Galvanizada T101 N25 Color Zinc | $9.710,74 |
| 00_Mat | 283 | CH-CSINUS27 | Chapa Cincalum Sinus N27 Color Aluminizada | $8.677,69 |
| 00_Mat | 284 | CH-CSINUS25 | Chapa Cincalum Sinus N25 Color Aluminizada | $10.000,00 |
| 00_Mat | 285 | CH-CT10127 | Chapa Cincalum T101 N27 Color Aluminizada | $10.000,00 |
| 00_Mat | 286 | CH-CT10125 | Chapa Cincalum T101 N25 Color Aluminizada | $8.677,69 |
| 00_Mat | 287 | CH-PPSINUS25 | Chapa Prepintada Sinus N25 | $14.958,68 |
| 00_Mat | 288 | CH-PPT10125 | Chapa Prepintada T101N25 | $14.958,68 |
| 00_Mat | 289 | TE-30X50X2 | Tubo Estructural 30 x 50 x 2,0 mm - 6 m largo | $27.493,40 |
| 00_Mat | 290 | TE-40X40X1.6 | Tubo Estructural 40 x 40 x 1,6 mm | $23.667,42 |
| 00_Mat | 291 | TE-40X40X2 | Tubo Estructural 40 x 40 x 2,0 mm | $33.959,27 |
| 00_Mat | 292 | TE-100X50X2 | Tubo Estructural 100 x 50 x 2,0 mm - 6 m largo | $49.037,98 |
| 00_Mat | 293 | TE-150X50 | Tubo Estructural 150 x 50 x 2,0 mm | $66.212,89 |
| 00_Mat | 294 | TE-200X100 | Tubo Estructural 200 x 100 x 3,2 mm | $55.788,00 |
| 00_Mat | 295 | TE-300X150 | Tubo Estructural 300 x 150 | $1,00 |
| 00_Mat | 296 | TE-160X3,2 | Tubo Estructural 160 mm diametro x 3,2 mm - 6 m largo | $190.909,09 |
| 00_Mat | 297 | TE-152X2 | Tubo Estructural 152 mm diametro x 2,0 mm - 6 m largo | $1.753,00 |
| 00_Mat | 298 | PC-100X45X2 | Perfil C 100 x 45 (2,0mm) - 12 m largo | $76.707,12 |
| 00_Mat | 299 | PC-140X60X2 | Perfil C 140 x 60 (2,0mm) - 12 m largo | $114.056,28 |
| 00_Mat | 300 | PU-160 | Perfiol U 160 (2,0mm) - 12 m largo | $91.337,19 |
| 00_Mat | 301 | PC | Perfil C Acero | $1,00 |
| 00_Mat | 302 | CH-TAM2 | Tornillo Autoperforante 2" (bolsa 100 u) | $22.398,35 |
| 00_Mat | 303 | CH-C22 | Chapa Calibre 22 (1,00 x 2,00 m) | $28.578,51 |
| 00_Mat | 304 | CH-C25 | Chapa Calibre 25 (1,22 x 2,44m) | $24.495,87 |
| 00_Mat | 308 | Z-CAN | Canaleta de Zinc | — |
| 00_Mat | 309 | Z-BOR | Borde Cubierta | — |
| 00_Mat | 310 | Z-BL | Banda L | $7.500,00 |
| 00_Mat | 313 | GAS-E1" | Caño Epoxi 1 Pulgada X 6.4 Mts Aprobado | $96.000,00 |
| 00_Mat | 316 | CALDERA | CALDERA (hasta 9 radiadores) | $1.300.000,00 |
| 00_Mat | 317 | RAD | RADIADOR 4 SECCIONES. Incluye valvulas y demas accesorios. | $200.000,00 |
| 00_Mat | 353 | M-QC200 | Tabla De Quebracho Colorado 1" X 20 CM. X 2.00 M. | $24.000,00 |
| 00_Mat | 354 | M-QC250 | Tabla De Quebracho Colorado 1" X 20 CM. X 2.50 M. | $32.500,00 |
| 00_Mat | 355 | M-P-CETOL | Cetol Duración Extrema Satinado Secado Rápido 4 L Madera Mm Color Natural | $75.000,00 |
| 00_Mat | 356 | M-QP180 | PUNTAL DE QUEBRACHO 2X3 X 180m | $12.000,00 |
| 00_Eq | 7 | E-MP | Motopison | $40.000,00 |
| 00_Eq | 19 | MS-ER | EXCAVACION Y RETIRO | $30.000,00 |
| 00_Eq | 22 | E-CAM | Camioneta | $200.000,00 |
| 00_Eq | 24 | E-VOL | Volquete | $200.000,00 |
| 00_Sub | 7 | SUB-PE | Pintura Exterior | $10.000,00 |
| 00_Sub | 9 | SUB-PI | Pintura Interior | $8.000,00 |
| 00_Sub | 10 | SUB-END | Enduido | $8.000,00 |
| 00_Sub | 11 | SUB-PPS | Pintura Puerta Simple Hoja | $25.000,00 |
| 00_Sub | 12 | SUB-PPD | Pintura Puerta Doble Hoja | $50.000,00 |
| 00_Sub | 35 | SUB-SIDING | Colocion de siding en pared | $18.000,00 |
| 00_Sub | 40 | MS-MC | MINICARGADORA | $500.000,00 |
| 00_Sub | 41 | MS-MCM | MINICARGADORA CON MARTILLO | $600.000,00 |
| 00_Sub | 42 | MS-MR | MINIRETRO EXCAVADORA | $600.000,00 |
| 00_Sub | 43 | MS-RP | RETRO PALA | — |
| 00_Sub | 61 | SUB-ZING | Zinguero | $700.000,00 |
| 00_Sub | 72 | SUB-YES-AGARGANTA | YESO APLICADO EN CIELORRASO ARMADO | — |
| 00_Sub | 79 | SF-TAB | TABIQUE DE STEEL FRAME | — |

## Productos sin precio

| Hoja | Fila | Código | Descripción | |
|---|---|---|---|---|
| 00_Mat | 4 | ARG | Arena a granel (1m3) |  |
| 00_Mat | 16 | LP8 | Ladrillo Portante 8 (u) |  |
| 00_Mat | 20 | LDM18 | Ladrillo ceramico doble muro 18 (u) |  |
| 00_Mat | 21 | LDM20 | Ladrillo ceramico doble muro 20 (u) |  |
| 00_Mat | 22 | LDM24 | Ladrillo ceramico doble muro 24 (u) |  |
| 00_Mat | 25 | LREF | Ladrillo refractario |  |
| 00_Mat | 26 | LHOR | Bloque de cemento |  |
| 00_Mat | 66 | M6 | Malla Φ 6 (2 m x 5 m) (hierros cada 0,15 x 0,15 m) |  |
| 00_Mat | 122 | PL-PVC110 | Caño PVC 110 mm - long= 4 m AWADUCT |  |
| 00_Mat | 184 | Y-M4X1 | Maestras 4X1 Saligna 4m |  |
| 00_Mat | 185 | Y-L1X1 | Listones 1X1 Saligna 4m |  |
| 00_Mat | 186 | Y-MD200X70 | Metal desplegado 200x70 |  |
| 00_Mat | 207 | D-PL60 | Placa Deco Clasic Texturada Clasica 0,060 m x 0,060 m |  |
| 00_Mat | 208 | D-PER | Perimetrales |  |
| 00_Mat | 209 | D-LAR | Largueros |  |
| 00_Mat | 210 | D-TRA | Travesaños 0,61 m |  |
| 00_Mat | 211 | D-AL14 | Alambre Galvanizado Nro 14 |  |
| 00_Mat | 212 | D-FIJ | Fijaciones |  |
| 00_Mat | 213 | D-SELL | Sellador Indifugo Promat |  |
| 00_Mat | 214 | D-MATA | Mat Aislante |  |
| 00_Mat | 218 | SF-PGC200 | Pefil PGC 200 (2,54mm) 200 x 80 x 6000 |  |
| 00_Mat | 226 | EPS-300 | Placas De Telgopor Eps 1x1m 30 Mm |  |
| 00_Mat | 227 | EPS-500 | Placas De Telgopor Eps 1x1m 50 Mm |  |
| 00_Mat | 228 | LV-50 | Lana De Vidrio Isover Rolac Plata 50mm 1,20 X 12,00mts |  |
| 00_Mat | 268 | RP-ZOC | Zocalo de PVC |  |
| 00_Mat | 308 | Z-CAN | Canaleta de Zinc |  |
| 00_Mat | 309 | Z-BOR | Borde Cubierta |  |
| 00_Sub | 43 | MS-RP | RETRO PALA |  |
| 00_Sub | 72 | SUB-YES-AGARGANTA | YESO APLICADO EN CIELORRASO ARMADO |  |
| 00_Sub | 79 | SF-TAB | TABIQUE DE STEEL FRAME |  |
| 00_Sub | 81 | PIL | PILOTAJE |  |

## Solo precio con IVA

La columna de esta sección dice "PRECIO CON IVA". Se cargó como precio con IVA y el precio sin IVA quedó vacío hasta confirmar cuál es.

| Hoja | Fila | Código | Descripción | Precio con IVA |
|---|---|---|---|---|
| 00_Mat | 231 | RE-PLI20 | Albalatex Extra Mate 20 l (u) | $150.000,00 |
| 00_Mat | 232 | RE-END15 | Enduido Plastico Interior 15 l (u) | $30.661,00 |
| 00_Mat | 233 | RE-END20 | Enduido Interior Exterior Talento - Polacrin 20 l (u) | $30.000,00 |
| 00_Mat | 234 | RE-PLIC | Alba Cielorraso 20 l (u) | $110.000,00 |
| 00_Mat | 235 | RE-PINC25 | Pincel Nro 25 | $3.000,00 |
| 00_Mat | 236 | RE-PINC15 | Pincel Nro 15 | $2.500,00 |
| 00_Mat | 237 | RE-ROD | Rodillo Cuero Lanar | $10.000,00 |
| 00_Mat | 238 | RE-ROD.AG | Rodillo Anti Gota | $6.000,00 |
| 00_Mat | 239 | RE-MINIROD | Rodillo Mini 9cm | $2.400,00 |
| 00_Mat | 240 | RE-AGUARAS | Aguaras x1 lt | $6.500,00 |
| 00_Mat | 241 | RE-LIJ220 | Lija al Agua Nro 220 | $700,00 |
| 00_Mat | 242 | RE-LIJ150 | Lija al Agua Nro 150 | $800,00 |
| 00_Mat | 243 | RE-CAR | Rollo Carton Corrugado | $10.330,00 |
| 00_Mat | 244 | RE-CIN | Cinta de Papel Azul nro 36 | $6.859,00 |
| 00_Mat | 245 | RE-FIJ | FIJADOR SELLADOR ESPLENDOR 20L | $57.190,00 |
| 00_Mat | 246 | RE-FIJX1 | FIJADOR SELLADOR ALTO RENDIMIENTO 1L | $6.198,00 |
| 00_Mat | 247 | RE-CONVO | Convertidor de Oxido | $10.200,00 |
| 00_Mat | 248 | RE-SINSAT | Sintetico Satinado Blanco 1 l | $13.800,00 |
| 00_Mat | 249 | RE-TBASE | Base Para Revestimiento Plástico- Tarquini x20kg | $108.000,00 |
| 00_Mat | 250 | RE-TARQ | Revestimiento Plastico A Rodillo - Taqruini x25kg | $120.000,00 |
| 00_Mat | 252 | RE-ANTIOX | Antioxido Blanco 4 l (u) | $29.818,18 |
| 00_Mat | 253 | S-TABLA | ETERNIT Siding Cedral Natural de 8mm x 3,60m x 20cm (Placa cementicia) | $42.000,00 |
| 00_Mat | 254 | S-TORN | Tornillo TORO T2 P. MECHA C/ALAS #8x1 1/4" | $40,00 |
| 00_Mat | 255 | S-PGO | PGO OMEGA GALERA 0.90 |28| 3m IMECON | $8.400,00 |
| 00_Mat | 256 | S-T+T | Tornillo TORO FIX Z AMARILLO 5 X 45 UNIDAD + Tarugo - SOBRE TACO COMUN C/TOPE N 8 X 1 | $60,00 |

## Filas sin código (no se importaron)

| Hoja | Fila | Código | Descripción | |
|---|---|---|---|---|
| 00_Mat | 94 |  |  |  |
| 00_Mat | 251 |  | Latex Frente "Albion" 20 l (u) |  |
| 00_Mat | 278 |  | \ |  |

## Códigos normalizados (mayúsculas y espacios)

| Hoja | Fila | Código | Descripción | Original |
|---|---|---|---|---|
| 00_Mat | 42 | AL-50K | Alambre Fardo (50 k) | AL-50k |
| 00_Mat | 52 | P-PRO | Protex 215 x 1kg | P-pro |
| 00_Mat | 53 | Z-SELL | Adhesivo Zocalos Sellador Rellenador Atrim 420gr | z-sell |
| 00_Mat | 135 | C-400LTS | Tanque Cisterna Single Waterplast 400L dim 88 h 82 | C-400Lts |
| 00_Mat | 136 | C-600LTS | Tanque Cisterna Single Waterplast 600L dim 92 h 109 | C-600Lts |
| 00_Mat | 137 | C-1000LTS | Tanque Cisterna Single Waterplast 1000L | C-1000Lts |
| 00_Mat | 155 | A-MLVENDA | Venda TL geo 75x26 | A-MLvenda |
| 00_Mat | 156 | A-NY200100M2 | Nylon 200 Micrones (100 m2 x rollo) | A-NY200100m2 |
| 00_Mat | 157 | A-NY20050M2 | Nylon 200 Micrones (50 m2 x rollo) | A-NY20050m2 |
| 00_Mat | 246 | RE-FIJX1 | FIJADOR SELLADOR ALTO RENDIMIENTO 1L | RE-FIJx1 |
| 00_Mat | 289 | TE-30X50X2 | Tubo Estructural 30 x 50 x 2,0 mm - 6 m largo | TE-30x50x2 |
| 00_Mat | 293 | TE-150X50 | Tubo Estructural 150 x 50 x 2,0 mm | TE-150x50 |
| 00_Mat | 294 | TE-200X100 | Tubo Estructural 200 x 100 x 3,2 mm | TE-200x100 |
| 00_Mat | 295 | TE-300X150 | Tubo Estructural 300 x 150 | TE-300x150 |
| 00_Mat | 296 | TE-160X3,2 | Tubo Estructural 160 mm diametro x 3,2 mm - 6 m largo | TE-160x3,2 |
| 00_Mat | 297 | TE-152X2 | Tubo Estructural 152 mm diametro x 2,0 mm - 6 m largo | TE-152x2 |
| 00_Mat | 298 | PC-100X45X2 | Perfil C 100 x 45 (2,0mm) - 12 m largo | PC-100x45x2 |
| 00_Mat | 347 | H-PL-M | Bomba Pluma m3 bombeable | H-PL-m |
| 00_Mat | 349 | H-E-M | Bomba Estacionaria m3 bombeable | H-E-m |
| 00_Sub | 54 | PERFRACION | Perforacion para bobas de 7.5 HP de 17m3/h materiales y mo | Perfracion |
