'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Hub pin exports', () => {
  it('resolves bulkSecurityAdvisory and operatorAdminToken on this pin', () => {
    const ghsa = require('@fabric/hub/functions/bulkSecurityAdvisory');
    const admin = require('@fabric/hub/functions/operatorAdminToken');
    const local = require('../../functions/bulkSecurityAdvisory');
    assert.strictEqual(typeof ghsa.looksLikeBulkSecurityAdvisory, 'function');
    assert.strictEqual(typeof admin.isOperatorAdminToken, 'function');
    assert.strictEqual(local.looksLikeBulkSecurityAdvisory, ghsa.looksLikeBulkSecurityAdvisory);
    assert.strictEqual(ghsa.looksLikeBulkSecurityAdvisory([
      { security_advisory: { ghsa_id: 'GHSA-aaaa-bbbb-cccc' } }
    ]), true);
    assert.strictEqual(ghsa.looksLikeBulkSecurityAdvisory({ name: 'readme.md' }), false);
  });
});
