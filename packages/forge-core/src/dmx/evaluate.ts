import type { EEDmxCondition, EEDmxEffect, EEDmxRig } from "@forge/contracts";
import { dmxLevel, slotEntry } from "./color.js";

/**
 * What a rig would put on the wire, right now (ADR-0040).
 *
 * Pure and testable, and the reason the editor's preview can be honest:
 * the same function that renders the bars would drive real fixtures if
 * EXODUS ever took DMX over from EE.
 *
 * It models EE's documented behaviour, not EE's source, which is not in
 * this install. Where the two could differ — the scale of `Heat` and
 * `Hacked`, which EE's table gives as 0-100 while the Lua getters return
 * 0..1 — the caller normalises before it gets here, and the authoring
 * guide says the pairing is unverified until someone watches a real
 * channel.
 */

/** Trigger name → its current value, already in EE's documented range. */
export type DmxTriggerValues = ReadonlyMap<string, number>;

/** A channel's current output, one number per DMX slot, each 0..1. */
export type DmxOutput = ReadonlyMap<string, readonly number[]>;

/**
 * Whether a condition holds.
 *
 * EE's triggers are all numbers, so every test is numeric: a bare
 * `RedAlert` is `> 0`, which is what makes the boolean ones read as
 * booleans.
 *
 * `equal` and `notEqual` are evaluated against the author's value, which
 * is what they meant — **not** what EE-2024.12.08 does, since its parser
 * takes the compare value from one character past a two-character
 * operator and always ends up with 0. The editor warns on that case
 * rather than the preview quietly imitating the bug.
 */
export function dmxConditionHolds(
  condition: EEDmxCondition,
  triggers: DmxTriggerValues,
): boolean {
  const value = triggers.get(condition.trigger) ?? 0;
  switch (condition.operator) {
    case "greater":
      return value > condition.value;
    case "less":
      return value < condition.value;
    case "equal":
      return value === condition.value;
    case "notEqual":
      return value !== condition.value;
  }
}

/**
 * A deterministic stand-in for EE's random rolls.
 *
 * The **range** is EE's; the sequence is not — EE re-rolls on its own
 * timer, which this cannot see. That is enough for what the preview is
 * for: showing that a fixture flickers within the band the author set.
 */
function noiseAt(timeS: number, smoothness: number, seed: number): number {
  const step = Math.max(smoothness, 1 / 30);
  const index = Math.floor(timeS / step);
  const roll = (n: number): number => {
    const x = Math.sin((n + seed * 37.7) * 127.1) * 43758.5453;
    return x - Math.floor(x);
  };
  const from = roll(index);
  const to = roll(index + 1);
  // With no smoothness EE jumps; with it, the roll fades into the next.
  const t = smoothness === 0 ? 0 : (timeS % step) / step;
  return from + (to - from) * t;
}

/**
 * One channel's level.
 *
 * Every level is indexed with `slotEntry`, which is EE's own
 * `values[idx % values.size()]` — so a single value means "the same on
 * every channel" and a list of three paints an RGB fixture.
 */
function channelLevel(
  effect: EEDmxEffect,
  index: number,
  triggers: DmxTriggerValues,
  timeS: number,
): number {
  switch (effect.kind) {
    case "static":
      return dmxLevel(slotEntry(effect.values, index));
    case "glow": {
      // A triangle rather than a sine: EE calls it a pulse between two
      // values over `time`, and a triangle is what reads as one on a bar.
      const phase = (timeS % effect.timeS) / effect.timeS;
      const ramp = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      const min = slotEntry(effect.minValue, index);
      return min + (slotEntry(effect.maxValue, index) - min) * ramp;
    }
    case "blink": {
      const period = effect.onTimeS + effect.offTimeS;
      const on = timeS % period < effect.onTimeS;
      return slotEntry(on ? effect.onValue : effect.offValue, index);
    }
    case "variable": {
      // One trigger per channel, not a set to combine: EE's Variable
      // effect reads a single variable, and the comma list is split the
      // same way every other setting is.
      const input = triggers.get(slotEntry(effect.inputs, index)) ?? 0;
      const span = effect.maxInput - effect.minInput;
      const t = span === 0 ? 0 : (input - effect.minInput) / span;
      const clamped = Math.min(Math.max(t, 0), 1);
      const min = slotEntry(effect.minOutput, index);
      return min + (slotEntry(effect.maxOutput, index) - min) * clamped;
    }
    case "noise": {
      // Seeded by channel, so an RGB fixture flickers rather than pulsing
      // grey — EE gives each channel its own effect and its own timer.
      const min = slotEntry(effect.minValue, index);
      const roll = noiseAt(timeS, effect.smoothness, index);
      return min + (slotEntry(effect.maxValue, index) - min) * roll;
    }
  }
}

function applyEffect(
  effect: EEDmxEffect,
  width: number,
  triggers: DmxTriggerValues,
  timeS: number,
): readonly number[] {
  return Array.from({ length: width }, (_, index) =>
    channelLevel(effect, index, triggers, timeS),
  );
}

/**
 * Evaluate every state against the current triggers.
 *
 * States are applied **in order**, so a later one wins on a channel two
 * of them claim — the same "last write" a list of rules implies, and what
 * lets an author put a general rule first and an exception after.
 *
 * Events are deliberately *not* evaluated: they fire on a change over
 * time, and the preview is a snapshot. The view says so rather than
 * showing them dark and letting an author think they are broken.
 */
export function evaluateRig(
  rig: EEDmxRig,
  triggers: DmxTriggerValues,
  timeS: number,
): DmxOutput {
  const out = new Map<string, readonly number[]>();
  for (const fixture of rig.fixtures) {
    out.set(fixture.name, Array.from({ length: fixture.slots.length }, () => 0));
  }

  for (const state of rig.states) {
    if (!dmxConditionHolds(state.condition, triggers)) continue;
    const fixture = rig.fixtures.find((candidate) => candidate.name === state.target);
    // A state aimed at a fixture nobody declares is the author's mistake;
    // the view lists it, and here it simply produces nothing.
    if (fixture === undefined) continue;
    out.set(fixture.name, applyEffect(state.effect, fixture.slots.length, triggers, timeS));
  }

  return out;
}

/** States whose target no fixture declares — surfaced by the editor. */
export function danglingDmxTargets(rig: EEDmxRig): readonly string[] {
  const known = new Set(rig.fixtures.map((fixture) => fixture.name));
  const missing = new Set<string>();
  for (const state of rig.states) if (!known.has(state.target)) missing.add(state.target);
  for (const event of rig.events) if (!known.has(event.target)) missing.add(event.target);
  return [...missing].sort();
}
