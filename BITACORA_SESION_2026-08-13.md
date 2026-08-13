# Bitácora de sesión — 2026-08-13

**Proyecto:** dturkia-custom-size · módulo de stock por pliego
**Documento maestro:** `BITACORA_STOCK_PLIEGOS_2026-08-12.md` (fuente de verdad del módulo).
Este archivo es solo el registro del día, para retomar mañana sin releerlo todo.

---

## Resumen en 5 líneas

1. Se verificó que las Fases 1–7 estaban completas y pusheadas. Todo correcto.
2. **Cambio de lógica de negocio: escalones por ancho de rollo** (commit `985f112`).
3. El aviso de "medida no disponible" se movió **debajo de los sliders** (mismo commit).
4. **Incidente:** el widget no bloqueaba nada en la tienda → la tienda servía el **snippet anterior**.
5. **Fix:** el snippet ahora declara su versión y la imprime en consola, + logs `[CSW]` (commit `9ed1fe6`).

**Estado al cerrar:** todo el código está en `main` y desplegado. **Falta pegar el snippet en el tema
y activar `PLIEGOS_MODO`.** Nada está activo por accidente: sin la env var el modo es `off`.

---

## 1. Verificación de estado inicial

Se confirmó contra el repo y la base:

- Fases 1 a 7 marcadas ✅ en el registro de avance; Fase 8 pendiente.
- Commits `e630234` (F5), `503ca58` (F6), `a00f82e` (F7) en `main`, sin divergencia con `origin`.
- `tema-entregas/` con los dos archivos y su README.
- Fix de `maxAncho`/`maxAlto` de `Alfombra test 2` (21 → 400 × 2100) aplicado y anotado.

Quedaron **sin commitear**, y siguen así, dos cambios ajenos al módulo (son de la tanda del
impermeabilizador, anteriores a esta sesión):

- `extensions/custom-size-widget/blocks/custom-size.liquid` — "impermeabilizador" → "impermeabilización"
- `extensions/custom-size-widget/snippets/impermeabilizador-snippet.liquid` — 6 líneas de CSS

**Decisión pendiente de Jonas:** si van en un commit propio.

---

## 2. Cambio de lógica — escalones por ancho de rollo · commit `985f112`

### La regla nueva

Cada ancho de rollo **activo** de la trama define un escalón. Un pedido se asigna al escalón del
**primer ancho `>=` al requerido** y **solo puede cortarse de rollos de ese ancho exacto**.

```
escalon(x) = MIN("anchoCm") de los pliegos ACTIVOS de la trama con "anchoCm" >= x
```

Un escalón sin material **no toma prestado** del de arriba: con los rollos de 300 en 0,70 m, un
pedido de 250 cm de ancho se bloquea aunque los de 400 estén llenos.

Los escalones se derivan solos de los anchos que existan: si entra un rollo de 200, aparece el
escalón 101–200 y el de 300 pasa a 201–300, sin tocar código. Un ancho **agotado sigue definiendo su
escalón**; solo se borra de la escalera si se da de **baja** el último rollo de ese ancho.

### Decisión de Jonas sobre la rotación

Cada orientación se valida contra el escalón **del lado que va a lo ancho del rollo**:

| Orientación | Escalón que le aplica | Consume de largo |
|---|---|---|
| Normal | `escalon(ancho)` | `alto` |
| Rotada | `escalon(alto)` | `ancho` |

Es simétrico: 250×350 y 350×250 son la misma pieza y dan la misma respuesta. En vivo, **250×350 se
vende girada en un rollo de 400** (merma 50) y 250×200 se bloquea.

Se descartó la alternativa de que el escalón lo fijara siempre el *ancho pedido*, porque rompía la
simetría (350×250 se vendería y 250×350 no, siendo la misma alfombra y la misma merma).

### Dónde se tocó

| Archivo | Cambio |
|---|---|
| `app/lib/pliegos.server.ts` | `p."anchoCm" >= o."anchoReq"` → `= (SELECT MIN(...))` en la sentencia atómica · `capacidades()` deja de filtrar anchos secos · nuevas `escalonPara()`, `escalones()`, `hayMaterial()` · `factible()` reescrita · logs con el escalón de cada orientación |
| `app/routes/api.precio.tsx` | "Agotado" pasa de `capacidades.length === 0` a `!hayMaterial()` · tope físico solo sobre escalones con material |
| `app/routes/app.pliegos._index.tsx` · `.$reglaId.tsx` · `.debug.tsx` | Muestran **escalones** (`ancho 101–300 → …` / `SIN MATERIAL`) en vez de "ancho ≤ N" |
| `tema-entregas/custom-size-snippet.liquid` 🔶 | Misma regla en JS + aviso movido bajo los sliders |

**`functions.js` no se tocó** — su contrato no cambia.

**Detalle a recordar:** `capacidades()` ahora devuelve **la escalera completa**, incluidos los anchos
con `largoMaxCm: 0`. Si un ancho agotado desapareciera del arreglo, el widget recalcularía el escalón
sobre el siguiente ancho y un pedido de 250 volvería a saltar al rollo de 400.

**Nota React Router:** `escalones()` vive en un módulo `.server`, así que se calcula en el `loader` y
viaja en los datos; no puede llamarse desde el render.

---

## 3. UI — aviso de "medida no disponible"

Movido de junto al botón a **entre el slider de alto y el bloque del impermeabilizador**, que es
donde el cliente está mirando mientras ajusta la medida. Caja con fondo, borde izquierdo y 20 px de
separación. El botón se sigue deshabilitando igual.

Los estilos van prefijados con `#csw-root` a propósito: el tema define
`.product .description p { line-height:1.9em; padding-bottom:20px }` y por especificidad le ganaba a
una clase suelta. Además el JS **reubica el aviso en runtime**, por si el markup del tema divergió.

---

## 4. Incidente — «el widget no valida nada» · commit `9ed1fe6`

**Síntoma:** en la tienda, con los rollos de 300 en 0,70 m, `264×1051` y `156×1051` no bloqueaban el
botón. Probado en incógnito y con el snippet dado por pegado.

### Causa raíz (confirmada con evidencia de producción)

**La tienda seguía sirviendo el snippet ANTERIOR.** El paste no llegó al tema publicado.

1. `GET /api/precio` real devuelve bien `capacidades: [{100,2100},{300,70},{400,2010}]` y `reglaId`.
   **El backend nunca falló.**
2. El HTML de `https://dturkia.com/products/alfombra-test-2` **no contiene** `escalonPara` ni
   `hayMaterial`, y **sí contiene** `c.anchoCm >= anchoCm` (regla vieja). El `<p id="csw-stock">`
   seguía después del botón.
3. Su bloque `<script>` es **idéntico byte a byte** al de la Fase 6: 18 620 bytes, contra 20 960 de
   la versión de escalones.

**Por qué parecía "no valida nada":** la validación sí corría, con la regla vieja
`∃ cap: anchoCm >= ancho && largoMax >= alto`. Para 264×1051 el rollo de 400 la satisface
(`400 >= 264`, `2010 >= 1051`) → "cabe". Esa regla solo bloquea cuando **ninguna** capacidad alcanza,
por eso 350×2100 sí se bloqueaba y estos casos no.

**Descartado:** que `/api/precio` no devolviera capacidades · que el widget saliera de la app
extension (`extensions/` no tiene nada del JS de stock: el widget vivo sale del snippet del tema) ·
caché · el problema de jQuery `.trigger('change')` (los listeners nativos sí corrían; se veía en que
el número del slider se actualizaba).

### Fix aplicado

| # | Qué |
|---|---|
| 1 | `CSW_VERSION = '2026-08-13-escalones'` + `console.log` destacado al cargar |
| 2 | `[CSW] capacidades recibidas: …` + la escalera ya interpretada |
| 3 | Un log por validación con el escalón de cada orientación, su capacidad y el veredicto |
| 4 | Sliders enganchados a `input` + `change` nativos **y** por jQuery si existe |
| 5 | `MutationObserver` sobre el `disabled` del botón: si algo lo re-habilita y la medida no es vendible, se vuelve a deshabilitar |

También se sincronizó `tema-dturkia/snippets/custom-size-snippet.liquid` (la copia local, que tenía
la versión vieja y era idéntica byte a byte a la entrega de la Fase 6).

---

## 5. Verificación ejecutada hoy

**Motor, contra la base real**, ejecutando `pliegos.server.ts` de verdad (reserva y borra el rastro):

| Caso | Resultado |
|---|---|
| 250×200 · 250×2000 · 299×200 | SIN_STOCK — el escalón seco no salta al de arriba |
| 350×300 · 400×300 · 301×900 | CEN-400 |
| 100×300 · 50×50 · 90×2000 | CEN-100 |
| 250×350 | CEN-400 **rotada**, consume 250 |
| 401×100 | CEN-100 rotada, consume 401, merma 0 |
| 350×2100 · 2200×2200 | SIN_STOCK |
| 264×1051 · 156×1051 (los reportados) | SIN_STOCK |
| `factible()` vs. motor | coinciden en los 14 casos |

**Matriz de la Fase 2 con inventario completo** (11 pliegos temporales sembrados en la regla
`cmnqgwtlc0000l504w7aeerly` y borrados al terminar): ningún caso ya validado cambió de resultado.
Idempotencia, reparto de rollos y todo-o-nada intactos.

**Snippet:** `node --check` de los dos bloques ✅ · las funciones **extraídas del archivo real** dan
lo mismo que el motor ✅ · la versión vieja permitía 264×1051 y 156×1051, la nueva las bloquea ✅.

**Build:** `npm run build` limpio. Los 2 errores de `npm run typecheck` son preexistentes
(`app._index.tsx`, `shopify.server.ts`) y no se tocaron.

**Base sin rastro:** 11 pliegos, 0 reservas pendientes.

---

## 6. Estado real del sistema al cerrar el día

### Datos

| | |
|---|---|
| Regla de trabajo | `Alfombra test 2` · `cmoipz5lp0000l704zvl3nx6h` · topes 400 × 2100 cm |
| Producto | `gid://shopify/Product/8557639893127` · `dturkia.com/products/alfombra-test-2` |
| Rollos ancho 100 | CEN-100-01..04 · 2100 cm cada uno (llenos) |
| Rollos ancho 300 | CEN-300-01..04 · **70 cm cada uno** |
| Rollos ancho 400 | CEN-400-01 = 959 · CEN-400-02/03 = 2010 |
| Total | 11 pliegos · 13 659 cm · 5 reservas `confirmada` de las compras de prueba |
| Escalones vigentes | **1–100 → 2100 · 101–300 → 70 · 301–400 → 2010** |

### Despliegue

| | |
|---|---|
| `main` / `origin/main` | `9ed1fe6` — sincronizados |
| Vercel | desplegado; `/api/precio` verificado devolviendo `capacidades` y `reglaId` |
| `PLIEGOS_MODO` | **no existe** en Vercel → modo `off` → el control de stock no actúa |
| Snippet en el tema | **versión ANTERIOR** — el paste de hoy no llegó al tema publicado |
| `functions.js` en el tema | pendiente de pegar (no cambió con el paso a escalones) |

---

## 7. Para mañana — por orden

1. **Pegar `tema-entregas/custom-size-snippet.liquid`** en el editor de temas de Shopify
   (`snippets/custom-size-snippet.liquid`), **en el tema PUBLICADO**, y guardar.
2. **Verificar que el paste llegó**, que es el paso que faltó hoy. Página de producto → consola:
   ```
   [CSW] snippet 2026-08-13-escalones
   [CSW] capacidades recibidas: [{"anchoCm":100,"largoMaxCm":2100}, …]
   [CSW] escalones: ancho 1-100 → largo ≤ 2100 · ancho 101-300 → largo ≤ 70 · ancho 301-400 → largo ≤ 2010
   ```
   **Si la primera línea no sale, el archivo pegado no es el vigente.** No seguir hasta que salga.
3. **Probar los casos en la tienda**, mirando la consola:
   - 264×1051 y 156×1051 → botón deshabilitado + aviso bajo los sliders.
   - ancho 250 con cualquier alto "normal" → bloqueado (su escalón está en 70 cm).
   - ancho 301–400 con alto razonable → se puede comprar.
   - ancho ≤ 100 → se puede comprar.
   - 250×350 → **sí** se puede (sale girada del rollo de 400). No es un bug.
4. **Pegar `functions.js`** si no está pegado ya (no cambió hoy, pero sigue pendiente de la Fase 7).
5. **Crear `PLIEGOS_MODO=log`** en Vercel → Settings → Environment Variables → Production, y
   redeploy. **En este orden: primero el snippet, después la env var.**
6. **QA en modo `log`:** compra pagada, compra abandonada (verificar que a los 15 min el material
   vuelve), carrito mixto con impermeabilizador. Revisar logs `[PLIEGOS]` en Vercel y las pestañas
   Reservas y Cortes del admin.
7. **Fase 8:** `PLIEGOS_MODO=bloqueo`, eliminar `/app/pliegos/debug`, cargar el inventario real del
   resto de tramas y correr la matriz de QA end-to-end del plan.

### Decisiones sueltas que quedan para Jonas

- Si los 2 cambios de `extensions/` (impermeabilizador) van en un commit propio.
- Si en algún momento se crea el producto **Ceniza** real y se reapunta el `reglaId` (paso futuro,
  el MVP corre sobre `Alfombra test 2`).

---

## 8. Cosas que conviene no olvidar

- **El tema no está en git.** La verdad es lo que está pegado en el editor de Shopify; `tema-entregas/`
  es solo una copia versionada para diffear y reconstruir. Por eso el snippet declara su versión.
- **Ante "el widget no hace lo que programamos", lo primero es comprobar qué código sirve la tienda**,
  no depurar el backend. Se hace descargando el HTML de la página de producto y buscando un símbolo
  que solo exista en la versión nueva.
- El token de la app **no tiene scope `read_themes`** (403 al listar temas), así que desde aquí no se
  puede ver en qué tema quedó un paste. Solo se puede leer el HTML público del tema publicado.
- El widget vivo sale del **snippet del tema**, no de la app extension: `extensions/` no contiene
  nada del JS de stock.
- **Las fórmulas de precio no se han tocado en ninguna fase** y no deben tocarse.
