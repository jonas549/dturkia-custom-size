# BITÁCORA — Módulo de Control de Stock por Pliego

**Proyecto:** dturkia-custom-size (D'Turkia · `dturkia.myshopify.com`)
**Iniciada:** 2026-08-12
**Estado:** ✅ **Fases 1-4 COMPLETADAS** — checkout integrado en modo observación. Falta que Jonas cree `PLIEGOS_MODO=log` en Vercel
**Última actualización:** 2026-08-13

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

---

## Índice

1. [Contexto del negocio](#1-contexto-del-negocio)
2. [Diagnóstico y análisis de factibilidad](#2-diagnóstico-y-análisis-de-factibilidad)
3. [Decisiones cerradas](#3-decisiones-cerradas)
4. [Modelo de datos](#4-modelo-de-datos)
5. [Lógica de selección y reserva](#5-lógica-de-selección-y-reserva)
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

- **El ancho manda:** una alfombra solo cabe en un pliego cuyo ancho sea `>=` al ancho requerido.
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

---

## 5. Lógica de selección y reserva

### 5.1 Las dos orientaciones (decisión 1)

Se evalúan ambas y **compiten entre sí en una sola lista de candidatos**:

| Orientación | Requiere pliego con | Consume de largo |
|---|---|---|
| Normal | `anchoCm >= ancho` | `alto` |
| Rotada | `anchoCm >= alto` | `ancho` |

### 5.2 Criterio de selección (`ORDER BY`)

1. `(anchoCm − anchoRequerido) ASC` → **ancho más cercano** (la regla del cliente, literal).
2. `anchoCm ASC` → a igualdad de merma, gastar el rollo **más angosto**
   (preserva los rollos anchos para los pedidos anchos).
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
    AND p."anchoCm" >= o."anchoReq"
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
| **Fase actual** | ✅ **Fases 1-4 COMPLETADAS** (2026-08-13). Checkout integrado en los dos endpoints, desactivado por bandera. |
| **Bloqueantes** | Ninguno. |
| **Acción pendiente de Jonas** | **Crear `PLIEGOS_MODO=log` en Vercel** (Settings → Environment Variables → Production) y redeploy. Sin esa variable el modo es `off` y el control de stock no hace nada — el comportamiento es idéntico al de antes. |
| **Datos en producción** | 11 pliegos · 23110 cm · colgados de `Alfombra test 2` (`cmoipz5lp0000l704zvl3nx6h`) · 11 `MovimientoPliego` motivo `alta` · 0 reservas |
| **Pendiente de QA** | Compras de prueba en `MODO=log`: una pagada, una abandonada, y una con carrito mixto. Revisar los logs `[PLIEGOS]` en Vercel y la pestaña Cortes. |
| **Siguiente entregable** | **Fase 5** (no arrancada): `/api/precio` devuelve `reglaId` + `capacidades` + topes acotados con `min(comercial, físico)`. Es aditiva y no puede romper el snippet actual. **Ojo:** ahí es donde el `maxAncho/maxAlto = 21` de `Alfombra test 2` empezará a importar. |

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
| | **5** | ⬜ Pendiente | |
| | **6** | ⬜ Pendiente | |
| | **7** | ⬜ Pendiente | |
| | **8** | ⬜ Pendiente | |

### Cómo actualizar esta bitácora

Al cerrar cada fase:
1. Marcar la fila de la fase en el **Historial** con ✅, la fecha y una nota de una línea.
2. Actualizar **Estado actual** (fase actual, bloqueantes, siguiente entregable).
3. Actualizar la fecha de "Última actualización" en la cabecera.
4. Si algo se descubrió durante la fase que contradiga este documento, **corregir la sección
   correspondiente** — la bitácora es la fuente de verdad, no un registro histórico inmutable.
