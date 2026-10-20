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
export const CAR_SPAWN_HEIGHT = CAR_HALF_HEIGHT + 0.02; // (added) m above the surface
export const WHEEL_RADIUS = 0.36; // (added) m, visual only

// ---- Driving ----
export const A_MAX = 20; // m/s^2 throttle acceleration
export const DRAG_C = 4.4; // kg/m quadratic drag
export const AIR_DRAG_FACTOR = 0.25; // (added) drag multiplier while airborne, so a hop at speed does not kill speed
export const GRIP_TAU = 0.15; // s to kill sideways sliding
export const STEER_RATE_MAX = 1.8; // rad/s
export const STEER_V_REF = 15; // m/s at which steering reaches full rate
export const ALIGN_RATE = 10; // (added) 1/s, how fast the car levels itself onto the surface

// ---- Surface and suction ----
export const SURFACE_RANGE = 1.5; // m, suction and attachment range r_s
export const SUCTION_SIGMA = 1.5; // multiples of mg
export const SUCTION_LOCKOUT = 0.25; // s, suction off after a hop
export const NORMAL_SMOOTH_RATE = 25; // (added) 1/s, surface normal smoothing

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
export const CAM_UP_RATE = 3; // 1/s, camera up-vector turn rate
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
