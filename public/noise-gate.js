/**
 * Adaptive Noise Gate — AudioWorklet Processor
 *
 * Works by continuously estimating the background noise floor.
 * Sounds near or below the noise floor are attenuated (silenced).
 * Sounds significantly above the noise floor (speech) pass through.
 *
 * Tuned for classroom environments where background noise is fairly
 * constant (AC, shuffling, distant chatter) and speech is louder.
 */

const GATE_RATIO     = 1.5;   // reduced: only gate sounds truly below background noise
const NOISE_SMOOTH   = 0.99;  // very slow adaptation — keeps noise floor estimate low
const RAMP_FRAMES    = 4;     // frames to ramp gain on/off (prevents clicks)

class NoiseGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._noiseFloor = 0.008; // initial estimate
    this._gain       = 0;     // current output gain (0–1)
  }

  process(inputs, outputs) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

    // ── Compute RMS of this frame ─────────────────────────────────────
    let sumSq = 0;
    for (let i = 0; i < inp.length; i++) sumSq += inp[i] * inp[i];
    const rms = Math.sqrt(sumSq / inp.length) || 1e-10;

    // ── Adaptive noise floor ──────────────────────────────────────────
    // If the frame looks like noise (below threshold), update estimate.
    // If it looks like speech, let the floor drift downward very slowly.
    if (rms < this._noiseFloor * GATE_RATIO) {
      // Noise frame: blend toward current rms
      this._noiseFloor = NOISE_SMOOTH * this._noiseFloor + (1 - NOISE_SMOOTH) * rms;
    } else {
      // Speech frame: floor drifts down gently
      this._noiseFloor *= 0.9995;
    }
    this._noiseFloor = Math.max(0.001, Math.min(this._noiseFloor, 0.15));

    // ── Soft gate ────────────────────────────────────────────────────
    const threshold = this._noiseFloor * GATE_RATIO;
    let targetGain;
    if (rms < threshold) {
      targetGain = 0;
    } else if (rms < threshold * 2) {
      // Ramp zone: smooth open
      targetGain = (rms - threshold) / threshold;
    } else {
      targetGain = 1;
    }

    // Smoothly move current gain toward target (avoids clicks)
    const step = 1 / RAMP_FRAMES;
    this._gain += Math.sign(targetGain - this._gain) * Math.min(step, Math.abs(targetGain - this._gain));

    for (let i = 0; i < inp.length; i++) {
      out[i] = inp[i] * this._gain;
    }

    return true;
  }
}

registerProcessor("noise-gate", NoiseGateProcessor);
