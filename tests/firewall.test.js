import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseUfwOutput, classifyTarget, extractPorts } from '../agent/actions/firewall.js';

const SAMPLE = `Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
[ 1] OpenSSH                    ALLOW IN    Anywhere
[ 2] 80/tcp                     ALLOW IN    Anywhere                   # HTTP
[ 3] 443/tcp                    DENY IN     Anywhere
[ 4] 22/tcp                     ALLOW IN    Anywhere                   # SSH
[ 5] OpenSSH (v6)               ALLOW IN    Anywhere (v6)
`;

describe('parseUfwOutput', () => {
  test('reads status, defaults, and numbered rules', () => {
    const parsed = parseUfwOutput(SAMPLE);
    assert.equal(parsed.active, true);
    assert.equal(parsed.defaults.incoming, 'deny');
    assert.equal(parsed.defaults.outgoing, 'allow');
    assert.equal(parsed.rules.length, 5);
    assert.equal(parsed.rules[0].to, 'OpenSSH');
    assert.equal(parsed.rules[0].action, 'ALLOW');
    assert.equal(parsed.rules[1].comment, 'HTTP');
    assert.equal(parsed.rules[2].action, 'DENY');
    assert.deepEqual(parsed.rules[3].ports, [22]);
    assert.equal(parsed.rules[4].ipv6, true);
  });

  test('inactive status has no rules', () => {
    const parsed = parseUfwOutput('Status: inactive\n');
    assert.equal(parsed.active, false);
    assert.equal(parsed.rules.length, 0);
  });
});

describe('classifyTarget', () => {
  test('flags SSH and OpenSSH as critical lockout risk', () => {
    const a = classifyTarget({ port: 22 });
    assert.equal(a.id, 'ssh');
    assert.equal(a.level, 'critical');
    const b = classifyTarget({ to: 'OpenSSH' });
    assert.equal(b.id, 'ssh');
  });

  test('flags panel port as critical', () => {
    const r = classifyTarget({ port: 4173, panelPort: 4173 });
    assert.equal(r.id, 'panel');
    assert.equal(r.level, 'critical');
  });

  test('flags HTTP and HTTPS', () => {
    assert.equal(classifyTarget({ port: 80 }).id, 'http');
    assert.equal(classifyTarget({ port: 443 }).id, 'https');
  });

  test('does not flag ordinary app ports', () => {
    assert.equal(classifyTarget({ port: 8080, panelPort: 4173 }), null);
  });
});

describe('extractPorts', () => {
  test('reads single and comma-separated ports', () => {
    assert.deepEqual(extractPorts('22/tcp'), [22]);
    assert.deepEqual(extractPorts('80,443/tcp'), [80, 443]);
  });
});
