// Register location selection, shared between the header picker and checkout.
const KEY = 'novapos.location';

export function getLocationId() {
  return localStorage.getItem(KEY) || null;
}

export function setLocationId(id) {
  if (id) localStorage.setItem(KEY, id);
  else localStorage.removeItem(KEY);
}
