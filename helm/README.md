# ELEMENTA Helm chart

Deployable packaging for the Next.js website at **elementafestival.com**. Adapted from the `berryhill/bd-site` Helm conventions: GHCR image references, NGINX ingress and cert-manager's `letsencrypt-http` ClusterIssuer. The application is stateless: no blog PVC, Doppler client, credential payload, cluster-scoped resource or DNS mutation is included.

## Build and offline verification

From the repository root:

```sh
docker build -t elementa:local .
helm lint ./helm --strict --set image.tag=local
helm template elementa ./helm --set image.tag=local
python3 helm/test-chart.py
```

Manifest tests require Helm 3 and Python with PyYAML. `image.tag` and `image.digest` default empty intentionally: supply an actual published image reference before installation. Rendering with `local` is testing only; it does not publish that tag to GHCR. Digest takes precedence over tag.

The multi-stage Dockerfile uses `npm ci` and Next standalone output. Only explicit application/config/asset files enter the Docker build context. No `.env`, credentials, private research, Git history or test-browser installation is copied. The runtime is Node 22 Alpine, nonroot UID/GID 1000, port 3000.

Test the hardened container locally:

```sh
docker run --rm --name elementa-local \
  --read-only --user 1000:1000 --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m,uid=1000,gid=1000 \
  --tmpfs /app/.next/cache:rw,nosuid,size=128m,uid=1000,gid=1000 \
  -p 127.0.0.1:3111:3000 \
  -e SITE_STAGE=preview \
  -e SITE_ORIGIN=https://elementafestival.com elementa:local
```

With the container running, `PREVIEW_URL=http://127.0.0.1:3111 npm run test:browser` exercises the actual packaged application. The chart mounts bounded writable emptyDir volumes at the same two paths; content itself is bundled/read-only. Startup/readiness probes request the actual `/es` page, exercising server rendering and publication configuration. Liveness uses the application TCP port.

## Cluster prerequisites — verify before an authorized deployment

- Kubernetes >=1.24, Helm 3, and the target namespace/context chosen by the deployment owner.
- An existing ingress controller with class `nginx` and cert-manager ClusterIssuer `letsencrypt-http`, or explicit values matching the target cluster. This chart does not install either controller or an issuer.
- DNS for `elementafestival.com` pointing to that ingress and HTTP-01 validation reachable. No DNS changes have been performed. `www` is not configured automatically.
- The built image published to `ghcr.io/berryhill/elementa`, preferably selected by immutable SHA-256 digest. No image has been pushed by implementing this chart.
- If GHCR requires authentication, an existing same-namespace pull secret; provide `imagePullSecrets[0].name`. No registry credentials in values or release history.
- `existingEnvSecret` references an existing same-namespace Secret for signup (`MONGODB_URI` and `SIGNUP_ALLOWED_ORIGIN`). Explicit chart env keys take precedence. Changing a Secret alone does not restart pods; perform a controlled rollout after authorized rotation.

## Installation example — only after deployment authorization

Replace the digest and kube context placeholders with verified values; do not run the placeholders:

```sh
helm upgrade --install elementa ./helm \
  --kube-context APPROVED_CONTEXT --namespace elementa --create-namespace \
  --set-string image.digest=sha256:ACTUAL_PUBLISHED_DIGEST \
  --atomic --wait --timeout 5m
```

Default resource names are `elementa-elementa`, scoped to the release/namespace. Override `fullnameOverride` if needed **before first installation**. Service is ClusterIP port 80 → named container port 3000; TLS terminates at ingress using Secret `elementa-tls`. Set a release-specific TLS secret if installing multiple copies in one namespace. ServiceAccount tokens are not mounted; containers drop all Linux capabilities, use a read-only root filesystem and RuntimeDefault seccomp. Two replicas and zero-unavailable rolling updates are the default; ensure cluster capacity for a surge pod.

Verify rollout, `/es`, `/en`, assets, redirects, metadata, certificate and actual external responses before calling a deployment successful. Use Helm history and `helm rollback` to the previous verified revision when appropriate. These are instructions, not evidence of a cluster rollout.

## Publication gate

`site.origin` is `https://elementafestival.com`; **stage remains `preview` and noindex**. The domain is approved as the destination, not as authorization to release incomplete signup or index the site. This chart version rejects non-preview stages, matching the application's current public-release gate. When real subscriber integration/privacy and festival timing are approved, update and test the application and chart gates together; changing a flag alone cannot make this an indexable launch.

GA4 remains disabled. Signup persistence is now implemented: configure `existingEnvSecret` with `MONGODB_URI` and `SIGNUP_ALLOWED_ORIGIN=https://elementafestival.com` to enable database access. Missing database configuration returns a signup error. The signup rate-limit, privacy and operational requirements in the root README remain required before public exposure. Noindex is not access control: use a private ingress or approved access controls if the preview must be confidential.

## Verified locally

Helm strict lint and rendered-manifest tests pass (domain/TLS, selectors, service ports, digest selection, security, secret references, disabled ingress/service account and invalid-value rejection). The Docker image built and passed all 12 browser/HTTP scenario groups in hardened read-only/nonroot mode, including desktop/mobile ES/EN, assets, no-JS 404s, expiry and signup preview behavior. No Kubernetes admission/rollout, certificate issuance, registry publication or DNS behavior is claimed.
