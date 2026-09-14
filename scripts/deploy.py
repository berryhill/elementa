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
import uuid
from contextlib import contextmanager

NAMESPACE = RELEASE = 'elementa'
REPOSITORY = 'ghcr.io/berryhill/elementa'


HOST = 'elementafestival.com'
PULL_SECRET = 'ghcr-pull'
RUNTIME_SECRET = 'elementa-runtime'


class DeploymentValidationError(ValueError):
    """Only authored messages, never exception text or protected values."""


class DeploymentCommandError(RuntimeError):
    """Only fixed command-failure classifications."""


def failure_message(error):
    if type(error) in (DeploymentValidationError, DeploymentCommandError):
        return str(error)
    return 'Unclassified failure; raw details suppressed. Inspect the last deployment phase.'


def command_failure(stderr):
    # Never return matching lines or captures: stderr may echo Secret payloads.
    text = stderr.lower()
    for needles, message in (
        (('unauthorized', 'you must be logged in'), 'authentication rejected; check credential validity'),
        (('forbidden',), 'authorization denied; check required RBAC or registry package access'),
        (('x509:', 'certificate signed by unknown authority'), 'TLS certificate validation failed; check trusted CA and endpoint'),
        (('no such host',), 'DNS resolution failed; check endpoint and runner network access'),
        (('connection refused', 'i/o timeout', 'context deadline exceeded'), 'network connection failed or timed out'),
        (('notfound', 'not found'), 'required resource or artifact not found'),
        (('current-context is not set',), 'kubeconfig current-context is not set'),
        (('error loading config file',), 'kubeconfig could not be parsed or loaded'),
    ):
        if any(needle in text for needle in needles):
            return 'Deployment command failed: ' + message
    return 'Deployment command failed (unclassified; output suppressed)'


def phase(name):
    # Callers supply fixed source literals only, never resource/credential values.
    print('Elementa deployment phase: ' + name, flush=True)


def run(*args, payload=None):
    # Capture BOTH streams: API errors can echo request objects containing secrets.
    # Never include argv, input, output or the original subprocess exception in errors.
    try:
        result = subprocess.run(args, input=payload, text=True, capture_output=True, timeout=720)
    except subprocess.TimeoutExpired:
        raise DeploymentCommandError('Deployment command exceeded its execution timeout') from None
    except OSError:
        raise DeploymentCommandError('Deployment command could not start; check installed tooling') from None
    if result.returncode:
        raise DeploymentCommandError(command_failure(result.stderr)) from None
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
            raise DeploymentValidationError('Namespace is terminating or lacks resourceVersion')
        verb = 'replace'  # Preserve all fields and enforce optimistic concurrency.
    labels = obj['metadata'].setdefault('labels', {})
    if labels.get('app.kubernetes.io/part-of', NAMESPACE) != NAMESPACE:
        raise DeploymentValidationError('Namespace belongs to another application')
    labels['app.kubernetes.io/part-of'] = NAMESPACE
    run('kubectl', '--request-timeout=30s', verb, '-f', '-', payload=json.dumps(obj))


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
    import yaml
    # Support pasted provider YAML/JSON and standard base64 (including line wraps).
    # Parse failures are untrusted and must never reach the deployment log.
    try:
        content = base64.b64decode(re.sub(r'\s+', '', encoded), validate=True)
    except (ValueError, binascii.Error):
        content = encoded.encode('utf-8')
    try:
        document = yaml.safe_load(content)
        valid = isinstance(document, dict) and document.get('apiVersion') == 'v1' and document.get('kind') == 'Config'
    except (yaml.YAMLError, UnicodeError, ValueError):
        valid = False
    if not valid:
        raise DeploymentValidationError('LINODE_KUBECONFIG must be a v1 Config as raw YAML/JSON or valid base64') from None
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
        raise DeploymentValidationError('Missing protected production configuration: ' + ', '.join(missing))
    if not re.fullmatch(r'[0-9a-f]{40}', env['RELEASE_SHA']):
        raise DeploymentValidationError('RELEASE_SHA must be a full 40-character commit SHA')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', env['IMAGE_DIGEST']):
        raise DeploymentValidationError('IMAGE_DIGEST must be immutable sha256 digest')
    if not env['MONGODB_URI'].startswith(('mongodb://', 'mongodb+srv://')):
        raise DeploymentValidationError('MONGODB_URI must use a MongoDB URI scheme')
    if env['SIGNUP_ALLOWED_ORIGIN'] != 'https://' + HOST:
        raise DeploymentValidationError('SIGNUP_ALLOWED_ORIGIN must match the approved HTTPS origin')
    return {key: env[key] for key in required}


def deploy(env):
    phase('validate-production-configuration')
    cfg = config(env)
    with tempfile.TemporaryDirectory(prefix='elementa-deploy-') as directory:
        root = Path(directory)
        with selected_kubeconfig(root, cfg['LINODE_KUBECONFIG']):
            runtime_secret = RUNTIME_SECRET + '-' + uuid.uuid4().hex
            values = root / 'values.json'
            values.write_text(json.dumps({
                'image': {'repository': REPOSITORY, 'tag': cfg['RELEASE_SHA'], 'digest': cfg['IMAGE_DIGEST']},
                'fullnameOverride': RELEASE, 'imagePullSecrets': [{'name': PULL_SECRET}],
                'existingEnvSecret': runtime_secret,
                'site': {'stage': 'preview', 'origin': 'https://' + HOST,
                         'festivalFactsApproved': False, 'announcementInstantApproved': False},
                'ingress': {'host': HOST, 'className': 'nginx',
                            'tls': {'enabled': True, 'secretName': 'elementa-tls'}}}))
            phase('provision-namespace')
            provision_namespace()
            phase('provision-runtime-and-pull-secrets')
            provision_secrets(cfg, runtime_secret)
            phase('helm-upgrade')
            # The checked-out chart is from the same source SHA as the image.
            # Helm waits for readiness and rolls back a failed upgrade itself.
            run('helm', 'upgrade', '--install', RELEASE,
                str(Path(__file__).resolve().parents[1] / 'helm'),
                '-n', NAMESPACE, '--reset-values', '-f', str(values),
                '--atomic', '--wait', '--timeout', '5m')
            print('Elementa Helm rollout succeeded; database/signup not tested', flush=True)


if __name__ == '__main__':
    try:
        deploy(os.environ)
    except Exception as error:
        print('Elementa deployment FAILED: ' + failure_message(error), file=sys.stderr)
        sys.exit(1)
