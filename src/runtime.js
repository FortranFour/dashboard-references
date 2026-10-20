/* Dashboard References runtime. MIT License. */
(() => {
  'use strict';
  const ELEMENT_NAME = 'dashboard-card-reference';
  const ENTITY_ELEMENT_NAME = 'dashboard-entity-reference';
  const VERSION = '0.1.0-beta.1';
  const ENTITY_TOKEN = /\[\[entity:([A-Za-z0-9_.-]+)\]\]/g;
  const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
  const REFERENCE_ID = /^[A-Za-z0-9_.-]+$/;
  const REFERENCE_METADATA = new Set([
    'entity_reference_id', 'entity_reference_fields', 'entity_reference_extra'
  ]);
  let dashboardIndexes = new WeakMap();
  const connectionCaches = new WeakMap();

  function dashboardConfig(value) {
    // Accept the raw configuration and common wrappers used by card helpers.
    if (typeof value === 'string') value = JSON.parse(value);
    if (Array.isArray(value?.views)) return value;
    if (Array.isArray(value?.config?.views)) return value.config;
    if (Array.isArray(value?.data?.config?.views)) return value.data.config;
    return null;
  }

  function collectSources(value, sources = new Map()) {
    if (Array.isArray(value)) {
      for (const child of value) collectSources(child, sources);
    } else if (value && typeof value === 'object') {
      if (typeof value.card_reference_id === 'string' && typeof value.type === 'string') {
        if (sources.has(value.card_reference_id)) {
          throw new Error(`Duplicate card_reference_id: ${value.card_reference_id}`);
        }
        sources.set(value.card_reference_id, value);
      }
      // Only inspect dashboard/card containers; action payloads are not sources.
      for (const key of ['views', 'sections', 'cards', 'card', 'tabs', 'entities', 'elements']) {
        if (value[key]) collectSources(value[key], sources);
      }
    }
    return sources;
  }

  function referencePath(node, path, id) {
    if (!Array.isArray(path) || !path.length || path.some(key =>
      !(typeof key === 'string' || Number.isInteger(key)) ||
      ['__proto__', 'prototype', 'constructor'].includes(key))) {
      throw new Error(`Entity reference ${id} needs a nonempty field path.`);
    }
    let value = node;
    for (const key of path) {
      if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) {
        throw new Error(`Entity reference ${id} cannot find ${path.join('.')}.`);
      }
      value = value[key];
    }
    return value;
  }

  function readReference(reference, id) {
    let value = referencePath(reference.node, reference.path, id);
    if (reference.domain) {
      // A few authoritative entities live in a JS/Jinja field rather than an
      // entity property. The explicit selector must contain exactly one
      // distinct ID of the requested domain; never infer from a friendly name.
      const domain = reference.domain;
      if (typeof domain !== 'string' || !/^[a-z_]+$/.test(domain) || typeof value !== 'string') {
        throw new Error(`Entity reference ${id} has an invalid template selector.`);
      }
      const pattern = new RegExp(`(?:^|[^A-Za-z0-9_.])(${domain}\\.[a-z0-9_]+)(?![A-Za-z0-9_.])`, 'g');
      const entities = [...new Set([...value.matchAll(pattern)].map(match => match[1]))];
      if (entities.length !== 1) {
        throw new Error(`Entity reference ${id}: ${reference.path.join('.')} must contain one ${domain} entity (found ${entities.length}).`);
      }
      value = entities[0];
    }
    if (typeof value !== 'string' || !ENTITY_ID.test(value)) {
      throw new Error(`Entity reference ${id} must resolve to an entity ID.`);
    }
    return value;
  }

  function collectEntityReferences(config) {
    const references = new Map();
    const add = (id, reference) => {
      if (typeof id !== 'string' || !REFERENCE_ID.test(id)) {
        throw new Error('Entity reference identifiers must use letters, numbers, dots, underscores or hyphens.');
      }
      if (references.has(id)) throw new Error(`Duplicate entity reference: ${id}. Keep one authoritative dashboard entry.`);
      references.set(id, reference);
    };
    const visit = (value, inSource = false) => {
      if (Array.isArray(value)) {
        for (const child of value) visit(child, inSource);
        return;
      }
      if (!value || typeof value !== 'object') return;
      inSource = inSource || typeof value.card_reference_id === 'string';
      if (inSource) {
        if (value.entity_reference_id !== undefined) {
          add(value.entity_reference_id, { node: value, path: ['entity'] });
        }
        for (const [id, selector] of Object.entries(value.entity_reference_fields || {})) {
          if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
            throw new Error(`Entity reference ${id} needs a field selector.`);
          }
          add(id, { node: value, path: selector.path, domain: selector.domain });
        }
        for (const id of Object.keys(value.entity_reference_extra || {})) {
          add(id, { node: value, path: ['entity_reference_extra', id] });
        }
      }
      for (const [key, child] of Object.entries(value)) {
        if (!REFERENCE_METADATA.has(key)) visit(child, inSource);
      }
    };
    visit(config);
    return references;
  }

  function indexDashboard(config, needEntities) {
    let index = dashboardIndexes.get(config);
    if (!index) {
      index = { config, sources: collectSources(config), entities: null };
      dashboardIndexes.set(config, index);
    }
    if (needEntities && !index.entities) index.entities = collectEntityReferences(config);
    return index;
  }

  function defaultPath(path) {
    return path === null || path === 'lovelace' ? 'lovelace' : path;
  }

  function connectionCache(hass) {
    const connection = hass?.connection;
    if (!connection || typeof connection !== 'object') return null;
    let state = connectionCaches.get(connection);
    if (state) return state;
    state = { configs: new Map(), pending: new Map(), listeners: new Set(), generation: 0, canCache: false };
    connectionCaches.set(connection, state);
    const clear = path => {
      state.generation += 1;
      dashboardIndexes = new WeakMap();
      for (const key of [...state.configs.keys()]) {
        if (path === undefined || defaultPath(key) === defaultPath(path)) state.configs.delete(key);
      }
      for (const listener of state.listeners) listener(path);
    };
    if (typeof connection.addEventListener === 'function') {
      connection.addEventListener('disconnected', () => clear());
      connection.addEventListener('ready', () => clear());
    }
    if (typeof connection.subscribeEvents === 'function') {
      // One narrowly filtered subscription per connection; no timers or
      // state-event subscriptions. Failed subscriptions disable remote cache.
      try {
        Promise.resolve(connection.subscribeEvents(event => {
          const path = event?.data?.url_path;
          clear(path === undefined ? undefined : path);
        }, 'lovelace_updated')).then(() => { state.canCache = true; }).catch(() => {
          state.canCache = false;
          state.configs.clear();
        });
      } catch (_) { /* Fetch on each opening if subscriptions are unavailable. */ }
    }
    return state;
  }

  async function savedDashboard(hass, path, state) {
    if (state?.canCache && state.configs.has(path)) return state.configs.get(path);
    if (state?.pending.has(path)) return state.pending.get(path);
    const request = { type: 'lovelace/config', url_path: path, force: false };
    const task = (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const generation = state?.generation;
        const result = typeof hass?.callWS === 'function'
          ? await hass.callWS(request)
          : await hass.connection.sendMessagePromise(request);
        const config = dashboardConfig(result);
        if (!config) throw new Error('Home Assistant returned a dashboard without a views list.');
        // An edit/reconnection during a request may make its response stale.
        if (state && generation !== state.generation) continue;
        state?.configs.set(path, config);
        return config;
      }
      throw new Error('The dashboard changed during lookup. Reopen the popup to use the latest saved configuration.');
    })();
    if (state) state.pending.set(path, task);
    try { return await task; }
    finally { if (state?.pending.get(path) === task) state.pending.delete(path); }
  }

  async function fetchDashboardIndex(hass, dashboard, cardIds = [], entityIds = []) {
    const frontendHass = document.querySelector?.('home-assistant')?.hass;
    const apiHass = [hass, frontendHass].find(value =>
      typeof value?.callWS === 'function' || typeof value?.connection?.sendMessagePromise === 'function');
    const state = connectionCache(apiHass);
    const hasEntries = index => cardIds.every(id => index.sources.has(id)) &&
      entityIds.every(id => index.entities.has(id));
    if (!apiHass) throw new Error('The popup did not receive a Home Assistant WebSocket connection.');
    const paths = dashboard === 'lovelace' ? ['lovelace', null] : [dashboard];
    // Remember which path actually supplied this dashboard, including the
    // default null path, instead of repeating a failed alias request.
    paths.sort((a, b) => Number(state?.configs.has(b) || false) - Number(state?.configs.has(a) || false));
    const checked = [];
    for (const path of paths) {
      let config;
      try { config = await savedDashboard(apiHass, path, state); }
      catch (error) {
        if (['not_found', 'config_not_found'].includes(error?.code)) {
          checked.push(`${path ?? 'default'}: configuration not found`);
          continue;
        }
        throw error;
      }
      const index = indexDashboard(config, entityIds.length > 0);
      if (hasEntries(index)) return index;
      checked.push(`${path ?? 'default'}: missing ${[
        ...cardIds.filter(id => !index.sources.has(id)),
        ...entityIds.filter(id => !index.entities.has(id))
      ].join(', ')}`);
    }
    throw new Error(`Cannot find the dashboard references. Checked ${checked.join('; ')}. ` +
      'Save the updated dashboard YAML and retain its reference identifiers.');
  }

  function entityTokens(card) {
    const ids = new Set();
    const visit = value => {
      if (typeof value === 'string') {
        for (const match of value.matchAll(ENTITY_TOKEN)) ids.add(match[1]);
        if (value.includes('[[entity:') && value.replace(ENTITY_TOKEN, '').includes('[[entity:')) {
          throw new Error('An entity reference token is incomplete. Use [[entity:identifier]].');
        }
      } else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(card);
    return [...ids];
  }

  function resolveEntityCard(card, references, ids, expectedDomains) {
    const values = new Map();
    for (const id of ids) {
      const reference = references.get(id);
      if (!reference) throw new Error(`Missing entity reference: ${id}.`);
      const entity = readReference(reference, id);
      const expected = expectedDomains[id];
      if (expected && entity.split('.')[0] !== expected) {
        throw new Error(`${id} now points to ${entity}; its existing popup control expects ${expected}. Update that control before changing its domain.`);
      }
      values.set(id, entity);
    }
    const resolve = value => {
      if (typeof value === 'string') return value.replace(ENTITY_TOKEN, (_match, id) => values.get(id));
      if (Array.isArray(value)) return value.map(resolve);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).filter(([key]) =>
          !REFERENCE_METADATA.has(key)).map(([key, child]) => [key, resolve(child)]));
      }
      return value;
    };
    return resolve(card);
  }

  function isHeadingButton(card) {
    // Integration badges decorate a heading; they do not turn it into a
    // control. Remove that whole row in popups, keeping the original intact.
    const decorativeFields = !card?.custom_fields ||
      Object.keys(card.custom_fields).every(key => key === 'integrations');
    return card?.type === 'custom:button-card' &&
      typeof card.name === 'string' && card.name.trim() &&
      !card.entity && !card.template && decorativeFields &&
      card.show_icon === false && card.show_state === false &&
      card.show_label === false &&
      ['tap_action', 'hold_action', 'double_tap_action'].every(key =>
        !card[key] || card[key].action === 'none');
  }

  function removePrimaryHeading(card) {
    if (!card || typeof card !== 'object') return card;
    if (isHeadingButton(card)) return null;
    if (card.type === 'custom:mushroom-title-card' && card.title) {
      // Billing subtitles describe the data and should remain visible.
      if (!card.subtitle) return null;
      delete card.title;
      return card;
    }
    if (typeof card.title === 'string' && card.title.trim()) {
      // An entities header can also hold an all-on/off switch. Keep that
      // header truthy so removing its label does not remove the switch.
      if (card.type === 'entities' && card.show_header_toggle !== false) {
        card.title = ' ';
      } else {
        delete card.title;
      }
      return card;
    }
    if (card.card) {
      const content = removePrimaryHeading(card.card);
      if (!content) return null;
      card.card = content;
    } else if (Array.isArray(card.cards) && card.cards.length) {
      const first = removePrimaryHeading(card.cards[0]);
      if (first) card.cards[0] = first;
      else card.cards.shift();
    }
    return card;
  }

  function isDateSelector(card) {
    if (card?.type === 'energy-date-selection') return true;
    return Array.isArray(card?.cards) && card.cards.length > 0 &&
      card.cards.every(isDateSelector);
  }

  function sourceHeading(card) {
    if (!card || typeof card !== 'object') return '';
    if (typeof card.title === 'string' && card.title.trim()) return card.title.trim();
    if (isHeadingButton(card)) return card.name.trim();
    if (card.card) return sourceHeading(card.card);
    return Array.isArray(card.cards) && card.cards.length ? sourceHeading(card.cards[0]) : '';
  }

  function cloneCard(card, removeHeading = false) {
    const clone = JSON.parse(JSON.stringify(card));
    const strip = (value) => {
      if (Array.isArray(value)) return value.forEach(strip);
      if (!value || typeof value !== 'object') return;
      delete value.card_reference_id;
      for (const key of REFERENCE_METADATA) delete value[key];
      for (const child of Object.values(value)) strip(child);
    };
    strip(clone);
    // These options belong to the original section's placement, not the popup.
    delete clone.grid_options;
    delete clone.layout_options;
    const content = removeHeading ? removePrimaryHeading(clone) : clone;
    return content;
  }

  // Reject nested whole-card references before rendering. This conservative
  // boundary prevents direct and indirect reference cycles across dashboards.
  function assertNoCardReferences(value) {
    if (Array.isArray(value)) return value.forEach(assertNoCardReferences);
    if (!value || typeof value !== 'object') return;
    if (value.type === 'custom:dashboard-card-reference') {
      throw new Error('Nested whole-card references are not supported. Reference the original content directly.');
    }
    Object.values(value).forEach(assertNoCardReferences);
  }

  class ReferenceTabs extends HTMLElement {
    constructor() { super(); this.attachShadow({mode: 'open'}); }
    setConfig(config) { this._config = config; this._render(); }
    set hass(value) { this._hass = value; for (const child of this._children || []) child.hass = value; }
    async _render() {
      const config = this._config;
      const helpers = await window.loadCardHelpers();
      const children = await Promise.all(config.tabs.map(({card}) => helpers.createCardElement(card)));
      if (config !== this._config) return;
      this._children = children;
      const style = document.createElement('style');
      style.textContent = ':host{display:block;min-width:0}.tabs{display:flex;overflow:auto;border-bottom:1px solid var(--divider-color)}button{font:inherit;white-space:nowrap;padding:12px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--secondary-text-color);cursor:pointer}button[aria-selected=true]{border-color:var(--primary-color);color:var(--primary-color)}[hidden]{display:none!important}';
      const tabs = document.createElement('div'); tabs.className = 'tabs'; tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','Referenced cards');
      const panels = document.createElement('div');
      const buttons = [], bodies = [];
      const activate = index => {
        buttons.forEach((button, i) => { button.setAttribute('aria-selected',String(i === index)); button.tabIndex = i === index ? 0 : -1; bodies[i].hidden = i !== index; });
        this.dispatchEvent(new Event('iron-resize', {bubbles:true, composed:true}));
      };
      children.forEach((child, i) => {
        child.hass = this._hass;
        const button = document.createElement('button'); button.textContent = config.tabs[i].label; button.id = 'tab-'+i; button.setAttribute('role','tab'); button.setAttribute('aria-controls','panel-'+i);
        const panel = document.createElement('div'); panel.id = 'panel-'+i; panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby',button.id); panel.append(child);
        button.addEventListener('click', () => activate(i));
        button.addEventListener('keydown', event => {
          const key = event.key; let next;
          if (key === 'ArrowRight') next = (i+1)%children.length;
          else if (key === 'ArrowLeft') next = (i+children.length-1)%children.length;
          else if (key === 'Home') next = 0;
          else if (key === 'End') next = children.length-1;
          if (next !== undefined) { event.preventDefault(); activate(next); buttons[next].focus(); }
        });
        buttons.push(button); bodies.push(panel); tabs.append(button); panels.append(panel);
      });
      this.shadowRoot.replaceChildren(style,tabs,panels); activate(0);
    }
    getCardSize() { return Math.max(1, ...(this._children || []).map(c => Number(c.getCardSize?.()) || 4)); }
    getGridOptions() { return {columns:12,rows:'auto'}; }
  }
  customElements.define('dashboard-reference-tabs', ReferenceTabs);

  class DashboardCardReference extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = ':host{display:block;min-width:0;width:100%}.status{padding:16px;color:var(--secondary-text-color);font:inherit}';
      this._container = document.createElement('div');
      this.shadowRoot.append(style, this._container);
      this._generation = 0;
      this._pending = false;
      this._ready = false;
      this._card = null;
      this._config = null;
      this._hass = null;
    }

    static getStubConfig() { return { dashboard: 'lovelace', card_id: 'my_card' }; }

    setConfig(config) {
      const ids = config.card_ids || (config.card_id ? [config.card_id] : []);
      if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id)) {
        throw new Error('Supply card_id or a nonempty card_ids list.');
      }
      if (config.dashboard !== undefined && typeof config.dashboard !== 'string') {
        throw new Error('dashboard must be the dashboard URL path.');
      }
      if (config.layout !== undefined && !['tabs','vertical','horizontal'].includes(config.layout)) throw new Error('layout must be tabs, vertical or horizontal.');
      if (config.strip_heading !== undefined && typeof config.strip_heading !== 'boolean') throw new Error('strip_heading must be a boolean.');
      if (config.labels !== undefined && (!Array.isArray(config.labels) || config.labels.some(v => typeof v !== 'string'))) throw new Error('labels must be a list of strings.');
      this._config = { ids: [...ids], dashboard: config.dashboard || 'lovelace',
        layout: config.layout || 'tabs', strip_heading: config.strip_heading === true, labels: config.labels || [] };
      this._generation += 1;
      this._pending = false;
      this._ready = false;
      this._card = null;
      this._resolvedSignature = null;
      this._showStatus('Loading…');
      this._start();
    }

    set hass(hass) {
      this._hass = hass;
      this._watchSource();
      if (this._card) this._card.hass = hass;
      this._start();
    }

    get hass() { return this._hass; }

    connectedCallback() { this._watchSource(); this._start(); }

    _watchSource() {
      const state = this.isConnected ? connectionCache(this._hass) : null;
      if (state === this._sourceState) return;
      this._sourceState?.listeners.delete(this._sourceChanged);
      this._sourceState = state;
      this._sourceChanged ||= path => {
        if (!this._config || (path !== undefined && defaultPath(path) !== defaultPath(this._config.dashboard))) return;
        this._generation += 1; this._pending = false; this._ready = false;
        this._start();
      };
      state?.listeners.add(this._sourceChanged);
    }

    disconnectedCallback() {
      this._generation += 1;
      this._pending = false;
      this._ready = false;
      this._sourceState?.listeners.delete(this._sourceChanged);
      this._sourceState = null;
    }

    _showStatus(message) {
      const status = document.createElement('div');
      status.className = 'status';
      status.textContent = message;
      this._container.replaceChildren(status);
    }

    async _fetchSources(ids) {
      return (await fetchDashboardIndex(this._hass, this._config.dashboard, ids)).sources;
    }

    async _start() {
      if (!this._config || !this._hass || this._pending || this._ready || !this.isConnected) return;
      const generation = this._generation;
      const ids = [...this._config.ids];
      let stage = 'dashboard lookup';
      this._pending = true;
      try {
        const sources = await this._fetchSources(ids);
        if (generation !== this._generation || !this.isConnected) return;
        const entries = ids.map((id, position) => {
          const source = sources.get(id);
          if (!source) throw new Error(`Source card not found: ${id}`);
          assertNoCardReferences(source);
          return { id, label: this._config.labels[position] || sourceHeading(source) || id, card: cloneCard(source, this._config.strip_heading) };
        }).filter(entry => entry.card);
        if (!entries.length) throw new Error('The referenced cards contain only headings.');
        const cardConfig = entries.length === 1 ? entries[0].card :
          this._config.layout === 'tabs' ? {
            type: 'custom:dashboard-reference-tabs', tabs: entries.map(({label,card}) => ({label,card}))
          } : { type: this._config.layout + '-stack', cards: entries.map(({card}) => card) };
        const signature = JSON.stringify(cardConfig);
        if (this._card && signature === this._resolvedSignature) { this._ready = true; return; }
        stage = 'card helpers';
        if (typeof window.loadCardHelpers !== 'function') {
          throw new Error('Home Assistant card helpers are unavailable.');
        }
        const helpers = await window.loadCardHelpers();
        if (generation !== this._generation || !this.isConnected) return;
        if (typeof helpers?.createCardElement !== 'function') {
          throw new Error('Home Assistant card helpers do not expose createCardElement.');
        }
        stage = 'card rendering';
        const card = await helpers.createCardElement(cardConfig);
        if (generation !== this._generation || !this.isConnected) return;
        if (!card) throw new Error('The source card renderer returned no element.');
        card.hass = this._hass;
        this._card = card;
        this._resolvedSignature = signature;
        this._container.replaceChildren(card);
        this._ready = true;
      } catch (error) {
        if (generation !== this._generation || !this.isConnected) return;
        const message = String(error?.message || error?.code || error || 'Unknown error');
        console.error(`Dashboard Card Reference ${VERSION} (${stage}, ${ids.join(', ')}):`, error);
        this._showStatus(`Reference ${ids.join(', ')} — ${stage}: ${message.slice(0, 600)} [helper ${VERSION}]`);
        // Do not retry a failed source lookup on every state update.
        this._ready = true;
      } finally {
        if (generation === this._generation) this._pending = false;
      }
    }

    getCardSize() {
      return this._card?.getCardSize?.() || 4;
    }

    getGridOptions() {
      return this._card?.getGridOptions?.() || { columns: 12, rows: 'auto' };
    }
  }

  class DashboardEntityReference extends DashboardCardReference {
    static getStubConfig() { return { dashboard: 'lovelace', card: {type:'tile',entity:'[[entity:my_light]]'} }; }
    setConfig(config) {
      if (!config.card || typeof config.card !== 'object' || Array.isArray(config.card) ||
          typeof config.card.type !== 'string') {
        throw new Error('Supply the existing popup layout under card.');
      }
      if (config.card.type === `custom:${ENTITY_ELEMENT_NAME}`) {
        throw new Error('An entity reference card cannot wrap itself.');
      }
      if (config.dashboard !== undefined && typeof config.dashboard !== 'string') {
        throw new Error('dashboard must be the dashboard URL path.');
      }
      assertNoCardReferences(config.card);
      const ids = entityTokens(config.card);
      if (!ids.length) throw new Error('The popup layout needs at least one [[entity:identifier]] reference.');
      const expectedDomains = config.expected_domains || {};
      if (typeof expectedDomains !== 'object' || Array.isArray(expectedDomains) ||
          Object.values(expectedDomains).some(domain => typeof domain !== 'string' || !/^[a-z_]+$/.test(domain))) {
        throw new Error('expected_domains must map reference identifiers to entity domains.');
      }
      this._config = { ids, dashboard: config.dashboard || 'lovelace',
        card: config.card, expectedDomains: { ...expectedDomains } };
      this._generation += 1;
      this._pending = false;
      this._ready = false;
      this._card = null;
      this._resolvedSignature = null;
      this._showStatus('Loading…');
      this._start();
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      // If Browser Mod reuses the same content element after closing a popup,
      // its next attachment must resolve the latest saved entity bindings.
      this._ready = false;
      this._card = null;
      this._resolvedSignature = null;
    }

    async _start() {
      if (!this._config || !this._hass || this._pending || this._ready || !this.isConnected) return;
      const generation = this._generation;
      const { ids, dashboard, card: layout, expectedDomains } = this._config;
      let stage = 'entity lookup';
      this._pending = true;
      try {
        const index = await fetchDashboardIndex(this._hass, dashboard, [], ids);
        if (generation !== this._generation || !this.isConnected) return;
        const resolved = resolveEntityCard(layout, index.entities, ids, expectedDomains);
        const signature = JSON.stringify(resolved);
        if (this._card && signature === this._resolvedSignature) { this._ready = true; return; }
        stage = 'card helpers';
        if (typeof window.loadCardHelpers !== 'function') throw new Error('Home Assistant card helpers are unavailable.');
        const helpers = await window.loadCardHelpers();
        if (generation !== this._generation || !this.isConnected) return;
        if (typeof helpers?.createCardElement !== 'function') throw new Error('Home Assistant card helpers do not expose createCardElement.');
        stage = 'card rendering';
        const card = await helpers.createCardElement(resolved);
        if (generation !== this._generation || !this.isConnected) return;
        if (!card) throw new Error('The Room popup renderer returned no element.');
        card.hass = this._hass;
        this._card = card;
        this._resolvedSignature = signature;
        this._container.replaceChildren(card);
        this._ready = true;
      } catch (error) {
        if (generation !== this._generation || !this.isConnected) return;
        console.error(`Dashboard Entity Reference ${VERSION} (${stage}):`, error);
        const message = String(error?.message || error?.code || error || 'Unknown error');
        this._showStatus(`Entity reference — ${stage}: ${message.slice(0, 600)} [helper ${VERSION}]`);
        this._ready = true;
      } finally {
        if (generation === this._generation) this._pending = false;
      }
    }
  }

  if (!customElements.get(ELEMENT_NAME)) customElements.define(ELEMENT_NAME, DashboardCardReference);
  if (!customElements.get(ENTITY_ELEMENT_NAME)) customElements.define(ENTITY_ELEMENT_NAME, DashboardEntityReference);
  window.customCards = window.customCards || [];
  if (!window.customCards.some(card => card.type === ELEMENT_NAME)) {
    window.customCards.push({ type: ELEMENT_NAME, name: 'Dashboard Card Reference',
      description: 'Open the saved source card from another dashboard tab.' });
  }
  if (!window.customCards.some(card => card.type === ENTITY_ELEMENT_NAME)) {
    window.customCards.push({ type: ENTITY_ELEMENT_NAME, name: 'Dashboard Entity Reference',
      description: 'Keep a separate layout and resolve shared named entity assignments.' });
  }
})();
