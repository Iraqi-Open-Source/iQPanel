import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlayUfwOnUnits, parseUfwStatus } from '../agent/actions/systemd.js';

test('parseUfwStatus reads ufw verbose/plain status lines', () => {
  assert.equal(parseUfwStatus('Status: active\nLogging: on (low)\n'), true);
  assert.equal(parseUfwStatus('Status: inactive\n'), false);
  assert.equal(parseUfwStatus('ERROR: You need to be root\n'), null);
});

test('overlayUfwOnUnits marks oneshot-dead ufw.service active when firewall is on', () => {
  const units = [
    { unit: 'nginx.service', load: 'loaded', active: 'active', sub: 'running', description: 'nginx' },
    { unit: 'ufw.service', load: 'loaded', active: 'inactive', sub: 'dead', description: 'Uncomplicated firewall' },
  ];
  const out = overlayUfwOnUnits(units, true);
  const ufw = out.find((s) => s.unit === 'ufw.service');
  assert.equal(ufw.active, 'active');
  assert.equal(ufw.ActiveState, 'active');
  assert.equal(ufw.sub, 'exited');
  assert.equal(out.find((s) => s.unit === 'nginx.service').active, 'active');
});

test('overlayUfwOnUnits injects ufw.service when firewall is active but unit is missing', () => {
  const out = overlayUfwOnUnits([{ unit: 'nginx.service', active: 'active' }], true);
  const ufw = out.find((s) => s.unit === 'ufw.service');
  assert.ok(ufw);
  assert.equal(ufw.active, 'active');
});

test('overlayUfwOnUnits leaves units unchanged when ufw state is unknown', () => {
  const units = [{ unit: 'ufw.service', active: 'inactive', sub: 'dead' }];
  assert.deepEqual(overlayUfwOnUnits(units, null), units);
});
