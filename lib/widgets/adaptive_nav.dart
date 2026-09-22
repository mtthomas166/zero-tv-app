import 'dart:ui';

import 'package:flutter/material.dart';

import '../config/app_theme.dart';
import '../config/breakpoints.dart';
import '../config/device_profile.dart';

/// Shell navigation, adaptive per form factor:
///
/// - **compact (phones)** — glass bottom dock ([NavigationBar]).
/// - **medium / expanded (tablets)** — glass side rail on the left, same
///   Veil dark + purple tokens.
/// - **TV (leanback devices)** — side rail with D-pad focus rings plus
///   overscan-safe padding around the content area.
class AdaptiveNav extends StatelessWidget {
  const AdaptiveNav({
    super.key,
    required this.currentIndex,
    required this.onDestinationSelected,
    required this.child,
  });

  final int currentIndex;
  final ValueChanged<int> onDestinationSelected;
  final Widget child;

  static const List<_AdaptiveNavDestination> _destinations = [
    _AdaptiveNavDestination(
      label: 'Home',
      icon: Icons.home_outlined,
      selectedIcon: Icons.home_rounded,
    ),
    _AdaptiveNavDestination(label: 'Search', icon: Icons.search_rounded),
    _AdaptiveNavDestination(
      label: 'My list',
      icon: Icons.bookmark_outline_rounded,
      selectedIcon: Icons.bookmark_rounded,
    ),
    _AdaptiveNavDestination(
      label: 'Live TV',
      icon: Icons.live_tv_outlined,
      selectedIcon: Icons.live_tv_rounded,
    ),
    _AdaptiveNavDestination(
      label: 'Sports',
      icon: Icons.sports_soccer_outlined,
      selectedIcon: Icons.sports_soccer,
    ),
    _AdaptiveNavDestination(
      label: 'Settings',
      icon: Icons.settings_outlined,
      selectedIcon: Icons.settings_rounded,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final WindowClass layoutClass = windowClass(context);
    final bool useRail =
        DeviceProfile.isTv || layoutClass != WindowClass.compact;

    if (useRail) {
      return _buildRailScaffold(context);
    }
    return _buildDockScaffold(context, layoutClass);
  }

  /// Tablets + TV: left glass rail. The rail lives in the same directional
  /// focus space as the content, so on TV pressing left from the leftmost
  /// item lands on the rail and select activates a tab.
  Widget _buildRailScaffold(BuildContext context) {
    final bool tv = DeviceProfile.isTv;
    final EdgeInsets contentPadding = tv
        ? const EdgeInsets.fromLTRB(0, 12, 24, 12)
        : EdgeInsets.zero;

    return Scaffold(
      backgroundColor: AppColors.backgroundMain,
      body: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          SafeArea(
            right: false,
            child: _GlassNavRail(
              destinations: _destinations,
              currentIndex: currentIndex,
              onDestinationSelected: onDestinationSelected,
            ),
          ),
          Expanded(
            child: Padding(padding: contentPadding, child: child),
          ),
        ],
      ),
    );
  }

  /// Phones: original glass bottom dock.
  Widget _buildDockScaffold(BuildContext context, WindowClass layoutClass) {
    final double dockHorizontal = switch (layoutClass) {
      WindowClass.compact => AppSpacing.x4,
      WindowClass.medium => AppSpacing.x8,
      WindowClass.expanded => AppSpacing.x10,
    };

    return Scaffold(
      backgroundColor: AppColors.backgroundMain,
      body: child,
      bottomNavigationBar: SafeArea(
        top: false,
        minimum: EdgeInsets.zero,
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            dockHorizontal,
            AppSpacing.x2,
            dockHorizontal,
            AppSpacing.x3,
          ),
          child: RepaintBoundary(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppSpacing.x8),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: AppColors.glassSheet,
                    borderRadius: BorderRadius.circular(AppSpacing.x8),
                    border: Border.all(
                      color: AppColors.glassBorder,
                    ),
                    boxShadow: <BoxShadow>[
                      BoxShadow(
                        color: AppColors.blackC50.withValues(alpha: 0.5),
                        blurRadius: 12,
                        offset: const Offset(0, -2),
                      ),
                    ],
                  ),
                  child: NavigationBar(
                    height: 64,
                    backgroundColor: AppColors.transparent,
                    surfaceTintColor: AppColors.transparent,
                    indicatorColor: AppColors.purpleC600.withValues(alpha: 0.35),
                    selectedIndex: currentIndex,
                    onDestinationSelected: onDestinationSelected,
                    labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
                    destinations: _destinations.asMap().entries.map(
                      (MapEntry<int, _AdaptiveNavDestination> e) {
                        final bool selected = currentIndex == e.key;
                        return NavigationDestination(
                          icon: Icon(e.value.icon),
                          selectedIcon: Icon(e.value.resolvedIcon(selected)),
                          label: e.value.label,
                        );
                      },
                    ).toList(growable: false),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Vertical glass rail used on tablets and TV. Items are InkWell-based so
/// they are focusable and activate with D-pad select; a purple focus pill
/// makes the focused item unmistakable on a 10-foot screen.
class _GlassNavRail extends StatelessWidget {
  const _GlassNavRail({
    required this.destinations,
    required this.currentIndex,
    required this.onDestinationSelected,
  });

  final List<_AdaptiveNavDestination> destinations;
  final int currentIndex;
  final ValueChanged<int> onDestinationSelected;

  @override
  Widget build(BuildContext context) {
    final bool tv = DeviceProfile.isTv;
    final double railWidth = tv ? 96 : 84;
    final EdgeInsets margin = tv
        ? const EdgeInsets.fromLTRB(24, 12, AppSpacing.x3, 12)
        : const EdgeInsets.fromLTRB(
            AppSpacing.x3,
            AppSpacing.x3,
            AppSpacing.x3,
            AppSpacing.x3,
          );

    return Padding(
      padding: margin,
      child: RepaintBoundary(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppSpacing.x6),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
            child: Container(
              width: railWidth,
              decoration: BoxDecoration(
                color: AppColors.glassSheet,
                borderRadius: BorderRadius.circular(AppSpacing.x6),
                border: Border.all(color: AppColors.glassBorder),
              ),
              child: FocusTraversalGroup(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: destinations.asMap().entries.map(
                    (MapEntry<int, _AdaptiveNavDestination> e) {
                      return _RailItem(
                        destination: e.value,
                        selected: currentIndex == e.key,
                        onTap: () => onDestinationSelected(e.key),
                      );
                    },
                  ).toList(growable: false),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _RailItem extends StatefulWidget {
  const _RailItem({
    required this.destination,
    required this.selected,
    required this.onTap,
  });

  final _AdaptiveNavDestination destination;
  final bool selected;
  final VoidCallback onTap;

  @override
  State<_RailItem> createState() => _RailItemState();
}

class _RailItemState extends State<_RailItem> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final bool highlight = _focused;
    final Color iconColor = widget.selected || highlight
        ? AppColors.typeEmphasis
        : AppColors.typeSecondary;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.x2,
        vertical: AppSpacing.x1,
      ),
      child: Material(
        color: AppColors.transparent,
        borderRadius: BorderRadius.circular(AppSpacing.x4),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppSpacing.x4),
          focusColor: AppColors.purpleC600.withValues(alpha: 0.45),
          onTap: widget.onTap,
          onFocusChange: (bool value) => setState(() => _focused = value),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 140),
            curve: Curves.easeOutCubic,
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.x2),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppSpacing.x4),
              border: Border.all(
                color: highlight ? AppColors.purpleC50 : AppColors.transparent,
                width: 2,
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: widget.selected
                        ? AppColors.purpleC600.withValues(alpha: 0.45)
                        : AppColors.transparent,
                    borderRadius: BorderRadius.circular(AppSpacing.x4),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.x4,
                      vertical: AppSpacing.x1,
                    ),
                    child: Icon(
                      widget.destination.resolvedIcon(widget.selected),
                      color: iconColor,
                      size: AppSpacing.x6,
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.x1),
                Text(
                  widget.destination.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: iconColor,
                        fontWeight: widget.selected
                            ? FontWeight.w700
                            : FontWeight.w500,
                      ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AdaptiveNavDestination {
  const _AdaptiveNavDestination({
    required this.label,
    required this.icon,
    this.selectedIcon,
  });

  final String label;
  final IconData icon;
  final IconData? selectedIcon;

  IconData resolvedIcon(bool selected) {
    if (selected && selectedIcon != null) {
      return selectedIcon!;
    }
    return icon;
  }
}
