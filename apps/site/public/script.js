// Labbench site — scroll reveal + connector draw-in + smooth anchor scroll.
(function () {
  'use strict';

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Prep draw-in connectors: set --len from each path's true length so the
  // dash animation covers the whole stroke exactly.
  var draws = document.querySelectorAll('.draw');
  for (var i = 0; i < draws.length; i++) {
    var el = draws[i];
    try {
      var len = Math.ceil(el.getTotalLength()) + 2;
      el.style.setProperty('--len', len);
    } catch (e) { /* non-path elements ignore */ }
  }

  if (reduce || !('IntersectionObserver' in window)) {
    // Show everything immediately.
    var all = document.querySelectorAll('.reveal, .diagram-scroll');
    for (var j = 0; j < all.length; j++) all[j].classList.add('in');
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    var targets = document.querySelectorAll('.reveal, .diagram-scroll');
    for (var k = 0; k < targets.length; k++) io.observe(targets[k]);
  }

  // Hero motif scroll parallax — throttled via requestAnimationFrame.
  // Each wrapper drifts at its own rate; the inner SVG keeps its CSS drift.
  if (!reduce) {
    var wraps = document.querySelectorAll('.hero-motifs .motif-wrap');
    if (wraps.length && 'requestAnimationFrame' in window) {
      var rates = [];
      for (var w = 0; w < wraps.length; w++) {
        rates[w] = parseFloat(wraps[w].getAttribute('data-rate')) || 0;
      }
      var ticking = false;
      var updateParallax = function () {
        var y = window.pageYOffset || 0;
        for (var m = 0; m < wraps.length; m++) {
          var dy = y * rates[m];
          var rot = y * rates[m] * 0.12;
          wraps[m].style.transform =
            'translate3d(0,' + dy.toFixed(1) + 'px,0) rotate(' + rot.toFixed(2) + 'deg)';
        }
        ticking = false;
      };
      window.addEventListener('scroll', function () {
        if (!ticking) { window.requestAnimationFrame(updateParallax); ticking = true; }
      }, { passive: true });
      updateParallax();
    }
  }

  // Smooth in-page anchor scrolling (accounts for fixed top bar).
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (id.length < 2) return;
    var target = document.querySelector(id);
    if (!target) return;
    ev.preventDefault();
    var top = target.getBoundingClientRect().top + window.pageYOffset - 60;
    window.scrollTo({ top: top, behavior: reduce ? 'auto' : 'smooth' });
    if (history.replaceState) history.replaceState(null, '', id);
  });
})();
