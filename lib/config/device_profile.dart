import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Device-level capabilities resolved once at startup (before `runApp`).
///
/// [isTv] is true only on real Android TV / Google TV devices (leanback UI
/// mode) — not on tablets that happen to be wide. Size-based layout decisions
/// stay in `breakpoints.dart`; this flag drives input-model decisions:
/// D-pad focus rings, no soft-keyboard autofocus, overscan-safe padding.
class DeviceProfile {
  DeviceProfile._();

  static const MethodChannel _channel = MethodChannel('veil/device');

  static bool _isTv = false;

  /// True when running on an Android TV / leanback device.
  static bool get isTv => _isTv;

  /// Resolve device capabilities. Call once from `main()` before `runApp`.
  /// Falls back to the phone profile when the platform side is unavailable
  /// (tests, fresh engines without the channel).
  static Future<void> init() async {
    try {
      _isTv = await _channel.invokeMethod<bool>('isTelevision') ?? false;
    } on PlatformException {
      _isTv = false;
    } on MissingPluginException {
      _isTv = false;
    }
  }

  @visibleForTesting
  static set debugIsTv(bool value) => _isTv = value;
}
