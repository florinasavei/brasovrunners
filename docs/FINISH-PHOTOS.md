# Finish-line photos — automatic stills on race day

**Decided by the owner, 2026-10-26.** Race-day equipment, not platform code: nothing here runs on
Vercel or touches the site. The photos end up on a laptop; publishing them is the gallery's
ordinary upload.

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
to be worked out.

## The decisions

- A simple, reliable setup with as little new spending as possible.
  Spent so far: $10, the ContaCam purchase.
- The hardware and software the club already has, wherever possible.
- Automatic still photos first; video is not the goal.
- Photos saved directly to the laptop.
- Tested before it is used at a real event.

## Next steps

- [ ] Windows detects the Nikon D3500 over USB.
- [ ] Live view and remote shutter work in digiCamControl.
- [ ] ContaCam configured to watch the DJI feed.
- [ ] How motion triggers the Nikon (step 3) — decided and working.
- [ ] Repeated triggers do not produce a flood of photos (a pause after each shot).
- [ ] A test with runners passing through the frame: image quality, trigger reliability, files saved.
