# Entregas al tema — copias versionadas

El tema D'Turkia (Merlí, OS 1.0) **no está en ningún repo**: los archivos se copian a mano al editor
de temas de Shopify. Eso ya causó un bug silencioso una vez (se reescribió `functions.js` y se perdió
el handler productor del impermeabilizador, que no estaba en git y no se pudo recuperar).

Esta carpeta guarda una **copia exacta de lo que se entregó** en cada fase, para que exista al menos
una referencia versionada del contrato entre el tema y la app.

> ⚠️ **Esto NO es la fuente de verdad.** El archivo que corre es el del editor de temas de Shopify.
> Si alguien edita el tema por fuera, esta copia queda desactualizada. Sirve para diffear y para
> reconstruir si algo se pierde, no para asumir qué hay en producción.

## Contenido

| Archivo | Fase | Qué cambió |
|---|---|---|
| `custom-size-snippet.liquid` | 6 · **revisado 2026-08-13** | Guarda `reglaId`, valida el par (ancho, largo) con rotación, estado Agotado. **Revisión:** la validación pasa a **escalones por ancho de rollo** (§5.0) y el aviso de "medida no disponible" se movió **debajo de los sliders** |
| `functions.js` | 7 | Envía `id` y `reglaId` en el payload de compra, muestra el error real de stock. **Sin cambios en la revisión de escalones** |

Ver `BITACORA_STOCK_PLIEGOS_2026-08-12.md` para el changelog detallado por bloque: fases 6 y 7, y la
sección «CAMBIO DE LÓGICA — Escalones por ancho de rollo».

> ⚠️ El snippet **debe pegarse antes** de poner `PLIEGOS_MODO` en `log` o `bloqueo`: con el backend
> de escalones y el snippet viejo, el widget ofrecería medidas que el checkout rechaza.

## Cómo saber qué versión está viva en la tienda

El snippet declara su versión y la imprime al cargar. Abrir la página de producto → consola:

```
[CSW] snippet 2026-08-13-escalones
```

**Si esa línea no aparece, el archivo pegado en el editor de temas no es el de esta carpeta.**
Pasó el 2026-08-13: se dio por pegado, la tienda seguía sirviendo la versión anterior y el widget
validaba con la regla vieja (permitía medidas imposibles). Ver el apartado «INCIDENTE» de la
bitácora.

Con `capacidades` presentes, la consola además muestra la escalera y cada validación:

```
[CSW] capacidades recibidas: [{"anchoCm":100,"largoMaxCm":2100}, …]
[CSW] escalones: ancho 1-100 → largo ≤ 2100  ·  ancho 101-300 → largo ≤ 70  ·  ancho 301-400 → largo ≤ 2010
[CSW] validando 264x1051 | normal: escalon(264)=300 capEscalon=70 pedido=1051 → no | rotada: … => NO DISPONIBLE, deshabilitando botón
```
