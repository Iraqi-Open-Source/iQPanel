import React, { useState } from 'react';
import { postSSE, sseMessage } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';

const COMMON_PACKAGES = [
  'nginx', 'apache2', 'mysql-server', 'mariadb-server', 'postgresql',
  'redis-server', 'docker.io', 'certbot', 'composer', 'git', 'ufw',
];

export default function PackagesPage() {
  const [name, setName]     = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  async function install(pkg) {
    const p = pkg || name;
    if (!p) return;
    setLoading(true); setOutput('');
    try {
      await postSSE('/api/packages/install', { name: p }, {
        stdout: (d) => setOutput((o) => o + (d.line ?? '')),
        stderr: (d) => setOutput((o) => o + (d.line ?? '')),
        error:  (d) => setOutput((o) => o + `Error: ${sseMessage(d)}`),
      });
    } catch (e) {
      setOutput((o) => o + `Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Package Manager</h1>
      <Card>
        <CardHeader><CardTitle>Install package</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="package-name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button onClick={() => install()} loading={loading}>Install</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {COMMON_PACKAGES.map((p) => (
              <Button key={p} size="sm" variant="outline" onClick={() => install(p)}>{p}</Button>
            ))}
          </div>
        </CardContent>
      </Card>
      {output && (
        <Card>
          <CardContent className="p-0">
            <pre className="h-64 overflow-y-auto bg-gray-950 text-green-400 font-mono text-xs p-3 rounded-lg">{output}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
