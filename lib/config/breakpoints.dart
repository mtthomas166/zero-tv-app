import 'package:flutter/widgets.dart';

import 'package:pstream_android/config/device_profile.dart';

enum WindowClass { compact, medium, expanded }

enum HandsetDensity { small, regular, large }

WindowClass windowClass(BuildContext context) {
  final width = MediaQuery.sizeOf(context).width;

  if (width < 600) {
    return WindowClass.compact;
  }

  if (width < 960) {
    return WindowClass.medium;
  }

  return WindowClass.expanded;
}

int gridCols(BuildContext context) {
  // 10-foot UI: more, smaller tiles read better and keep D-pad travel short.
  if (DeviceProfile.isTv) {
    return 5;
  }

  switch (windowClass(context)) {
    case WindowClass.compact:
      return 2;
    case WindowClass.medium:
      return 3;
    case WindowClass.expanded:
      return 4;
  }
}

/// True only on real leanback (Android TV / Google TV) devices. Wide tablets
/// stay tablets — use [windowClass] for size-based layout decisions.
bool isTV(BuildContext context) {
  return DeviceProfile.isTv;
}

HandsetDensity handsetDensity(BuildContext context) {
  final Size size = MediaQuery.sizeOf(context);
  final double shortestSide = size.shortestSide;

  if (shortestSide < 380) {
    return HandsetDensity.small;
  }

  if (shortestSide < 460) {
    return HandsetDensity.regular;
  }

  return HandsetDensity.large;
}

bool isSmallHandset(BuildContext context) {
  return handsetDensity(context) == HandsetDensity.small;
}
