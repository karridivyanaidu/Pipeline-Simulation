/**
 * simulator.js — Pipeline Hazard Simulator Core Logic
 * Plaksha Orbital Pipeline Deck · CS2011
 *
 * ── ASSUMPTIONS ─────────────────────────────────────────────────────────
 * Single-issue, in-order pipeline. One instruction enters per cycle.
 * Stall bubbles freeze the consumer and all later instructions.
 *
 * WITHOUT forwarding:
 *   Value available end of WB. Consumer reads in ID.
 *   Stalls = max(0, (producerWB) − (consumerID))
 *          = max(0, (ps + S − 1) − (cs + 1))
 *   5-stage, back-to-back R-type → 2 stalls
 *   4-stage, back-to-back R-type → 1 stall
 *   5-stage, back-to-back LW    → 2 stalls (same formula)
 *   4-stage, back-to-back LW    → 1 stall
 *
 * WITH forwarding:
 *   R-type: forward from end of EX → consumer's EX start (strictly before).
 *   Stalls = max(0, (ps + 2) − (cs + 2)) = max(0, ps − cs)
 *   Back-to-back (cs = ps+1): 0 stalls ✓
 *
 *   Load-use: forward from end of MEM → consumer's EX start.
 *   producerMEM = ps + (S==5 ? 3 : 2)
 *   consumerEX  = cs + 2
 *   Need producerMEM strictly before consumerEX:
 *   Stalls = max(0, producerMEM − consumerEX + 1)
 *   Back-to-back 5-stage: max(0, (ps+3) − (ps+3) + 1) = 1 ✓
 *
 * STALL DISPLAY in table:
 *   Stall bubbles appear on the consumer instruction's row, in the cycles
 *   immediately BEFORE the consumer's own IF stage.
 *   Row pattern: [STALL ... STALL] [IF] [ID] [EX] [MEM] [WB]
 *   The IF always starts AFTER all stalls — never overlaps with them.
 * ────────────────────────────────────────────────────────────────────────
 */

"use strict";

const STAGES_5 = ['IF', 'ID', 'EX', 'MEM', 'WB'];
const STAGES_4 = ['IF', 'ID', 'EX', 'MEM/WB'];

// ────────────────────────────────────────────────
// Instruction Parsing
// ────────────────────────────────────────────────

/**
 * Parse instruction from UI field values.
 * op: 'ADD' | 'SUB' | 'LW' | 'SW'
 * field1: dest reg (ADD/SUB/LW) or data reg (SW)
 * field2: src1 reg (ADD/SUB) or offset string (LW/SW)
 * field3: src2 reg (ADD/SUB) or base reg (LW/SW)
 */
function parseInstruction(op, field1, field2, field3) {
  if (!op) return null;
  op = op.toUpperCase().trim();
  const validReg = r => /^R\d+$/i.test((r || '').trim());

  let dest = null, src1 = null, src2 = null;
  let isLoad = false, isStore = false;

  if (op === 'ADD' || op === 'SUB') {
    dest = (field1 || '').trim().toUpperCase();
    src1 = (field2 || '').trim().toUpperCase();
    src2 = (field3 || '').trim().toUpperCase();
    if (!validReg(dest) || !validReg(src1) || !validReg(src2)) return null;
  } else if (op === 'LW') {
    dest = (field1 || '').trim().toUpperCase();
    src1 = (field3 || '').trim().toUpperCase(); // base register
    src2 = null;
    isLoad = true;
    if (!validReg(dest) || !validReg(src1)) return null;
  } else if (op === 'SW') {
    src1 = (field1 || '').trim().toUpperCase(); // data register (read)
    src2 = (field3 || '').trim().toUpperCase(); // base register (read)
    dest = null;
    isStore = true;
    if (!validReg(src1) || !validReg(src2)) return null;
  } else {
    return null;
  }

  let rawStr;
  if (op === 'LW') {
    rawStr = `LW ${dest}, ${field2 || '0'}(${src1})`;
  } else if (op === 'SW') {
    rawStr = `SW ${src1}, ${field2 || '0'}(${src2})`;
  } else {
    rawStr = `${op} ${dest}, ${src1}, ${src2}`;
  }

  return { op, dest, src1, src2, isLoad, isStore, raw: rawStr };
}

// ────────────────────────────────────────────────
// Stall Calculation
// ────────────────────────────────────────────────

/**
 * Calculate stalls needed for a RAW dependency.
 * ps = producer start cycle, cs = consumer start cycle (current, before applying stalls)
 * isLoad = producer is LW, S = num stages, fwd = forwarding enabled
 */
function calcStalls(ps, cs, isLoad, S, fwd) {
  if (!fwd) {
    // Without forwarding: value available end of WB
    // WB cycle = ps + S - 1
    // Consumer ID cycle = cs + 1
    // Need WB <= consumer ID → stalls = max(0, WB - consumerID)
    return Math.max(0, (ps + S - 1) - (cs + 1));
  }

  if (!isLoad) {
    // R-type forwarding: value available end of EX (cycle ps+2)
    // Consumer EX = cs+2, need ps+2 < cs+2 (strictly before)
    // stalls = max(0, (ps+2) - (cs+2) + 1) = max(0, ps - cs + 1)
    // Wait — standard EX→EX forwarding:
    // Result available at END of producer EX, used at START of consumer EX.
    // If they happen in the same cycle, it's fine (the value is forwarded).
    // Need: ps+2 <= cs+2  → stalls = max(0, ps - cs)
    return Math.max(0, ps - cs);
  } else {
    // Load-use forwarding: value available end of MEM.
    // MEM is stage index 3 in BOTH 4-stage (MEM/WB combined) and 5-stage.
    const producerMEM = ps + 3; // always cycle ps+3
    const consumerEX  = cs + 2;
    // Need producerMEM < consumerEX (strictly — MEM result latches before EX reads)
    // stalls = max(0, producerMEM - consumerEX + 1)
    return Math.max(0, producerMEM - consumerEX + 1);
  }
}

// ────────────────────────────────────────────────
// Core Simulation
// ────────────────────────────────────────────────

function simulate(instructions, stagesCount, forwarding) {
  const stages = stagesCount === 5 ? STAGES_5 : STAGES_4;
  const S = stagesCount;
  const n = instructions.length;

  // Build working instruction records
  const instrData = instructions.map((instr, i) => ({
    ...instr,
    index: i,
    startCycle: i + 1, // cycle when IF executes (1-indexed)
    stalls: 0,         // total stall cycles inserted before this instruction's IF
  }));

  const hazardLog = [];
  const fwdLog    = [];

  // Process each instruction as a potential consumer
  for (let c = 0; c < n; c++) {
    const consumer = instrData[c];

    // Collect source registers this instruction reads
    const srcs = [];
    if (consumer.src1) srcs.push(consumer.src1);
    if (consumer.src2) srcs.push(consumer.src2);
    if (srcs.length === 0) continue;

    // Find the maximum stalls needed from any producer
    let maxStalls = 0;

    for (let p = 0; p < c; p++) {
      const producer = instrData[p];
      if (!producer.dest) continue;               // SW writes nothing
      if (!srcs.includes(producer.dest)) continue; // no RAW dependency

      const noFwdStalls = calcStalls(producer.startCycle, consumer.startCycle, producer.isLoad, S, false);
      const fwdStalls   = calcStalls(producer.startCycle, consumer.startCycle, producer.isLoad, S, true);
      const actualStalls = forwarding ? fwdStalls : noFwdStalls;

      // Record hazard (only if there would be stalls without forwarding)
      if (noFwdStalls > 0) {
        hazardLog.push({
          producerIdx: p,
          consumerIdx: c,
          register: producer.dest,
          stallsWithout: noFwdStalls,
          stallsWith: fwdStalls,
          isLoad: producer.isLoad,
        });
      }

      // Record forwarding events
      if (forwarding && noFwdStalls > 0 && fwdStalls < noFwdStalls) {
        fwdLog.push({
          producerIdx: p,
          consumerIdx: c,
          register: producer.dest,
          from: producer.isLoad ? (S === 5 ? 'MEM' : 'MEM/WB') : 'EX',
          to: 'EX',
          stallsEliminated: noFwdStalls - fwdStalls,
        });
      }

      if (actualStalls > maxStalls) maxStalls = actualStalls;
    }

    // Apply stalls: push this consumer AND all later instructions
    if (maxStalls > 0) {
      consumer.stalls = (consumer.stalls || 0) + maxStalls;
      // Push forward this and all subsequent
      for (let k = c; k < n; k++) {
        instrData[k].startCycle += maxStalls;
      }
    }
  }

  // Deduplicate
  const seen = new Set();
  const uniqueHazards = hazardLog.filter(h => {
    const key = `${h.producerIdx}:${h.consumerIdx}:${h.register}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });

  const seenF = new Set();
  const uniqueFwd = fwdLog.filter(f => {
    const key = `${f.producerIdx}:${f.consumerIdx}:${f.register}`;
    return seenF.has(key) ? false : (seenF.add(key), true);
  });

  // Total cycles
  const lastInstr = instrData[n - 1];
  const totalCycles = lastInstr.startCycle + (S - 1);

  // ── Build schedule ──────────────────────────────────────────────────────
  //
  // For instruction i:
  //   Stall cycles: [startCycle - stalls, startCycle - 1]   → labeled STALL
  //   Stage cycles: [startCycle, startCycle + S - 1]        → labeled IF/ID/EX/...
  //
  // The IF stage always comes AFTER stalls. The table shows this naturally
  // because stalls occupy cycles before startCycle, and IF starts at startCycle.
  //
  // No two simultaneous instructions can be in the same stage at the same cycle
  // because startCycles are at least 1 apart (or more with stalls).

  // Mark forwarded EX cells
  const fwdCellSet = new Set();
  uniqueFwd.forEach(f => {
    const exCycle = instrData[f.consumerIdx].startCycle + 2;
    fwdCellSet.add(`${f.consumerIdx}:${exCycle}`);
  });

  const schedule = instrData.map((instr, rowIdx) => {
    const row = {}; // cycle → { stage, type }

    // Stall bubbles BEFORE IF
    for (let s = 0; s < instr.stalls; s++) {
      const cycle = instr.startCycle - instr.stalls + s;
      if (cycle >= 1) row[cycle] = { stage: 'STALL', type: 'stall' };
    }

    // Normal pipeline stages
    for (let si = 0; si < S; si++) {
      const cycle = instr.startCycle + si;
      const isFwd = fwdCellSet.has(`${rowIdx}:${cycle}`);
      row[cycle] = { stage: stages[si], type: isFwd ? 'fwd' : 'normal' };
    }

    return row;
  });

  const totalStalls = instrData.reduce((sum, i) => sum + i.stalls, 0);

  return {
    instructions: instrData,
    stages,
    stagesCount: S,
    totalCycles,
    totalStalls,
    hazards: uniqueHazards,
    forwardingEvents: uniqueFwd,
    schedule,
    forwarding,
  };
}

// ────────────────────────────────────────────────
// Export
// ────────────────────────────────────────────────

window.PipelineSim = { simulate, parseInstruction, STAGES_4, STAGES_5 };
