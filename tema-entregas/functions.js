// Comprueba en Shopify si los Draft Orders pendientes ya fueron pagados.
// Corre en cada page load — borra solo los items pagados del array en localStorage.
(function cswCheckPaidOnLoad() {
  var arr = [];
  try {
    var raw = localStorage.getItem('csw_pending_orders');
    if (raw) {
      arr = JSON.parse(raw);
      if (!Array.isArray(arr)) arr = [];
    }
    // Migration silenciosa: formato viejo (objeto único) → array de 1
    var rawViejo = localStorage.getItem('csw_pending_order');
    if (rawViejo) {
      var viejo = JSON.parse(rawViejo);
      if (viejo && typeof viejo === 'object' && !Array.isArray(viejo)) {
        viejo.id = viejo.id || ('legacy_' + Date.now());
        arr = [viejo].concat(arr);
        localStorage.removeItem('csw_pending_order');
        localStorage.setItem('csw_pending_orders', JSON.stringify(arr));
      }
    }
  } catch(e) {}

  var itemsConDraft = arr.filter(function(item) { return item.draftOrderId && item.shop; });
  if (!itemsConDraft.length) return;

  var shop = itemsConDraft[0].shop;
  var ids  = itemsConDraft.map(function(item) { return item.draftOrderId; }).join(',');

  fetch(
    'https://dturkia-custom-size.vercel.app/api/check-paid'
    + '?shop=' + encodeURIComponent(shop)
    + '&ids='  + encodeURIComponent(ids)
  )
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data || !data.completedIds || !data.completedIds.length) return;
      var completedSet = {};
      data.completedIds.forEach(function(id) { completedSet[id] = true; });
      var newArr = arr.filter(function(item) {
        return !item.draftOrderId || !completedSet[item.draftOrderId];
      });
      if (newArr.length === arr.length) return;
      if (newArr.length === 0) localStorage.removeItem('csw_pending_orders');
      else localStorage.setItem('csw_pending_orders', JSON.stringify(newArr));
      if (typeof update_mini_cart === 'function') update_mini_cart(false, true);
    })
    .catch(function() {});
})();

$(document).ready(function() {

  var winW = $(window).width();

  // lazy loads elements with default selector as '.lozad'
  const observer = lozad();
  observer.observe();

  resizeHeader($('.barra').outerHeight(), $('header').outerHeight(), $('.infobar').outerHeight(), true);

  $(window).resize(function() {
    resizeHeader($('.barra').outerHeight(), $('header').outerHeight(), $('.infobar').outerHeight(), false);
  });

  $('header .icons li .search').click(function() {
    $('header .big-search').toggleClass('show');
    $('header .black-search').toggleClass('show');
  });

  $('header .big-search .cerrar-big-search').click(function() {
    $('header .big-search').toggleClass('show');
    $('header .black-search').toggleClass('show');
  });

  $('header .icons li .cart').click(function() {
    $('#minicart').addClass('show');
  });

  $('#minicart .cerrar').click(function() {
    $('#minicart').removeClass('show');
  });

  $('header .show-menu').click(function() {
    $('nav').addClass('show');
  });

  $('header nav .cerrar').click(function() {
    $('nav').removeClass('show');
  });

  $('.product .deon > h3').each(function() {
    $(this).addClass('accor');
    $(this).nextUntil('h3').wrapAll('<div class="hide-info"></div>')
  });

  $('.product .deon h3').click(function() {
    $(this).toggleClass('active');
    $(this).next('.hide-info').toggleClass('show');
  });

  $('.pro-int .ver').click(function() {
    $('.pro-int .gallery').addClass('show');
  });

  $('.pro-int .gallery .cerrar').click(function() {
    $('.pro-int .gallery').removeClass('show');
  });

  $('.product .des-int .inner > h3').each(function() {
    $(this).addClass('h3-int');
    $(this).nextUntil('h3').wrapAll('<div class="contacto"></div>')
  });

  $('.pro-int .contactar').click(function() {
    $('.pro-int .form').addClass('show');
  });

  $('.pro-int .form .cerrar').click(function() {
    $('.pro-int .form').removeClass('show');
  });

  // Collection
  if (winW < 830) {
    $('.facets__heading').click(function(){
      $(this).toggleClass('clicked');
      $('.template-collection .facets__disclosure').slideToggle(200);
    });
  }

  // Pop Up
  $('#popup .cerrar').click(function() {
    $('#popup').removeClass('show');
  });

  if ( winW < 830 ) {
    $('nav ul.menu > li.site-nav--has-dropdown').prepend('<span class="down"><i>+</i></span>');
    $('nav ul.menu > li.site-nav--has-dropdown span.down').click(function(){
      $(this).toggleClass('active');
      $(this).parent().siblings().children('.sub-menu').removeClass('show');
      $(this).parent().children('.sub-menu').toggleClass('show');
    });
    $('nav ul.menu > li > ul.sub-menu > li.site-nav--has-dropdown').prepend('<span class="down"><i>+</i></span>');
    $('nav ul.menu > li > ul.sub-menu > li.site-nav--has-dropdown span.down').click(function(){
      $(this).toggleClass('active');
      $(this).parent().siblings().children('.sub-sub-menu').removeClass('show');
      $(this).parent().children('.sub-sub-menu').toggleClass('show');
    });
  }

  // Footer

  $('footer .item h4').each(function(){
    $(this).click(function(){
      $(this).next('.wrap').slideToggle(200);
      $(this).toggleClass('active');
    });
  });

  /**
   * Escucha permanente para agregar productos, funciona para snippet
   * product-item.liquid
   *
   * @param object this  Contiene el objeto del elemento cliqueado.
   */
  $('body').on('click', '.item .addcart', function() {
    var proVar = $(this).data('product-id');
    jQuery.ajax({
      type: "POST",
      url: '/cart/add.js',
      data: {
        quantity: 1,
        id: proVar
      },
      success: function(data) {
      },
      error: function(data) {
        if (data.status == 422) {
          $('.item-' + proVar + ' .alertas').text('Sin stock disponible');
        }
      },
      async: false
    });
    update_mini_cart(true);
  });
});

/**
 * Swiper launcher product-section
 *
 * @param object this  Contiene el objeto del elemento cliqueado.
 */
let thumbsSwiperPro = new Swiper(".mySwiper", {
  spaceBetween: 10,
  // centeredSlides: true,
  centeredSlidesBounds: true,
  slidesPerView: 4,
  direction: 'horizontal',
  watchOverflow: true,
  watchSlidesVisibility: true,
  watchSlidesProgress: true,
  breakpoints: {
    830: {
      slidesPerView: 4,
      spaceBetween: 10,
      direction: 'vertical',
    },
  }
});

let swiperPro = new Swiper(".mySwiper2", {
  spaceBetween: 10,
  navigation: {
    nextEl: ".swiper-button-next",
    prevEl: ".swiper-button-prev",
  },
  loop: true,
  thumbs: {
    swiper: thumbsSwiperPro,
    autoScrollOffset: 1
  },
});

/**
 * Escucha permanente para borrar producto del mini carro
 *
 * @param object this  Contiene el objeto del elemento cliqueado.
 */
$('body').on('click', '#minicart .middle .left i.delete-prod:not(.csw-delete)', function() {
  var var_this = this;
  Shopify.removeItem($(this).data('id'), function() {
    $(var_this).css("margin", "0").parent().parent().slideUp(200);
    update_mini_cart(false, false);
  });
});

$('body').on('click', '#minicart .csw-delete', function() {
  var itemId = $(this).data('csw-id');
  try {
    var arr = JSON.parse(localStorage.getItem('csw_pending_orders') || '[]');
    if (!Array.isArray(arr)) arr = [];
    arr = arr.filter(function(item) { return item.id !== itemId; });
    if (arr.length) localStorage.setItem('csw_pending_orders', JSON.stringify(arr));
    else localStorage.removeItem('csw_pending_orders');
  } catch(e) {}
  $(this).parent().parent().slideUp(200, function() {
    update_mini_cart(false, true);
  });
});


function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Actualiza el mini carro
 *
 * @param boolean show  Muestra el menu
 * @param boolean all   Actualiza el sector medio del mini carro
 */
function update_mini_cart(show = false, all = true) {
  if (all) {
    $('#minicart .middle ul').empty();
  }
  $("#minicart .cifra").empty();
  jQuery.get("/cart.js", function(data) {
    for (var i = 0; i < data.items.length; i++) {
      var titulo     = data.items[i]["product_title"];
      var varianteID = data.items[i]["variant_id"];
      var precio     = data.items[i]["price"] ? parseFloat(data.items[i]["price"]).toString().substring(0, parseFloat(data.items[i]["price"]).toString().length - 2).replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1.") : '0';
      var cantidad   = data.items[i]["quantity"];
      var imagen     = data.items[i]["featured_image"]["url"];
      var alt        = data.items[i]["featured_image"]["alt"];
      var width      = data.items[i]["featured_image"]["width"];
      var height     = data.items[i]["featured_image"]["height"];
      var proMini    = "<li><div class='left'><i class='delete-prod' data-id='" + varianteID + "'></i><h4>" + titulo + "</h4><h5>$" + precio + "</h5><h6>Cantidad: <span>" + cantidad + "</span></h6></div><div class='right'><img class='lozad' src='" + imagen + "' alt='" + alt + "' width='" + width + "' height='" + height + "' loading='lazy' /></div></li>";
      if (all) {
        $("#minicart .middle ul").append(proMini);
      }
    }
    // Agregar items custom de alfombras personalizadas desde localStorage
    var cswPendientes = [];
    try {
      var cswRaw = localStorage.getItem('csw_pending_orders');
      if (cswRaw) {
        cswPendientes = JSON.parse(cswRaw);
        if (!Array.isArray(cswPendientes)) cswPendientes = [];
      }
      // Migration silenciosa: formato viejo (objeto único) → array de 1
      var cswRawViejo = localStorage.getItem('csw_pending_order');
      if (cswRawViejo) {
        var cswViejo = JSON.parse(cswRawViejo);
        if (cswViejo && typeof cswViejo === 'object' && !Array.isArray(cswViejo)) {
          cswViejo.id = cswViejo.id || ('legacy_' + Date.now());
          cswPendientes = [cswViejo].concat(cswPendientes);
          localStorage.removeItem('csw_pending_order');
          localStorage.setItem('csw_pending_orders', JSON.stringify(cswPendientes));
        }
      }
    } catch(e) {}

    // Expiración por item
    var cswNowMs = Date.now();
    var cswAntesLen = cswPendientes.length;
    cswPendientes = cswPendientes.filter(function(item) {
      if (item.checkoutInitiatedAt && (cswNowMs - item.checkoutInitiatedAt) > 86400000) return false;
      if (item.createdAt && (cswNowMs - item.createdAt) > 604800000) return false;
      return true;
    });
    if (cswPendientes.length !== cswAntesLen) {
      try {
        if (cswPendientes.length) localStorage.setItem('csw_pending_orders', JSON.stringify(cswPendientes));
        else localStorage.removeItem('csw_pending_orders');
      } catch(e) {}
    }

    if (all && cswPendientes.length) {
      cswPendientes.forEach(function(item) {

        // ── Renderizado especial para items de impermeabilizador ──────────
        if (item.tipo === 'impermeabilizador') {
          var cswImpPrecioFmt = (item.precio || 0).toString().replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1.');
          var cswImpNombre    = (item.productTitle || 'Producto') + ' (con impermeabilizador)';
          var cswImpItemId    = item.id || '';
          var cswImpImgHtml   = item.imageUrl
            ? "<img src='" + item.imageUrl + "' alt='" + (item.productTitle || '') + "' loading='lazy' style='width:100%;display:block;'/>"
            : '';
          var cswImpEditBtn = ''; // sin botón Editar — solo × para impermeabilizador
          var cswImpLi = "<li class='csw-item-custom csw-item-imp'>" +
            "<div class='left'>" +
              "<i class='delete-prod csw-delete' data-csw-id='" + cswImpItemId + "'></i>" +
              "<h4>" + cswImpNombre + "</h4>" +
              "<h5>$" + cswImpPrecioFmt + "</h5>" +
              "<h6>Impermeabilizador incluido</h6>" +
              cswImpEditBtn +
            "</div>" +
            "<div class='right'>" + cswImpImgHtml + "</div>" +
          "</li>";
          $("#minicart .middle ul").append(cswImpLi);
          return; // saltar el renderizado de medida más abajo
        }
        // ── fin impermeabilizador ─────────────────────────────────────────

        var cswPrecioTotal = (item.precio || 0) + (item.waterproof && item.waterproofPrecio ? item.waterproofPrecio : 0);
        var cswPrecioFmt   = cswPrecioTotal.toString().replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1.");
        var cswNombre      = item.productTitle || 'Alfombra Medida Personalizada';
        var cswMedidas     = item.ancho + ' cm × ' + item.alto + ' cm';
        var cswWpText      = item.waterproof ? ' — Impermeabilizador: Sí' : '';
        var cswImgHtml     = item.imageUrl ? "<img src='" + item.imageUrl + "' alt='Alfombra personalizada' loading='lazy' style='width:100%;display:block;' />" : "";
        var cswItemId      = item.id || '';
        var cswEditBtn = '';
        if (item.productHandle) {
          var cswEditUrl = '/products/' + item.productHandle
            + '?csw_edit='    + encodeURIComponent(cswItemId)
            + '&ancho='       + (item.ancho || 100)
            + '&alto='        + (item.alto  || 100)
            + '&waterproof='  + (item.waterproof ? '1' : '0');
          cswEditBtn = "<a href='" + cswEditUrl + "' style='display:inline-block;margin-top:5px;font-size:var(--f12,0.75em);color:var(--dorado,#A59765);text-decoration:underline;letter-spacing:0.5px;'>Editar</a>";
        }
        var cswLi = "<li class='csw-item-custom'>" +
          "<div class='left'>" +
            "<i class='delete-prod csw-delete' data-csw-id='" + cswItemId + "'></i>" +
            "<h4>" + cswNombre + "</h4>" +
            "<h5>$" + cswPrecioFmt + "</h5>" +
            "<h6>" + cswMedidas + cswWpText + "</h6>" +
            cswEditBtn +
          "</div>" +
          "<div class='right'>" + cswImgHtml + "</div>" +
        "</li>";
        $("#minicart .middle ul").append(cswLi);
      });
    }

    // Subtotal: precio Shopify (en centavos ×100) + suma de todos los items custom en CLP
    var shopifyTotalCLP = data.total_price ? Math.round(data.total_price / 100) : 0;
    var cswExtra = cswPendientes.reduce(function(sum, item) {
      return sum + (item.precio || 0) + (item.waterproof && item.waterproofPrecio ? item.waterproofPrecio : 0);
    }, 0);
    var totalCombinado  = shopifyTotalCLP + cswExtra;
    var total           = totalCombinado.toString().replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1.");
    var itemcount = data.item_count + cswPendientes.length;
    $("#minicart .cifra").html('$' + total);
    $("header .icons li a.cart .count").html(itemcount);

    // Mostrar "Comprar" si hay items custom, "Ver Carrito" si no
    if (cswPendientes.length) {
      $('#minicart .ver-carrito').hide();
      $('#minicart .csw-comprar').show();
    } else {
      $('#minicart .ver-carrito').show();
      $('#minicart .csw-comprar').hide();
    }

    if (show) {
      $('#minicart').addClass('show');
    }
  }, 'json');
}

/**
 * Devuelve el stock de la variante seleccionada
 *
 * @param object stock  Inventario de la ariante
 */

 function get_stock(stock = 0) {
   if (stock == 0) {
     $('.remain p').html('Producto agotado');
     $('#sobre-agregar').fadeIn(100);
   } else if (stock == undefined ) {
     $('#sobre-agregar').fadeIn(100);
   } else if (stock == 1) {
     $('.remain p').html('Queda sólo ' + stock + ' unidad');
     $('#sobre-agregar').fadeOut(100);
   } else if (stock > 1 && stock < 6) {
     $('.remain p').html('Quedan sólo ' + stock + ' unidades');
     $('#sobre-agregar').fadeOut(100);
   } else {
     $('.remain p').html('');
     $('#sobre-agregar').fadeOut(100);
   }
 }

/**
 * Si en algún momento hay errores de carga de jQuery.
 * Uso: defer(function () { //= acá va la funcion =// });
 *
 * @param object method  Funcion completa a ejecutar
 */
function defer(method) {
   if (window.jQuery) {
     method();
   } else {
     setTimeout(function() { defer(method) }, 50);
   }
}

function deferjQuery(method) {
   if (window.jQuery) {
     method();
   } else {
     setTimeout(function() { deferjQuery(method) }, 50);
   }
}

 function deferSwiper(method) {
   if (window.Swiper) {
     method();
   } else {
     setTimeout(function() { deferSwiper(method) }, 50);
   }
}

function quantity_elements(ajax = false) {
  if (ajax) {
    $('<div class="quantity-nav"><div class="quantity-button quantity-up">+</div><div class="quantity-button quantity-down">-</div></div>').insertAfter('.product-recommendations .sec-cantidad input');
    $('.product-recommendations .sec-cantidad').each(function() {
      var spinner = $(this), input = spinner.find('input[type="number"]'), btnUp = spinner.find('.quantity-up'), btnDown = spinner.find('.quantity-down'), min = input.attr('min'), max = input.attr('max');
      btnUp.click(function() {
        var oldValue = parseFloat(input.val());
        if (oldValue >= max) {
          var newVal = oldValue;
        } else {
          var newVal = oldValue + 1;
        }
        spinner.find("input").val(newVal);
        spinner.find("input").trigger("change");
      });
      btnDown.click(function() {
        var oldValue = parseFloat(input.val());
        if (oldValue <= min) {
          var newVal = oldValue;
        } else {
          var newVal = oldValue - 1;
        }
        spinner.find("input").val(newVal);
        $(spinner).parent().find(".addcart").data("qt", newVal);
        spinner.find("input").trigger("change");
      });
    });
  } else {
    $('<div class="quantity-nav"><div class="quantity-button quantity-up">+</div><div class="quantity-button quantity-down">-</div></div>').insertAfter('.sec-cantidad input');
    $('.sec-cantidad').each(function() {
      var spinner = $(this), input = spinner.find('input[type="number"]'), btnUp = spinner.find('.quantity-up'), btnDown = spinner.find('.quantity-down'), min = input.attr('min'), max = input.attr('max');
      btnUp.click(function() {
        var oldValue = parseFloat(input.val());
        if (oldValue >= max) {
          var newVal = oldValue;
        } else {
          var newVal = oldValue + 1;
        }
        spinner.find("input").val(newVal);
        spinner.find("input").trigger("change");
      });
      btnDown.click(function() {
        var oldValue = parseFloat(input.val());
        if (oldValue <= min) {
          var newVal = oldValue;
        } else {
          var newVal = oldValue - 1;
        }
        spinner.find("input").val(newVal);
        $(spinner).parent().find(".addcart").data("qt", newVal);
        spinner.find("input").trigger("change");
      });
    });
  }
}

document.addEventListener("DOMContentLoaded", function() {
  var lazyloadImages;

  if ("IntersectionObserver" in window) {
    lazyloadImages = document.querySelectorAll(".lazy");
    var imageObserver = new IntersectionObserver(function(entries, observer) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var image = entry.target;
          image.classList.remove("lazy");
          imageObserver.unobserve(image);
        }
      });
    });

    lazyloadImages.forEach(function(image) {
      imageObserver.observe(image);
    });
  } else {
    var lazyloadThrottleTimeout;
    lazyloadImages = document.querySelectorAll(".lazy");

    function lazyload () {
      if(lazyloadThrottleTimeout) {
        clearTimeout(lazyloadThrottleTimeout);
      }

      lazyloadThrottleTimeout = setTimeout(function() {
        var scrollTop = window.pageYOffset;
        lazyloadImages.forEach(function(img) {
          if(img.offsetTop < (window.innerHeight + scrollTop)) {
            img.src = img.dataset.src;
            img.classList.remove('lazy');
          }
        });
        if(lazyloadImages.length == 0) {
          document.removeEventListener("scroll", lazyload);
          window.removeEventListener("resize", lazyload);
          window.removeEventListener("orientationChange", lazyload);
        }
      }, 20);
    }

    document.addEventListener("scroll", lazyload);
    window.addEventListener("resize", lazyload);
    window.addEventListener("orientationChange", lazyload);
  }
});

class QuantityInput extends HTMLElement {
  constructor() {
    super();
    this.input = this.querySelector('input');
    this.changeEvent = new Event('change', { bubbles: true })

    this.querySelectorAll('button').forEach(
      (button) => button.addEventListener('click', this.onButtonClick.bind(this))
    );
  }

  onButtonClick(event) {
    event.preventDefault();
    const previousValue = this.input.value;

    event.target.name === 'plus' ? this.input.stepUp() : this.input.stepDown();
    if (previousValue !== this.input.value) this.input.dispatchEvent(this.changeEvent);
  }
}

customElements.define('quantity-input', QuantityInput);

class MenuDrawer extends HTMLElement {
  constructor() {
    super();

    this.mainDetailsToggle = this.querySelector('details');
    const summaryElements = this.querySelectorAll('summary');
    this.addAccessibilityAttributes(summaryElements);

    if (navigator.platform === 'iPhone') document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);

    this.addEventListener('keyup', this.onKeyUp.bind(this));
    this.addEventListener('focusout', this.onFocusOut.bind(this));
    this.bindEvents();
  }

  bindEvents() {
    this.querySelectorAll('summary').forEach(summary => summary.addEventListener('click', this.onSummaryClick.bind(this)));
    this.querySelectorAll('button').forEach(button => button.addEventListener('click', this.onCloseButtonClick.bind(this)));
  }

  addAccessibilityAttributes(summaryElements) {
    summaryElements.forEach(element => {
      element.setAttribute('role', 'button');
      element.setAttribute('aria-expanded', false);
      element.setAttribute('aria-controls', element.nextElementSibling.id);
    });
  }

  onKeyUp(event) {
    if(event.code.toUpperCase() !== 'ESCAPE') return;

    const openDetailsElement = event.target.closest('details[open]');
    if(!openDetailsElement) return;

    openDetailsElement === this.mainDetailsToggle ? this.closeMenuDrawer(this.mainDetailsToggle.querySelector('summary')) : this.closeSubmenu(openDetailsElement);
  }

  onSummaryClick(event) {
    const summaryElement = event.currentTarget;
    const detailsElement = summaryElement.parentNode;
    const isOpen = detailsElement.hasAttribute('open');

    if (detailsElement === this.mainDetailsToggle) {
      if(isOpen) event.preventDefault();
      isOpen ? this.closeMenuDrawer(summaryElement) : this.openMenuDrawer(summaryElement);
    } else {
      trapFocus(summaryElement.nextElementSibling, detailsElement.querySelector('button'));

      setTimeout(() => {
        detailsElement.classList.add('menu-opening');
      });
    }
  }

  openMenuDrawer(summaryElement) {
    setTimeout(() => {
      this.mainDetailsToggle.classList.add('menu-opening');
    });
    summaryElement.setAttribute('aria-expanded', true);
    trapFocus(this.mainDetailsToggle, summaryElement);
    document.body.classList.add('overflow-hidden-mobile');
  }

  closeMenuDrawer(event, elementToFocus = false) {
    if (event !== undefined) {
      this.mainDetailsToggle.classList.remove('menu-opening');
      this.mainDetailsToggle.querySelectorAll('details').forEach(details =>  {
        details.removeAttribute('open');
        details.classList.remove('menu-opening');
      });
      this.mainDetailsToggle.querySelector('summary').setAttribute('aria-expanded', false);
      document.body.classList.remove('overflow-hidden-mobile');
      removeTrapFocus(elementToFocus);
      this.closeAnimation(this.mainDetailsToggle);
    }
  }

  onFocusOut(event) {
    setTimeout(() => {
      if (this.mainDetailsToggle.hasAttribute('open') && !this.mainDetailsToggle.contains(document.activeElement)) this.closeMenuDrawer();
    });
  }

  onCloseButtonClick(event) {
    const detailsElement = event.currentTarget.closest('details');
    this.closeSubmenu(detailsElement);
  }

  closeSubmenu(detailsElement) {
    detailsElement.classList.remove('menu-opening');
    removeTrapFocus();
    this.closeAnimation(detailsElement);
  }

  closeAnimation(detailsElement) {
    let animationStart;

    const handleAnimation = (time) => {
      if (animationStart === undefined) {
        animationStart = time;
      }

      const elapsedTime = time - animationStart;

      if (elapsedTime < 400) {
        window.requestAnimationFrame(handleAnimation);
      } else {
        detailsElement.removeAttribute('open');
        if (detailsElement.closest('details[open]')) {
          trapFocus(detailsElement.closest('details[open]'), detailsElement.querySelector('summary'));
        }
      }
    }

    window.requestAnimationFrame(handleAnimation);
  }
}

customElements.define('menu-drawer', MenuDrawer);

function cswMostrarErrorMiniCart(msg) {
  var $err = $('#csw-minicart-error');
  if (!$err.length) {
    $err = $('<p id="csw-minicart-error" style="margin:8px 0 0;font-size:0.75em;color:#d2451e;text-align:center;display:none"></p>');
    $('#minicart .csw-comprar').after($err);
  }
  if (msg) { $err.text(msg).show(); } else { $err.hide().text(''); }
}

$('body').on('click', '#minicart .csw-comprar', function() {
  var arr = [];
  try {
    arr = JSON.parse(localStorage.getItem('csw_pending_orders') || '[]');
    if (!Array.isArray(arr)) arr = [];
  } catch(e) {}
  console.log('[CSW] csw-comprar click — items:', arr.length, arr);
  if (!arr.length) return;

  var shop = arr[0].shop;
  var $btn = $('#minicart .csw-comprar');
  $btn.text('Procesando...').css('pointer-events', 'none');
  cswMostrarErrorMiniCart('');

  // Rutar al endpoint GraphQL si hay items de impermeabilizador; si no, REST existente
  var hasImp  = arr.some(function(item) { return item.tipo === 'impermeabilizador'; });
  var apiUrl  = hasImp
    ? 'https://dturkia-custom-size.vercel.app/api/checkout-impermeabilizador'
    : 'https://dturkia-custom-size.vercel.app/api/checkout';

  $.get('/cart.js', function(cartData) {
    console.log('[CSW] cart.js data:', cartData);
    var cartItems = (cartData.items || []).map(function(item) {
      return { variant_id: item.variant_id, quantity: item.quantity };
    });

    var customItems = arr.map(function(item) {
      return {
        // Stock por pliego (Fase 7):
        //  · `id` es la clave de idempotencia de la reserva. Sin él, un doble
        //    clic o un retry de red crearían dos reservas del mismo material.
        //  · `reglaId` le dice al backend de qué producto es la alfombra.
        //  · `tramaId` le dice de qué TRAMA, que es donde vive el stock desde
        //    el cambio del 2026-08-14. Sin él el backend cae al nombre en
        //    `trama`, y si tampoco lo hay, a la única trama de la regla.
        // Los items viejos del localStorage no traen ninguno: el backend los
        // deja pasar (resuelve por variantId y genera un refId), así que no
        // rompen nada.
        id:                      item.id      || null,
        reglaId:                 item.reglaId || null,
        tramaId:                 item.tramaId || null,
        tipo:                    item.tipo || 'medida',
        ancho:                   item.ancho            || null,
        alto:                    item.alto             || null,
        waterproof:              !!item.waterproof,
        precio:                  item.precio           || 0,
        waterproofPrecio:        item.waterproofPrecio || 0,
        variantId:               item.variantId        || null,
        productTitle:            item.productTitle     || null,
        precioVariante:          item.precioVariante          || null,
        precioImpermeabilizador: item.precioImpermeabilizador || null,
        borde:                   item.borde                   || null,
        trama:                   item.trama                   || null
      };
    });

    var payloadKey = hasImp ? 'items' : 'customItems';
    var payload = { shop: shop, cartItems: cartItems };
    payload[payloadKey] = customItems;

    console.log('[CSW] POST', apiUrl, 'payload:', payload);

    $.ajax({
      type: 'POST',
      url: apiUrl,
      contentType: 'application/json',
      dataType: 'json',
      data: JSON.stringify(payload),
      success: function(result) {
        console.log('[CSW] /api/checkout respuesta:', result);
        if (result && result.checkoutUrl) {
          try {
            // Marcar todos los items con el mismo draftOrderId
            var updatedArr = arr.map(function(item) {
              return Object.assign({}, item, {
                draftOrderId:        result.draftOrderId || '',
                checkoutInitiatedAt: Date.now()
              });
            });
            localStorage.setItem('csw_pending_orders', JSON.stringify(updatedArr));
          } catch(e) {}
          window.location.href = result.checkoutUrl;
        } else {
          console.error('[CSW] /api/checkout sin checkoutUrl:', result);
          $btn.text('Comprar').css('pointer-events', '');
          cswMostrarErrorMiniCart('No pudimos procesar tu pedido. Intenta nuevamente.');
        }
      },
      error: function(jqXHR, textStatus, errorThrown) {
        console.error('[CSW] Error $.ajax — status:', jqXHR.status, '| textStatus:', textStatus, '| errorThrown:', errorThrown, '| responseText:', jqXHR.responseText);
        $btn.text('Comprar').css('pointer-events', '');

        // Stock por pliego (Fase 7): mostrar el mensaje REAL del servidor en vez
        // del genérico. Un 409 con motivo SIN_STOCK trae el texto explicando qué
        // medida no cabe; decir "no pudimos conectar" sería mentirle al cliente.
        var msgServidor = '';
        try {
          var resp = jqXHR.responseJSON;
          if (!resp && jqXHR.responseText) resp = JSON.parse(jqXHR.responseText);
          if (resp && resp.error) msgServidor = String(resp.error);
        } catch (e) {}

        cswMostrarErrorMiniCart(
          msgServidor || 'No pudimos conectar con el servidor. Intenta nuevamente.'
        );
      }
    });
  }, 'json').fail(function(jqXHR, textStatus) {
    console.error('[CSW] Error $.get /cart.js — textStatus:', textStatus, '| status:', jqXHR.status);
    $btn.text('Comprar').css('pointer-events', '');
    cswMostrarErrorMiniCart('No pudimos procesar tu pedido. Intenta nuevamente.');
  });
});

function resizeHeader(barraH = 0, headerH = 0, infoH = 0, scroll = true) {
  if ( $(window).width() > 830 ) {
    $('body').css('padding-top', barraH + headerH);
    $('body.template-index').css('padding-top', barraH);
    $('body.template-404').css('padding-top', barraH);
    $('body.template-search').css('padding-top', barraH);
    $('header').css('top', barraH);
    if (scroll === true) {
      $(window).scroll(function() {
        if ($(window).scrollTop() > barraH) {
          $('header').addClass('fix');
          $('header').css('top', 0);
        } else {
          $('header').removeClass('fix');
          $('header').css('top', barraH);
        }
      });
    }
  } else {
    $('body').css('padding-top', barraH + headerH);
    $('body.template-index').css('padding-top', barraH);
    $('body.template-404').css('padding-top', barraH);
    $('body.template-search').css('padding-top', barraH);
    $('header').css('top', barraH);
    if (scroll === true) {
      $(window).scroll(function() {
        if ($(window).scrollTop() > barraH) {
          $('header').addClass('fix');
          $('header').css('top', 0);
        } else {
          $('header').removeClass('fix');
          $('header').css('top', barraH);
        }
      });
    }
  }
}
