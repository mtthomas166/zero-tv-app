import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';

class PlayerScreen extends StatefulWidget {
  final String sourceUrl;
  final String title;
  const PlayerScreen({super.key, required this.sourceUrl, required this.title});

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  late final Player player;
  late final VideoController controller;

  @override
  void initState() {
    super.initState();
    player = Player(
      configuration: PlayerConfiguration(
        vo: 'mediacodec_embed',
        hwdec: 'mediacodec',
        title: 'Veil',
        osc: false,
        bufferSize: 32 * 1024 * 1024, // 32MB buffer عشان ميعلقش
      ),
    );
    controller = VideoController(player);
    player.open(Media(widget.sourceUrl), play: true);
  }

  @override
  void dispose() {
    player.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(title: Text(widget.title), backgroundColor: Colors.black),
      body: Center(
        child: Video(
          controller: controller,
          fit: BoxFit.contain,
          wakelock: true,
          controls: (state) => MaterialVideoControls(state),
        ),
      ),
    );
  }
}
