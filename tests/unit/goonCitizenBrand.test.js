'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const {
  GOONCITIZEN_BRAND_PURPLE,
  GOONCITIZEN_BRAND_FOREGROUND,
  GOONCITIZEN_BRAND_LETTER,
  GOONCITIZEN_BRAND_TITLE
} = require('../../functions/goonCitizenBrand');
const { FABRIC_BRAND_PURPLE } = require('@fabric/http/functions/fabricBrand');

describe('goonCitizenBrand', () => {
  it('canonizes a white serif gc digraph on the Fabric purple field', () => {
    assert.equal(GOONCITIZEN_BRAND_LETTER, 'gc');
    assert.equal(GOONCITIZEN_BRAND_TITLE, 'GoonCitizen');
    assert.equal(GOONCITIZEN_BRAND_FOREGROUND, '#FFFFFF');
    assert.equal(GOONCITIZEN_BRAND_PURPLE, FABRIC_BRAND_PURPLE);
  });

  it('ships dashboard favicon assets for the digraph', () => {
    const assets = path.join(__dirname, '..', '..', 'assets');
    const svgPath = path.join(assets, 'favicon.svg');
    assert.ok(fs.existsSync(svgPath));
    assert.ok(fs.existsSync(path.join(assets, 'favicon.ico')));
    assert.ok(fs.existsSync(path.join(assets, 'icon.png')));
    const svg = fs.readFileSync(svgPath, 'utf8');
    assert.match(svg, /aria-label="GoonCitizen"/);
    assert.match(svg, /fill="#4C1D95"/);
    assert.match(svg, /<path fill="#FFFFFF"/);
  });
});
