# Bitácora de sesión — 2026-08-14

**Proyecto:** dturkia-custom-size
**Documento maestro del módulo de pliegos:** `BITACORA_STOCK_PLIEGOS_2026-08-12.md` (fuente de verdad).
Este archivo es solo el registro del día.

---

## Resumen en 4 líneas

1. **Corrección de regla de stock: el escalón lo fija el ANCHO PEDIDO**, la rotación ya no puede
   cambiar de escalón (commit `eadaf49`). Detalle completo en el §5.0.1 del documento maestro.
2. **Funcionalidad nueva: sección "Tramas" en la regla** — 4 slots de `{url, nombre}`, solo
   backend/admin. Migración aplicada en Neon.
3. **Nada de frontend tocado en el punto 2**: el widget de la tienda no consume `tramas` todavía.
4. Sigue pendiente que Jonas pegue el snippet `2026-08-14-escalon-por-ancho-pedido` en el tema y
   cree `PLIEGOS_MODO=log` en Vercel.

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

## 3. Estado al cerrar

| | |
|---|---|
| **Commits** | `eadaf49` (corrección del escalón) · el de tramas |
| **Base de datos** | Migración `20260814000000_tramas` aplicada. `tramas` = `[]` en todas las reglas |
| **Pendiente de Jonas** | (a) Pegar el snippet `2026-08-14-escalon-por-ancho-pedido` en el tema · (b) crear `PLIEGOS_MODO=log` en Vercel |
| **Siguiente en tramas** | Fase de rediseño: conectar `tramas` al configurador con el diseño nuevo |
| **Sin commitear** | 2 cambios previos en `extensions/` ajenos a esto (texto "impermeabilización" y CSS de `#csw-imp-root p`) |
