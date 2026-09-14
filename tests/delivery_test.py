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

    def test_page_requirements(self):
        html = '<html lang="es"><meta name="robots" content="noindex, nofollow"><main>Elementa</main></html>'
        deploy.check_page(html, 'es')
        deploy.check_page(html.replace('noindex', 'index'), 'es', 'noindex')
        for bad in [html.replace('noindex', 'index'), html.replace('lang="es"', 'lang="en"'), html.replace('main', 'div')]:
            with self.assertRaises(ValueError):
                deploy.check_page(bad, 'es')

    def test_invalid_current_context_has_no_writes(self):
        commands = []
        def fake(*args):
            commands.append(args)
            if args[:3] == ('kubectl', 'config', 'current-context'):
                return 'expected'
            if 'namespace' in args:
                return 'WRONG-UID'
            return ''
        with patch.object(deploy, 'run', side_effect=fake), patch.dict(os.environ):
            with self.assertRaisesRegex(ValueError, 'current-context'):
                deploy.deploy(ENV)
        self.assertFalse(any(c[0] == 'helm' for c in commands))
        self.assertEqual(commands[0][0:2], ('cosign', 'verify'))
        self.assertIn('--certificate-github-workflow-sha', commands[0])

    def test_signature_failure_prevents_cluster_access(self):
        with patch.object(deploy, 'run', side_effect=RuntimeError('bad signature')) as run:
            with self.assertRaisesRegex(RuntimeError, 'bad signature'):
                deploy.deploy(ENV)
            self.assertEqual(run.call_count, 1)

    def test_successful_transaction_no_rollback(self):
        with patch.object(deploy, 'prior_release', return_value=PREVIOUS), patch.object(deploy, 'run') as run, patch.object(deploy, 'verify') as verify:
            deploy.transaction('chart', 'values', IMAGE, deploy.HOST, previous=PREVIOUS)
        self.assertEqual(run.call_count, 1)
        self.assertIn('--atomic', run.call_args.args)
        verify.assert_called_once_with(IMAGE, deploy.HOST, None)

    def test_postverify_failure_rolls_back_and_verifies_old_image(self):
        with patch.object(deploy, 'prior_release', return_value=PREVIOUS), patch.object(deploy, 'run') as run, patch.object(deploy, 'verify', side_effect=[RuntimeError('bad HTTPS'), None]) as verify:
            with self.assertRaisesRegex(RuntimeError, 'bad HTTPS'):
                deploy.transaction('chart', 'values', IMAGE, deploy.HOST, previous=PREVIOUS)
        self.assertEqual(run.call_args_list[-1].args[:4], ('helm', 'rollback', 'elementa', '2'))
        self.assertEqual(verify.call_args_list[-1].args, (OLD, deploy.HOST, PRIOR_SECRET))

    def test_upgrade_failure_also_restores(self):
        with patch.object(deploy, 'prior_release', return_value=PREVIOUS), patch.object(deploy, 'run', side_effect=[RuntimeError('helm timeout'), '']) as run, patch.object(deploy, 'verify') as verify:
            with self.assertRaisesRegex(RuntimeError, 'helm timeout'):
                deploy.transaction('chart', 'values', IMAGE, deploy.HOST, previous=PREVIOUS)
        self.assertEqual(run.call_count, 2)
        verify.assert_called_once_with(OLD, deploy.HOST, PRIOR_SECRET)

    def test_first_install_failure_does_not_uninstall(self):
        with patch.object(deploy, 'run') as run, patch.object(deploy, 'verify', side_effect=RuntimeError('failed')):
            with self.assertRaises(RuntimeError):
                deploy.transaction('chart', 'values', IMAGE, deploy.HOST)
        self.assertEqual(run.call_count, 1)

    def test_rollback_verification_failure_is_fatal(self):
        with patch.object(deploy, 'prior_release', return_value=PREVIOUS), patch.object(deploy, 'run'), patch.object(deploy, 'verify', side_effect=[RuntimeError('new bad'), RuntimeError('restore bad')]):
            with self.assertRaisesRegex(RuntimeError, 'restore bad'):
                deploy.transaction('chart', 'values', IMAGE, deploy.HOST, previous=PREVIOUS)

    def test_live_wrong_image_rejected_before_http(self):
        d = {'spec': {'template': {'spec': {'containers': [{'image': OLD}]}}}}
        with patch.object(deploy, 'kube', side_effect=['', json.dumps(d)]), patch.object(deploy, 'pages') as pages:
            with self.assertRaisesRegex(ValueError, 'image does not match'):
                deploy.verify(IMAGE, deploy.HOST)
        pages.assert_not_called()

    def test_live_no_endpoints_rejected(self):
        d = {'spec': {'replicas': 1, 'template': {'spec': {'containers': [{'image': IMAGE}]}}}}
        p = {'metadata': {}, 'spec': {'containers': [{'image': IMAGE}]}, 'status': {'podIP': '10.0.0.1', 'containerStatuses': [{'ready': True, 'imageID': DIGEST}]}}
        with patch.object(deploy, 'kube', side_effect=['', json.dumps(d), json.dumps({'items': [p]}), '{"items": []}']), patch.object(deploy, 'pages') as pages:
            with self.assertRaisesRegex(ValueError, 'no ready endpoints'):
                deploy.verify(IMAGE, deploy.HOST)
        pages.assert_not_called()

    def test_history_api_error_not_treated_as_first_install(self):
        with patch.object(deploy, 'run', side_effect=RuntimeError('forbidden')):
            with self.assertRaisesRegex(RuntimeError, 'forbidden'):
                deploy.prior_release()

    def test_workflow_contract(self):
        workflows = {p.name: yaml.load(p.read_text(), Loader=yaml.BaseLoader) for p in (ROOT / '.github/workflows').glob('*.yml')}
        for workflow in workflows.values():
            for job in workflow['jobs'].values():
                for step in job.get('steps', []):
                    if 'uses' in step:
                        self.assertRegex(step['uses'], r'^[\w/-]+@[0-9a-f]{40}$')
        ci = '\n'.join(s.get('run', '') for s in workflows['ci.yml']['jobs']['checks']['steps'])
        for gate in ('npm ci', 'npm test', 'npm run typecheck', 'npm run build', 'python3 helm/test-chart.py', 'delivery*.py'):
            self.assertIn(gate, ci)
        release = workflows['release.yml']
        self.assertIn('workflow_dispatch', release['on'])
        self.assertEqual(release['concurrency']['cancel-in-progress'], 'false')
        publish = release['jobs']['publish']
        self.assertEqual(publish['needs'], 'ci')
        steps = publish['steps']
        build = next(s for s in steps if s.get('id') == 'build')['with']
        self.assertEqual(build['platforms'], 'linux/amd64,linux/arm64')
        self.assertEqual(build['sbom'], 'true')
        self.assertEqual(build['provenance'], 'mode=max')
        self.assertEqual(build['tags'], 'ghcr.io/berryhill/elementa:${{ github.sha }}')
        sign = next(i for i, s in enumerate(steps) if 'cosign sign --yes' in s.get('run', ''))
        chart = next(i for i, s in enumerate(steps) if 'helm push' in s.get('run', ''))
        self.assertLess(sign, chart)
        self.assertEqual(release['jobs']['deploy']['needs'], 'publish')
        self.assertEqual(release['jobs']['deploy']['environment']['name'], 'production')
        self.assertNotIn('if', release['jobs']['deploy'])

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

    def test_database_probe_is_ping_only_and_sanitizes_failure(self):
        with patch.object(deploy, 'kube') as kube:
            deploy.probe_database()
        args = kube.call_args.args
        self.assertEqual(args[:4], ('exec', 'deployment/elementa', '-c', 'elementa'))
        script = args[-1]
        self.assertIn('command({ ping: 1 })', script)
        self.assertIn('process.env.MONGODB_URI', script)
        for forbidden in ('insert', 'update', 'console.', ENV['MONGODB_URI']):
            self.assertNotIn(forbidden, script)
        with patch.object(deploy, 'kube', side_effect=RuntimeError('sensitive-canary')):
            with self.assertRaises(RuntimeError) as error:
                deploy.probe_database()
            self.assertNotIn('sensitive-canary', str(error.exception))

    def test_prior_runtime_snapshot_is_required_immutable(self):
        manifest = yaml.safe_dump_all([
            {'kind': 'Deployment', 'spec': {'template': {'spec': {'containers': [
                {'image': OLD, 'envFrom': [{'secretRef': {'name': PRIOR_SECRET}}]}]}}}},
            {'kind': 'Ingress', 'spec': {'rules': [{'host': deploy.HOST}]}}])
        for immutable in ('true', 'false'):
            with patch.object(deploy, 'run', side_effect=['[{}]', '[{"revision": 2, "status": "deployed"}]', manifest]), patch.object(deploy, 'kube', return_value=immutable):
                if immutable == 'true':
                    self.assertEqual(deploy.prior_release(), PREVIOUS)
                else:
                    with self.assertRaisesRegex(ValueError, 'mutable'):
                        deploy.prior_release()

    def test_integrated_preflight_render_provision_transaction_order(self):
        events = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def fake(*args, **kwargs):
                events.append(args)
                if args[:3] == ('kubectl', 'config', 'current-context'): return 'protected'
                if args[:3] == ('kubectl', 'config', 'get-contexts'): return 'protected'
                if 'bd-site' in args: return 'deployment.apps/bd-site'
                if 'clusterissuer' in args: return 'True'
                if 'ingresses' in args: return '{"items": []}'
                if args[:3] == ('helm', 'show', 'chart'):
                    return yaml.safe_dump({'version': '0.1.0-sha.' + SHA, 'appVersion': SHA})
                if args[:3] == ('helm', 'show', 'values'):
                    return yaml.safe_dump({'image': {'digest': DIGEST}})
                if args[:2] == ('helm', 'template'):
                    values = json.loads((root / 'values.json').read_text())
                    self.assertEqual(values['imagePullSecrets'], [{'name': 'ghcr-pull'}])
                    self.assertRegex(values['existingEnvSecret'], r'^elementa-runtime-[0-9a-f]{32}$')
                    self.assertNotIn(ENV['MONGODB_URI'], json.dumps(values))
                    return yaml.safe_dump({'kind': 'Deployment', 'spec': {'template': {'spec': {'containers': [{
                        'image': IMAGE, 'ports': [{'containerPort': 3000}],
                        'env': [{'name': 'SITE_STAGE', 'value': 'preview'}, {'name': 'SITE_ORIGIN', 'value': ENV['SIGNUP_ALLOWED_ORIGIN']}],
                        'envFrom': [{'secretRef': {'name': values['existingEnvSecret']}}]}]}}}})
                return ''
            def mark(name, result=None):
                def call(*args):
                    events.append((name, *args))
                    return result
                return call
            with patch.object(deploy, 'run', side_effect=fake), patch.object(deploy, 'prior_release', side_effect=mark('prior', PREVIOUS)), patch.object(deploy, 'provision_namespace', side_effect=mark('namespace')), patch.object(deploy, 'provision_secrets', side_effect=mark('secrets')), patch.object(deploy, 'transaction', side_effect=mark('transaction')):
                deploy.deploy_selected(deploy.config(ENV), IMAGE, root)
            names = [e[0] for e in events]
            self.assertLess(names.index('prior'), names.index('namespace'))
            self.assertEqual(names[-3:], ['namespace', 'secrets', 'transaction'])
            self.assertEqual(events[-1][-1], PREVIOUS)
            self.assertEqual(events[-1][-2], events[-2][-1])

    def test_reference_landmark_and_host_failures_prevent_all_writes(self):
        for failure in ('bd-site', 'issuer', 'host'):
            commands = []
            def fake(*args, **kwargs):
                commands.append(args)
                if args[:3] == ('kubectl', 'config', 'current-context'): return 'protected'
                if args[:3] == ('kubectl', 'config', 'get-contexts'): return 'protected'
                if 'bd-site' in args:
                    return '' if failure == 'bd-site' else 'deployment.apps/bd-site'
                if 'clusterissuer' in args: return 'False' if failure == 'issuer' else 'True'
                if 'ingresses' in args:
                    return json.dumps({'items': [{'metadata': {'namespace': 'other', 'name': 'other'}, 'spec': {'rules': [{'host': deploy.HOST}]}}]})
                return ''
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory, patch.object(deploy, 'run', side_effect=fake), patch.object(deploy, 'provision_namespace') as ns, patch.object(deploy, 'provision_secrets') as secrets, patch.object(deploy, 'transaction') as transaction:
                with self.assertRaises(ValueError):
                    deploy.deploy_selected(deploy.config(ENV), IMAGE, Path(directory))
                ns.assert_not_called()
                secrets.assert_not_called()
                transaction.assert_not_called()
                self.assertFalse(any(c[0] == 'helm' for c in commands))

    def test_verified_snapshot_runs_database_ping(self):
        container = {'image': IMAGE, 'envFrom': [{'secretRef': {'name': PRIOR_SECRET}}]}
        d = {'spec': {'replicas': 1, 'template': {'spec': {'containers': [container]}}}}
        p = {'metadata': {}, 'spec': {'containers': [container]}, 'status': {'podIP': '10.0.0.1', 'containerStatuses': [{'ready': True, 'imageID': DIGEST}]}}
        slices = {'items': [{'endpoints': [{'conditions': {'ready': True}, 'addresses': ['10.0.0.1']}]}]}
        ingress = {'spec': {'rules': [{'host': deploy.HOST, 'http': {'paths': [{'backend': {'service': {'name': 'elementa'}}}]}}]}}
        with patch.object(deploy, 'kube', side_effect=['', json.dumps(d), json.dumps({'items': [p]}), json.dumps(slices), json.dumps(ingress)]), patch.object(deploy, 'pages') as pages, patch.object(deploy, 'probe_database') as ping:
            deploy.verify(IMAGE, deploy.HOST, PRIOR_SECRET)
            ping.assert_called_once_with()
            pages.assert_called_once_with(deploy.HOST)

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

    def test_chart_package_invalid_version_rejected(self):
        spec = importlib.util.spec_from_file_location('package_chart', ROOT / 'scripts/package-chart.py')
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaises(ValueError):
            module.package({'GITHUB_SHA': 'short', 'IMAGE_DIGEST': DIGEST})


if __name__ == '__main__':
    unittest.main()
