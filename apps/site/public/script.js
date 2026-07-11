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
