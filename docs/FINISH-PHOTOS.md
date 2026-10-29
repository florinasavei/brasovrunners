# Finish-line photos — automatic stills on race day

**Decided by the owner, 2026-10-26.** Race-day equipment, not platform code: nothing here runs on
Vercel or touches the site. The photos end up on a laptop; publishing them is the gallery's
ordinary upload. The race-day livestream's sound is its own page,
[`docs/LIVESTREAM-AUDIO.md`](./LIVESTREAM-AUDIO.md).

## Goal

Detect runners crossing the finish line automatically and save **still photos** straight to a
laptop — no video kept.

## Hardware

| Device | Role |
| --- | --- |
| DJI Action 4 | The finish-line video feed, as a USB webcam / video source — it watches, it does not take the photos |
| Nikon D3500 | The camera that takes the full-resolution photos |
| Windows laptop | Runs the motion detection and the camera control; the photos are saved here |

## Software

**ContaCam** — **purchased by the club for $10.** Reads the DJI feed and detects motion. Its motion-triggered recording mode can save
a JPEG snapshot when a recording starts; we want the stills only, not the recordings.
The DJI feed first flickered: the cause was a faulty USB cable, and a new cable fixed it.

**digiCamControl** — controls the Nikon D3500 over USB: triggers the shutter and transfers each
photo straight to the laptop. Camera detection and tethered shooting are **not verified yet**.

## Proposed workflow

1. ContaCam watches the DJI feed of the finish line.
2. Motion detection sees a runner.
3. A trigger sends a capture command to the Nikon D3500.
4. The Nikon takes a full-resolution photo.
5. digiCamControl transfers it to the laptop.

**ContaCam and digiCamControl do not talk to each other on their own.** Linking the motion
detection to the Nikon's shutter (step 3) needs extra configuration or a small integration — still
to be worked out. The likely route: ContaCam runs a command when it detects motion, and
digiCamControl takes a photo when told to from its command line or its built-in web server. Neither
setting is checked yet — confirm both in each program's documentation before relying on them.

## The decisions

- A simple, reliable setup with as little new spending as possible.
  Spent so far: $10, the ContaCam purchase.
- The hardware and software the club already has, wherever possible.
- Automatic still photos first; video is not the goal.
- Photos saved directly to the laptop.
- Tested before it is used at a real event.

## Next steps, in this order

- [ ] **The Nikon first.** Windows detects the D3500 over USB, digiCamControl's capture takes a
      photo and the file lands on the laptop. Check the D3500 in digiCamControl's supported-camera
      list — some entry-level Nikons are only partly supported tethered. If this fails, the plan
      changes, so it comes before anything else.
- [ ] **The link (step 3).** ContaCam's command on motion fires digiCamControl's capture. Run the
      command by hand a few times first and check the Nikon fires every time.
- [ ] **Watch only the line.** ContaCam's detection area is a narrow strip across the finish line, so
      spectators, volunteers and runners who already finished trigger nothing.
- [ ] **A pause after each shot**, one to two seconds, so one runner gives one photo, not twenty.
- [ ] **A test with people running through the line** at real speed, alone and in groups: image
      quality, trigger reliability, files saved.

## Where it can go wrong

- **Delay.** Detecting motion takes a moment, and firing the Nikon over USB another. A runner covers
  about 2 m in half a second: aim the Nikon at the area just after the line, not the line itself,
  or the photos show backs.
- **Blur and focus.** Autofocus off, focused by hand on the finish line once before the race; a
  fast shutter, 1/1000 s or faster. Each shot then fires at once and stays sharp.
- **Battery.** Tethered shooting drains the Nikon's battery fast. For a whole race, the mains
  adapter (EP-5A with EH-5) or spare batteries.
- **Runners finishing together.** Moving each photo to the laptop takes a second or two. Shoot
  JPEG, not RAW; a bunch at the line gives fewer photos than people, and that is expected.

## The fallback

If step 3 cannot be made to work: ContaCam's own snapshots from the DJI feed, no Nikon at all.
Lower quality, but nothing to connect and almost no delay — keep it ready on race day.

## Before the photos are published

Check that the privacy notice in force says the club photographs its races and publishes the
photos (not checked here). Take particular care with photos of minors.
