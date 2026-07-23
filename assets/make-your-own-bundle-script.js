/*Flexi Box Bundle Script Code*/


document.addEventListener('DOMContentLoaded', function () {
  
  const openCartDrawerAfterReload = localStorage.getItem('openCartDrawerAfterReload'); 
  if(openCartDrawerAfterReload && openCartDrawerAfterReload === "true"){
    document.querySelector(".header-actions__cart-icon")?.click();
  }
  localStorage.setItem('openCartDrawerAfterReload', 'false');

  // Enable checkboxes after page load
  document.querySelectorAll("input[type='checkbox']").forEach(function(checkbox) {
    checkbox.disabled = false;
  });

  // Scroll to top on page load
  window.addEventListener("beforeunload", function () {
    window.scrollTo(0, 0);
  });

  // Show/Hide header tabs
  document.querySelectorAll('.tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      // Remove 'active-tab-content' from all tab contents
      document.querySelectorAll('.tab-content').forEach(function(content) {
        content.classList.remove('active-tab-content');
      });
      // Add 'active-tab-content' to the tab content with matching data-id
      var dataId = tab.getAttribute('data-id');
      var targetContent = document.querySelector(".tab-content[data-id='" + dataId + "']");
      if (targetContent) {
        targetContent.classList.add('active-tab-content');
      }
      // Remove 'active-tab' from all tabs
      document.querySelectorAll('.tab').forEach(function(t) {
        t.classList.remove('active-tab');
      });
      // Add 'active-tab' to all tabs within the same parent as the clicked tab
      tab.parentElement.querySelectorAll('.tab').forEach(function(t) {
        t.classList.add('active-tab');
      });
      // Update all bubble counters when switching tabs
      updateAllBubbleCounters();
      // Clear the search bar and trigger keyup event
      var searchbar = document.getElementById('searchbar');
      if (searchbar) {
        searchbar.value = '';
        var event = new KeyboardEvent('keyup', { bubbles: true });
        searchbar.dispatchEvent(event);
      }
      // Scroll to top smoothly
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Sticky header on-scroll
  let lastScrollTop = 0;
  window.addEventListener('scroll', function () {
    var height = window.innerHeight;
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  
    document.querySelectorAll('.sticky-header').forEach(function(header) {
      if (scrollTop > height) {
        header.classList.add('show');
      } else {
        header.classList.remove('show');
      }
      if (scrollTop > lastScrollTop) {
        header.classList.add('hide'); // Scrolling down
      } else {
        header.classList.remove('hide'); // Scrolling up
      }
    });
    lastScrollTop = scrollTop;
  });

  // Bubble counter update function to updates all bubble counters based on current state
  function updateAllBubbleCounters() {
    document.querySelectorAll('.bubble-counter').forEach(counter => {
      const tabId = counter.id.match(/checkbox_count_tab_(\d+)/)[1];
      const checkedCount = document.querySelectorAll(`[data-id="tab${tabId}"] input:checked`).length;
      const selectionLimit = document.querySelector(`.tab-content[data-id="tab${tabId}"]`)?.getAttribute('data-product-limit');
      const isLimitReached = (checkedCount === parseInt(selectionLimit));
      const parentTab = counter.closest('.tab');
      const isActive = parentTab?.classList.contains('active-tab');
      
      // Reset classes
      counter.classList.remove('limit-reached', 'active-limit-reached');   
      if (isLimitReached) {
        counter.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="check-icon" width="11" height="9" viewBox="0 0 11 9" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.66802 1.37429L4.48642 7.85309L0.416016 4.46069L1.18402 3.53909L4.31362 6.14669L8.73201 0.625488L9.66802 1.37429Z" fill="#fff" stroke="#fff" stroke-width="0.5"/></svg>`;     
        if (isActive) {
          counter.classList.add('active-limit-reached');
        } else {
          counter.classList.add('limit-reached');
        }
      } else if (checkedCount > 0) {
        counter.textContent = checkedCount;
      } else {
        counter.textContent = '';
      }
    });
  }

  // Replace existing submit listener with this robust handler
  (function attachBundleSubmit() {
    const submitBtn = document.getElementById("submit-btn");
    if (!submitBtn) return;

    // avoid attaching twice
    if (submitBtn.dataset.bundleListenerAttached === "1") return;
    submitBtn.dataset.bundleListenerAttached = "1";

    submitBtn.addEventListener("click", async function (e) {
      e.preventDefault();
      const btn = e.currentTarget;

      // reentrancy guard
      if (btn.dataset.running === "1") return;
      btn.dataset.running = "1";
      btn.disabled = true;
      btn.classList.add("loading");

      try {
        const form = document.getElementById("flexi-box-form");
        if (!form) throw new Error("flexi-box-form not found");

        // Re-enable all checkboxes BEFORE reading selections
        form.querySelectorAll("input[type='checkbox']").forEach(cb => cb.disabled = false);

        // Take a stable snapshot of checked boxes
        const checkedInputs = Array.from(form.querySelectorAll('input[type="checkbox"]:checked'));
        console.log("[bundle] checkedInputs snapshot:", checkedInputs.map(i => ({
          id: i.id,
          value: i.value,
          sku: i.dataset.sku,
          price: i.dataset.price,
          disabled: i.disabled,
          checked: i.checked
        })));

        if (checkedInputs.length === 0) {
          console.warn("[bundle] No items selected. Aborting add-to-cart.");
          btn.classList.remove("loading");
          btn.disabled = false;
          btn.dataset.running = "0";
          return;
        }

        const variantId = parseInt(form.dataset.variantId, 10);
        const parentSku = String(form.dataset.sku || "");
        // IMPORTANT: dataset.price appears to be in cents in your code. Treat it as cents.
        const parentPriceCents = Math.round(Number(form.dataset.price) || 0); // e.g. 58899 cents = 588.99
        if (!parentPriceCents) {
          console.warn("[bundle] parent price missing or zero (dataset.price):", form.dataset.price);
        }

        // Build properties
        const itemProperties = {};
        const bundleProperties = {};
        let itemCounter = 1;
        let bundleCounter = 1;

        // parent bundle product entry
        bundleProperties[`_bundle_product${bundleCounter}`] = `${parentSku}/0/1`;
        bundleCounter++;

        // Compute total_regular_price in cents (defensive)
        const totalRegularCents = checkedInputs.reduce((sum, input) => {
          const p = Math.round(Number(input.dataset.price) || 0);
          return sum + p;
        }, 0);

        console.log("[bundle] totalRegularCents:", totalRegularCents, "parentPriceCents:", parentPriceCents);

        // If totalRegularCents === 0, fallback to equal split
        let priceAssignedCents = 0;
        checkedInputs.forEach((input, idx) => {
          if (String(input.value).trim() === "No") {
            // keep behaviour of disabling 'No' selections
            input.disabled = true;
            return;
          }

          // item property
          itemProperties[`_ITEM${itemCounter}`] = input.value;

          // Determine assigned price in cents
          let shareCents;
          const inputPriceCents = Math.round(Number(input.dataset.price) || 0);

          if (totalRegularCents > 0 && parentPriceCents > 0) {
            // proportional allocation by cents; round normally
            shareCents = Math.round((inputPriceCents / totalRegularCents) * parentPriceCents);
          } else if (parentPriceCents > 0) {
            // fallback: equal split across checkedInputs (only the non-'No' ones)
            const validCount = checkedInputs.filter(i => String(i.value).trim() !== "No").length || 1;
            shareCents = Math.round(parentPriceCents / validCount);
          } else {
            shareCents = 0;
          }

          // If last real item, give remainder to avoid rounding gap
          const isLastReal = (() => {
            // find index of last non-'No' checked input
            const lastIdx = checkedInputs.map(i => String(i.value).trim() !== "No").lastIndexOf(true);
            return idx === lastIdx;
          })();

          if (isLastReal) {
            const remainder = parentPriceCents - priceAssignedCents;
            // assign remainder (can be zero or negative if something odd)
            shareCents = remainder;
          }

          priceAssignedCents += shareCents;

          // push bundle entry as decimal (divide by 100)
          const priceDecimal = (shareCents / 100).toFixed(2);
          const sku = input.dataset.sku || "";
          bundleProperties[`_bundle_product${bundleCounter}`] = `${sku}/${priceDecimal}/1`;

          itemCounter++;
          bundleCounter++;
        });

        const properties = {
          ...itemProperties,
          ...bundleProperties
        };

        console.log("[bundle] properties being sent:", properties);

        // final payload
        const payload = {
          items: [{
            id: variantId,
            quantity: 1,
            properties: properties
          }]
        };

        // send request
        const res = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        console.log("[bundle] add response:", data);

        // success UI reset (same as you had)
        form.reset();
        form.querySelectorAll("input[type='checkbox']").forEach(cb => cb.disabled = false);
        document.querySelector(".tab[data-id='tab1']")?.click();

        const submitBtn = document.getElementById("submit-btn");
        if (submitBtn) {
          submitBtn.style.pointerEvents = "none";
          submitBtn.style.backgroundColor = "#ddd"; // or use a CSS class instead
        }

        if (typeof updateAllBubbleCounters === 'function') updateAllBubbleCounters();

        if (data && data.sections) {
           if (document.getElementById('cart-drawer')) document.getElementById('cart-drawer').innerHTML = data.sections['cart-drawer'];
        }

        //Update cart drawer counter
        fetch('/cart.js')
        .then(res => res.json())
        .then(cart => {
          document.querySelector('#cart-counter').textContent = cart.item_count;
        });

        //Reload and open cart?
        localStorage.setItem('openCartDrawerAfterReload', 'true');
        location.reload();
        
      } catch (err) {
        console.error("[bundle] submit error:", err);
      } finally {
        btn.classList.remove("loading");
        btn.disabled = false;
        btn.dataset.running = "0";
        (async () => {
          try {
            // const response = await fetch('/?sections=cart-drawer');
            // const data = await response.json();

            // if (data['cart-drawer']) {
            //   document.getElementById('cart-drawer').innerHTML = data['cart-drawer'];
            // }

            
          } catch (err) {
            // console.error("Cart refresh failed:", err);
            // fallback: still open cart
          }
        })();
      }
    });
  })();


  // Get the total number of tabs
  const totalTabs = document.querySelectorAll(".tab").length;
  // Get all checkbox inputs
  let checkboxes = document.querySelectorAll("input[type='checkbox']");
  
  // Store the initial input values of checkboxes in an object on page load
  const initProdValues = {};
  checkboxes.forEach(function(checkbox) {
    initProdValues[checkbox.id] = checkbox.value.trim();
  });
  // console.log(initProdValues);

  // Checkbox click functionality code
  checkboxes.forEach(function(checkbox) {
    checkbox.addEventListener("click", function () {
      const initProductValue = initProdValues[this.id];
      let currProductValue = this.value.trim();
      // console.log("Initial:", initProductValue, "Current:", currProductValue);
  
      // Initial and Current checkbox values, reload if does not match
      if (currProductValue !== initProductValue) {
        location.reload();
      }
  
      let currProduct = this.getAttribute("data-id");
      let currProductDataId = this.getAttribute("data-id-products");
      let currTabId = Number(currProductDataId.split("_")[1]);
      let selectionLimit = document.querySelector(`.tab-content[data-id="tab${currTabId}"]`).getAttribute("data-product-limit");
  
      // Hide elements
      let productInfo = this.closest(".product-info");
      if (productInfo) {
        productInfo.querySelectorAll(".added_to_cart, .product_counter").forEach(function(el) {
          el.classList.add("_hidden");
        });
      }
      if (this.checked) {
        if (productInfo) {
          productInfo.querySelectorAll(".added_to_cart, .product_counter").forEach(function(el) {
            el.classList.remove("_hidden");
          });
        }
        let productTitle = this.value.split("/")[0];
        document.querySelectorAll(".message-bar").forEach(function(bar) {
          bar.classList.remove("is-hidden");
          let span = bar.querySelector("p span");
          if (span) span.textContent = productTitle;
          setTimeout(function () {
            bar.classList.add("is-hidden");
            if (span) span.textContent = "";
          }, 2500);
        });
      }
      // Count checked checkboxes in current tab
      let n = document.querySelectorAll(`[data-id=tab${currTabId}] input:checked`).length;
      // console.log(currTabId, selectionLimit);
      // console.log(n);
  
      // Enable/disable checkboxes based on selection limit
      let notChecked = document.querySelectorAll(`[data-id=tab${currTabId}] input:not(:checked)`);
      let action = true;
      if (n == selectionLimit) {
        notChecked.forEach(function(input) {
          input.disabled = true;
        });
      } else {
        action = false;
        notChecked.forEach(function(input) {
          input.disabled = false;
        });
      }
      if (n > selectionLimit) {
        location.reload();
      }
      // Update bubble counters when checkbox selection changes
      updateAllBubbleCounters();
  
      // Go to next tab after adding mandatory items
      if (action === true) {
        let nextTab = `tab${currTabId + 1}`;
        let nextTabElem = document.querySelector(`.tab[data-id='${nextTab}']`);
        if (nextTabElem) nextTabElem.click();
  
        // Clear search
        let searchbar = document.getElementById("searchbar");
        if (searchbar) {
          searchbar.value = "";
          let event = new KeyboardEvent('keyup', { bubbles: true });
          searchbar.dispatchEvent(event);
        }
  
        // Scroll up to top on switching tabs
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
  
      // Enabling submit btn if all mandatory products are selected
      let totalChecked = document.querySelectorAll("#flexi-box-form input[type=checkbox]:checked").length;
      let submitBtn = document.getElementById("submit-btn");
      if (submitBtn) {
        if (typeof totalproductSelection !== "undefined" && totalChecked == totalproductSelection) {
          submitBtn.style.display = "inline-block";
          submitBtn.style.backgroundColor = "#0b0b0b";
          submitBtn.style.pointerEvents = "auto";
          submitBtn.disabled = false;
        } else {
          submitBtn.style.display = "inline-block";
          submitBtn.style.backgroundColor = "#ddd";
          submitBtn.disabled = true;
        }
      }
    });
  });

  // Disable right-click context menu
  document.addEventListener("contextmenu", function(e) {
    e.preventDefault();
  });
  // Disable F12 key (Inspect Element)
  document.addEventListener("keydown", function(e) {
    if (e.key === "F12" || e.keyCode === 123) {
      e.preventDefault();
      return false;
    }
  });

  // Custom search bar functionality
  document.getElementById("searchbar").addEventListener("keyup", function () {
    var value = this.value.toLowerCase();
    document.querySelectorAll("#collection-list li").forEach(function (li) {
      var link = li.querySelector(".product_flexi_title");
      li.style.display = (link && link.textContent.toLowerCase().includes(value)) ? "" : "none";
    });
  });
  // Clear search on pressing clear button
  document.querySelectorAll(".search-clear").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      var searchbar = document.getElementById("searchbar");
      searchbar.value = "";
      // Trigger keyup event
      var event = new KeyboardEvent('keyup', { bubbles: true });
      searchbar.dispatchEvent(event);
    });
  });

  // Disable whatsapp button on flexibox product page
  let counter2 = 0;

  function hideWhatsappBtn(){
    let whatsappBtn1 = document.querySelector(".WhatsAppButton__root");
    if(whatsappBtn1 && whatsappBtn1.style.display !== "none" && (window.location.href.includes("products/betteralt-get-3-for-1499") || window.location.href.includes("/products/betteralt-buy-3-for-999"))){
      whatsappBtn1.style.display="none";
    }
    setTimeout(() => {
      if(counter2 <= 7){
        hideWhatsappBtn();
      }
      counter2++;
    }, 2000)
  }

  hideWhatsappBtn();

  const announcementBar = document.querySelector(".announcement");

  if(announcementBar){
    announcementBar.style.display="none";
  }

  const siteHeader1 = document.getElementById("SiteHeader");

  siteHeader1.style.marginTop="0px";

  if(siteHeader1.classList.contains("site-header-margin-top")){
    siteHeader1.classList.remove("site-header-margin-top");
  }

  const collectionListBundle = document.getElementById("collection-list");

  if(collectionListBundle){
    collectionListBundle.style.marginTop="95px";
  }

});
