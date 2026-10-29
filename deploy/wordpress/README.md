# WordPress on db3 Cloud

An image that runs a WordPress site as a db3 Cloud app. Pick **Use WordPress** in an app's
settings in Cloud, or point the app at this folder: repository `https://github.com/db3ai/framework`,
Dockerfile `deploy/wordpress/Dockerfile`, context `deploy/wordpress`, and this profile:

```json
{
	"name": "wordpress",
	"processes": [{ "name": "web", "kind": "web", "port": 8080, "health": "/_db3/health", "memoryMiB": 512 }],
	"database": { "engine": "mariadb" },
	"storage": { "disks": [{ "name": "wp-content", "sizeGiB": 5, "mountPath": "/var/www/html/wp-content" }] },
	"env": { "required": ["APP_ORIGIN", "WORDPRESS_ADMIN_EMAIL", "WORDPRESS_ADMIN_PASSWORD"] }
}
```

Before the first deploy, set `WORDPRESS_ADMIN_EMAIL` and `WORDPRESS_ADMIN_PASSWORD` in the
environment's Variables. The first start installs WordPress with that admin (user `admin`, or
`WORDPRESS_ADMIN_USER`; title from `WORDPRESS_TITLE`). Changing them later does nothing; change
the password in wp-admin.

## How it fits Cloud

- **Database**: `wp-config.php` reads the `DB_*` variables Cloud sets for the environment's MariaDB.
- **Storage**: only `wp-content` (uploads, themes, plugins) is on a disk, so Cloud's Storage
  browser shows the media library. WordPress itself comes from the image on every start, so a
  core update is a new image, and `DISALLOW_FILE_EDIT` turns off the theme and plugin editors.
- **Address and keys**: `WP_HOME` and `WP_SITEURL` follow `APP_ORIGIN`; the keys and salts are
  derived from the environment's `APP_KEY`. HTTPS ends at Cloudflare.
- **db3 plugin** (`db3.php`, a must-use plugin): answers `/_db3/health` for deploys, and writes
  field settings for WordPress's tables into `db3_tables` (`wp db3 fields`, run on every start),
  so Cloud's Database view shows posts, users and comments with labels, choices and links.

The container runs as user 1000 on port 8080, as every Cloud app does.

## Try it locally

```sh
docker network create wp
docker run -d --name mariadb --network wp -e MARIADB_ROOT_PASSWORD=root -e MARIADB_DATABASE=app -e MARIADB_USER=app -e MARIADB_PASSWORD=app mariadb:11.8
docker build -t db3-wordpress deploy/wordpress
docker run --rm --network wp -p 8080:8080 -e DB_HOST=mariadb -e DB_PASSWORD=app -e APP_KEY=local -e APP_ORIGIN=http://localhost:8080 \
	-e WORDPRESS_ADMIN_EMAIL=you@example.com -e WORDPRESS_ADMIN_PASSWORD=change-me-please db3-wordpress
```
