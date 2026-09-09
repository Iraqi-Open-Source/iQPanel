import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, subscribeSSE } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';

const VERSIONS = ['7.4','8.0','8.1','8.2','8.3','8.4','8.5'];

export default function PHPPage() {
  const qc = useQueryClient();
  const { data: installed = {} } = useQuery({
    queryKey: ['php-versions'],
    queryFn:  () => api.get('/api/php/versions'),
    refetchInterval: 30_000,
  });
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(null);

  function install(v) {
    setLoading(v); setOutput('');
    const cleanup = subscribeSSE('/api/php/install', {
      stdout: (d) => setOutput((o) => o + d.line),
      stderr: (d) => setOutput((o) => o + d.line),
      done:   () => { cleanup(); setLoading(null); qc.invalidateQueries(['php-versions']); },
      error:  (d) => { setOutput((o) => o + `Error: ${d.message}`); cleanup(); setLoading(null); },
    });
    api.post('/api/php/install', { version: v }).catch(() => {});
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">PHP Versions</h1>
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {VERSIONS.map((v) => (
              <div key={v} className="rounded-lg border border-border p-3 text-center space-y-2">
                <p className="font-semibold">PHP {v}</p>
                <Badge variant={installed[v] ? 'success' : 'secondary'}>{installed[v] ? 'Installed' : 'Not installed'}</Badge>
                {!installed[v] && (
                  <Button size="sm" variant="outline" className="w-full" loading={loading === v} onClick={() => install(v)}>
                    Install
                  </Button>
                )}
              </div>
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
