// Renders a set of diagrams with both sebastianjs and mermaid-cli (real Chrome)
// and reports how far the resulting viewBoxes diverge. This is the calibration
// harness referenced by src/geometry/calibrate.js: run it after touching the
// geometry engine or the font registry.
//
//   node scripts/compare-chrome.mjs
//
// Both sides are pinned to htmlLabels:false and Open Sans so they measure the
// same thing; see README for why.
import { render } from '../src/index.js';
import { spawnMmdc } from './mmdc-wrapper.mjs';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const DIAGRAMS = {
  flowchart: 'graph TD; A[Start] --> B{Is it OK?}; B -- Yes --> C[Done]; B -- No --> A;',
  flowchartLR: 'flowchart LR\n  A[Order Received] --> B[Validate Payment]\n  B --> C{In Stock?}\n  C -->|Yes| D[Ship Order]\n  C -->|No| E[Backorder]\n  D --> F[Notify Customer]\n  E --> F',
  sequence: 'sequenceDiagram\n  participant Alice\n  participant Bob\n  Alice->>Bob: Hello Bob, how are you?\n  Bob-->>Alice: Great!\n  Alice-)Bob: See you later!',
  class: 'classDiagram\n  Animal <|-- Duck\n  Animal <|-- Fish\n  Animal : +int age\n  Animal : +String gender\n  Animal: +isMammal()\n  class Duck{\n    +String beakColor\n    +swim()\n  }',
  state: 'stateDiagram-v2\n  [*] --> Still\n  Still --> [*]\n  Still --> Moving\n  Moving --> Still\n  Moving --> Crash\n  Crash --> [*]',
  er: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE-ITEM : contains\n  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses',
};

const dir = mkdtempSync(join(tmpdir(), 'seb-'));
const cfg = { startOnLoad:false, securityLevel:'loose', htmlLabels:false,
  flowchart:{htmlLabels:false}, class:{htmlLabels:false},
  fontFamily:'Open Sans', themeVariables:{fontFamily:'Open Sans'} };
writeFileSync(join(dir,'cfg.json'), JSON.stringify(cfg));
writeFileSync(join(dir,'pptr.json'), JSON.stringify({args:['--no-sandbox','--disable-setuid-sandbox']}));

const vb = (svg) => {
  const d = new JSDOM(svg, { contentType:'image/svg+xml' }).window.document;
  const v = (d.documentElement.getAttribute('viewBox')||'').split(/\s+/).map(Number);
  return v.length === 4 ? v : null;
};

console.log('diagram         seb viewBox (w x h)        chrome viewBox (w x h)      Δw      Δh     Δw%');
for (const [name, def] of Object.entries(DIAGRAMS)) {
  let sebSvg, chromeSvg;
  try { sebSvg = await render(def, { mermaidConfig: { securityLevel: 'loose' } }); }
  catch (e) { console.log(`${name.padEnd(15)} SEB FAILED: ${e.message.split('\n')[0].slice(0,60)}`); continue; }
  try {
    writeFileSync(join(dir,'in.mmd'), def);
    await spawnMmdc(['-i',join(dir,'in.mmd'),'-o',join(dir,'out.svg'),
      '--puppeteerConfigFile',join(dir,'pptr.json'),'-c',join(dir,'cfg.json')], {stdio:['ignore','ignore','pipe']});
    chromeSvg = readFileSync(join(dir,'out.svg'),'utf8');
  } catch (e) { console.log(`${name.padEnd(15)} MMDC FAILED: ${e.message.split('\n')[0].slice(0,60)}`); continue; }
  const a = vb(sebSvg), b = vb(chromeSvg);
  if (!a || !b) { console.log(`${name.padEnd(15)} no viewBox (seb=${!!a} chrome=${!!b})`); continue; }
  const dw = a[2]-b[2], dh = a[3]-b[3];
  const pct = (100*Math.abs(dw)/b[2]).toFixed(2);
  console.log(`${name.padEnd(15)} ${a[2].toFixed(1).padStart(8)} x ${a[3].toFixed(1).padStart(8)}    ${b[2].toFixed(1).padStart(8)} x ${b[3].toFixed(1).padStart(8)}  ${dw.toFixed(2).padStart(7)} ${dh.toFixed(2).padStart(7)}  ${pct.padStart(6)}%`);
}
