"""Offline, bounded delivery regression suite; never contacts GitHub or Kubernetes."""
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch
import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deploy', ROOT / 'scripts/deploy.py')
assert spec is not None and spec.loader is not None
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
SHA = 'a' * 40
DIGEST = 'sha256:' + 'b' * 64
IMAGE = deploy.REPOSITORY + '@' + DIGEST
OLD = deploy.REPOSITORY + '@sha256:' + 'c' * 64
ENV = dict(LINODE_KUBECONFIG='YXBpVmVyc2lvbjogdjEKa2luZDogQ29uZmlnCg==', MONGODB_URI='mongodb://db/elementa',
           SIGNUP_ALLOWED_ORIGIN='https://elementafestival.com', GHCR_TOKEN='secret-canary',
           RELEASE_SHA=SHA, IMAGE_DIGEST=DIGEST)
PRIOR_SECRET = 'elementa-runtime-' + 'd' * 32
PREVIOUS = ('2', OLD, deploy.HOST, PRIOR_SECRET)


class DeliveryTests(unittest.TestCase):
    def test_missing_config_fails_explicitly(self):
        with self.assertRaisesRegex(ValueError, 'LINODE_KUBECONFIG.*MONGODB_URI.*SIGNUP_ALLOWED_ORIGIN.*GHCR_TOKEN'):
            deploy.config({})


    def test_each_required_configuration_is_mandatory(self):
        for key in ENV:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, key):
                deploy.config({k: v for k, v in ENV.items() if k != key})


    def test_reject_mutable_digest_short_sha_unapproved_host(self):
        for key, value in [('RELEASE_SHA', 'aaaaaaa'), ('IMAGE_DIGEST', 'latest'),
                           ('SIGNUP_ALLOWED_ORIGIN', 'https://evil.example'), ('MONGODB_URI', 'invalid')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                deploy.config(dict(ENV, **{key: value}))
        self.assertEqual(deploy.config(ENV)['RELEASE_SHA'], SHA)


    def test_kubeconfig_private_scoped_and_invalid_base64(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'KUBECONFIG': 'prior'}):
            root = Path(directory)
            with deploy.selected_kubeconfig(root, ENV['LINODE_KUBECONFIG']):
                self.assertEqual(os.environ['KUBECONFIG'], str(root / 'kubeconfig'))
                self.assertEqual((root / 'kubeconfig').stat().st_mode & 0o777, 0o600)
            self.assertEqual(os.environ['KUBECONFIG'], 'prior')
            with self.assertRaisesRegex(ValueError, 'valid base64'):
                with deploy.selected_kubeconfig(root, 'invalid!'):
                    pass


    def test_kubeconfig_representations_and_parser_errors_are_private(self):
        import base64
        raw = 'apiVersion: v1\nkind: Config\ncurrent-context: selected\n'
        encoded = base64.b64encode(raw.encode()).decode()
        variants = [raw, json.dumps({'apiVersion': 'v1', 'kind': 'Config'}),
                    encoded, '\n  ' + '\n'.join(encoded[i:i+12] for i in range(0, len(encoded), 12)) + '\n']
        for value in variants:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with deploy.selected_kubeconfig(root, value):
                    self.assertEqual(yaml.safe_load((root / 'kubeconfig').read_bytes())['kind'], 'Config')
        for value in ('sensitive-canary: [broken', '[]', 'null', 'apiVersion: v1',
                      base64.b64encode(b'\xffsensitive-canary').decode()):
            with tempfile.TemporaryDirectory() as directory, patch.object(deploy, 'run') as run:
                with self.assertRaises(deploy.DeploymentValidationError) as error:
                    with deploy.selected_kubeconfig(Path(directory), value):
                        self.fail('invalid kubeconfig accepted')
                self.assertNotIn('sensitive-canary', deploy.failure_message(error.exception))
                self.assertFalse((Path(directory) / 'kubeconfig').exists())
                run.assert_not_called()


    def test_only_authored_diagnostics_are_reported(self):
        from types import SimpleNamespace
        canary = 'sensitive-canary'
        for marker, expected in [('Unauthorized', 'authentication rejected'), ('Forbidden', 'authorization denied'),
                                 ('x509:', 'TLS'), ('no such host', 'DNS'), ('NotFound', 'not found'),
                                 ('current-context is not set', 'current-context'), ('unknown', 'unclassified')]:
            with patch.object(deploy.subprocess, 'run', return_value=SimpleNamespace(
                    returncode=1, stdout=canary, stderr=marker + ' ' + canary)):
                with self.assertRaises(deploy.DeploymentCommandError) as error:
                    deploy.run('cmd', canary, payload=canary)
                message = deploy.failure_message(error.exception)
                self.assertIn(expected, message)
                self.assertNotIn(canary, message)
        for error in (ValueError(canary), RuntimeError(canary), KeyError(canary), yaml.YAMLError(canary)):
            self.assertNotIn(canary, deploy.failure_message(error))
        with self.assertRaises(deploy.DeploymentValidationError) as error:
            deploy.config({**ENV, 'SIGNUP_ALLOWED_ORIGIN': canary})
        self.assertIn('SIGNUP_ALLOWED_ORIGIN', deploy.failure_message(error.exception))
        self.assertNotIn(canary, deploy.failure_message(error.exception))


    def test_namespace_create_replace_and_conflict_fail_closed(self):
        existing = {'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {
            'name': 'elementa', 'resourceVersion': '42', 'labels': {'keep': 'yes'}},
            'spec': {'finalizers': ['kubernetes']}}
        for raw, verb in [('', 'create'), (json.dumps(existing), 'replace')]:
            with self.subTest(verb=verb), patch.object(deploy, 'run', side_effect=[raw, '']) as run:
                deploy.provision_namespace()
                args = run.call_args
                self.assertIn(verb, args.args)
                obj = json.loads(args.kwargs['payload'])
                self.assertEqual(obj['metadata']['name'], 'elementa')
                if verb == 'replace':
                    self.assertEqual(obj['metadata']['resourceVersion'], '42')
                    self.assertEqual(obj['metadata']['labels']['keep'], 'yes')
                    self.assertEqual(obj['spec'], existing['spec'])
        with patch.object(deploy, 'run', side_effect=[json.dumps(existing), RuntimeError('conflict')]) as run:
            with self.assertRaisesRegex(RuntimeError, 'conflict'):
                deploy.provision_namespace()
            self.assertEqual(run.call_count, 2)
        for metadata in ({'name': 'elementa'}, {'name': 'elementa', 'resourceVersion': '1', 'deletionTimestamp': 'now'}):
            with patch.object(deploy, 'run', return_value=json.dumps({'metadata': metadata})) as run:
                with self.assertRaises(ValueError):
                    deploy.provision_namespace()
                self.assertEqual(run.call_count, 1)


    def test_secret_payloads_only_stdin_and_immutable_runtime(self):
        import base64
        with patch.object(deploy, 'run') as run:
            deploy.provision_secrets(ENV, PRIOR_SECRET)
        self.assertEqual(run.call_count, 2)
        pull, runtime = [json.loads(c.kwargs['payload']) for c in run.call_args_list]
        auth = json.loads(base64.b64decode(pull['data']['.dockerconfigjson']))['auths']['ghcr.io']
        self.assertEqual(auth['username'], 'berryhill')
        self.assertEqual(auth['password'], ENV['GHCR_TOKEN'])
        self.assertEqual(pull['metadata']['name'], 'ghcr-pull')
        self.assertTrue(runtime['immutable'])
        self.assertEqual(runtime['metadata']['name'], PRIOR_SECRET)
        self.assertEqual(set(runtime['data']), {'MONGODB_URI', 'SIGNUP_ALLOWED_ORIGIN'})
        self.assertIn('create', run.call_args_list[1].args)
        for call in run.call_args_list:
            self.assertNotIn(ENV['GHCR_TOKEN'], ' '.join(call.args))
            self.assertNotIn(ENV['MONGODB_URI'], ' '.join(call.args))
            self.assertEqual(call.args[-2:], ('-f', '-'))


    def test_command_errors_never_expose_secret_inputs_or_outputs(self):
        import subprocess
        from types import SimpleNamespace
        canary = 'sensitive-canary-value'
        failures = [SimpleNamespace(returncode=1, stdout=canary, stderr=canary),
                    subprocess.TimeoutExpired(['cmd', canary], 1, output=canary, stderr=canary),
                    OSError(canary)]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                kwargs = {'side_effect': failure} if isinstance(failure, Exception) else {'return_value': failure}
                with patch.object(deploy.subprocess, 'run', **kwargs):
                    with self.assertRaises(RuntimeError) as error:
                        deploy.run('cmd', payload=canary)
                    self.assertNotIn(canary, str(error.exception))
                    self.assertTrue(error.exception.__suppress_context__)


    def test_protected_secret_workflow_mapping(self):
        release = yaml.load((ROOT / '.github/workflows/release.yml').read_text(), Loader=yaml.BaseLoader)
        env = release['jobs']['deploy']['env']
        for key in ('LINODE_KUBECONFIG', 'MONGODB_URI', 'SIGNUP_ALLOWED_ORIGIN', 'GHCR_TOKEN'):
            self.assertEqual(env[key], '${{ secrets.' + key + ' }}')
        for key in ('KUBE_CONTEXT', 'KUBE_SYSTEM_UID', 'IMAGE_PULL_SECRET', 'SITE_HOST'):
            self.assertNotIn(key, env)
        login = next(s for s in release['jobs']['publish']['steps'] if 'docker/login-action@' in s.get('uses', ''))
        self.assertEqual(login['with']['username'], '${{ github.actor }}')
        self.assertEqual(login['with']['password'], '${{ secrets.GITHUB_TOKEN }}')


    def test_simple_rollout_and_failure_propagation(self):
        for fails in (False, True):
            commands = []
            def fake(*args, **kwargs):
                commands.append(args)
                self.assertEqual(args[:4], ('helm', 'upgrade', '--install', 'elementa'))
                self.assertEqual(args[4], str(ROOT / 'helm'))
                self.assertEqual(args[args.index('-n') + 1], 'elementa')
                for flag in ('--atomic', '--wait', '--reset-values'):
                    self.assertIn(flag, args)
                values = json.loads(Path(args[args.index('-f') + 1]).read_text())
                self.assertEqual(values['image']['digest'], DIGEST)
                self.assertEqual(values['site']['stage'], 'preview')
                self.assertTrue(values['ingress']['tls']['enabled'])
                self.assertRegex(values['existingEnvSecret'], r'^elementa-runtime-[0-9a-f]{32}$')
                self.assertNotIn(ENV['MONGODB_URI'], json.dumps(values))
                if fails:
                    raise deploy.DeploymentCommandError('rollout failed')
                return ''
            with patch.object(deploy, 'run', side_effect=fake), patch.object(deploy, 'provision_namespace') as ns, patch.object(deploy, 'provision_secrets') as secrets:
                if fails:
                    with self.assertRaisesRegex(deploy.DeploymentCommandError, 'rollout failed'):
                        deploy.deploy(ENV)
                else:
                    deploy.deploy(ENV)
                ns.assert_called_once()
                secrets.assert_called_once()
                self.assertEqual(len(commands), 1)

    def test_simple_workflow_contract(self):
        text = (ROOT / '.github/workflows/release.yml').read_text()
        release = yaml.load(text, Loader=yaml.BaseLoader)
        self.assertEqual(set(release['jobs']), {'ci', 'publish', 'deploy'})
        self.assertEqual(release['jobs']['publish']['needs'], 'ci')
        self.assertEqual(release['jobs']['deploy']['needs'], 'publish')
        self.assertEqual(release['jobs']['deploy']['environment']['name'], 'production')
        self.assertEqual(release['jobs']['deploy']['env']['IMAGE_DIGEST'], '${{ needs.publish.outputs.digest }}')
        script = (ROOT / 'scripts/deploy.py').read_text()
        for removed in ('cosign', 'id-token', 'package-chart', 'helm push', 'helm pull'):
            self.assertNotIn(removed, text)
        for removed in ('probe_database', 'MongoClient', 'bd-site', 'clusterissuer', 'endpointslices', 'urlopen', 'cosign'):
            self.assertNotIn(removed, script)
        ci = yaml.load((ROOT / '.github/workflows/ci.yml').read_text(), Loader=yaml.BaseLoader)
        self.assertNotIn('push', ci['on'])
        for workflow in (ci, release):
            for job in workflow['jobs'].values():
                for step in job.get('steps', []):
                    if 'uses' in step:
                        self.assertRegex(step['uses'], r'@[0-9a-f]{40}$')

if __name__ == '__main__':
    unittest.main()
