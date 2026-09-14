"""Offline rendered-manifest checks. Requires Helm 3 and PyYAML; no cluster access."""
from pathlib import Path
import subprocess
import yaml

chart = str(Path(__file__).resolve().parent)

def render(*overrides, release='elementa', success=True):
    args = ['helm', 'template', release, chart]
    for setting in overrides:
        args += ['--set', setting]
    result = subprocess.run(args, capture_output=True, text=True)
    assert (result.returncode == 0) == success, result.stderr
    return list(yaml.safe_load_all(result.stdout)) if success else []

base = render('image.tag=test')
by_kind = {item['kind']: item for item in base}
deployment = by_kind['Deployment']
pod = deployment['spec']['template']['spec']
container = pod['containers'][0]
service = by_kind['Service']
ingress = by_kind['Ingress']
assert set(by_kind) == {'ServiceAccount', 'Service', 'Deployment', 'Ingress'}
assert ingress['spec']['rules'][0]['host'] == 'elementafestival.com'
assert ingress['spec']['tls'][0]['hosts'] == ['elementafestival.com']
assert ingress['metadata']['annotations']['cert-manager.io/cluster-issuer'] == 'letsencrypt-http'
assert ingress['spec']['rules'][0]['http']['paths'][0]['backend']['service']['name'] == service['metadata']['name']
assert service['spec']['selector'] == deployment['spec']['selector']['matchLabels']
assert service['spec']['ports'][0]['targetPort'] == container['ports'][0]['name']
assert pod['serviceAccountName'] == by_kind['ServiceAccount']['metadata']['name']
assert not pod['automountServiceAccountToken']
assert pod['securityContext']['runAsUser'] == 1000
assert container['securityContext']['readOnlyRootFilesystem']
assert container['securityContext']['capabilities']['drop'] == ['ALL']
env = {item['name']: item['value'] for item in container['env']}
assert env['SITE_STAGE'] == 'preview'
assert env['MONGODB_AUTH_SOURCE'] == 'admin'
for source in ['elementa', '']:
    docs = render('image.tag=test', 'mongodbAuthSource='+source)
    c = next(d for d in docs if d['kind']=='Deployment')['spec']['template']['spec']['containers'][0]
    auth = {e['name']:e['value'] for e in c['env']}
    assert auth.get('MONGODB_AUTH_SOURCE') == (source or None)
assert env['SITE_ORIGIN'] == 'https://elementafestival.com'
assert env['FESTIVAL_FACTS_APPROVED'] == env['ANNOUNCEMENT_INSTANT_APPROVED'] == 'false'
assert container['startupProbe']['httpGet'] == {'path': '/es', 'port': 'http'}
assert container['readinessProbe']['httpGet'] == {'path': '/es', 'port': 'http'}
assert container['image'] == 'ghcr.io/berryhill/elementa:test'
assert deployment['spec']['strategy']['rollingUpdate']['maxUnavailable'] == 0
assert 'envFrom' not in container
assert not any(item['kind'] in ['Secret','PersistentVolumeClaim','ClusterIssuer','ClusterRole'] for item in base)

digest = 'sha256:' + 'a' * 64
custom = render('image.digest='+digest, 'image.tag=ignored', 'ingress.enabled=false',
                'serviceAccount.create=false', 'serviceAccount.name=existing',
                'existingEnvSecret=elementa-private', 'imagePullSecrets[0].name=ghcr-pull',
                'containerPort=4000', 'service.port=8080', release='review')
d = next(x for x in custom if x['kind']=='Deployment')
p = d['spec']['template']['spec']
c = p['containers'][0]
assert not any(x['kind'] in ['Ingress','ServiceAccount'] for x in custom)
assert c['image'].endswith('@'+digest)
assert p['serviceAccountName'] == 'existing'
assert p['imagePullSecrets'] == [{'name':'ghcr-pull'}]
assert c['envFrom'] == [{'secretRef':{'name':'elementa-private'}}]
assert c['ports'][0]['containerPort'] == 4000
assert d['metadata']['name'] != deployment['metadata']['name']
no_tls=render('image.tag=test','ingress.tls.enabled=false')
assert 'tls' not in next(x for x in no_tls if x['kind']=='Ingress')['spec']
for settings in [[], ['image.digest=bad'], ['image.tag=test','site.stage=public-teaser'],
                 ['image.tag=test','replicaCount=0'], ['image.tag=test','containerPort=80'],
                 ['image.tag=test','site.origin=http://elementafestival.com']]:
    render(*settings, success=False)
print('PASS: chart wiring, domain/TLS, security, probes, digest, overrides, isolation and six fail-closed cases')
