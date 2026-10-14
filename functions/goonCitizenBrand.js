'use strict';

/**
 * @fileoverview Canonical GoonCitizen lettermark: serif lowercase **gc** (Arvo) in
 * white on the Fabric suite royal purple field. Used for desktop / Android /
 * dashboard icons.
 */

const {
  FABRIC_BRAND_PURPLE,
  FABRIC_BRAND_FOREGROUND
} = require('@fabric/http/functions/fabricBrand');

/** Same field as Fabric — suite purple. */
const GOONCITIZEN_BRAND_PURPLE = FABRIC_BRAND_PURPLE;

/** Lettermark foreground. */
const GOONCITIZEN_BRAND_FOREGROUND = FABRIC_BRAND_FOREGROUND;

/** Public letters shown in the mark. */
const GOONCITIZEN_BRAND_LETTER = 'gc';

/** SVG / a11y title. */
const GOONCITIZEN_BRAND_TITLE = 'GoonCitizen';

/**
 * Extra tracking between digraph glyphs (em units relative to font size 1000).
 * Slightly opens **gc** so the bowls do not fuse at favicon sizes.
 */
const GOONCITIZEN_BRAND_TRACKING_EM = 0.04;

module.exports = {
  GOONCITIZEN_BRAND_PURPLE,
  GOONCITIZEN_BRAND_FOREGROUND,
  GOONCITIZEN_BRAND_LETTER,
  GOONCITIZEN_BRAND_TITLE,
  GOONCITIZEN_BRAND_TRACKING_EM
};
