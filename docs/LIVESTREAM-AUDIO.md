# Livestream audio — the OBS configuration for the club's YouTube broadcasts

**Decided by the owner, 2026-10-29.** Race-day and club-day equipment, not platform code: nothing
here runs on Vercel or touches the site. The companion page for race day is
[`docs/FINISH-PHOTOS.md`](./FINISH-PHOTOS.md); a broadcast's recording, if the club keeps one, is
published later like any film (`DECISIONS.md` §481).

Two kinds of broadcast share one OBS audio configuration: a **two-webcam broadcast** (a talk, a
club evening, an announcement: people speaking to the camera) and a **finish-line broadcast** (the
race's finish: the announcer, the runners, the crowd). Each has its own profile below; the
settings, filters, music and emergency procedures are the same for both.

Two kinds of value appear here, and the difference matters:

- **Fixed** — the club's decision. Every broadcast uses it; change the decision here first.
- **Starting value** — a number to begin from. Each microphone and each place sounds different, so
  these are adjusted by ear, at the venue, while listening to the real output. They are not
  settings to copy and forget.

Nothing on this page makes a broadcast free of copyright claims or immune to interruption. It
lowers the odds and says what to do when it happens anyway.

## What is fixed

| Setting | Where in OBS | Value |
| --- | --- | --- |
| Sample rate | «Settings» → «Audio» → «General» → «Sample Rate» | **48 kHz** — the rate video and YouTube work at; a device set to 44.1 kHz in Windows is resampled, which costs quality and can drift, so set the microphone's own device to 48 kHz in Windows too |
| Channels | «Settings» → «Audio» → «General» → «Channels» | **Stereo** |
| Desktop Audio | «Settings» → «Audio» → «Global Audio Devices» → «Desktop Audio» | **Disabled** |
| Desktop Audio 2 | the same list → «Desktop Audio 2» | **Disabled** |
| Microphones | the same list → «Mic/Auxiliary Audio» 1–4 | **Only the microphone the broadcast needs**, chosen by its device name; every other slot «Disabled». A webcam's built-in microphone is never a global device; if one is wanted at all it is an explicit source in the scene (below) |
| Streaming audio | «Settings» → «Output» → «Output Mode» «Advanced» → «Audio» | **AAC, 160 kbps, Track 1**: the encoder named AAC on the laptop (OBS names it by its library, so the label reads «FFmpeg AAC», «CoreAudio AAC» or similar), «Track 1» «Audio Bitrate» 160; under the «Streaming» tab «Audio Track» 1. Every source sends to track 1 («Advanced Audio Properties» → «Tracks») |
| Music source | the «Sources» dock, see § Background music | A «Media Source» named **«BR Background Music»**, «Local File» ticked, «Loop» ticked |

Why Desktop Audio stays off: it is everything the laptop plays — a notification, a browser tab,
YouTube Studio's own preview of the stream — and the surest way to put an unlicensed song or an
echo on air by accident. Music goes in as its own source (below), never through the desktop.

Why only the microphones the broadcast needs: every open microphone adds room noise, and two that
hear the same room add an echo. A source that is not in the scene cannot be on air by mistake.

## The microphone filters

Right-click the microphone source → «Filters» → «+» under «Audio Filters». The order is the order
the sound passes through, top to bottom, and it matters: clean first, then shape, then protect.

| Order | Filter (OBS's name) | What it does | Starting values |
| --- | --- | --- | --- |
| 1 | «Noise Suppression» | Removes steady noise: the laptop's fan, wind, the hum of a generator | «Method»: **RNNoise** (the entry marked higher quality, more CPU) — it has no other setting. Keep «Speex» for a weak laptop only; its «Suppression Level» starts at −30 dB |
| 2 | «Expander» — or «Noise Gate» | Turns the microphone down between words so the room does not come up when nobody speaks. The expander is gentle and is the one to start with; a gate cuts hard and clips the start of words when set wrong | Expander: «Presets» «Expander», «Ratio» 2:1, «Threshold» −40 dB, «Attack» 10 ms, «Release» 50 ms, «Output Gain» 0 dB, «Detection» RMS. Noise Gate, if used instead: «Close Threshold» −40 dB, «Open Threshold» −35 dB, «Attack Time» 25 ms, «Hold Time» 200 ms, «Release Time» 150 ms |
| 3 | «Compressor» | Evens out a voice that moves between a murmur and a shout, so the quiet words are heard and the loud ones do not jump | «Ratio» 3:1 (OBS's default of 10:1 is far too much for speech), «Threshold» −18 dB, «Attack» 6 ms, «Release» 60 ms, «Output Gain» +3 dB, no «Sidechain/Ducking Source» |
| 4 | «Limiter» | The last guard: nothing goes past the ceiling, so a shout at the finish cannot distort the stream | «Threshold» −3 dB, «Release» 60 ms |

How to set them: speak, or have the announcer speak, at the real distance and the real volume,
and watch the microphone's meter in the «Audio Mixer». Speech should peak in the yellow, around
−12 to −6 dB, and never touch the red. Then listen to the actual output (§ Before every broadcast,
step 5). If the noise suppression makes the voice sound hollow or underwater, that microphone is
too far from the mouth or the room is too loud for it — move the microphone before touching the
filter. If words lose their first syllable, the expander's threshold is too high or its attack too
slow. If the voice pumps up and down, the compressor's ratio is too high. Every number in the table
is a place to start; the microphone, its distance and the venue decide where it ends.

OBS's filters work on the whole signal. **None of them can take a song out of a microphone while
keeping the voice** — see § Copyright risk.

## The two profiles

### Two-webcam broadcast

The goal is clear speech. Two cameras, **one primary microphone**, and nothing else open.

- **One microphone, chosen on purpose** — a USB or lapel microphone near the speaker, as the one
  «Mic/Auxiliary Audio» device, with the filters above. Which microphone the club uses is not decided
  here; it is listed on the equipment list the day it is bought.
- **No webcam microphone on air.** Each webcam is a «Video Capture Device» source, and a webcam
  with a microphone gets its own row in the «Audio Mixer»: mute that row and keep it muted, and in
  «Advanced Audio Properties» untick every track for it, so it reaches neither the stream nor a
  recording. Two webcams in the same
  room both hearing the same voice is an echo, each a few milliseconds behind the other, and the
  surest way to make speech unintelligible. The check: exactly one microphone row moves in the
  «Audio Mixer» when somebody speaks.
- **Nothing unnecessary.** Desktop Audio off, the second microphone slot off, no browser source
  with sound. The mixer shows the one microphone and, if wanted, «BR Background Music».
- **Music, if any, low.** Under speech, the music is a bed, not a track: § Background music.

### Finish-line broadcast

The goal is the announcer and the runners: the names called, the cheers, the sound of the line.

- **The announcer's microphone first.** It is the primary microphone with the filters above, close
  to the mouth, and its level is set before anything else. A second microphone for the crowd and
  the line is optional, explicitly added, lower, and the first thing to mute when the mix gets
  muddy.
- **Away from the event loudspeakers.** The PA is the loudest thing at the line. A microphone that
  faces a speaker, or stands within a few metres of one, broadcasts the PA, not the race: feedback,
  distortion, and whatever the PA plays. Point every microphone away from the speakers, behind
  them where possible, and use directional microphones close to their source rather than an open
  microphone on a stand.
- **The PA's music is a copyright problem the club cannot filter out.** Whatever plays over the
  event loudspeakers — a DJ, a playlist, the sponsor's jingle — reaches the microphones, and YouTube's
  matching hears it as music in the stream. No OBS filter removes it while keeping the announcer.
  The only reliable measures are distance from the speakers, a close-talking microphone for the
  announcer, and the mute hotkey (§ Copyright risk). If the club chooses the music the PA plays,
  licensed music there too removes most of the risk; the choice is the event's, not OBS's.

## Background music

**The music, and its license.** Downloaded electronic tracks from [StreamBeats](https://www.streambeats.com/),
or another source whose license says in writing that it covers a YouTube livestream. StreamBeats'
own terms are at [streambeats.com/licensing](https://www.streambeats.com/licensing/): as read on
2026-10-29, a free, worldwide, non-exclusive, royalty-free, perpetual «Sync License» from Senpai
Records, LLC to sync the music with video on Twitch, YouTube, podcasts and similar platforms;
attribution is encouraged, not required; the music may not be redistributed on its own, re-uploaded
to a music platform or played as a music-only station; a game, a film or a TV production needs a
separate license; and a false Content ID claim is reported to them and they clear it. Read the page
itself before the first broadcast — the terms can change, and the summary here is not the license.

**Keep the proof.** For every track the club downloads, keep, next to the file on the laptop and in
the club's own drive: the track's title and artist, the collection it came from, the date of the
download, where it was downloaded from, and a copy (a PDF print) of the license page as it read
that day. A claim on YouTube is answered with these. **No music file is ever committed to this
repository** — it is public, and the license does not allow redistribution.

**The source in OBS.** In the scene, «Sources» → «+» → «Media Source», named exactly
**«BR Background Music»**. Properties: «Local File» ticked, the track or a playlist file chosen,
«Loop» ticked. Leave «Restart playback when source becomes active» ticked so the music starts
from the beginning when the scene comes up; untick it if the music must carry on across a scene
change (then see below). In the «Audio Mixer» set its fader to about **−25 dB** to begin with;
raise or lower it while someone speaks, listening to the real output, until the voice is clearly
on top and the music is only felt. Speech wins every time; a bed that competes with the announcer is
too loud.

**It stays inside OBS.** Desktop Audio is disabled, so the music can only reach the stream through
this source. It is never played through the event's loudspeakers from the same laptop: a loop from
the speakers back into the microphones doubles it, delayed, and the stream gets both. If the
venue wants music in the room, that is the PA's own player, and the microphones stay away from it
(§ Finish-line broadcast).

**One source for every scene, or one per scene.** Two ways, each right for something:

- *Shared.* When adding the source to a second scene, choose «Add Existing» instead of
  «Create new» and pick «BR Background Music». The same source is then in both scenes: one file,
  one fader, one mute, and when «Restart playback when source becomes active» is off, the music
  keeps playing across the scene change. This is the default for the two-webcam broadcast.
- *Independent.* A separate «Media Source» in each scene (a different name, so the mixer rows are
  told apart), each with its own file and level. For a finish-line broadcast whose warm-up scene
  wants music and whose finish scene wants none, this is simpler than remembering to mute.

Either way, the mute hotkey below must point at every music row that exists.

## Copyright risk, and what to do when YouTube acts

**What the configuration cannot do.** OBS's filters shape a signal; they do not separate a song from
a voice recorded through the same microphone. Noise suppression, gating and compression leave music
in the stream, and the aggressive settings that would dent it damage the speech first. Licensed
music can still draw a claim: StreamBeats and others say their catalogue is registered with YouTube's
Content ID so that the match is cleared, but a false or mistaken claim is possible — and a claim
on music the PA plays is not false at all.

**Before the broadcast opens**, two things are in place, always:

1. **YouTube Studio open and signed in**, on the streaming laptop or a second device, on the live
   control room of the broadcast. Warnings about matched content, a stream's interruption and the
   stream's health are shown there and nowhere else.
2. **A mute hotkey, set and tested.** «Settings» → «Hotkeys», find the row for the microphone
   source and the row for «BR Background Music» (and any other music row), set «Mute» and «Unmute»
   on keys that are easy to hit without looking — a single function key per source — and test them
   with the «Audio Mixer» in view: the row's speaker icon crosses out at once. The music's mute is
   the one that matters most, because a claim is about music; the microphone's mute is the answer
   when the PA is the problem. A hotkey is not tested until the key was pressed on this laptop, on
   this day, with this profile loaded.

**If YouTube shows a copyright warning during the stream** (a banner in the live control room, or
a placeholder picture on the viewer's side): press the music's mute hotkey immediately; if the
music was already off, mute the microphone nearest the loudspeakers. The stream continues. Note
the time and what was playing — the club's licensed track, or the PA — for the claim afterwards.

**If YouTube interrupts the stream** (viewers see a placeholder; the control room says the stream
is paused for matched content): mute the music source, and the exposed microphone; stay live in OBS
and keep the encoder running — the stream usually resumes on its own once the matched audio stops.
Tell the room what happened so the announcer does not start a song.

**If YouTube terminates the stream:** stop streaming in OBS; read what YouTube Studio says the
cause was; fix it (the music off, the microphone moved); start a new broadcast and post the new
link where the first one was announced — the site's «În direct» notice too, unless its address is
the channel's «live» page, which follows the new stream by itself. Do not argue the point live.

**After the broadcast:** read the broadcast's «Copyright» panel in YouTube Studio. A Content ID
claim on the archived video for a licensed track is disputed with the license proof kept above
(and reported to StreamBeats, who clear their own); a claim for music the PA played is accepted,
and the archived video's matched part is muted or trimmed with YouTube's own tools, or the video
is not published at all. A copyright **strike** is a different thing from a claim and comes from a
removal request: it can suspend the channel's live streaming for a period YouTube sets and counts
towards the channel's three. Never dispute a claim the club cannot back with a license — a dispute
without grounds is what turns a claim into a removal request.

## Before every broadcast

A checklist, run in the venue with the real equipment, in this order:

1. **Profile and scene collection.** OBS opened on the right profile; «Settings» → «Audio» reads
   48 kHz, Stereo, Desktop Audio and Desktop Audio 2 «Disabled», the one microphone named; «Settings»
   → «Output» reads AAC, 160 kbps, Track 1.
2. **Audio routing.** In the «Audio Mixer» only the expected rows exist: the microphone (and the
   optional second one), «BR Background Music». Every webcam's own audio is absent or muted. Every
   row sends to Track 1 («Advanced Audio Properties»). «Audio Monitoring» is «Monitor Off» on every
   row unless someone is on headphones — «Monitor and Output» through the laptop's speakers is a feedback
   loop into the microphones.
3. **Microphone levels.** The announcer speaks at the real distance and volume: peaks in the
   yellow, around −12 to −6 dB, never red; the filters adjusted as in § The microphone filters; the
   music at about −25 dB and clearly under the voice.
4. **A short test recording.** «Start Recording» for a minute with speech and music, «Stop Recording»,
   play the file back on headphones. This is the only step that hears what the viewer will hear: echo,
   hum, the PA, a muted row that should not be. Fix, and record again, until it is clean.
5. **The emergency controls.** Press the music's mute hotkey and the microphone's mute hotkey and
   watch the mixer react; unmute. YouTube Studio's live control room open and signed in, where
   the stream's health and any warning will be shown.
6. **The site's own notice.** Once the stream is live, an Administrator ticks «Setări» → «Aspect» →
   «În direct pe YouTube» → «Suntem în direct» with the broadcast's address and saves: every page of
   the site then carries «Suntem în direct pe YouTube» with the link under the header. The channel's
   own «live» page (youtube.com/@canal/live) as the address survives a restarted stream; a
   broadcast's own address has to be replaced after a termination (above). **Untick it when the
   broadcast ends** — nothing switches it off by itself.
7. **Monitoring the real output.** Once live, someone other than the announcer watches the actual
   YouTube stream on a phone with headphones (on mobile data, not the venue's Wi-Fi, so the stream
   is watched as a viewer gets it), for the first minutes and whenever the scene changes: the
   voice on top, the music under it, no echo, and the stream's health in the control room green.

## Next steps, in this order

- [ ] **Name the equipment.** Which laptop, which microphones (the primary, and a second one if
      any), which two cameras, and whether the DJI Action 4 of
      [`docs/FINISH-PHOTOS.md`](./FINISH-PHOTOS.md) is free for a broadcast on race day or busy
      feeding ContaCam — a camera cannot do both unless that is tested. Until this is written here,
      the filter values above have not been tuned on anything.
- [ ] **Build the OBS profile and scene collection** with the fixed values above; export both
      (OBS's «Profile» → «Export» and «Scene Collection» → «Export») to the club's drive, so a
      replacement laptop can be set up without this page.
- [ ] **Download the music** from StreamBeats, with the proof kept as § Background music says;
      read the license page on that day.
- [ ] **Set and test the mute hotkeys** on the streaming laptop.
- [ ] **A rehearsal broadcast**, unlisted, with the two-webcam profile, the full checklist and a
      watcher on a phone; then one at a club run with the finish-line profile, next to a real PA.
- [ ] **Write the tuned values back here** as the starting values the next broadcast begins from.
