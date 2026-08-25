// ESC/POS thermal-printer adapter.
//
// Two channels:
//  1. WebUSB claim of a POS printer (works in Chromium when the user grants
//     device access once per register).
//  2. Browser print fallback - the app's print stylesheet already produces a
//     clean 80mm receipt, so window.print() covers everything else.
//
// The cash drawer is kicked with the standard ESC/POS pulse routed through
// whichever printer channel is available.

const ESC = 0x1b;
const DRAWER_KICK = [0x1b, 0x70, 0x00, 0x19, 0xfa]; // pin 2, 25ms on, 250ms off

let usbDevice = null;

export function hardwareChannel() {
  if (usbDevice) return 'usb';
  return 'browser';
}

export async function connectPrinter() {
  if (!navigator.usb) {
    throw new Error('WebUSB is not available in this browser - use browser printing');
  }
  usbDevice = await navigator.usb.requestDevice({
    filters: [{ classCode: 7 }], // USB printers
  });
  await usbDevice.open();
  const iface = usbDevice.configuration.interfaces.find((i) =>
    i.alternates.some((a) => a.interfaceClass === 7)
  );
  await usbDevice.claimInterface(iface.interfaceNumber);
  return { name: usbDevice.productName ?? 'Thermal printer' };
}

function escPosBytes(textLines) {
  const encoder = new TextEncoder();
  const parts = [new Uint8Array([ESC, 0x40])]; // init
  for (const line of textLines) {
    parts.push(encoder.encode(`${line}\n`));
  }
  parts.push(new Uint8Array([0x1d, 0x56, 0x42, 0x00])); // partial cut
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function sendUsb(bytes) {
  const endpoint = usbDevice.configuration.interfaces
    .flatMap((i) => i.alternates)
    .flatMap((a) => a.endpoints)
    .find((e) => e.direction === 'out');
  if (!endpoint) throw new Error('Printer has no OUT endpoint');
  // Chunk to the device's packet size to avoid overflow errors.
  const size = endpoint.packetSize ?? 64;
  for (let i = 0; i < bytes.length; i += size) {
    await usbDevice.transferOut(endpoint.endpointNumber, bytes.slice(i, i + size));
  }
}

export async function printEscPos(lines) {
  const bytes = escPosBytes(lines);
  if (usbDevice) {
    await sendUsb(bytes);
    return { printed: true, channel: 'usb' };
  }
  return { printed: false, channel: 'browser' };
}

export async function kickCashDrawer() {
  if (!usbDevice) return { kicked: false, channel: 'browser' };
  await sendUsb(new Uint8Array(DRAWER_KICK));
  return { kicked: true, channel: 'usb' };
}
