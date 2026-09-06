const fs = require('node:fs');
const path = require('node:path');

function renderTemplate(relative, vars) {
  const content = fs.readFileSync(path.join(__dirname, 'templates', relative), 'utf8');
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] == null ? '' : String(vars[key])));
}

module.exports = { renderTemplate };
