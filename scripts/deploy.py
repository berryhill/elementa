#!/usr/bin/env python3
"""Fail-closed Elementa deployment; subprocesses never run on import."""
import base64
import binascii
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import uuid
from contextlib import contextmanager
from html.parser import HTMLParser
from urllib.request import Request, urlopen

NAMESPACE = RELEASE = 'elementa'
REPOSITORY = 'ghcr.io/berryhill/elementa'
IDENTITY = 'https://github.com/berryhill/elementa/.github/workflows/release.yml@refs/heads/main'


HOST = 'elementafestival.com'
PULL_SECRET = 'ghcr-pull'
RUNTIME_SECRET = 'elementa-runtime'


def run(*args, payload=None):
    # Capture BOTH streams: API errors can echo request objects containing secrets.
    # Never include argv, input, output or the original subprocess exception in errors.
    try:
        result = subprocess.run(args, input=payload, text=True, capture_output=True, timeout=720)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('Deployment command could not complete') from None
    if result.returncode:
        raise RuntimeError('Deployment command failed (output suppressed)') from None
    return result.stdout.strip()


def apply_object(obj, create=False):
    # Server-side apply avoids the client-side last-applied annotation copy of secrets.
    args = ('create',) if create else ('apply', '--server-side', '--field-manager=elementa-delivery')
    run('kubectl', '--request-timeout=30s', '-n', NAMESPACE, *args,
        '-f', '-', payload=json.dumps(obj))


def provision_namespace():
    raw = run('kubectl', '--request-timeout=30s', 'get', 'namespace', NAMESPACE,
              '--ignore-not-found', '-o', 'json')
    if not raw:
        obj = {'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': NAMESPACE}}
        verb = 'create'  # A concurrent creator fails closed, never overwrites.
    else:
        obj = json.loads(raw)
        meta = obj['metadata']
        if not meta.get('resourceVersion') or meta.get('deletionTimestamp'):
            raise ValueError('Namespace is terminating or lacks resourceVersion')
        verb = 'replace'  # Preserve all fields and enforce optimistic concurrency.
    labels = obj['metadata'].setdefault('labels', {})
    if labels.get('app.kubernetes.io/part-of', NAMESPACE) != NAMESPACE:
        raise ValueError('Namespace belongs to another application')
    labels['app.kubernetes.io/part-of'] = NAMESPACE
    run('kubectl', '--request-timeout=30s', verb, '-f', '-', payload=json.dumps(obj))


def probe_database():
    # Only ping; no subscriber records, URI literals, or driver error text.
    script = """const { MongoClient } = require('mongodb');
(async () => {
  let client;
  try {
    client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, socketTimeoutMS: 10000
    });
    await client.connect();
    await client.db('elementa').command({ ping: 1 });
  } catch (_) { process.exitCode = 1; }
  finally { if (client) await client.close().catch(() => { process.exitCode = 1; }); }
})();"""
    try:
        kube('exec', 'deployment/elementa', '-c', 'elementa', '--', 'node', '-e', script)
    except Exception:
        raise RuntimeError('Signup database connectivity probe failed (details suppressed)') from None


def provision_secrets(cfg, runtime_name):
    auth = base64.b64encode(('berryhill:' + cfg['GHCR_TOKEN']).encode()).decode()
    docker = json.dumps({'auths': {'ghcr.io': {'username': 'berryhill',
                        'password': cfg['GHCR_TOKEN'], 'auth': auth}}})
    apply_object({'apiVersion': 'v1', 'kind': 'Secret',
        'metadata': {'name': PULL_SECRET, 'namespace': NAMESPACE},
        'type': 'kubernetes.io/dockerconfigjson',
        'data': {'.dockerconfigjson': base64.b64encode(docker.encode()).decode()}})
    data = {key: base64.b64encode(cfg[key].encode()).decode()
            for key in ('MONGODB_URI', 'SIGNUP_ALLOWED_ORIGIN')}
    # Opaque per-attempt ID: neither a secret hash nor reused on same-SHA retries.
    apply_object({'apiVersion': 'v1', 'kind': 'Secret',
        'metadata': {'name': runtime_name, 'namespace': NAMESPACE},
        'type': 'Opaque', 'immutable': True, 'data': data}, create=True)



@contextmanager
def selected_kubeconfig(root, encoded):
    path = root / 'kubeconfig'
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError('LINODE_KUBECONFIG must be valid base64') from None
    with open(path, 'xb', opener=lambda p, flags: os.open(p, flags, 0o600)) as stream:
        stream.write(content)
    previous = os.environ.get('KUBECONFIG')
    os.environ['KUBECONFIG'] = str(path)
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop('KUBECONFIG', None)
        else:
            os.environ['KUBECONFIG'] = previous


def kube(*args):
    return run('kubectl', '--request-timeout=30s', '-n', NAMESPACE, *args)


def config(env):
    required = ('LINODE_KUBECONFIG', 'MONGODB_URI', 'SIGNUP_ALLOWED_ORIGIN',
                'GHCR_TOKEN', 'RELEASE_SHA', 'IMAGE_DIGEST')
    missing = [key for key in required if not env.get(key)]
    if missing:
        raise ValueError('Missing protected production configuration: ' + ', '.join(missing))
    if not re.fullmatch(r'[0-9a-f]{40}', env['RELEASE_SHA']):
        raise ValueError('RELEASE_SHA must be a full 40-character commit SHA')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', env['IMAGE_DIGEST']):
        raise ValueError('IMAGE_DIGEST must be immutable sha256 digest')
    if not env['MONGODB_URI'].startswith(('mongodb://', 'mongodb+srv://')):
        raise ValueError('MONGODB_URI must use a MongoDB URI scheme')
    if env['SIGNUP_ALLOWED_ORIGIN'] != 'https://' + HOST:
        raise ValueError('SIGNUP_ALLOWED_ORIGIN must match the approved HTTPS origin')
    return {key: env[key] for key in required}


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.noindex = False
        self.lang = None
        self.main = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'html':
            self.lang = attrs.get('lang')
        if tag == 'main':
            self.main = True
        if tag == 'meta' and (attrs.get('name') or '').lower() == 'robots':
            self.noindex = 'noindex' in re.split(r'[,\s]+', (attrs.get('content') or '').lower())


def check_page(html, locale, robots=''):
    page = Page()
    page.feed(html)
    if not (page.noindex or 'noindex' in robots.lower()):
        raise ValueError('Preview noindex is missing')
    if page.lang != locale or not page.main or 'elementa' not in html.lower():
        raise ValueError('Locale/SSR content verification failed: ' + locale)


def pages(host):
    # Normal TLS validation, no insecure fallback, no redirects to a different route/origin.
    for locale in ('es', 'en'):
        url = 'https://' + host + '/' + locale
        request = Request(url, headers={'User-Agent': 'Elementa-release-verifier', 'Cache-Control': 'no-cache'})
        with urlopen(request, timeout=20) as response:
            if response.status != 200 or response.url != url:
                raise ValueError('Expected exact HTTPS 200 URL: ' + url)
            check_page(response.read(2_000_000).decode(), locale, response.headers.get('X-Robots-Tag', ''))


def retry(fn, attempts=6):
    for attempt in range(attempts):
        try:
            return fn()
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(10)


def verify(image, host, runtime_secret=None):
    if not re.fullmatch(re.escape(REPOSITORY) + r'@sha256:[0-9a-f]{64}', image):
        raise ValueError('Verification requires an immutable Elementa image')
    kube('rollout', 'status', 'deployment/elementa', '--timeout=180s')
    deployment = json.loads(kube('get', 'deployment', RELEASE, '-o', 'json'))
    spec = deployment['spec']['template']['spec']
    if [c['image'] for c in spec['containers']] != [image]:
        raise ValueError('Live Deployment image does not match expected digest')
    if runtime_secret and spec['containers'][0].get('envFrom') != [{'secretRef': {'name': runtime_secret}}]:
        raise ValueError('Live runtime Secret binding mismatch')
    pods = json.loads(kube('get', 'pods', '-l', 'app.kubernetes.io/instance=elementa', '-o', 'json'))['items']
    active = [p for p in pods if not p['metadata'].get('deletionTimestamp')]
    if len(active) < deployment['spec']['replicas']:
        raise ValueError('Missing live replicas')
    pod_ips = set()
    for pod in active:
        if [c['image'] for c in pod['spec']['containers']] != [image]:
            raise ValueError('Pod image is not the expected immutable image')
        if runtime_secret and pod['spec']['containers'][0].get('envFrom') != [{'secretRef': {'name': runtime_secret}}]:
            raise ValueError('Pod runtime Secret binding mismatch')
        statuses = pod['status'].get('containerStatuses', [])
        if not statuses or not all(c.get('ready') and c.get('imageID') for c in statuses):
            raise ValueError('Pod is not ready with a resolved image ID')
        pod_ips.add(pod['status']['podIP'])
    slices = json.loads(kube('get', 'endpointslices', '-l', 'kubernetes.io/service-name=elementa', '-o', 'json'))
    addresses = {a for s in slices['items'] for e in s.get('endpoints', [])
                 if e.get('conditions', {}).get('ready') is True for a in e['addresses']}
    if not addresses or not addresses.issubset(pod_ips):
        raise ValueError('Service has no ready endpoints or routes to unexpected pods')
    ingress = json.loads(kube('get', 'ingress', RELEASE, '-o', 'json'))
    if not any(r['host'] == host and all(p['backend']['service']['name'] == RELEASE
               for p in r['http']['paths']) for r in ingress['spec']['rules']):
        raise ValueError('Ingress host/backend mismatch')
    if runtime_secret:
        probe_database()
    retry(lambda: pages(host))
    print('Verified exact Deployment/pod image, ready endpoints, HTTPS /es /en and preview noindex')


def prior_release():
    # An API/auth failure is fatal; do not disguise it as a first install.
    releases = json.loads(run('helm', 'list', '-n', NAMESPACE, '--all', '--filter', '^elementa$', '-o', 'json'))
    if not releases:
        return None
    history = json.loads(run('helm', 'history', RELEASE, '-n', NAMESPACE, '-o', 'json'))
    current = history[-1]
    if current['status'] != 'deployed':
        raise ValueError('Existing release is not deployed; operator recovery required before upgrade')
    import yaml
    manifest = run('helm', 'get', 'manifest', RELEASE, '-n', NAMESPACE, '--revision', str(current['revision']))
    docs = list(yaml.safe_load_all(manifest))
    deployment = next(d for d in docs if d and d.get('kind') == 'Deployment')
    image = deployment['spec']['template']['spec']['containers'][0]['image']
    ingress = next(d for d in docs if d and d.get('kind') == 'Ingress')
    host = ingress['spec']['rules'][0]['host']
    if host != 'elementafestival.com' or not re.fullmatch(re.escape(REPOSITORY) + r'@sha256:[0-9a-f]{64}', image):
        raise ValueError('Prior release must have the approved host and immutable image for safe rollback')
    refs = deployment['spec']['template']['spec']['containers'][0].get('envFrom', [])
    runtime_secret = None
    if refs:
        runtime_secret = refs[0].get('secretRef', {}).get('name', '')
        if len(refs) != 1 or not re.fullmatch(r'elementa-runtime-[0-9a-f]{32}', runtime_secret):
            raise ValueError('Prior runtime binding is not revision-pinned; operator migration required')
        if kube('get', 'secret', runtime_secret, '-o', 'jsonpath={.immutable}') != 'true':
            raise ValueError('Prior immutable runtime Secret is missing or mutable')
    return str(current['revision']), image, host, runtime_secret


def transaction(chart, values, expected, host, runtime_secret=None, previous=None):
    try:
        run('helm', 'upgrade', '--install', RELEASE, chart, '-n', NAMESPACE,
            '--reset-values', '-f', values, '--atomic', '--wait', '--timeout', '5m', '--history-max', '10')
        verify(expected, host, runtime_secret)
    except Exception:
        if previous:
            revision, image, prior_host, prior_secret = previous
            print('Deployment failed; restoring and verifying prior revision ' + revision, file=sys.stderr)
            run('helm', 'rollback', RELEASE, revision, '-n', NAMESPACE, '--wait', '--timeout', '5m')
            verify(image, prior_host, prior_secret)
            print('Prior revision restored and product verification passed; new release remains FAILED', file=sys.stderr)
        else:
            print('First-install failure: no prior revision; no custom uninstall. Inspect namespaced resources. '
                  'Helm --atomic may already have removed a failed initial install.', file=sys.stderr)
        raise


def deploy(env):
    cfg = config(env)
    image = REPOSITORY + '@' + cfg['IMAGE_DIGEST']
    # Exact workflow, OIDC issuer AND source SHA; no broad identity regexp.
    run('cosign', 'verify', '--certificate-identity', IDENTITY,
        '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com',
        '--certificate-github-workflow-sha', cfg['RELEASE_SHA'], image)
    with tempfile.TemporaryDirectory(prefix='elementa-deploy-') as directory:
        root = Path(directory)
        with selected_kubeconfig(root, cfg['LINODE_KUBECONFIG']):
            deploy_selected(cfg, image, root)


def deploy_selected(cfg, image, root):
        directory = str(root)
        # The protected kubeconfig is the owner's target authority, not local defaults.
        context = run('kubectl', 'config', 'current-context')
        contexts = run('kubectl', 'config', 'get-contexts', '-o', 'name').splitlines()
        if not context or context not in contexts:
            raise ValueError('Protected kubeconfig current-context is absent or invalid; refusing all writes')
        if run('kubectl', '--request-timeout=30s', '-n', 'default', 'get',
               'deployment', 'bd-site', '-o', 'name') != 'deployment.apps/bd-site':
            raise ValueError('Expected default/bd-site deployment is absent; refusing all writes')
        kube('get', 'ingressclass', 'nginx', '-o', 'name')
        if kube('get', 'clusterissuer', 'letsencrypt-http', '-o', 'jsonpath={.status.conditions[?(@.type=="Ready")].status}') != 'True':
            raise ValueError('letsencrypt-http ClusterIssuer is not ready')
        # Prevent accidentally taking over another release or namespace ingress host.
        ingresses = json.loads(run('kubectl', '--request-timeout=30s', 'get', 'ingresses', '-A', '-o', 'json'))
        for ingress in ingresses['items']:
            if any(r.get('host') == HOST for r in ingress['spec'].get('rules', [])):
                meta = ingress['metadata']
                if meta['namespace'] != NAMESPACE or meta['name'] != RELEASE:
                    raise ValueError('Approved host already belongs to a different ingress')
        version = '0.1.0-sha.' + cfg['RELEASE_SHA']
        run('helm', 'pull', 'oci://ghcr.io/berryhill/charts/elementa', '--version', version, '--destination', directory)
        chart = str(root / ('elementa-' + version + '.tgz'))
        import yaml
        metadata = yaml.safe_load(run('helm', 'show', 'chart', chart))
        if metadata['version'] != version or metadata['appVersion'] != cfg['RELEASE_SHA']:
            raise ValueError('Published chart source/version mismatch')
        defaults = yaml.safe_load(run('helm', 'show', 'values', chart))
        if defaults['image']['digest'] != cfg['IMAGE_DIGEST']:
            raise ValueError('Published chart does not reference the signed image digest')
        previous = prior_release()
        runtime_secret = RUNTIME_SECRET + '-' + uuid.uuid4().hex
        values = root / 'values.json'
        values.write_text(json.dumps({'image': {'repository': REPOSITORY, 'tag': cfg['RELEASE_SHA'], 'digest': cfg['IMAGE_DIGEST']},
            'fullnameOverride': RELEASE, 'imagePullSecrets': [{'name': PULL_SECRET}],
            'existingEnvSecret': runtime_secret, 'site': {'stage': 'preview', 'origin': 'https://' + HOST,
            'festivalFactsApproved': False, 'announcementInstantApproved': False},
            'ingress': {'host': HOST, 'className': 'nginx', 'tls': {'enabled': True, 'secretName': 'elementa-tls'}}}))
        run('helm', 'lint', chart, '--strict', '-f', str(values))
        rendered = list(yaml.safe_load_all(run('helm', 'template', RELEASE, chart, '-n', NAMESPACE, '-f', str(values))))
        deployment = next(d for d in rendered if d and d.get('kind') == 'Deployment')
        container = deployment['spec']['template']['spec']['containers'][0]
        if container['image'] != image or container['ports'][0]['containerPort'] != 3000:
            raise ValueError('Rendered runtime image/port mismatch')
        runtime = {e['name']: e.get('value') for e in container['env']}
        if runtime.get('SITE_STAGE') != 'preview' or runtime.get('SITE_ORIGIN') != 'https://' + HOST or container.get('envFrom') != [{'secretRef': {'name': runtime_secret}}]:
            raise ValueError('Rendered publication configuration mismatch')
        provision_namespace()
        provision_secrets(cfg, runtime_secret)
        transaction(chart, str(values), image, HOST, runtime_secret, previous)


if __name__ == '__main__':
    try:
        deploy(os.environ)
    except Exception as error:
        # check_output captures stdout. Never dump kubeconfig, Secret data or Helm values.
        print('Elementa deployment FAILED (details suppressed; check protected configuration and release state)', file=sys.stderr)
        sys.exit(1)
