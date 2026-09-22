import 'package:flutter/material.dart';
import 'package:pstream_android/config/app_theme.dart';

/// TV-friendly focus treatment for card-like widgets: scales the child up
/// slightly and paints a bright rounded border + soft glow while [focused].
///
/// Purely visual — pair it with the child `InkWell.onFocusChange` so the
/// ring follows keyboard/D-pad focus. On touch devices focus never activates,
/// so wrapping is free.
class FocusRing extends StatelessWidget {
  const FocusRing({
    super.key,
    required this.focused,
    required this.child,
    this.borderRadius,
    this.scale = 1.04,
  });

  final bool focused;
  final Widget child;
  final BorderRadius? borderRadius;

  /// Scale applied while focused. Use 1.0 to disable the zoom.
  final double scale;

  @override
  Widget build(BuildContext context) {
    final BorderRadius radius =
        borderRadius ?? BorderRadius.circular(AppSpacing.x4);

    return AnimatedScale(
      scale: focused ? scale : 1.0,
      duration: const Duration(milliseconds: 140),
      curve: Curves.easeOutCubic,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        curve: Curves.easeOutCubic,
        decoration: BoxDecoration(
          borderRadius: radius,
          boxShadow: focused
              ? <BoxShadow>[
                  BoxShadow(
                    color: AppColors.purpleC200.withValues(alpha: 0.4),
                    blurRadius: 18,
                    spreadRadius: 1,
                  ),
                ]
              : const <BoxShadow>[],
        ),
        foregroundDecoration: BoxDecoration(
          borderRadius: radius,
          border: Border.all(
            color: focused ? AppColors.purpleC50 : AppColors.transparent,
            width: 2.5,
          ),
        ),
        child: child,
      ),
    );
  }
}
