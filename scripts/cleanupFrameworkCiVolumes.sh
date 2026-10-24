#!/usr/bin/env bash
set -euo pipefail

# GitHub removes service containers before this runner hook executes. Only
# Framework CI MariaDB and Redis volumes are eligible; Docker protects in-use volumes.
failed=0
volumes="$(timeout 30s docker volume ls --format '{{.Name}}')"
while IFS= read -r volume; do
	[[ "$volume" =~ ^framework-ci-(mariadb|redis)-[0-9]+-[0-9]+$ ]] || continue
	if timeout 60s docker volume rm "$volume"; then
		printf 'Removed Framework CI volume %s\n' "$volume"
	else
		printf 'Could not remove Framework CI volume %s\n' "$volume" >&2
		failed=1
	fi
done <<< "$volumes"

exit "$failed"
