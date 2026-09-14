# Elementa deployment

The pipeline is build/test → build and push image → Helm deploy. Main pushes run the reusable CI checks once inside `release.yml`; pull requests run `ci.yml` independently. CI runs unit tests, typecheck, production build and offline chart/delivery tests.

Publication pushes `ghcr.io/berryhill/elementa:<source-SHA>` for linux/amd64 and linux/arm64 using the automatic GitHub token. Deployment consumes the resulting immutable digest and the Helm chart checked out at that same source revision. No image signing or separate chart registry publication is required.

## Configuration and scope

The production Environment and serialized, non-cancelling deployment concurrency remain. Existing environment approvals/policies are not changed by this workflow. Required GitHub secrets:

- `LINODE_KUBECONFIG`: provider YAML/JSON kubeconfig or base64; its current-context selects the authorized cluster.
- `MONGODB_URI`: runtime signup database configuration, not a deploy connectivity gate.
- `SIGNUP_ALLOWED_ORIGIN`: exactly `https://elementafestival.com`.
- `GHCR_TOKEN`: durable image-read credential for berryhill; injected as namespaced `ghcr-pull`.

Only namespace/release `elementa` and its application resources/Secrets are managed. The existing nginx ingress controller, letsencrypt-http issuer and DNS remain prerequisites, not resources installed or modified here. There are no unrelated deployment landmarks, all-namespace ingress scans, issuer checks or pods/exec requirements.

TLS ingress remains enabled for elementafestival.com with elementa-tls. Preview/noindex remains enabled, with both publication approval flags false. Deployment does not authorize an indexable launch.

The kubeconfig uses a temporary mode-0600 file. Secret payloads pass to kubectl on stdin, never command arguments or Helm values; subprocess errors suppress credential-bearing output. Each deployment creates an immutable runtime Secret snapshot so Helm rollback keeps the prior runtime binding. Retained snapshots are not automatically garbage-collected; remove only snapshots no retained revision or live pod references. Namespace provisioning preserves existing fields and rejects conflicting ownership.

## Deploy behavior

`python3 scripts/deploy.py` needs Python/PyYAML, kubectl, Helm 3, the above secrets, `RELEASE_SHA` and `IMAGE_DIGEST`. It provisions the namespace/pull/runtime Secrets and runs Helm upgrade/install with `--reset-values --atomic --wait --timeout 5m`.

Helm waits for application readiness and handles rollback on a failed upgrade. Errors remain failed jobs; no continue-on-error, skipped deployment or bespoke post-deploy rollback loop manufactures success. First-install atomic failures may remove Helm resources, while externally provisioned Secrets/namespace remain.

There are no database pings, signup requests, signature checks, cluster landmark checks or custom post-deployment probes. A green deployment means Helm completed rollout, not that database connectivity, subscriber writes, external DNS/TLS or signup were tested. Signup still returns a real error when MongoDB is unavailable; no successful signup is fabricated. Database operations and launch acceptance remain separate from website deployment.

## Offline verification

```sh
npm ci
npm test
npm run typecheck
npm run build
python3 helm/test-chart.py
python3 -m unittest discover -s tests -p 'delivery*.py' -v
actionlint .github/workflows/*.yml
```

Delivery tests mock external commands and cover credential custody, kubeconfig formats, immutable secret snapshots, namespaced digest/TLS/preview Helm arguments, failure propagation and absence of removed deployment gates. They do not prove live database or external website behavior.
