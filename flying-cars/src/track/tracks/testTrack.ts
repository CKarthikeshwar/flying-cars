import { Pen } from '../builders';
import type { BankKey, TrackDef } from '../Track';

/**
 * The Milestone 2 test track: a straight, a 90 degree wall, two vertical loops and a ceiling section,
 * laid out as a stadium so it closes on itself. About 1050 m round.
 *
 * The two loops shift the road in opposite directions on purpose. A loop that shifts the road sideways by d
 * leaves the transported up vector twisted by d / radius when the track closes; mirrored loops cancel,
 * so the flat parts of the road stay level.
 */
export function testTrackDef(): TrackDef {
  const pen = new Pen();

  pen.straight(260); // the wall section sits on this straight
  pen.turn(180, 60, 'left');
  pen.straight(40);
  pen.loop(28, 18, 'left'); // first loop, exit 18 m to the left of the entry
  const afterFirstLoop = pen.length;
  pen.straight(190); // the ceiling section sits here
  pen.loop(28, 18, 'right'); // second loop, shifts the road back
  pen.straight(30);
  pen.turn(180, 60, 'left');

  const banking: BankKey[] = [
    // wall: ease up to 90 degrees, hold, ease back
    { s: 50, deg: 0 },
    { s: 100, deg: 90 },
    { s: 160, deg: 90 },
    { s: 210, deg: 0 },
    // ceiling: ease up to 180 degrees, hold, ease back
    { s: afterFirstLoop + 10, deg: 0 },
    { s: afterFirstLoop + 70, deg: 180 },
    { s: afterFirstLoop + 120, deg: 180 },
    { s: afterFirstLoop + 180, deg: 0 },
  ];

  return { name: 'Test Track', points: pen.close(), banking, start: 40 };
}

/** The same stadium with a single loop and a shorter last turn so it still closes. It leaves a large closing twist, which makes it a stress test for the twist fix. */
export function singleLoopTrackDef(): TrackDef {
  const pen = new Pen();
  pen.straight(200);
  pen.turn(180, 60, 'left');
  pen.straight(40);
  pen.loop(28, 18, 'left');
  pen.straight(160);
  pen.turn(180, 51, 'left');
  return { name: 'Single Loop', points: pen.close(), banking: [] };
}
