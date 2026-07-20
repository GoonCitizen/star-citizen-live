const fs = require('fs');
const { Resvg } = require('@resvg/resvg-js');
const { figs } = require('./diagrams');
for (const f of figs) {
  const r = new Resvg(f.svg, { fitTo: { mode: 'width', value: f.w * 2 }, font: { loadSystemFonts: true } });
  const png = r.render().asPng();
  fs.writeFileSync(`fig-${f.name}.png`, png);
  console.log('fig-' + f.name + '.png', png.length, 'bytes');
}
