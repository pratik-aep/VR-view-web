#!/usr/bin/env bash
# Cut a clean section out of a 360° video and make it loop seamlessly.
#
#   tools/make_seamless_loop.sh IN.mp4 OUT.mp4 START END [CROSSFADE]
#
# Keeps START..END seconds (drop intro titles / end credits), then crossfades
# the last CROSSFADE seconds into the first ones, video and audio alike. The
# output ends on exactly the frame it starts from, so `loop` shows no jump.
# Output length = END - START - CROSSFADE.
#
# Optional PREFILTER env var: an ffmpeg video filter applied to the whole frame
# first, e.g. PREFILTER="delogo=x=905:y=445:w=120:h=115" to remove a logo.
set -euo pipefail

in=$1 out=$2 start=$3 end=$4 xf=${5:-2}
len=$(echo "${end} - ${start}" | bc)
body=$(echo "${len} - ${xf}" | bc)
pre=${PREFILTER:+${PREFILTER},}

ffmpeg -v error -y -i "${in}" -filter_complex "
[0:v]${pre}trim=start=${start}:end=${end},setpts=PTS-STARTPTS,split[v1][v2];
[v1]trim=start=${body}:end=${len},setpts=PTS-STARTPTS[vtail];
[v2]trim=start=0:end=${body},setpts=PTS-STARTPTS[vbody];
[vtail][vbody]xfade=transition=fade:duration=${xf}:offset=0,format=yuv420p[v];
[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,asplit[a1][a2];
[a1]atrim=start=${body}:end=${len},asetpts=PTS-STARTPTS[atail];
[a2]atrim=start=0:end=${body},asetpts=PTS-STARTPTS[abody];
[atail][abody]acrossfade=d=${xf}:c1=tri:c2=tri[a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -preset slow -crf 21 -g 30 -fps_mode cfr \
  -c:a aac -b:a 160k -movflags +faststart -shortest "${out}"

echo "Wrote ${out} ($(echo "${body}" | bc) s loop from ${start}-${end} s, ${xf} s crossfade)"
