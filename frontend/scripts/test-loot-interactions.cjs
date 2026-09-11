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
const UpgradeSelect = require('../src/app/components/loot/UpgradeSelect.tsx').default;
const Select = require('../src/app/components/loot/Select.tsx').default;
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
  source: 'type:raid',
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
    tree.update(React.createElement(Harness, { query: { ...baseQuery, source: 'type:dungeon' } }))
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
    if (url.endsWith('/api/instances')) return response(catalog.instances);
    if (url.endsWith('/api/season-config')) return response(catalog.seasonConfig);
    if (url.endsWith('/api/upgrade-tracks')) return response(catalog.tracks);
    const source = url.includes('type/raid') ? 20 : 10;
    return response({ Finger: [drop(1, source), drop(2, source)] });
  };
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
  const fireButton = tree.root
    .findAllByType('button')
    .find((button) => button.children.includes('Fire'));
  await act(async () => {
    fireButton.props.onClick();
    await flush();
  });
  assert.ok(urls.at(-1).includes('spec=frost%2Cfire'));
  simcInput = 'death_knight=test\nspec=frost\n';
  await act(async () => {
    tree.update(element());
    await flush();
  });
  assert.match(urls.at(-1), /class_name=death_knight/);
  assert.ok(!urls.at(-1).includes('fire'));
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
