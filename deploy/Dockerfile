# --- Fjelltoppene.no static site ---
# Tiny nginx image, ~7 MB. Serves index.html + assets.

FROM nginx:1.27-alpine

# Replace default nginx config with our tuned one (gzip + caching)
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the site into the web root
COPY index.html /usr/share/nginx/html/index.html
COPY logo.html  /usr/share/nginx/html/logo.html
COPY assets/    /usr/share/nginx/html/assets/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -q --spider http://localhost/ || exit 1
