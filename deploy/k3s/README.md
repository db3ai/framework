# Starter on k3s

Runs `apps/starter` on a single k3s node: MariaDB as a StatefulSet, a migrate
Job, and the `web`, `queue` and `scheduler` processes from `apps/starter/db3.app.json`
as Deployments. Services are ClusterIP only; put your own ingress or tunnel in front of `web`.

## Deploy

From the repository root, on the k3s node:

```sh
export KUBECTL="sudo k3s kubectl"
docker build -f deploy/k3s/Dockerfile -t db3-starter:local .
docker save db3-starter:local | sudo k3s ctr images import -

$KUBECTL apply -f deploy/k3s/00-namespace.yaml
deploy/k3s/create-secrets.sh
$KUBECTL apply -f deploy/k3s/15-config.yaml -f deploy/k3s/10-mariadb.yaml
$KUBECTL -n db3-starter rollout status sts/mariadb
$KUBECTL apply -f deploy/k3s/20-migrate.yaml
$KUBECTL -n db3-starter wait --for=condition=complete job/migrate --timeout=300s
$KUBECTL apply -f deploy/k3s/30-apps.yaml
```

Set `APP_ORIGIN` in `15-config.yaml` to the public HTTPS origin first. The images
use `imagePullPolicy: Never`, so the node must hold `db3-starter:local`; push to a
registry and change `image:` for anything bigger than one node.

`create-secrets.sh` generates `DB_PASSWORD`, `MARIADB_ROOT_PASSWORD`, `APP_KEY` and
`REALTIME_SECRET`. Every pod shares `APP_KEY`; without it each process would write its own.
Running it again rotates them, which breaks the existing database user and encrypted data.

## Verify

```sh
$KUBECTL -n db3-starter get pods
$KUBECTL -n db3-starter exec deploy/web -- node -e "fetch('http://web:3001/health').then(async r => console.log(r.status, await r.text()))"
```

`/health` reports the application and database checks.

## Update

Rebuild and import the image, delete the finished Job, then rerun the migrate step and
restart the processes:

```sh
$KUBECTL -n db3-starter delete job migrate --ignore-not-found
$KUBECTL apply -f deploy/k3s/20-migrate.yaml
$KUBECTL -n db3-starter wait --for=condition=complete job/migrate --timeout=300s
$KUBECTL -n db3-starter rollout restart deploy/web deploy/queue deploy/scheduler
```

`web` keeps one ready pod during a rollout and sleeps 5 seconds in `preStop`, so
requests through the Service are not dropped.

## Remove

```sh
$KUBECTL delete namespace db3-starter
sudo k3s ctr images rm docker.io/library/db3-starter:local
docker rmi db3-starter:local
```

Deleting the namespace also deletes the MariaDB volume.

## Measured

One k3s v1.36 node (6 arm64 vCPU, 10 GB RAM), 2026-10-26:

| Step | Result |
|---|---|
| Image build, base image cached | 72 s; 669 MB compressed |
| Import into k3s | 18 s |
| Apply to all pods Ready | 27 s (MariaDB 17 s, migrate 6 s, processes 4 s) |
| `web` rollout | 4–5 s, 134/134 requests succeeded during it |
| Memory | web 196 Mi, queue 194 Mi, scheduler 189 Mi, MariaDB 101 Mi |
| k3s itself | server 491 MiB RSS, containerd 344 MiB, system pods 181 Mi |
