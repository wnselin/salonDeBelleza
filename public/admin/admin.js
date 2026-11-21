/* Шаблон сайта салона — админ-панель заявок. */
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  const STATUS_LABELS = {
    new: 'Новая',
    contacted: 'Созвонились',
    confirmed: 'Подтверждена',
    completed: 'Выполнена',
    cancelled: 'Отменена'
  };

  const el = {
    loginView: $('#loginView'),
    appView: $('#appView'),
    loginForm: $('#loginForm'),
    loginError: $('#loginError'),
    loginSubmit: $('#loginSubmit'),
    username: $('#username'),
    logout: $('#logoutButton'),
    live: $('#liveStatus'),
    newCounter: $('#newCounter'),
    search: $('#searchInput'),
    statusFilter: $('#statusFilter'),
    refresh: $('#refreshButton'),
    summary: $('#summary'),
    list: $('#list'),
    empty: $('#emptyState'),
    loadMore: $('#loadMore'),
    toast: $('#toast'),
    template: $('#bookingTemplate')
  };

  const state = {
    user: null,
    csrf: null,
    items: [],
    nextBeforeId: null,
    counts: { total: 0, new: 0 },
    status: '',
    q: '',
    loading: false,
    eventSource: null,
    pollTimer: null,
    toastTimer: null,
    searchTimer: null,
    countsTimer: null,
    sessionTimer: null
  };

  class AuthError extends Error {}

  /* ---------- Утилиты ---------- */

  const plural = (n, one, few, many) => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  };

  const createdFormatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  const formatCreated = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : createdFormatter.format(date);
  };

  const formatPreferredDate = (iso) => {
    if (!iso) return 'Не указана';
    const date = new Date(`${iso}T12:00:00+10:00`);
    return Number.isNaN(date.getTime()) ? iso : dateFormatter.format(date);
  };

  const normalize = (value) => value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

  const toast = (message, kind = 'info') => {
    el.toast.textContent = message;
    el.toast.dataset.kind = kind;
    el.toast.hidden = false;
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      el.toast.hidden = true;
    }, 5000);
  };

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.csrf && method !== 'GET' && method !== 'HEAD') {
      headers['x-csrf-token'] = state.csrf;
    }

    const response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (response.status === 401) {
      showLogin('Сессия истекла. Войдите снова.');
      throw new AuthError('unauthorized');
    }

    return response;
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  /* ---------- Экраны ---------- */

  function setLive(stateName, label) {
    el.live.dataset.state = stateName;
    const text = el.live.querySelector('.live__text');
    if (text) text.textContent = label;
  }

  function showLogin(message = '') {
    stopLive();
    stopSessionKeepalive();
    state.user = null;
    state.csrf = null;
    state.items = [];
    state.nextBeforeId = null;
    el.appView.hidden = true;
    el.loginView.hidden = false;
    el.loginError.textContent = message;
    el.loginError.hidden = !message;
    el.loginForm.elements.username.focus();
  }

  function stopSessionKeepalive() {
    if (state.sessionTimer) {
      window.clearInterval(state.sessionTimer);
      state.sessionTimer = null;
    }
  }

  /**
   * A live SSE connection receives events but does not touch the session.
   * Ping the session endpoint so idle/absolute expiry is enforced while the
   * panel is open.
   */
  function startSessionKeepalive() {
    if (state.sessionTimer) return;
    state.sessionTimer = window.setInterval(async () => {
      if (!state.user) return;
      try {
        const response = await api('/api/admin/session');
        if (!response.ok) return;
        const data = await readJson(response);
        if (data?.csrfToken) state.csrf = data.csrfToken;
      } catch (error) {
        if (error instanceof AuthError) return;
      }
    }, 5 * 60 * 1000);
  }

  function showApp() {
    el.loginView.hidden = true;
    el.appView.hidden = false;
    el.username.textContent = state.user ? state.user.username : '';
  }

  /* ---------- Счётчики ---------- */

  function updateCounts(counts) {
    state.counts = {
      total: Number.isFinite(counts?.total) ? counts.total : 0,
      new: Number.isFinite(counts?.new) ? counts.new : 0
    };

    el.newCounter.textContent = `${state.counts.new} ${plural(
      state.counts.new,
      'новая',
      'новые',
      'новых'
    )}`;

    document.title =
      state.counts.new > 0
        ? `(${state.counts.new}) Заявки — Ваш салон`
        : 'Заявки — Ваш салон';
  }

  async function refreshCounts() {
    if (!state.user) return;
    try {
      const response = await api('/api/admin/bookings?limit=1');
      if (!response.ok) return;
      const data = await readJson(response);
      if (data?.counts) updateCounts(data.counts);
    } catch (error) {
      if (!(error instanceof AuthError)) {
        // Counts are non-critical; keep the previous value.
      }
    }
  }

  function scheduleCountsRefresh() {
    window.clearTimeout(state.countsTimer);
    state.countsTimer = window.setTimeout(refreshCounts, 600);
  }

  /* ---------- Список ---------- */

  function matchesFilters(booking) {
    if (state.status && booking.status !== state.status) return false;

    if (state.q) {
      const haystack = normalize(
        `${booking.name} ${booking.phone} ${booking.service || ''}`
      );
      if (!haystack.includes(normalize(state.q))) return false;
    }

    return true;
  }

  function upsertItem(booking) {
    const index = state.items.findIndex((item) => item.id === booking.id);
    if (index >= 0) {
      if (matchesFilters(booking)) state.items[index] = booking;
      else state.items.splice(index, 1);
      return;
    }
    if (matchesFilters(booking)) state.items.unshift(booking);
  }

  function buildCard(booking) {
    const card = el.template.content.firstElementChild.cloneNode(true);
    card.dataset.id = String(booking.id);
    card.dataset.status = booking.status;

    const name = card.querySelector('.card__name');
    const badge = card.querySelector('.badge');
    const created = card.querySelector('.card__created');
    const phone = card.querySelector('.card__phone');
    const service = card.querySelector('.card__service');
    const preferred = card.querySelector('.card__date');
    const comment = card.querySelector('.card__comment');
    const status = card.querySelector('[data-action="status"]');

    if (name) name.textContent = booking.name;
    if (badge) {
      badge.textContent = STATUS_LABELS[booking.status] || booking.status;
      badge.dataset.status = booking.status;
    }
    if (created) {
      created.textContent = formatCreated(booking.createdAt);
      created.dateTime = booking.createdAt;
    }
    if (phone) {
      phone.textContent = booking.phone;
      phone.href = `tel:${booking.phone.replace(/[^\d+]/g, '')}`;
    }
    if (service) service.textContent = booking.service || 'Не выбрана';
    if (preferred) preferred.textContent = formatPreferredDate(booking.preferredDate);
    if (comment) {
      if (booking.comment) {
        comment.textContent = booking.comment;
        comment.hidden = false;
      } else {
        comment.hidden = true;
      }
    }
    if (status) status.value = booking.status;

    const select = card.querySelector('[data-action="status"]');
    if (select) select.setAttribute('aria-label', `Статус заявки ${booking.name}`);

    return card;
  }

  function render() {
    el.list.replaceChildren();
    const fragment = document.createDocumentFragment();
    state.items.forEach((booking) => fragment.append(buildCard(booking)));
    el.list.append(fragment);

    el.empty.hidden = state.items.length > 0;
    el.loadMore.hidden = !state.nextBeforeId;
    el.summary.textContent = `Всего заявок: ${state.counts.total} · новых: ${state.counts.new}`;
  }

  function removeItem(id) {
    state.items = state.items.filter((item) => item.id !== id);
    render();
  }

  /* ---------- Загрузка ---------- */

  async function load({ reset = true } = {}) {
    if (state.loading || !state.user) return;
    state.loading = true;

    try {
      const params = new URLSearchParams({ limit: '30' });
      if (state.status) params.set('status', state.status);
      if (state.q) params.set('q', state.q);
      if (!reset && state.nextBeforeId) params.set('beforeId', String(state.nextBeforeId));

      const response = await api(`/api/admin/bookings?${params.toString()}`);
      const data = await readJson(response);

      if (!response.ok || !data) {
        toast('Не удалось загрузить заявки', 'error');
        return;
      }

      if (reset) {
        state.items = data.items;
      } else {
        const known = new Set(state.items.map((item) => item.id));
        data.items.forEach((item) => {
          if (!known.has(item.id)) state.items.push(item);
        });
      }

      state.nextBeforeId = data.nextBeforeId;
      updateCounts(data.counts);
      render();
    } catch (error) {
      if (!(error instanceof AuthError)) {
        toast('Нет связи с сервером', 'error');
      }
    } finally {
      state.loading = false;
    }
  }

  /* ---------- Действия с заявкой ---------- */

  async function changeStatus(card, booking, select) {
    const nextStatus = select.value;
    const previous = booking.status;
    if (nextStatus === previous) return;

    select.disabled = true;
    card.classList.add('is-busy');

    try {
      const response = await api(`/api/admin/bookings/${booking.id}`, {
        method: 'PATCH',
        body: { status: nextStatus }
      });
      const data = await readJson(response);

      if (!response.ok || !data?.booking) {
        select.value = previous;
        toast(data?.error?.message || 'Не удалось изменить статус', 'error');
        return;
      }

      const index = state.items.findIndex((item) => item.id === booking.id);
      if (index >= 0) state.items[index] = data.booking;

      if (state.status && data.booking.status !== state.status) {
        removeItem(booking.id);
      } else {
        const updatedCard = buildCard(data.booking);
        card.replaceWith(updatedCard);
      }

      scheduleCountsRefresh();
      toast('Статус обновлён');
    } catch (error) {
      if (!(error instanceof AuthError)) {
        select.value = previous;
        toast('Нет связи с сервером', 'error');
      }
    } finally {
      select.disabled = false;
      card.classList.remove('is-busy');
    }
  }

  async function removeBooking(card, booking) {
    const confirmed = window.confirm(
      `Удалить заявку от ${booking.name}? Действие необратимо.`
    );
    if (!confirmed) return;

    card.classList.add('is-busy');

    try {
      const response = await api(`/api/admin/bookings/${booking.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await readJson(response);
        toast(data?.error?.message || 'Не удалось удалить заявку', 'error');
        return;
      }

      removeItem(booking.id);
      scheduleCountsRefresh();
      toast('Заявка удалена');
    } catch (error) {
      if (!(error instanceof AuthError)) {
        toast('Нет связи с сервером', 'error');
      }
    } finally {
      card.classList.remove('is-busy');
    }
  }

  async function copyPhone(phone) {
    try {
      await navigator.clipboard.writeText(phone);
      toast('Номер скопирован');
    } catch {
      const area = document.createElement('textarea');
      area.value = phone;
      area.setAttribute('readonly', '');
      area.className = 'copy-area';
      document.body.append(area);
      area.select();
      try {
        document.execCommand('copy');
        toast('Номер скопирован');
      } catch {
        toast('Не удалось скопировать', 'error');
      } finally {
        area.remove();
      }
    }
  }

  /* ---------- Real-time ---------- */

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = window.setInterval(() => {
      if (!state.eventSource || state.eventSource.readyState !== EventSource.OPEN) {
        load({ reset: true });
      }
    }, 15_000);
  }

  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function stopLive() {
    stopPolling();
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
  }

  function handleBookingEvent(event) {
    if (!event || !event.type) return;

    if (event.type === 'booking.created' && event.booking) {
      upsertItem(event.booking);
      render();
      scheduleCountsRefresh();
      const service = event.booking.service ? ` — ${event.booking.service}` : '';
      toast(`Новая заявка: ${event.booking.name}${service}`, 'new');
      return;
    }

    if (event.type === 'booking.updated' && event.booking) {
      upsertItem(event.booking);
      render();
      scheduleCountsRefresh();
      return;
    }

    if (event.type === 'booking.deleted' && event.id) {
      removeItem(event.id);
      scheduleCountsRefresh();
    }
  }

  function connectLive() {
    stopLive();

    if (!('EventSource' in window)) {
      setLive('offline', 'Без live-обновлений');
      startPolling();
      return;
    }

    setLive('connecting', 'Подключение…');
    const source = new EventSource('/api/admin/events', { withCredentials: true });
    state.eventSource = source;

    source.addEventListener('ready', () => {
      setLive('live', 'Live');
      stopPolling();
    });

    source.addEventListener('booking', (message) => {
      try {
        handleBookingEvent(JSON.parse(message.data));
      } catch {
        // Ignore malformed events; the next poll will resync.
      }
    });

    source.onopen = () => {
      setLive('live', 'Live');
      stopPolling();
    };

    source.onerror = () => {
      setLive('reconnecting', 'Переподключение…');
      startPolling();
    };
  }

  /* ---------- События интерфейса ---------- */

  el.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const username = el.loginForm.elements.username.value.trim();
    const password = el.loginForm.elements.password.value;
    if (!username || !password) return;

    el.loginSubmit.disabled = true;
    el.loginSubmit.textContent = 'Проверяем…';
    el.loginError.hidden = true;

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await readJson(response);

      if (!response.ok || !data?.csrfToken) {
        el.loginError.textContent =
          data?.error?.message || 'Неверный логин или пароль';
        el.loginError.hidden = false;
        return;
      }

      state.user = data.user;
      state.csrf = data.csrfToken;
      el.loginForm.reset();
      showApp();
      startSessionKeepalive();
      setLive('connecting', 'Подключение…');
      connectLive();
      await load({ reset: true });
    } catch {
      el.loginError.textContent = 'Нет связи с сервером. Попробуйте ещё раз.';
      el.loginError.hidden = false;
    } finally {
      el.loginSubmit.disabled = false;
      el.loginSubmit.textContent = 'Войти';
    }
  });

  el.logout.addEventListener('click', async () => {
    try {
      await api('/api/admin/logout', { method: 'POST' });
    } catch {
      // Session may already be gone.
    }
    showLogin();
  });

  el.list.addEventListener('change', (event) => {
    const select = event.target.closest('[data-action="status"]');
    if (!select) return;

    const card = select.closest('.card');
    if (!card) return;

    const booking = state.items.find((item) => String(item.id) === card.dataset.id);
    if (booking) changeStatus(card, booking, select);
  });

  el.list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const card = button.closest('.card');
    if (!card) return;

    const booking = state.items.find((item) => String(item.id) === card.dataset.id);
    if (!booking) return;

    if (button.dataset.action === 'copy') copyPhone(booking.phone);
    if (button.dataset.action === 'delete') removeBooking(card, booking);
  });

  el.search.addEventListener('input', () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.q = el.search.value.trim();
      load({ reset: true });
    }, 300);
  });

  el.statusFilter.addEventListener('change', () => {
    state.status = el.statusFilter.value;
    load({ reset: true });
  });

  el.refresh.addEventListener('click', async () => {
    await load({ reset: true });
    await refreshCounts();
  });

  el.loadMore.addEventListener('click', () => load({ reset: false }));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.user) {
      load({ reset: true });
      refreshCounts();
    }
  });

  /* ---------- Старт ---------- */

  async function init() {
    try {
      const response = await fetch('/api/admin/session', { credentials: 'same-origin' });
      if (!response.ok) {
        showLogin();
        return;
      }

      const data = await readJson(response);
      if (!data?.csrfToken) {
        showLogin();
        return;
      }

      state.user = data.user;
      state.csrf = data.csrfToken;
      showApp();
      startSessionKeepalive();
      connectLive();
      await load({ reset: true });
    } catch {
      showLogin('Нет связи с сервером');
    }
  }

  init();
})();
