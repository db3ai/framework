<?php
/**
 * Plugin Name: db3 Cloud
 * Description: Connects this site to db3 Cloud: a health check for deploys, and field settings that let Cloud's Database view show WordPress's tables as posts, users and comments with their links.
 * Version: 1.0.0
 *
 * A must-use plugin, shipped in the db3 WordPress image and copied into wp-content/mu-plugins on every start by db3-wordpress.
 */

defined( 'ABSPATH' ) || exit;

/** Bumped whenever the field settings below change, so sites rewrite them once. */
const DB3_FIELDS_VERSION = 1;

/** Where field settings live: the same table framework apps fill, read by Cloud's Database view. */
const DB3_FIELDS_TABLE = 'db3_tables';

/**
 * Field settings for WordPress's own tables, in the db3_tables format: a label, the columns that
 * name a row, and per column a label, a type, choices or the table it links to.
 *
 * @param string $prefix The site's table prefix, such as wp_.
 * @return array<string, array> Settings by table name.
 */
function db3_wordpress_fields( $prefix ) {
	$link    = static function ( $table, $label ) use ( $prefix ) {
		return array( 'label' => $label, 'type' => 'link', 'link' => array( 'table' => $prefix . $table ) );
	};
	$long    = static function ( $label ) {
		return array( 'label' => $label, 'type' => 'longText' );
	};
	$when    = static function ( $label ) {
		return array( 'label' => $label, 'type' => 'datetime' );
	};
	$open    = array( 'type' => 'choice', 'choices' => array( 'open', 'closed' ) );
	$meta    = static function ( $owner_table, $owner_column, $owner_label ) use ( $link, $long ) {
		return array(
			'display' => array( 'meta_key' ),
			'fields'  => array(
				$owner_column => $link( $owner_table, $owner_label ),
				'meta_key'    => array( 'label' => 'Key' ),
				'meta_value'  => $long( 'Value' ),
			),
		);
	};

	return array(
		$prefix . 'posts'              => array(
			'label'   => 'Posts and pages',
			'display' => array( 'post_title' ),
			'fields'  => array(
				'post_author'       => $link( 'users', 'Author' ),
				'post_date'         => $when( 'Published' ),
				'post_date_gmt'     => $when( 'Published (UTC)' ),
				'post_content'      => $long( 'Content' ),
				'post_title'        => array( 'label' => 'Title' ),
				'post_excerpt'      => $long( 'Excerpt' ),
				'post_status'       => array( 'label' => 'Status', 'type' => 'choice', 'choices' => array( 'publish', 'future', 'draft', 'pending', 'private', 'trash', 'auto-draft', 'inherit' ) ),
				'comment_status'    => array( 'label' => 'Comments' ) + $open,
				'ping_status'       => array( 'label' => 'Pings' ) + $open,
				'post_name'         => array( 'label' => 'Slug' ),
				'post_modified'     => $when( 'Changed' ),
				'post_modified_gmt' => $when( 'Changed (UTC)' ),
				'post_parent'       => $link( 'posts', 'Parent' ),
				'guid'              => array( 'label' => 'GUID', 'type' => 'url' ),
				'post_type'         => array( 'label' => 'Type' ),
				'post_mime_type'    => array( 'label' => 'File type' ),
				'comment_count'     => array( 'label' => 'Comment count', 'type' => 'number' ),
			),
		),
		$prefix . 'postmeta'           => $meta( 'posts', 'post_id', 'Post' ),
		$prefix . 'users'              => array(
			'label'   => 'Users',
			'display' => array( 'display_name', 'user_email' ),
			'fields'  => array(
				'user_login'      => array( 'label' => 'Sign-in name' ),
				'user_nicename'   => array( 'label' => 'Slug' ),
				'user_email'      => array( 'label' => 'Email', 'type' => 'email' ),
				'user_url'        => array( 'label' => 'Website', 'type' => 'url' ),
				'user_registered' => $when( 'Registered' ),
				'display_name'    => array( 'label' => 'Name' ),
			),
		),
		$prefix . 'usermeta'           => $meta( 'users', 'user_id', 'User' ),
		$prefix . 'comments'           => array(
			'label'   => 'Comments',
			'display' => array( 'comment_author', 'comment_date' ),
			'fields'  => array(
				'comment_post_ID'      => $link( 'posts', 'Post' ),
				'comment_author'       => array( 'label' => 'Author' ),
				'comment_author_email' => array( 'label' => 'Author email', 'type' => 'email' ),
				'comment_author_url'   => array( 'label' => 'Author website', 'type' => 'url' ),
				'comment_date'         => $when( 'Written' ),
				'comment_date_gmt'     => $when( 'Written (UTC)' ),
				'comment_content'      => $long( 'Comment' ),
				'comment_approved'     => array( 'label' => 'Approved', 'type' => 'choice', 'choices' => array( '0', '1', 'spam', 'trash' ) ),
				'comment_parent'       => $link( 'comments', 'Reply to' ),
				'user_id'              => $link( 'users', 'User' ),
			),
		),
		$prefix . 'commentmeta'        => $meta( 'comments', 'comment_id', 'Comment' ),
		$prefix . 'terms'              => array(
			'label'   => 'Categories and tags',
			'display' => array( 'name' ),
			'fields'  => array(
				'name' => array( 'label' => 'Name' ),
				'slug' => array( 'label' => 'Slug' ),
			),
		),
		$prefix . 'termmeta'           => $meta( 'terms', 'term_id', 'Term' ),
		$prefix . 'term_taxonomy'      => array(
			'label'   => 'Taxonomies',
			'display' => array( 'taxonomy' ),
			'fields'  => array(
				'term_id'     => $link( 'terms', 'Term' ),
				'taxonomy'    => array( 'label' => 'Taxonomy' ),
				'description' => $long( 'Description' ),
				'parent'      => $link( 'terms', 'Parent' ),
				'count'       => array( 'label' => 'Uses', 'type' => 'number' ),
			),
		),
		$prefix . 'term_relationships' => array(
			'label'  => 'Post terms',
			'fields' => array(
				'object_id'        => $link( 'posts', 'Post' ),
				'term_taxonomy_id' => $link( 'term_taxonomy', 'Term' ),
			),
		),
		$prefix . 'options'            => array(
			'label'   => 'Settings',
			'display' => array( 'option_name' ),
			'fields'  => array(
				'option_name'  => array( 'label' => 'Name' ),
				'option_value' => $long( 'Value' ),
				'autoload'     => array( 'label' => 'Load on every page' ),
			),
		),
		$prefix . 'links'              => array(
			'label'   => 'Links',
			'display' => array( 'link_name' ),
			'fields'  => array(
				'link_url'   => array( 'label' => 'Address', 'type' => 'url' ),
				'link_name'  => array( 'label' => 'Name' ),
				'link_owner' => $link( 'users', 'Owner' ),
			),
		),
	);
}

/**
 * Writes the field settings for every WordPress table this site has into db3_tables, owned by
 * code so Cloud shows them read-only. Tables a person set up in Cloud keep their settings.
 *
 * @return int How many tables were written.
 */
function db3_write_fields() {
	global $wpdb;
	$table = DB3_FIELDS_TABLE;
	$wpdb->query( "CREATE TABLE IF NOT EXISTS `$table` (name VARCHAR(64) NOT NULL PRIMARY KEY, owner VARCHAR(10) NOT NULL, definition LONGTEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) DEFAULT CHARSET=utf8mb4" );
	$existing = array_flip( $wpdb->get_col( 'SHOW TABLES' ) );
	$written  = 0;
	foreach ( db3_wordpress_fields( $wpdb->prefix ) as $name => $settings ) {
		if ( ! isset( $existing[ $name ] ) ) {
			continue;
		}
		$wpdb->query( $wpdb->prepare( "INSERT INTO `$table` (name, owner, definition) VALUES (%s, 'code', %s) ON DUPLICATE KEY UPDATE definition = IF(owner = 'code', VALUES(definition), definition)", $name, wp_json_encode( $settings ) ) );
		++$written;
	}
	update_option( 'db3_fields_version', DB3_FIELDS_VERSION . ':' . $wpdb->prefix, true );
	return $written;
}

// Cloud's readiness check: answers once WordPress has loaded and the database replies.
if ( '/_db3/health' === wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ) ) {
	global $wpdb;
	$ok = '1' === (string) $wpdb->get_var( 'SELECT 1' );
	status_header( $ok ? 200 : 503 );
	header( 'Content-Type: application/json' );
	header( 'Cache-Control: no-store' );
	echo wp_json_encode( array( 'ok' => $ok ) );
	exit;
}

// Rewrites the field settings after an update of this plugin or a change of table prefix.
add_action(
	'init',
	static function () {
		global $wpdb;
		if ( get_option( 'db3_fields_version' ) !== DB3_FIELDS_VERSION . ':' . $wpdb->prefix && is_blog_installed() ) {
			db3_write_fields();
		}
	}
);

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	WP_CLI::add_command(
		'db3 fields',
		static function () {
			WP_CLI::success( sprintf( 'Wrote db3 field settings for %d tables.', db3_write_fields() ) );
		},
		array( 'shortdesc' => 'Writes field settings for Cloud\'s Database view into db3_tables.' )
	);
}
