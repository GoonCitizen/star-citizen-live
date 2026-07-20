'use strict';

const assert = require('assert');
const MissionManager = require('../services/MissionManager');
const Mission = require('../types/Mission');
const MissionApplication = require('../types/MissionApplication');

describe('@fabric/star-citizen-live Mission System', function () {
  let manager = null;

  beforeEach(function () {
    manager = new MissionManager({
      enableMusig2: true,
      autoApprove: false
    });
  });

  describe('Mission Creation', function () {
    it('should create a mission', async function () {
      const mission = await manager.createMission({
        title: 'Test Bounty',
        description: 'Eliminate target',
        type: 'bounty',
        reward: 50000,
        contract: { type: 'single' },
        issuer: 'test-issuer',
        expiresAt: Date.now() + 10000
      });

      assert(mission);
      assert.strictEqual(mission.title, 'Test Bounty');
      assert.strictEqual(mission.reward, 50000);
      assert.strictEqual(mission.status, 'open');
    });

    it('should add mission to state', async function () {
      await manager.createMission({
        title: 'Mission 1',
        type: 'cargo',
        reward: 10000,
        contract: { type: 'single' },
        issuer: 'test',
        expiresAt: Date.now() + 10000
      });

      assert.strictEqual(manager.missions.length, 1);
    });
  });

  describe('Mission Properties', function () {
    it('should check if mission is open', function () {
      const mission = new Mission({
        _id: 'test-123',
        status: 'open',
        expiresAt: Date.now() + 10000
      });

      assert(mission.isOpen());
      assert(!mission.isExpired());
    });

    it('should check if mission is expired', function () {
      const mission = new Mission({
        _id: 'test-456',
        status: 'open',
        expiresAt: Date.now() - 1000
      });

      assert(mission.isExpired());
      assert(!mission.isOpen());
    });

    it('should generate contract commitment', function () {
      const mission = new Mission({
        _id: 'test-789',
        title: 'Test',
        reward: 1000,
        type: 'bounty',
        expiresAt: Date.now() + 1000
      });

      const commitment = mission.generateContractCommitment();

      assert(commitment);
      assert.strictEqual(typeof commitment, 'string');
      assert.strictEqual(commitment.length, 64);
    });
  });

  describe('Mission Types', function () {
    it('should support single signature missions', async function () {
      const mission = await manager.createMission({
        title: 'Single Sig Mission',
        type: 'bounty',
        reward: 25000,
        contract: { type: 'single' },
        createdBy: 'test',
        expiresAt: Date.now() + 10000
      });

      // createMission returns a plain register record (not a Mission class instance).
      assert.strictEqual(mission.contract.type, 'single');
      const typed = new Mission(mission);
      assert(!typed.isMultisig());
      assert.strictEqual(typed.getRequiredSignatures(), 1);
    });

    it('should support multisig missions', async function () {
      const mission = await manager.createMission({
        title: 'Team Mission',
        type: 'escort',
        reward: 100000,
        contract: {
          type: 'multisig',
          requiredSignatures: 3,
          authorizedSigners: ['key1', 'key2', 'key3']
        },
        createdBy: 'test',
        expiresAt: Date.now() + 10000
      });

      assert.strictEqual(mission.contract.type, 'multisig');
      assert.strictEqual(mission.contract.requiredSignatures, 3);
      const typed = new Mission(mission);
      assert(typed.isMultisig());
      assert.strictEqual(typed.getRequiredSignatures(), 3);
    });
  });

  describe('Declarative API', function () {
    it('should expose missions array', async function () {
      assert(Array.isArray(manager.missions));
      assert.strictEqual(manager.missions.length, 0);

      await manager.createMission({
        title: 'API Test',
        type: 'cargo',
        reward: 5000,
        contract: { type: 'single' },
        issuer: 'test',
        expiresAt: Date.now() + 10000
      });

      assert.strictEqual(manager.missions.length, 1);
    });

    it('should expose applications array', function () {
      assert(Array.isArray(manager.applications));
      assert.strictEqual(manager.applications.length, 0);
    });

    it('should expose openMissions array', async function () {
      await manager.createMission({
        title: 'Open Mission',
        type: 'bounty',
        reward: 5000,
        contract: { type: 'single' },
        issuer: 'test',
        expiresAt: Date.now() + 10000
      });

      assert(Array.isArray(manager.openMissions));
      assert.strictEqual(manager.openMissions.length, 1);
    });
  });

  describe('Events', function () {
    it('should emit mission:created event', async function () {
      let emitted = false;

      manager.once('mission:created', (mission) => {
        assert(mission);
        emitted = true;
      });

      await manager.createMission({
        title: 'Event Test',
        type: 'cargo',
        reward: 5000,
        contract: { type: 'single' },
        issuer: 'test',
        expiresAt: Date.now() + 10000
      });

      assert(emitted, 'Event was not emitted');
    });
  });

  describe('Service Lifecycle', function () {
    it('should start successfully', async function () {
      let ready = false;
      manager.once('ready', () => { ready = true; });
      const ret = await manager.start();
      assert.strictEqual(ret, manager);
      assert(ready, 'ready event was not emitted');
    });

    it('should stop successfully', async function () {
      let stopped = false;
      manager.once('stopped', () => { stopped = true; });
      await manager.start();
      const ret = await manager.stop();
      assert.strictEqual(ret, manager);
      assert(stopped, 'stopped event was not emitted');
    });
  });
});

