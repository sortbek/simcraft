require('./register-typescript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { create, act } = require('react-test-renderer');
let locale = 'en_US';
let simcInput = 'mage=test\nspec=frost\n';
function mock(path, exports) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
mock('../src/app/lib/i18n', { useLanguage: () => ({ locale, t: (key) => key }) });
mock('../src/app/components/sim-config/SimContext', { useSimContext: () => ({ simcInput }) });
mock('../src/app/components/talents/TalentPicker', { __esModule: true, default: () => null });
const { useDropFinderData } = require('../src/app/components/loot/useDropFinderData.ts');
const { useLootCatalog } = require('../src/app/components/loot/useLootCatalog.ts');
const LootBrowser = require('../src/app/components/loot/LootBrowser.tsx').default;
const ItemTable = require('../src/app/components/loot/ItemTable.tsx').default;
const LootItemRow = require('../src/app/components/loot/LootItemRow.tsx').default;
const CategorySelector = require('../src/app/components/loot/CategorySelector.tsx').default;
const LootFor = require('../src/app/components/loot/LootFor.tsx').default;
const OptionChip = require('../src/app/components/ui/OptionChip.tsx').default;
const UpgradeSelect = require('../src/app/components/loot/UpgradeSelect.tsx').default;
const Select = require('../src/app/components/loot/Select.tsx').default;
const Checkbox = require('../src/app/components/ui/Checkbox.tsx').default;
const response = (data) => ({ ok: true, json: async () => data });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const baseQuery = {
  sources: ['type:raid'],
  className: 'mage',
  specs: ['frost'],
  voidForge: false,
  catalyst: false,
};

test('mounted drop query ignores superseded requests and supports error retry and empty success', async () => {
  const requests = [];
  global.fetch = (url, init) => {
    const pending = deferred();
    requests.push({ ...pending, url, signal: init.signal });
    return pending.promise;
  };
  let latest;
  function Harness({ query }) {
    latest = useDropFinderData(query);
    return null;
  }
  let tree;
  await act(async () => {
    tree = create(React.createElement(Harness, { query: baseQuery }));
  });
  await act(async () =>
    tree.update(
      React.createElement(Harness, { query: { ...baseQuery, sources: ['type:dungeon'] } })
    )
  );
  assert.equal(requests[0].signal.aborted, true);
  await act(async () => {
    requests[0].resolve(response({ Head: [{ item_id: 999 }] }));
    await flush();
  });
  assert.equal(latest.status, 'loading');
  await act(async () => {
    requests[1].reject(new Error('Offline'));
    await flush();
  });
  assert.equal(latest.status, 'error');
  assert.match(latest.error, /Offline/);
  await act(async () => latest.retry());
  await act(async () => {
    requests[2].resolve(response({}));
    await flush();
  });
  assert.equal(latest.status, 'success');
  assert.deepEqual(latest.data, {});
  await act(async () => tree.unmount());
});

test('catalog failures remain errors and can be retried', async () => {
  let fail = true,
    latest;
  global.fetch = async () => {
    if (fail) throw new Error('Catalog unavailable');
    return response([]);
  };
  function Harness() {
    latest = useLootCatalog();
    return null;
  }
  let tree;
  await act(async () => {
    tree = create(React.createElement(Harness));
    await flush();
  });
  assert.equal(latest.status, 'error');
  fail = false;
  await act(async () => {
    latest.retry();
    await flush();
  });
  assert.equal(latest.status, 'success');
  await act(async () => tree.unmount());
});
const difficulty = (key, level) => ({ key, label: key, track: 'Hero', level, sortOrder: 0 });
const catalog = {
  instances: [
    { id: 10, name: 'Dungeon', type: 'dungeon', encounters: [] },
    { id: -1, name: 'Pool', type: 'meta', encounters: [{ id: 10, name: 'Dungeon' }] },
    { id: 20, name: 'Raid', type: 'raid', encounters: [] },
  ],
  seasonConfig: {
    raid_instance_ids: [20],
    raid_difficulties: [difficulty('heroic', 1)],
    dungeon_categories: [
      {
        key: 'mplus',
        label: 'Dungeons',
        poolInstanceId: -1,
        defaultDifficulty: 'mythic+10',
        difficulties: [difficulty('mythic+10', 1)],
      },
    ],
  },
  tracks: {
    Hero: [
      { level: 1, max_level: 6, ilvl: 100, bonus_id: 9001, quality: 4 },
      { level: 2, max_level: 6, ilvl: 110, bonus_id: 9002, quality: 4 },
    ],
    Champion: [
      { level: 4, max_level: 6, ilvl: 302, bonus_id: 12836, quality: 4 },
      { level: 6, max_level: 6, ilvl: 308, bonus_id: 12838, quality: 4 },
    ],
    Myth: [
      { level: 1, max_level: 6, ilvl: 318, bonus_id: 12849, quality: 4 },
      { level: 6, max_level: 6, ilvl: 334, bonus_id: 12854, quality: 4 },
    ],
  },
};
const drop = (id, source) => ({
  item_id: id,
  name: 'English item',
  icon: '',
  ilevel: 100,
  quality: 4,
  inventory_type: 11,
  encounter: 'Boss',
  instance_id: source,
  instance_name: source === 10 ? 'Dungeon' : 'Raid',
  embellished: true,
  difficulty_info: { heroic: { track: 'Hero', ilvl: 100, bonus_id: 9001, quality: 4 } },
  dungeon_info: { 'mythic+10': { track: 'Hero', ilvl: 100, bonus_id: 9001, quality: 4 } },
});

test('mounted browser changes categories atomically, resets same-name specs by class, and updates localized search', async () => {
  const names = deferred();
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (url.endsWith('/api/item-names')) return names.promise;
    if (String(url).includes('/api/gems')) return response([]);
    if (url.endsWith('/api/instances')) return response(catalog.instances);
    if (url.endsWith('/api/season-config')) return response(catalog.seasonConfig);
    if (url.endsWith('/api/upgrade-tracks')) return response(catalog.tracks);
    const source = url.includes('type/raid') ? 20 : 10;
    return response({ Finger: [drop(1, source), drop(2, source)] });
  };
  // Other endpoints (item names, gems) interleave, so assert on the drops
  // request specifically rather than on whatever fetch happened to be last.
  const lastDropUrl = () => urls.filter((url) => url.includes('/drops')).at(-1);
  let submission, tree;
  locale = 'de_DE';
  const element = () =>
    React.createElement(LootBrowser, {
      footer: (value) => {
        submission = value;
        return null;
      },
    });
  await act(async () => {
    tree = create(element());
    await flush();
  });
  assert.equal(tree.root.findByType(ItemTable).props.model.rows.length, 2);
  // Individual and bulk selection both permit alternative embellished candidates.
  await act(async () => tree.root.findByType(ItemTable).props.onClearItems(['1', '2']));
  assert.equal(submission, null);
  await act(async () => tree.root.findByType(ItemTable).props.onToggle('1'));
  assert.equal(submission.drop_items.length, 1);
  await act(async () => tree.root.findByType(ItemTable).props.onSelectItems(['1', '2']));
  assert.equal(submission.drop_items.length, 2);
  await act(async () => tree.root.findByType(UpgradeSelect).props.onChange(2));
  assert.equal(submission.drop_items[0].ilevel, 110);
  await act(async () => {
    tree.root.findByType(CategorySelector).props.onChange('raids');
    await flush();
  });
  assert.equal(tree.root.findByType(UpgradeSelect).props.value, 0);
  assert.equal(submission.drop_items[0].ilevel, 100);
  await act(async () => {
    tree.root.findByType(LootFor).props.onToggle('fire');
    await flush();
  });
  assert.ok(lastDropUrl().includes('spec=frost%2Cfire'));
  simcInput = 'death_knight=test\nspec=frost\n';
  await act(async () => {
    tree.update(element());
    await flush();
  });
  assert.match(lastDropUrl(), /class_name=death_knight/);
  assert.ok(!lastDropUrl().includes('fire'));
  const search = tree.root.findByType(ItemTable).findByType('input');
  await act(async () => search.props.onChange({ target: { value: 'Gegenstand' } }));
  assert.equal(tree.root.findAllByType(LootItemRow).length, 0);
  await act(async () => {
    names.resolve(response({ 1: { de_DE: 'Gegenstand' } }));
    await flush();
  });
  assert.equal(tree.root.findAllByType(LootItemRow).length, 1);
  await act(async () => tree.unmount());
  locale = 'en_US';
});

test('mounted select supports keyboard opening, arrows, Escape and focus restoration', async () => {
  const listeners = new Map();
  global.document = {
    activeElement: null,
    addEventListener: (key, fn) => listeners.set(key, fn),
    removeEventListener: (key) => listeners.delete(key),
  };
  const nodes = [];
  let tree, chosen;
  const createNodeMock = (element) => {
    const node = {
      props: element.props,
      focus() {
        document.activeElement = node;
      },
      contains: () => false,
      querySelector: (selector) =>
        nodes.find(
          (n) =>
            n.props.role === 'option' &&
            (selector !== '[aria-selected="true"]' || n.props['aria-selected'])
        ),
      querySelectorAll: () => nodes.filter((n) => n.props.role === 'option'),
    };
    if (element.props.role === 'option') nodes.push(node);
    return node;
  };
  await act(async () => {
    tree = create(
      React.createElement(Select, {
        value: 1,
        options: [
          { value: 1, label: 'One' },
          { value: 2, label: 'Two' },
        ],
        onChange: (value) => {
          chosen = value;
        },
      }),
      { createNodeMock }
    );
  });
  let trigger = tree.root.findAllByType('button')[0];
  await act(async () => trigger.props.onKeyDown({ key: 'ArrowDown', preventDefault() {} }));
  assert.equal(tree.root.findAllByType('button')[0].props['aria-expanded'], true);
  // Option refs aren't required by the component; provide focusable DOM stand-ins for the panel.
  const optionNodes = tree.root.findAllByProps({ role: 'option' });
  if (!nodes.length) for (const option of optionNodes) createNodeMock({ props: option.props });
  document.activeElement = nodes[0];
  await act(async () =>
    tree.root
      .findByProps({ role: 'listbox' })
      .props.onKeyDown({ key: 'ArrowDown', preventDefault() {} })
  );
  assert.equal(document.activeElement, nodes[1]);
  await act(async () => optionNodes[1].props.onClick());
  assert.equal(chosen, 2);
  await act(async () => tree.root.findAllByType('button')[0].props.onClick());
  await act(async () => listeners.get('keydown')({ key: 'Escape', preventDefault() {} }));
  assert.equal(tree.root.findAllByType('button')[0].props['aria-expanded'], false);
  assert.equal(document.activeElement.props['aria-haspopup'], 'listbox');
  await act(async () => tree.unmount());
  delete global.document;
});

// ---- Bonus Rolls ----
const DifficultySelect = require('../src/app/components/loot/DifficultySelect.tsx').default;

// The real Midnight S2 ladder, so row, tooltip and payload are pinned to the
// same item levels and bonus ids the backend emits.
const VAULT = {
  'vault-heroic': { track: 'Myth', ilvl: 318, bonus_id: 12849, quality: 4 },
  'vault-mythic': { track: 'Myth', ilvl: 334, bonus_id: 12854, quality: 4 },
  'vault+0': { track: 'Champion', ilvl: 302, bonus_id: 12836, quality: 4 },
  'vault+10-13': { track: 'Myth', ilvl: 318, bonus_id: 12849, quality: 4 },
};
// A Very Rare boss keeps its own item level under a Mythic roll, and stays
// off-track so the reward cannot be walked back down.
const VERY_RARE_MYTHIC = { ilvl: 344, bonus_id: 13848, quality: 4 };
const vaultTier = (key, extra = {}) => ({
  key,
  label: key,
  track: VAULT[key].track,
  level: 1,
  sortOrder: 0,
  ...extra,
});
const bonusSeasonConfig = {
  raid_instance_ids: [20],
  raid_difficulties: [difficulty('heroic', 1)],
  raid_vault_difficulties: [
    vaultTier('vault-heroic', { baseDifficulty: 'heroic' }),
    vaultTier('vault-mythic', { baseDifficulty: 'mythic' }),
  ],
  bonus_roll: { dungeonCategory: 'mplus', dungeonDifficulties: ['vault+0', 'vault+10-13'] },
  dungeon_categories: [
    {
      key: 'mplus',
      label: 'Dungeons',
      poolInstanceId: -1,
      defaultDifficulty: 'mythic+10',
      difficulties: [difficulty('mythic+10', 1), vaultTier('vault+0'), vaultTier('vault+10-13')],
    },
  ],
};
// Real pools are disjoint: raid loot prices only on the raid ladder, dungeon
// loot only on the M+ one, and raid trash on neither.
const bonusDrop = (id, kind) => {
  const base = {
    item_id: id,
    name: 'English item',
    icon: '',
    ilevel: 1,
    quality: 4,
    inventory_type: 11,
    encounter: 'Boss',
    instance_id: kind === 'dungeon' ? 10 : 20,
    instance_name: kind === 'dungeon' ? 'Dungeon' : 'Raid',
  };
  const heroic = { track: 'Hero', ilvl: 1, bonus_id: 9000, quality: 4 };
  if (kind === 'dungeon')
    return {
      ...base,
      dungeon_info: {
        'mythic+10': heroic,
        'vault+0': VAULT['vault+0'],
        'vault+10-13': VAULT['vault+10-13'],
      },
    };
  if (kind === 'trash') return { ...base, difficulty_info: { heroic } };
  return {
    ...base,
    difficulty_info: {
      heroic,
      'vault-heroic': VAULT['vault-heroic'],
      'vault-mythic': kind === 'veryRare' ? VERY_RARE_MYTHIC : VAULT['vault-mythic'],
    },
  };
};

test('bonus rolls merge both pools, price each side on its own ladder, and honour No roll', async () => {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).endsWith('/api/item-names')) return response({});
    if (String(url).includes('/api/gems')) return response([]);
    if (String(url).endsWith('/api/instances')) return response(catalog.instances);
    if (String(url).endsWith('/api/season-config')) return response(bonusSeasonConfig);
    if (String(url).endsWith('/api/upgrade-tracks')) return response(catalog.tracks);
    if (String(url).includes('type/raid'))
      return response({
        Finger: [bonusDrop(1, 'raid'), bonusDrop(3, 'veryRare'), bonusDrop(9, 'trash')],
      });
    return response({ Finger: [bonusDrop(2, 'dungeon')] });
  };
  let submission, tree;
  const element = () =>
    React.createElement(LootBrowser, {
      footer: (value) => {
        submission = value;
        return null;
      },
    });
  await act(async () => {
    tree = create(element());
    await flush();
  });
  await act(async () => {
    tree.root.findByType(CategorySelector).props.onChange('bonus-roll');
    await flush();
  });
  assert.ok(
    urls.some((url) => url.includes('type/raid')),
    'raid endpoint fetched'
  );
  assert.ok(
    urls.some((url) => url.includes('/instances/-1/')),
    'M+ pool fetched'
  );
  const rows = () => tree.root.findByType(ItemTable).props.model.rows;
  const row = (uid) => rows().find((entry) => entry.uid === uid);
  const uids = () =>
    rows()
      .map((entry) => entry.uid)
      .sort();
  const paid = (uid) => {
    const item = submission.drop_items.find((drop) => String(drop.item_id) === uid);
    return [item.ilevel, item.bonus_ids];
  };
  const setTier = async (side, key) => {
    await act(async () => {
      tree.root.findAllByType(DifficultySelect)[side === 'raid' ? 0 : 1].props.onChange(key);
      await flush();
    });
  };

  // Trash carries no vault tier, so a bonus roll can never produce it.
  assert.deepEqual(uids(), ['1', '2', '3']);
  // Defaults: raid Heroic (Myth 1/6) and the top M+ tier, both 318.
  assert.equal(row('1').ilevel, 318);
  assert.deepEqual(paid('1'), [318, [12849]]);
  assert.match(row('1').tooltip, /(^|&)ilvl=318(&|$)/);
  assert.match(row('1').tooltip, /(^|&)bonus=12849(&|$)/);
  assert.equal(row('2').ilevel, 318);
  assert.deepEqual(paid('2'), [318, [12849]]);
  // The rank control spans both ladders: a rank means "level N of each item's
  // own track", and the labels follow the higher of the two selected tiers.
  const upgrade = () => tree.root.findByType(UpgradeSelect);
  assert.ok(
    upgrade().props.options.some((option) => option.label === 'Myth 6/6'),
    'ranks come from the higher selected ladder'
  );
  await act(async () => upgrade().props.onChange(6));
  assert.deepEqual(paid('1'), [334, [12854]], 'the raid half climbs its own track');
  assert.deepEqual(paid('2'), [334, [12854]], 'so does the M+ half');
  await act(async () => upgrade().props.onChange(0));
  assert.deepEqual(paid('1'), [318, [12849]], 'back to the tier as rolled');

  // Switching between two real tiers moves only that side.
  await setTier('raid', 'vault-mythic');
  assert.equal(row('1').ilevel, 334);
  assert.deepEqual(paid('1'), [334, [12854]]);
  assert.match(row('1').tooltip, /(^|&)bonus=12854(&|$)/);
  // The Very Rare boss keeps its own level instead of flattening to the tier.
  assert.equal(row('3').ilevel, 344);
  assert.deepEqual(paid('3'), [344, [13848]]);
  assert.match(row('3').tooltip, /(^|&)ilvl=344(&|$)/);
  assert.equal(row('2').ilevel, 318, 'the M+ side is untouched by a raid change');

  await setTier('dungeon', 'vault+0');
  assert.equal(row('2').ilevel, 302);
  assert.deepEqual(paid('2'), [302, [12836]]);
  assert.equal(row('1').ilevel, 334, 'the raid side is untouched by an M+ change');

  // Either side alone.
  await setTier('dungeon', '');
  assert.deepEqual(uids(), ['1', '3'], 'no M+ roll leaves only the raid half');
  assert.deepEqual(paid('1'), [334, [12854]], 'the surviving half keeps its price');
  assert.equal(submission.drop_items.length, 2);

  // Leaving the pool deselects, and coming back does not re-select: the tier
  // dropdowns narrow the same way the instance pool drawer already does.
  await setTier('dungeon', 'vault+10-13');
  assert.deepEqual(uids(), ['1', '2', '3']);
  assert.deepEqual(
    submission.drop_items.map((drop) => drop.item_id).sort(),
    [1, 3],
    'an item that left the pool comes back unselected'
  );
  await act(async () => tree.root.findByType(ItemTable).props.onSelectItems(['2']));
  assert.deepEqual(paid('2'), [318, [12849]]);

  await setTier('raid', '');
  assert.deepEqual(uids(), ['2'], 'no raid roll leaves only the M+ half');
  assert.deepEqual(paid('2'), [318, [12849]]);

  await setTier('dungeon', '');
  assert.deepEqual(rows(), [], 'no roll on either side empties the pool');
  assert.equal(submission, null, 'nothing selectable means nothing to submit');
  await act(async () => tree.unmount());
});

test('the bonus roll tab is opt-in, so single-instance callers never see it', async () => {
  const labels = (props) => {
    const tree = create(React.createElement(CategorySelector, props));
    const found = tree.root
      .findAll((n) => n.type === 'button' && n.props.role === 'tab')
      .flatMap((tab) => tab.children)
      .filter((child) => typeof child === 'string');
    tree.unmount();
    return found;
  };
  const dungeonCats = [{ cat: { key: 'mplus', label: 'Dungeons' }, instances: [] }];
  const base = { category: 'raids', onChange: () => {}, dungeonCats };
  // The roster resolves one numeric instance per run, so it omits the flag.
  assert.ok(!labels(base).includes('loot.bonusRolls'));
  assert.ok(labels({ ...base, includeBonusRoll: true }).includes('loot.bonusRolls'));
});

const PreferredGemSelect = require('../src/app/components/loot/PreferredGemSelect.tsx').default;

test('run options ride along with the submission', async () => {
  global.fetch = async (url) => {
    if (String(url).endsWith('/api/item-names')) return response({});
    if (String(url).includes('/api/gems')) return response([]);
    if (String(url).endsWith('/api/instances')) return response(catalog.instances);
    if (String(url).endsWith('/api/season-config')) return response(bonusSeasonConfig);
    if (String(url).endsWith('/api/upgrade-tracks')) return response(catalog.tracks);
    if (String(url).includes('type/raid')) return response({ Finger: [bonusDrop(1, 'raid')] });
    return response({ Finger: [bonusDrop(2, 'dungeon')] });
  };
  let submission, tree;
  await act(async () => {
    tree = create(
      React.createElement(LootBrowser, {
        footer: (value) => {
          submission = value;
          return null;
        },
      })
    );
    await flush();
  });
  await act(async () => {
    tree.root.findByType(CategorySelector).props.onChange('bonus-roll');
    await flush();
  });

  // Off by default, so an untouched run sends nothing new.
  assert.equal(submission.upgrade_equipped_to, undefined);
  assert.equal(submission.preferred_gem_id, undefined);
  assert.equal(submission.add_vault_socket, undefined);

  const toggle = async (label) => {
    const node = tree.root.find((n) => n.type === OptionChip && n.props.text === label);
    await act(async () => node.props.onChange(!node.props.checked));
  };

  await toggle('dropFinder.optVaultSocket');
  assert.equal(submission.add_vault_socket, true);

  // The equipped baseline follows whichever rank the run is testing at.
  await toggle('dropFinder.optUpgradeEquipped');
  assert.equal(submission.upgrade_equipped_to, 0, 'Base until a rank is picked');
  await act(async () => tree.root.findByType(UpgradeSelect).props.onChange(6));
  assert.equal(submission.upgrade_equipped_to, 6);

  await act(async () => tree.root.findByType(PreferredGemSelect).props.onChange(240908));
  assert.equal(submission.preferred_gem_id, 240908);
  // "Match my gems" means fall back to the inferred pick, i.e. send nothing.
  await act(async () => tree.root.findByType(PreferredGemSelect).props.onChange(null));
  assert.equal(submission.preferred_gem_id, undefined);

  await act(async () => tree.unmount());
});

test('gear you already have is listed but left out of the sim request', async () => {
  // The character wears the raid drop at Myth 6/6 already; the M+ drop is new.
  const resolved = {
    slots: {
      finger1: {
        equipped: { item_id: 1, ilevel: 334, upgrade: 'Myth 6/6' },
        alternatives: [],
      },
    },
  };
  global.fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/api/item-names')) return response({});
    if (target.includes('/api/gems')) return response([]);
    if (target.endsWith('/api/instances')) return response(catalog.instances);
    if (target.endsWith('/api/season-config')) return response(bonusSeasonConfig);
    if (target.endsWith('/api/upgrade-tracks')) return response(catalog.tracks);
    if (target.includes('/api/gear/resolve')) return response(resolved);
    if (target.includes('type/raid')) return response({ Finger: [bonusDrop(1, 'raid')] });
    return response({ Finger: [bonusDrop(2, 'dungeon')] });
  };
  let submission, tree;
  await act(async () => {
    tree = create(
      React.createElement(LootBrowser, {
        footer: (value) => {
          submission = value;
          return null;
        },
      })
    );
    await flush();
  });
  await act(async () => {
    tree.root.findByType(CategorySelector).props.onChange('bonus-roll');
    await flush();
  });
  // useResolvedGear debounces before it fetches.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await flush();
  });

  const rows = () => tree.root.findByType(ItemTable).props.model.rows;
  const row = (uid) => rows().find((entry) => entry.uid === uid);
  assert.deepEqual(
    rows()
      .map((entry) => entry.uid)
      .sort(),
    ['1', '2'],
    'the owned item is still listed'
  );
  assert.equal(row('1').variants.owned, true, 'and carries its badge');
  assert.equal(row('2').variants.owned, false, 'a new item is not badged');
  assert.deepEqual(
    submission.drop_items.map((drop) => drop.item_id),
    [2],
    'but only the new item is submitted'
  );

  // Unselectable, not merely unticked: the row refuses to join the run.
  await act(async () => tree.root.findByType(ItemTable).props.onToggle('1'));
  assert.deepEqual(
    submission.drop_items.map((drop) => drop.item_id),
    [2],
    'toggling an owned row does nothing'
  );
  await act(async () => tree.root.findByType(ItemTable).props.onSelectItems(['1', '2']));
  assert.deepEqual(
    submission.drop_items.map((drop) => drop.item_id),
    [2],
    'and select-all skips it'
  );
  await act(async () => tree.unmount());
});

test('same-named tier rows render their origin so the stat difference is legible', async () => {
  const base = {
    uid: '1',
    itemId: 271474,
    name: "Baleful Grave-Knight's Casque",
    icon: '',
    source: "The Venomous Abyss • Nek'zali the Soulcoiler",
    sourceName: 'The Venomous Abyss',
    slot: 'Head',
    ilevel: 334,
    quality: 4,
    href: '#',
    tooltip: '',
    selected: false,
    offSpec: false,
    embellished: false,
    variants: {},
  };
  const texts = (tree) => {
    const out = [];
    const walk = (node) => {
      if (typeof node === 'string') out.push(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && node.children) node.children.forEach(walk);
    };
    walk(tree.toJSON());
    return out;
  };
  const render = (row) =>
    create(
      React.createElement(LootItemRow, {
        row,
        showSlot: false,
        embellishmentLimitReached: false,
        onToggle: () => {},
      })
    );

  const token = render({ ...base, variants: { from_tier_token: true } });
  assert.ok(texts(token).includes('loot.tierToken'), 'token row is badged');
  assert.equal(
    texts(token).some((t) => t.startsWith('loot.catalystFrom')),
    false,
    'a token row claims no conversion source'
  );
  await act(async () => token.unmount());

  const converted = render({
    ...base,
    variants: { is_catalyst: true },
    catalystSource: 'Skullguard of the Risen Sacrifice',
  });
  const shown = texts(converted);
  assert.ok(shown.includes('loot.catalyst'), 'conversion row is badged');
  assert.ok(
    shown.includes('loot.catalystFrom'),
    'and names the item it was converted from: ' + JSON.stringify(shown)
  );
  assert.equal(shown.includes('loot.tierToken'), false);
  await act(async () => converted.unmount());

  // A row with neither origin stays as bare as before.
  const plain = render(base);
  assert.equal(texts(plain).includes('loot.tierToken'), false);
  assert.equal(texts(plain).includes('loot.catalystFrom'), false);
  await act(async () => plain.unmount());
});

test('an owned row renders inert, and says why', async () => {
  const row = (owned) => ({
    uid: '1',
    itemId: 1,
    name: 'Item',
    icon: '',
    source: 'Boss',
    sourceName: 'Raid',
    slot: 'Finger',
    ilevel: 334,
    quality: 4,
    href: '#',
    tooltip: '',
    selected: false,
    offSpec: false,
    embellished: false,
    variants: { owned },
  });
  const render = (owned) => {
    const toggled = [];
    const tree = create(
      React.createElement(LootItemRow, {
        row: row(owned),
        showSlot: false,
        embellishmentLimitReached: false,
        onToggle: (uid) => toggled.push(uid),
      })
    );
    const container = tree.root.findAllByType('div')[0];
    const checkbox = tree.root.findByType(Checkbox);
    return { tree, container, checkbox, toggled };
  };

  const own = render(true);
  assert.match(own.container.props.className, /cursor-not-allowed/, 'greyed and not clickable');
  assert.match(own.container.props.className, /opacity-50/);
  assert.equal(own.container.props.title, 'loot.alreadyOwnedReason', 'says why on hover');
  assert.equal(own.checkbox.props.disabled, true);
  // Clicking the row does not even reach the handler.
  await act(async () => own.container.props.onClick());
  assert.deepEqual(own.toggled, []);
  await act(async () => own.tree.unmount());

  const free = render(false);
  assert.match(free.container.props.className, /cursor-pointer/);
  assert.equal(free.container.props.title, undefined);
  assert.equal(free.checkbox.props.disabled, false);
  await act(async () => free.container.props.onClick());
  assert.deepEqual(free.toggled, ['1']);
  await act(async () => free.tree.unmount());
});
