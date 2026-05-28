/*!
 * Clean Blog v1.0.0 (http://startbootstrap.com)
 * Copyright 2015 Start Bootstrap
 * Licensed under Apache 2.0 (https://github.com/IronSummitMedia/startbootstrap/blob/gh-pages/LICENSE)
 */

/*!
 * Hux Blog v1.6.0 (http://startbootstrap.com)
 * Copyright 2016 @huxpro
 * Licensed under Apache 2.0
 */

$(document).ready(function() {
    // responsive tables
    $('table').wrap('<div class="table-responsive"></div>').addClass('table');

    // responsive embed videos
    $('iframe[src*="youtube.com"], iframe[src*="vimeo.com"]')
        .wrap('<div class="embed-responsive embed-responsive-16by9"></div>')
        .addClass('embed-responsive-item');
});

// Navigation Scripts to Show Header on Scroll-Up
jQuery(document).ready(function($) {
    var MQL = 1170;

    if ($(window).width() <= MQL) {
        return;
    }

    var headerHeight = $('.navbar-custom').height();
    var bannerHeight = $('.intro-header .container').height();
    var ticking = false;
    var previousTop = 0;

    function onScroll() {
        var currentTop = $(window).scrollTop();
        var $navbar = $('.navbar-custom');
        var $catalog = $('.side-catalog');

        if (currentTop < previousTop) {
            if (currentTop > 0 && $navbar.hasClass('is-fixed')) {
                $navbar.addClass('is-visible');
            } else {
                $navbar.removeClass('is-visible is-fixed');
            }
        } else {
            $navbar.removeClass('is-visible');
            if (currentTop > headerHeight && !$navbar.hasClass('is-fixed')) {
                $navbar.addClass('is-fixed');
            }
        }
        previousTop = currentTop;

        $catalog.show();
        if (currentTop > bannerHeight + 41) {
            $catalog.addClass('fixed');
        } else {
            $catalog.removeClass('fixed');
        }

        ticking = false;
    }

    $(window).on('scroll', function() {
        if (!ticking) {
            window.requestAnimationFrame(onScroll);
            ticking = true;
        }
    });
});
