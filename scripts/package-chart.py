#!/usr/bin/env python3
"""Package a full-SHA versioned chart embedding the already-signed image digest."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import yaml


def package(env):
    sha, digest = env['GITHUB_SHA'], env['IMAGE_DIGEST']
    if not re.fullmatch('[0-9a-f]{40}', sha) or not re.fullmatch('sha256:[0-9a-f]{64}', digest):
        raise ValueError('Full commit SHA and immutable image digest required')
    root = Path(env['RUNNER_TEMP']) / 'elementa-chart'
    root.mkdir(exist_ok=True)
    chart = root / 'helm'
    shutil.copytree('helm', chart, dirs_exist_ok=True)
    values_file = chart / 'values.yaml'
    values = yaml.safe_load(values_file.read_text())
    values['image'].update(repository='ghcr.io/berryhill/elementa', tag=sha, digest=digest)
    values_file.write_text(yaml.safe_dump(values))
    subprocess.run(['helm', 'lint', str(chart), '--strict'], check=True, timeout=60)
    subprocess.run(['helm', 'package', str(chart), '--version', '0.1.0-sha.' + sha,
                    '--app-version', sha, '--destination', str(root)], check=True, timeout=60)


if __name__ == '__main__':
    package(os.environ)
