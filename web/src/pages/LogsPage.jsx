import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import { formatBytes } from '../lib/utils.js';

export default function LogsPage() {
  const { data: sources = {} } = useQuery({ queryKey: ['logs'], queryFn: () => api.get('/api/logs') });
  const [selected, setSelected] = useState(null);
  const [content, setContent]   = useState('');

  async function open({ source, name }) {
    setSelected({ source, name });
    const text = await fetch(`/api/logs/${source}/${name}`, { credentials: 'include' }).then((r) => r.text()).catch(() => '');
    setContent(text);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Log Viewer</h1>
      <div className="grid grid-cols-3 gap-4 h-[600px]">
        <Card className="overflow-auto">
          <CardContent className="p-0">
            {Object.entries(sources).map(([src, logs]) => (
              <div key={src}>
                <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted">{src}</p>
                {(logs ?? []).map((l) => (
                  <button
                    key={l.name}
                    onClick={() => open({ source: src, name: l.name })}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-accent flex justify-between ${selected?.name === l.name ? 'bg-accent' : ''}`}
                  >
                    <span className="truncate">{l.name}</span>
                    <span className="text-muted-foreground ml-2">{formatBytes(l.size)}</span>
                  </button>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="col-span-2">
          <CardContent className="p-0 h-full">
            <pre className="h-full overflow-y-auto bg-gray-950 text-green-400 text-xs font-mono p-3 whitespace-pre-wrap">
              {content || (selected ? 'Empty.' : 'Select a log file from the sidebar.')}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
