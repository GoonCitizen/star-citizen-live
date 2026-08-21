# Poll HID key state for GoonCitizen push-to-talk (macOS).
# Prints 1/0 when the combo is held. Args: mainKey [shiftCodes] [altCodes] [ctrlCodes] [metaCodes]
# Modifier groups are comma-separated keycodes; empty string means not required.
# Example: 48 56,60   (Tab + either Shift)

import ctypes
import sys
import time

HID = 1  # kCGEventSourceStateHIDSystemState


def load_fn():
    paths = (
        '/System/Library/Frameworks/Carbon.framework/Carbon',
        '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices',
        '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics',
    )
    last = None
    for path in paths:
        try:
            lib = ctypes.CDLL(path)
            fn = lib.CGEventSourceKeyState
            fn.argtypes = [ctypes.c_int, ctypes.c_uint16]
            fn.restype = ctypes.c_ubyte
            return fn
        except Exception as err:
            last = err
    raise SystemExit('CGEventSourceKeyState unavailable: %s' % last)


def parse_group(raw):
    raw = (raw or '').strip()
    if not raw:
        return []
    out = []
    for part in raw.split(','):
        part = part.strip()
        if not part:
            continue
        out.append(int(part, 10))
    return out


def group_down(fn, codes):
    if not codes:
        return True
    for code in codes:
        if fn(HID, code):
            return True
    return False


def main():
    if len(sys.argv) < 2:
        raise SystemExit('usage: voicePttPollDarwin.py main [shift] [alt] [ctrl] [meta]')
    main_code = int(sys.argv[1], 10)
    shift = parse_group(sys.argv[2] if len(sys.argv) > 2 else '')
    alt = parse_group(sys.argv[3] if len(sys.argv) > 3 else '')
    ctrl = parse_group(sys.argv[4] if len(sys.argv) > 4 else '')
    meta = parse_group(sys.argv[5] if len(sys.argv) > 5 else '')
    fn = load_fn()
    last = None
    while True:
        held = bool(fn(HID, main_code))
        held = held and group_down(fn, shift)
        held = held and group_down(fn, alt)
        held = held and group_down(fn, ctrl)
        held = held and group_down(fn, meta)
        bit = 1 if held else 0
        if bit != last:
            sys.stdout.write('%d\n' % bit)
            sys.stdout.flush()
            last = bit
        time.sleep(0.04)


if __name__ == '__main__':
    main()
