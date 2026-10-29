<?php
/**
 * WordPress settings for db3 Cloud. Everything comes from the environment Cloud gives every app:
 * the database from DB_*, the address from APP_ORIGIN and the keys from APP_KEY, so the same image
 * runs any site and nothing secret lives in the files.
 */

/** Reads an environment variable, or the default when it is unset or empty. */
function db3_env( $name, $default = '' ) {
	$value = getenv( $name );
	return false === $value || '' === $value ? $default : $value;
}

define( 'DB_NAME', db3_env( 'DB_DATABASE', 'app' ) );
define( 'DB_USER', db3_env( 'DB_USER', 'app' ) );
define( 'DB_PASSWORD', db3_env( 'DB_PASSWORD' ) );
define( 'DB_HOST', db3_env( 'DB_HOST', 'mariadb' ) . ':' . db3_env( 'DB_PORT', '3306' ) );
define( 'DB_CHARSET', 'utf8mb4' );
define( 'DB_COLLATE', '' );

// Keys and salts come from the environment's APP_KEY, so every copy agrees and sign-ins survive deploys.
$db3_key = db3_env( 'APP_KEY' ) ?: bin2hex( random_bytes( 32 ) );
foreach ( array( 'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT' ) as $db3_name ) {
	define( $db3_name, hash_hmac( 'sha256', "wordpress:$db3_name", $db3_key ) );
}
unset( $db3_key, $db3_name );

$table_prefix = db3_env( 'WORDPRESS_TABLE_PREFIX', 'wp_' );

// Cloudflare ends HTTPS in front of the site and forwards plain HTTP through the tunnel.
$db3_visitor = json_decode( $_SERVER['HTTP_CF_VISITOR'] ?? '', true );
if ( 'https' === ( $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '' ) || 'https' === ( $db3_visitor['scheme'] ?? '' ) ) {
	$_SERVER['HTTPS'] = 'on';
}
unset( $db3_visitor );

$db3_origin = rtrim( db3_env( 'APP_ORIGIN' ), '/' );
if ( $db3_origin ) {
	define( 'WP_HOME', $db3_origin );
	define( 'WP_SITEURL', $db3_origin );
}
unset( $db3_origin );

// WordPress itself comes from the image on every start, so core updates arrive by deploying a new image.
define( 'WP_AUTO_UPDATE_CORE', false );
define( 'DISALLOW_FILE_EDIT', true );
define( 'FS_METHOD', 'direct' );
define( 'WP_DEBUG', filter_var( db3_env( 'WP_DEBUG', 'false' ), FILTER_VALIDATE_BOOLEAN ) );
define( 'WP_DEBUG_DISPLAY', false );

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
