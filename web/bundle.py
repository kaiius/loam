#!/usr/bin/env python3
"""Bundle the real Loam M2 modules into a single createSim() factory.

Each source module becomes an IIFE with its imports as parameters —
proper scope isolation, so duplicate top-level names (clamp01, hash2,
WALK_SPEED...) can't collide. The output is the BODY of
`function createSim() { ... }`; every call re-runs all module bodies,
which resets module-level mutable state (e.g. mcreature's nextId) and
gives the page true determinism across seed restarts.

src/sim/world.js (the whole platform world) is NOT bundled: social.js
only needs its `zoneAt` for tribe naming (never in the M2 tick path),
so a minimal shim stands in. The real social.js runs unmodified.
"""
import re, sys, os

# Repo root resolved from this script's location: web/ lives at the repo root,
# so the tree builds for a stranger, not just on the author's machine.
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (module key, path or None for virtual). Order is computed by topo-sort.
MODULE_PATHS = {
    'sim/rng':      'src/sim/rng.js',
    'sim/evodevo':  'src/sim/evodevo.js',
    'sim/genome':   'src/sim/genome.js',
    'sim/biochem':  'src/sim/biochem.js',
    'sim/world':    None,  # shim: zoneAt only (see below)
    'sim/social':   'src/sim/social.js',
    'mat/grid':     'src/material/grid.js',
    'mat/locomotion':'src/material/locomotion.js',
    'mat/worldgen': 'src/material/worldgen.js',
    'mat/process':  'src/material/process.js',
    'mat/genes':    'src/material/genes.js',
    'mat/body':     'src/material/body.js',
    'mat/brain':    'src/material/brain.js',
    'mat/chem':     'src/material/chem.js',
    'mat/senses':   'src/material/senses.js',
    'mat/actions':  'src/material/actions.js',
    'mat/creature': 'src/material/creature.js',
    'mat/mcreature':'src/material/mcreature.js',
    'mat/portrait': 'src/material/portrait.js',
    'mat/render':   'src/material/render.js',
    'mat/fauna':    'src/material/fauna.js',
    'mat/index':    'src/material/index.js',
    # M3: the living world — sky, plant genomes, corpses, the species roster.
    'mat/weather':  'src/material/weather.js',
    'mat/plants':   'src/material/plants.js',
    'mat/corpses':  'src/material/corpses.js',
    'mat/species':  'src/material/species.js',
    'sim/species':  'src/sim/species.js',
    'sim/plantgenome': 'src/sim/plantgenome.js',
}

WORLD_SHIM = """// Virtual shim for src/sim/world.js — the platform world is NOT
// bundled. social.js imports only zoneAt (tribe naming, never in the
// M2 tick path). The real social.js runs unmodified against this.
export function zoneAt(x) { return { key: 'loam', name: 'Loam' }; }
"""

def modkey_for(importer_key, spec):
    if spec == './world.js':
        return 'sim/world'
    if spec.startswith('../sim/'):
        return 'sim/' + spec[len('../sim/'):-len('.js')]
    if spec.startswith('./'):
        base = importer_key.rsplit('/', 1)[0]
        return base + '/' + spec[len('./'):-len('.js')]
    raise ValueError(f'unexpected import spec {spec!r} in {importer_key}')

IMPORT_RE = re.compile(
    r"import\s*\{\s*([^}]*?)\s*\}\s*from\s*['\"]([^'\"]+)['\"]\s*;",
    re.DOTALL)
EXPORT_BARE_RE = re.compile(r"^export\s*\{\s*([^}]*?)\s*\}\s*;", re.MULTILINE | re.DOTALL)

def parse_import_list(s):
    out = []
    for part in s.split(','):
        part = part.strip()
        if not part:
            continue
        m = re.match(r'(\S+)\s+as\s+(\S+)', part)
        if m:
            out.append((m.group(2), m.group(1)))  # (local, exported)
        else:
            out.append((part, part))
    return out

def bundle_module(key, src):
    # 1. imports
    imports = []  # (local, modkey, exported)
    def repl_import(m):
        spec = m.group(2)
        mk = modkey_for(key, spec)
        for local, exported in parse_import_list(m.group(1)):
            imports.append((local, mk, exported))
        return ''
    src = IMPORT_RE.sub(repl_import, src)

    # 2. exports
    exports = []  # (exported, local)
    def repl_bare(m):
        # export { A as B }: A is local, B is the exported name.
        # parse_import_list returns (second_token, first_token) = (B, A).
        for exported, local in parse_import_list(m.group(1)):
            exports.append((exported, local))
        return ''
    src = EXPORT_BARE_RE.sub(repl_bare, src)

    def strip_kw(kw):
        nonlocal src, exports
        pat = re.compile(r'^export\s+' + kw + r'\s+([A-Za-z_$][\w$]*)', re.MULTILINE)
        for m in pat.finditer(src):
            exports.append((m.group(1), m.group(1)))
        src = pat.sub(kw + r' \1', src)
    for kw in ('function', 'const', 'class'):
        strip_kw(kw)

    assert 'export ' not in re.sub(r'//.*', '', src), f'{key}: unhandled export remains'
    assert re.search(r'^\s*import\s', src, re.M) is None, f'{key}: import remains'

    # 3. wrap
    modvar = '__m_' + key.replace('/', '_')
    params = [local for local, _, _ in imports]
    args = [f'__m_{mk.replace("/", "_")}.{exp}' for _, mk, exp in imports]
    ret = ', '.join(f'{exp}: {local}' for exp, local in exports)
    wrapped = (
        f'const {modvar} = (function({", ".join(params)}) {{\n'
        f'{src}\n'
        f'return {{ {ret} }};\n'
        f'}})({", ".join(args)});\n'
    )
    return wrapped, modvar

def topo_order():
    deps = {}
    for key, path in MODULE_PATHS.items():
        src = WORLD_SHIM if path is None else open(os.path.join(REPO, path)).read()
        d = set()
        for m in IMPORT_RE.finditer(src):
            d.add(modkey_for(key, m.group(2)))
        deps[key] = d
    order, done = [], set()
    while len(order) < len(deps):
        progressed = False
        for key in deps:
            if key not in done and deps[key] <= done:
                order.append(key); done.add(key); progressed = True
        if not progressed:
            raise RuntimeError('circular imports: ' + str(set(deps) - done))
    return order

def main():
    out = []
    out.append('// Loam M2 simulation bundle — generated from the real repo modules.')
    out.append('// Regenerate with bundle.py. Do not hand-edit.')
    for key in topo_order():
        path = MODULE_PATHS[key]
        src = WORLD_SHIM if path is None else open(os.path.join(REPO, path)).read()
        wrapped, _ = bundle_module(key, src)
        out.append(f'\n// ===== {key} =====')
        out.append(wrapped)
    out.append('''
return {
  createMaterialWorld: __m_mat_index.createMaterialWorld,
  tickMaterialWorldM2: __m_mat_index.tickMaterialWorldM2,
  addFounder: __m_mat_index.addFounder,
  createRng: __m_sim_rng.createRng,
  renderWorldView: __m_mat_index.renderWorldView,
  renderInspectView: __m_mat_index.renderInspectView,
  lastActionName: __m_mat_index.lastActionName,
  petMaterialCreature: __m_mat_index.petMaterialCreature,
  nudgeMaterialCreature: __m_mat_index.nudgeMaterialCreature,
  actionCoverage: __m_mat_actions.actionCoverage,
  bodyDrawing: __m_mat_body.bodyDrawing,
  portraitFor: __m_mat_portrait.portraitFor,
  driveLevels: __m_mat_chem.driveLevels,
  matAtPx: __m_mat_grid.matAtPx,
  MAT_PROPS: __m_mat_grid.MAT_PROPS,
  MAT: __m_mat_grid.MAT,
  CELL_PX: __m_mat_grid.CELL_PX,
  seedEcology: __m_mat_species.seedEcology,
  SPECIES_INFO: __m_mat_species.SPECIES_INFO,
  creatureName: __m_mat_species.creatureName,
  speciesLabel: __m_mat_species.speciesLabel,
  clearTerrainCache: __m_mat_render.clearTerrainCache,
};''')
    sys.stdout.write('\n'.join(out))

if __name__ == '__main__':
    main()
