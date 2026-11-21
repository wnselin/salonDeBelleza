/* Шаблон сайта салона: прайс, поиск, запись, меню. */
(() => {
  'use strict';

  const DATA = window.SALON_DATA;
  const CATEGORIES = DATA.categories;
  const PREVIEW = 8;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const el = {
    chips: $('#chips'),
    search: $('#search'),
    searchClear: $('#searchClear'),
    results: $('#serviceResults'),
    form: $('#bookingForm'),
    success: $('#formSuccess'),
    successText: $('#formSuccessText'),
    reset: $('#formReset'),
    select: $('#serviceSelect'),
    feedback: $('#formFeedback'),
    submit: $('#formSubmit'),
    header: $('#header'),
    burger: $('#burger'),
    nav: $('#nav')
  };

  const state = {
    category: 'all',
    query: '',
    expanded: new Set()
  };

  // Ссылка вида ?cat=cosmetology сразу открывает нужное направление.
  const requestedCategory = new URLSearchParams(window.location.search).get('cat');
  if (requestedCategory && CATEGORIES.some((cat) => cat.id === requestedCategory)) {
    state.category = requestedCategory;
  }

  /* ---------- Утилиты ---------- */

  const formatPrice = (value) => `${value.toLocaleString('ru-RU')} ₽`;

  const normalize = (text) =>
    text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

  const plural = (n, one, few, many) => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  };

  const totalItems = CATEGORIES.reduce((sum, cat) => sum + cat.items.length, 0);

  const minPrice = (cat) => Math.min(...cat.items.map((item) => item.price));

  function medicalBadge(extraClass = '') {
    const badge = document.createElement('span');
    badge.className = `medical-badge ${extraClass}`.trim();
    badge.textContent = 'Запись только по телефону или на месте';
    return badge;
  }

  /* ---------- Чипы направлений ---------- */

  function renderChips() {
    const chips = [
      { id: 'all', name: 'Все направления' },
      ...CATEGORIES.map((cat) => ({ id: cat.id, name: cat.name }))
    ];

    el.chips.innerHTML = '';
    chips.forEach((chip) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.dataset.id = chip.id;
      button.textContent = chip.name;
      button.setAttribute('aria-pressed', String(state.category === chip.id));
      el.chips.append(button);
    });
  }

  /* ---------- Плитки «все направления» ---------- */

  function renderTiles() {
    const grid = document.createElement('div');
    grid.className = 'tiles';

    CATEGORIES.forEach((cat) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.dataset.open = cat.id;
      tile.innerHTML = `
        <span class="tile__name"></span>
        <span class="tile__short"></span>
        <span class="tile__foot">
          <span class="tile__count"></span>
          <span class="tile__price"></span>
        </span>`;
      $('.tile__name', tile).textContent = cat.name;
      $('.tile__short', tile).textContent = cat.short;
      $('.tile__count', tile).textContent =
        `${cat.items.length} ${plural(cat.items.length, 'услуга', 'услуги', 'услуг')}`;
      $('.tile__price', tile).textContent = `от ${formatPrice(minPrice(cat))}`;
      if (cat.medical) tile.append(medicalBadge('medical-badge--tile'));
      grid.append(tile);
    });

    el.results.innerHTML = '';
    el.results.append(grid);
  }

  /* ---------- Список цен ---------- */

  function buildRows(items, limit) {
    const list = document.createElement('ul');
    list.className = 'price-list';

    const visible = limit ? items.slice(0, limit) : items;

    visible.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'price-row';

      const line = document.createElement('div');
      line.className = 'price-row__line';

      const name = document.createElement('span');
      name.className = 'price-row__name';
      name.textContent = item.name;

      const dots = document.createElement('span');
      dots.className = 'price-row__dots';
      dots.setAttribute('aria-hidden', 'true');

      const price = document.createElement('span');
      price.className = 'price-row__price';
      price.textContent = formatPrice(item.price);

      line.append(name, dots, price);
      li.append(line);

      if (item.note) {
        const note = document.createElement('p');
        note.className = 'price-row__note';
        note.textContent = item.note;
        li.append(note);
      }

      list.append(li);
    });

    return list;
  }

  function buildCategory(cat, items = cat.items) {
    const section = document.createElement('section');
    section.className = 'cat';
    section.dataset.cat = cat.id;

    const head = document.createElement('div');
    head.className = 'cat__head';

    const title = document.createElement('h3');
    title.className = 'cat__title';
    title.textContent = cat.name;

    const count = document.createElement('span');
    count.className = 'cat__count';
    count.textContent =
      `${items.length} ${plural(items.length, 'услуга', 'услуги', 'услуг')}`;

    head.append(title, count);

    if (cat.short) {
      const short = document.createElement('span');
      short.className = 'cat__short';
      short.textContent = cat.short;
      head.append(short);
    }

    section.append(head);

    if (cat.medical) {
      section.append(medicalBadge('medical-badge--block'));
    }

    if (cat.note) {
      const note = document.createElement('p');
      note.className = 'cat__note';
      note.textContent = cat.note;
      section.append(note);
    }

    const expanded = state.expanded.has(cat.id);
    const limit = items.length > PREVIEW && !expanded ? PREVIEW : 0;
    section.append(buildRows(items, limit));

    if (items.length > PREVIEW) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'more';
      more.dataset.expand = cat.id;
      more.setAttribute('aria-expanded', String(expanded));
      more.textContent = expanded
        ? 'Свернуть'
        : `Показать все ${items.length}`;
      section.append(more);
    }

    return section;
  }

  function renderCategory() {
    const cat = CATEGORIES.find((item) => item.id === state.category);
    if (!cat) {
      renderTiles();
      return;
    }

    el.results.innerHTML = '';
    el.results.append(buildCategory(cat));
  }

  /* ---------- Поиск ---------- */

  function renderSearch() {
    const query = normalize(state.query);
    const matches = [];

    CATEGORIES.forEach((cat) => {
      const items = cat.items.filter((item) => {
        const haystack = normalize(`${item.name} ${item.note || ''}`);
        return haystack.includes(query);
      });
      if (items.length) matches.push({ cat, items });
    });

    const count = matches.reduce((sum, group) => sum + group.items.length, 0);

    el.results.innerHTML = '';

    if (!count) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML =
        '<strong>Ничего не нашлось</strong>Попробуйте другое слово — например, «маникюр», «ботокс» или «стрижка».';
      el.results.append(empty);
      return;
    }

    const head = document.createElement('p');
    head.className = 'results-head';
    head.innerHTML = '';
    head.append('Найдено ');
    const strong = document.createElement('b');
    strong.textContent = `${count} ${plural(count, 'услуга', 'услуги', 'услуг')}`;
    head.append(strong, ` по запросу «${state.query.trim()}»`);
    el.results.append(head);

    matches.forEach(({ cat, items }) => {
      el.results.append(buildCategory(cat, items));
    });
  }

  /* ---------- Общий рендер ---------- */

  function render() {
    const hasQuery = normalize(state.query).length >= 2;

    if (hasQuery) {
      renderSearch();
    } else if (state.category === 'all') {
      renderTiles();
    } else {
      renderCategory();
    }

    $$('.chip', el.chips).forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.dataset.id === state.category));
    });
  }

  function setCategory(id, { scroll = false } = {}) {
    state.category = id;
    state.query = '';
    el.search.value = '';
    el.searchClear.hidden = true;
    render();
    if (scroll) {
      el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ---------- События прайса ---------- */

  el.chips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    setCategory(chip.dataset.id);
  });

  el.results.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-open]');
    if (tile) {
      setCategory(tile.dataset.open, { scroll: true });
      return;
    }

    const more = event.target.closest('[data-expand]');
    if (more) {
      const id = more.dataset.expand;
      if (state.expanded.has(id)) {
        state.expanded.delete(id);
      } else {
        state.expanded.add(id);
      }
      render();
      const section = el.results.querySelector(`[data-cat="${id}"]`);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  let searchTimer;
  el.search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.query = el.search.value;
      el.searchClear.hidden = !state.query;
      render();
    }, 120);
  });

  el.searchClear.addEventListener('click', () => {
    state.query = '';
    el.search.value = '';
    el.searchClear.hidden = true;
    render();
    el.search.focus();
  });

  /* ---------- Меню ---------- */

  function closeNav() {
    el.nav.classList.remove('is-open');
    el.burger.setAttribute('aria-expanded', 'false');
    el.burger.setAttribute('aria-label', 'Открыть меню');
  }

  el.burger.addEventListener('click', () => {
    const open = el.nav.classList.toggle('is-open');
    el.burger.setAttribute('aria-expanded', String(open));
    el.burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  });

  el.nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeNav();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNav();
  });

  document.addEventListener('click', (event) => {
    if (!el.nav.classList.contains('is-open')) return;
    if (event.target.closest('#nav') || event.target.closest('#burger')) return;
    closeNav();
  });

  /* ---------- Шапка при скролле ---------- */

  const onScroll = () => {
    el.header.classList.toggle('is-scrolled', window.scrollY > 8);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Форма записи ---------- */

  const setError = (name, message) => {
    const field = el.form.elements[name];
    const box = $(`[data-error-for="${name}"]`, el.form);
    const wrapper = field ? field.closest('.field, .checkbox') : null;
    if (box) box.textContent = message || '';
    if (wrapper) wrapper.classList.toggle('is-invalid', Boolean(message));
  };

  const formatPhone = (value) => {
    let digits = value.replace(/\D/g, '');
    if (!digits) return '';
    if (digits[0] === '8') digits = `7${digits.slice(1)}`;
    if (digits[0] !== '7') digits = `7${digits}`;
    digits = digits.slice(0, 11);

    const rest = digits.slice(1);
    let out = '+7';
    if (rest.length) out += ` (${rest.slice(0, 3)}`;
    if (rest.length >= 3) out += `) ${rest.slice(3, 6)}`;
    if (rest.length >= 6) out += `-${rest.slice(6, 8)}`;
    if (rest.length >= 8) out += `-${rest.slice(8, 10)}`;
    return out;
  };

  const phoneInput = el.form.elements.phone;
  phoneInput.addEventListener('input', () => {
    phoneInput.value = formatPhone(phoneInput.value);
    if (phoneInput.value.replace(/\D/g, '').length >= 11) setError('phone', '');
  });

  el.form.elements.name.addEventListener('input', () => {
    if (el.form.elements.name.value.trim().length >= 2) setError('name', '');
  });

  const salonDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const salonToday = (() => {
    const parts = salonDateFormatter.formatToParts(new Date());
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  })();
  const [salonYear, salonMonth, salonDay] = salonToday.split('-').map(Number);
  const salonMax = new Date(Date.UTC(salonYear, salonMonth - 1, salonDay + 365))
    .toISOString()
    .slice(0, 10);
  el.form.elements.date.min = salonToday;
  el.form.elements.date.max = salonMax;

  const setFeedback = (message = '') => {
    if (!el.feedback) return;
    el.feedback.textContent = message;
    el.feedback.hidden = !message;
  };

  const formFieldName = (serverName) => {
    if (serverName === 'preferredDate') return 'date';
    if (serverName === 'serviceCategory') return 'service';
    if (serverName === 'website') return '';
    return serverName;
  };

  el.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFeedback();

    const name = el.form.elements.name.value.trim();
    const phoneDigits = phoneInput.value.replace(/\D/g, '');
    const serviceSelect = el.form.elements.service;
    const selected = serviceSelect.selectedIndex >= 0 ? serviceSelect.options[serviceSelect.selectedIndex] : null;
    const service = selected && selected.value ? selected.value : null;
    const date = el.form.elements.date.value.trim();
    const comment = el.form.elements.comment.value.trim();
    const consent = el.form.elements.consent.checked;
    let valid = true;

    ['name', 'phone', 'date', 'consent', 'service'].forEach((name) => setError(name, ''));

    if (name.length < 2) {
      setError('name', 'Укажите имя — хотя бы 2 символа');
      valid = false;
    }

    if (phoneDigits.length !== 11) {
      setError('phone', 'Введите номер полностью');
      valid = false;
    }

    if (date && date < salonToday) {
      setError('date', 'Дата уже прошла');
      valid = false;
    } else if (date && date > salonMax) {
      setError('date', 'Дата слишком далеко — выберите день в пределах года');
      valid = false;
    }

    if (!consent) {
      setError('consent', 'Без согласия на обработку данных отправить заявку нельзя');
      valid = false;
    }

    if (!valid) {
      const firstInvalid = $('.field.is-invalid .field__input, .checkbox.is-invalid .checkbox__input', el.form);
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const payload = {
      name,
      phone: phoneInput.value,
      serviceCategory: selected && selected.dataset.category ? selected.dataset.category : null,
      service,
      preferredDate: date || null,
      comment: comment || null,
      consent,
      website: el.form.elements.website.value
    };

    el.submit.disabled = true;
    el.submit.textContent = 'Отправляем…';
    el.form.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (data && data.fields) {
          Object.entries(data.fields).forEach(([key, message]) => {
            const field = formFieldName(key);
            if (field) setError(field, String(message));
          });
        }
        setFeedback(
          (data && data.error && data.error.message) ||
            'Не удалось отправить заявку. Попробуйте ещё раз или позвоните нам.'
        );
        return;
      }

      const parts = [`Спасибо, ${name}!`];
      if (service) {
        parts.push(`Заявка на «${service}» принята.`);
      } else {
        parts.push('Заявка принята.');
      }
      parts.push(`Администратор позвонит на ${phoneInput.value} в рабочее время — ежедневно с 9:00 до 20:00.`);

      el.successText.textContent = parts.join(' ');
      el.form.hidden = true;
      el.success.hidden = false;
      el.success.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      setFeedback('Нет связи с сервером. Проверьте интернет или попробуйте позже.');
    } finally {
      el.submit.disabled = false;
      el.submit.textContent = 'Отправить заявку';
      el.form.removeAttribute('aria-busy');
    }
  });

  el.form.elements.consent.addEventListener('change', () => {
    if (el.form.elements.consent.checked) setError('consent', '');
  });

  el.reset.addEventListener('click', () => {
    el.form.reset();
    ['name', 'phone', 'date', 'consent', 'service'].forEach((name) => setError(name, ''));
    setFeedback();
    el.success.hidden = true;
    el.form.hidden = false;
    el.form.elements.name.focus();
  });

  /* ---------- Наполнение селекта услуг ---------- */

  CATEGORIES.forEach((cat) => {
    // Медицинские услуги нельзя записать онлайн — только по телефону или на месте.
    if (cat.medical) return;

    const group = document.createElement('optgroup');
    group.label = cat.name;
    cat.items.forEach((item) => {
      const option = document.createElement('option');
      option.value = `${cat.name} — ${item.name}`;
      option.dataset.category = cat.id;
      option.textContent = `${item.name} · ${formatPrice(item.price)}`;
      group.append(option);
    });
    el.select.append(group);
  });

  /* ---------- Появление секций ---------- */

  const revealItems = $$('.reveal');

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-in'));
  }

  /* ---------- Год в подвале ---------- */

  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());

  const statCategories = $('#statCategories');
  const statServices = $('#statServices');
  if (statCategories) statCategories.textContent = String(CATEGORIES.length);
  if (statServices) statServices.textContent = String(totalItems);

  /* ---------- Старт ---------- */

  renderChips();
  render();

  // На случай, если данные и вёрстка разойдутся.
  if (totalItems !== 146) {
    console.info(`В прайсе ${totalItems} услуг (в тексте указано 146).`);
  }
})();
