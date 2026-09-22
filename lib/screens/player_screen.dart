import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:better_player_plus/better_player_plus.dart';
import 'package:pstream_android/models/media_item.dart';

class PlayerScreenArgs {
  final MediaItem mediaItem;
  final dynamic omssResponse;
  final int? season;
  final int? episode;
  final int? resumeFrom;
  final int? replaceEpoch;
  // دول اللي كانوا ناقصين وبيوقعوا الـ Analyze
  final int? seasonTmdbId;
  final int? episodeTmdbId;
  final String? seasonTitle;
  final bool? isLive;
  final String? liveChannelName;
  final String? liveCurrentProgram;

  const PlayerScreenArgs({
    required this.mediaItem,
    this.omssResponse,
    this.season,
    this.episode,
    this.resumeFrom,
    this.replaceEpoch,
    this.seasonTmdbId,
    this.episodeTmdbId,
    this.seasonTitle,
    this.isLive,
    this.liveChannelName,
    this.liveCurrentProgram,
  });
}

class PlayerScreen extends ConsumerStatefulWidget {
  final PlayerScreenArgs? args;
  final String? sourceUrl;
  final String? title;

  const PlayerScreen({
    super.key,
    this.args,
    this.sourceUrl,
    this.title,
  }) : assert(args != null || sourceUrl != null, 'Provide args or sourceUrl');

  @override
  ConsumerState<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends ConsumerState<PlayerScreen> {
  late BetterPlayerController _controller;
  bool _initialized = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final url = _resolveUrl();
      if (url.isEmpty) {
        setState(() => _error = 'No stream URL - check omssResponse');
        return;
      }

      final dataSource = BetterPlayerDataSource(
        BetterPlayerDataSourceType.network,
        url,
        bufferingConfiguration: const BetterPlayerBufferingConfiguration(
          minBufferMs: 50000,
          maxBufferMs: 131072,
          bufferForPlaybackMs: 2500,
          bufferForPlaybackAfterRebufferMs: 5000,
        ),
      );

      _controller = BetterPlayerController(
        const BetterPlayerConfiguration(
          autoPlay: true,
          fit: BoxFit.contain,
          autoDispose: true,
          handleLifecycle: true,
        ),
        betterPlayerDataSource: dataSource,
      );

      if (widget.args?.resumeFrom != null && widget.args!.resumeFrom! > 0) {
        _controller.seekTo(Duration(seconds: widget.args!.resumeFrom!));
      }

      setState(() => _initialized = true);
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  String _resolveUrl() {
    if (widget.sourceUrl != null && widget.sourceUrl!.isNotEmpty) {
      return widget.sourceUrl!;
    }
    final omss = widget.args?.omssResponse;
    if (omss is String) return omss;
    if (omss is Map) {
      if (omss['url'] != null) return omss['url'].toString();
      if (omss['streamUrl'] != null) return omss['streamUrl'].toString();
    }
    return '';
  }

  @override
  void dispose() {
    if (_initialized) _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final displayTitle = widget.title ?? widget.args?.mediaItem.title ?? 'Player';

    if (_error != null) {
      return Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(title: Text(displayTitle), backgroundColor: Colors.black),
        body: Center(child: Text(_error!, style: const TextStyle(color: Colors.white))),
      );
    }

    if (!_initialized) {
      return Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(title: Text(displayTitle), backgroundColor: Colors.black),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(title: Text(displayTitle), backgroundColor: Colors.black),
      body: Center(child: BetterPlayer(controller: _controller)),
    );
  }
}
