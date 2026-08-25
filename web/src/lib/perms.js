// Mirrors the capability keys the server grants. Keep in sync with
// server/src/lib/permissions.js.
export const PERM_KEYS = ['products', 'inventory', 'refunds', 'discounts', 'reports', 'giftcards'];

export const PERM_LABELS = {
  products: 'Manage products',
  inventory: 'Inventory & suppliers',
  refunds: 'Refund orders',
  discounts: 'Apply discounts',
  reports: 'View reports',
  giftcards: 'Manage gift cards',
};
