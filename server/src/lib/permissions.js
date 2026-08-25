// Capability keys and per-role baselines. A user's effective permission set
// is role baseline merged with their jsonb overrides (true grants, false
// revokes). 'staff', 'settings' and 'audit' domains stay owner-only by design.
export const PERM_KEYS = [
  'products',
  'inventory',
  'refunds',
  'discounts',
  'reports',
  'giftcards',
];

export const ROLE_BASELINES = {
  owner: ['products', 'inventory', 'refunds', 'discounts', 'reports', 'giftcards'],
  manager: ['products', 'inventory', 'refunds', 'discounts', 'reports', 'giftcards'],
  cashier: [],
};

export function resolvePerms(role, permissions) {
  const baseline = ROLE_BASELINES[role] ?? [];
  const set = new Set(baseline);
  if (permissions && typeof permissions === 'object') {
    for (const [key, granted] of Object.entries(permissions)) {
      if (!PERM_KEYS.includes(key)) continue;
      if (granted === true) set.add(key);
      else if (granted === false) set.delete(key);
    }
  }
  return [...set];
}
