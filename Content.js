// // // // // // // //
// -> made by github.com/ey34
// -> version      1.0.0
// // // // // // // //


(function () {
  'use strict';

  const RATE_API = 'https://open.er-api.com/v6/latest/CNY';
  const RATE_REFRESH_MS = 10 * 60 * 1000;

  let ratesCache = null;
  let currentCurrency = 'USD';

  function httpGetJson(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        try {
          GM_xmlhttpRequest({
            method: 'GET',
            url,
            onload(res) {
              try {
                resolve(JSON.parse(res.responseText));
              } catch (err) {
                reject(err);
              }
            },
            onerror(err) {
              reject(err);
            },
          });
          return;
        } catch (e) {
          console.warn('[CNY→USD] GM_xmlhttpRequest present but threw, falling back to fetch', e);
        }
      }

      if (typeof fetch === 'function') {
        fetch(url, { cache: 'no-cache' })
          .then((resp) => {
            if (!resp.ok) throw new Error('Network response was not ok: ' + resp.status);
            return resp.json();
          })
          .then((json) => resolve(json))
          .catch((err) => {
            console.warn('[CNY→USD] fetch failed (may be CORS):', err);
            reject(err);
          });
        return;
      }

      reject(new Error('No HTTP method available (GM_xmlhttpRequest or fetch)'));
    });
  }

  function fetchRate() {
    return new Promise((resolve, reject) => {
      httpGetJson(RATE_API)
        .then((data) => {
          if (data && data.rates && typeof data.rates === 'object') {
            ratesCache = data.rates;
            resolve(ratesCache);
          } else {
            reject(new Error('Unexpected rate response'));
          }
        })
        .catch((err) => reject(err));
    });
  }

  function formatCurrency(amount, currency) {
    try {
      return amount.toLocaleString(undefined, { style: 'currency', currency, minimumFractionDigits: 2 });
    } catch (e) {
      const sym = currency === 'USD' ? '$' : (currency === 'EUR' ? '€' : currency + ' ');
      return sym + amount.toFixed(2);
    }
  }

  // ---- Preferences: currency persistence (Tampermonkey GM_* or localStorage fallback)
  async function loadUserPrefs() {
    try {
      if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') {
        const v = await GM.getValue('currency', currentCurrency);
        if (v) currentCurrency = String(v);
        return;
      }
      if (typeof GM_getValue === 'function') {
        const v = GM_getValue('currency', currentCurrency);
        if (v) currentCurrency = String(v);
        return;
      }
    } catch (e) { /* ignore */ }
    try {
      const v = localStorage.getItem('cny_usd_currency');
      if (v) currentCurrency = String(v);
    } catch (e) { /* ignore */ }
  }

  function saveUserCurrencyPref(value) {
    try {
      if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') {
        GM.setValue('currency', value);
        return;
      }
      if (typeof GM_setValue === 'function') {
        GM_setValue('currency', value);
        return;
      }
    } catch (e) { /* ignore */ }
    try {
      localStorage.setItem('cny_usd_currency', String(value));
    } catch (e) { /* ignore */ }
  }

  const priceRegex = /¥\s?([\d,]+(?:\.\d+)?)/g;

  function convertTextNode(textNode) {
    if (!textNode || !textNode.nodeValue) return;
    const parent = textNode.parentNode;
    if (!parent || parent.closest && parent.closest('script, style, noscript')) return;

    const original = textNode.nodeValue;
    let match;
    let lastIndex = 0;
    const frag = document.createDocumentFragment();
    priceRegex.lastIndex = 0;
    let any = false;
    while ((match = priceRegex.exec(original)) !== null) {
      any = true;
      const matchStart = match.index;
      const matchEnd = priceRegex.lastIndex;
      
      if (matchStart > lastIndex) {
        frag.appendChild(document.createTextNode(original.slice(lastIndex, matchStart)));
      }
      
      const origText = original.slice(matchStart, matchEnd);
      const priceSpan = document.createElement('span');
      priceSpan.textContent = origText;

      let consumedDecimal = '';
      if (!/\./.test(match[1])) {
        let next = textNode.nextSibling;
        for (let i = 0; next && i < 5; ++i) {
          const nextText = next.nodeType === Node.TEXT_NODE ? next.nodeValue : (next.textContent || '');
          const m = nextText.match(/^[\s\u00A0]*([.,]\d+)/);
          if (m) {
            consumedDecimal = m[1];
            priceSpan.appendChild(document.createTextNode(consumedDecimal));
            
            try {
              if (next.nodeType === Node.TEXT_NODE) {
                next.nodeValue = next.nodeValue.replace(/^([\s\u00A0]*[.,]\d+)/, '');
                
                if (!next.nodeValue) {
                  const tmp = next.nextSibling;
                  if (next.parentNode) next.parentNode.removeChild(next);
                  next = tmp;
                }
              } else {
                const full = next.textContent || '';
                const remainder = full.replace(/^([\s\u00A0]*[.,]\d+)/, '');
                if (remainder) {
                  const txt = document.createTextNode(remainder);
                  next.parentNode.replaceChild(txt, next);
                  next = txt.nextSibling;
                } else {
                  const tmp = next.nextSibling;
                  if (next.parentNode) next.parentNode.removeChild(next);
                  next = tmp;
                }
              }
            } catch (e) {
              break;
            }
            break;
          }
          break;
        }
      }

      frag.appendChild(priceSpan);

      if (ratesCache && typeof ratesCache[currentCurrency] === 'number') {
        const numericStr = (match[1] + (consumedDecimal || '')).replace(/,/g, '').replace(/^[\s\u00A0]+/, '');
        const norm = numericStr.replace(',', '.');
        const cnyVal = parseFloat(norm);
        if (!Number.isNaN(cnyVal)) {
          const rate = ratesCache[currentCurrency];
          const converted = cnyVal * rate;
          const convSpan = document.createElement('span');
          convSpan.style.color = '#2b7cff';
          convSpan.style.marginLeft = '6px';
          convSpan.style.fontSize = '0.95em';
          convSpan.style.fontWeight = '600';
          convSpan.textContent = `(${formatCurrency(converted, currentCurrency)})`;
          convSpan.setAttribute('data-cny-usd', '1');
          convSpan.setAttribute('data-cny-original', String(cnyVal));
          convSpan.setAttribute('data-cny-currency', currentCurrency);
          frag.appendChild(convSpan);
        }
      }

      lastIndex = matchEnd;
    }

    if (any) {
      if (lastIndex < original.length) {
        frag.appendChild(document.createTextNode(original.slice(lastIndex)));
      }
      
      parent.replaceChild(frag, textNode);

      try { markProcessed(parent); } catch (e) { }
    }
  }

  function walkAndConvert(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    for (const n of nodes) {
      if (n.parentNode && n.parentNode.closest && n.parentNode.closest('[data-cny-processed]')) continue;
      
      if (n.nodeValue && n.nodeValue.indexOf('¥') !== -1) {
        convertTextNode(n);
      }
    }
  }

  function markProcessed(root) {
    if (root && root.nodeType === Node.ELEMENT_NODE) root.setAttribute('data-cny-processed', '1');
  }

  function updateAllConvertedSpans() {
    if (!ratesCache) return;
    const nodes = document.querySelectorAll('[data-cny-usd]');
    for (const n of nodes) {
      try {
        const orig = n.getAttribute('data-cny-original');
        if (!orig) continue;
        const origVal = parseFloat(String(orig));
        if (Number.isNaN(origVal)) continue;
        const rate = ratesCache[currentCurrency];
        if (typeof rate !== 'number') continue;
        const conv = origVal * rate;
        n.textContent = `(${formatCurrency(conv, currentCurrency)})`;
        n.setAttribute('data-cny-currency', currentCurrency);
      } catch (e) { }
    }
  }

  function createExtensionToggleUI() {
    try {
      const host = document.createElement('div');
      host.id = 'cny-usd-extension-host';
      host.style.position = 'fixed';
      host.style.top = '12px';
      host.style.right = '12px';
      host.style.zIndex = '9999999';
      document.body.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        .btn-icon{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;background:#141517;border:1px solid #2a2d34;box-shadow:0 4px 16px rgba(0,0,0,0.35);cursor:pointer;color:#e5e7eb}
        .btn-icon:hover{background:#181a1e}
        .card{min-width:280px;max-width:340px;background:#111215;border:1px solid #2a2a2a;border-radius:14px;box-shadow:0 12px 28px rgba(0,0,0,0.35);font-family:Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;color:#e5e7eb}
        .card-header{display:grid;grid-auto-rows:min-content;grid-template-rows:auto auto;gap:6px;align-items:start;padding:16px;border-bottom:1px solid #2a2a2a;position:relative}
        .card-title{font-weight:600;line-height:1.2;font-size:14px;color:#f3f4f6}
        .card-description{font-size:12px;color:#9ca3af}
        .card-content{padding:16px;display:flex;flex-direction:column;gap:12px}
        .row{display:flex;flex-direction:column;gap:8px}
        .label{font-size:12px;color:#9ca3af}
        .select-root{position:relative;display:inline-block}
        .select-trigger{display:inline-flex;align-items:center;justify-content:space-between;gap:8px;height:44px;min-width:220px;padding:0 14px;border:1px solid #2a2a2a;border-radius:10px;background:#1a1b1e;color:#e5e7eb;font-size:14px;cursor:pointer;outline:none;box-shadow:inset 0 1px 0 rgba(255,255,255,0.02)}
        .select-trigger:hover{background:#202225}
        .select-trigger:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.25)}
        .select-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;opacity:.6}
  .select-content{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%) scale(.95) translateY(-6px);transform-origin:top center;min-width:100%;max-height:260px;overflow-y:auto;overflow-x:hidden;box-sizing:border-box;border:1px solid #2a2a2a;border-radius:10px;background:#1a1b1e;color:#e5e7eb;box-shadow:0 18px 40px rgba(0,0,0,0.45);padding:6px;opacity:0;transition:opacity .14s ease, transform .14s ease;z-index:1000}
        .select-content[data-state="open"]{opacity:1;transform:translateX(-50%) scale(1) translateY(0)}
        .select-label{font-size:12px;color:#9ca3af;padding:6px 8px}
  .select-item{position:relative;display:flex;align-items:center;gap:8px;width:100%;padding:8px 28px 8px 8px;border-radius:8px;font-size:14px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .select-item:hover{background:#2a2d34}
        .select-item[aria-selected="true"]{background:#2b2f36}
        .select-check{position:absolute;right:8px;display:inline-flex;width:14px;height:14px;align-items:center;justify-content:center;color:#9ec1ff}
        .muted{color:#9ca3af}
        .small{font-size:11px}
      `;
      shadow.appendChild(style);

      const container = document.createElement('div');
      container.setAttribute('part', 'container');

      const btn = document.createElement('button');
      btn.className = 'btn-icon';
      btn.title = 'Para birimi kartını aç';
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 1v22" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 7h14M5 17h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      container.appendChild(btn);

      const panel = document.createElement('div');
      panel.style.display = 'none';
      panel.style.marginTop = '8px';
      container.appendChild(panel);

      const card = document.createElement('div');
      card.className = 'card';

      const header = document.createElement('div');
      header.className = 'card-header';
      const title = document.createElement('div');
      title.className = 'card-title';
      title.innerHTML = 'CNY → <span id="cur-view">' + currentCurrency + '</span>';
      const desc = document.createElement('div');
      desc.className = 'card-description';
      desc.textContent = "This will add a conversion next to ¥ prices on the page!";
      header.appendChild(title);
      header.appendChild(desc);
      

      const content = document.createElement('div');
      content.className = 'card-content';

      const row1 = document.createElement('div');
      row1.className = 'row';
      const label1 = document.createElement('label');
      label1.className = 'label';
      label1.textContent = 'Money Currency';
      const selectRoot = document.createElement('div');
      selectRoot.className = 'select-root';

      const selectTrigger = document.createElement('button');
      selectTrigger.type = 'button';
      selectTrigger.className = 'select-trigger';
      const selectLabelSpan = document.createElement('span');
      selectLabelSpan.textContent = currentCurrency;
      const selectIcon = document.createElement('span');
      selectIcon.className = 'select-icon';
      selectIcon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      selectTrigger.appendChild(selectLabelSpan);
      selectTrigger.appendChild(selectIcon);

      const selectContent = document.createElement('div');
      selectContent.className = 'select-content';
      selectContent.setAttribute('data-state', 'closed');

      const selectList = document.createElement('div');
      const currencies = ['USD','EUR','TRY'];
      currencies.forEach((c) => {
        const item = document.createElement('div');
        item.className = 'select-item';
        item.setAttribute('role','option');
        item.setAttribute('data-value', c);
        if (c === currentCurrency) item.setAttribute('aria-selected','true');
        item.textContent = c;
        const check = document.createElement('span');
        check.className = 'select-check';
        check.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        item.appendChild(check);
        item.addEventListener('click', () => {
          currentCurrency = c;
          saveUserCurrencyPref(currentCurrency);
          selectLabelSpan.textContent = c;
          const v = header.querySelector('#cur-view');
          if (v) v.textContent = currentCurrency;
          selectList.querySelectorAll('.select-item[aria-selected="true"]').forEach((n)=>n.removeAttribute('aria-selected'));
          item.setAttribute('aria-selected','true');
          updateAllConvertedSpans();

          closeSelect();
        });
        selectList.appendChild(item);
      });
      selectContent.appendChild(selectList);

      const openSelect = () => {
        selectContent.setAttribute('data-state','open');
      };
      const closeSelect = () => {
        selectContent.setAttribute('data-state','closed');
      };

      selectTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = selectContent.getAttribute('data-state') === 'open';
        if (isOpen) closeSelect(); else openSelect();
      });

      shadow.addEventListener('click', (ev) => {
        const path = ev.composedPath();
        if (!path.includes(selectRoot)) {
          closeSelect();
        }
      });

      selectRoot.appendChild(selectTrigger);
      selectRoot.appendChild(selectContent);

      row1.appendChild(label1);
      row1.appendChild(selectRoot);
      content.appendChild(row1);

      

      card.appendChild(header);
      card.appendChild(content);
      

      panel.appendChild(card);

      shadow.appendChild(container);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      });

      document.addEventListener('click', (ev) => {
        if (!host.contains(ev.target)) panel.style.display = 'none';
      }, true);
    } catch (e) { }
  }

  async function init() {
    try {
      await loadUserPrefs();
      await fetchRate();
    } catch (err) {
      console.warn('[CNY→USD] failed to fetch rate, conversions will run when rate is available', err);
    }

    walkAndConvert(document.body);

    try { createExtensionToggleUI(); } catch (e) { }

    if (ratesCache) updateAllConvertedSpans();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            if (node.nodeValue && node.nodeValue.indexOf('¥') !== -1) convertTextNode(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            try {
              walkAndConvert(node);
            } catch (e) { }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(async () => {
      try {
        await fetchRate();
        updateAllConvertedSpans();
      } catch (e) {
        console.warn('[CNY→USD] periodic rate fetch failed', e);
      }
    }, RATE_REFRESH_MS);
  }

  init();
})();
