/**
 * <hero-slider> — self-contained, dependency-free slider custom element.
 *
 * Each <hero-slider> element manages its own slides, timers, and pointer
 * state entirely through `this` / private class fields — there is no shared
 * or global state — so multiple instances on the same page (or the same
 * section re-rendered by the Shopify theme editor) never collide, even
 * though they all share one `id="HeroSlider-{{ section.id }}"` naming
 * scheme in the markup for ARIA wiring only.
 *
 * Slide count is read from the DOM at connect time (`track.children.length`),
 * never hardcoded, so it stays correct as an admin adds/removes/reorders
 * slide blocks in the customizer.
 */
class HeroSlider extends HTMLElement {
  static SWIPE_THRESHOLD_PX = 50;

  /** @type {HTMLElement | null} */
  #track = null;
  /** @type {HTMLElement[]} */
  #slides = [];
  /** @type {HTMLElement[]} */
  #dots = [];

  #activeIndex = 0;
  #slideCount = 0;

  #autoplayEnabled = false;
  #autoplaySpeed = 5000;
  /** @type {number | null} */
  #autoplayTimer = null;
  #prefersReducedMotion = false;

  #isDragging = false;
  /** @type {number | null} */
  #pointerId = null;
  #dragStartX = 0;
  #dragCurrentX = 0;

  connectedCallback() {
    this.#track = /** @type {HTMLElement | null} */ (this.querySelector('.hero-slider__track'));
    if (!this.#track) return; // 0 slides: nothing rendered, nothing to wire up

    this.#slides = /** @type {HTMLElement[]} */ (Array.from(this.#track.children));
    this.#slideCount = this.#slides.length;

    // A single slide is fully static — no dots exist in the markup, and
    // there's nothing to swipe between, so skip all interaction wiring.
    if (this.#slideCount <= 1) return;

    this.#dots = /** @type {HTMLElement[]} */ (Array.from(this.querySelectorAll('.hero-slider__dot')));

    this.#autoplayEnabled = this.dataset.autoplay === 'true';
    this.#autoplaySpeed = (Number.parseFloat(this.dataset.autoplaySpeed || '5') || 5) * 1000;
    this.#prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.#dots.forEach((dot) => dot.addEventListener('click', this.#handleDotClick));

    // Pause autoplay whenever the pointer or keyboard focus is inside the
    // slider, resume when it leaves — covers hover (desktop) and a11y.
    this.addEventListener('pointerenter', this.#handlePointerEnter);
    this.addEventListener('pointerleave', this.#handlePointerLeave);
    this.addEventListener('focusin', this.#handlePointerEnter);
    this.addEventListener('focusout', this.#handlePointerLeave);

    this.#track.addEventListener('pointerdown', this.#handleDragStart);
    this.#track.addEventListener('pointermove', this.#handleDragMove);
    this.#track.addEventListener('pointerup', this.#handleDragEnd);
    this.#track.addEventListener('pointercancel', this.#handleDragEnd);

    this.#render();
    this.#startAutoplay();
  }

  disconnectedCallback() {
    this.#stopAutoplay();

    this.#dots.forEach((dot) => dot.removeEventListener('click', this.#handleDotClick));

    this.removeEventListener('pointerenter', this.#handlePointerEnter);
    this.removeEventListener('pointerleave', this.#handlePointerLeave);
    this.removeEventListener('focusin', this.#handlePointerEnter);
    this.removeEventListener('focusout', this.#handlePointerLeave);

    this.#track?.removeEventListener('pointerdown', this.#handleDragStart);
    this.#track?.removeEventListener('pointermove', this.#handleDragMove);
    this.#track?.removeEventListener('pointerup', this.#handleDragEnd);
    this.#track?.removeEventListener('pointercancel', this.#handleDragEnd);
  }

  /** @param {number} index */
  #goTo(index) {
    this.#activeIndex = (index + this.#slideCount) % this.#slideCount;
    this.#render();
  }

  #next = () => this.#goTo(this.#activeIndex + 1);
  #prev = () => this.#goTo(this.#activeIndex - 1);

  #render() {
    if (!this.#track) return;

    this.#track.style.transform = `translateX(-${this.#activeIndex * 100}%)`;

    this.#slides.forEach((slide, i) => {
      slide.setAttribute('aria-hidden', String(i !== this.#activeIndex));
    });

    this.#dots.forEach((dot, i) => {
      const isActive = i === this.#activeIndex;
      dot.classList.toggle('hero-slider__dot--active', isActive);
      dot.setAttribute('aria-selected', String(isActive));
    });
  }

  /** @param {MouseEvent} event */
  #handleDotClick = (event) => {
    const dot = /** @type {HTMLElement} */ (event.currentTarget);
    const index = Number.parseInt(dot.dataset.index || '', 10);
    if (Number.isNaN(index)) return;
    this.#goTo(index);
    this.#restartAutoplay();
  };

  #startAutoplay() {
    if (!this.#autoplayEnabled || this.#prefersReducedMotion) return;
    this.#stopAutoplay();
    this.#autoplayTimer = window.setInterval(this.#next, this.#autoplaySpeed);
  }

  #stopAutoplay() {
    if (this.#autoplayTimer === null) return;
    window.clearInterval(this.#autoplayTimer);
    this.#autoplayTimer = null;
  }

  #restartAutoplay() {
    if (!this.#autoplayEnabled) return;
    this.#startAutoplay();
  }

  #handlePointerEnter = () => this.#stopAutoplay();
  #handlePointerLeave = () => this.#restartAutoplay();

  /** @param {PointerEvent} event */
  #handleDragStart = (event) => {
    if (!this.#track) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    this.#isDragging = true;
    this.#pointerId = event.pointerId;
    this.#dragStartX = event.clientX;
    this.#dragCurrentX = event.clientX;

    this.#track.setPointerCapture(event.pointerId);
    this.classList.add('hero-slider--dragging');
    this.#stopAutoplay();
  };

  /** @param {PointerEvent} event */
  #handleDragMove = (event) => {
    if (!this.#track || !this.#isDragging || event.pointerId !== this.#pointerId) return;

    this.#dragCurrentX = event.clientX;
    const deltaPercent = ((this.#dragCurrentX - this.#dragStartX) / this.offsetWidth) * 100;
    this.#track.style.transform = `translateX(calc(-${this.#activeIndex * 100}% + ${deltaPercent}%))`;
  };

  /** @param {PointerEvent} event */
  #handleDragEnd = (event) => {
    if (!this.#isDragging || event.pointerId !== this.#pointerId) return;

    this.#isDragging = false;
    this.classList.remove('hero-slider--dragging');

    const deltaX = this.#dragCurrentX - this.#dragStartX;

    if (Math.abs(deltaX) > HeroSlider.SWIPE_THRESHOLD_PX) {
      if (deltaX < 0) this.#next();
      else this.#prev();
    } else {
      // Not a decisive swipe — snap back to the current slide.
      this.#render();
    }

    this.#restartAutoplay();
  };
}

if (!customElements.get('hero-slider')) {
  customElements.define('hero-slider', HeroSlider);
}
