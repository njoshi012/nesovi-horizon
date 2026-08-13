import { Component } from '@theme/component';
import { fetchConfig } from '@theme/utilities';
import { CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

const TOAST_DURATION_MS = 2500;

/**
 * <bundle-builder-component> — the "make your own bundle" build-a-box wizard.
 *
 * Steps and their eligible products come entirely from
 * `product.metafields.custom.flexi_box_bundle` (read by the section, not this
 * script) — this component only cares about what's rendered: one `.bundle-builder__panel`
 * per step, each carrying `data-tab` and `data-limit`, and one checkbox per
 * selectable item carrying `data-tab`, `data-sku`, `data-price` (variant price,
 * in cents) and its line-item property `value`.
 *
 * On submit, contents are added to cart as a single line (the bundle's own
 * variant) carrying `_ITEM{n}` / `_bundle_product{n}` line-item properties —
 * this exact property format is relied on downstream and must not change.
 * The add itself reuses the theme's real cart-update pipeline
 * (`CartLinesUpdateEvent`), so the cart drawer/cart icon/cart-items-component
 * all refresh exactly like a normal add-to-cart, with no page reload.
 *
 * @typedef {object} BundleBuilderRefs
 * @property {HTMLElement[]} tabs
 * @property {HTMLElement[]} panels
 * @property {HTMLElement[]} [stepCounters]
 * @property {HTMLInputElement} [searchInput]
 * @property {HTMLButtonElement} submitButton
 * @property {HTMLElement} [toast]
 * @property {HTMLElement} [toastText]
 *
 * @extends {Component<BundleBuilderRefs>}
 */
export class BundleBuilderComponent extends Component {
  requiredRefs = ['tabs', 'panels', 'submitButton'];

  /** @type {Map<string, string>} checkbox id -> the value it was rendered with */
  #initialCheckboxValues = new Map();

  /** @type {number} */
  #requiredTotal = 0;

  /** @type {number | null} */
  #toastTimeout = null;

  connectedCallback() {
    super.connectedCallback();

    this.#requiredTotal = Number(this.dataset.requiredTotal) || 0;

    for (const checkbox of this.#checkboxes()) {
      this.#initialCheckboxValues.set(checkbox.id, checkbox.value.trim());
      checkbox.disabled = false;
    }

    this.addEventListener('scroll', this.#handleSliderScroll, true);
    this.#updateBubbleCounters();
    this.#updateSubmitButtonState();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('scroll', this.#handleSliderScroll, true);
    if (this.#toastTimeout) clearTimeout(this.#toastTimeout);
  }

  /** @returns {HTMLInputElement[]} */
  #checkboxes() {
    return /** @type {HTMLInputElement[]} */ (Array.from(this.querySelectorAll('.bundle-builder__checkbox')));
  }

  /** @param {string | number | undefined} tab */
  #panelFor(tab) {
    return this.refs.panels.find((panel) => panel.dataset.tab === String(tab));
  }

  /**
   * Switches the active step tab.
   * @param {Event & {target: HTMLElement}} event
   */
  handleTabClick(event) {
    const tab = event.target.closest('[data-tab]');
    if (!(tab instanceof HTMLElement)) return;

    this.#activateTab(tab.dataset.tab);
  }

  /** @param {string | undefined} tab */
  #activateTab(tab) {
    if (!tab) return;

    for (const panel of this.refs.panels) {
      panel.classList.toggle('bundle-builder__panel--active', panel.dataset.tab === tab);
    }
    for (const tabButton of this.refs.tabs) {
      tabButton.classList.toggle('bundle-builder__tab--active', tabButton.dataset.tab === tab);
    }

    this.#updateBubbleCounters();
    this.#clearSearch();
    this.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Handles a selection checkbox changing — enforces the step's selection
   * limit, advances to the next step once it's met, and updates the toast,
   * badges, bubble counters, and submit button state.
   * @param {Event & {target: HTMLInputElement}} event
   */
  handleCheckboxChange(event) {
    const checkbox = event.target;
    const initialValue = this.#initialCheckboxValues.get(checkbox.id);

    // The rendered value (price/availability) no longer matches what loaded —
    // most likely a stale bfcache page. Reload rather than submit bad data.
    if (initialValue !== undefined && checkbox.value.trim() !== initialValue) {
      window.location.reload();
      return;
    }

    const tab = checkbox.dataset.tab;
    const panel = this.#panelFor(tab);
    const limit = Number(panel?.dataset.limit) || 0;

    const item = checkbox.closest('.bundle-builder__item');
    item?.classList.toggle('bundle-builder__item--selected', checkbox.checked);

    if (checkbox.checked) {
      this.#showToast(checkbox.value.split('/')[0] ?? '');
    }

    const tabCheckboxes = this.#checkboxes().filter((cb) => cb.dataset.tab === tab);
    const checkedCount = tabCheckboxes.filter((cb) => cb.checked).length;
    const limitReached = checkedCount === limit;

    for (const cb of tabCheckboxes) {
      if (!cb.checked) cb.disabled = limitReached;
    }

    this.#updateBubbleCounters();

    if (limitReached) {
      const nextTab = String(Number(tab) + 1);
      if (this.#panelFor(nextTab)) this.#activateTab(nextTab);
    }

    this.#updateSubmitButtonState();
  }

  #updateBubbleCounters() {
    for (const counter of this.refs.stepCounters ?? []) {
      const panel = this.#panelFor(counter.dataset.tab);
      const limit = Number(panel?.dataset.limit) || 0;
      const checkedCount = this.#checkboxes().filter(
        (cb) => cb.dataset.tab === counter.dataset.tab && cb.checked
      ).length;
      const limitReached = checkedCount === limit;
      const isActiveTab = panel?.classList.contains('bundle-builder__panel--active') ?? false;

      counter.classList.toggle('bundle-builder__step-counter--done', limitReached);
      counter.classList.toggle('bundle-builder__step-counter--done-active', limitReached && isActiveTab);
      counter.textContent = limitReached ? '' : checkedCount > 0 ? String(checkedCount) : '';
    }
  }

  #updateSubmitButtonState() {
    const totalChecked = this.#checkboxes().filter((cb) => cb.checked).length;
    const available = this.refs.submitButton.dataset.available !== 'false';
    const ready = available && this.#requiredTotal > 0 && totalChecked === this.#requiredTotal;

    this.refs.submitButton.classList.toggle('bundle-builder__submit--ready', ready);
    this.refs.submitButton.disabled = !ready;
  }

  /** @param {string} title */
  #showToast(title) {
    const { toast, toastText } = this.refs;
    if (!toast) return;

    if (toastText) toastText.textContent = title;
    toast.classList.add('bundle-builder__toast--visible');

    if (this.#toastTimeout) clearTimeout(this.#toastTimeout);
    this.#toastTimeout = window.setTimeout(() => {
      toast.classList.remove('bundle-builder__toast--visible');
    }, TOAST_DURATION_MS);
  }

  /** @param {Event & {target: HTMLInputElement}} event */
  handleSearchInput(event) {
    const query = event.target.value.trim().toLowerCase();
    for (const item of this.querySelectorAll('.bundle-builder__item')) {
      const title = item.querySelector('.bundle-builder__item-title')?.textContent?.toLowerCase() ?? '';
      item.toggleAttribute('hidden', query !== '' && !title.includes(query));
    }
  }

  handleSearchClear() {
    this.#clearSearch();
  }

  #clearSearch() {
    const { searchInput } = this.refs;
    if (!searchInput) return;

    searchInput.value = '';
    for (const item of this.querySelectorAll('.bundle-builder__item')) {
      item.removeAttribute('hidden');
    }
  }

  /**
   * Opens the info popup for the clicked item (image slider, price, description).
   * Purely informational — selection only happens via the checkbox pill.
   * @param {Event & {target: HTMLElement}} event
   */
  openPopup(event) {
    const trigger = event.target.closest('.bundle-builder__item-trigger');
    const popup = this.querySelector('.bundle-builder__popup');
    if (!(trigger instanceof HTMLElement) || !popup) return;

    const slider = trigger.querySelector('.bundle-builder__slider');
    const images = popup.querySelector('.bundle-builder__popup-images');
    if (images) {
      images.replaceChildren();
      if (slider) {
        const clonedSlider = slider.cloneNode(true);
        images.appendChild(clonedSlider);
      }
    }

    /** @type {Record<string, string>} */
    const fields = {
      title: 'popup-title',
      price: 'popup-price',
      compareAtPrice: 'popup-compare-at-price',
      description: 'popup-description',
    };

    for (const [dataKey, className] of Object.entries(fields)) {
      const target = popup.querySelector(`.bundle-builder__${className}`);
      if (target) target.textContent = trigger.dataset[dataKey] ?? '';
    }

    popup.classList.add('bundle-builder__popup--active');
    this.querySelector('.bundle-builder__popup-overlay')?.classList.add('bundle-builder__popup-overlay--active');
    document.body.classList.add('overflow-hidden');
  }

  closePopup() {
    this.querySelector('.bundle-builder__popup')?.classList.remove('bundle-builder__popup--active');
    this.querySelector('.bundle-builder__popup-overlay')?.classList.remove('bundle-builder__popup-overlay--active');
    document.body.classList.remove('overflow-hidden');
  }

  /**
   * Moves an image slider to the slide at `data-index` on the clicked dot.
   * Delegated via the theme's declarative `on:click`, so this works the same
   * whether the slider is the one rendered in the grid or the clone inside
   * the popup.
   * @param {Event & {target: HTMLElement}} event
   */
  handleDotClick(event) {
    const dot = event.target.closest('.bundle-builder__slider-dot');
    if (!(dot instanceof HTMLElement)) return;

    const slider = dot.closest('.bundle-builder__slider')?.querySelector('.bundle-builder__slider-track');
    const index = Number(dot.dataset.index);
    const slide = slider?.children[index];
    if (!(slide instanceof HTMLElement)) return;

    slider?.scrollTo({ left: slide.offsetLeft, behavior: 'smooth' });
  }

  /** @param {Event} event */
  #handleSliderScroll = (event) => {
    const track = event.target;
    if (!(track instanceof HTMLElement) || !track.classList.contains('bundle-builder__slider-track')) return;

    const dots = track.closest('.bundle-builder__slider')?.querySelectorAll('.bundle-builder__slider-dot');
    if (!dots?.length) return;

    const trackRect = track.getBoundingClientRect();
    let closestIndex = 0;
    let closestDistance = Infinity;

    Array.from(track.children).forEach((slide, index) => {
      const distance = Math.abs(slide.getBoundingClientRect().left - trackRect.left);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    dots.forEach((dot, index) => dot.classList.toggle('bundle-builder__slider-dot--active', index === closestIndex));
  };

  /**
   * Builds the bundle's line-item properties and adds it to cart, then routes
   * the result through the theme's normal cart-update pipeline so the cart
   * drawer/icon/line items refresh exactly like any other add-to-cart.
   * @param {Event} event
   */
  async handleSubmit(event) {
    event.preventDefault();

    const { submitButton } = this.refs;
    if (submitButton.disabled || submitButton.classList.contains('bundle-builder__submit--loading')) return;

    const checkedInputs = this.#checkboxes().filter((cb) => cb.checked);
    if (checkedInputs.length === 0) return;

    submitButton.classList.add('bundle-builder__submit--loading');
    submitButton.disabled = true;

    const variantId = this.dataset.variantId;
    const properties = this.#buildBundleProperties(checkedInputs);

    const cartItemsComponents = document.querySelectorAll('cart-items-component');
    const sectionIds = Array.from(cartItemsComponents)
      .map((el) => /** @type {HTMLElement} */ (el).dataset.sectionId)
      .filter(Boolean);

    const deferredEventPromise = CartLinesUpdateEvent.createPromise();

    this.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'add',
        context: 'product',
        lines: [{ merchandiseId: /** @type {string} */ (variantId), quantity: 1 }],
        promise: deferredEventPromise.promise,
      })
    );

    try {
      const response = await fetch(
        Theme.routes.cart_add_url,
        fetchConfig('json', {
          body: JSON.stringify({
            items: [{ id: Number(variantId), quantity: 1, properties }],
            sections: sectionIds.join(','),
          }),
        })
      ).then((res) => res.json());

      if (response.status) {
        throw new Error(response.message || 'Add to cart failed');
      }

      const cart = await fetch(`${Theme.routes.cart_url}.json`, { credentials: 'same-origin' }).then((res) =>
        res.json()
      );

      deferredEventPromise.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
        detail: {
          items: cart.items,
          source: 'bundle-builder-component',
          sourceId: this.id,
          itemCount: 1,
          sections: response.sections,
          didError: false,
        },
      });

      this.#resetAfterAdd();
    } catch (error) {
      console.error(error);
      deferredEventPromise.reject(error);
      this.dispatchEvent(
        new CartErrorEvent({
          error: /** @type {Error} */ (error)?.message || 'Add to cart failed',
          code: 'INVALID',
        })
      );
    } finally {
      submitButton.classList.remove('bundle-builder__submit--loading');
      this.#updateSubmitButtonState();
    }
  }

  /**
   * Replicates the exact `_ITEM{n}` / `_bundle_product{n}` property contract
   * the previous bundle implementation produced, so any downstream
   * fulfillment/order-processing that parses these keeps working unchanged.
   * @param {HTMLInputElement[]} checkedInputs
   */
  #buildBundleProperties(checkedInputs) {
    const parentSku = this.dataset.sku ?? '';
    const parentPriceCents = Number(this.dataset.price) || 0;

    /** @type {Record<string, string>} */
    const properties = {};
    properties['_bundle_product1'] = `${parentSku}/0/1`;

    const totalRegularCents = checkedInputs.reduce((sum, input) => sum + (Number(input.dataset.price) || 0), 0);

    let priceAssignedCents = 0;
    checkedInputs.forEach((input, index) => {
      properties[`_ITEM${index + 1}`] = input.value;

      const inputPriceCents = Number(input.dataset.price) || 0;
      let shareCents;

      if (totalRegularCents > 0 && parentPriceCents > 0) {
        shareCents = Math.round((inputPriceCents / totalRegularCents) * parentPriceCents);
      } else if (parentPriceCents > 0) {
        shareCents = Math.round(parentPriceCents / checkedInputs.length);
      } else {
        shareCents = 0;
      }

      // The last item absorbs the rounding remainder so allocated shares sum
      // exactly to the bundle's actual selling price.
      if (index === checkedInputs.length - 1) {
        shareCents = parentPriceCents - priceAssignedCents;
      }
      priceAssignedCents += shareCents;

      const priceDecimal = (shareCents / 100).toFixed(2);
      properties[`_bundle_product${index + 2}`] = `${input.dataset.sku ?? ''}/${priceDecimal}/1`;
    });

    return properties;
  }

  #resetAfterAdd() {
    for (const checkbox of this.#checkboxes()) {
      checkbox.checked = false;
      checkbox.disabled = false;
    }
    for (const item of this.querySelectorAll('.bundle-builder__item--selected')) {
      item.classList.remove('bundle-builder__item--selected');
    }

    const firstTab = this.refs.tabs[0]?.dataset.tab;
    if (firstTab) this.#activateTab(firstTab);

    this.#updateBubbleCounters();
    this.#updateSubmitButtonState();
  }
}

if (!customElements.get('bundle-builder-component')) {
  customElements.define('bundle-builder-component', BundleBuilderComponent);
}
