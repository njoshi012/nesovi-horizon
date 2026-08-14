import { Component } from '@theme/component';
import { fetchConfig } from '@theme/utilities';
import { formatMoney } from '@theme/money-formatting';
import { CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

const TOAST_DURATION_MS = 2500;

/**
 * <bundle-grid-component> — the "make your own bundle" flat-grid variant.
 *
 * Products come from `product.metafields.custom.flexi_box_bundle` (read by
 * the section, not this script) — every eligible product across every
 * metafield entry is rendered into one flat `.bundle-grid__grid`, tagged with
 * which filter pill(s) it belongs to via `data-cats`. This component only
 * enforces a single global pick limit (`data-required-total`) across the
 * whole grid, unlike <bundle-builder-component>'s per-step limits.
 *
 * On submit, contents are added to cart as a single line (the bundle's own
 * variant) carrying `_ITEM{n}` / `_bundle_product{n}` line-item properties —
 * this exact property format is shared with the step-wise bundle and relied
 * on downstream, so it must not change. The add itself reuses the theme's
 * real cart-update pipeline (`CartLinesUpdateEvent`), so the cart
 * drawer/cart icon/cart-items-component all refresh exactly like a normal
 * add-to-cart, with no page reload.
 *
 * @typedef {object} BundleGridRefs
 * @property {HTMLTemplateElement} [moneyFormat]
 * @property {HTMLElement[]} pills
 * @property {HTMLInputElement} [searchInput]
 * @property {HTMLElement} [noResults]
 * @property {HTMLElement} tray
 * @property {HTMLElement[]} traySlots
 * @property {HTMLElement} [trayCountCurrent]
 * @property {HTMLElement} [trayHint]
 * @property {HTMLElement} [trayPriceCompare]
 * @property {HTMLButtonElement} submitButton
 * @property {HTMLElement} sheet
 * @property {HTMLElement} [sheetCount]
 * @property {HTMLElement} sheetItems
 * @property {HTMLElement} [sheetEmpty]
 * @property {HTMLElement} [sheetBill]
 * @property {HTMLElement} [sheetSaved]
 * @property {HTMLElement} [sheetBillCount]
 * @property {HTMLElement} [sheetBillUnit]
 * @property {HTMLElement} [sheetSubtotal]
 * @property {HTMLElement} [sheetDiscountRow]
 * @property {HTMLElement} [sheetDiscount]
 * @property {HTMLElement} [sheetTotal]
 * @property {HTMLElement} [sheetPriceCompare]
 * @property {HTMLButtonElement} [sheetSubmitButton]
 * @property {HTMLElement} [sheetBackdrop]
 * @property {HTMLElement} [toast]
 * @property {HTMLElement} [toastText]
 *
 * @extends {Component<BundleGridRefs>}
 */
export class BundleGridComponent extends Component {
  requiredRefs = ['pills', 'tray', 'traySlots', 'submitButton', 'sheet', 'sheetItems', 'toast'];

  /** @type {Map<HTMLInputElement, string>} checkbox -> the value it was rendered with */
  #initialCheckboxValues = new Map();

  /** @type {number} */
  #requiredTotal = 0;

  /** @type {number} */
  #bundlePriceCents = 0;

  /** Ordered so the tray fills slots in the order the customer picked, left to right. @type {HTMLInputElement[]} */
  #selection = [];

  /** @type {string} */
  #activeCat = 'all';

  /** @type {string} */
  #moneyFormat = '{{amount}}';

  /** @type {string} */
  #currency = '';

  /** @type {number | null} */
  #toastTimeout = null;

  connectedCallback() {
    super.connectedCallback();

    this.#requiredTotal = Number(this.dataset.requiredTotal) || 0;
    this.#bundlePriceCents = Number(this.dataset.price) || 0;
    this.#currency = this.dataset.currency ?? '';

    if (this.refs.moneyFormat instanceof HTMLTemplateElement) {
      this.#moneyFormat = this.refs.moneyFormat.content.textContent || this.#moneyFormat;
    }

    for (const checkbox of this.#checkboxes()) {
      this.#initialCheckboxValues.set(checkbox, checkbox.value.trim());
      checkbox.disabled = false;
    }

    this.addEventListener('click', this.#handleLockedCardClick);
    document.addEventListener('keydown', this.#handleKeydown);

    this.#renderTray();
    this.#applyFilters();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.#handleLockedCardClick);
    document.removeEventListener('keydown', this.#handleKeydown);
    if (this.#toastTimeout) clearTimeout(this.#toastTimeout);
  }

  /** @returns {HTMLInputElement[]} */
  #checkboxes() {
    return /** @type {HTMLInputElement[]} */ (Array.from(this.querySelectorAll('.bundle-grid__toggle-input')));
  }

  /** @param {number} cents */
  #money(cents) {
    return formatMoney(Number(cents) || 0, this.#moneyFormat, this.#currency);
  }

  /**
   * Enforces the global pick limit — once reached, every unchecked checkbox
   * is disabled and its card visually locked.
   */
  #lockUnselected() {
    const atLimit = this.#selection.length >= this.#requiredTotal;
    for (const checkbox of this.#checkboxes()) {
      const card = checkbox.closest('.bundle-grid__card');
      if (checkbox.checked) {
        card?.classList.add('bundle-grid__card--selected');
        card?.classList.remove('bundle-grid__card--locked');
        checkbox.disabled = false;
      } else {
        card?.classList.remove('bundle-grid__card--selected');
        card?.classList.toggle('bundle-grid__card--locked', atLimit);
        checkbox.disabled = atLimit;
      }
    }
  }

  /**
   * @param {Event & {target: HTMLInputElement}} event
   */
  handleCheckboxChange(event) {
    const checkbox = event.target;
    const initialValue = this.#initialCheckboxValues.get(checkbox);

    // The rendered value (price/availability) no longer matches what loaded —
    // most likely a stale bfcache page. Reload rather than submit bad data.
    if (initialValue !== undefined && checkbox.value.trim() !== initialValue) {
      window.location.reload();
      return;
    }

    if (checkbox.checked) {
      if (this.#selection.length >= this.#requiredTotal) {
        // Belt and braces — the checkbox should already be disabled at this point.
        checkbox.checked = false;
        return;
      }
      this.#selection.push(checkbox);
      this.#showToast(checkbox.dataset.title ?? '');
    } else {
      this.#selection = this.#selection.filter((cb) => cb !== checkbox);
    }

    this.#lockUnselected();
    this.#renderTray();
  }

  /** Clicking a locked card should explain itself rather than do nothing. */
  #handleLockedCardClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const card = target.closest('.bundle-grid__card--locked');
    if (!card || !target.closest('.bundle-grid__toggle')) return;

    card.classList.remove('bundle-grid__card--shake');
    void /** @type {HTMLElement} */ (card).offsetWidth; // restart the animation
    card.classList.add('bundle-grid__card--shake');
  };

  /** @param {string} title */
  #showToast(title) {
    const { toast, toastText } = this.refs;
    if (!toast) return;

    if (toastText) toastText.textContent = title;
    toast.classList.add('bundle-grid__toast--visible');

    if (this.#toastTimeout) clearTimeout(this.#toastTimeout);
    this.#toastTimeout = window.setTimeout(() => {
      toast.classList.remove('bundle-grid__toast--visible');
    }, TOAST_DURATION_MS);
  }

  /** @param {Event & {target: HTMLElement}} event */
  handlePillClick(event) {
    const pill = event.target.closest('[data-cat]');
    if (!(pill instanceof HTMLElement)) return;

    this.#activeCat = pill.dataset.cat ?? 'all';
    this.#setActivePill(this.#activeCat);
    this.#applyFilters();

    // On mobile the grid is a horizontal scroller — rewind it so the first
    // match of the new filter is visible rather than whatever was scrolled to.
    const grid = this.querySelector('.bundle-grid__grid');
    if (grid) {
      grid.scrollLeft = 0;
      grid.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    }
  }

  /** @param {string} cat */
  #setActivePill(cat) {
    for (const pill of this.refs.pills) {
      const on = pill.dataset.cat === cat;
      pill.classList.toggle('bundle-grid__pill--active', on);
      pill.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  handleSearchInput() {
    this.#applyFilters();
  }

  handleSearchClear() {
    const { searchInput } = this.refs;
    if (searchInput) searchInput.value = '';
    this.#applyFilters();
  }

  #applyFilters() {
    const { searchInput, noResults } = this.refs;
    const term = (searchInput?.value ?? '').trim().toLowerCase();
    let visible = 0;

    for (const card of Array.from(this.querySelectorAll('.bundle-grid__card'))) {
      const cats = (card.dataset.cats || '').split(/\s+/).filter(Boolean);
      const catOk = this.#activeCat === 'all' || cats.includes(this.#activeCat);
      const title = card.querySelector('.bundle-grid__card-title')?.textContent?.toLowerCase() ?? '';
      const searchOk = !term || title.includes(term);

      const show = catOk && searchOk;
      card.hidden = !show;
      if (show) visible++;
    }

    if (noResults) noResults.hidden = visible !== 0;
  }

  #renderTray() {
    const { tray, traySlots, trayCountCurrent, trayHint, submitButton, sheetSubmitButton } = this.refs;

    traySlots.forEach((slot, index) => {
      const checkbox = this.#selection[index];
      slot.replaceChildren();
      if (checkbox) {
        const img = document.createElement('img');
        img.src = checkbox.dataset.thumb || '';
        img.alt = checkbox.dataset.title || '';
        img.loading = 'lazy';
        slot.appendChild(img);
        slot.classList.add('bundle-grid__tray-slot--filled');
        slot.title = checkbox.dataset.title || '';
      } else {
        const plus = document.createElement('span');
        plus.className = 'bundle-grid__tray-slot-plus';
        plus.setAttribute('aria-hidden', 'true');
        plus.textContent = '+';
        slot.appendChild(plus);
        slot.classList.remove('bundle-grid__tray-slot--filled');
        slot.removeAttribute('title');
      }
    });

    const remaining = Math.max(0, this.#requiredTotal - this.#selection.length);
    if (trayCountCurrent) trayCountCurrent.textContent = String(this.#selection.length);

    if (trayHint) {
      const price = trayHint.dataset.unlockPrice || '';
      if (remaining === 0) {
        trayHint.textContent = (trayHint.dataset.unlockDone || '').replace('[price]', price);
      } else if (remaining === 1) {
        trayHint.textContent = `${trayHint.dataset.unlockSingular ?? ''} ${price}`.trim();
      } else {
        trayHint.textContent = `${(trayHint.dataset.unlockPlural ?? '').replace('[n]', String(remaining))} ${price}`.trim();
      }
    }

    tray.dataset.state = this.#selection.length === 0 ? 'empty' : remaining === 0 ? 'complete' : 'partial';

    const available = submitButton.dataset.available !== 'false';
    const ready = remaining === 0 && available;
    submitButton.disabled = !ready;
    if (sheetSubmitButton) sheetSubmitButton.disabled = !ready;

    this.#renderSheet(ready);
  }

  #subtotalCents() {
    return this.#selection.reduce((sum, checkbox) => sum + (Number(checkbox.dataset.price) || 0), 0);
  }

  /** @param {boolean} ready */
  #renderSheet(ready) {
    const {
      sheet,
      sheetCount,
      sheetItems,
      sheetEmpty,
      sheetBill,
      sheetBillCount,
      sheetBillUnit,
      sheetSubtotal,
      sheetDiscountRow,
      sheetDiscount,
      sheetTotal,
      sheetSaved,
      trayPriceCompare,
      sheetPriceCompare,
    } = this.refs;
    if (!sheet) return;

    const subtotal = this.#subtotalCents();
    const discount = subtotal - this.#bundlePriceCents;

    // Strikethrough on the tray + sheet footer: what the items would cost
    // apart. Gated on `ready` for the same reason as the bill summary below —
    // until the box is full the bundle price isn't unlocked, so striking
    // through a lower subtotal would imply a discount the customer can't
    // have yet.
    for (const compareEl of [trayPriceCompare, sheetPriceCompare]) {
      if (!compareEl) continue;
      compareEl.textContent = this.#money(subtotal);
      compareEl.hidden = !ready || discount <= 0;
    }

    if (sheetCount) sheetCount.textContent = String(this.#selection.length);
    if (sheetBillCount) sheetBillCount.textContent = String(this.#selection.length);
    if (sheetBillUnit) sheetBillUnit.textContent = this.#selection.length === 1 ? 'item' : 'items';

    if (sheetItems) {
      sheetItems.replaceChildren();
      for (const checkbox of this.#selection) {
        sheetItems.appendChild(this.#buildSheetItem(checkbox, sheet));
      }
      for (let i = this.#selection.length; i < this.#requiredTotal; i++) {
        sheetItems.appendChild(this.#buildSheetPlaceholder(sheet));
      }
    }

    const hasItems = this.#selection.length > 0;
    if (sheetEmpty) sheetEmpty.hidden = hasItems;
    if (sheetBill) sheetBill.hidden = !hasItems;

    if (sheetSubtotal) sheetSubtotal.textContent = this.#money(subtotal);

    // Only claim a discount once the box is full — a partial box isn't yet
    // eligible for the bundle price, so showing a saving would be a lie.
    const showDiscount = ready && discount > 0;
    if (sheetDiscountRow) sheetDiscountRow.hidden = !showDiscount;
    if (sheetDiscount) sheetDiscount.textContent = `-${this.#money(discount)}`;

    if (sheetSaved) {
      sheetSaved.hidden = !showDiscount;
      sheetSaved.textContent = (sheet.dataset.savedLabel || 'You saved [amount]').replace(
        '[amount]',
        this.#money(discount)
      );
    }

    if (sheetTotal) sheetTotal.textContent = this.#money(hasItems ? (ready ? this.#bundlePriceCents : subtotal) : 0);
  }

  /**
   * @param {HTMLInputElement} checkbox
   * @param {HTMLElement} sheet
   */
  #buildSheetItem(checkbox, sheet) {
    const li = document.createElement('li');
    li.className = 'bundle-grid__sheet-item';

    const img = document.createElement('img');
    img.className = 'bundle-grid__sheet-item-thumb';
    img.src = checkbox.dataset.thumb || '';
    img.alt = '';
    img.loading = 'lazy';

    const info = document.createElement('div');
    info.className = 'bundle-grid__sheet-item-info';

    const title = document.createElement('p');
    title.className = 'bundle-grid__sheet-item-title';
    title.textContent = checkbox.dataset.productTitle || checkbox.dataset.title || '';

    const variant = document.createElement('p');
    variant.className = 'bundle-grid__sheet-item-variant';
    variant.textContent = checkbox.dataset.variant || '';

    info.append(title, variant);

    // Price above, Remove beneath it — both right-aligned.
    const side = document.createElement('div');
    side.className = 'bundle-grid__sheet-item-side';

    const price = document.createElement('span');
    price.className = 'bundle-grid__sheet-item-price';
    price.textContent = this.#money(Number(checkbox.dataset.price));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'bundle-grid__sheet-item-remove';
    remove.textContent = sheet.dataset.removeLabel || 'Remove';
    remove.addEventListener('click', () => {
      checkbox.checked = false;
      this.#selection = this.#selection.filter((cb) => cb !== checkbox);
      this.#lockUnselected();
      this.#renderTray();
    });

    side.append(price, remove);
    li.append(img, info, side);
    return li;
  }

  /** @param {HTMLElement} sheet */
  #buildSheetPlaceholder(sheet) {
    const li = document.createElement('li');
    li.className = 'bundle-grid__sheet-item bundle-grid__sheet-item--empty';

    const box = document.createElement('span');
    box.className = 'bundle-grid__sheet-item-placeholder';
    box.textContent = '+';

    const label = document.createElement('span');
    label.className = 'bundle-grid__sheet-item-placeholder-label';
    label.textContent = sheet.dataset.placeholderLabel || 'Product';

    li.append(box, label);
    return li;
  }

  /**
   * The panel lives inside the tray, so opening it is just a matter of
   * hiding the tray's summary row and revealing the panel — the floating
   * card grows upward on its own because it is anchored to its bottom edge.
   */
  openSheet() {
    const { sheet, tray, sheetBackdrop } = this.refs;
    if (!sheet || tray.classList.contains('bundle-grid__tray--expanded')) return;

    sheet.hidden = false;
    tray.classList.add('bundle-grid__tray--expanded');
    if (sheetBackdrop) {
      sheetBackdrop.hidden = false;
      requestAnimationFrame(() => sheetBackdrop.classList.add('bundle-grid__sheet-backdrop--open'));
    }
    document.body.classList.add('overflow-hidden');
    this.querySelector('.bundle-grid__tray-expand')?.setAttribute('aria-expanded', 'true');
    this.querySelector('.bundle-grid__sheet-close')?.focus();
  }

  closeSheet() {
    const { sheet, tray, sheetBackdrop } = this.refs;
    if (!sheet || !tray.classList.contains('bundle-grid__tray--expanded')) return;

    tray.classList.remove('bundle-grid__tray--expanded');
    sheet.hidden = true;
    this.querySelector('.bundle-grid__tray-expand')?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('overflow-hidden');
    this.querySelector('.bundle-grid__tray-expand')?.focus();

    if (!sheetBackdrop) return;
    sheetBackdrop.classList.remove('bundle-grid__sheet-backdrop--open');
    sheetBackdrop.addEventListener(
      'transitionend',
      () => {
        if (!sheetBackdrop.classList.contains('bundle-grid__sheet-backdrop--open')) sheetBackdrop.hidden = true;
      },
      { once: true }
    );
  }

  /** @param {KeyboardEvent} event */
  #handleKeydown = (event) => {
    if (event.key === 'Escape' && this.refs.sheet && !this.refs.sheet.hidden) this.closeSheet();
  };

  /**
   * Opens the info popup for the clicked item (image slider, price,
   * description). Purely informational — selection only happens via the
   * checkbox pill on the card.
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
   * Works the same whether the slider is the one rendered in the grid or
   * the clone inside the popup.
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

  /**
   * Builds the bundle's line-item properties and adds it to cart, then
   * routes the result through the theme's normal cart-update pipeline so
   * the cart drawer/icon/line items refresh exactly like any other
   * add-to-cart.
   * @param {Event} event
   */
  async handleSubmit(event) {
    event.preventDefault();

    const { submitButton } = this.refs;
    if (submitButton.disabled || submitButton.classList.contains('bundle-grid__tray-atc--loading')) return;

    const checkedInputs = this.#selection.slice();
    if (checkedInputs.length === 0) return;

    submitButton.classList.add('bundle-grid__tray-atc--loading');
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
          source: 'bundle-grid-component',
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
      submitButton.classList.remove('bundle-grid__tray-atc--loading');
      this.#renderTray();
    }
  }

  /**
   * Replicates the exact `_ITEM{n}` / `_bundle_product{n}` property contract
   * shared with the step-wise bundle, so any downstream
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
    for (const card of Array.from(this.querySelectorAll('.bundle-grid__card--selected'))) {
      card.classList.remove('bundle-grid__card--selected');
    }
    this.#selection = [];
    this.#activeCat = 'all';
    this.#setActivePill('all');
    this.#applyFilters();
    this.closeSheet();
    this.#renderTray();
  }
}

if (!customElements.get('bundle-grid-component')) {
  customElements.define('bundle-grid-component', BundleGridComponent);
}
