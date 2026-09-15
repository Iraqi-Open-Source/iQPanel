import { invoke } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';
import { auditLog } from '../../domain/audit.js';
import { panelPort } from '../../domain/ports.js';
import { classifyTarget, parseUfwOutput } from '../../../agent/actions/firewall.js';

function panel() {
  return panelPort() ?? (Number(process.env.PANEL_PORT) || 4173);
}

function sensitiveForBody(body = {}, extra = {}) {
  return classifyTarget({
    port: body.port,
    to: extra.to ?? body.to ?? '',
    comment: extra.comment ?? body.comment ?? '',
    panelPort: panel(),
  });
}

function confirmRequired(res, reason) {
  return res.status(409).json({
    error: reason.message,
    code: 'confirm',
    sensitive: reason,
  });
}

function hasConfirm(body) {
  return body?.confirm === true || body?.confirm === 'true' || body?.confirm === 1;
}

function hasSshAllow(rules = []) {
  return rules.some((r) => {
    if (r.action !== 'ALLOW') return false;
    const ports = r.ports ?? [];
    const hay = `${r.to ?? ''} ${r.comment ?? ''}`;
    return ports.includes(22) || /\b(ssh|openssh)\b/i.test(hay);
  });
}

async function currentRules() {
  const status = await invoke('fw.status', { panelPort: panel() });
  return Array.isArray(status?.rules) ? status.rules : (parseUfwOutput(status?.output ?? '').rules);
}

export function registerFirewall(app) {
  app.get('/api/firewall/status', requireAuth, async (req, res) => {
    try {
      const status = await invoke('fw.status', { panelPort: panel() });
      res.json({ ...status, panel_port: panel() });
    } catch {
      res.json({
        active: null, logging: null, defaults: {}, rules: [], output: '',
        panel_port: panel(), error: 'ufw not available',
      });
    }
  });

  app.get('/api/firewall/listeners', requireAuth, async (req, res) => {
    try {
      const rows = await invoke('fw.listeners');
      res.json(Array.isArray(rows) ? rows : []);
    } catch {
      res.json([]);
    }
  });

  app.post('/api/firewall/allow', requireAuth, rbac('admin'), async (req, res) => {
    try {
      const result = await invoke('fw.allow', req.body ?? {});
      auditLog(req, 'fw.allow', `${req.body?.port}/${req.body?.proto ?? 'tcp'}`);
      res.json(result);
    } catch (e) {
      res.status(422).json({ error: e.message });
    }
  });

  app.post('/api/firewall/deny', requireAuth, rbac('admin'), async (req, res) => {
    try {
      const reason = sensitiveForBody(req.body ?? {});
      if (reason && !hasConfirm(req.body)) return confirmRequired(res, reason);
      const result = await invoke('fw.deny', req.body ?? {});
      auditLog(req, 'fw.deny', `${req.body?.port}/${req.body?.proto ?? 'tcp'}`, reason ? { sensitive: reason.id } : {});
      res.json(result);
    } catch (e) {
      res.status(422).json({ error: e.message });
    }
  });

  app.delete('/api/firewall/rule', requireAuth, rbac('admin'), async (req, res) => {
    try {
      const body = req.body ?? {};
      if (body.number != null && !hasConfirm(body)) {
        const rules = await currentRules();
        const rule = rules.find((r) => r.number === Number(body.number));
        if (rule && String(rule.action).toUpperCase() === 'ALLOW') {
          const reason = classifyTarget({ to: rule.to, comment: rule.comment, panelPort: panel() });
          if (reason) return confirmRequired(res, reason);
        }
      } else if (body.port != null && !hasConfirm(body)) {
        const reason = sensitiveForBody(body);
        if (reason) return confirmRequired(res, reason);
      }
      const result = await invoke('fw.delete', body);
      auditLog(req, 'fw.delete', body.number != null ? String(body.number) : `${body.port}/${body.proto ?? 'tcp'}`);
      res.json(result);
    } catch (e) {
      res.status(422).json({ error: e.message });
    }
  });

  app.post('/api/firewall/enable', requireAuth, rbac('admin'), async (req, res) => {
    try {
      const rules = await currentRules().catch(() => []);
      if (!hasSshAllow(rules) && !hasConfirm(req.body)) {
        return confirmRequired(res, {
          id: 'enable-no-ssh',
          label: 'SSH',
          level: 'critical',
          title: 'Enable firewall without SSH access',
          message: 'UFW has no allow rule for SSH (port 22). Enabling a default-deny firewall can lock you out of this server.',
        });
      }
      const result = await invoke('fw.enable');
      auditLog(req, 'fw.enable', '');
      res.json(result);
    } catch (e) {
      res.status(422).json({ error: e.message });
    }
  });

  app.post('/api/firewall/disable', requireAuth, rbac('admin'), async (req, res) => {
    try {
      if (!hasConfirm(req.body)) {
        return confirmRequired(res, {
          id: 'disable',
          label: 'Firewall',
          level: 'critical',
          title: 'Disable the firewall',
          message: 'Disabling UFW opens every port on this server. Only continue if you understand the exposure.',
        });
      }
      const result = await invoke('fw.disable');
      auditLog(req, 'fw.disable', '');
      res.json(result);
    } catch (e) {
      res.status(422).json({ error: e.message });
    }
  });

  app.post('/api/firewall/default', requireAuth, rbac('admin'), async (req, res) => {
    try {
      const direction = String(req.body?.direction ?? '').toLowerCase();
      const policy = String(req.body?.policy ?? '').toLowerCase();
      if (direction === 'incoming' && policy === 'deny' && !hasConfirm(req.body)) {
        const rules = await currentRules().catch(() => []);
        if (!hasSshAllow(rules)) {
          return confirmRequired(res, {
            id: 'default-deny-no-ssh',
            label: 'SSH',
            level: 'critical',
            title: 'Default deny without SSH',
            message: 'Setting incoming traffic to deny with no SSH allow rule can lock you out of this server.',
          });
        }
        return confirmRequired(res, {
          id: 'default-deny',
          label: 'Incoming',
          level: 'high',
          title: 'Default deny incoming traffic',
          message: 'New incoming connections will be blocked unless a matching allow rule exists. Confirm SSH and the panel port stay allowed.',
        });
      }
      const result = await invoke('fw.default', req.body ?? {});
      auditLog(req, 'fw.default', `${direction}:${policy}`);
      res.json(result);
    } catch (e) {
      res.status(422).json({ error: e.message });
    }
  });
}
