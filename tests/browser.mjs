import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const bundle=await readFile(new URL('../dist/dashboard-references.js',import.meta.url),'utf8');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url.startsWith('/bundle')?'text/javascript':'text/html');res.end(req.url.startsWith('/bundle')?bundle:'<!doctype html><html><body></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true, ...(process.env.REFERENCE_TEST_CHROMIUM ? {executablePath:process.env.REFERENCE_TEST_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage']} : {})});
const page=await browser.newPage();
try {
 await page.goto(origin+'/lovelace/main');
 await page.evaluate(()=>{
  window.f={configs:{},calls:[],subscribers:[],events:{}};
  class Card extends HTMLElement{setConfig(c){this.config=structuredClone(c);this.textContent=c.name||c.entity||c.type;}getCardSize(){return 2;}}
  customElements.define('fixture-card',Card);
  class Native extends HTMLElement{setConfig(c){this.config=structuredClone(c);}}
  customElements.define('fixture-native-editor',Native);
  class Floor extends Card{static getConfigElement(){return document.createElement('fixture-native-editor');}}
  customElements.define('floor3dx-card',Floor);
  class HUI extends HTMLElement{
   getConfigElement(){return document.createElement('fixture-native-editor');}
   render(){return {strings:['<ha-yaml-editor .defaultValue=','></ha-yaml-editor>'],values:[this.value]};}
   _handleYAMLChanged(e){this.lastYAML=e.detail;} requestUpdate(){}
  }
  customElements.define('hui-card-element-editor',HUI);
  f.hass={states:{'light.garden':{},'light.replacement':{},'light.second':{}},connection:{subscribeEvents(cb){f.subscribers.push(cb);return Promise.resolve(()=>{});},addEventListener(name,cb){f.events[name]=cb;}},async callWS(m){f.calls.push(m);const v=f.configs[m.url_path??'lovelace'];if(!v)throw {code:'not_found'};return structuredClone(v);}};
  window.loadCardHelpers=async()=>({createCardElement(c){const el=document.createElement(c.type.startsWith('custom:')?c.type.slice(7):'fixture-card');el.setConfig(c);return el;}});
 });
 await page.addScriptTag({url:origin+'/bundle.js',type:'module'});
 await page.waitForFunction(()=>window.DashboardComponentEditor);
 const results=await page.evaluate(async()=>{
  const results=[],api=DashboardComponentEditor;
  const assert=(v,msg='Assertion failed')=>{if(!v)throw Error(msg);};
  const same=(a,b)=>assert(JSON.stringify(a)===JSON.stringify(b),JSON.stringify(a)+' != '+JSON.stringify(b));
  const wait=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
  const test=async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});}};
  const source=(entity='light.garden')=>({type:'entities',title:'Garden controls',card_reference_id:'garden',entities:[{entity,entity_reference_id:'garden_light'}]});
  const config=cards=>({views:[{cards}]});
  const fire=path=>f.subscribers.forEach(cb=>cb({data:{url_path:path}}));
  const reset=()=>{document.body.replaceChildren();f.configs={lovelace:config([source()])};fire('lovelace');};
  const whole=(extra={})=>({type:'custom:dashboard-card-reference',card_id:'garden',...extra});
  const entity=(extra={})=>({type:'custom:dashboard-entity-reference',card:{type:'tile',entity:'[[entity:garden_light]]'},...extra});
  const mount=async(cfg)=>{const c=document.createElement(cfg.type.slice(7));c.setConfig(cfg);c.hass=f.hass;document.body.append(c);await wait(()=>c._ready);return c;};
  await test('Picker registers both reference cards',()=>same(customCards.map(c=>c.type),['dashboard-card-reference','dashboard-entity-reference']));
  await test('Whole card preserves titles and source is not mutated',async()=>{reset();const c=await mount(whole());same(c._card.config.title,'Garden controls');assert(!c._card.config.card_reference_id);assert(!c._card.config.entities[0].entity_reference_id);assert(f.configs.lovelace.views[0].cards[0].card_reference_id==='garden');});
  await test('Opt-in heading stripping retains entity header toggle',async()=>{reset();same((await mount(whole({strip_heading:true})))._card.config.title,' ');});
  await test('Explicit source dashboard wins over same ID in active panel',async()=>{reset();f.configs.remote=config([source('light.second')]);const panel=document.createElement('ha-panel-lovelace');panel.lovelace={config:f.configs.lovelace};document.body.append(panel);same((await mount(whole({dashboard:'remote'})))._card.config.entities[0].entity,'light.second');});
  await test('Concurrent consumers deduplicate requests',async()=>{reset();const count=f.calls.length;await Promise.all([mount(whole()),mount(whole())]);same(f.calls.length-count,1);});
  await test('Entity fields and strings resolve',async()=>{reset();const c=await mount(entity({card:{type:'tile',entity:'[[entity:garden_light]]',name:'Status [[entity:garden_light]]'}}));same(c._card.config.entity,'light.garden');same(c._card.config.name,'Status light.garden');});
  await test('Domain mismatch is reported',async()=>{reset();assert((await mount(entity({expected_domains:{garden_light:'switch'}}))).shadowRoot.textContent.includes('expects switch'));});
  await test('Duplicate card IDs are reported',async()=>{reset();f.configs.lovelace=config([source(),source()]);assert((await mount(whole())).shadowRoot.textContent.includes('Duplicate card_reference_id'));});
  await test('Duplicate entity roles are reported',async()=>{reset();f.configs.lovelace.views[0].cards[0].entities.push({entity:'light.second',entity_reference_id:'garden_light'});assert((await mount(entity())).shadowRoot.textContent.includes('Duplicate entity reference'));});
  await test('Nested whole-card references cannot recurse',async()=>{reset();f.configs.lovelace=config([{type:'vertical-stack',card_reference_id:'garden',cards:[whole()]}]);assert((await mount(whole())).shadowRoot.textContent.includes('Nested whole-card references'));});
  await test('Deferred Browser Mod popup references survive all three actions',async()=>{
   for(const action of ['tap_action','hold_action','double_tap_action']){
    reset();const popup={action:'fire-dom-event',browser_mod:{service:'browser_mod.popup',data:{title:'Deferred',content:whole()}}};
    f.configs.lovelace=config([{...source(),[action]:popup}]);
    const c=await mount(whole());same(c._card.config[action],popup);
   }
  });
  await test('Entity-reference cards retain deferred popup references',async()=>{
   reset();const popup={action:'fire-dom-event',browser_mod:{service:'browser_mod.popup',data:{content:whole()}}};
   const c=await mount(entity({card:{type:'tile',entity:'[[entity:garden_light]]',tap_action:popup}}));
   same(c._card.config.entity,'light.garden');same(c._card.config.tap_action,popup);
  });
  await test('Popup exception does not admit immediately rendered siblings',async()=>{
   reset();f.configs.lovelace=config([{...source(),cards:[whole()],tap_action:{action:'fire-dom-event',browser_mod:{service:'browser_mod.popup',data:{content:whole()}}}}]);
   assert((await mount(whole())).shadowRoot.textContent.includes('Nested whole-card references'));
  });
  await test('Popup exception requires the recognized deferred action',async()=>{
   reset();f.configs.lovelace=config([{...source(),tap_action:{action:'none',browser_mod:{service:'browser_mod.popup',data:{content:whole()}}}}]);
   assert((await mount(whole())).shadowRoot.textContent.includes('Nested whole-card references'));
  });
  await test('Saved whole card refreshes while mounted',async()=>{reset();const c=await mount(whole());f.configs.lovelace.views[0].cards[0].title='Updated';fire('lovelace');await wait(()=>c._card?.config?.title==='Updated');});
  await test('Saved entity assignment refreshes while mounted',async()=>{reset();const c=await mount(entity());f.configs.lovelace.views[0].cards[0].entities[0].entity='light.replacement';fire('lovelace');await wait(()=>c._card?.config?.entity==='light.replacement');});
  await test('Unchanged save retains child instance',async()=>{reset();const c=await mount(whole()),child=c._card;fire('lovelace');await wait(()=>c._ready);assert(c._card===child);});
  await test('Reconnect refreshes source',async()=>{reset();const c=await mount(entity());f.configs.lovelace.views[0].cards[0].entities[0].entity='light.replacement';f.events.ready();await wait(()=>c._card?.config?.entity==='light.replacement');});
  await test('Reattached whole-card element refreshes',async()=>{reset();const c=await mount(whole());c.remove();f.configs.lovelace.views[0].cards[0].title='Reopened';fire('lovelace');document.body.append(c);await wait(()=>c._card?.config?.title==='Reopened');});
  await test('Built-in tabs switch without external tab dependencies',async()=>{reset();f.configs.lovelace.views[0].cards.push({type:'tile',card_reference_id:'second',entity:'light.second'});const c=await mount(whole({card_ids:['garden','second'],labels:['Garden','Other']}));await wait(()=>c._card.shadowRoot.querySelectorAll('button').length===2);const b=c._card.shadowRoot.querySelectorAll('button');same(b[1].textContent,'Other');b[1].click();same(b[1].getAttribute('aria-selected'),'true');});
  await test('Vertical layout uses built-in stack',async()=>{reset();f.configs.lovelace.views[0].cards.push({type:'tile',card_reference_id:'second',entity:'light.second'});const c=await mount(whole({card_ids:['garden','second'],layout:'vertical'}));same(c._card.config.type,'vertical-stack');same(c._card.config.cards.length,2);});
  await test('Native reference editor gets IDs and emits tokenized config',async()=>{reset();const ed=await customElements.get('dashboard-entity-reference').getConfigElement();ed.setConfig(entity({card:{type:'custom:floor3dx-card',entities:[{entity:'[[entity:garden_light]]'}]}}));ed.hass=f.hass;document.body.append(ed);await wait(()=>ed._native);same(ed._native.config.entities[0].entity,'light.garden');let saved;ed.addEventListener('config-changed',e=>saved=e.detail.config);ed._native.dispatchEvent(new CustomEvent('config-changed',{detail:{config:{...ed._native.config,title:'Edited'}},bubbles:true,composed:true}));await wait(()=>saved);same(saved.card.entities[0].entity,'[[entity:garden_light]]');same(saved.card.title,'Edited');});
  await test('Component discovery includes Forge inner card',()=>assert(api.components({type:'custom:uix-forge',element:{type:'tile'}}).some(c=>c.path.join('.')==='element')));
  await test('Component edits retain metadata, reference, y and booleans',()=>{const o={type:'tile',entity:'[[entity:garden_light]]',name:'Before',y:42,axis:'y',flag:true,card_mod:{style:'color:red'},card_reference_id:'x'};const temp=api.prepare(o,new Map([['garden_light','light.garden']]));same(api.restore(o,temp.clean,{...temp.clean,name:'After'}),{...o,name:'After'});});
  await test('YAML editor displays IDs and saves references',async()=>{reset();const cfg=entity({card:{type:'tile',entity:'[[entity:garden_light]]',name:'Before'}});const ed=document.createElement('hui-card-element-editor');ed.hass=f.hass;ed.value=cfg;ed.GUImode=false;document.body.append(ed);ed.render();await new Promise(r=>setTimeout(r,30));same(ed.render()[1].values[0].card.entity,'light.garden');ed._handleYAMLChanged({stopPropagation(){},detail:{isValid:true,value:{...cfg,card:{...cfg.card,entity:'light.garden',name:'After'}}}});await wait(()=>ed.lastYAML?.isValid===true);same(ed.lastYAML.value.card.entity,'[[entity:garden_light]]');same(ed.lastYAML.value.card.name,'After');});
  await test('Entity selection maps to another known role',()=>{const o=entity(),maps=new Map([['lovelace',new Map([['garden_light','light.garden'],['second_light','light.second']])]]);same(api.referencedBindings(o,{...o,card:{type:'tile',entity:'light.second'}},maps,f.hass.states).card.entity,'[[entity:second_light]]');});
  await test('Unregistered referenced entity cannot silently become literal',()=>{let failed=false;try{api.referencedBindings(entity(),entity({card:{type:'tile',entity:'light.replacement'}}),new Map([['lovelace',new Map([['garden_light','light.garden']])]]),f.hass.states);}catch(e){failed=e.message.includes('No source reference');}assert(failed);});
  await test('Invalid YAML uses native invalid-input path',()=>{const ed=document.createElement('hui-card-element-editor');ed.value={};ed._handleYAMLChanged({stopPropagation(){},detail:{isValid:false}});same(ed.lastYAML.isValid,false);});
  await test('Explicit source save preserves unrelated cards',async()=>{reset();const root=document.createElement('hui-root');let saves=0;const ll={mode:'storage',config:config([source(),{type:'tile',entity:'light.second',name:'Unrelated'}]),async saveConfig(next){saves++;this.config=next;}};root.lovelace=ll;document.body.append(root);const ed=document.createElement('dashboard-component-editor');ed.hass=f.hass;ed.setConfig(whole());document.body.append(ed);ed._openSource('garden','lovelace');ed._source.working.title='Edited source';ed._sourceDirty=true;await ed._saveSource();same(saves,1);same(ll.config.views[0].cards[0].title,'Edited source');same(ll.config.views[0].cards[1].name,'Unrelated');});
  await test('Conflicting source edit prevents overwrite',async()=>{reset();const root=document.createElement('hui-root');let saves=0;const ll={mode:'storage',config:config([source()]),async saveConfig(){saves++;}};root.lovelace=ll;document.body.append(root);const ed=document.createElement('dashboard-component-editor');ed.hass=f.hass;ed.setConfig(whole());document.body.append(ed);ed._openSource('garden','lovelace');ed._source.working.title='Attempted overwrite';ed._sourceDirty=true;ll.config.views[0].cards[0].title='Changed elsewhere';await ed._saveSource();same(saves,0);assert(ed.shadowRoot.textContent.includes('source card changed'));});
  await test('YAML-mode sources are not saved through storage controller',async()=>{reset();const root=document.createElement('hui-root');let saves=0;root.lovelace={mode:'yaml',config:config([source()]),async saveConfig(){saves++;}};document.body.append(root);const ed=document.createElement('dashboard-component-editor');ed.hass=f.hass;ed.setConfig(whole());document.body.append(ed);ed._openSource('garden','lovelace');ed._sourceDirty=true;await ed._saveSource();same(saves,0);assert(ed.shadowRoot.textContent.includes('YAML mode'));});
  await test('Cross-dashboard source editing directs user to source',async()=>{reset();const ed=document.createElement('dashboard-component-editor');ed.hass=f.hass;ed.setConfig(whole());document.body.append(ed);ed._openSource('garden','remote');assert(!ed._source);assert(ed.shadowRoot.textContent.includes('Open the remote dashboard'));});
  return results;
 });
 for(const r of results)console.log(`${r.pass?'PASS':'FAIL'} ${r.name}${r.error?'\n'+r.error:''}`);
 for(const [query,editor] of [['?editors=false',false],['?component_editor=false',true]]){
  const other=await browser.newPage();await other.goto(origin);await other.addScriptTag({url:origin+'/bundle.js'+query,type:'module'});await other.waitForFunction(()=>window.DashboardReferences);
  const s=await other.evaluate(()=>({runtime:!!customElements.get('dashboard-card-reference'),editor:!!customElements.get('dashboard-reference-native-editor'),component:!!window.DashboardComponentEditor}));
  if(!s.runtime||s.editor!==editor||s.component)throw Error('Feature flag failed '+query);
  console.log('PASS Feature flag '+query);await other.close();
 }
 await page.addScriptTag({url:origin+'/bundle.js?duplicate=1',type:'module'});console.log('PASS Duplicate-resource guard');
 const failures=results.filter(r=>!r.pass);console.log(`${results.length+3} browser checks; ${failures.length} failures`);if(failures.length)process.exitCode=1;
}finally{await browser.close();server.close();}
