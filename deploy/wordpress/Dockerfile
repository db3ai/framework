# WordPress for db3 Cloud: the official image, listening on 8080 as an unprivileged user, set up from
# the environment Cloud gives every app (DB_*, APP_ORIGIN, APP_KEY), with the db3 must-use plugin.
# Only wp-content is kept on a disk; WordPress itself comes from this image on every start.
FROM wordpress:7.1.4-php8.3-apache

ARG WP_CLI_VERSION=2.12.0
ARG WP_CLI_SHA512=be928f6b8ca1e8dfb9d2f4b75a13aa4aee0896f8a9a0a1c45cd5d2c98605e6172e6d014dda2e27f88c98befc16c040cbb2bd1bfa121510ea5cdf5f6a30fe8832

RUN curl -fsSL -o /usr/local/bin/wp "https://github.com/wp-cli/wp-cli/releases/download/v${WP_CLI_VERSION}/wp-cli-${WP_CLI_VERSION}.phar" \
	&& echo "${WP_CLI_SHA512}  /usr/local/bin/wp" | sha512sum -c - \
	&& chmod 755 /usr/local/bin/wp \
	&& sed -i 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf \
	&& sed -i 's/<VirtualHost \*:80>/<VirtualHost *:8080>/' /etc/apache2/sites-available/000-default.conf \
	&& echo 'ServerName localhost' > /etc/apache2/conf-enabled/db3-servername.conf \
	&& rm -f /usr/src/wordpress/wp-config-docker.php \
	&& chown 1000:1000 /var/www/html

COPY wp-config.php /usr/src/wordpress/wp-config.php
COPY db3.php /usr/src/db3/db3.php
COPY db3-wordpress /usr/local/bin/db3-wordpress

ENV WP_CLI_CACHE_DIR=/tmp/wp-cli
USER 1000:1000
EXPOSE 8080
CMD ["db3-wordpress"]
