/**
 * Nginx vhost and PHP-FPM pool template builders.
 */

export function buildLaravelVhost({ slug, domain, port, phpVersion, siteUser }) {
  const listen = domain ? `${domain}` : `0.0.0.0:${port}`;
  const serverName = domain ?? `_`;
  const root = `/var/www/sites/${slug}/app/public`;
  const socket = `/run/php/php${phpVersion}-fpm-${slug}.sock`;

  return `server {
    listen ${domain ? '80' : port};
    server_name ${serverName};
    root ${root};
    index index.php;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    charset utf-8;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \\.php$ {
        fastcgi_pass unix:${socket};
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }

    access_log /var/log/nginx/${slug}-access.log;
    error_log  /var/log/nginx/${slug}-error.log;
}
`;
}

export function buildNginxVhost({ slug, type, domain, port, phpVersion, siteUser }) {
  if (type === 'php' || type === 'laravel') return buildLaravelVhost({ slug, domain, port, phpVersion, siteUser });

  const root = `/var/www/sites/${slug}/app`;
  const listen = domain ? '80' : port;

  if (type === 'static') {
    return `server {
    listen ${listen};
    server_name ${domain ?? '_'};
    root ${root};
    index index.html;
    location / { try_files $uri $uri/ =404; }
    access_log /var/log/nginx/${slug}-access.log;
    error_log  /var/log/nginx/${slug}-error.log;
}
`;
  }

  if (type === 'node') {
    return `server {
    listen ${listen};
    server_name ${domain ?? '_'};
    location / {
        proxy_pass http://127.0.0.1:${port ?? 3000};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    access_log /var/log/nginx/${slug}-access.log;
    error_log  /var/log/nginx/${slug}-error.log;
}
`;
  }

  return buildLaravelVhost({ slug, domain, port, phpVersion, siteUser });
}

export function buildPhpFpmPool({ slug, phpVersion, siteUser, directory }) {
  const socket = `/run/php/php${phpVersion}-fpm-${slug}.sock`;
  return `[${slug}]
user  = ${siteUser}
group = ${siteUser}
listen = ${socket}
listen.owner = www-data
listen.group = www-data
listen.mode  = 0660

pm = dynamic
pm.max_children      = 10
pm.start_servers     = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3
pm.max_requests      = 500

chdir = /

php_admin_value[disable_functions] = exec,passthru,shell_exec,system
php_admin_flag[allow_url_fopen]    = off

access.log = /var/log/nginx/${slug}-fpm-access.log
slowlog     = /var/log/nginx/${slug}-fpm-slow.log
`;
}

export function buildQueueWorkerUnit({ slug, phpVersion, siteUser, queue = 'default', tries = 3, timeout = 90 }) {
  return `[Unit]
Description=Laravel Queue Worker (${slug})
After=network.target

[Service]
User=${siteUser}
Group=${siteUser}
WorkingDirectory=/var/www/sites/${slug}/app
ExecStart=/usr/bin/php${phpVersion} artisan queue:work --sleep=3 --tries=${tries} --timeout=${timeout} --queue=${queue}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

export function buildHorizonUnit({ slug, phpVersion, siteUser }) {
  return `[Unit]
Description=Laravel Horizon (${slug})
After=network.target

[Service]
User=${siteUser}
Group=${siteUser}
WorkingDirectory=/var/www/sites/${slug}/app
ExecStart=/usr/bin/php${phpVersion} artisan horizon
ExecStop=/usr/bin/php${phpVersion} artisan horizon:terminate
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}
