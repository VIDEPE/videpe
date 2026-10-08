# Small, standard web server (Alpine Linux = minimal base, ~50 MB)
FROM nginx:alpine
# Our build, served under /videpe/ (the same base path as vite.config.js)
COPY dist/ /usr/share/nginx/html/videpe/
# Web server config for running this image on its own (testing)
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf