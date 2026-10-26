#!/usr/bin/env bash
# Creates or rotates the db3-secrets Secret with random values. Nothing is written to disk.
# Usage: KUBECTL="sudo k3s kubectl" deploy/k3s/create-secrets.sh
set -euo pipefail
kubectl=(${KUBECTL:-kubectl})
namespace=${NAMESPACE:-db3-starter}

"${kubectl[@]}" -n "$namespace" create secret generic db3-secrets \
	--from-literal=DB_PASSWORD="$(openssl rand -hex 24)" \
	--from-literal=MARIADB_ROOT_PASSWORD="$(openssl rand -hex 24)" \
	--from-literal=APP_KEY="base64:$(openssl rand -base64 32)" \
	--from-literal=REALTIME_SECRET="$(openssl rand -hex 24)" \
	--dry-run=client -o yaml | "${kubectl[@]}" apply -f -
