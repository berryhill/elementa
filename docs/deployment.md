# Elementa delivery and deployment

## Scope and release truth

This automation deploys a **preview**, not an indexable public launch. `SITE_STAGE=preview`, both publication approval flags remain false, and `/es` and `/en` must retain noindex. Noindex is not authentication. Festival facts, indexing approval, DNS, analytics and search submissions remain separate owner decisions.

The application is isolated in namespace **elementa**, Helm release **elementa**, Deployment/Service/Ingress **elementa**. The workflow creates the namespace and credentials but does not modify `default/bd-site`, the existing `nginx` IngressClass or `letsencrypt-http` ClusterIssuer. The hostname is fixed to `elementafestival.com`.

Automation present, offline tests passed, image published/signed, chart published, deployment attempted and live verification passed are separate states. Implementing these files does not provision GitHub secrets or prove deployment.

## Protected production configuration

Protect the GitHub **production** Environment with main-only deployment policy and required reviewers. An environment name in YAML does not configure those protections. Configure these four environment-scoped GitHub secrets:

| Secret | Meaning |
| --- | --- |
| `LINODE_KUBECONFIG` | Raw YAML/JSON v1 Config or base64-encoded kubeconfig (line-wrapped base64 accepted), with the intended Linode cluster selected as its current-context. |
| `MONGODB_URI` | MongoDB connection URI with credentials authorized for the fixed `elementa.subscribers` signup namespace. |
| `SIGNUP_ALLOWED_ORIGIN` | Exactly `https://elementafestival.com`. |
| `GHCR_TOKEN` | Durable GHCR read credential belonging to **berryhill**, authorized for the Elementa image and chart packages. |

No manually supplied `KUBE_CONTEXT`, `KUBE_SYSTEM_UID`, `IMAGE_PULL_SECRET` or `SITE_HOST` variables are required. This is the owner's selected trust boundary: the protected kubeconfig's current-context is authoritative; there is no independent cluster UID pin. Read-only checks require that context to exist, `default/bd-site` to exist, `nginx` to exist and `letsencrypt-http` to be Ready. Cross-namespace ingress inspection rejects a different resource claiming the approved hostname. A kubeconfig pointing to another cluster with identical landmarks cannot be distinguished by these checks; protect and independently verify the kubeconfig before provisioning it.

The kube identity needs read access to those landmarks and all-namespace ingresses; get/create/replace access for namespace `elementa`; namespaced Helm, application and Secret management; Pod/Deployment and EndpointSlice reads; and `pods/exec` permission for the database ping. Existing namespace provisioning preserves existing fields and uses its resourceVersion in a replace request; a concurrent change fails closed. An absent namespace is created, never force-replaced. Terminating namespaces and conflicting application labels are rejected.

Ensure DNS points at the intended ingress and certificate issuance works. The workflow does not change DNS or install controllers. Ensure the packages grant the repository's publishing workflow token write access and berryhill's durable token read access. Successful login alone does not prove package ACLs or pod pulls. Check supported kubectl/server version skew when updating the tool pin.

## Workflow and credential handling

- `.github/workflows/ci.yml`: pull requests, main pushes and reusable release gate. Node 22, `npm ci`, unit tests, typecheck, production build, offline Helm/chart and delivery regression tests. The intentionally private gitignored `.hermes/` pack is not copied into GitHub or claimed as a CI check.
- `.github/workflows/release.yml`: main push or manual dispatch **on main**. CI gates publication. Builds `linux/amd64,linux/arm64`, publishes SBOM and maximal provenance, and pushes `ghcr.io/berryhill/elementa:<full-source-SHA>`.
- Publishing authentication uses `${{ github.actor }}` with `GITHUB_TOKEN`. Cluster pulls and deployment chart reads use **berryhill** with the durable `GHCR_TOKEN`, never the ephemeral job token.
- Cosign signs the image manifest-list digest using GitHub OIDC, then verifies the exact release-workflow identity, OIDC issuer and source SHA. Chart publication follows image signing/verification: `oci://ghcr.io/berryhill/charts/elementa`, version `0.1.0-sha.<full-SHA>`, appVersion `<full-SHA>`. Packaged defaults embed that image digest; source chart files are not modified by packaging.
- Deployment re-verifies the image signature before Kubernetes access, pulls the chart, validates metadata and image digest, strict-lints and renders explicit values before any cluster writes. Chart metadata/digest consistency is checked; the chart itself is not independently Cosign-signed.
- The production transaction is serialized under `elementa-production` with cancellation disabled. GitHub concurrency is not a durable FIFO: newer pending runs can replace pending runs. Actions use full commit SHA pins and explicit tool versions.

The kubeconfig is decoded into a mode-0600 file in an ephemeral temporary directory; the script restores the process's prior KUBECONFIG after use. Namespace-scoped `ghcr-pull` is created/updated as a `kubernetes.io/dockerconfigjson` Secret via server-side apply. Each attempt creates a new immutable `elementa-runtime-<uuid>` Secret containing only `MONGODB_URI` and `SIGNUP_ALLOWED_ORIGIN`. The chart's existing `existingEnvSecret` reference binds that snapshot through envFrom; values and Helm history contain its name, not its data. There is no mutable runtime alias used by workloads.

Secret objects travel to kubectl only on stdin. Both subprocess output streams are captured and failures suppress raw argv, payloads and command output. Do not enable shell tracing, dump environment variables, render Secret values, or print MongoDB error contents. Runner destruction handles abrupt termination; temporary-directory cleanup handles normal exit.

Failures now report the last fixed deployment phase plus authored validation messages or fixed command classifications (authentication, authorization, TLS, DNS/network, missing resource, config load, signature). Classifications are hints from stderr, not raw excerpts or proof of root cause. Unexpected library/parser exceptions remain suppressed. For example, failure at `validate-production-configuration` names the invalid setting without its value; failure at `check-cluster-landmark-default-bd-site` distinguishes access/network problems from a missing landmark. Correct the named protected value or access requirement; do not disable cluster, signature, TLS, or rollback checks. Raw kubeconfig support does not change the selected-context or cluster-landmark authority checks.

Immutable runtime snapshots are deliberately retained outside Helm ownership so old revisions can roll back to their original database/origin bindings. This is not automated garbage collection: operators may remove only snapshots no retained revision or live Pod references. Failed attempts may leave unused snapshots. The shared pull Secret can rotate; rollback does not restore an old registry token, which must continue to authorize old image digests.

## Verification and rollback

`python3 scripts/deploy.py` requires the protected configuration plus `RELEASE_SHA` and `IMAGE_DIGEST` from publication, authenticated registry clients, Python/PyYAML, Helm 3, kubectl and Cosign 2.

Before provisioning, the script captures the deployed prior Helm revision and extracts its immutable image, approved host and runtime Secret name. Failed/pending releases, mutable image references, mutable or nonrevision-pinned runtime bindings require operator recovery/migration. A legacy release with no envFrom binding can be restored without a database probe; new releases always require the immutable snapshot.

After namespace and secret provisioning, it runs `helm upgrade --install --reset-values --atomic --wait --timeout 5m` with explicit preview overrides. Verification checks:

- Exact expected digest image in Deployment and active Pods, rollout success, ready containers and resolved image IDs. Platform imageIDs need not equal the signed multiarch manifest-list digest.
- Exact runtime envFrom snapshot binding in Deployment and Pods.
- Ready EndpointSlice addresses belonging to the expected Pods and the approved ingress backend.
- A bounded Node MongoClient **ping only** executed inside the Deployment, using its injected `MONGODB_URI`. It inserts no subscriber records and suppresses URI/driver error contents. Ping proves connectivity/authentication, not subscriber write privileges or real signup persistence.
- Certificate-valid HTTPS 200 on exact `/es` and `/en` URLs, correct locale SSR/main/Elementa content, and robots meta or HTTP noindex. Redirects are rejected; TLS validation is never disabled. HTTP checks have six bounded attempts and per-request timeouts.

Upgrade and post-verification failures restore the captured prior revision with `helm rollback --wait`, then run the same verifier against its original image/host/runtime snapshot. A successful rollback still leaves the new release job failed. Failed rollback or restored verification requires operator intervention. A first-install custom verification failure leaves resources for diagnosis; there is no custom uninstall. Helm's own atomic failure can remove an initial release. Namespace/Secrets remain external to Helm, and the chart has no persistent storage.

For manual recovery, first confirm the protected current-context and read-only landmarks, inspect `helm history elementa -n elementa`, select a known deployed revision and derive its expected digest and immutable snapshot. After an authorized rollback, use `verify(image, 'elementafestival.com', runtime_secret)` from `scripts.deploy` with those exact values. Do not infer success from Helm's exit code alone. Preserve source SHA, image digest, chart version, prior/final revision and verification outcomes in the incident record.

## Offline checks and remaining live proof

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'delivery*.py' -v
python3 helm/test-chart.py
actionlint .github/workflows/*.yml
npm test
npm run typecheck
npm run build
```

Delivery tests mock external Kubernetes/GitHub commands. They cover configuration/secret mappings, no-write preflight, private kubeconfig handling, namespace concurrency, stdin-only credential materialization, revision snapshots, ordering, error suppression and rollback. They do not prove registry/OIDC trust, multiarch runtime compatibility, RBAC, database connectivity/write privileges, DNS, TLS or live pages; those require an authorized workflow run and live readback.

Browser suites (`npm run test:browser`, `npm run test:hydration`, `npm run test:a11y`) are separate checks with their preview/server prerequisites. The HTTP verifier is not accessibility/performance acceptance or public-launch authorization.
