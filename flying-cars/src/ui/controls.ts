/** The key list shown on the start screen and the pause screen. */
const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: 'On the road',
    rows: [
      [['W'], 'Accelerate'],
      [['S'], 'Brake, then reverse. Fast: front jets brake hard (14 air a second)'],
      [['A', 'D'], 'Steer'],
      [['A', 'A'], 'Double tap: dash sideways (12 air). Also D D'],
      [['Space'], 'Hop (15 air)'],
      [['Shift', 'Space'], 'Long low hop (19 air)'],
      [['S', 'Space'], 'Steep high hop (20 air)'],
      [['Shift'], 'Hold to boost (20 air a second)'],
    ],
  },
  {
    title: 'In the air',
    rows: [
      [['W', 'S'], 'Tilt the nose down or up'],
      [['Q', 'E'], 'Roll left or right'],
      [['A', 'D'], 'Turn'],
      [['Space'], 'Tap just before landing: soft landing. Hold: glide (10 air a second)'],
      [['X'], 'Hold to slam down onto the surface below (18 air a second)'],
      [['A', 'A'], 'Double tap: dash sideways'],
      [['Shift'], 'Boost the way the car points'],
    ],
  },
  {
    title: 'Other',
    rows: [
      [['R'], 'Respawn at the last checkpoint (+3 s)'],
      [['C'], 'Camera: smooth, quick or locked'],
      [['M'], 'Sound on or off'],
      [['Esc'], 'Pause'],
    ],
  },
];

const TIPS = [
  'Gaps: keep your speed up and tap Space in the last 45 m before the edge. The car jumps at the right spot. Falling costs 3 s.',
  'Sky islands hang upside down: just tap Space 8 m before the edge. The car hops high and rolls itself over. Press Q, E, W or S to take over.',
  'Drive off the end: it rolls back by itself. Tap Space just before landing for a soft landing.',
  'Land level for PERFECT: +5 air. A full flip in the air is +10.',
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

/** Builds the controls and tips as DOM, ready to put in a screen. */
export function controlsList(): HTMLElement {
  const root = el('div', 'controls');
  for (const group of GROUPS) {
    const box = el('section', 'ctl-group', root);
    el('h3', '', box, group.title);
    for (const [keys, text] of group.rows) {
      const row = el('div', 'ctl-row', box);
      const k = el('span', 'ctl-keys', row);
      keys.forEach((key) => el('kbd', '', k, key));
      el('span', 'ctl-text', row, text);
    }
  }
  const tips = el('ul', 'ctl-tips', root);
  for (const tip of TIPS) el('li', '', tips, tip);
  return root;
}
