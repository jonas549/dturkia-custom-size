(function () {
  'use strict';

  var fmt = new Intl.NumberFormat('es-CL', {
    style: 'decimal',
    maximumFractionDigits: 0,
  });

  function $(id) {
    return document.getElementById(id);
  }

  function calcularPrecios(precioPorCm2, waterproofPorCm2, waterproofActivo) {
    var ancho = parseInt($('csw-ancho').value, 10);
    var alto = parseInt($('csw-alto').value, 10);
    var area = ancho * alto;

    var precioAlfombra = Math.round(area * precioPorCm2);
    var precioWaterproof = Math.round(area * waterproofPorCm2);
    var waterproofChecked =
      waterproofActivo && $('csw-waterproof') && $('csw-waterproof').checked;

    $('csw-precio-alfombra').textContent = fmt.format(precioAlfombra);

    if (waterproofActivo) {
      $('csw-waterproof-precio').textContent = fmt.format(precioWaterproof);
      $('csw-precio-waterproof').textContent = fmt.format(precioWaterproof);
      $('csw-resumen-waterproof').style.display = waterproofChecked ? '' : 'none';
    }

    var total = precioAlfombra + (waterproofChecked ? precioWaterproof : 0);
    $('csw-precio-total').textContent = fmt.format(total);
  }

  function getVariantId() {
    var input =
      document.querySelector('form[action*="/cart/add"] input[name="id"]') ||
      document.querySelector('input[name="id"]') ||
      document.querySelector('[name="id"]');
    return input ? input.value : null;
  }

  function agregarAlCarrito(ancho, alto, waterproofActivo) {
    var variantId = getVariantId();
    if (!variantId) {
      alert('No se pudo obtener el producto. Por favor recarga la página.');
      return;
    }

    var waterproofChecked =
      waterproofActivo && $('csw-waterproof') && $('csw-waterproof').checked;

    var btn = $('csw-agregar');
    btn.disabled = true;
    btn.textContent = 'Agregando…';

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: parseInt(variantId, 10),
        quantity: 1,
        properties: {
          '_Ancho personalizado': ancho + ' cm',
          '_Alto personalizado': alto + ' cm',
          '_Impermeabilizador': waterproofChecked ? 'Sí' : 'No',
        },
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status && data.status >= 400) {
          alert('Error al agregar: ' + (data.description || data.message || 'Error desconocido'));
        } else {
          window.location.href = '/cart';
        }
      })
      .catch(function () {
        alert('Error de red. Por favor intenta nuevamente.');
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Agregar a la bolsa';
      });
  }

  function init() {
    var widget = document.getElementById('custom-size-widget');
    if (!widget) return;

    var shop = widget.dataset.shop;
    var productId = widget.dataset.productId;
    var appUrl = (widget.dataset.appUrl || '').replace(/\/$/, '');

    if (!shop || !appUrl) return;

    // Llamada inicial con dimensiones centrales para obtener la regla y tarifas
    var initAncho = 100;
    var initAlto = 100;
    var apiUrl =
      appUrl +
      '/api/precio?shop=' + encodeURIComponent(shop) +
      '&ancho=' + initAncho +
      '&alto=' + initAlto +
      (productId ? '&productId=' + encodeURIComponent(productId) : '');

    fetch(apiUrl)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || data.error) return; // sin regla → widget permanece oculto

        var regla = data.regla;
        var precioPorCm2 = data.precioPorCm2 || 0;
        var waterproofPorCm2 = data.waterproofPorCm2 || 0;
        var waterproofActivo = !!data.waterproofActivo;

        // ── Configurar sliders con rangos de la regla ──────────────────────
        var sliderAncho = $('csw-ancho');
        var sliderAlto = $('csw-alto');
        var midAncho = Math.round((regla.minAncho + regla.maxAncho) / 2);
        var midAlto = Math.round((regla.minAlto + regla.maxAlto) / 2);

        sliderAncho.min = regla.minAncho;
        sliderAncho.max = regla.maxAncho;
        sliderAncho.value = midAncho;
        sliderAlto.min = regla.minAlto;
        sliderAlto.max = regla.maxAlto;
        sliderAlto.value = midAlto;

        $('csw-ancho-val').textContent = midAncho;
        $('csw-alto-val').textContent = midAlto;
        $('csw-ancho-min').textContent = regla.minAncho + ' cm';
        $('csw-ancho-max').textContent = regla.maxAncho + ' cm';
        $('csw-alto-min').textContent = regla.minAlto + ' cm';
        $('csw-alto-max').textContent = regla.maxAlto + ' cm';

        // ── Impermeabilizador ──────────────────────────────────────────────
        if (waterproofActivo) {
          $('csw-waterproof-section').style.display = '';
        }

        // ── Cálculo inicial ────────────────────────────────────────────────
        calcularPrecios(precioPorCm2, waterproofPorCm2, waterproofActivo);

        // ── Mostrar widget ─────────────────────────────────────────────────
        widget.style.display = '';

        // ── Event listeners ────────────────────────────────────────────────
        sliderAncho.addEventListener('input', function () {
          $('csw-ancho-val').textContent = sliderAncho.value;
          calcularPrecios(precioPorCm2, waterproofPorCm2, waterproofActivo);
        });

        sliderAlto.addEventListener('input', function () {
          $('csw-alto-val').textContent = sliderAlto.value;
          calcularPrecios(precioPorCm2, waterproofPorCm2, waterproofActivo);
        });

        if (waterproofActivo && $('csw-waterproof')) {
          $('csw-waterproof').addEventListener('change', function () {
            calcularPrecios(precioPorCm2, waterproofPorCm2, waterproofActivo);
          });
        }

        $('csw-agregar').addEventListener('click', function () {
          agregarAlCarrito(
            $('csw-ancho').value,
            $('csw-alto').value,
            waterproofActivo
          );
        });
      })
      .catch(function () {
        // Error silencioso — el widget permanece oculto
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
