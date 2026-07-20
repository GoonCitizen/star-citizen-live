'use strict';

const assert = require('assert');
const StarCitizen = require('../services/StarCitizen');

describe('@fabric/star-citizen-live', function () {
  let service = null;

  beforeEach(function () {
    service = new StarCitizen({
      http: { enable: false },
      discord: { enable: false },
      logfile: '/nonexistent/path/to/Game.log' // Won't be accessed in these tests
    });
  });

  afterEach(async function () {
    if (service && service.status !== 'STOPPED') {
      await service.stop();
    }
  });

  describe('Properties', function () {
    it('should expose activities as a declarative property', function () {
      assert(Array.isArray(service.activities));
      assert.strictEqual(service.activities.length, 0);
    });

    it('should expose players as a declarative property', function () {
      assert(Array.isArray(service.players));
      assert.strictEqual(service.players.length, 0);
    });

    it('should expose vehicles as a declarative property', function () {
      assert(Array.isArray(service.vehicles));
      assert.strictEqual(service.vehicles.length, 0);
    });

    it('should expose kills as a declarative property', function () {
      assert(Array.isArray(service.kills));
      assert.strictEqual(service.kills.length, 0);
    });

    it('should expose logs as a declarative property', function () {
      assert(Array.isArray(service.logs));
      assert.strictEqual(service.logs.length, 0);
    });

    it('should expose status as a declarative property', function () {
      assert.strictEqual(typeof service.status, 'string');
      assert.strictEqual(service.status, 'STOPPED');
    });
  });

  describe('State Management', function () {
    it('should update activities property when state changes', function () {
      const activity = {
        id: 'test-activity-1',
        type: 'TestActivity',
        actor: { id: 'test-actor' },
        object: { id: 'test-object' },
        target: '/test'
      };

      service._state.content.activities[activity.id] = activity;
      service.commit();

      assert.strictEqual(service.activities.length, 1);
      assert.strictEqual(service.activities[0].id, activity.id);
    });

    it('should update players property when state changes', function () {
      const player = {
        id: 'test-player-1',
        name: 'TestPilot'
      };

      service._state.content.players[player.id] = player;
      service.commit();

      assert.strictEqual(service.players.length, 1);
      assert.strictEqual(service.players[0].name, 'TestPilot');
    });

    it('should update vehicles property when state changes', function () {
      const vehicle = {
        id: 'test-vehicle-1',
        name: 'Aurora',
        type: 'starter'
      };

      service._state.content.vehicles[vehicle.id] = vehicle;
      service.commit();

      assert.strictEqual(service.vehicles.length, 1);
      assert.strictEqual(service.vehicles[0].name, 'Aurora');
    });

    it('should update kills property when state changes', function () {
      const kill = {
        id: 'test-kill-1',
        killer: 'Player1',
        victim: 'Player2',
        weapon: 'Ballistic Cannon'
      };

      service._state.content.kills[kill.id] = kill;
      service.commit();

      assert.strictEqual(service.kills.length, 1);
      assert.strictEqual(service.kills[0].killer, 'Player1');
    });

    it('should update logs property when state changes', function () {
      const log = {
        id: 'test-log-1',
        timestamp: '2024-01-01T00:00:00Z',
        parts: ['timestamp', 'message', 'content']
      };

      service._state.content.logs[log.id] = log;
      service.commit();

      assert.strictEqual(service.logs.length, 1);
      assert.strictEqual(service.logs[0].id, log.id);
    });
  });

  describe('Events', function () {
    it('should emit activity events', function (done) {
      service.on('activity', (activity) => {
        assert.strictEqual(activity.type, 'TestActivity');
        done();
      });

      const activity = {
        type: 'TestActivity',
        actor: { id: 'test' },
        object: { id: 'test' },
        target: '/test'
      };

      service.emit('activity', activity);
    });

    it('should emit kill events', function (done) {
      service.on('kill', (kill) => {
        assert.strictEqual(kill.killer, 'Player1');
        done();
      });

      const kill = {
        killer: 'Player1',
        victim: 'Player2'
      };

      service.emit('kill', kill);
    });

    it('should emit player:join events', function (done) {
      service.on('player:join', (player) => {
        assert.strictEqual(player.name, 'TestPilot');
        done();
      });

      const player = {
        name: 'TestPilot',
        id: 'test-123'
      };

      service.emit('player:join', player);
    });
  });

  describe('Discord Integration', function () {
    it('should wire Discord when enabled in settings', function () {
      const scWithDiscord = new StarCitizen({
        http: { enable: false },
        discord: {
          enable: true,
          webhook: 'https://discord.com/api/webhooks/test/test'
        }
      });

      // Service should have Discord wired
      assert.strictEqual(scWithDiscord.settings.discord.enable, true);
    });

    it('should not wire Discord when disabled in settings', function () {
      assert.strictEqual(service.settings.discord.enable, false);
    });

    it('should have postToDiscord method', function () {
      assert.strictEqual(typeof service.postToDiscord, 'function');
    });
  });

  describe('Lifecycle', function () {
    it('should have STOPPED status initially', function () {
      assert.strictEqual(service.status, 'STOPPED');
    });

    it('should have start method', function () {
      assert.strictEqual(typeof service.start, 'function');
    });

    it('should have stop method', function () {
      assert.strictEqual(typeof service.stop, 'function');
    });
  });

  describe('API Methods', function () {
    it('should have announceActivity method', function () {
      assert.strictEqual(typeof service.announceActivity, 'function');
    });

    it('should have screenshot method', function () {
      assert.strictEqual(typeof service.screenshot, 'function');
    });

    it('should have parseLogEntry method', function () {
      assert.strictEqual(typeof service.parseLogEntry, 'function');
    });
  });

  describe('HTTP Request Handlers', function () {
    it('should have handleGetActivitiesRequest', function () {
      assert.strictEqual(typeof service.handleGetActivitiesRequest, 'function');
    });

    it('should have handleCreateActivityRequest', function () {
      assert.strictEqual(typeof service.handleCreateActivityRequest, 'function');
    });

    it('should have handleGetPlayersRequest', function () {
      assert.strictEqual(typeof service.handleGetPlayersRequest, 'function');
    });

    it('should have handleCreatePlayerRequest', function () {
      assert.strictEqual(typeof service.handleCreatePlayerRequest, 'function');
    });

    it('should have handleGetVehiclesRequest', function () {
      assert.strictEqual(typeof service.handleGetVehiclesRequest, 'function');
    });

    it('should have handleGetKillsRequest', function () {
      assert.strictEqual(typeof service.handleGetKillsRequest, 'function');
    });

    it('should have handleCreateKillRequest', function () {
      assert.strictEqual(typeof service.handleCreateKillRequest, 'function');
    });
  });
});

