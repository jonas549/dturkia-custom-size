# Bitácora de sesión — 2026-08-14

**Proyecto:** dturkia-custom-size
**Documento maestro del módulo de pliegos:** `BITACORA_STOCK_PLIEGOS_2026-08-12.md` (fuente de verdad).
Este archivo es solo el registro del día.

---

## Resumen en 5 líneas

1. **Corrección de regla de stock: el escalón lo fija el ANCHO PEDIDO**, la rotación ya no puede
   cambiar de escalón (commit `eadaf49`). Detalle completo en el §5.0.1 del documento maestro.
2. **Funcionalidad nueva: sección "Tramas" en la regla** — 4 slots de `{url, nombre}`, solo
   backend/admin. Migración aplicada en Neon.
3. **Nada de frontend tocado en el punto 2**: el widget de la tienda no consume `tramas` todavía.
4. **Fase 3 — rediseño del widget**: selectores a la columna izquierda, selector de tramas nuevo,
   carrusel de fotos a ancho completo y fix de las miniaturas estiradas en móvil.
5. Sigue pendiente que Jonas pegue los archivos del tema (ahora `2026-08-14b-layout-tramas-carrusel`)
   y cree `PLIEGOS_MODO=log` en Vercel.

---

## 1. Corrección — el escalón lo fija el ancho pedido

Registrada en el documento maestro (§5.0.1 y el apartado de corrección previo a la Fase 8). Resumen:

- **Causa:** en la sentencia atómica el escalón se calculaba con `o."anchoReq"`, que para la
  orientación rotada es el **alto**. Así, `228×320` se colaba: girada, `escalon(320) = 400`.
- **Fix:** el escalón se calcula una sola vez con el ancho pedido, más
  `o."anchoReq" <= p."anchoCm"` para que la rotada quepa a lo ancho de ese mismo rollo.
- **Validado:** motor 12/12, CTE de candidatos contra la base en solo lectura 9/9, y el JS del
  snippet coincide con el motor en 141.750 combinaciones.
- **La regla es asimétrica a propósito:** `228×320` bloquea, `320×228` vende.

---

## 2. Sección "Tramas" en la regla — Fase 1 (solo backend/admin)

**Qué se pidió:** una sección "Tramas" en la pantalla de la regla, análoga a "Bordes decorativos"
pero con **solo 2 campos** por slot (URL de imagen + Nombre; **sin** "Tipo / Color"), hasta 4 slots,
guardada en la propia regla con el mismo patrón que bordes. **Sin tocar el frontend**: la página de
personalización se va a rediseñar y las tramas se conectarán en una fase posterior.

### 2.1 Modelo

`ReglaPersonalizada` gana un campo Json, exactamente igual que `bordes`:

```prisma
bordes           Json     @default("[]")
tramas           Json     @default("[]")   // ← nuevo
```

Migración `prisma/migrations/20260814000000_tramas/migration.sql`, aditiva y con DEFAULT, siguiendo
la convención del proyecto (SQL manual, nunca `prisma migrate dev`):

```sql
ALTER TABLE "ReglaPersonalizada" ADD COLUMN "tramas" JSONB NOT NULL DEFAULT '[]';
```

**Aplicada en Neon el 2026-08-14** con `npx prisma migrate deploy`. `prisma migrate status` →
*Database schema is up to date* (9 migraciones). Verificado en `information_schema`: `tramas` es
`jsonb NOT NULL DEFAULT '[]'::jsonb`, **idéntica a `bordes`**.

### 2.2 Estructura de los datos

```json
[
  { "url": "https://cdn.shopify.com/...", "nombre": "Ceniza" },
  { "url": "https://cdn.shopify.com/...", "nombre": "Alba" },
  { "url": "", "nombre": "" }
]
```

**Se guardan los 4 slots tal cual, incluidos los vacíos e incompletos** — es lo que ya hace `bordes`
(la regla `Alfombra test 2` tiene hoy 3 bordes llenos y un cuarto slot `{"tipo":"","nombre":"",
"imagenUrl":""}`). Así el merchant no pierde lo que llevaba escrito a medias al guardar.

**El filtrado de "slot completo" es responsabilidad de quien lee**, igual que con bordes en
`/api/precio`. Criterio para tramas: `url` y `nombre` no vacíos (2 campos, no 3).

### 2.3 Admin

Sección "Tramas" añadida **debajo de "Bordes decorativos"**, mismo patrón visual (estilos inline,
tarjeta por slot que se pone verde con ✓ Completo, preview de la imagen con `onError` que la oculta
si la URL no carga). Grid de `2fr 1fr` en vez de `2fr 1fr 1fr`, porque son 2 campos.

Se añadió en **los dos** formularios de regla, no solo en el de edición: si solo estuviera en editar,
una regla recién creada nacería sin poder cargar tramas hasta volver a entrar.

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | Campo `tramas Json @default("[]")` |
| `prisma/migrations/20260814000000_tramas/migration.sql` | Nuevo — `ADD COLUMN` |
| `app/routes/app.reglas.$id.tsx` | Parseo de `tramas` en el `action`, estado de 4 slots en el form, sección UI, `<input type="hidden" name="tramas">` |
| `app/routes/app.reglas.nueva.tsx` | Lo mismo, con los 4 slots vacíos de partida |

### 2.4 Lo que NO se tocó

**Ningún archivo de frontend.** Ni `custom-size-snippet.liquid`, ni `functions.js`, ni
`api.precio.tsx`. `/api/precio` **no** devuelve `tramas`: se conectará en la fase del rediseño.
Tampoco se tocaron bordes, pliegos ni las fórmulas de precio.

### 2.5 Validación ejecutada

- `prisma migrate deploy` ✅ · `prisma migrate status` ✅ · columna verificada en `information_schema` ✅
- **Round-trip contra la base real** sobre `Alfombra test 2`: se guardaron 4 slots con el cuarto
  incompleto (URL sí, nombre vacío), se releyeron idénticos, el filtro de válidos devolvió **3 de 4**
  (Ceniza, Alba, Nogal), **`bordes` quedó intacto**, y se restauró `tramas` a `[]` al terminar.
- `npm run build` ✅ · `npm run typecheck`: sigue con **los mismos 2 errores preexistentes**
  (`app._index.tsx`, `shopify.server.ts`), ninguno nuevo.

### 2.6 Ojo con el nombre — colisión de terminología

En el módulo de pliegos, **"trama" significa la `ReglaPersonalizada` entera** (una trama = un tipo de
alfombra con sus rollos). El campo `tramas` que se añade aquí es **otra cosa**: hasta 4 imágenes con
nombre dentro de esa misma regla. No confundirlos al leer `pliegos.server.ts` o el documento maestro.

---

## 3. Fase 3 — rediseño del widget de medida personalizada

Rediseño del layout de la página de producto personalizado, según la maqueta `Diseño nuevo.jpeg` y
el bug `error movil.jpg` (ambas en `C:\Users\Jonas\Desktop\appdturkia\`, **no** en
`referencia_fase3/` como decía el encargo).

### 3.0 Decisiones de diseño (preguntadas a Jonas antes de implementar)

| Duda | Respuesta |
|---|---|
| Carrusel: ¿ancho completo o dentro de la columna izquierda? | **Ancho completo, debajo de las dos columnas** |
| ¿Se conserva el zoom de lupa y la tira de miniaturas verticales? | **No, fuera las dos.** Carrusel simple; el clic no hace nada |
| ¿La trama es opcional como el borde? | **Obligatoria**: el botón queda bloqueado hasta elegir una |
| ¿Elegir trama cambia algo en pantalla? | **No**, solo se marca la tarjeta |

### 3.1 Reubicación del layout

El snippet se renderiza desde `product-add.liquid`, o sea **dentro de la columna derecha**. Para
llevar los selectores a la izquierda **no se tocó `product-section.liquid`**: el snippet los mueve en
runtime a `#left-temp` (misma técnica que ya usaba `colocarAvisoStock()`), envueltos en
`#csw-selectores`, y oculta la `.gal` que había allí.

> ⚠️ **La galería original se OCULTA, nunca se elimina.** `product-add.liquid` hace
> `document.querySelector('.mySwiper2').swiper` en **tres** sitios (líneas 105, 157 y 210) al cambiar
> de variante; si el nodo desapareciera, el cambio de variante reventaría.

Todo con guardas: si no encuentra `.left`, los selectores se quedan donde estaban y el widget sigue
funcionando. Solo afecta a productos con el tag `medida-personalizada`, que son los únicos donde el
widget se monta.

### 3.2 Selector de tramas

`renderTramas()` es un **clon literal de `renderBordes()`** y reutiliza las mismas clases
`csw-bordes-*` / `csw-b-*`: mismo diseño, un solo sitio donde tocar estilos. Dos diferencias:

- el dato no tiene `tipo`, así que la tarjeta pinta solo el nombre en el renglón destacado
  (`csw-b-tipo`) y **omite** el renglón pequeño, en vez de inventarse un texto;
- **la selección es obligatoria**.

`/api/precio` devuelve ahora `tramas` con el mismo filtro que bordes, pero de 2 campos: `url` y
`nombre` no vacíos. Los slots incompletos que guarda el admin se descartan aquí.

**Trama obligatoria — cómo convive con el bloqueo por stock.** Se añadió `refrescarBoton()` como
**único** sitio que decide si el botón se habilita:

```js
function refrescarBoton() {
  var okStock = revisarDisponibilidad();   // ← lógica de pliegos, INTACTA
  if (!okStock) { mostrarTramaAviso(false); return false; }   // el stock manda y con su mensaje
  var falta = faltaElegirTrama();
  btn.disabled = falta;
  return !falta;
}
```

El stock se evalúa primero y con su propio aviso; la trama **solo puede bloquear adicionalmente,
nunca desbloquear**. `revisarDisponibilidad()` no se modificó ni una línea.

`tramaRequerida` solo se pone a `true` si la regla trae **al menos una trama válida** — una regla sin
tramas no puede quedar bloqueada, mismo criterio que la guarda de "trama sin pliegos nunca bloquea".

El aviso "Elige una trama para continuar" va **pegado al botón**, no junto al selector: en escritorio
el selector está en la otra columna y si no, no se entendería por qué el botón está apagado.

### 3.3 La trama en el pedido

Mismo camino que el borde, de punta a punta:

| Punto | Borde | Trama |
|---|---|---|
| localStorage | `borde: "Cinta algodón - Negro"` | `trama: "Ceniza"` |
| `functions.js` payload | `borde` | `trama` |
| Draft Order | property `Borde` | property `Trama` |
| `PedidoCustom` | columna `borde` | columna `trama` (migración `20260814100000_pedido_trama`) |
| Modo edición | `editBorde` preselecciona | `editTrama` preselecciona |

**Añadido de paso** (avisado a Jonas): `api.checkout-impermeabilizador.tsx` **no mandaba el `Borde`**
en `customAttributes` de los items de medida — con el carrito mixto la orden salía sin él aunque sí
se guardaba en `PedidoCustom`. Se añadieron Borde y Trama.

### 3.4 Carrusel

Se imprime en Liquid **solo si `product.images.size > 0`**: si el producto no tiene imágenes, el nodo
no existe y no hay nada que mostrar ni que ocultar. Nace oculto dentro de `#csw-root` y el JS lo saca
como **hermano de `.product`** (por eso queda a ancho completo, y las reglas del tema scopeadas a
`.product .swiper-*` no lo alcanzan).

Reusa el Swiper 7 que ya carga el tema. Como viene con `defer`, se reintenta hasta 4 s; si nunca
llega, degrada a una fila con scroll horizontal en vez de quedarse rota. Sin `loop`, para no repetir
el problema del slideshow con una sola imagen.

### 3.5 🐛 Fix del bug móvil

**Causa:** en la media query de 480 px, `.csw-b-thumb` tenía `aspect-ratio: unset`. Sin proporción
declarada la miniatura no tiene altura propia, así que `.csw-b-thumb img { height: 100% }` se resuelve
como `auto` y la imagen se pinta con **su** proporción natural. Las fotos de alfombra son muy
verticales (1:3 y más), así que la tarjeta crecía hasta ~540 px de alto.

**Fix:** la miniatura declara proporción también en móvil (`aspect-ratio: 1/1`, `width: 96px`) más
`align-self: flex-start` para que el *stretch* del flex no la vuelva a estirar. `object-fit: cover`
recorta en vez de deformar. Aplica igual a bordes y a tramas, porque comparten clases.

### 3.6 Archivos

| Archivo | Qué cambió |
|---|---|
| `app/routes/api.precio.tsx` | Devuelve `tramas` filtradas (+11 líneas, aditivo) |
| `app/routes/api.checkout.tsx` | Tipo `trama`, property `Trama`, columna en el INSERT |
| `app/routes/api.checkout-impermeabilizador.tsx` | Ídem + el `Borde` que faltaba |
| `prisma/schema.prisma` + `20260814100000_pedido_trama` | `PedidoCustom.trama TEXT` |
| 🔶 `tema-entregas/custom-size-snippet.liquid` | Sección tramas, carrusel, reubicación, gating, fix móvil |
| 🔶 `tema-entregas/functions.js` | 1 línea: `trama` en el payload |

**`product-section.liquid` y `product-add.liquid` NO se tocaron.**

### 3.7 Verificación

- Sintaxis: `node --check` de los dos bloques `<script>` del snippet ✅ y de `functions.js` ✅
- `npm run build` ✅ · `npm run typecheck`: los **mismos 2 errores preexistentes**, ninguno nuevo
- Migración aplicada en Neon ✅
- Filtro de `/api/precio` probado contra la base real: 4 slots con uno incompleto → **3 válidas**,
  y el estado previo de la regla (la trama "Ceniza" que ya había cargado Jonas) restaurado intacto
- **Nada de pliegos ni de precio tocado**, comprobado con `git diff`: `pliegos.server.ts` intacto,
  cero líneas de fórmula modificadas, y de la lógica de escalones solo cambia el envoltorio
  `controlDeStock && (…)` del MutationObserver — la condición de stock es idéntica

---

## 4. Estado al cerrar

| | |
|---|---|
| **Commits** | `eadaf49` (escalón) · `45ed244` (admin de tramas) · el de la Fase 3 |
| **Base de datos** | Migraciones `20260814000000_tramas` y `20260814100000_pedido_trama` aplicadas. `Alfombra test 2` ya tiene cargada la trama "Ceniza" |
| **Pendiente de Jonas** | (a) Pegar **2 archivos** en el tema: `snippets/custom-size-snippet.liquid` y `assets/functions.js`, versión `2026-08-14b-layout-tramas-carrusel` · (b) crear `PLIEGOS_MODO=log` en Vercel |
| **Siguiente en tramas** | Ya conectadas al frontend. Queda cargar las tramas reales de cada regla desde el admin |
| **Sin commitear** | 2 cambios previos en `extensions/` ajenos a esto (texto "impermeabilización" y CSS de `#csw-imp-root p`) |
