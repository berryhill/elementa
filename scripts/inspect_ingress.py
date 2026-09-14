#!/usr/bin/env python3
"""Read-only, allowlisted public ingress diagnostics; never read Kubernetes Secrets."""
import json
import os
from pathlib import Path
import tempfile
import sys
from deploy import selected_kubeconfig, kube, run, failure_message


def inspect():
    with tempfile.TemporaryDirectory(prefix='elementa-ingress-') as directory:
        with selected_kubeconfig(Path(directory), os.environ['LINODE_KUBECONFIG']):
            raw = kube('get', 'ingress', 'elementa', '--ignore-not-found', '-o', 'json')
            ingress = json.loads(raw) if raw else {}
            print('INGRESS ' + json.dumps({
                'exists': bool(ingress),
                'spec': ingress.get('spec'),
                'issuer': ingress.get('metadata', {}).get('annotations', {}).get('cert-manager.io/cluster-issuer'),
                'loadBalancer': ingress.get('status', {}).get('loadBalancer'),
            }), flush=True)
            service = json.loads(kube('get', 'service', 'elementa', '-o', 'json'))
            print('BACKEND_PORTS ' + json.dumps(service['spec']['ports']), flush=True)
            slices = json.loads(kube('get', 'endpointslices', '-l', 'kubernetes.io/service-name=elementa', '-o', 'json'))
            print('BACKEND_ENDPOINTS ' + json.dumps([
                {'ports': s.get('ports'), 'conditions': [e.get('conditions') for e in s.get('endpoints', [])]}
                for s in slices['items']]), flush=True)
            certificates = json.loads(kube('get', 'certificates', '-o', 'json'))
            print('TLS ' + json.dumps([
                {'name': c['metadata']['name'], 'dnsNames': c['spec'].get('dnsNames'),
                 'issuerRef': c['spec'].get('issuerRef'), 'conditions': c.get('status', {}).get('conditions', [])}
                for c in certificates['items'] if c['spec'].get('secretName') == 'elementa-tls']), flush=True)
            controllers = json.loads(run('kubectl', '--request-timeout=30s', 'get', 'services', '-A',
                '-l', 'app.kubernetes.io/component=controller,app.kubernetes.io/name=ingress-nginx', '-o', 'json'))
            print('CONTROLLER_PUBLIC_ADDRESSES ' + json.dumps([
                {'namespace': s['metadata']['namespace'], 'name': s['metadata']['name'],
                 'loadBalancer': s.get('status', {}).get('loadBalancer')}
                for s in controllers['items'] if s['spec']['type'] == 'LoadBalancer']), flush=True)


if __name__ == '__main__':
    try:
        inspect()
    except Exception as error:
        print('Ingress inspection FAILED: ' + failure_message(error), file=sys.stderr)
        sys.exit(1)
