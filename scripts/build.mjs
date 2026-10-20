import {readFile,writeFile,mkdir} from 'node:fs/promises';
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
const modules=['runtime.js','reference-editor.js','component-editor.js'];
const header=`/* Dashboard References ${pkg.version} | MIT License | FortranFour */
if (window.DashboardReferences || customElements.get('dashboard-card-reference') || customElements.get('dashboard-entity-reference') || customElements.get('dashboard-reference-native-editor') || window.DashboardComponentEditor) {
  console.warn('Dashboard References: another copy or a legacy resource is already loaded. Remove duplicate resources and reload.');
} else {
  const params = new URL(import.meta.url).searchParams;
  window.DashboardReferences = Object.freeze({version: '${pkg.version}', options: Object.freeze({
    editors: params.get('editors') !== 'false', component_editor: params.get('component_editor') !== 'false'
  })});
`;
const contents=await Promise.all(modules.map(f=>readFile(new URL('../src/'+f,import.meta.url),'utf8')));
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
await writeFile(new URL('../dist/dashboard-references.js',import.meta.url),header+contents.join('\n\n')+'\n}\n');
console.log('Built dist/dashboard-references.js');
