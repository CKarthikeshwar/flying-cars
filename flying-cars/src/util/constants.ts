// Every tuning number lives here. Starting values come from the build spec's
// "Tuning constants" table; extras the spec leaves open are marked (added).

const DEG = Math.PI / 180;

// ---- Loop ----
export const PHYSICS_DT = 1 / 120; // s, fixed physics step
export const MAX_FRAME_TIME = 0.1; // s, accumulator cap so slow frames slow the game instead of freezing it
export const SLOW_MO_SCALE = 0.2; // (added) time scale while debug slow-motion is on

// ---- Car body ----
export const GRAVITY = 9.81; // m/s^2, applied by us along -y (Rapier gravity is zero)
export const CAR_MASS = 800; // kg
export const CAR_HALF_WIDTH = 1; // m (box is 2 x 0.8 x 4)
export const CAR_HALF_HEIGHT = 0.4; // m, also the ride height at rest
export const CAR_HALF_LENGTH = 2; // m
export const WHEEL_RADIUS = 0.41; // (added) m, visual only

// ---- Driving ----
export const A_MAX = 20; // m/s^2 throttle acceleration
export const DRAG_C = 4.4; // kg/m quadratic drag
export const AIR_DRAG_FACTOR = 0.25; // (added) drag multiplier while airborne, so a hop at speed does not kill speed
export const GRIP_TAU = 0.1; // s to kill sideways sliding. Spec starts at 0.15; 0.1 slides less, which playtesting asked for
export const STEER_RATE_MAX = 1.8; // rad/s
export const STEER_V_REF = 15; // m/s at which steering reaches full rate
export const ALIGN_RATE = 12; // (added) 1/s, how fast the car levels itself onto the surface
export const ALIGN_MAX_FEEDFORWARD = 6; // (added) rad/s, cap on the surface-rotation feed-forward

// ---- Surface and suction ----
export const SURFACE_RANGE = 1.5; // m, suction and attachment range r_s
// Spec starts at 1.5, but at ride height the fade leaves only 0.1 mg of margin over gravity on a
// ceiling, and a car that is lifted a little cannot recover. 3.0 keeps about 1 mg of margin at ride
// height, and suction still beats gravity out to d = 1.0 m. See DECISIONS.md.
export const SUCTION_SIGMA = 3.0; // multiples of mg
export const SUCTION_LOCKOUT = 0.25; // s, suction off after a hop
export const NORMAL_SMOOTH_RATE = 25; // (added) 1/s, surface normal smoothing

// ---- Ride spring (the spec's fix for jitter): F = k (h0 - d) - c v_n, pushing only when d < h0 ----
export const RIDE_HEIGHT = 0.48; // (added) m, a little above the box's 0.4 so the box rarely touches
export const RIDE_STIFFNESS = 80; // (added) multiples of m g per metre
export const RIDE_DAMPING_RATIO = 0.7; // (added)
export const RIDE_RATE_SMOOTHING = 40; // (added) 1/s, smoothing on the measured rate of change of the distance to the road
export const RIDE_BUMP_DISTANCE = 0.3; // (added) m, closer than this the spring gets much stiffer (a bump stop)
export const RIDE_BUMP_FACTOR = 12; // (added) extra stiffness inside the bump stop, times the normal stiffness
export const CAR_SPAWN_HEIGHT = RIDE_HEIGHT + 0.02; // (added) m above the surface

// ---- Tracks ----
export const TRACK_WIDTH = 16; // (added) m. Was 12: it was too easy to drift off
export const TRACK_THICKNESS = 1; // (added) m, spec wants at least 0.5 so fast cars cannot tunnel
export const TRACK_STRIPS = 12; // (added) strips across the road surface, so facets follow a twisting road
export const TRACK_LEDGE_STRIPS = 3; // (added) strips wide (4 m) that stay as a ledge when a gap is cut in the road
export const GAP_HOP_LEAD = 8; // (added) m before a gap that the AI hops
export const TRACK_SAMPLE_SPACING = 1; // m, about one sample per metre
export const TRACK_FLAT_SLOPE = 0.42; // (added) sin 25 degrees: a tangent flatter than this counts as a flat stretch
export const FALL_RESPAWN_SPEED = 22; // (added) m/s downward in the air: that is about 2 s of free fall, which means off the track
export const TRACK_FALL_MARGIN = 60; // (added) m below the lowest track point before an auto respawn

// ---- Air tank ----
export const AIR_MAX = 100;
export const REGEN_RATE = 4; // per s while attached
export const STRIP_RATE = 40; // per s on a charge strip
export const AIR_START = AIR_MAX; // (added)

// ---- Hop ----
export const HOP_DV = 9; // m/s velocity change along the surface normal
export const HOP_COST = 15;
export const HOP_COOLDOWN = 0.4; // s

// ---- Boost ----
export const BOOST_ACCEL = 20; // m/s^2 at a full tank
export const BOOST_RATE = 20; // air per s
export const BOOST_MIN_FACTOR = 0.4; // thrust factor at an empty tank
export const BOOST_FACTOR_SLOPE = 0.6; // thrust factor = MIN + SLOPE * A / A_MAX

// ---- Air control and flips ----
export const ATT_RATE = 3; // air per s while air control is held
export const AIR_TORQUE_ALPHA = 14; // rad/s^2
export const AIR_SPIN_CAP = 7; // rad/s
export const AIR_SPIN_DAMP = 0.5; // 1/s
export const FLIP_REFUND = 10; // air per full flip
export const FLIP_TURN = 2 * Math.PI; // rad

// ---- Glide: hold Space in the air ----
export const GLIDE_GRAVITY_SCALE = 0.35; // (added) gravity while gliding, so a jump carries much further
export const GLIDE_RATE = 10; // (added) air per s while gliding
export const GLIDE_TURN_RATE = 1.4; // (added) rad/s the flight direction swings toward the way the car points
export const GLIDE_HOLD_SECONDS = 0.25; // (added) Space must be held this long: a tap is a hop, a hold is a glide

// ---- Landing ----
export const LAND_PERFECT_ANGLE = 30 * DEG; // rad
export const LAND_CRASH_ANGLE = 60 * DEG; // rad
export const LAND_SAFE_SPEED = 8; // m/s
export const LAND_PERFECT_REFUND = 5;
export const LAND_PERFECT_BOOST = 3; // m/s
export const LAND_ROUGH_SPEED_MULT = 0.6;
export const RESPAWN_DELAY = 1.5; // s
export const RESPAWN_PENALTY = 3; // s

// ---- Cushion assist ----
export const CUSHION_RANGE = 3; // m
export const CUSHION_CUT = 0.6; // fraction of v_n removed
export const CUSHION_COST = 5;

// ---- Camera ----
// Camera up-vector turn rate, 1/s. The spec starts at 3, but playtesting found the screen too slow to
// right itself when the road flips, so the default is faster and C cycles through the three.
export const CAM_UP_RATES = [3, 8, 30];
export const CAM_MODE_NAMES = ['SMOOTH', 'QUICK', 'LOCKED'];
export const CAM_UP_RATE = CAM_UP_RATES[1] ?? 8; // default: QUICK
export const CAM_HEADING_RATE = 6; // (added) 1/s, how fast the camera heading follows the car
export const CAM_DISTANCE = 8; // (added) m behind the car
export const CAM_HEIGHT = 3; // (added) m above the car along the camera up
export const CAM_LOOK_AHEAD = 6; // (added) m ahead of the car
export const FOV_MIN = 70; // degrees, stopped
export const FOV_MAX = 85; // degrees, at top speed
export const FOV_FULL_SPEED = 85; // (added) m/s at which the FOV is widest
export const SHAKE_DECAY = 6; // (added) 1/s
export const SHAKE_PERFECT = 0.1; // (added) m, camera shake on a Perfect landing
export const SHAKE_ROUGH = 0.35; // (added) m
export const SHAKE_CRASH = 0.7; // (added) m

// ---- HUD ----
export const AIR_LOW = 20; // gauge turns red and pulses below this
export const AIR_SEGMENTS = 20; // (added)
export const POPUP_SECONDS = 1.25; // (added)
export const MS_TO_KMH = 3.6;

// ---- Race ----
export const RACE_LAPS = 3;
export const COUNTDOWN_SECONDS = 3; // 3, 2, 1, then go
export const GRID_ROW_GAP = 8; // (added) m between rows on the starting grid
export const GRID_FIRST_ROW = 6; // (added) m the front row sits behind the start line
export const GRID_LANE_OFFSET = 3; // (added) m to each side of the road centre
export const GATE_COUNT_SPACING = 100; // (added) m between checkpoint gates, roughly
export const GATE_GAP_CLEAR = 100; // (added) m of road a gate keeps clear before a gap, so a respawned car has room to get up to speed
export const GATE_MAX_SLOPE = 0.2; // (added) a gate (a respawn point) needs road flatter than this (sin 11.5 degrees), or the car rolls away
export const GATE_MARGIN = 3; // (added) m beyond the road edge that still counts as passing a gate
export const GATE_ABOVE = 10; // (added) m above the road surface that still counts as passing a gate
export const GATE_BELOW = 3; // (added) m below the road surface that still counts

// ---- Ghost ----
export const GHOST_DT = 1 / 30; // s between recorded poses
export const GHOST_OPACITY = 0.35; // (added)

// ---- AI ----
export const AI_LOOKAHEAD_BASE = 8; // m, base lookahead, plus 0.2 x speed
export const AI_LOOKAHEAD_SPEED = 0.2; // seconds of travel added to the lookahead
export const AI_LAT_ACCEL = 18; // m/s^2, cornering limit a_lat
export const AI_BOOST_AIR_MIN = 50; // the AI boosts only above this air
export const AI_SKILLS = [0.85, 0.9, 0.95]; // skill factors applied to the target speed
export const AI_BRAKE_DECEL = 14; // (added) m/s^2 the speed profile plans to brake at
export const AI_MAX_SPEED = 75; // (added) m/s cap on target speed on straights
export const AI_NORMAL_RATE_MAX = 1.6; // (added) rad/s, fastest the road may turn under the car. Off-centre the surface moves at this times the offset.
export const AI_STEER_GAIN = 2.5; // (added) steering input per radian of angle error
export const AI_BOOST_CURVATURE = 0.004; // (added) 1/m, flatter than this counts as a straight
export const AI_BOOST_ROLL_RATE = 0.01; // (added) rad/m, the road must turn under the car slower than this to boost
export const AI_STUCK_SECONDS = 4; // (added) s below walking pace before the AI asks for a respawn
export const FINISH_CRUISE_SPEED = 12; // (added) m/s a car slows to after it has finished, and keeps following the road
export const AI_LANES = [2.5, -2.5, 1.2]; // (added) m, each AI aims this far to the right of the centre line, so cars do not all share one line
export const AI_LANE_ROLL_RATE = 0.02; // (added) rad/m: where the road turns under the car faster than this, lanes fade to the centre
export const RESULTS_WAIT_SECONDS = 6; // (added) s to wait for the AI to finish before showing results
export const AI_LEDGE_SPEED = 18; // (added) m/s, the AI speed on a ledge when it is not hopping the gap
export const AI_LEDGE_APPROACH = 70; // (added) m before a gap that the AI starts moving over to the ledge
export const AI_HOP_WINDOW = 1; // (added) m before a hop marker at which the AI hops

// ---- Effects: compressed-air gas puffs ----
export const GAS_POOL = 1400; // (added) most gas particles alive at once
export const GAS_DRAG = 2.4; // (added) 1/s, how fast puffs slow down
export const GAS_INHERIT = 0.55; // (added) share of the car's own velocity a puff starts with, so it trails behind
export const HOP_PUFFS = 26; // (added) per nozzle, the burst under the car when it hops
export const HOP_PUFF_SPEED = [9, 16]; // (added) m/s, min and max
export const BOOST_PUFFS_PER_S = 70; // (added) per rear nozzle
export const BOOST_PUFF_SPEED = [14, 24]; // (added)
export const GLIDE_PUFFS_PER_S = 28; // (added) per underside nozzle
export const GLIDE_PUFF_SPEED = [4, 8]; // (added)
export const JET_PUFFS_PER_S = 42; // (added) per attitude jet while tilting in the air
export const JET_PUFF_SPEED = [6, 11]; // (added)

// ---- Thruster moves: side dash, brake jet, slam, long and high hops ----
export const DASH_DV = 16; // (added) m/s sideways velocity change
export const DASH_COST = 12; // (added) air
export const DASH_COOLDOWN = 0.7; // (added) s
export const DASH_DOUBLE_TAP = 0.25; // (added) s between two taps of A or D that make a dash
export const DASH_GRIP_TIME = 0.3; // (added) s that sideways grip is loosened after a dash, so the car really slides across
export const DASH_GRIP_SCALE = 0.15; // (added) fraction of normal grip during that time
export const RETRO_DECEL = 38; // (added) m/s^2 extra braking from the front jets
export const RETRO_RATE = 14; // (added) air per s
export const RETRO_MIN_SPEED = 8; // (added) m/s, the jets stay off below this
export const SLAM_ACCEL = 60; // (added) m/s^2 toward the nearest surface
export const SLAM_RATE = 18; // (added) air per s
export const SLAM_MAX_SPEED = 30; // (added) m/s toward the surface; slamming adds no more past this
export const SLAM_RANGE = 14; // (added) m, how far below (or above) the car the slam jet can see a surface
export const SLAM_MIN_DISTANCE = 2.5; // (added) m, the jet stops this close to the surface
export const SLAM_SOFT_TIME = 0.35; // (added) s after a slam in which a landing counts as soft
export const HOP_LONG_LEAN = 1; // (added) forward part of the hop direction while boost is held (1 = 45 degrees)
export const HOP_LONG_DV = 1.25; // (added) times HOP_DV
export const HOP_LONG_COST = 1.2; // (added) times HOP_COST
export const HOP_HIGH_DV = 1.3; // (added) times HOP_DV, while S is held
export const HOP_HIGH_COST = 1.3; // (added) times HOP_COST
export const DASH_PUFFS = 22; // (added) per nozzle, the burst out of the side opposite to the dash
export const DASH_PUFF_SPEED = [10, 18]; // (added)
export const RETRO_PUFFS_PER_S = 45; // (added) per front nozzle
export const RETRO_PUFF_SPEED = [10, 18]; // (added)
export const SLAM_PUFFS_PER_S = 45; // (added) per roof nozzle
export const SLAM_PUFF_SPEED = [9, 16]; // (added)

// ---- Air rings and barriers ----
export const RING_RADIUS = 4.4; // (added) m, how close to the middle of a ring counts as flying through it
export const RING_AIR = 30; // (added) air refilled by a ring
export const RING_BOOST = 6; // (added) m/s added along the way the car is moving
export const BARRIER_PENALTY = 2; // (added) s added to the race time for hitting a barrier
export const BARRIER_SPEED_MULT = 0.45; // (added) the speed a car keeps after hitting one
export const BARRIER_HURDLE_HEIGHT = 1.1; // (added) m, a low barrier the car hops over
export const BARRIER_WALL_HEIGHT = 9; // (added) m, a wall nobody can hop over: go through the slot
export const BARRIER_CAR_HALF_WIDTH = 0.95; // (added) m, the car half width when it meets a barrier
export const BARRIER_CAR_HALF_HEIGHT = 0.35; // (added) m, the car half height
export const BARRIER_HOP_LEAD = 12; // (added) m before a hurdle that the AI hops
export const SLOT_APPROACH = 50; // (added) m before a slot wall that the AI starts lining up with the opening
export const SLOT_BLOCK_DEPTH = 1.4; // (added) m, thickness of a barrier along the road (drawn only)
export const RING_PUFFS = 36; // (added) the burst of lime gas when a car flies through a ring
export const HIT_PUFFS = 44; // (added) the burst of red gas when a car hits a barrier
export const BURST_SPEED = [6, 14]; // (added) m/s of those bursts

// ---- AI flying: turning to meet the landing ----
export const AI_FLIP_DECEL = 8; // (added) rad/s^2 the AI plans to brake its air turns with (the jets can do 14)
export const AI_FLIP_RATE_GAIN = 1.2; // (added) air control per rad/s of turn-rate error
export const AI_LANDING_LEAD = 30; // (added) samples before a gap at which the AI already looks at the far side
export const RACER_HIGH_RISE = 5.5; // (added) m, a landing this much above the car needs a high hop (a plain hop tops out about 4.5 m up)
export const TRACK_TAPER_SAMPLES = 4; // (added) samples over which the slab thins to nothing where an island ends
export const RIDE_RATE_JUMP = 8; // (added) m/s, a measured rate this far from the car's real speed toward the road is a jump in the reading, not motion
export const GLUE_RATE = 8; // (added) 1/s, how fast a car attached to a surface loses speed away from it
export const AI_FLY_LEVEL = 0.8; // (added) the AI steers in the air only when its car is within about 35 degrees of level with the landing
export const AI_CUSHION_SPEED = 6; // (added) m/s toward the surface above which the AI taps hop for the cushion just before landing

// ---- Sound ----
export const SOUND_MASTER = 0.6; // (added) overall loudness, 0 to 1
export const SOUND_ENGINE_BASE_HZ = 55; // (added) pitch of the engine hum standing still
export const SOUND_ENGINE_HZ_PER_MS = 1.9; // (added) Hz of pitch for each m/s of speed
export const SOUND_SMOOTHING = 0.06; // (added) s, how smoothly the continuous sounds follow the car

// Speed lines (streaks at the edge of the screen when fast) and camera rumble
export const SPEED_LINES_START = 45; // (added) m/s at which the streaks first appear
export const SPEED_LINES_FULL = 85; // (added) m/s at which they are at full strength
export const SPEED_LINES_BOOST = 0.3; // (added) extra strength while boosting
export const SPEED_LINES_COUNT = 34; // (added) streaks on screen at once
export const SPEED_LINES_ALPHA = 0.55; // (added) opacity at full strength
export const SHAKE_FREQUENCY = 34; // (added) rad/s of the shake wobble: smooth, not random each frame
export const SHAKE_BOOST = 0.035; // (added) m of constant rumble while boosting

// Jump buffering: a Space tap shortly before a gap is held until the right spot
export const HOP_BUFFER_WINDOW = 45; // (added) m before a gap edge within which an early tap is held
export const HOP_BUFFER_AT = 8; // (added) m before the edge at which a held tap is released
