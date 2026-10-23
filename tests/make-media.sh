#!/bin/sh
# Recrée les vidéos de test (WebM) utilisées par le faux fournisseur. Nécessite ffmpeg.
cd "$(dirname "$0")/media"
F=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}
mk() {
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=$4:s=640x360:r=25:d=$3" -f lavfi -i "sine=frequency=440:duration=$3" \
 -vf "drawtext=fontfile=$F:text='$2':fontcolor=white:fontsize=48:x=(w-tw)/2:y=(h-th)/2-30,drawtext=fontfile=$F:text='%{pts\:hms}':fontcolor=white:fontsize=30:x=(w-tw)/2:y=(h/2)+40" \
 -c:v libvpx -b:v 300k -deadline realtime -c:a libopus -b:a 48k -shortest "$1.webm"; }
mk live1 "Chaine Test 1" 120 0x1d4e89
mk live2 "Chaine Test 2" 120 0x7a1f3d
mk live3 "Chaine Test 3" 120 0x2f6b3a
mk movie40 "Film de test" 40 0x553311
ffmpeg -hide_banner -loglevel error -y -stream_loop 5 -i movie40.webm -c copy movie.webm && rm movie40.webm
mk ep1 "Episode 1" 6 0x333366
mk ep2 "Episode 2" 6 0x336633
mk ep3 "Episode 3" 6 0x663333
printf '1\n00:00:00,500 --> 00:00:30,000\nBonjour, ceci est un sous-titre français.\n\n2\n00:00:30,000 --> 00:04:00,000\nToujours en français.\n' > fr.srt
printf '1\n00:00:00,500 --> 00:00:30,000\nHello, this is an English subtitle.\n\n2\n00:00:30,000 --> 00:04:00,000\nStill English.\n' > en.srt
ffmpeg -hide_banner -loglevel error -y -i movie.webm -f lavfi -i "sine=frequency=880:duration=240" -i fr.srt -i en.srt \
 -map 0:v -map 0:a -map 1:a -map 2 -map 3 -c:v copy -c:a:0 copy -c:a:1 libopus -b:a:1 48k -c:s webvtt \
 -metadata:s:a:0 language=fre -metadata:s:a:0 title="VF" -metadata:s:a:1 language=eng -metadata:s:a:1 title="VO" \
 -metadata:s:s:0 language=fre -metadata:s:s:1 language=eng -shortest multi.webm
ls -la
