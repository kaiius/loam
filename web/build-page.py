#!/usr/bin/env python3
"""Assemble loam.html: page template + sim bundle injected as createSim()."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(HERE, 'page-template.html')) as f:
    template = f.read()
with open(os.path.join(HERE, 'sim-bundle.js')) as f:
    bundle = f.read()

# The bundle is the body of createSim(); each call re-runs all module
# bodies, so seed restarts are fully deterministic.
factory = 'function createSim() {\n' + bundle + '\n}'

assert '/*__SIM_BUNDLE__*/' in template
html = template.replace('/*__SIM_BUNDLE__*/', factory)

out = os.path.join(HERE, 'loam.html')
with open(out, 'w') as f:
    f.write(html)
print(f'wrote {out} ({len(html)/1024:.0f} KB)')
