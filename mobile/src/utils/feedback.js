import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

/**
 * Press feedback: a short click and a light haptic tick.
 *
 * One player is created lazily and rewound on every tap, so a press never waits
 * on loading a file. The click mixes with whatever else is playing and respects
 * the silent switch. Any failure is swallowed: feedback must never block a tap.
 */

let player = null;

function getPlayer() {
  if (player) return player;
  try {
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
    player = createAudioPlayer(require('../../assets/sounds/tap.wav'));
    player.volume = 0.6;
  } catch {
    player = null;
  }
  return player;
}

export function playTap() {
  const current = getPlayer();
  if (!current) return;
  try {
    current.seekTo(0).catch(() => {});
    current.play();
  } catch {
    // Audio unavailable on this device; the haptic still fires.
  }
}

export function tapFeedback(style = 'light') {
  playTap();
  if (Platform.OS === 'web') return;
  const impact = style === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light;
  Haptics.impactAsync(impact).catch(() => {});
}
