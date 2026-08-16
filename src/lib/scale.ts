/**
 * Etekcity ESF-551 over Web Bluetooth.
 *
 * The ESF-551 is the good case: it delivers readings as GATT *notifications*
 * after you connect, not as BLE advertisements. Advertisement scanning
 * (`requestLEScan`) is still behind an experimental flag in Chrome, but plain
 * connect-and-subscribe is fully supported — so this needs no flags, only a
 * secure context (HTTPS or localhost) and a user gesture to open the picker.
 *
 * Protocol from the reverse-engineered `etekcity_esf551_ble` project:
 * https://github.com/ronnnnnnnnnnnnn/etekcity_esf551_ble
 *
 *   notify characteristic  0000fff1-…   22-byte frames
 *   write characteristic   0000fff2-…   display-unit command
 *
 *   byte  0..1   a5 02        header
 *   byte  3..4   10 00
 *   byte  6..9   01 61 a1 00
 *   byte 10..12  weight, 24-bit little-endian, in grams
 *   byte 13..14  impedance, 16-bit little-endian, in ohms
 *   byte 19      1 = reading is final (stable), otherwise it is still settling
 *   byte 20      1 = impedance field is valid
 *   byte 21      display unit: 0 = kg, 1 = lb, 2 = st
 */

import { pyRound } from './round'

const u16 = (n: number) => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`

const NOTIFY_CHARACTERISTIC = u16(0xfff1)
const WRITE_CHARACTERISTIC = u16(0xfff2)

/**
 * The vendor never documented which service holds fff1, and the Python
 * reference implementation never needs to know (bleak resolves characteristics
 * across all services). Web Bluetooth does need it, so every plausible
 * candidate is declared up front and probed in turn at connect time. fff0 is
 * the conventional pairing for fff1/fff2 and is almost certainly the one.
 */
const CANDIDATE_SERVICES = [u16(0xfff0), u16(0xffe0), u16(0xfee7), u16(0xffb0), u16(0x181d)]

const DEVICE_INFO_SERVICE = u16(0x180a)
const HW_REVISION = u16(0x2a27)
const SW_REVISION = u16(0x2a28)

export type DisplayUnit = 'kg' | 'lb' | 'st'

export interface ScaleReading {
  kg: number
  /** Ohms. Present only once the scale finishes its impedance pass. */
  impedance?: number
  displayUnit: DisplayUnit
  /** False while the number on the display is still settling. */
  stable: boolean
}

export interface ScaleInfo {
  name: string
  hwVersion?: string
  swVersion?: string
}

export class ScaleUnsupportedError extends Error {}

/** Why a connection is not possible, or null if it should work. */
export function bluetoothBlockedReason(): string | null {
  if (!('bluetooth' in navigator)) {
    return 'This browser has no Web Bluetooth. Chrome on Android or desktop Chrome will work; Safari and Firefox will not.'
  }
  if (!window.isSecureContext) {
    return 'Bluetooth needs a secure context. Open Salutt over HTTPS (or on localhost) rather than a plain http:// address.'
  }
  return null
}

export function parseFrame(view: DataView): ScaleReading | null {
  if (view.byteLength !== 22) return null

  const b = (i: number) => view.getUint8(i)
  const headerOk =
    b(0) === 0xa5 &&
    b(1) === 0x02 &&
    b(3) === 0x10 &&
    b(4) === 0x00 &&
    b(6) === 0x01 &&
    b(7) === 0x61 &&
    b(8) === 0xa1 &&
    b(9) === 0x00
  if (!headerOk) return null

  // 24-bit little-endian grams.
  const grams = b(10) | (b(11) << 8) | (b(12) << 16)
  const impedance = view.getUint16(13, true)

  return {
    // Rounded to 2 dp exactly as the reference implementation does — body fat
    // is floored off a BMI derived from this, so a stray gram can shift it.
    kg: pyRound(grams / 1000, 2),
    impedance: b(20) === 1 && impedance > 0 ? impedance : undefined,
    displayUnit: (['kg', 'lb', 'st'] as const)[b(21)] ?? 'kg',
    stable: b(19) === 1,
  }
}

export interface ScaleSession {
  info: ScaleInfo
  disconnect: () => void
}

interface ConnectOptions {
  onReading: (r: ScaleReading) => void
  onDisconnect?: () => void
  /** Reuse a device already granted permission, skipping the chooser. */
  preferKnownDevice?: boolean
}

/**
 * Opens the browser's device chooser, connects, and streams readings until
 * `disconnect()` is called. Must be invoked directly from a user gesture.
 */
export async function connectScale({
  onReading,
  onDisconnect,
  preferKnownDevice = true,
}: ConnectOptions): Promise<ScaleSession> {
  const blocked = bluetoothBlockedReason()
  if (blocked) throw new ScaleUnsupportedError(blocked)

  const bt = navigator.bluetooth
  let device: BluetoothDevice | undefined

  // getDevices() returns devices already granted permission, so repeat syncs
  // can skip the chooser entirely. It is not available everywhere, hence the
  // guarded call and the fall-through to requestDevice().
  if (preferKnownDevice && 'getDevices' in bt) {
    try {
      const known = await (bt as { getDevices(): Promise<BluetoothDevice[]> }).getDevices()
      device = known.find((d) => /etekcity|scale/i.test(d.name ?? ''))
    } catch {
      // Permission-backed device list unavailable; fall back to the chooser.
    }
  }

  if (!device) {
    device = await bt.requestDevice({
      filters: [{ namePrefix: 'Etekcity' }, { services: [CANDIDATE_SERVICES[0]] }],
      optionalServices: [...CANDIDATE_SERVICES, DEVICE_INFO_SERVICE],
    })
  }

  if (!device.gatt) throw new Error('That device does not expose GATT.')

  const server = await device.gatt.connect()

  // Find whichever service actually carries the weight characteristic.
  let notifyChar: BluetoothRemoteGATTCharacteristic | undefined
  let writeChar: BluetoothRemoteGATTCharacteristic | undefined
  const seen: string[] = []

  for (const uuid of CANDIDATE_SERVICES) {
    try {
      const service = await server.getPrimaryService(uuid)
      seen.push(uuid)
      notifyChar = await service.getCharacteristic(NOTIFY_CHARACTERISTIC)
      writeChar = await service.getCharacteristic(WRITE_CHARACTERISTIC).catch(() => undefined)
      break
    } catch {
      // Service absent, or present without the characteristic — keep looking.
    }
  }

  if (!notifyChar) {
    server.disconnect()
    throw new Error(
      `Connected to "${device.name ?? 'the scale'}" but found no weight characteristic. ` +
        (seen.length
          ? `Services present: ${seen.join(', ')}.`
          : 'None of the expected services were present.') +
        ' Send this message along and the service UUID can be added.',
    )
  }

  const info: ScaleInfo = { name: device.name ?? 'Etekcity scale' }
  try {
    const dis = await server.getPrimaryService(DEVICE_INFO_SERVICE)
    const dec = new TextDecoder()
    info.hwVersion = dec.decode(await (await dis.getCharacteristic(HW_REVISION)).readValue())
    info.swVersion = dec.decode(await (await dis.getCharacteristic(SW_REVISION)).readValue())
  } catch {
    // Version strings are cosmetic; never fail a sync over them.
  }

  const handler = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value
    if (!value) return
    const reading = parseFrame(value)
    if (reading) onReading(reading)
  }

  notifyChar.addEventListener('characteristicvaluechanged', handler)
  await notifyChar.startNotifications()

  const onGattDisconnected = () => onDisconnect?.()
  device.addEventListener('gattserverdisconnected', onGattDisconnected)

  // Ask the scale to display kilograms, so its screen agrees with the app.
  if (writeChar) {
    try {
      await writeChar.writeValueWithoutResponse(buildUnitCommand('kg'))
    } catch {
      // Purely cosmetic on the scale's own display.
    }
  }

  return {
    info,
    disconnect: () => {
      device.removeEventListener('gattserverdisconnected', onGattDisconnected)
      notifyChar.removeEventListener('characteristicvaluechanged', handler)
      try {
        notifyChar.stopNotifications()
      } catch {
        // Already gone.
      }
      if (device.gatt?.connected) device.gatt.disconnect()
    },
  }
}

/** Display-unit command for the fff2 characteristic. Byte 5 is a checksum. */
export function buildUnitCommand(unit: DisplayUnit): Uint8Array<ArrayBuffer> {
  const index = { kg: 0, lb: 1, st: 2 }[unit]
  const cmd = new Uint8Array(new ArrayBuffer(11))
  cmd.set([0xa5, 0x22, 0x03, 0x05, 0x00, 0x00, 0x01, 0x63, 0xa1, 0x00, 0x00])
  cmd[5] = 43 - index
  cmd[10] = index
  return cmd
}
