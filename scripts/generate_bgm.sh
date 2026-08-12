#!/usr/bin/env bash
# Regenerate Curate/share BGM loops into apps/web/public/bgm/ (~-18 LUFS, 48s mono MP3).
# Usage: from repo root: ./scripts/generate_bgm.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/apps/web/public/bgm"
mkdir -p "$OUT"

ffmpeg -y -f lavfi -i "sine=frequency=110:duration=48" -f lavfi -i "sine=frequency=165:duration=48" -f lavfi -i "anoisesrc=color=pink:amplitude=0.015:duration=48" \
  -filter_complex "[0][1][2]amix=inputs=3:normalize=0:dropout_transition=0,lowpass=f=2500,afade=t=in:st=0:d=0.8,afade=t=out:st=46.5:d=1.5,loudnorm=I=-18:TP=-2:LRA=8" \
  -ar 44100 -ac 1 -b:a 128k "$OUT/neutral.mp3"

ffmpeg -y -f lavfi -i "sine=frequency=130.81:duration=48" -f lavfi -i "sine=frequency=164.81:duration=48" -f lavfi -i "sine=frequency=196.00:duration=48" -f lavfi -i "sine=frequency=261.63:duration=48" \
  -filter_complex "[0][1][2][3]amix=inputs=4:normalize=0:dropout_transition=0,tremolo=f=0.25:d=0.35,lowpass=f=3200,afade=t=in:st=0:d=0.8,afade=t=out:st=46.5:d=1.5,loudnorm=I=-18:TP=-2:LRA=8" \
  -ar 44100 -ac 1 -b:a 128k "$OUT/warm.mp3"

ffmpeg -y -f lavfi -i "sine=frequency=110.00:duration=48" -f lavfi -i "sine=frequency=130.81:duration=48" -f lavfi -i "sine=frequency=164.81:duration=48" \
  -filter_complex "[0][1][2]amix=inputs=3:normalize=0:dropout_transition=0,lowpass=f=1800,afade=t=in:st=0:d=1.2,afade=t=out:st=46.5:d=1.5,loudnorm=I=-19:TP=-2:LRA=8" \
  -ar 44100 -ac 1 -b:a 128k "$OUT/reflective.mp3"

ffmpeg -y -f lavfi -i "sine=frequency=196.00:duration=48" -f lavfi -i "sine=frequency=293.66:duration=48" -f lavfi -i "sine=frequency=392.00:duration=48" \
  -filter_complex "[0][1][2]amix=inputs=3:normalize=0:dropout_transition=0,tremolo=f=0.5:d=0.45,highpass=f=180,lowpass=f=4000,afade=t=in:st=0:d=0.6,afade=t=out:st=46.5:d=1.5,loudnorm=I=-18:TP=-2:LRA=8" \
  -ar 44100 -ac 1 -b:a 128k "$OUT/nostalgic.mp3"

echo "Wrote BGM loops to $OUT — bump ?v= query in web bgmPublicSrc if browsers cache old files."
