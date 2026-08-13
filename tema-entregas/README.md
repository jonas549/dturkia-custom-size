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
| `custom-size-snippet.liquid` | 6 | Guarda `reglaId`, valida el par (ancho, largo) con rotación, estado Agotado |
| `functions.js` | 7 | Envía `id` y `reglaId` en el payload de compra, muestra el error real de stock |

Ver `BITACORA_STOCK_PLIEGOS_2026-08-12.md` (fases 6 y 7) para el changelog detallado por bloque.
