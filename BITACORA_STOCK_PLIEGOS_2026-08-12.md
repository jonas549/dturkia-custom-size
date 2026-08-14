# BITÁCORA — Módulo de Control de Stock por Pliego

**Proyecto:** dturkia-custom-size (D'Turkia · `dturkia.myshopify.com`)
**Iniciada:** 2026-08-12
**Estado:** ✅ **Fases 1-7 COMPLETADAS** + **cambio a escalones por ancho de rollo ([§5.0](#50-escalones-por-ancho-de-rollo))** + 🔷 **EL STOCK PASA A SER POR TRAMA ([§4.4](#44--el-stock-es-por-trama-no-por-regla-2026-08-14))** — falta pegar los 2 archivos del tema y activar `PLIEGOS_MODO`. Siguiente: Fase 8 (activación + QA)
**Última actualización:** 2026-08-14

> ### ⚠️ LEER ANTES DE TOCAR NADA — sobre "Ceniza"
>
> **Ceniza NO existe** como producto de Shopify ni como `ReglaPersonalizada`, y **no se va a crear
> ahora**. Era solo el ejemplo del Excel del cliente, y este documento lo trataba como si ya
> estuviera en producción. **No volver a asumirlo.**
>
> **Todo el MVP y el QA del módulo de pliegos se hacen sobre la regla de prueba ya existente:**
>
> | | |
> |---|---|
> | Regla | **`Alfombra test 2`** |
> | `reglaId` | `cmoipz5lp0000l704zvl3nx6h` |
> | Producto | `gid://shopify/Product/8557639893127` (ACTIVE, tag `medida-personalizada`) |
>
> Cuando el MVP esté validado, **más adelante** se creará el producto Ceniza real y se reapuntará la
> integración (un `UPDATE "Pliego" SET "reglaId" = ...`). **Eso no es ahora.**
>
> Los códigos de pliego siguen diciendo `CEN-*` porque son los del inventario de ejemplo y sirven
> para el QA. Donde este documento diga "Ceniza", léase "la regla de prueba Alfombra test 2".

> Documento de referencia consultable entre sesiones. Se actualiza al cerrar cada fase
> (ver [§8 Registro de avance](#8-registro-de-avance)).

> 📓 **Bitácoras de sesión** (qué se hizo cada día, con el estado para retomar):
> `BITACORA_SESION_2026-08-13.md`.

---

## Índice

1. [Contexto del negocio](#1-contexto-del-negocio)
2. [Diagnóstico y análisis de factibilidad](#2-diagnóstico-y-análisis-de-factibilidad)
3. [Decisiones cerradas](#3-decisiones-cerradas)
4. [Modelo de datos](#4-modelo-de-datos)
   · [4.4 El stock es por trama, no por regla](#44--el-stock-es-por-trama-no-por-regla-2026-08-14) 🔷
5. [Lógica de selección y reserva](#5-lógica-de-selección-y-reserva)
   · [5.0 Escalones por ancho de rollo](#50-escalones-por-ancho-de-rollo) 🔶
6. [Plan de ataque — Fases 1 a 8](#6-plan-de-ataque--fases-1-a-8)
7. [Riesgos y mitigaciones](#7-riesgos-y-mitigaciones)
8. [Registro de avance](#8-registro-de-avance)

---

## 1. Contexto del negocio

### 1.1 Qué son las tramas

> ⚠️ **Ceniza y Alba son nombres del Excel del cliente, no productos existentes.** Ninguna trama real
> está todavía modelada en Shopify. Ver el aviso de la cabecera: el MVP corre sobre `Alfombra test 2`.

D'Turkia vende alfombras **a medida** de distintas "tramas" (Ceniza, Alba, …).
Cada trama es **un producto de Shopify** con una `ReglaPersonalizada` asociada (ancho/alto mín-máx +
precio por m²), que la app **ya soporta hoy**. El cliente final elige la trama en la página de
producto, configura ancho × alto con sliders dentro del rango permitido, y compra.

### 1.2 Qué son los pliegos

Las tramas llegan en **pliegos/rollos físicos** de material del que se cortan las alfombras.
Cada pliego tiene un **ancho fijo** y un **largo**.

Una alfombra sale **siempre de un solo pliego**: no se parchan pliegos ni para ganar ancho ni para
ganar largo.

**El cliente NUNCA elige el pliego.** Lo asigna el sistema.

### 1.3 Reglas físicas del corte

- **El ancho manda, POR ESCALONES:** una alfombra no se corta de cualquier pliego más ancho, sino
  **solo de los pliegos del primer ancho `>=` al requerido** (ver [§5.0](#50-escalones-por-ancho-de-rollo)).
  Un pedido de 250 cm sale de los rollos de 300, nunca de los de 400, ni siquiera si los de 300 se
  quedaron sin largo.
- **El largo se descuenta** del pliego elegido.
- El **retazo de ancho** que sobra (diferencia entre el ancho del pliego y el ancho pedido) se
  **ignora: es merma**, no se reutiliza.
- Si **ningún** pliego tiene a la vez ancho suficiente y largo restante suficiente, la alfombra
  **no se puede vender**.
- **No hay optimización de corte 2D (bin-packing).** Solo: filtrar por ancho → filtrar por largo
  restante → elegir por cercanía de ancho → restar largo. Nada más.

### 1.4 Por qué se necesita este módulo

Se **descartó** el enfoque de "un número único de m² totales por trama" porque **miente en el largo**:
los sobrantes de ancho de cada pliego siguen sumando al total disponible aunque físicamente ya no
sirvan para cortar la siguiente alfombra. Ejemplo: 10 rollos con 2 m restantes cada uno suman
"20 m disponibles", pero no permiten cortar ni una sola alfombra de 3 m de largo.

De ahí el enfoque **pliego por pliego**: cada rollo físico es una unidad independiente con su propio
largo restante.

### 1.5 Formato real de los datos y el ejemplo Ceniza

El inventario llega en formato `MEDIDA | CANTIDAD DE UNIDADES | TRAMA`:

```
4 X 20.10 M | 3 | Ceniza
3 X 21.70 M | 4 | Ceniza
1 X 21.00 M | 4 | Ceniza
```

Es decir, **Ceniza tiene 11 pliegos físicos**:

| Código previsto | Ancho | Largo total | Unidades |
|---|---|---|---|
| `CEN-400-01` … `CEN-400-03` | 4.00 m (400 cm) | 20.10 m (2010 cm) | 3 |
| `CEN-300-01` … `CEN-300-04` | 3.00 m (300 cm) | 21.70 m (2170 cm) | 4 |
| `CEN-100-01` … `CEN-100-04` | 1.00 m (100 cm) | 21.00 m (2100 cm) | 4 |

**Total: 11 rollos · 231.10 m lineales.**

> **Corrección (2026-08-13, Fase 1):** este documento decía **232.90 m**. Es un error aritmético.
> La suma real del inventario listado arriba es:
> `(3 × 2010) + (4 × 2170) + (4 × 2100) = 6030 + 8680 + 8400 = 23110 cm = 231.10 m`.
> La consulta de validación de la Fase 1 espera **231.10**, no 232.90. Verificado contra la DB.

> **Dónde están estos 11 pliegos (2026-08-13):** sembrados y colgados de la regla de prueba
> **`Alfombra test 2`** (`cmoipz5lp0000l704zvl3nx6h`), no de una regla "Ceniza" — que no existe.
> Ver el aviso de la cabecera.

Cada pliego físico es **independiente**: si se corta de uno de los rollos de 4×20.10, solo baja el
largo de **ese** rollo, no el de los otros dos iguales.

---

## 2. Diagnóstico y análisis de factibilidad

Realizado el 2026-08-12 revisando el código real del repo, no solo la memoria del proyecto.

### 2.1 Correcciones a lo que la memoria asumía

| Lo que la memoria daba por hecho | Lo que hay realmente en el código |
|---|---|
| Bordes = modelos `Borde` + `ConfiguracionBordes` + ruta `/app/bordes` | **Se implementó como `ReglaPersonalizada.bordes Json`** — 4 slots dentro del formulario de la regla. Nunca se creó `/app/bordes`. Es un precedente útil: "datos anexos colgados de la regla" ya funciona. |
| El carrito mixto va a `/api/checkout` | **Falso.** `functions.js:729` rutea **todo** el carrito a `/api/checkout-impermeabilizador` si hay ≥1 item de impermeabilizador, y ese endpoint **también procesa items `tipo:'medida'`** (líneas 138-149). |
| Existe webhook de pago | **No hay ninguna suscripción a webhooks.** `shopify.app.dturkia-custom-size.toml` solo declara `api_version = "2026-07"`. El pago se detecta con **polling desde el tema** (`/api/check-paid`), y solo si el cliente vuelve a la tienda. |

### 2.2 Hallazgos del terreno que condicionan el diseño

1. **La lógica de stock tiene que vivir en los DOS endpoints de checkout.**
   Consecuencia directa de 2.1: `api.checkout.tsx` y `api.checkout-impermeabilizador.tsx`.
   → Obliga a un módulo compartido `app/lib/pliegos.server.ts`.

2. **El item de `localStorage` no guarda `productId` ni `reglaId`.**
   `custom-size-snippet.liquid:955-968` guarda solo `variantId`, `productHandle`, `productTitle`.
   Sin uno de los dos, **el endpoint de checkout no sabe de qué trama es la alfombra**.
   → Cambio obligatorio en el tema (Fase 6).

3. **El payload de "Comprar" no envía el `id` del item.**
   `functions.js:740` arma el array sin `item.id`, que es el candidato natural a clave de
   idempotencia. → Cambio obligatorio en el tema (Fase 7).

4. **El driver `neon()` HTTP no soporta transacciones interactivas** (leer → decidir → escribir).
   Es el hallazgo que define toda la estrategia de concurrencia: **la selección y la reserva tienen
   que caber en una sola sentencia SQL atómica**.

5. **Ya existe UI de error en el mini-cart.**
   `cswMostrarErrorMiniCart()` (`functions.js:705`) — hay dónde mostrar "sin stock" sin inventar
   nada. Pero el handler de error muestra un texto fijo; hay que leer `jqXHR.responseJSON.error`.

6. **No existe ninguna pantalla de admin que lea `PedidoCustom`.**
   La tabla se escribe pero nunca se muestra. Relevante para la decisión 5 (el taller necesita ver
   qué pliego le tocó a cada pedido).

7. **Bug pre-existente:** `api.checkout-impermeabilizador.tsx:237` **no guarda `borde`** en
   `PedidoCustom`, mientras que `api.checkout.tsx:219` sí lo hace. Un carrito mixto pierde el borde
   en la base. Se corrige de paso en la Fase 4 (1 línea).

8. `[webhooks] api_version = "2026-07"` en el TOML mientras el código usa `2025-10`. Hoy es inocuo
   (no hay nada suscrito) y este diseño no necesita webhooks, pero queda anotado.

### 2.3 EL HALLAZGO IMPORTANTE: el límite es por PAR, no por dimensiones separadas

> El límite real **no son** "ancho máximo" y "largo máximo" por separado, sino **el par (ancho, largo)
> conjuntamente.**

Con Ceniza:
- El ancho máximo disponible es **4.00 m** (rollo de 4×20.10).
- El largo máximo disponible es **21.70 m** (rollo de 3×21.70).
- **Pero una alfombra de 3.50 m × 21.00 m no cabe en ningún pliego:** el único rollo con 3.50 m de
  ancho (el de 4 m) solo tiene 20.10 m de largo, y el rollo de 21.70 m solo tiene 3 m de ancho.

Consecuencia práctica: con sliders de máximos independientes, **el cliente puede configurar
combinaciones físicamente imposibles** y llegar hasta "Comprar" para recibir un error.

**Solución adoptada:** `/api/precio` devuelve un arreglo diminuto de **capacidades**
(`[{anchoCm, largoMaxCm}]`, ~3-10 filas, ~60 bytes) y el snippet valida el **par** en cada
movimiento de slider. El checkout revalida de todos modos: el frontend nunca es autoridad.

### 2.4 Relación con los topes ancho/alto de la regla

**Decisión: híbrido.** Los campos manuales `maxAncho`/`maxAlto` de `ReglaPersonalizada` **se
mantienen como tope comercial**, y encima se aplica el tope físico: `min(tope manual, tope físico)`.

Razones:
1. Cero migración y cero cambios en el formulario de reglas, que hoy funciona.
2. El tope físico solo puede **restringir**, nunca ampliar. Si se derivara todo de los pliegos, el
   widget ofrecería alfombras de **20 metros de largo** porque el rollo los tiene.
3. Si se agota un pliego, el tope se ajusta solo; si entra material nuevo, también.

**Nota:** con rotación permitida (decisión 1), el tope físico de un slider pasa a ser casi
irrelevante (una alfombra puede ser "ancha" hasta 21 m si es corta). **La validación del par es la
que realmente manda.**

### 2.5 Fila por pliego físico vs. fila por medida con contador

**Decisión: una fila por pliego físico** (11 filas para Ceniza).

El modelo compacto (`{ancho, largoTotal, unidadesCompletas, largoRestanteDeLaAbierta}`) *parece*
más barato y es **más caro**:

- Necesita lógica extra para "cerrar la unidad abierta y abrir la siguiente", y **esa transición no
  cabe en una sola sentencia SQL atómica** — que es justo lo único delicado de todo el sistema.
- El equipo no puede decir "el rollo 2 está manchado" ni auditar de qué rollo salió cada corte.
- Los rollos son objetos físicos distinguibles en bodega; el modelo debe reflejarlo.

El costo de captura es **el mismo** si el admin ofrece **alta masiva** con el formato real de los
datos: `ancho | largo | cantidad` → genera N filas con código autogenerado.

---

## 3. Decisiones cerradas

Cerradas por el cliente el 2026-08-12. **No reabrir sin decisión explícita.**

| # | Decisión | Detalle |
|---|---|---|
| **1** | **Rotación: SÍ** | Una alfombra puede cortarse rotada. Ej: 100×300 cm puede salir de un rollo de 3 m de ancho consumiendo 100 cm de largo. El selector prueba **ambas orientaciones** y elige la que encaje con el pliego de ancho más cercano. Aplica tanto en la validación del slider como en la lógica de reserva. |
| **2** | **Margen de corte: NO** | Se descuenta el **largo exacto** pedido, sin centímetros extra. |
| **3** | **Sin stock → "Agotado"** | Botón deshabilitado con mensaje. **Nada de "avísame"** ni lista de espera. |
| **4** | **Reserva con expiración de 15 min, por demanda** | El stock se reserva **al pulsar "Comprar"** (al crear el Draft Order). Cada reserva **expira a los 15 minutos**. Liberación **por demanda, NO por cron**: las reservas vencidas se tratan como stock libre **dentro de la misma sentencia SQL de selección** (una condición de tiempo más). **Cero infraestructura extra, sin tareas programadas en Vercel.** Agregar al carrito (localStorage) **NO reserva nada**. |
| **5** | **Código de pliego oculto al cliente** | El código (ej. `CEN-400-02`) **NO** va como property visible del Draft Order. Se guarda **solo en `PedidoCustom`** para que el taller lo vea en el admin de la app. |

### 3.1 Consecuencia técnica de la decisión 4 (importante)

La decisión de expiración a 15 minutos **invalida el diseño original** de "restar `largoRestanteCm`",
por dos razones simétricas:

- Si el stock se descuenta restando un número, **una reserva no puede expirar sola**: habría que
  devolver el largo con un job programado — justo lo que se descartó.
- Y al revés: si la resta expirara sola, **una compra pagada también liberaría su material a los 15
  minutos**, y el sistema **sobrevendería de forma sistemática**.

**Cambio de diseño adoptado: el stock no se resta, se OCUPA.**

```
disponible(pliego) = largoTotalCm
                   − consumo confirmado (reservas 'confirmada' + ajustes manuales)
                   − reservas 'pendiente' con createdAt > now() − 15 min
```

- Se agrega la tabla **`ReservaPliego`**.
- `Pliego.largoRestanteCm` pasa a significar **"largo restante confirmado"**: solo baja al confirmar
  una venta o al hacer un ajuste manual. **No baja con las reservas.**
- Una reserva vencida **deja de ocupar automáticamente sin que nadie haga nada**: es una condición de
  tiempo en el `WHERE`, exactamente como pidió la decisión 4.
- **Compensar es trivial:** `UPDATE ReservaPliego SET estado='anulada'`, en vez de revertir restas.
- **La auditoría sale gratis:** cada reserva es una fila con su `refId`, `draftOrderId` y timestamps.

### 3.2 Cómo se confirma una reserva (sin cron y sin webhooks)

La otra cara de la decisión 4: hay que pasar de "ocupa 15 min" a "ocupa para siempre" cuando el
cliente paga. Tres disparadores, todos **por demanda**:

1. **`/api/check-paid`** — ya hace polling desde el tema y ya consulta el estado del Draft Order.
   Si está `completed` → reservas a `confirmada` + baja `Pliego.largoRestanteCm`. ~10 líneas.
2. **Al inicio de `/api/checkout`** — antes de reservar, se reconcilian contra Shopify las reservas
   **vencidas y sin resolver de esa misma trama**. Esto es lo elegante del diseño: **el único que
   puede sobrevender es el siguiente comprador, y es precisamente él quien dispara la
   reconciliación**. Coste: 0-2 llamadas a Shopify, solo en el clic de compra.
3. **Al abrir `/app/pliegos`** en el admin — self-healing cuando el merchant revisa el stock.

---

## 4. Modelo de datos

### 4.1 Modelos nuevos (Prisma)

```prisma
model Pliego {
  id              String   @id @default(cuid())
  shop            String
  reglaId         String                        // = la trama
  regla           ReglaPersonalizada @relation(fields: [reglaId], references: [id], onDelete: Restrict)
  codigo          String                        // "CEN-400-01" — autogenerado, editable
  anchoCm         Int
  largoTotalCm    Int
  largoRestanteCm Int                           // total − confirmado − ajustes. NO baja con reservas
  activo          Boolean  @default(true)       // false = agotado / de baja / dañado
  nota            String   @default("")
  createdAt       DateTime @default(now())

  @@unique([shop, codigo])
  @@index([shop, reglaId, activo, anchoCm])     // índice que usa el selector
}

model ReservaPliego {
  id            String   @id @default(cuid())
  shop          String
  pliegoId      String
  pliego        Pliego   @relation(fields: [pliegoId], references: [id], onDelete: Restrict)  // ← añadido en Fase 1
  reglaId       String
  refId         String   @unique                // = id del item de localStorage → idempotencia
  largoCm       Int                             // lo que consume del pliego
  anchoPedidoCm Int
  altoPedidoCm  Int
  rotada        Boolean  @default(false)
  estado        String   @default("pendiente")  // pendiente | confirmada | anulada
  draftOrderId  String?
  createdAt     DateTime @default(now())        // + 15 min = vencimiento
  resueltaAt    DateTime?

  @@index([pliegoId, estado, createdAt])        // índice del cálculo de disponibilidad
}

model MovimientoPliego {                        // solo ajustes manuales y altas — auditoría
  id        String   @id @default(cuid())
  shop      String
  pliegoId  String
  pliego    Pliego   @relation(fields: [pliegoId], references: [id], onDelete: Restrict)  // ← añadido en Fase 1
  largoCm   Int
  motivo    String                              // 'alta' | 'ajuste' | 'baja'
  nota      String   @default("")
  createdAt DateTime @default(now())
}
```

### 4.2 Campos nuevos en `PedidoCustom`

```prisma
pliegoId     String?
pliegoCodigo String  @default("")   // snapshot — sobrevive si el pliego se da de baja
rotada       Boolean @default(false)
orderName    String  @default("")   // "#D1042" — para cruzar orden ↔ pliego en el admin
```

> `orderName` es necesario **por la decisión 5**: como el código de pliego ya no viaja en la orden de
> Shopify, el taller tiene que poder cruzar orden ↔ pliego en el admin de la app. Viene gratis en la
> respuesta de creación del Draft Order (`draft_order.name`).

### 4.3 Convenciones del modelo

- **Todo en centímetros enteros (`Int`)**, nunca metros con decimales. 20.10 m → `2010`.
  Evita drift de float en las restas acumuladas y ya es la unidad del resto del sistema
  (`minAncho`, `maxAlto`, sliders). El admin muestra y pide **metros**, y convierte en el borde.
- **`Pliego.reglaId` → `ReglaPersonalizada`.** No hace falta un modelo `Trama` nuevo: el enunciado
  del negocio dice "cada trama = un producto con su regla", y `api.precio` ya resuelve
  `productId → regla`.
  ⚠️ `ReglaPersonalizada.productIds` es un array: si una regla apunta a 3 productos, esos 3
  **comparten stock**. Correcto si son la misma trama. Se resuelve con un **aviso en el admin**,
  no con una restricción.
- **`onDelete: Restrict`** para que no se pueda borrar una regla que tiene pliegos vivos.
- **Nunca `DELETE` de pliegos**, solo `activo = false`, para no romper la trazabilidad histórica.
  Desde la Fase 1 esto está **forzado por la DB**: `ReservaPliego.pliegoId` y
  `MovimientoPliego.pliegoId` tienen FK `ON DELETE RESTRICT` a `Pliego`. El §4.1 original no las
  declaraba; se añadieron porque una reserva huérfana **falsearía en silencio** el cálculo de
  disponibilidad del §5.4 (la `SUM` dejaría de contarla y el pliego parecería más libre de lo que está).
- **`CHECK ("largoRestanteCm" >= 0)`** como red de seguridad final a nivel DB.
- Migración **aditiva pura**, sin backfill: no toca ningún dato existente.

### 4.4 🔷 EL STOCK ES POR TRAMA, NO POR REGLA (2026-08-14)

> **Cambio de modelo pedido por el cliente.** Hasta ahora `Pliego.reglaId` colgaba los rollos de la
> **regla** (= el producto), así que todas las tramas de un producto compartían un pozo común de
> material. **Ya no:** cada trama tiene su propio inventario de rollos, y la validación y la reserva
> se hacen contra los rollos de **la trama que el cliente eligió**.
>
> Donde este documento diga "trama" refiriéndose a la `ReglaPersonalizada` entera (§1.1, §5.0, los
> logs, los nombres de función `reservasDeTrama`/`cortesDeTrama`/`movimientosDeTrama`), **léase
> "regla"**. A partir de aquí *trama* significa el modelo `Trama`.

#### Qué NO cambia

**La lógica de negocio del §5 es exactamente la misma.** `escalonPara()`, `escalones()`,
`evaluar()`, `factible()` y `hayMaterial()` son **funciones puras sobre `Capacidad[]` y no se
tocaron ni una línea**. Escalones, rotación dentro del escalón, asimetría del §5.0.1, reservas de
15 min, expiración por demanda, `FOR UPDATE OF p SKIP LOCKED` e idempotencia por `refId`: idénticos.
**Lo único que cambia es de dónde sale el `Capacidad[]`**: antes de los rollos de la regla, ahora de
los rollos de la trama.

#### Las tramas pasan a ser un modelo real

Hasta hoy las tramas eran entradas de `ReglaPersonalizada.tramas Json` (hasta 4 slots
`{url, nombre}`), **sin identidad propia**. Eso no permite colgarles rollos. Se evaluaron tres
opciones y se eligió la tabla:

| Opción | Por qué se descartó |
|---|---|
| Por **índice** del slot (`Pliego.tramaIndice`) | El formulario reescribe el array entero al guardar. Si el merchant vacía el slot 2, todo se corre y los rollos apuntan a otra trama **en silencio**. |
| Por **nombre** (`Pliego.tramaNombre`) | **Un renombre no se puede detectar.** Como el array se reemplaza entero y las posiciones no son estables, renombrar "Ceniza"→"Alba" y "Alba"→"Ceniza" a la vez es indistinguible de no hacer nada, y los rollos cambian de dueño sin aviso. |
| **Clave estable dentro del Json** (`{id, url, nombre}`) | Resuelve el renombre y era ~2 h más barata, pero **no da integridad referencial**: nada impide borrar el slot de una trama con 11 rollos colgando. |
| ✅ **Tabla `Trama`** | Da identidad estable + `onDelete: Restrict` + baja lógica. Es la misma decisión que ya se tomó para `Pliego` en el §4.3, por la misma razón. |

```prisma
model Trama {
  id          String   @id @default(cuid())
  shop        String
  reglaId     String
  regla       ReglaPersonalizada @relation(fields: [reglaId], references: [id], onDelete: Restrict)
  nombre      String
  url         String   @default("")
  orden       Int      @default(0)
  /// Precio por m² PROPIO de la trama. Sustituye a ReglaPersonalizada.precioPorM2
  /// como fuente del precio. Las FÓRMULAS no cambian, solo de dónde sale el factor.
  precioPorM2 Float    @default(0)
  activa      Boolean  @default(true)   // baja lógica — nunca DELETE
  createdAt   DateTime @default(now())
  pliegos     Pliego[]

  @@unique([reglaId, nombre])
}
```

Y en `Pliego`: **`tramaId String` NOT NULL** con FK `Restrict`, más el índice del selector
`@@index([shop, tramaId, activo, anchoCm])`.

- **`Pliego.reglaId` se conserva.** Es redundante vía `Trama`, pero quitarlo obliga a reescribir
  consultas y FKs sin ganar nada. Queda como denormalización para las vistas por regla.
- **`ReglaPersonalizada.tramas Json` NO se borra.** Queda como columna muerta sin lectores durante
  un release, para que el rollback sea "revertir el código" sin tocar datos. Se limpia después.
- **`prefijoSugerido()` pasa a recibir el nombre de la TRAMA**, no el de la regla: "Ceniza" → `CEN`.
  Los códigos `CEN-*` que ya existían quedan retroactivamente coherentes.

#### El invariante: no hay pliegos sin trama

`Pliego.tramaId` es **NOT NULL**. De ahí salen tres casos limpios, y el tercero es el que garantiza
que nada de lo que ya existe se rompe:

| Caso | Comportamiento |
|---|---|
| Regla **sin tramas** | No hay tramas → no puede haber pliegos → `capacidades` ausente → **el widget funciona como siempre, sin control de stock.** Es la guarda `tienePliegos()` que ya existía |
| Regla con **1 trama** | Se **auto-selecciona** al cargar; el cliente no ve un paso extra |
| Regla con **N tramas** | Cada una con su inventario y su precio |

> **Se descartó** hacer `tramaId` nullable con el significado "pozo común de la regla". Sonaría
> compatible, pero mete un `OR "tramaId" IS NULL` en la sentencia atómica y crea dos caminos de
> código en la única consulta delicada del sistema.

#### ⚠️ El riesgo #1: hay DOS filtros de trama en la sentencia atómica

En `reservarItem()` la trama aparece **dos veces**, y hacen cosas distintas:

```sql
WHERE p."tramaId" = ${tramaId}          -- 1. de qué trama son los candidatos
  ...
  AND p."anchoCm" = (
        SELECT MIN(p2."anchoCm") FROM "Pliego" p2
        WHERE p2."tramaId" = ${tramaId}  -- 2. sobre qué rollos se calcula LA ESCALERA
      )
```

**Si solo se cambia el primero, la escalera se calcula sobre los rollos de todas las tramas** y un
pedido de Ceniza podría asignarse usando el escalón que define un rollo de Alba. Fallo silencioso.
Validado con un fixture de dos tramas de anchos distintos, corriendo el CTE en solo lectura — ver el
apartado de validación del cambio.

#### El precio pasa a ser por trama

`Trama.precioPorM2` sustituye a `ReglaPersonalizada.precioPorM2` como **fuente** del factor.

> ⛔ **Las fórmulas NO se tocaron**, y esto es lo único que hay que verificar al revisar el cambio:
> `Math.round(Math.ceil(ancho/100) * Math.ceil(alto/100) * precioPorM2)` para la alfombra y
> `Math.floor((ancho/100) * (alto/100) * waterproofPorM2)` para el impermeabilizador siguen
> literalmente iguales en `calcular()` y en el handler de compra. Solo cambia **qué valor se le pasa
> como `precioPorM2`**.

`waterproofPorM2` **sigue siendo de la regla**: el impermeabilizador no depende del tejido.

El checkout **no recalcula precios** (toma `precio` del item del carrito), así que este cambio no
toca `api.checkout.tsx` ni `api.checkout-impermeabilizador.tsx` por el lado del precio.

#### Migración de los 11 rollos existentes

**Ninguna fila se borra ni se re-clavea.** `Pliego` conserva su `id`, su `codigo` y su
`largoRestanteCm`; solo gana una columna. De ahí lo importante:

> **`ReservaPliego`, `MovimientoPliego` y `PedidoCustom` no se tocan en absoluto.** Cuelgan de
> `pliegoId`, y `pliegoId` no cambia. Las 6 reservas confirmadas y los 11 movimientos de alta quedan
> exactamente como estaban, sin migrar una sola fila.

Estado de partida verificado en la base antes de migrar: `Alfombra test 2` tenía **una sola trama
completa en el Json, "Ceniza"** (+3 slots vacíos) y **11 pliegos, todos `CEN-*`**. La otra regla
(`Alfombra Medida Personalizada (TEST)`) tenía `tramas: []` y **0 pliegos** — es el caso "regla sin
tramas" en producción, y es el que prueba que nada se rompe.

El paso 4 (asignar los 11 rollos a Ceniza) va **con los ids literales, a mano**, no con una
heurística tipo "si la regla tiene una sola trama, asigna esa": funcionaría hoy y se rompería
callado el día que haya dos. El paso 5 (`SET NOT NULL`) **falla ruidosamente** si quedó algún pliego
sin asignar — es la verificación, no un trámite.

**Reversible:** `DROP COLUMN "tramaId"` + `DROP TABLE "Trama"` y el código anterior vuelve a
funcionar sobre datos intactos.

#### Validación ejecutada (2026-08-14)

**El fixture de dos tramas**, con las escaleras reales leídas de Neon y el CTE corrido **en solo
lectura** (sin `INSERT`): **11/11 casos** correctos, `evaluar()` y el SQL coincidiendo en todos.

Lo importante es que **3 de esos casos detectan el riesgo #1**: se corrió el CTE también con la
versión defectuosa (sin filtro de trama en el `SELECT MIN`) y da un resultado distinto.

| Caso | Correcto | Con el bug |
|---|---|---|
| **Ceniza 350×300** | PERMITE `CEN-400-01` | **BLOQUEA** — `MIN(>=350)` mezclado = 378, que es un rollo de *Alba* |
| **Alba 90×300** | PERMITE `ALB-300-01` rotada | **BLOQUEA** — `MIN(>=90)` mezclado = 100, que es un rollo de *Ceniza* |
| **Ceniza 320×228** | PERMITE `CEN-400-01` | **BLOQUEA** |

**La misma medida da resultados distintos según la trama**, que es el objetivo del cambio:
`250×200` bloquea en Ceniza (su escalón 300 tiene 70 cm) y **vende** en Alba (el suyo tiene 2070);
`390×100` vende en Ceniza (escalón 400) y bloquea en Alba (su rollo más ancho es 382). 4 de 8
medidas de control cambian de veredicto entre tramas.

**Topes por trama**, calculados con la escalera de cada una: Ceniza `400 × 2100`, Alba
**`382 × 2100`** — el tope de ancho de Alba sale de su rollo más ancho, no del de la regla.

**El snippet coincide con el motor**: `evaluarMedida()` extraída del archivo real y corrida contra
las dos escaleras da lo mismo que `evaluar()` en todos los casos.

**Precios de control inalterados** con la fórmula intacta: 250×350 → 840.000 · 100×100 → 70.000 ·
230×230 → 630.000. Son los mismos tres valores que se verificaron el 2026-08-13.

**Guardas nuevas**, probadas sin escribir: restaurar un rollo ya lleno se rechaza · quitar del
formulario una trama con rollos se rechaza nombrándola · dos slots con el mismo nombre se rechazan.

`npm run build` ✅ · `npm run typecheck`: los **mismos 2 errores preexistentes**
(`app._index.tsx`, `shopify.server.ts`), ninguno nuevo · `node --check` de los dos bloques del
snippet y de `functions.js` ✅ · 0 reservas pendientes y 0 pliegos sin trama al terminar.

#### `capacidades` de nivel superior en `/api/precio`: se mantiene, deprecado

El tema **en vivo** (el de la Fase 6, que nunca se pegó) **sí valida medidas hoy** con la regla vieja
agrupada — eso es independiente de `PLIEGOS_MODO`, que solo afecta al checkout. Si el campo
desapareciera, la tienda dejaría de bloquear nada de golpe. Se mantiene tal cual, marcado como
deprecado, y se borra **después** de que el snippet nuevo esté pegado. Así la ventana de transición
es **cero cambio de comportamiento**.

---

## 5. Lógica de selección y reserva

### 5.0 ESCALONES POR ANCHO DE ROLLO

> **Cambio de lógica de negocio del 2026-08-13 (posterior a la Fase 7).** Corrige la regla con la que
> se implementaron las Fases 2 a 7, que era *"sirve cualquier rollo de ancho mayor o igual"*.
>
> 🔶 **CORREGIDO OTRA VEZ EL 2026-08-14 — leer el §5.0.1 antes que nada.** Lo de este apartado sigue
> valiendo, salvo un punto: **el escalón lo fija SIEMPRE el ANCHO PEDIDO**, no cada orientación por su
> lado. La rotación ya no puede cambiar de escalón. Todo lo que este §5.0 y el §5.1 dicen sobre "cada
> orientación calcula su propio escalón" y sobre la simetría **está derogado**.

**Cada ancho de rollo que existe en la trama define un escalón.** Un pedido se asigna al escalón del
**primer ancho de rollo `>=` al ancho requerido**, y **solo puede cortarse de rollos de ESE ancho
exacto**.

```
escalon(x) = MIN("anchoCm") de los pliegos ACTIVOS de la trama con "anchoCm" >= x
```

Con los anchos de `Alfombra test 2` ({100, 300, 400}):

| Ancho pedido | Escalón | Rollos que puede usar |
|---|---|---|
| 1–100 | 100 | solo los de 100 |
| 101–300 | 300 | solo los de 300 |
| 301–400 | 400 | solo los de 400 |
| 401+ | — | ninguno (en esa orientación) |

**Los escalones no están escritos en ninguna parte: se derivan de los anchos que existan.** Si mañana
entra un rollo de 200, aparece el escalón 101–200 y el de 300 pasa a ser 201–300, sin tocar código.

#### La consecuencia que motiva el cambio

**Un escalón sin material NO toma prestado del escalón de arriba.** Con los rollos de 300 en 70 cm y
los de 400 llenos:

- ancho 301–400 → **se vende** (su escalón es el 400, que tiene material).
- ancho 250 → **NO se vende**, aunque sobre rollo de 400.
- si además se agotara el 400: ni 250 ni 350 se venden, pero **ancho ≤ 100 se sigue vendiendo**,
  porque su escalón es otro.

#### Por qué un ancho agotado sigue apareciendo en `capacidades()`

`capacidades()` devuelve **la escalera completa**, incluidos los anchos con `largoMaxCm: 0`. No es
"lo que se puede vender", es la lista de peldaños. Si un ancho seco desapareciera del arreglo, el
escalón se recalcularía sobre el siguiente ancho y un pedido de 250 **volvería a saltar al rollo de
400** — justo lo que esta regla prohíbe.

Consecuencia: **"Agotado" ya no se detecta con `capacidades: []`**, sino con "ningún peldaño con
`largoMaxCm > 0`" (`hayMaterial()`). Un ancho desaparece de la escalera **solo si se da de baja el
último rollo de ese ancho**; agotarlo no lo borra.

#### Rotación × escalones (decisión de Jonas, 2026-08-13)

**Cada orientación se valida contra el escalón del lado que va A LO ANCHO DEL ROLLO**, no contra el
"ancho pedido" del formulario:

| Orientación | Escalón que le aplica | Consume de largo |
|---|---|---|
| Normal | `escalon(ancho)` | `alto` |
| Rotada | `escalon(alto)` | `ancho` |

Es **simétrico en (ancho, alto)**: 250×350 y 350×250 son la misma pieza física, con la misma merma de
ancho de rollo, y el sistema responde lo mismo a las dos. Ejemplo real con el inventario actual:
**250×350 se vende girada en un rollo de 400** (350 va a lo ancho → escalón 400, merma 50, consume
250 de largo), mientras que 250×200 se bloquea (ambos lados caen en el escalón 300, que está seco).

> **La alternativa que se descartó:** que el escalón lo fijara siempre el *ancho pedido*. Rompía la
> simetría — 350×250 se vendería y 250×350 no, siendo la misma alfombra y la misma merma. Se rechazó
> por eso.
>
> 🔶 **Esta alternativa es la que se adoptó el 2026-08-14.** El cliente la pidió expresamente y la
> asimetría es *deseada*: el cliente pide un ancho concreto, y no se le puede servir un corte de otro
> ancho girándolo. Ver §5.0.1.

### 5.0.1 🔶 EL ESCALÓN LO FIJA EL ANCHO PEDIDO (corrección 2026-08-14) — REGLA VIGENTE

Corrección pedida por el cliente sobre la regla del §5.0. **Es la regla que vale hoy**; donde el
§5.0/§5.1 digan otra cosa, manda ésta.

```
escalon = MIN("anchoCm") de los pliegos ACTIVOS de la trama con "anchoCm" >= ANCHO PEDIDO
```

Se calcula **una sola vez, con el ancho que pidió el cliente**, y **toda** la validación y la reserva
ocurren dentro de ese escalón. Si ese escalón está seco, **no se vende, y punto** — da igual el alto.

**La rotación se sigue permitiendo, pero solo DENTRO de ese escalón**, para resolver el *largo*:

| Orientación | Requiere | Consume de largo |
|---|---|---|
| Normal | siempre vale (`ancho <= escalon` por definición) | `alto` |
| Rotada | `alto <= escalon` (el alto va a lo ancho de **ese mismo** rollo) | `ancho` |

**Lo que la rotación ya NO puede hacer:** llevarse la pieza a un rollo de otro ancho.

#### El caso que estaba mal

Con `{100: 2100, 300: 70, 400: 2010}` y un pedido de **228 × 320**:

- Escalón del ancho 228 → **300**, que solo tiene 70 cm. No hay venta.
- La implementación anterior calculaba para la orientación rotada *su propio* escalón sobre el alto:
  `escalon(320) = 400`, con 2010 cm → **la vendía**. Le estaba dando material de 400 a alguien que
  pidió 228 de ancho.

#### La asimetría es intencionada

`228×320` **bloquea** y `320×228` **vende**. No es un defecto: son pedidos distintos, porque el
cliente elige el ancho. Esto **sustituye** la decisión de simetría del 2026-08-13.

#### Matiz que conviene no olvidar

«El escalón 300 está agotado» quiere decir *le quedan 70 cm*, no cero. Así que **250×50 sí se vende**
(consume 50 de largo, y hay 70). Bloquear también eso sería tirar material real. Lo que se bloquea es
todo lo que necesite más largo del que queda en **su** escalón.

### 5.1 Las dos orientaciones (decisión 1)

> ⚠️ **Tabla derogada por el §5.0.1**: la fila "Rotada" ya NO usa `escalon(alto)`. Las dos
> orientaciones usan `escalon(ancho pedido)`, y la rotada además exige `alto <= escalon`.

Se evalúan ambas y **compiten entre sí en una sola lista de candidatos**:

| Orientación | Requiere pliego con | Consume de largo |
|---|---|---|
| Normal | `anchoCm = escalon(ancho)` | `alto` |
| Rotada | `anchoCm = escalon(alto)` | `ancho` |

### 5.2 Criterio de selección (`ORDER BY`)

1. `(anchoCm − anchoRequerido) ASC` → **ancho más cercano** (la regla del cliente, literal).
   Desde el §5.0.1 todos los candidatos son ya del mismo ancho de rollo, así que este criterio
   lo único que decide es **cuál de las dos orientaciones** se usa: gana la que menos largo consume.
2. ~~`anchoCm ASC`~~ → **eliminado el 2026-08-14**: con el escalón fijado por el ancho pedido, todos
   los candidatos comparten `anchoCm` y el criterio era constante.
3. `disponibleCm ASC` → el **rollo más gastado primero**
   (concentra la merma en un rollo en vez de dejar 11 rollos a medias).
4. `id ASC` → determinista.

> **Por qué el criterio 3 importa:** consumir primero el rollo más gastado deja los rollos enteros
> disponibles para los pedidos largos, que son los primeros que se vuelven imposibles de vender.
> La alternativa (repartir entre rollos) deja 11 rollos a medias y ninguna alfombra de 18 m vendible.
> Es una línea de SQL.

> **Nota sobre los criterios 1 y 2:** en el caso sin rotación son equivalentes
> (`anchoRequerido` es constante, ordenar por `anchoCm − const` == ordenar por `anchoCm`).
> Solo se diferencian al comparar candidatos de **orientaciones distintas**.

> **Con escalones (§5.0) el criterio 1 pasa a decidir casi solo entre las dos orientaciones:**
> dentro de una orientación el escalón ya fijó un único ancho posible, así que todos sus candidatos
> tienen la misma merma y el desempate lo hacen los criterios 3 y 4 (rollo más gastado, luego
> código). El `ORDER BY` no se tocó: sigue siendo correcto tal cual.

### 5.3 Verificación del criterio con datos de Ceniza

Pliegos: 3×(400/2010), 4×(300/2170), 4×(100/2100).

| Pedido | Orientación normal | Orientación rotada | Gana | Por qué |
|---|---|---|---|---|
| 100×300 | pliego 100 (merma 0, consume 300) | pliego 300 (merma 0, consume 100) | **Normal, rollo de 1 m** | Empate en merma → rollo más angosto. No quema un rollo de 3 m en una alfombra angosta. |
| 350×400 | pliego 400 (merma 50, consume 400) | pliego 400 (merma 0, consume 350) | **Rotada** | Menos merma y consume menos largo. |
| 250×350 | pliego 300 (merma 50, consume 350) | pliego 400 (merma 50, consume 250) | **Normal, rollo de 3 m** | Empate en merma → preserva los rollos de 4 m. |
| 350×2100 | 400 no alcanza (2010 < 2100) | ninguno ≥ 2100 de ancho | **SIN STOCK** | Correcto: no existe pliego que lo contenga. |

### 5.4 La sentencia atómica

Selección + reserva en **una sola sentencia**: no hay read-then-write, así que **no hay carrera
posible** con el driver HTTP de Neon (cada sentencia es su propia transacción).

```sql
WITH cand AS (
  SELECT p.id, p."anchoCm", o.largo, o.rotada, o."anchoReq",
         p."largoRestanteCm" - COALESCE((
           SELECT SUM(r."largoCm") FROM "ReservaPliego" r
           WHERE r."pliegoId" = p.id
             AND r.estado = 'pendiente'
             AND r."createdAt" > NOW() - INTERVAL '15 minutes'   -- ← expiración por demanda
         ), 0) AS disponible
  FROM "Pliego" p
  CROSS JOIN (VALUES (${ancho}, ${alto}, false),          -- orientación normal
                     (${alto}, ${ancho}, true))           -- orientación rotada
             AS o("anchoReq", largo, rotada)
  WHERE p.shop = ${shop} AND p."reglaId" = ${reglaId} AND p.activo
    -- ↓↓↓ ESCALONES (2026-08-13): el rollo tiene que ser del PRIMER ancho >= al
    -- requerido, no de cualquiera más ancho. NULL (sin ancho suficiente) → sin match.
    AND p."anchoCm" = (
          SELECT MIN(p2."anchoCm") FROM "Pliego" p2
          WHERE p2.shop = ${shop} AND p2."reglaId" = ${reglaId} AND p2.activo
            AND p2."anchoCm" >= o."anchoReq"
        )
    -- ↓↓↓ CORREGIDO EN FASE 2: el filtro de largo va AQUÍ, antes del ORDER BY/LIMIT
    AND p."largoRestanteCm" - COALESCE((
          SELECT SUM(r2."largoCm") FROM "ReservaPliego" r2
          WHERE r2."pliegoId" = p.id AND r2.estado = 'pendiente'
            AND r2."createdAt" > NOW() - make_interval(mins => 15)
        ), 0) >= o.largo
  ORDER BY (p."anchoCm" - o."anchoReq") ASC, p."anchoCm" ASC,
           disponible ASC, p.codigo ASC, p.id ASC
  LIMIT 1
  FOR UPDATE OF p SKIP LOCKED
)
INSERT INTO "ReservaPliego" (id, shop, "pliegoId", "reglaId", "refId", "largoCm",
                             "anchoPedidoCm", "altoPedidoCm", rotada, estado, "createdAt")
SELECT ${id}, ${shop}, c.id, ${reglaId}, ${refId}, c.largo,
       ${ancho}, ${alto}, c.rotada, 'pendiente', NOW()
FROM cand c
ON CONFLICT ("refId") DO NOTHING
RETURNING "pliegoId", "largoCm", rotada;
```

> ### 🔴 Corrección de la Fase 2 — el filtro de largo estaba en el sitio equivocado
>
> La versión original de este documento tenía `WHERE c.disponible >= c.largo` en el `SELECT` de
> **fuera** del CTE, es decir **después del `LIMIT 1`**. Consecuencia: si el pliego de ancho más
> cercano se había quedado sin largo, la consulta devolvía **0 filas (= SIN_STOCK)** en vez de pasar
> al siguiente candidato.
>
> **Reproducido contra la DB real:** con los 4 rollos de 300 cm agotados, un pedido de 250×350
> devolvía `SIN_STOCK` **teniendo 20.10 m libres en cada rollo de 400**. Con el filtro dentro del
> CTE elige `CEN-400-01` rotada (merma 50).
>
> El `LIMIT 1` solo es correcto si **todos** los candidatos que llegan al `ORDER BY` son ya viables.
> Añadido también `p.codigo ASC` como penúltimo criterio de desempate: con `id` siendo un UUID, el
> rollo elegido entre varios idénticos era arbitrario y el QA no podía predecirlo.

- **0 filas devueltas = no hay pliego que sirva** (o el `refId` ya estaba reservado → idempotencia).
- `FOR UPDATE OF p SKIP LOCKED` serializa dos compras simultáneas sobre el mismo rollo **sin
  bloqueos de espera**: la segunda salta al siguiente candidato o devuelve "sin stock".
- **Multi-item:** bucle secuencial, una sentencia por item. La segunda alfombra ya ve el largo
  ocupado por la primera, así que dos piezas que compiten por el mismo rollo se resuelven solas.
- **Compensación:** `UPDATE ReservaPliego SET estado='anulada' WHERE refId = ANY(...)`.

> ✅ **Validado empíricamente en la Fase 2 (2026-08-13)** contra la base real:
> - `FOR UPDATE OF p SKIP LOCKED` **funciona dentro del CTE** pese al `CROSS JOIN` sobre `VALUES` y a
>   la subconsulta agregada. La restricción de Postgres sobre agregados aplica al **nivel superior**
>   de la consulta, no a subconsultas escalares. El `OF p` es imprescindible: acota el bloqueo a
>   filas de `Pliego` y evita el error de intentar bloquear el `VALUES`.
> - Neon HTTP ejecuta cada sentencia como transacción propia: **2 reservas en paralelo** del último
>   tramo → exactamente 1 gana, la disponibilidad nunca queda negativa.
> - La expiración por demanda funciona: una reserva envejecida a 20 min deja de ocupar sin que nadie
>   la toque (2100 → 100 → 2100).

### 5.5 El punto exacto del flujo donde se reserva

```
Cliente configura ─► "Agregar a la bolsa" (localStorage)   ← NO reserva nada
                     └─ el cliente puede tener 5 items 3 días sin ocupar stock

"Comprar" ─► POST /api/checkout  (o /api/checkout-impermeabilizador)
             1. reconciliar(shop, reglaId)      ← resuelve vencidas contra Shopify
             2. reservar() por cada item 'medida'
                └─ falla → anular las ya hechas + 409, NO se crea el Draft Order
             3. crear Draft Order (SIN property de pliego — decisión 5)
                └─ falla → anular todas las reservas + 500
             4. PedidoCustom (pliegoId, pliegoCodigo, rotada, orderName)
                + ReservaPliego.draftOrderId
             5. → invoice_url

Cliente paga ─► /api/check-paid confirma la reserva (permanente)
Cliente NO paga ─► a los 15 min la reserva deja de ocupar, sola
```

**El orden importa:** reservar **antes** de crear el Draft Order significa que nunca existe una orden
sin su pliego asignado. Si se reservara después, un fallo de red dejaría una venta cerrada sin
material.

### 5.6 Por qué NO se usa el webhook `orders/paid`

Es la opción que parece más "correcta" y es la peor aquí:

1. **Entre crear el draft y pagar no habría nada reservado.** Dos clientes pueden pagar los dos por
   los últimos 20 m. Se descubre la sobreventa **después de cobrar** — el peor escenario comercial.
2. **Cuesta real:** declarar la suscripción en el TOML + `shopify app deploy --force` + reinstalar la
   app + ruta nueva con verificación HMAC.
3. **El mapeo orden → pliego no es directo:** el payload de `orders/paid` no trae `draft_order_id`.

---

## 6. Plan de ataque — Fases 1 a 8

**Principio de orden:** backend primero y verificable con datos reales → admin (para que el merchant
pueda ver y corregir **antes** de que el sistema toque ventas) → integración de checkout **en modo
observación** → tema al final (es lo más frágil). En ningún momento hay una fase que rompa
producción.

> ⛔ **Las fórmulas de precio no se tocan en ninguna fase.** `calcular()`, `m2Alfombra`, `m2Real` y
> `api.precio:96-101` quedan intactos. El stock **solo permite o bloquea**, nunca cambia un monto.

| Fase | Qué | Horas | Toca producción |
|---|---|---|---|
| 1 | Modelo + migración + semilla | 2 | Aditiva, sin riesgo |
| 2 | Motor + ruta de diagnóstico | 4 | No |
| 3 | Admin de pliegos | 5 | Solo admin |
| 4 | Checkout ×2 en modo observación | 4 | Sí, desactivado por bandera |
| 5 | `/api/precio` capacidades | 1 | Aditiva |
| 6 | 🔶 Snippet del tema | 3 | Sí |
| 7 | 🔶 `functions.js` | 1.5 | Sí |
| 8 | Activación + QA | 2.5 | Sí |
| | **Total** | **~23 h** | |

> Frente a las ~18 h del análisis original: **+5 h**, casi todas por la decisión 4. La expiración a
> 15 min obliga a cambiar "restar un número" por "tabla de reservas + reconciliación", que es más
> código pero también más seguro.

🔶 = fases que tocan el tema. **Se entregan como archivo completo listo para copiar/pegar**, con
changelog de qué cambió y dónde. Jonas los pega manualmente en el editor de temas de Shopify.

---

### FASE 1 — Modelo de datos, migración y datos semilla

**Qué se hace y en qué archivos**
- `prisma/schema.prisma` — los 3 modelos nuevos de §4.1 + los 4 campos de `PedidoCustom` (§4.2).
- `prisma/migrations/<ts>_pliegos/migration.sql` — SQL manual (convención del proyecto: **no** usar
  `prisma migrate dev`). Aditiva pura + `CHECK ("largoRestanteCm" >= 0)`.
- SQL de semilla con los **11 pliegos de Ceniza**.

**Entregable:** schema actualizado + 1 archivo de migración + 1 SQL de semilla.

Archivos reales entregados el 2026-08-13:
- `prisma/schema.prisma` (modificado)
- `prisma/migrations/20260813000000_pliegos/migration.sql`
- `prisma/seeds/20260813_pliegos_ceniza.sql`
- `prisma/seeds/20260813_pliegos_validacion.sql`

**Validación**
```sql
SELECT codigo, "anchoCm", "largoTotalCm", "largoRestanteCm" FROM "Pliego" ORDER BY codigo;
-- 11 filas: CEN-100-01..04 (100/2100), CEN-300-01..04 (300/2170), CEN-400-01..03 (400/2010)
SELECT COUNT(*), SUM("largoRestanteCm"), SUM("largoRestanteCm")/100.0 FROM "Pliego";
-- 11 | 23110 | 231.10 m   ← corregido, ver §1.5
```
Y que el `CHECK` muerda: un `UPDATE` a −1 debe fallar con
`Pliego_largoRestanteCm_no_negativo`.

**Dependencias:** ninguna. Es la primera.

**De Jonas:** nada pendiente. ✅ Todo ejecutado el 2026-08-13.
- (a) ~~Confirmar qué regla corresponde a Ceniza~~ → **Ceniza no existe y no se va a crear ahora.**
  Decisión del cliente: el MVP corre sobre `Alfombra test 2` (`cmoipz5lp0000l704zvl3nx6h`).
  Ver el aviso de la cabecera.
- (b) ~~`npx prisma migrate deploy`~~ → ✅ aplicada.
- (c) ~~Commit + push~~ → ✅ hecho.

---

### FASE 2 — Motor de selección (backend puro, sin tocar nada en producción)

**Qué se hace y en qué archivos**
- `app/lib/pliegos.server.ts` **(nuevo)** — el corazón. Tres funciones:
  - `capacidades(shop, reglaId)` → `[{anchoCm, largoMaxCm}]` para el frontend.
  - `reservar(shop, reglaId, items[])` → asigna pliego a cada item o falla (sentencia de §5.4).
  - `reconciliar(shop, reglaId)` → resuelve reservas vencidas sin confirmar contra Shopify.
- `app/routes/app.pliegos.debug.tsx` **(nuevo, temporal)** — ruta de diagnóstico autenticada:
  formulario ancho/alto → ejecuta la selección **en seco** (reserva y anula) y muestra pliego
  elegido, orientación, merma y disponibilidad antes/después. **Se elimina en la Fase 8.**

**Entregable:** módulo del motor + ruta de diagnóstico. **Cero impacto en el flujo de compra real.**

**Validación** — matriz completa contra los 11 pliegos de Ceniza, todo por logs `[PLIEGOS]`:

```
[PLIEGOS] reserva refId=test_1 regla=xxx pedido=250x350
[PLIEGOS] candidatos: normal(req>=250,cons=350) rotada(req>=350,cons=250)
[PLIEGOS] elegido CEN-300-01 ancho=300 rotada=false consume=350 disp 2170 → 1820
```

| Caso de prueba | Resultado esperado |
|---|---|
| 100×300 | `CEN-100-01`, no rotada, consume 300 |
| 350×400 | `CEN-400-0x`, **rotada**, consume 350 |
| 250×350 | `CEN-300-0x`, no rotada, consume 350 |
| 350×2100 | `SIN_STOCK` + log con capacidades |
| Mismo `refId` dos veces | 1 sola reserva (la 2ª devuelve la existente) |
| 2 reservas en paralelo del último tramo | 1 gana, 1 `SIN_STOCK`, nunca disponible < 0 |
| Reservar, esperar 16 min, repetir | Vuelve a caber (expiración por demanda) |
| 4 pedidos de 2000 cm con ancho 90 | Los 4 rollos de 1 m, uno cada uno |

**Dependencias:** Fase 1 (tablas + semilla).

**De Jonas:** abrir `/app/pliegos/debug`, recorrer los casos, pasar logs de Vercel si algo no cuadra.

---

#### ✅ Entregado el 2026-08-13

Archivos: `app/lib/pliegos.server.ts` (nuevo) · `app/routes/app.pliegos.debug.tsx` (nuevo, temporal).

**Funciones exportadas:** `capacidades()` · `factible()` · `reservar()` · `anular()` ·
`eliminarReservas()` · `vincularDraftOrder()` · `confirmarPorDraftOrder()` · `reconciliar()` ·
`estadoPliegos()`. Las 4 últimas se dejan listas porque `reconciliar()` comparte el cuerpo de la
confirmación; **nadie las llama todavía** — se cablean en la Fase 4.

**Decisiones tomadas durante la implementación:**

1. **El filtro de largo se movió dentro del CTE.** Bug real del §5.4 original, reproducido y
   corregido. Ver el recuadro rojo del §5.4.
2. **`p.codigo ASC` añadido como 4º criterio de desempate**, antes de `id ASC`. Con UUIDs, el rollo
   elegido entre varios idénticos era impredecible y el QA no podía verificar "eligió CEN-100-01".
3. **`capacidades()` descuenta reservas vigentes**, no usa `largoRestanteCm` a secas como sugería el
   §Fase 5. Si usara el valor confirmado, el widget podría decir "cabe" y el checkout responder
   "sin stock" para la misma medida. Debe ser la **misma fórmula** que el selector.
4. **`capacidades()` devuelve capacidad FÍSICA pura**, sin aplicar el tope comercial de la regla.
   El híbrido `min(comercial, físico)` del §2.4 se resuelve en `/api/precio` (Fase 5). Así el motor
   queda verificable aunque una regla tenga topes mal configurados — que es justo el caso de
   `Alfombra test 2` (`maxAncho`/`maxAlto` = 21). **No se tocó la configuración del producto**; la
   ruta debug muestra un aviso cuando detecta topes < 50 cm.
5. **`reservar()` es todo-o-nada**: si un item del lote no cabe, anula las reservas ya hechas en esa
   misma llamada antes de devolver `SIN_STOCK`. Es el paso 2 del §5.5 encapsulado.
6. **Idempotencia explícita**: ante `ON CONFLICT DO NOTHING` con 0 filas, el módulo consulta si el
   `refId` ya tenía reserva y devuelve la existente con `yaExistia: true`, en vez de un falso
   "sin stock" ante un doble clic o un retry de red.

**Validación ejecutada (toda contra la base real, sin dejar rastro):**

| Caso | Resultado |
|---|---|
| `FOR UPDATE OF p` dentro del CTE | ✅ ejecuta |
| 100×300 | ✅ CEN-100-01 · no rotada · consume 300 · merma 0 |
| 350×400 | ✅ CEN-400-01 · **ROTADA** · consume 350 · merma 0 |
| 250×350 | ✅ CEN-300-01 · no rotada · consume 350 · merma 50 |
| 350×2100 | ✅ SIN_STOCK |
| Mismo `refId` ×2 | ✅ 1 sola reserva, la 2ª devuelve la existente |
| Expiración 15 min | ✅ 2100 → 100 (ocupa) → 2100 (vencida, libera sola) |
| 2 reservas en paralelo del último tramo | ✅ 1 gana, disponibilidad nunca < 0 |
| 4 pedidos 90×2000 | ✅ los 4 rollos de 1 m, uno cada uno |
| Mejor-ancho agotado → siguiente candidato | ✅ cae a CEN-400 en vez de SIN_STOCK |
| `reservar()` todo-o-nada + compensación | ✅ anula la previa al fallar el 2º item |
| `confirmarPorDraftOrder()` baja el stock | ✅ −700 cm exactos |
| Confirmar 2 veces | ✅ idempotente, no descuenta doble |
| `reconciliar()` vencida huérfana | ✅ anulada |
| Estado final de la DB | ✅ 11 pliegos / 23110 cm / 0 reservas |

---

### FASE 3 — Admin de pliegos

**Qué se hace y en qué archivos**
- `app/routes/app.pliegos._index.tsx` **(nuevo)** — resumen por trama: pliegos activos, metros
  restantes, medida máxima vendible, alertas de rollos casi agotados.
- `app/routes/app.pliegos.$reglaId.tsx` **(nuevo)** — gestión de una trama:
  - **Alta masiva** (`ancho | largo | cantidad` → N filas con código autogenerado).
  - Tabla con barra de consumo por rollo.
  - **Ajustar** (edita largo restante + nota obligatoria → `MovimientoPliego`).
  - **Baja / Reactivar**.
  - Pestaña **Reservas** (vigentes / vencidas sin resolver).
  - Pestaña **Cortes** — `PedidoCustom` con `pliegoCodigo`, `orderName`, medidas y si fue rotada.
    ← **Esta es la pantalla del taller, exigida por la decisión 5.**
- `app/routes/app.tsx` — 1 línea de nav: `<s-link href="/app/pliegos">Stock de pliegos</s-link>`.
- Reconciliación por demanda al abrir el índice (self-healing sin cron).

UI con web components `s-*` y estilos inline, reusando el patrón de `app.reglas.nueva.tsx`
(**Polaris NO está instalado**). Metros con 2 decimales en pantalla, `Int` cm en la DB.

**Entregable:** 2 rutas nuevas + nav. Ya se puede cargar y auditar todo el inventario a mano.

**Validación:** dar de alta las tramas reales; comprobar que los códigos no chocan; ajustar un largo
y ver el `MovimientoPliego`; dar de baja un rollo y confirmar que el motor (ruta debug de la Fase 2)
deja de elegirlo.

**Dependencias:** Fases 1 y 2.

**De Jonas:** cargar el inventario real de al menos 2 tramas — **incluido el largo restante medido de
los rollos ya empezados**. Commit + push.

---

#### ✅ Entregado el 2026-08-13

Archivos: `app/routes/app.pliegos._index.tsx` (nuevo) · `app/routes/app.pliegos.$reglaId.tsx` (nuevo) ·
`app/routes/app.tsx` (1 línea de nav) · `app/lib/pliegos.server.ts` (funciones de administración).

**Se añadió una 4ª pestaña, Movimientos**, que el plan no pedía explícitamente pero que el §4.1 exige
de facto: `MovimientoPliego` existe para auditar altas y ajustes, y sin pantalla no se puede
consultar. Es de solo lectura.

**Decisiones de implementación:**

1. **El SQL de administración vive en `pliegos.server.ts`**, no en las rutas: `altaMasiva()`,
   `ajustarPliego()`, `cambiarActivo()`, `reservasDeTrama()`, `cortesDeTrama()`,
   `movimientosDeTrama()`, `prefijoSugerido()`. Las rutas quedan de presentación.
2. **Códigos autogenerados** con formato `PREFIJO-ancho-NN`. El correlativo arranca después del mayor
   existente **para ese prefijo + ese ancho**, así que dos altas seguidas del mismo ancho continúan
   (01-03, luego 04-05) y otro ancho arranca su propia serie. `ON CONFLICT DO NOTHING` cubre la
   carrera de dos altas simultáneas: se crean menos filas y la UI informa cuántas se omitieron.
   El prefijo se sugiere desde el nombre de la trama (`Alfombra test 2` → `ALF`) y es editable.
3. **El admin pide metros, la DB guarda centímetros enteros** (§4.3). La conversión ocurre en el
   `action`, en el borde exacto.
4. **`motivo` de `MovimientoPliego` se extendió con `'reactivacion'`**, además de las
   `'alta' | 'ajuste' | 'baja'` del §4.1. El campo es texto libre; una reactivación no es un ajuste
   ni una baja y mezclarlas hacía la auditoría ilegible. En baja/reactivación `largoCm = 0` porque el
   cambio de estado no mueve el largo; en `'ajuste'` se guarda el **delta** (negativo si se descontó).
5. **Ajuste con validación de rango**: rechaza negativos, rechaza superar `largoTotalCm` (si entró
   material nuevo, se da de alta otro rollo) y rechaza el no-cambio. La nota es obligatoria.
6. **Reconciliación por demanda en el índice** (§3.2.3). Solo hace trabajo si hay reservas vencidas:
   una `SELECT` barata y salida temprana. Si resolvió algo, releva el estado y lo avisa en pantalla.
7. **La ruta `/app/pliegos/debug` de la Fase 2 convive con `/app/pliegos/:reglaId`** sin conflicto:
   React Router puntúa el segmento estático por encima del dinámico. Verificado en el build.

**Validación ejecutada contra la base real (todo revertido al terminar):**

| Caso | Resultado |
|---|---|
| `prefijoSugerido()` con tildes, dígitos y fallback | ✅ ALF · CEN · ANI · PLG |
| Alta masiva 3 rollos | ✅ QAT-400-01/02/03 |
| 2ª alta del mismo ancho continúa el correlativo | ✅ 04, 05 |
| Otro ancho arranca su propia serie | ✅ QAT-100-01/02 |
| Movimientos `'alta'` por rollo | ✅ 7/7 |
| Ajuste 20.10 → 15.00 m | ✅ delta −510 cm registrado con su nota |
| Ajuste que supera el total / negativo / sin cambio | ✅ los 3 rechazados |
| Baja → el motor deja de elegir el rollo | ✅ SIN_STOCK |
| Baja → `capacidades()` deja de ofrecerlo | ✅ `[]` |
| Reactivar → vuelve a elegirse | ✅ |
| Baja y reactivación auditadas | ✅ 2 movimientos |
| Estado final de la DB | ✅ 11 pliegos / 23110 cm / 11 movimientos / 0 reservas |

---

### FASE 4 — Integración en el checkout, en MODO OBSERVACIÓN

**Qué se hace y en qué archivos**
- `app/routes/api.checkout.tsx` **y** `app/routes/api.checkout-impermeabilizador.tsx`
  (**los dos**, porque el carrito mixto rutea al segundo — ver §2.2.1): el flujo de §5.5.
- **`PLIEGOS_MODO`** (env var en Vercel): `off` (ignora todo) · **`log` ← se despliega así** ·
  `bloqueo`. En modo `log`, si no hay pliego **la venta pasa igual** y solo queda el registro.
  Así esta fase se valida con pedidos reales **sin ningún riesgo comercial** y sin depender todavía
  del tema.
- `app/routes/api.check-paid.tsx` — al detectar `completed`, confirmar reservas
  (`estado='confirmada'` + restar `Pliego.largoRestanteCm`), idempotente. ~10 líneas en un endpoint
  que ya consulta exactamente eso.
- De paso: arreglar el bug pre-existente de `borde` en `api.checkout-impermeabilizador.tsx:237`
  (§2.2.7), 1 línea.

**Entregable:** reserva real funcionando end-to-end, desactivada por bandera.

**Validación** — en logs de Vercel, con compras de prueba reales:
```
[PLIEGOS] MODO=log
[PLIEGOS] reconciliación regla=xxx: 1 vencida → confirmada (draft 998 completed)
[PLIEGOS] reserva OK refId=dturkia_123_17.. pliego=CEN-400-02 rotada=false consume=350
[api.checkout] Draft order creado. ID: 1044  →  PedidoCustom pliegoCodigo=CEN-400-02
[PLIEGOS] SIN_STOCK (MODO=log, la venta NO se bloqueó) pedido=350x2100
```
Chequeos: pagar → reserva `confirmada` y `largoRestanteCm` baja · abandonar → a los 15 min el
material vuelve a estar disponible (verificable en la ruta debug) · 2 alfombras en un pedido →
2 reservas · carrito mixto con impermeabilizador → también reserva.

**Dependencias:** Fases 1-3. **Debe ir después del admin**: no hay entorno local, todo va directo a
producción, así que el merchant tiene que poder ver y corregir el stock antes de que el sistema
empiece a consumirlo.

**De Jonas:** crear `PLIEGOS_MODO=log` en Vercel; hacer 2-3 compras de prueba (una pagada, una
abandonada) y pasar los logs.

---

#### ✅ Entregado el 2026-08-13

Archivos: `app/lib/pliegos.server.ts` (orquestación) · `app/routes/api.checkout.tsx` ·
`app/routes/api.checkout-impermeabilizador.tsx` · `app/routes/api.check-paid.tsx`.

**El hallazgo que obligó a añadir algo al plan:** el tema todavía **no manda `reglaId`** (llega en la
Fase 6) ni **`item.id`** (Fase 7). Sin eso, en la Fase 4 no habría nada que reservar y la fase sería
imposible de validar con compras reales, que es justo su propósito.
**Solución:** el backend resuelve la trama por su cuenta — `item.variantId` → producto (una llamada
GraphQL para todas las variantes del carrito) → la `ReglaPersonalizada` que lo tenga en `productIds`.
El orden de preferencia es `item.reglaId` → resolución por variante → item legacy sin reserva. Además
sigue siendo útil después de la Fase 7, como red para los items que queden en el localStorage de
clientes.

**Guarda de seguridad crítica:** antes de reservar se comprueba que la trama **tenga pliegos
cargados**. Sin esto, en `MODO=bloqueo` una trama sin inventario cargado devolvería `SIN_STOCK`
siempre y bloquearía todas sus ventas. Con la guarda, una trama sin pliegos simplemente no tiene
control de stock, que es lo que dice el §7.4.

**Idempotencia degradada hasta la Fase 7:** sin `item.id`, el `refId` se genera (`auto_<uuid>`), así
que un doble clic crearía dos reservas. Se registra en el log cada vez que ocurre. En `MODO=log` es
inocuo; conviene pasar a `bloqueo` solo después de la Fase 7.

**`orderName`** se toma de la respuesta de Shopify: `draft_order.name` en REST y el campo `name`
añadido a la mutación GraphQL. Es lo que permite cruzar orden ↔ pliego en la pestaña Cortes.

**Bug pre-existente corregido** (§2.2.7): `api.checkout-impermeabilizador.tsx` no guardaba `borde` en
`PedidoCustom`. Añadido.

> ⚠️ **Diferencia relacionada que NO se tocó:** ese mismo endpoint tampoco añade el `Borde` como
> `customAttribute` de la línea del Draft Order, mientras que `api.checkout.tsx` sí lo hace como
> `property`. Es decir, en un carrito mixto el borde ya no se pierde en la base, pero sigue sin verse
> en la orden de Shopify. Cambiarlo altera lo que ve el cliente en su pedido, así que queda a
> decisión de Jonas.

**Comportamiento por modo, verificado:**

| | `off` | `log` | `bloqueo` |
|---|---|---|---|
| Reserva | no | sí | sí |
| Venta sin stock | pasa | **pasa** (solo registra) | rechazada con 409 |
| Trama sin pliegos | pasa | pasa | **pasa** (guarda de seguridad) |
| Default si la env var no existe | ✅ | | |

**Validación ejecutada contra la base real (sin crear Draft Orders en Shopify, todo revertido):**

| Caso | Resultado |
|---|---|
| `MODO=off` no escribe nada | ✅ |
| Resolución `variantId` → trama sin `reglaId` | ✅ reservó CEN-300-01 |
| Item legacy sin `reglaId` ni `variantId` | ✅ pasa sin reservar |
| `MODO=log` con item imposible | ✅ NO bloquea |
| `MODO=bloqueo` con el mismo caso | ✅ 409 + mensaje al cliente |
| `MODO=bloqueo` compensa lo ya reservado | ✅ 0 pendientes |
| Trama sin pliegos en `bloqueo` | ✅ no bloquea |
| Ciclo reservar → vincular → pagar → confirmar | ✅ −350 cm |
| Confirmar dos veces (polling de check-paid) | ✅ idempotente |
| Fallo del draft → `anular()` libera el material | ✅ 1820 → 2170 |
| Estado final de la DB | ✅ 11 pliegos / 23110 cm / 0 reservas |

> **Nota de comportamiento en `log`:** `reservar()` es todo-o-nada **por trama**. Si un carrito lleva
> un item viable y otro imposible de la misma trama, en modo `log` no queda asignado ninguno de los
> dos (se compensa el primero antes de registrar el SIN_STOCK). Es deliberado: `log` debe ensayar
> exactamente lo que hará `bloqueo`, no una variante más permisiva.

---

### FASE 5 — `/api/precio` devuelve capacidades

**Qué se hace y en qué archivos**
- `app/routes/api.precio.tsx` — añadir al JSON: `reglaId`, `capacidades: [{anchoCm, largoMaxCm}]`
  y los topes ya acotados (`min(tope comercial, tope físico)` — ver §2.4).

```sql
SELECT "anchoCm", MAX("largoRestanteCm") AS "largoMaxCm"
FROM "Pliego"
WHERE shop = ? AND "reglaId" = ? AND activo AND "largoRestanteCm" > 0
GROUP BY "anchoCm" ORDER BY "anchoCm";
```

Es **aditivo**: el snippet actual ignora los campos que no conoce, así que esta fase **no puede
romper nada**.

**Entregable:** respuesta ampliada del endpoint.

**Validación:** `curl` directo al endpoint; comparar `capacidades` contra la tabla de la Fase 3.
Un pliego dado de baja debe desaparecer del arreglo.

**Dependencias:** Fases 1-3.

**De Jonas:** nada. Commit + push.

---

#### ✅ Entregado el 2026-08-13

Archivo: `app/routes/api.precio.tsx`.

**Tres estados distintos en la respuesta, y la diferencia importa:**

| Estado | Respuesta | Efecto en el widget |
|---|---|---|
| La trama no tiene pliegos | `capacidades` **ausente** | Comportamiento actual intacto, sin control de stock |
| Tiene pliegos, sin material | `capacidades: []` | **Agotado** |
| Tiene material | `capacidades: [...]` | Valida el par (§2.3) |

Todo va envuelto en `try/catch`: si el cálculo de stock falla por lo que sea, se omite `capacidades` y
el widget sigue funcionando exactamente como antes. **El stock nunca puede tumbar el precio.**

**Tope híbrido (§2.4)** — `min(tope comercial, tope físico)`. El tope físico se calcula **con
rotación**: una pieza de lado X cabe si algún rollo tiene ese ancho **o** si su largo lo permite
cortándola girada, así que el tope es `max(anchoCm, largoMaxCm)` sobre todas las capacidades. Con el
inventario actual da 2170 cm. Si la trama está agotada **no** se acotan los topes a 0: eso dejaría el
slider inservible; el "Agotado" lo comunica el arreglo vacío.

---

### 🔧 `Alfombra test 2` — topes comerciales corregidos (2026-08-13)

**El campo `maxAncho`/`maxAlto` está en CENTÍMETROS.** Verificado por dos vías independientes:
- El formulario del admin etiqueta los campos como *"Ancho máximo (cm)"* (`app.reglas.nueva.tsx`).
- El snippet los imprime literalmente como `regla.maxAncho + ' cm'` y los usa como `min`/`max` de los
  sliders (`custom-size-snippet.liquid:813-821`).

La regla tenía `maxAncho = 21` y `maxAlto = 21`, es decir **21 centímetros**: alguien tecleó metros
en un campo de centímetros. Con el híbrido de esta fase, eso habría dejado el widget ofreciendo
alfombras de hasta 21 × 21 cm y **ningún pedido habría llegado nunca al motor de pliegos**.

**Corregido a `maxAncho = 400`, `maxAlto = 2100`** (solo esos dos campos, con `UPDATE` directo):
- **400 cm** es el ancho del rollo más ancho del inventario de prueba.
- **2100 cm** deja el slider manejable y, sobre todo, permite configurar `350 × 2100`, que es
  **físicamente imposible** con este inventario y por tanto demuestra en vivo el hallazgo del §2.3:
  ambas dimensiones caben por separado pero el **par** no.

Es dato del producto de prueba, no una fórmula. **No se tocó `precioPorM2` ni ninguna fórmula**;
verificado que los precios no cambian: 250×350 → 840.000, 100×100 → 70.000, 230×230 → 630.000.
`minAncho`/`minAlto` se dejaron en 1 (no bloquean nada y `precio_desde` no varía, porque tanto 1 cm
como 50 cm redondean al mismo m²).

**Validación ejecutada** contra el loader real: `reglaId` y `capacidades` presentes, topes híbridos
400/2100, `factible()` correcto en los 5 casos clave (incluido `350×2100` → falso), precios
inalterados, y la trama sin pliegos omite `capacidades` conservando sus topes 500×500.

---

### FASE 6 🔶 — Tema: `custom-size-snippet.liquid`

Primera fase que toca el tema. Se entrega el **archivo completo listo para copiar/pegar** + changelog
de qué cambió y en qué bloque.

**Qué se hace**
1. Guardar **`reglaId`** en el item de `csw_pending_orders` (viene de `/api/precio`).
   *Sin esto el backend no sabe de qué trama es la alfombra* (§2.2.2).
2. **Validación del par** en cada movimiento de slider, con rotación:
   `factible = ∃ cap: (cap.ancho ≥ A ∧ cap.largoMax ≥ L) ∨ (cap.ancho ≥ L ∧ cap.largoMax ≥ A)`
   → si no: deshabilitar `#csw-agregar` + mensaje "Esta medida no está disponible en esta trama".
3. Si `capacidades` viene vacío → estado **Agotado** (decisión 3), botón deshabilitado.
4. **Compatibilidad:** si `capacidades` no viene (regla sin pliegos cargados) → comportamiento actual
   intacto, sin bloquear nada.

⛔ No se toca `calcular()` ni ninguna fórmula de precio.

**Entregable:** `custom-size-snippet.liquid` completo + lista de cambios por bloque.

**Validación** — consola del navegador:
```
[CSW] capacidades: [{400,2010},{300,2170},{100,2100}]
[CSW] factible(250x350)=true
[CSW] factible(350x2100)=false → botón deshabilitado
```
Y confirmar que **el precio mostrado no cambió** en ninguna medida.

**Dependencias:** Fase 5 (necesita `capacidades` y `reglaId` en la respuesta).

**De Jonas:** copiar el snippet al editor de temas de Shopify y probar en la página de producto de
Ceniza.

---

#### ✅ Entregado el 2026-08-13

Archivo: `tema-dturkia/snippets/custom-size-snippet.liquid`.
Copia versionada en `dturkia-custom-size/tema-entregas/custom-size-snippet.liquid`.

**Changelog por bloque:**

| # | Dónde | Qué cambió |
|---|---|---|
| 1 | HTML, tras `#csw-error` | Nuevo `<p id="csw-stock">` para el aviso de medida no disponible / agotado |
| 2 | `<style>`, tras `.csw-error` | Nuevas `.csw-stock` y `.csw-stock--agotado` |
| 3 | JS, antes de `mostrarError()` | Nuevas `cabeEnCapacidades()` y `mostrarStock()` |
| 4 | JS, en el `.then` tras leer `data.regla` | Lee `reglaId`, `capacidades`, y deriva `controlDeStock` y `tramaAgotada` |
| 5 | JS, tras `calcular(...)` | Nueva `revisarDisponibilidad()` + primera llamada |
| 6 | JS, listeners `input` de los dos sliders | Añadida llamada a `revisarDisponibilidad()` |
| 7 | JS, inicio del click de `#csw-agregar` | Red de seguridad: `if (!revisarDisponibilidad()) return;` |
| 8 | JS, los 3 sitios que escriben en `csw_pending_orders` | Añadido `reglaId` al item |

**Los tres estados**, tal como los distingue el widget:

```js
var capacidades    = data.capacidades;             // puede ser undefined
var controlDeStock = Array.isArray(capacidades);   // false = trama sin pliegos
var tramaAgotada   = controlDeStock && capacidades.length === 0;
```

- `undefined` → **comportamiento actual intacto**, el botón nunca se deshabilita.
- `[]` → botón deshabilitado + **"Agotado"**.
- `[...]` → se valida el par en cada movimiento de slider.

**La validación del par, con las dos orientaciones** (decisión 1):

```js
var normal = (c.anchoCm >= anchoCm && c.largoMaxCm >= altoCm);
var rotada = (c.anchoCm >= altoCm  && c.largoMaxCm >= anchoCm);
```

⛔ **No se tocó `calcular()` ni ninguna fórmula de precio.** Los cambios son puramente de
habilitación de botón, aviso y un campo extra en localStorage.

**Validación:** sintaxis de los dos bloques `<script>` verificada con `node --check`, y
`cabeEnCapacidades()` extraída del archivo real y probada contra las capacidades de producción:
250×350 ✓ · 350×400 ✓ (rotada) · **350×2100 ✗** (el caso del §2.3) · 400×2010 ✓ · 400×2100 ✗ ·
100×2170 ✓ (rotada) · `[]` → false.

---

### FASE 7 🔶 — Tema: `functions.js`

**Qué se hace**
1. En el payload de `csw-comprar` (`functions.js:740`): añadir `id: item.id` (clave de idempotencia)
   y `reglaId: item.reglaId`.
2. En el handler de error (`functions.js:788`): leer `jqXHR.responseJSON.error` para mostrar el
   mensaje real de stock en vez del genérico.
3. **Items legacy:** los que ya están en el localStorage de clientes **no traen `reglaId`** → el
   backend los deja pasar registrando `[PLIEGOS] item legacy sin reglaId, sin reserva`.
   Ventana transitoria, se vacía sola.

**Entregable:** `functions.js` completo para copiar/pegar + changelog de las 3 zonas tocadas.

**Validación** — consola: `[CSW] POST payload:` debe incluir `id` y `reglaId`; forzar un `SIN_STOCK`
y ver el mensaje correcto bajo el botón Comprar.

**Dependencias:** Fase 6 (el snippet debe estar guardando `reglaId` primero).

**De Jonas:** copiar `functions.js` al editor de temas.

---

#### ✅ Entregado el 2026-08-13

Archivo: `tema-dturkia/assets/functions.js`.
Copia versionada en `dturkia-custom-size/tema-entregas/functions.js`.

**Changelog por bloque — solo 2 zonas tocadas, ambas dentro del handler
`$('body').on('click', '#minicart .csw-comprar', …)`:**

| # | Dónde | Qué cambió |
|---|---|---|
| 1 | `var customItems = arr.map(…)` (~línea 740) | Añadidos `id: item.id \|\| null` y `reglaId: item.reglaId \|\| null` al principio del objeto |
| 2 | `error:` del `$.ajax` (~línea 800) | Lee `jqXHR.responseJSON.error` (con fallback a parsear `responseText`) y lo muestra; si no hay mensaje del servidor, cae al genérico de siempre |

**Contrato verificado** contra los dos endpoints: ambos leen `refId: item.id` y
`reglaId: item.reglaId`. Los nombres coinciden.

> **La idempotencia se arregla del todo con esta fase, incluso para los items viejos.** El snippet
> **siempre** ha guardado un `id` en cada item de `csw_pending_orders`; lo que faltaba era que
> `functions.js` lo enviara. En cuanto se pegue este archivo, todos los items del localStorage —
> nuevos y antiguos — viajan con su `id`, y el `refId @unique` de `ReservaPliego` empieza a proteger
> contra el doble clic. Esto **levanta la advertencia de la Fase 4** de no pasar a `MODO=bloqueo`
> antes de la Fase 7.
>
> `reglaId` sí falta en los items antiguos, pero eso lo cubre el backend resolviendo la trama desde
> `variantId`.

**Validación:** `node --check assets/functions.js` OK.

---

### 🔶 CAMBIO DE LÓGICA — Escalones por ancho de rollo (2026-08-13, tras la Fase 7)

Cambio de **regla de negocio**, no corrección de un bug: la implementación de las Fases 2–7 hacía
*"sirve cualquier rollo de ancho mayor o igual"*, y el negocio funciona por **escalones cerrados**
(§5.0). Se cambió en los **tres** sitios a la vez, porque si el widget, el motor y el checkout no
comparten exactamente la misma regla, se contradicen entre ellos.

**Archivos tocados**

| Archivo | Qué cambió |
|---|---|
| `app/lib/pliegos.server.ts` | `p."anchoCm" >= o."anchoReq"` → `= (SELECT MIN(...) …)` en la sentencia atómica · `capacidades()` deja de filtrar los anchos secos (`HAVING > 0` fuera, `GREATEST(…,0)` dentro) · nuevas `escalonPara()`, `escalones()`, `hayMaterial()` · `factible()` reescrita por escalones · logs `[PLIEGOS]` muestran el escalón de cada orientación |
| `app/routes/api.precio.tsx` | "Agotado" pasa de `capacidades.length === 0` a `!hayMaterial()` · el tope físico híbrido se calcula **solo** sobre escalones con material |
| `app/routes/app.pliegos._index.tsx` | Chips de capacidad → **escalones** (`ancho 101–300 cm → …` / `SIN MATERIAL` en rojo) · "mayor lado vendible" solo sobre escalones con material |
| `app/routes/app.pliegos.$reglaId.tsx` | Igual, en la línea de capacidad de la pestaña Pliegos |
| `app/routes/app.pliegos.debug.tsx` | Muestra la escalera completa además del `capacidades()` crudo |
| `tema-entregas/custom-size-snippet.liquid` 🔶 | La regla de escalones en JS + el aviso movido bajo los sliders (ver changelog abajo) |

`functions.js` **no se tocó**: su contrato (`id`, `reglaId`, leer el error del servidor) no cambia.

**Lo que NO se tocó:** fórmulas de precio, reservas, expiración de 15 min, confirmación al pagar,
`PLIEGOS_MODO`, alta/ajuste/baja, pestañas Reservas · Cortes · Movimientos, `ORDER BY` del selector,
`FOR UPDATE OF p SKIP LOCKED` e idempotencia por `refId`.

#### Changelog del snippet (Fase 6 revisada) — por bloque

| # | Dónde | Qué cambió |
|---|---|---|
| 1 | HTML, tras el `.csw-slider-group` del **alto** | Aquí vive ahora `<p id="csw-stock">`, antes del bloque del impermeabilizador |
| 2 | HTML, tras `#csw-agregar` | De ahí se **quitó** el `<p id="csw-stock">` (el botón sigue deshabilitándose igual) |
| 3 | `<style>` | `.csw-stock` reescrita: caja con fondo, borde izquierdo y `margin-bottom` 20px. Va prefijada con `#csw-root` porque el tema define `.product .description p { line-height:1.9em; padding-bottom:20px }` y por especificidad le ganaría |
| 4 | JS, zona de stock | Nuevas `escalonPara()` y `hayMaterial()`; `cabeEnCapacidades()` reescrita por escalones |
| 5 | JS, antes de `mostrarStock()` | Nueva `colocarAvisoStock()`: reubica el aviso bajo los sliders **en runtime**, una sola vez. Es una red por si el snippet vivo del tema tiene otro orden de markup |
| 6 | JS, `.then` de `/api/precio` | `tramaAgotada` pasa de `capacidades.length === 0` a `!hayMaterial(capacidades)` |

#### Validación ejecutada (2026-08-13)

**Motor, contra la base real**, ejecutando `pliegos.server.ts` de verdad (reserva y borra el rastro).
Inventario del momento: 100→2100 · **300→70** · 400→2010.

| Caso | Resultado |
|---|---|
| 250×200 · 250×2000 · 299×200 | ✅ **SIN_STOCK** — el escalón 300 seco no salta al 400 (antes reservaba CEN-400) |
| 350×300 · 400×300 · 301×900 | ✅ CEN-400 — el escalón con material sí vende |
| 100×300 · 50×50 · 90×2000 | ✅ CEN-100 — el escalón de abajo sigue intacto |
| 250×350 | ✅ CEN-400 **ROTADA**, consume 250 (350 va a lo ancho → escalón 400) |
| 350×250 | ✅ CEN-400 — simétrico del anterior |
| 401×100 | ✅ CEN-100 ROTADA, consume 401, merma 0 |
| 350×2100 · 2200×2200 | ✅ SIN_STOCK — sin escalón por ningún lado |
| `factible()` vs. motor | ✅ **coinciden en los 14 casos** — widget y checkout no pueden contradecirse |

**Matriz de la Fase 2, con inventario completo** (11 pliegos sembrados en la regla `…w7aeerly` y
borrados al terminar): 100×300 → VRF-100-01 · 350×400 → VRF-400-01 ROTADA · 250×350 → VRF-300-01 ·
350×2100 → SIN_STOCK · idempotencia ✅ · 4×(90×2000) → 4 rollos distintos ✅ · todo-o-nada ✅.
**Ningún caso ya validado cambió de resultado.**

**Snippet:** `node --check` de los dos bloques `<script>` ✅ · `cabeEnCapacidades()` **extraída del
archivo real** y corrida contra los mismos 14 casos → idéntica al motor ✅ · orden del markup
verificado (aviso tras el slider de alto, antes del impermeabilizador) ✅.

**Estado de la base tras validar:** 11 pliegos · 13 659 cm · 0 reservas pendientes · sin rastro.

> ⚠️ **Ventana de inconsistencia hasta que Jonas pegue el snippet:** con el backend nuevo y el
> snippet viejo en el tema, el widget seguiría ofreciendo el salto de escalón y el checkout lo
> rechazaría. Hoy es inocuo porque `PLIEGOS_MODO` no existe en Vercel (= `off`), pero **el snippet
> debe pegarse antes de poner `log` o `bloqueo`.**
>
> **Esa ventana se materializó el mismo día. Ver el apartado siguiente.**

---

### 🔴 INCIDENTE — «el widget no valida nada» (2026-08-13)

**Síntoma reportado:** en la tienda, con los rollos de 300 en 0.70 m, medidas como **264×1051** y
**156×1051** no bloqueaban el botón. Se probó en incógnito y el snippet nuevo se daba por pegado.

**Causa raíz — confirmada, no supuesta:** **la tienda seguía sirviendo el snippet ANTERIOR.** El
paste no llegó al tema publicado. Evidencia recogida directamente de producción:

1. `GET /api/precio` real para ese producto devuelve **correctamente**
   `capacidades: [{100,2100},{300,70},{400,2010}]` y `reglaId`. El backend nunca fue el problema.
2. El HTML servido por `https://dturkia.com/products/alfombra-test-2` **no contiene** `escalonPara`,
   `hayMaterial` ni `colocarAvisoStock`, y **sí contiene** `c.anchoCm >= anchoCm` — la regla vieja.
   El `<p id="csw-stock">` seguía después del botón (markup viejo).
3. El bloque `<script>` servido es **idéntico byte a byte** al de la entrega de la Fase 6
   (18 620 bytes; la versión de escalones son 20 960).

**Por qué el síntoma parecía «no valida nada»:** la validación **sí corría**, con la regla vieja
`∃ cap: anchoCm >= ancho && largoMax >= alto`. Para 264×1051 el rollo de 400 la satisface
(`400 >= 264` y `2010 >= 1051`), así que devolvía "cabe". La regla vieja solo bloquea cuando **ninguna**
capacidad alcanza, por eso casos como 350×2100 sí se bloqueaban y estos no.

Reproducido en frío con las capacidades reales, ejecutando **las dos funciones extraídas de sus
archivos**: 264×1051 y 156×1051 → vieja **permite**, nueva **bloquea**. El motor del backend ya
respondía `SIN_STOCK` a ambas.

**Descartado:** que `/api/precio` no devolviera capacidades (las devuelve), que el widget saliera de
la app extension (`extensions/` no contiene nada del JS de stock: el widget vivo sale del snippet del
tema), y que fuera caché.

#### Fix — que el error no pueda volver a ser invisible

El arreglo de fondo es pegar el archivo correcto. Como el tema no está en git y esto ya ha fallado
dos veces, el snippet ahora **se identifica solo**:

| # | Bloque | Qué se añadió |
|---|---|---|
| 1 | JS, primera línea del IIFE | `CSW_VERSION = '2026-08-13-escalones'` y un `console.log` destacado. **Si esa línea no sale en la consola del producto, el archivo pegado no es el vigente.** Diagnóstico en 2 segundos |
| 2 | JS, `.then` de `/api/precio` | `[CSW] capacidades recibidas: …` + la escalera ya interpretada (`ancho 1-100 → largo ≤ 2100 · …`), o el aviso de que la trama no tiene pliegos |
| 3 | JS, `cabeEnCapacidades()` | Un log por validación con el escalón de cada orientación, su capacidad y el veredicto: `[CSW] validando 264x1051 \| normal: escalon(264)=300 capEscalon=70 pedido=1051 → no \| rotada: escalon(1051)=— … => NO DISPONIBLE, deshabilitando botón` |
| 4 | JS, listeners de los sliders | Unificados en `sincronizarMedidas()` y enganchados a `input` **y** `change` nativos **y**, si `window.jQuery` existe, también por jQuery. El tema Merlí propaga cambios con `.trigger('change')`, que no despierta un `addEventListener` nativo — no era la causa aquí, pero es una vía real de fallo en este tema |
| 5 | JS, tras la primera validación | `MutationObserver` sobre el `disabled` del botón: si algo lo re-habilita por fuera y la medida no es vendible, se vuelve a deshabilitar |

**Validación ejecutada:** sintaxis de los dos bloques ✅ · 264×1051 y 156×1051 → vieja permite /
nueva bloquea ✅ · no se rompe lo vendible (350×300, 100×300, 90×2000, 250×350 rotada) ✅ ·
250×200 y 350×2100 siguen bloqueados ✅ · motor del backend `SIN_STOCK` en los dos casos ✅ ·
0 reservas residuales.

**Además:** `tema-dturkia/snippets/custom-size-snippet.liquid` (la copia local del tema, que estaba en
la versión vieja e idéntica a la entrega de la Fase 6) quedó sincronizada con la entrega nueva.

> **Cómo comprobar de un vistazo qué versión está viva:** abrir la página de producto → consola →
> buscar `[CSW] snippet`. Si no aparece, o aparece otra fecha, el tema tiene un archivo distinto al
> de `tema-entregas/`.

---

### 🔶 CORRECCIÓN DE REGLA — El escalón lo fija el ancho pedido (2026-08-14)

Cambio de **regla de negocio** pedido por el cliente, no un bug de implementación: la lógica de
escalones del 2026-08-13 dejaba que la **rotación cambiara de escalón**, y con eso vendía material de
un ancho a quien había pedido otro. La regla vigente está en el **§5.0.1**.

**El caso concreto que estaba mal en producción** (inventario 100→2100 · 300→**70** · 400→2010):
`228 × 320` se permitía porque, girada, el alto 320 caía en el escalón 400, que sí tenía material.
Debía bloquear: el ancho 228 pertenece al escalón 300 y el 300 está seco.

**Los tres sitios, cambiados a la vez** — si el widget, el motor y el checkout no comparten la misma
regla, se contradicen:

| Archivo | Qué cambió |
|---|---|
| `app/lib/pliegos.server.ts` | En la sentencia atómica, el escalón pasa de `>= o."anchoReq"` (por orientación) a `>= ${anchoCm}` (**el ancho pedido, constante**), y se añade `o."anchoReq" <= p."anchoCm"` para que la rotada tenga que caber a lo ancho de **ese** rollo · `factible()` reescrita sobre la nueva `evaluar()`, que devuelve escalón + veredicto + **motivo en texto** · `ORDER BY`: fuera `p."anchoCm" ASC` (era constante) · logs `[PLIEGOS]` con el escalón del ancho pedido y el motivo del bloqueo |
| `app/routes/api.precio.tsx` | Los topes de slider dejan de ser un único `topeFisico`: **`maxAncho` ya no puede venir del largo de un rollo** (la rotación no saca el ancho de su escalón), solo del mayor ancho de rollo con material. `maxAlto` sigue siendo el mayor de ancho y largo |
| `tema-entregas/custom-size-snippet.liquid` 🔶 | `evaluarMedida()` nueva, espejo exacto de `evaluar()` · `cabeEnCapacidades()` delega en ella · log `[CSW]` con escalón, largo disponible del escalón y motivo · `CSW_VERSION` → `2026-08-14-escalon-por-ancho-pedido` |
| `app/routes/app.pliegos.debug.tsx` | Columna nueva **"Escalón del ancho · motivo"** · `MATRIZ` recalibrada con los casos de regresión |

`functions.js` **no se tocó**: su contrato no cambia.

**Lo que NO se tocó:** fórmulas de precio, reservas, expiración de 15 min, confirmación al pagar,
`PLIEGOS_MODO`, alta/ajuste/baja, `FOR UPDATE OF p SKIP LOCKED`, idempotencia por `refId`.

#### Validación ejecutada (2026-08-14)

Escalera **real leída de Neon** en el momento de validar: `[{100, 2100}, {300, 70}, {400, 2010}]`
(los 4 rollos de 300 en 70 cm; CEN-400-01 en 959 cm).

**Motor** — `pliegos.server.ts` compilado con esbuild y ejecutado de verdad, 12 casos: **12/12 ✅**.
**SQL** — el CTE de candidatos, contra la base real y **en solo lectura** (sin `INSERT`), 9 casos: **9/9 ✅**.

| Caso | Escalón | Resultado | |
|---|---|---|---|
| **228×320** | 300 (70 cm) | **BLOQUEA** — el alto 320 no cabe a lo ancho del rollo de 300 | ✅ era el bug |
| **250×200** | 300 (70 cm) | **BLOQUEA** — normal necesita 200, girada 250 | ✅ |
| **350×300** | 400 (2010) | PERMITE — `CEN-400-01`, no rotada, consume 300 | ✅ |
| **90×300** | 100 (2100) | PERMITE — `CEN-100-01`, consume 300 | ✅ |
| 100×350 | 100 (2100) | PERMITE — el ejemplo del cliente | ✅ |
| 300×60 / 300×71 | 300 (70 cm) | PERMITE / BLOQUEA — el corte exacto en el límite | ✅ |
| 250×50 | 300 (70 cm) | PERMITE — quedan 70 cm reales, no cero | ✅ (ver §5.0.1) |
| 301×10 | 400 | PERMITE — 301 sube de escalón porque no hay rollo de 300 tan ancho | ✅ |
| 401×100 | — | BLOQUEA — no existe rollo de ancho ≥ 401 | ✅ |
| **320×228** | 400 (2010) | PERMITE — la **asimetría buscada**, inverso de 228×320 | ✅ |

`evaluar()` y el SQL **coinciden en todos los casos**, y la versión JS del snippet es una traducción
literal de `evaluar()`. `npm run build` ✅. `npm run typecheck`: los 2 errores que quedan son
preexistentes y de otros archivos (`app._index.tsx`, `shopify.server.ts`).

> ⚠️ **Sigue abierta la ventana de inconsistencia:** hasta que Jonas pegue el snippet nuevo en el
> tema, el widget valida con la regla vieja. Es inocuo mientras `PLIEGOS_MODO` no exista en Vercel
> (= `off`), pero **el snippet debe pegarse antes de poner `log` o `bloqueo`.** Comprobación: en la
> consola de la página de producto debe salir la línea `[CSW] snippet …`.
>
> ⚠️ **La versión a pegar ya NO es ésta.** Ese mismo día, la Fase 3 (rediseño del widget) volvió a
> tocar el snippet y la versión vigente pasó a ser **`2026-08-14b-layout-tramas-carrusel`**, que
> incluye esta corrección de escalones. Pegar la versión `…-escalon-por-ancho-pedido` a estas alturas
> sería retroceder. Ver `BITACORA_SESION_2026-08-14.md` §3.

---

### FASE 8 — Activación y QA end-to-end

**Qué se hace:** `PLIEGOS_MODO=bloqueo`; eliminar `/app/pliegos/debug`; cargar el inventario real de
todas las tramas restantes.

**Validación — recorrido completo:**

| # | Prueba | Esperado |
|---|---|---|
| 1 | Medida imposible en el slider | Botón deshabilitado, nunca llega al checkout |
| 2 | Compra normal → pagar | Reserva → confirmada, `largoRestanteCm` baja, pliego visible en pestaña Cortes |
| 3 | Compra → abandonar 16 min | Material disponible otra vez, sin tocar nada |
| 4 | Compra → abandonar → pagar a los 20 min | La reconciliación del siguiente checkout la confirma |
| 5 | Dos compras del último tramo | Una pasa, la otra ve "Agotado" |
| 6 | Trama sin stock | Widget en Agotado |
| 7 | Carrito mixto (medida + impermeabilizador) | Reserva igual, por el otro endpoint |
| 8 | **Precios** | **Idénticos a hoy en 5 medidas de control** |

**Dependencias:** todas las anteriores.

**De Jonas:** cambiar la env var, recorrer la matriz, cargar el resto del inventario.

---

## 7. Riesgos y mitigaciones

### 7.1 Riesgos técnicos

| Riesgo | Mitigación | Coste |
|---|---|---|
| **Descuento doble** (doble clic en Comprar, retry de red) | `refId @unique` en `ReservaPliego` con el `id` del item de localStorage + `ON CONFLICT DO NOTHING`. La 2ª llamada devuelve la reserva existente. | El índice. Requiere que `functions.js` mande `item.id` (Fase 7). |
| **Reserva que no ocurre** | Reservar **antes** de crear el Draft Order (§5.5). Es imposible tener orden sin reserva; el caso inverso (reserva sin orden) se limpia solo a los 15 min. | Estructural, 0 extra. |
| **Concurrencia / dos pedidos, mismo pliego** | Sentencia única de §5.4 + `FOR UPDATE OF p SKIP LOCKED` + `CHECK >= 0`. | 0 extra. |
| **Pedidos que no se pagan** | Expiración automática a los 15 min por condición de tiempo en el `WHERE`. Sin cron, sin job, sin nada. | 0 extra. |
| **Falla la creación del Draft Order tras reservar** | Compensación: `UPDATE ReservaPliego SET estado='anulada'`. | 1 sentencia. |
| **Devolución / cancelación** | **No se repone automáticamente** — la tela ya se cortó, el largo se perdió de verdad. Solo botón manual "Ajustar" para el caso de cancelación antes de cortar. | 0 extra (mismo botón). |
| **Items legacy sin `reglaId`** | El backend los deja pasar con log de advertencia. Ventana transitoria. | 0 extra. |

### 7.2 Riesgo residual conocido — el caso del "pago en el minuto 14"

> Si un cliente paga en el minuto 14, **nunca vuelve a la tienda**, y además **nadie más compra esa
> trama** ni **nadie abre el admin**, ese material figura como libre hasta que ocurra cualquiera de
> esas tres cosas.

**Por qué se acepta:** en ese lapso el material solo puede sobrevenderse si aparece otro comprador —
y es **precisamente él quien dispara la reconciliación** al inicio de `/api/checkout` (§3.2.2). O
sea, el mecanismo se activa exactamente en el momento en que el riesgo se materializa.

**Cómo se cerraría del todo:** webhook `orders/paid` (~2 h extra: TOML + `shopify app deploy --force`
+ reinstalación + ruta con HMAC).
**Recomendación: no hacerlo** salvo que el problema aparezca en la práctica.

### 7.3 Riesgo operativo — EL MÁS IMPORTANTE

> **El sistema es exactamente tan veraz como la persona que carga el largo restante.**

Cortes por WhatsApp, ventas en el local, muestras, mermas y errores de corte **no pasan por la app** y
desincronizan el stock **igual que el enfoque de "m² totales" que se descartó**.

**Mitigación:** el campo "largo restante" es editable a mano desde el admin y cada ajuste queda
registrado en `MovimientoPliego` con nota obligatoria. Es **corregible, no automático**.

**Esto no se resuelve programando.** Requiere disciplina del equipo.

### 7.4 Otras dependencias que pueden encarecer

| # | Dependencia | Nota |
|---|---|---|
| 1 | **Carga inicial de datos** | Alguien tiene que **medir físicamente** el largo restante de cada rollo ya empezado. Rollos enteros: ~15 min por trama con el alta masiva. |
| 2 | **Sin integración con el inventario de Shopify** | Deliberado: Shopify no sabe modelar "metros lineales de un rollo específico". El stock vive solo en la app. Consecuencia: los reportes de inventario de Shopify seguirán mostrando estos productos como stock infinito. |
| 3 | **Tema no versionado** | `custom-size-snippet.liquid` y `functions.js` no están en git y se copian a mano. **Decisión del cliente: no es bloqueante**, se entregan archivos completos para copiar/pegar. Sin contingencia extra presupuestada. |
| 4 | **Reglas con varios `productIds`** | Comparten stock. Se resuelve con aviso en el admin, no con restricción (§4.3). |

---

## 8. Registro de avance

### Estado actual

| | |
|---|---|
| **Fase actual** | ✅ **Fases 1-7 COMPLETADAS** (2026-08-13) + **cambio de lógica a escalones** (§5.0) + **corrección: el escalón lo fija el ancho pedido** (§5.0.1, 2026-08-14). Todo el código está en producción; falta activarlo. |
| **Bloqueantes** | Ninguno. |
| **Acción pendiente de Jonas (2 cosas)** | **(a)** Pegar en el editor de temas de Shopify **`snippets/custom-size-snippet.liquid` Y `assets/functions.js`** (versión **`2026-08-14d-sin-impermeabilizador`**, que incluye todo lo anterior: escalones, Fase 3, stock/precio por trama y el impermeabilizador oculto) **y comprobar en la consola del producto que sale `[CSW] snippet 2026-08-14d-sin-impermeabilizador`** — el 2026-08-13 el paste no llegó al tema publicado y la tienda siguió validando con la regla vieja. **(b)** Crear `PLIEGOS_MODO=log` en Vercel → Settings → Environment Variables → Production, y redeploy. |
| **Estado si no se hace nada** | Con `PLIEGOS_MODO` sin definir el modo es `off`: el control de stock no hace absolutamente nada y la tienda se comporta igual que antes. Nada está activo por accidente. |
| **Datos en producción** | `Alfombra test 2` (`cmoipz5lp0000l704zvl3nx6h`, topes comerciales 400×2100 cm) con **2 tramas**: · **Ceniza** — 11 rollos `CEN-*`, **12 764 cm** restantes, escalones **1–100 → 2100 · 101–300 → 70 · 301–400 → 2010**, topes 400×2100 · **Alba** — 11 rollos `ALB-*`, **15 600 cm** (enteros), escalones **1–80 → 270 · 81–300 → 2070 · 301–378 → 2040 · 379–380 → 2100 · 381–382 → 2100**, topes **382**×2100. Las dos a 70 000/m² (**el de Alba es placeholder, pendiente de confirmar**). 6 reservas `confirmada`, 22 movimientos `alta`. La otra regla (`Alfombra Medida Personalizada (TEST)`) sigue **sin tramas y sin pliegos**: es el caso de control de que nada se rompe. |
| **Pendiente de QA** | En `MODO=log`, y ahora **por trama**: `250×200` debe **bloquear en Ceniza** y **vender en Alba**; `390×100` al revés (vende en Ceniza, bloquea en Alba); `228×320` sigue bloqueando en Ceniza. Además: elegir trama habilita los sliders y muestra precio; cambiar de trama reajusta topes (Alba tope 382); auto-selección con una sola trama; botón **Restaurar**; compra pagada; compra abandonada; carrito mixto. Logs `[PLIEGOS]` en Vercel (traen la trama, el escalón y el motivo) + `[CSW]` en el navegador + pestañas Reservas y Cortes. |
| **Siguiente entregable** | **Fase 8** (no arrancada, se hace con Jonas): `PLIEGOS_MODO=bloqueo`, eliminar `/app/pliegos/debug`, y la matriz de QA end-to-end del plan. |

### Historial

| Fecha | Fase | Qué se completó | Notas |
|---|---|---|---|
| 2026-08-12 | — | Análisis de factibilidad aprobado | Enfoque pliego por pliego; descartado el de m² totales |
| 2026-08-12 | — | 5 decisiones cerradas por el cliente | Ver §3 |
| 2026-08-12 | — | Plan de 8 fases aprobado | Ver §6 |
| 2026-08-12 | — | Bitácora creada | Este documento |
| 2026-08-13 | **1** | Código completo — schema + migración + semilla + validación | Migración verificada contra `prisma migrate diff` (coincide exacta). Corregido el total de §1.5: 231.10 m, no 232.90 m. |
| 2026-08-13 | — | **Supuesto corregido: Ceniza no existe** | Verificado en Neon + Shopify. Decisión del cliente: el MVP corre sobre `Alfombra test 2`. Ceniza queda como paso futuro. Ver aviso de la cabecera. |
| 2026-08-13 | **1** | ✅ **FASE 1 COMPLETADA** — migración aplicada, 11 pliegos sembrados, validaciones aprobadas | `migrate deploy` OK · 11 pliegos / 23110 cm / 231.10 m sobre `Alfombra test 2` · 11 movimientos `alta` · CHECK y las 3 FK `RESTRICT` verificadas mordiendo. Añadidas las FK de `ReservaPliego.pliegoId` y `MovimientoPliego.pliegoId` (no estaban en el §4.1 original). |
| 2026-08-13 | **2** | ✅ **FASE 2 COMPLETADA** — motor `app/lib/pliegos.server.ts` + ruta `/app/pliegos/debug` | Sentencia atómica validada contra la base real (matriz §5.3, idempotencia, expiración, concurrencia, reparto de rollos). **Bug encontrado y corregido en el §5.4**: el filtro de largo estaba después del `LIMIT 1` y devolvía SIN_STOCK teniendo stock. `FOR UPDATE OF p` confirmado dentro del CTE. Sin cablear a checkout → cero impacto en ventas. |
| 2026-08-13 | **2** | ✅ QA de Fase 2 aprobado por Jonas | Matriz corrida en `/app/pliegos/debug` sobre `Alfombra test 2`: 6/6 casos verdes, 0 reservas residuales. |
| 2026-08-13 | **3** | ✅ **FASE 3 COMPLETADA** — admin `/app/pliegos` + `/app/pliegos/$reglaId` + nav | Alta masiva con código correlativo, ajuste con nota obligatoria, baja/reactivación (nunca DELETE), pestañas Reservas · Cortes · Movimientos, y reconciliación por demanda al abrir el índice. Validado contra la base real y revertido. Sigue sin tocar el flujo de compra. |
| 2026-08-13 | **3** | ✅ QA de Fase 3 aprobado por Jonas | La pantalla carga y muestra los 11 rollos correctamente. |
| 2026-08-13 | **4** | ✅ **FASE 4 COMPLETADA** — reserva integrada en los DOS endpoints de checkout, modo observación | `PLIEGOS_MODO=off\|log\|bloqueo` con default `off`. Confirmación en `/api/check-paid`. Corregido el bug del `borde` en `api.checkout-impermeabilizador.tsx`. **Añadido al plan:** resolución de trama desde `variantId`, porque el tema aún no manda `reglaId` (Fase 6) y sin eso la fase no se podía validar. **Guarda de seguridad:** una trama sin pliegos nunca bloquea. Los 3 modos validados contra la base real. |
| 2026-08-13 | **5** | ✅ **FASE 5 COMPLETADA** — `/api/precio` devuelve `reglaId` + `capacidades` + topes híbridos | Aditivo y envuelto en try/catch: el stock nunca tumba el precio. **Corregidos los topes de `Alfombra test 2`**: el campo es cm y estaba en 21 (metros tecleados en campo de cm) → 400 × 2100. Sin tocar fórmulas; precios verificados idénticos. |
| 2026-08-13 | **6** | ✅ **FASE 6 COMPLETADA** — `custom-size-snippet.liquid`: guarda `reglaId`, valida el par con rotación, estado Agotado | Entregado para copiar/pegar; copia versionada en `tema-entregas/`. Compat: si `capacidades` no viene, comportamiento actual intacto. Sin tocar `calcular()`. **Pendiente: que Jonas lo pegue en el editor de temas.** |
| 2026-08-13 | **7** | ✅ **FASE 7 COMPLETADA** — `functions.js`: envía `id` + `reglaId`, muestra el error real de stock | Solo 2 zonas tocadas. Copia versionada en `tema-entregas/`. La idempotencia queda arreglada incluso para items viejos (el snippet siempre guardó `id`; faltaba enviarlo) → levanta la advertencia de la Fase 4. **Pendiente: que Jonas lo pegue en el editor de temas.** |
| 2026-08-13 | **§5.0** | 🔶 **CAMBIO DE LÓGICA — escalones por ancho de rollo** | Regla de negocio nueva: un pedido solo usa rollos de **su** escalón (el primer ancho >= al requerido) y un escalón seco **no** salta al de arriba. Cambiado a la vez en `capacidades()`, en la sentencia atómica de `reservar()` y en el snippet, para que widget y checkout no se contradigan. Rotación: cada orientación usa el escalón del lado que va a lo ancho del rollo (decisión de Jonas — simétrico en ancho/alto). `capacidades()` pasa a devolver **la escalera completa**, incluidos los anchos secos, y "Agotado" se detecta con `hayMaterial()`. Verificado contra la base real: 250 se bloquea con los de 300 en 70 cm, 301–400 sigue vendiendo, y **ningún caso de las Fases 2–4 cambió de resultado**. **Pendiente: que Jonas pegue el snippet nuevo.** |
| 2026-08-13 | **UI** | ✅ Aviso de "medida no disponible" movido **debajo de los sliders** | Antes salía junto al botón y obligaba a hacer scroll. Ahora aparece entre el slider de alto y el bloque del impermeabilizador, como caja con fondo y borde. El botón se sigue deshabilitando igual. Incluye reubicación en runtime por si el markup del tema divergió. |
| 2026-08-13 | **🔴** | **Incidente: «el widget no valida nada»** — la tienda servía el snippet ANTERIOR | El paste no llegó al tema publicado: el HTML de producción no tenía `escalonPara` y su bloque `<script>` era idéntico byte a byte al de la Fase 6. `/api/precio` devolvía las capacidades correctamente; el backend nunca falló. Con la regla vieja, 264×1051 pasaba porque el rollo de 400 satisface `>=`. **Fix:** el snippet ahora declara `CSW_VERSION` y la imprime en consola, más logs `[CSW]` de capacidades y de cada validación, listeners por `input`+`change`+jQuery, y `MutationObserver` que re-deshabilita el botón. |
| 2026-08-14 | — | ⚠️ **Campo `tramas` nuevo en `ReglaPersonalizada`** (migración `20260814000000_tramas`) — **ajeno a este módulo** | Es la sección "Tramas" del admin: hasta 4 `{url, nombre}`, mismo patrón que `bordes`. **Ojo con el nombre:** aquí "trama" significa la `ReglaPersonalizada` entera; ese campo son solo 4 imágenes dentro de ella. Aditivo, no afecta a pliegos ni a `capacidades()`. Ver `BITACORA_SESION_2026-08-14.md` §2. |
| 2026-08-14 | **§5.0.1** | 🔶 **CORRECCIÓN DE REGLA — el escalón lo fija el ANCHO PEDIDO** | Pedida por el cliente. La rotación **ya no puede cambiar de escalón**: el escalón se calcula una sola vez con el ancho pedido y la rotación solo resuelve el largo dentro de él (exigiendo además `alto <= escalon`). **Caso que estaba mal:** `228×320` se vendía porque, girada, el alto 320 saltaba al escalón 400. **Deroga la decisión de simetría del 2026-08-13**: ahora `228×320` bloquea y `320×228` vende, y la asimetría es intencionada. Cambiado a la vez en la sentencia atómica, en `evaluar()`/`factible()`, en los topes de `/api/precio` (`maxAncho` ya no puede venir del largo de un rollo) y en el snippet. Validado con la escalera real `[{100,2100},{300,70},{400,2010}]`: motor **12/12**, SQL en solo lectura **9/9**, `build` ✅. **Pendiente: que Jonas pegue el snippet** (la versión vigente pasó a ser `2026-08-14b-layout-tramas-carrusel` con la Fase 3 del mismo día). |
| 2026-08-14 | — | ⚠️ **Fase 3 (rediseño del widget) volvió a tocar el snippet** — ajeno a este módulo | Layout nuevo, selector de tramas, carrusel y fix móvil. **La versión del snippet a pegar pasa a ser `2026-08-14b-layout-tramas-carrusel`**, que ya incluye la corrección de escalones. La lógica de stock NO se tocó: `pliegos.server.ts` intacto, `revisarDisponibilidad()` sin cambios, y la trama obligatoria solo bloquea *además* del stock, nunca desbloquea. Ver `BITACORA_SESION_2026-08-14.md` §3. |
| 2026-08-14 | **§4.4** | 🔷 **CAMBIO DE MODELO — EL STOCK ES POR TRAMA** (migración `20260814200000_stock_por_trama`) | Pedido por el cliente. Los rollos colgaban de la REGLA y todas sus tramas compartían un pozo común; ahora cada `Trama` tiene su inventario y su `precioPorM2`. Las tramas dejan de ser un Json sin identidad y pasan a ser **tabla real** con `onDelete: Restrict` y baja lógica — se descartaron identificar por índice (el form reescribe el array) y por nombre (**un renombre es indetectable** y cambiaría de dueño los rollos). `Pliego.tramaId` NOT NULL. **La lógica de negocio no cambió**: escalones, rotación, reservas de 15 min y expiración son funciones puras sobre `Capacidad[]`; solo cambió de dónde sale ese arreglo. **Migración sin pérdida:** ninguna fila borrada ni re-clavada, `ReservaPliego`/`MovimientoPliego`/`PedidoCustom` **intactos** (cuelgan de `pliegoId`, que no cambia); los 11 `CEN-*` asignados a Ceniza con ids literales y `SET NOT NULL` como verificación. **Riesgo #1 (los DOS filtros de trama en la sentencia atómica) cubierto y probado**: fixture de 2 tramas, 11/11, con 3 casos que fallan si falta el filtro del `SELECT MIN`. Se dio de alta la trama **Alba** con sus 11 rollos. `capacidades` de nivel superior de `/api/precio` se mantiene deprecado para no dejar la tienda sin control antes del paste. **Pendiente: que Jonas pegue los 2 archivos del tema** (`2026-08-14c-stock-y-precio-por-trama`). |
| 2026-08-14 | **admin** | ✅ Botón **Restaurar** por rollo | Devuelve el rollo a 0% consumido (`largoRestanteCm = largoTotalCm`) con `MovimientoPliego` motivo `'restauracion'` y nota obligatoria, igual que Ajustar. Es para resetear el stock tras el QA sin dar de baja y volver a dar de alta el rollo, que cambiaría su código y rompería la trazabilidad de los cortes. **No toca las reservas**: una pendiente vigente sigue ocupando hasta que venza. |
| 2026-08-14 | **🔴 fix** | **El botón Restaurar «se trababa»** — no era un handler perdido | Síntoma reportado: funcionaba la primera vez y después no respondía, primero en Alba y luego en todas las tramas. **Causa real:** el botón llevaba `disabled={largoRestanteCm >= largoTotalCm}` y **no decía por qué**. Tras restaurar los rollos de Ceniza quedaban todos al 100% → todos deshabilitados; y en Alba solo un rollo estaba consumido, los otros 10 nacían llenos. Un control muerto y mudo se lee como roto. Agrava la confusión que **la barra de consumo se pinta con `disponibleCm`** (descuenta reservas vigentes) mientras restaurar solo puede mover `largoRestanteCm`, **que las reservas no tocan**: un rollo puede verse consumido y estar lleno de verdad. **Fix:** el botón ya nunca va `disabled` — siempre abre el panel, y el panel explica si no hay nada que restaurar, con los dos números y qué ocupan las reservas. Se marca `Restaurar ✓` en gris cuando ya está al 100%. **Fix secundario:** al cambiar de `$tramaId` React Router reutiliza el componente, así que `useState` no se reiniciaba y las filas desplegadas quedaban apuntando a pliegos de la trama anterior; se limpian con un `useEffect` sobre `trama.id`. **Reproducido el flujo completo dos vueltas** (comprar+restaurar Ceniza → comprar+restaurar Alba → volver a Ceniza): 26/26 ✅, las reservas confirmadas intactas y sin dejar rastro. |
| 2026-08-14 | **tema** | ✅ Impermeabilizador **oculto** en el producto de medida personalizada | Se apaga en `waterproofActivo`, la única variable de la que ya colgaban la sección, `wpChecked`, la preselección de `editWp` y el listener del checkbox. **`calcular()` no se tocó**: solo recibe `false`. Afecta únicamente a esta plantilla — el snippet solo se monta en productos con tag `medida-personalizada`; el impermeabilizador de los productos normales vive en `extensions/custom-size-widget/` y sigue igual. Reversible con `CSW_IMPERMEABILIZADOR = true`. Snippet → `2026-08-14d-sin-impermeabilizador`. |
| | **8** | ⬜ Pendiente | Va **después** de este cambio: activar `PLIEGOS_MODO=bloqueo` sobre un modelo que estaba a punto de cambiar habría sido trabajo tirado. |

### Cómo actualizar esta bitácora

Al cerrar cada fase:
1. Marcar la fila de la fase en el **Historial** con ✅, la fecha y una nota de una línea.
2. Actualizar **Estado actual** (fase actual, bloqueantes, siguiente entregable).
3. Actualizar la fecha de "Última actualización" en la cabecera.
4. Si algo se descubrió durante la fase que contradiga este documento, **corregir la sección
   correspondiente** — la bitácora es la fuente de verdad, no un registro histórico inmutable.
