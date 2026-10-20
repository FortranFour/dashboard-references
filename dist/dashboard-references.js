/* Dashboard References 0.1.0-beta.1 | MIT License | FortranFour */
if (window.DashboardReferences || customElements.get('dashboard-card-reference') || customElements.get('dashboard-entity-reference') || customElements.get('dashboard-reference-native-editor') || window.DashboardComponentEditor) {
  console.warn('Dashboard References: another copy or a legacy resource is already loaded. Remove duplicate resources and reload.');
} else {
  const params = new URL(import.meta.url).searchParams;
  window.DashboardReferences = Object.freeze({version: '0.1.0-beta.1', options: Object.freeze({
    editors: params.get('editors') !== 'false', component_editor: params.get('component_editor') !== 'false'
  })});
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


/**
 * Dashboard Reference Editor 1.0.0
 * Optional editor support for dashboard-entity-reference 1.2.x.
 * Uses the native floor3dx/snapshot editors and saves stable entity references.
 * Does not change either native card, save dashboards, or load remote scripts.
 */
(() => {
  'use strict';
  if (window.DashboardReferences?.options.editors === false) return;
  const TAG = 'dashboard-reference-native-editor';
  const WRAPPER = 'dashboard-entity-reference';
  const SUPPORTED = new Set(['custom:floor3dx-card', 'custom:floor3dpro-card',
    'custom:floor3d-card', 'custom:floor3d-snapshot-card']);
  const TOKEN = /\[\[entity:([A-Za-z0-9_.-]+)\]\]/g;
  const ID = /^[a-z_]+\.[a-z0-9_]+$/;
  const META = new Set(['entity_reference_id', 'entity_reference_fields', 'entity_reference_extra']);
  const FIELDS = new Set(['entity', 'entity_id', 'camera_entity', 'remote_id',
    'media_player_id', 'color_entity', 'top_entity', 'icon_entity', 'triggers_update']);
  const copy = value => JSON.parse(JSON.stringify(value));
  const tokenIds = value => [...new Set([...JSON.stringify(value).matchAll(TOKEN)].map(match => match[1]))];

  function readSources(dashboard) {
    const sources = new Map();
    const add = (role, entity) => {
      if (typeof role !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(role) ||
          typeof entity !== 'string' || !ID.test(entity)) throw new Error(`Invalid source entry: ${role}.`);
      if (sources.has(role)) throw new Error(`Duplicate source label: ${role}.`);
      sources.set(role, entity);
    };
    const visit = (value, source = false) => {
      if (Array.isArray(value)) return value.forEach(child => visit(child, source));
      if (!value || typeof value !== 'object') return;
      source = source || typeof value.card_reference_id === 'string';
      if (source) {
        if (value.entity_reference_id !== undefined) add(value.entity_reference_id, value.entity);
        for (const [role, selector] of Object.entries(value.entity_reference_fields || {})) {
          if (!Array.isArray(selector.path) || !selector.path.length) throw new Error(`Invalid selector: ${role}.`);
          let entity = value;
          for (const key of selector.path) {
            if (['__proto__', 'constructor', 'prototype'].includes(key) ||
                !entity || !Object.prototype.hasOwnProperty.call(entity, key)) throw new Error(`Cannot read source: ${role}.`);
            entity = entity[key];
          }
          if (selector.domain) {
            if (!/^[a-z_]+$/.test(selector.domain) || typeof entity !== 'string') throw new Error(`Invalid selector domain: ${role}.`);
            const pattern = new RegExp(`(?:^|[^A-Za-z0-9_.])(${selector.domain}\\.[a-z0-9_]+)(?![A-Za-z0-9_.])`, 'g');
            const found = [...new Set([...entity.matchAll(pattern)].map(match => match[1]))];
            if (found.length !== 1) throw new Error(`Source ${role} must select exactly one entity.`);
            entity = found[0];
          }
          add(role, entity);
        }
        for (const [role, entity] of Object.entries(value.entity_reference_extra || {})) add(role, entity);
      }
      for (const [key, child] of Object.entries(value)) if (!META.has(key)) visit(child, source);
    };
    visit(dashboard);
    return sources;
  }

  function resolve(value, sources) {
    if (typeof value === 'string') return value.replace(TOKEN, (_match, role) => {
      if (!sources.has(role)) throw new Error(`Missing source label: ${role}.`);
      return sources.get(role);
    });
    if (Array.isArray(value)) return value.map(child => resolve(child, sources));
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, resolve(child, sources)]));
    return value;
  }

  function reference(value, sources, original, states) {
    const preferred = new Set(tokenIds(original));
    const reverse = new Map();
    for (const [role, entity] of sources) {
      if (!reverse.has(entity)) reverse.set(entity, []);
      reverse.get(entity).push(role);
    }
    const missing = new Set();
    const hook = () => false;
    const visit = (child, key = '') => {
      if (typeof child === 'string') {
        if (child.startsWith('data:')) return child;
        if ((FIELDS.has(key) || key.endsWith('_entity')) && ID.test(child) &&
            !reverse.has(child) && !hook(child)) missing.add(child);
        return child.replace(/\[\[entity:[A-Za-z0-9_.-]+\]\]|[a-z_]+\.[a-z0-9_]+/g, (entity, offset, text) => {
          if (entity.startsWith('[[entity:') || /[A-Za-z0-9_.]/.test(text[offset - 1] || '') ||
              /[A-Za-z0-9_.]/.test(text[offset + entity.length] || '')) return entity;
          let roles = reverse.get(entity);
          if (!roles) {
            if (states?.[entity] && !hook(entity)) missing.add(entity);
            return entity;
          }
          if (roles.length > 1) {
            const retained = roles.filter(role => preferred.has(role));
            if (retained.length === 1) roles = retained;
            else throw new Error(`Ambiguous source for ${entity}: ${roles.join(', ')}.`);
          }
          return `[[entity:${roles[0]}]]`;
        });
      }
      if (Array.isArray(child)) return child.map(item => visit(item, key));
      if (child && typeof child === 'object') return Object.fromEntries(
        Object.entries(child).map(([field, item]) => [field, visit(item, field)]));
      return child;
    };
    const linked = visit(value);
    if (missing.size) throw new Error(`Add a source entry with an entity_reference_id in a hidden source tab for: ${[...missing].join(', ')}. Save that dashboard, then reopen this editor. Your changes are still displayed here.`);
    if (!tokenIds(linked).length) throw new Error('At least one entity reference is required by the existing wrapper. Use a standalone native card for a configuration without referenced entities.');
    return linked;
  }

  function dashboardValue(value) {
    if (Array.isArray(value?.views)) return value;
    if (Array.isArray(value?.config?.views)) return value.config;
    if (Array.isArray(value?.data?.config?.views)) return value.data.config;
    throw new Error('Home Assistant returned no dashboard views.');
  }

  class NativeReferenceEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._epoch = 0;
      this._edit = 0;
      this._sourceCache = new Map();
      this._nativeArea = document.createElement('div');
      this._notice = document.createElement('div');
      this._notice.style.cssText = 'padding:10px 0;white-space:pre-wrap;color:var(--secondary-text-color);font:inherit';
      this.shadowRoot.append(this._notice, this._nativeArea);
      this._nativeArea.addEventListener('config-changed', event => this._changed(event));
    }

    setConfig(config) {
      if (!SUPPORTED.has(config?.card?.type)) throw new Error('This visual editor supports wrapped floor3d-family and floor3d-snapshot cards. Use YAML for other reference layouts.');
      const own = this._lastEmitted === JSON.stringify(config.card) &&
        (config.dashboard || 'lovelace') === (this._config?.dashboard || 'lovelace');
      const same = this._native && JSON.stringify(config.card) === JSON.stringify(this._config?.card) &&
        config.dashboard === this._config?.dashboard;
      this._config = copy(config);
      if (this._native && (own || same)) return;
      this._epoch += 1;
      this._pending = false;
      this._native = null;
      this._sourceCache.clear();
      this._start();
    }

    set hass(hass) {
      if (this._hass?.connection !== hass?.connection) this._sourceCache.clear();
      this._hass = hass;
      if (this._native) this._native.hass = this._editorHass();
      this._start();
    }
    get hass() { return this._hass; }
    set lovelace(value) {
      this._lovelace = value;
      if (this._native) this._native.lovelace = value;
    }
    get lovelace() { return this._lovelace; }
    connectedCallback() { this._start(); }
    disconnectedCallback() {
      this._epoch += 1;
      this._pending = false;
      this._native = null;
      this._nativeArea.replaceChildren();
      this._sourceCache.clear();
    }

    async _sources(dashboard = this._config?.dashboard || 'lovelace') {
      if (this._sourceCache.has(dashboard)) return this._sourceCache.get(dashboard);
      const job = (async () => {
        const paths = dashboard === 'lovelace' ? ['lovelace', null] : [dashboard];
        for (const path of paths) {
          try {
            const result = await this._hass.callWS({ type: 'lovelace/config', url_path: path, force: false });
            return readSources(dashboardValue(result));
          } catch (error) {
            if (path === paths[paths.length - 1] || !['not_found', 'config_not_found'].includes(error?.code)) throw error;
          }
        }
      })();
      this._sourceCache.set(dashboard, job);
      try { return await job; }
      catch (error) { this._sourceCache.delete(dashboard); throw error; }
    }

    _editorHass() {
      const original = this._hass;
      // Only the editor's dashboard-discovery reads receive resolved copies.
      // Keep the real hass object and connection unchanged.
      const facade = { ...original };
      for (const key of ['callService', 'callApi', 'fetchWithAuth']) {
        if (typeof original[key] === 'function') facade[key] = original[key].bind(original);
      }
      facade.callWS = async message => {
        const result = await original.callWS(message);
        if (message?.type !== 'lovelace/config') return result;
        const dashboard = dashboardValue(result);
        const visit = async node => {
          if (Array.isArray(node)) return Promise.all(node.map(visit));
          if (!node || typeof node !== 'object') return node;
          if (node.type === `custom:${WRAPPER}` && node.card) {
            const sources = await this._sources(node.dashboard || 'lovelace');
            return resolve(node.card, sources);
          }
          return Object.fromEntries(await Promise.all(Object.entries(node).map(async ([key, child]) => [key, await visit(child)])));
        };
        const resolved = await visit(dashboard);
        if (Array.isArray(result.views)) return resolved;
        if (Array.isArray(result.config?.views)) return { ...result, config: resolved };
        return { ...result, data: { ...result.data, config: resolved } };
      };
      return facade;
    }

    async _start() {
      if (!this.isConnected || !this._config || !this._hass || this._native || this._pending) return;
      const epoch = this._epoch;
      this._pending = true;
      this._notice.textContent = 'Loading native editor…';
      try {
        const sources = await this._sources();
        const resolved = resolve(this._config.card, sources);
        const tag = resolved.type.replace(/^custom:/, '');
        if (!customElements.get(tag)) {
          const helpers = await window.loadCardHelpers();
          await helpers.createCardElement(resolved);
          // Resources can define their element asynchronously.
          if (!customElements.get(tag)) throw new Error(`${tag} is not loaded. Check its dashboard resource and reload the frontend.`);
        }
        const cardClass = customElements.get(tag);
        if (typeof cardClass.getConfigElement !== 'function') throw new Error(`${tag} does not expose a native visual editor.`);
        const native = await cardClass.getConfigElement();
        if (epoch !== this._epoch || !this.isConnected) return;
        native.hass = this._editorHass();
        native.lovelace = this._lovelace;
        native.setConfig(resolved);
        this._native = native;
        this._nativeArea.replaceChildren(native);
        this._notice.textContent = '';
      } catch (error) {
        if (epoch === this._epoch) this._notice.textContent = String(error?.message || error);
      } finally {
        if (epoch === this._epoch) this._pending = false;
      }
    }

    async _changed(event) {
      if (!event.detail?.config) return;
      event.stopPropagation();
      const epoch = this._epoch, edit = ++this._edit;
      const native = copy(event.detail.config);
      try {
        const sources = await this._sources();
        if (epoch !== this._epoch || edit !== this._edit || !this.isConnected) return;
        const card = reference(native, sources, this._config.card, this._hass.states);
        const config = { ...this._config, card };
        if (config.expected_domains) config.expected_domains = Object.fromEntries(
          tokenIds(card).map(role => [role, sources.get(role).split('.')[0]]));
        this._config = copy(config);
        this._lastEmitted = JSON.stringify(card);
        this._notice.textContent = '';
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
      } catch (error) {
        if (epoch === this._epoch && edit === this._edit) this._notice.textContent = String(error?.message || error);
      }
    }
  }

  if (!customElements.get(TAG)) customElements.define(TAG, NativeReferenceEditor);
  customElements.whenDefined(WRAPPER).then(() => {
    const wrapper = customElements.get(WRAPPER);
    if (wrapper.referenceEditorVersion === '1.0.0') return;
    wrapper.getConfigElement = () => document.createElement(TAG);
    wrapper.referenceEditorVersion = '1.0.0';

    // Preview is a standard HA card property. Forward it through our own
    // wrapper so floor3dx's native object/camera picker can talk to its preview.
    const forwardPreview = element => {
      element._referencePreviewObserver?.disconnect();
      if (element._card) {
        element._card.preview = !!element._referencePreview;
        return;
      }
      if (!element._referencePreview || !element.shadowRoot) return;
      element._referencePreviewObserver = new MutationObserver(() => {
        if (!element._card) return;
        element._card.preview = true;
        element._referencePreviewObserver.disconnect();
      });
      element._referencePreviewObserver.observe(element.shadowRoot, { childList: true, subtree: true });
    };
    Object.defineProperty(wrapper.prototype, 'preview', {
      configurable: true,
      get() { return !!this._referencePreview; },
      set(value) { this._referencePreview = !!value; forwardPreview(this); }
    });
    const setConfig = wrapper.prototype.setConfig;
    wrapper.prototype.setConfig = function(config) {
      setConfig.call(this, config);
      if (this._referencePreview) forwardPreview(this);
    };
  });
})();

/* Dashboard Component Editor 1.1.0 — frontend resource, no dashboard migration.
 * Uses HA's own editors; the adapter is active only while editing a card.
 * No imports, external services, telemetry, or changes to card rendering.
 */
(() => {
  "use strict";
  if (window.DashboardReferences?.options.editors === false || window.DashboardReferences?.options.component_editor === false) return;
  const VERSION = "1.1.0";
  if (window.DashboardComponentEditor) return;
  const TAG = "dashboard-component-editor";
  const BYPASS = Symbol.for("dashboard-component-editor.native");
  const REFERENCE_EDITOR = "dashboard-reference-native-editor";
  const REFERENCE_TYPES = new Set([
    "custom:floor3dx-card", "custom:floor3dpro-card", "custom:floor3d-card",
    "custom:floor3d-snapshot-card",
  ]);
  // dashboard-reference-editor.js owns token resolution, reverse mapping,
  // cross-dashboard discovery, expected_domains, and preview forwarding.
  // Pass the complete original wrapper to it, including its source metadata.
  function referenceEditorOwns(card) {
    return card?.type === "custom:dashboard-entity-reference" &&
      REFERENCE_TYPES.has(card.card?.type) &&
      !!customElements.get("dashboard-entity-reference")?.referenceEditorVersion &&
      !!customElements.get(REFERENCE_EDITOR);
  }
  const PROTECTED = new Set([
    "card_mod", "card_reference_id", "entity_reference_id",
    "entity_reference_fields", "entity_reference_extra", "view_layout",
    "grid_options", "layout_options", "visibility", "popup_card_id",
  ]);
  const TOKEN = /\[\[entity:([^\]]+)\]\]/g;
  const obj = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const clone = v => {
    if (Array.isArray(v)) return v.map(clone);
    if (obj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
    return v;
  };
  const equal = (a, b) => {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
    if (!obj(a) || !obj(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
  };
  const at = (v, p) => p.reduce((x, k) => x?.[k], v);
  const put = (v, p, value) => {
    if (!p.length) return value;
    const [k, ...rest] = p;
    const out = Array.isArray(v) ? v.slice() : { ...v };
    out[k] = put(v?.[k], rest, value);
    return out;
  };
  function visit(v, fn, path = []) {
    if (!v || typeof v !== "object") return;
    fn(v, path);
    for (const [k, x] of Object.entries(v)) visit(x, fn, path.concat(Array.isArray(v) ? Number(k) : k));
  }
  function indexEntities(config) {
    const found = new Map();
    const add = (key, value) => {
      if (typeof key !== "string" || typeof value !== "string" || value.includes("[[entity:")) return;
      if (found.has(key) && found.get(key) !== value) found.set(key, null);
      else if (!found.has(key)) found.set(key, value);
    };
    visit(config, v => {
      if (!obj(v)) return;
      if (v.entity_reference_id) add(v.entity_reference_id, v.entity);
      for (const [key, value] of Object.entries(v.entity_reference_extra || {})) add(key, value);
      for (const [key, spec] of Object.entries(v.entity_reference_fields || {})) {
        if (!obj(spec) || !Array.isArray(spec.path)) continue;
        let value = at(v, spec.path);
        if (typeof value === "string" && spec.domain) {
          const hits = value.match(new RegExp(`\\b${String(spec.domain).replace(/[^a-z_]/g, "")}\\.[a-z0-9_]+`, "g"));
          if (hits && new Set(hits).size === 1) value = hits[0];
        }
        add(key, value);
      }
    });
    return found;
  }
  // Metadata lives outside native editors. Bindings are resolved only in this
  // temporary working copy, and restored when the edited component is put back.
  function prepare(original, entities) {
    const unresolved = new Set();
    function walk(v) {
      if (typeof v === "string") return v.replace(TOKEN, (all, key) => {
        const value = entities.get(key);
        if (value) return value;
        unresolved.add(key);
        return all;
      });
      if (Array.isArray(v)) return v.map(walk);
      if (!obj(v)) return v;
      return Object.fromEntries(Object.entries(v).filter(([k]) => !PROTECTED.has(k)).map(([k, x]) => [k, walk(x)]));
    }
    return { clean: walk(original), unresolved: [...unresolved] };
  }
  // Pair unchanged/moved array entries before matching changed entries. If
  // identity is ambiguous, stop instead of assigning metadata to another item.
  function matchArray(before, after) {
    const map = new Map(), used = new Set();
    const take = (i, j) => { map.set(i, j); used.add(j); };
    for (let i = 0; i < after.length; i++) {
      const matches = before.flatMap((x, j) => !used.has(j) && equal(x, after[i]) ? [j] : []);
      if (matches.length) take(i, matches[0]);
    }
    for (const key of ["entity", "name", "title", "type"]) {
      for (let i = 0; i < after.length; i++) {
        if (map.has(i) || !obj(after[i]) || after[i][key] == null) continue;
        const matches = before.flatMap((x, j) => !used.has(j) && obj(x) && x[key] === after[i][key] ? [j] : []);
        const peers = after.filter((x, n) => !map.has(n) && obj(x) && x[key] === after[i][key]);
        if (matches.length === 1 && peers.length === 1) take(i, matches[0]);
      }
    }
    const a = after.map((_, i) => i).filter(i => !map.has(i));
    const b = before.map((_, i) => i).filter(i => !used.has(i));
    if (a.length === 1 && b.length === 1) take(a[0], b[0]);
    else if (a.length && b.length) {
      const ambiguous = b.some(j => JSON.stringify(before[j]) !== JSON.stringify(after[a[b.indexOf(j)]]));
      if (ambiguous) throw Error("Several entries changed without a stable identity. Edit one component or row at a time to preserve its metadata.");
    }
    return map;
  }
  function restore(original, clean, edited, locked = []) {
    if (typeof original === "string" && original.includes("[[entity:")) {
      if (!equal(clean, edited)) locked.push(original);
      return original;
    }
    if (Array.isArray(original) && Array.isArray(clean) && Array.isArray(edited)) {
      const matches = matchArray(clean, edited);
      return edited.map((x, i) => matches.has(i) ? restore(original[matches.get(i)], clean[matches.get(i)], x, locked) : clone(x));
    }
    if (!obj(original) || !obj(clean) || !obj(edited)) return clone(edited);
    const out = {};
    for (const [k, v] of Object.entries(edited)) {
      if (!PROTECTED.has(k)) out[k] = Object.hasOwn(original, k) ? restore(original[k], clean[k], v, locked) : clone(v);
    }
    for (const [k, v] of Object.entries(original)) {
      if (PROTECTED.has(k)) out[k] = clone(v);
      // A GUI removing a field must not silently break a live entity binding.
      else if (!Object.hasOwn(edited, k) && typeof v === "string" && v.includes("[[entity:")) {
        out[k] = v;
        locked.push(v);
      }
    }
    return out;
  }
  const label = c => {
    const name = [c.title, c.name, c.primary, c.entity].find(x => typeof x === "string" && x.length < 85 && !x.includes("{{"));
    return `${name ? `${name} · ` : ""}${c.type || "Card"}`;
  };
  function components(config) {
    const list = [];
    visit(config, (v, path) => {
      if (!obj(v) || typeof v.type !== "string") return;
      const key = path.at(-1), parentKey = path.at(-2);
      if (!path.length || key === "card" || key === "content" || parentKey === "cards" ||
          (key === "element" && at(config, path.slice(0, -1))?.type === "custom:uix-forge")) {
        list.push({ path, card: v, label: `${path.length ? path.join(" / ") + " — " : "Whole card — "}${label(v)}` });
      }
    });
    return list;
  }
  function sourceCards(config, id) {
    const matches = [];
    visit(config, (v, path) => {
      if (obj(v) && typeof v.type === "string" && v.card_reference_id === id) matches.push({ path, card: v });
    });
    return matches;
  }
  const bindingStates = new WeakMap();
  const entityID = /^[a-z_]+\.[a-z0-9_]+$/;
  const entityFields = new Set(["entity", "entity_id", "camera_entity", "remote_id", "media_player_id", "color_entity", "top_entity", "icon_entity", "triggers_update"]);
  const activeDashboard = () => location.pathname.split("/").filter(Boolean)[0] || "lovelace";
  const dashboardData = x => x?.views ? x : x?.config?.views ? x.config : x?.data?.config?.views ? x.data.config : null;
  function bindingState(editor) {
    let state = bindingStates.get(editor);
    if (!state || state.connection !== editor.hass?.connection) {
      state = { maps: new Map(), jobs: new Map(), connection: editor.hass?.connection, edit: 0 };
      bindingStates.set(editor, state);
    }
    return state;
  }
  function scopesFor(config, dashboard = activeDashboard()) {
    const scopes = new Map();
    function walk(v, scope) {
      if (typeof v === "string") {
        for (const m of v.matchAll(TOKEN)) {
          if (!scopes.has(scope)) scopes.set(scope, new Set());
          scopes.get(scope).add(m[1]);
        }
      } else if (Array.isArray(v)) v.forEach(x => walk(x, scope));
      else if (obj(v)) {
        const wrapper = v.type === "custom:dashboard-entity-reference";
        for (const [k, x] of Object.entries(v)) walk(x, wrapper && k === "card" ? v.dashboard || "lovelace" : scope);
      }
    }
    walk(config, dashboard);
    return scopes;
  }
  function scopeAtPath(config, path, dashboard = activeDashboard()) {
    let node = config, scope = dashboard;
    for (const key of path) {
      if (node?.type === "custom:dashboard-entity-reference" && key === "card") scope = node.dashboard || "lovelace";
      node = node?.[key];
    }
    return scope;
  }
  async function sourceMaps(editor, config, dashboard = activeDashboard()) {
    const state = bindingState(editor);
    const scopes = scopesFor(config, dashboard);
    await Promise.all([...scopes].map(async ([scope, roles]) => {
      if (scope === activeDashboard()) {
        const local = indexEntities(editor.lovelace || controller()?.config || {});
        for (const [k, v] of indexEntities(editor.value || editor._config || {})) local.set(k, v);
        if ([...roles].every(k => local.get(k))) { state.maps.set(scope, local); return; }
      }
      if (state.maps.has(scope) && [...roles].every(k => state.maps.get(scope).get(k))) return;
      if (!state.jobs.has(scope)) {
        state.jobs.set(scope, (async () => {
          if (typeof editor.hass?.callWS !== "function") throw Error(`Cannot read entity sources from ${scope}.`);
          const paths = scope === "lovelace" ? ["lovelace", null] : [scope];
          let data;
          for (const path of paths) {
            try { data = dashboardData(await editor.hass.callWS({ type: "lovelace/config", url_path: path, force: false })); break; }
            catch (e) { if (path === paths.at(-1) || !["not_found", "config_not_found"].includes(e?.code)) throw e; }
          }
          if (!data) throw Error(`No dashboard configuration returned for ${scope}.`);
          const map = indexEntities(data); state.maps.set(scope, map); return map;
        })());
      }
      try { await state.jobs.get(scope); } finally { state.jobs.delete(scope); }
      const missing = [...roles].filter(k => !state.maps.get(scope)?.get(k));
      if (missing.length) throw Error(`Missing or ambiguous entity sources in ${scope}: ${missing.join(", ")}.`);
    }));
    return state.maps;
  }
  function resolvedBindings(config, maps, dashboard = activeDashboard()) {
    function walk(v, scope) {
      if (typeof v === "string") return v.replace(TOKEN, (_, role) => {
        const id = maps.get(scope)?.get(role);
        if (!id) throw Error(`Cannot resolve ${role} in ${scope}.`);
        return id;
      });
      if (Array.isArray(v)) return v.map(x => walk(x, scope));
      if (!obj(v)) return v;
      const wrapper = v.type === "custom:dashboard-entity-reference";
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, wrapper && k === "card" ? v.dashboard || "lovelace" : scope)]));
    }
    return walk(config, dashboard);
  }
  // Three-way conversion preserves each original role when its resolved value
  // did not change. Only edits in a referenced card are reverse-mapped; normal
  // source-card entities and outer popup targets remain ordinary entity IDs.
  function referencedBindings(original, edited, maps, states = {}, dashboard = activeDashboard()) {
    function walk(o, e, scope, referenced = false, key = "", preferred = new Set()) {
      const r = resolvedBindings(o, maps, scope);
      if (equal(r, e)) return clone(o);
      if (typeof e === "string") {
        if (e.startsWith("data:") || (!referenced && !(typeof o === "string" && o.includes("[[entity:")))) return e;
        const sources = maps.get(scope);
        if (!sources) throw Error(`Entity sources for ${scope} are not loaded.`);
        const ownRoles = new Set(typeof o === "string" ? [...o.matchAll(TOKEN)].map(m => m[1]) : []);
        const hook = () => false;
        const choose = id => {
          let roles = [...sources].filter(([, value]) => value === id).map(([role]) => role);
          if (!roles.length) {
            if (!hook(id) && (states[id] || ((entityFields.has(key) || key.endsWith("_entity")) && entityID.test(e)))) {
              throw Error(`No source reference exists for ${id}. Add it to the source dashboard, save, and reopen this editor.`);
            }
            return id;
          }
          for (const preference of [ownRoles, preferred]) {
            const selected = roles.filter(role => preference.has(role));
            if (selected.length === 1) { roles = selected; break; }
          }
          if (roles.length !== 1) throw Error(`Several source labels refer to ${id}: ${roles.join(", ")}. Use its existing source reference to disambiguate.`);
          return `[[entity:${roles[0]}]]`;
        };
        return e.replace(/\[\[entity:[^\]]+\]\]|[a-z_]+\.[a-z0-9_]+/g, (id, offset, text) => {
          if (id.startsWith("[[entity:")) {
            const role = id.slice(9, -2);
            if (!sources.get(role)) throw Error(`Unknown source reference: ${role}.`);
            return id;
          }
          if (/[A-Za-z0-9_.]/.test(text[offset - 1] || "") || /[A-Za-z0-9_.]/.test(text[offset + id.length] || "")) return id;
          return choose(id);
        });
      }
      if (Array.isArray(e)) {
        const old = Array.isArray(o) ? o : [];
        const resolved = resolvedBindings(old, maps, scope);
        const matches = matchArray(resolved, e);
        return e.map((x, i) => walk(matches.has(i) ? old[matches.get(i)] : undefined, x, scope, referenced, key, preferred));
      }
      if (!obj(e)) return e;
      const wrapper = e.type === "custom:dashboard-entity-reference";
      const out = Object.fromEntries(Object.entries(e).map(([k, x]) => {
        const childScope = wrapper && k === "card" ? e.dashboard || "lovelace" : scope;
        const roles = wrapper && k === "card" ? new Set([...JSON.stringify(o?.card || {}).matchAll(TOKEN)].map(m => m[1])) : preferred;
        return [k, walk(o?.[k], x, childScope, referenced || (wrapper && k === "card"), k, roles)];
      }));
      const roleSets = v => [...scopesFor(v, out.dashboard || "lovelace")].map(([s, roles]) => [s, [...roles].sort()]);
      if (wrapper && out.expected_domains) {
        const roles = [...scopesFor({ type: out.type, dashboard: out.dashboard, card: out.card }).values()].flatMap(x => [...x]);
        const domains = Object.fromEntries(roles.map(role => [role, maps.get(out.dashboard || "lovelace")?.get(role)?.split(".")[0]]));
        if (!equal(roleSets(o?.card), roleSets(out.card)) || roles.some(role => out.expected_domains[role] !== domains[role])) out.expected_domains = domains;
      }
      return out;
    }
    return walk(original, edited, dashboard);
  }
  // Keep HA's canonical value and preview tokenized. Replace ONLY the YAML
  // editor's defaultValue binding in the Lit template with a resolved copy.
  function yamlWorkingTemplate(template, value, result = { replaced: false }) {
    if (Array.isArray(template)) return template.map(x => yamlWorkingTemplate(x, value, result));
    if (!template?.strings || !Array.isArray(template.values)) return template;
    const values = template.values.map((x, i) => {
      if (/<ha-yaml-editor\b/.test(template.strings[i]) && /\.defaultValue=\s*$/.test(template.strings[i])) {
        result.replaced = true; return value;
      }
      return yamlWorkingTemplate(x, value, result);
    });
    return { ...template, values };
  }
  function installResolvedYAML(proto) {
    const render = proto.render, changed = proto._handleYAMLChanged;
    if (typeof render !== "function" || typeof changed !== "function") {
      console.warn("Dashboard Component Editor: resolved YAML support is unavailable for this HA frontend."); return;
    }
    proto.render = function (...args) {
      if (this.GUImode !== false || !scopesFor(this.value).size) return render.apply(this, args);
      const state = bindingState(this);
      let resolved;
      try { resolved = resolvedBindings(this.value, state.maps); }
      catch (_) {
        if (!state.loading && !state.loadError) {
          state.loading = true;
          sourceMaps(this, this.value).then(() => { state.loadError = null; }).catch(e => { state.loadError = e.message; }).finally(() => { state.loading = false; this.requestUpdate(); });
        }
        return state.loadError || "Resolving entity references for the YAML editor…";
      }
      const status = { replaced: false };
      const rendered = yamlWorkingTemplate(render.apply(this, args), resolved, status);
      if (!status.replaced) return "Resolved YAML editing is unavailable: the HA editor template has changed.";
      return [state.error || "", rendered];
    };
    proto._handleYAMLChanged = function (event) {
      const state = bindingState(this), edit = ++state.edit;
      if (!event.detail?.isValid || (!scopesFor(this.value).size && !scopesFor(event.detail.value).size)) {
        state.error = null; return changed.call(this, event);
      }
      const original = clone(this.value), working = clone(event.detail.value);
      const detail = event.detail;
      if (equal(working, state.lastDraft) && equal(original, state.lastLinked)) {
        state.error = null;
        return changed.call(this, { stopPropagation() { event.stopPropagation(); }, detail: { ...detail, isValid: true, value: clone(state.lastLinked) } });
      }
      // HA's normal invalid-input path disables Save until conversion succeeds.
      changed.call(this, { stopPropagation() { event.stopPropagation(); }, detail: { ...detail, isValid: false } });
      Promise.all([sourceMaps(this, original), sourceMaps(this, working)]).then(() => {
        if (state.edit !== edit || !this.isConnected) return;
        const linked = referencedBindings(original, working, state.maps, this.hass?.states);
        state.lastDraft = clone(working); state.lastLinked = clone(linked);
        state.error = null;
        changed.call(this, { stopPropagation() {}, detail: { ...detail, isValid: true, value: linked } });
        this.requestUpdate();
      }).catch(e => {
        if (state.edit !== edit || !this.isConnected) return;
        state.error = `Entity-reference edit was not applied: ${e.message}`;
        this.requestUpdate();
      });
    };
  }
  // The current dashboard controller is needed only for an explicit source-card
  // save. It preserves HA's storage/YAML behavior and current dashboard state.
  function controller() {
    function find(root) {
      const direct = root.querySelector("hui-root");
      if (direct?.lovelace) return direct.lovelace;
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) { const result = find(el.shadowRoot); if (result) return result; }
      }
      return null;
    }
    return find(document);
  }
  function insideAdapter(el) {
    if (el[BYPASS]) return true;
    for (let x = el; x; x = x.parentNode || x.host) {
      if (x.localName === TAG || x.localName === REFERENCE_EDITOR) return true;
    }
    return false;
  }
  const css = `
    :host{display:block;color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family,inherit)}
    .capsule{border:1px solid rgba(var(--rgb-primary-color,3,169,244),.23);background:rgba(var(--rgb-primary-color,3,169,244),.07);border-radius:14px;padding:12px;margin-bottom:16px}
    .heading{font-weight:600;margin-bottom:7px}.hint,.path{font-size:13px;line-height:1.5;color:var(--secondary-text-color);overflow-wrap:anywhere}
    select,input,textarea{box-sizing:border-box;font:inherit;color:inherit;background:var(--card-background-color,#fff);border:1px solid var(--divider-color,#aaa);border-radius:8px;width:100%;padding:10px;min-height:44px}
    select{margin:8px 0}button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--divider-color,#aaa);padding:9px 12px;background:var(--card-background-color,#fff);color:var(--primary-color,#039be5);min-height:42px}
    button:disabled{opacity:.5;cursor:default}.buttons{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}.status{font-size:13px;line-height:1.5;margin:8px 0;overflow-wrap:anywhere}.error{color:var(--error-color,#c00)}
    label{display:block}.hidden{display:none!important}#native{min-width:0}pre{white-space:pre-wrap;overflow-wrap:anywhere}textarea{font-family:monospace;min-height:280px;resize:vertical}
  `;
  class ComponentEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._selected = [];
      this._serial = 0;
      this._edited = false;
      this.shadowRoot.innerHTML = `<style>${css}</style><div class="capsule"><div class="heading">Edit component</div><label><span class="hint">Select a card inside this stack, wrapper, tab, or popup.</span><select aria-label="Component"></select></label><div class="path"></div><div class="hint">Styling, layout metadata &amp; entity bindings are preserved. Use the editor below, then the dialog’s Save button.</div><div class="buttons"><button id="mode" type="button">Show component YAML</button><button id="back" type="button" class="hidden">Back to reference</button><button id="save-source" type="button" class="hidden">Save source card</button></div><div id="source-hint" class="hint hidden">Source edits are saved separately with “Save source card”.</div></div><div class="status" role="status" aria-live="polite"></div><div id="refs" class="buttons"></div><div id="native"></div>`;
      this._select = this.shadowRoot.querySelector("select");
      this._body = this.shadowRoot.querySelector("#native");
      this._select.addEventListener("change", () => {
        this._selected = JSON.parse(this._select.value);
        this._mount();
      });
      this.shadowRoot.querySelector("#mode").addEventListener("click", () => {
        if (this._native?.toggleMode) {
          this._native.toggleMode();
          this._modeLabel();
        }
      });
      this.shadowRoot.querySelector("#back").addEventListener("click", () => {
        if (this._sourceDirty && !window.confirm("Discard unsaved source-card edits?")) return;
        this._source = null; this._sourceDirty = false; this._selected = []; this._refresh(true);
      });
      this.shadowRoot.querySelector("#save-source").addEventListener("click", () => this._saveSource());
      // Native editors can emit config-changed just from setConfig(). Do not
      // propagate anything until the user actually interacts with that editor.
      for (const name of ["input", "change", "pointerdown", "keydown", "click"]) {
        this._body.addEventListener(name, e => { if (e.isTrusted) this._edited = true; }, true);
      }
    }
    set hass(value) { this._hass = value; if (this._native) this._native.hass = value; }
    get hass() { return this._hass; }
    set lovelace(value) { this._lovelace = value; this._entities = null; }
    get lovelace() { return this._lovelace; }
    setConfig(config) {
      if (!obj(config) || typeof config.type !== "string") throw Error("A card configuration is required.");
      const changed = !equal(config, this._config);
      this._config = clone(config);
      if (!this._source && changed) this._refresh(!this._native);
    }
    _root() { return this._source ? this._source.working : this._config; }
    _status(message = "", error = false) {
      const el = this.shadowRoot.querySelector(".status");
      el.textContent = message; el.classList.toggle("error", error);
    }
    _refresh(remount = false) {
      const list = components(this._root());
      if (!list.some(x => equal(x.path, this._selected))) { this._selected = []; remount = true; }
      this._select.replaceChildren(...list.map(x => {
        const opt = document.createElement("option"); opt.value = JSON.stringify(x.path); opt.textContent = x.label; return opt;
      }));
      this._select.value = JSON.stringify(this._selected);
      for (const id of ["back", "save-source", "source-hint"]) this.shadowRoot.querySelector(`#${id}`).classList.toggle("hidden", !this._source);
      this.shadowRoot.querySelector("#save-source").disabled = !this._sourceDirty || !!this._sourceSaving;
      if (remount) this._mount();
    }
    async _mount() {
      const serial = ++this._serial;
      this._body.replaceChildren(); this._native = null; this._edited = false;
      this._status();
      const original = at(this._root(), this._selected);
      if (!obj(original)) return;
      this._original = clone(original);
      const all = this._lovelace || controller()?.config || this._config;
      if (!this._entities) {
        this._entities = indexEntities(all);
        // Unsaved source-entity edits in the current parent take precedence
        // over the dashboard's stored values while this dialog remains open.
        for (const [key, value] of indexEntities(this._config)) this._entities.set(key, value);
        if (this._source) for (const [key, value] of indexEntities(this._source.working)) this._entities.set(key, value);
      }
      this._delegated = referenceEditorOwns(original);
      let temp;
      try {
        if (this._delegated) temp = { clean: clone(original), unresolved: [] };
        else {
          const scope = scopeAtPath(this._root(), this._selected);
          if (scopesFor(original, scope).size) {
            const maps = await sourceMaps(this, this._root());
            if (serial !== this._serial) return;
            temp = prepare(resolvedBindings(original, maps, scope), new Map());
          } else temp = prepare(original, this._entities);
        }
      } catch (e) { if (serial === this._serial) this._status(`Cannot load component entity sources: ${e.message}`, true); return; }
      this._clean = temp.clean;
      this.shadowRoot.querySelector(".path").textContent = this._source ? `Source: ${this._source.id} · ${this._selected.join(" / ") || "whole card"}` : this._selected.join(" / ") || "Whole card";
      this._references(original);
      // Pure containers have no editor themselves; selection exposes their
      // children. Still allow the original YAML through the normal dialog.
      try {
        await customElements.whenDefined("hui-card-element-editor");
        if (serial !== this._serial) return;
        const editor = document.createElement("hui-card-element-editor");
        editor[BYPASS] = true;
        editor.hass = this._hass;
        editor.lovelace = this._lovelace;
        editor.context = this.context;
        editor.inDialog = false;
        editor.value = clone(temp.clean);
        editor.addEventListener("config-changed", e => {
          e.stopPropagation();
          if (serial !== this._serial) return;
          this._modeLabel();
          if (e.detail.error) { this._status(e.detail.error, true); return; }
          if (this._edited && e.detail.config) this._change(e.detail.config);
        });
        editor.addEventListener("GUImode-changed", e => { e.stopPropagation(); this._modeLabel(); });
        this._native = editor;
        this._body.append(editor);
        if (temp.unresolved.length) this._status(`Unresolved entity bindings: ${temp.unresolved.join(", ")}. Those bindings will be kept intact.`, true);
      } catch (e) { this._status(`Could not load the component editor: ${e.message}`, true); }
    }
    _modeLabel() {
      this.shadowRoot.querySelector("#mode").textContent = this._native?.GUImode === false ? "Show component visual editor" : "Show component YAML";
    }
    _change(config) {
      // Invalid or initializing editor events never replace the parent card.
      if (!obj(config) || config.type !== this._clean.type) return;
      try {
        const locked = [];
        const restored = this._delegated ? clone(config) : restore(this._original, this._clean, config, locked);
        if (this._delegated) {
          for (const key of PROTECTED) {
            if (Object.hasOwn(this._original, key)) restored[key] = clone(this._original[key]);
          }
        }
        const next = put(this._root(), this._selected, restored);
        if (locked.length) this._status("Entity bindings are preserved. Change the linked entity on its source card instead.");
        else this._status(this._source ? "Source changes are pending. Use Save source card." : "Component changes are ready. Use the dialog’s Save button.");
        if (equal(next, this._root())) return;
        this._entities = null;
        if (this._source) {
          this._source.working = next;
          this._sourceDirty = !equal(next, this._source.original);
          this.shadowRoot.querySelector("#save-source").disabled = !this._sourceDirty || !!this._sourceSaving;
        } else {
          this._config = next;
          this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: clone(next) }, bubbles: true, composed: true }));
        }
      } catch (e) { this._status(e.message, true); }
    }
    _references(card) {
      const el = this.shadowRoot.querySelector("#refs"); el.replaceChildren();
      if (card.type !== "custom:dashboard-card-reference") return;
      const ids = card.card_ids || (card.card_id ? [card.card_id] : []);
      for (const id of ids) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = `Edit source: ${id}`;
        button.addEventListener("click", () => this._openSource(id, card.dashboard)); el.append(button);
      }
    }
    _openSource(id, dashboard) {
      const activePath = location.pathname.split("/").filter(Boolean)[0];
      const currentDashboard = !dashboard || dashboard === activePath;
      // An in-card source must be edited as part of the same parent transaction.
      const local = currentDashboard ? sourceCards(this._config, id) : [];
      if (local.length === 1) { this._selected = local[0].path; this._source = null; this._refresh(true); return; }
      const ll = controller();
      if (!ll || !currentDashboard) {
        this._status(`Open the ${dashboard || "source"} dashboard and edit the card with card_reference_id: ${id}. Source editing here is limited to the current dashboard.`, true); return;
      }
      const matches = sourceCards(ll.config, id);
      if (matches.length !== 1) { this._status(`Source “${id}” has ${matches.length} matches. A unique source is required.`, true); return; }
      const hit = matches[0];
      this._source = { id, path: hit.path, original: clone(hit.card), working: clone(hit.card), dashboardConfig: ll.config };
      this._sourceDirty = false; this._selected = []; this._lovelace = ll.config; this._entities = null; this._refresh(true);
    }
    async _saveSource() {
      const source = this._source, ll = controller();
      if (!source || !this._sourceDirty || this._sourceSaving || !ll) return;
      if (ll.mode !== "storage") { this._status("This dashboard uses YAML mode. Save source edits in its YAML file.", true); return; }
      const hits = sourceCards(ll.config, source.id);
      if (hits.length !== 1 || !equal(hits[0].card, source.original)) {
        this._status("The source card changed while you were editing. Reopen it before saving so no newer changes are overwritten.", true); return;
      }
      const button = this.shadowRoot.querySelector("#save-source"); button.disabled = true;
      const submitted = clone(source.working);
      this._sourceSaving = true;
      try {
        await ll.saveConfig(put(ll.config, hits[0].path, submitted));
        source.original = clone(submitted);
        if (this._source !== source) return;
        this._sourceDirty = !equal(source.working, submitted);
        this._lovelace = ll.config; this._entities = null;
        this._status(this._sourceDirty ? "Source card saved. Newer edits are still pending." : "Source card saved. Its references use the updated source.");
      } catch (e) { this._status(`Source was not saved: ${e.message}`, true); }
      finally { this._sourceSaving = false; button.disabled = !this._sourceDirty; }
    }
  }
  customElements.define(TAG, ComponentEditor);
  // Wait for lazy-loaded HA editors without a document-wide observer or timer.
  customElements.whenDefined("hui-card-element-editor").then(() => {
    const proto = customElements.get("hui-card-element-editor").prototype;
    if (typeof proto.getConfigElement !== "function") {
      console.warn("Dashboard Component Editor: HA editor API is unavailable; leaving the standard editor unchanged."); return;
    }
    const native = proto.getConfigElement;
    installResolvedYAML(proto);
    proto.getConfigElement = async function (...args) {
      if (insideAdapter(this) || referenceEditorOwns(this.value)) return native.apply(this, args);
      return document.createElement(TAG);
    };
  });
  window.DashboardComponentEditor = Object.freeze({ version: VERSION, prepare, restore, components, indexEntities, sourceCards, equal, resolvedBindings, referencedBindings, yamlWorkingTemplate });
  console.info(`Dashboard Component Editor ${VERSION} loaded`);
})();

}
