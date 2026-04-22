/**
 * ui.js — User Interface Controller
 * Plaksha Orbital Pipeline Deck · CS2011
 */

"use strict";

// ────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────

let simResult    = null;  // last full simulation result
let currentCycle = 0;     // for step mode (0 = not started)
let stepMode     = false; // true when in step-by-step mode

// ────────────────────────────────────────────────
// DOM References
// ────────────────────────────────────────────────

const instrCountInput  = document.getElementById('instrCount');
const btnDecCount      = document.getElementById('btnDecCount');
const btnIncCount      = document.getElementById('btnIncCount');
const instrInputsDiv   = document.getElementById('instrInputs');
const btnRun           = document.getElementById('btnRun');
const btnStep          = document.getElementById('btnStep');
const btnReset         = document.getElementById('btnReset');
const cycleInfo        = document.getElementById('cycleInfo');
const cycleVal         = document.getElementById('cycleVal');
const cycleTotal       = document.getElementById('cycleTotal');
const tableContainer   = document.getElementById('tableContainer');
const hazardReport     = document.getElementById('hazardReport');
const hazardList       = document.getElementById('hazardList');
const forwardingReport = document.getElementById('forwardingReport');
const forwardingList   = document.getElementById('forwardingList');
const statsBar         = document.getElementById('statsBar');
const pipelineBadge    = document.getElementById('pipelineBadge');

const statCycles  = document.getElementById('statCycles');
const statInstrs  = document.getElementById('statInstrs');
const statStalls  = document.getElementById('statStalls');
const statHazards = document.getElementById('statHazards');
const statCPI     = document.getElementById('statCPI');

// ────────────────────────────────────────────────
// Register options
// ────────────────────────────────────────────────

const REGS = Array.from({ length: 16 }, (_, i) => `R${i}`);

function buildRegSelect(cls, selected) {
  const sel = document.createElement('select');
  sel.className = cls;
  REGS.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    if (r === selected) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}

function buildOpSelect(selected) {
  const sel = document.createElement('select');
  sel.className = 'instr-op-select';
  ['ADD', 'SUB', 'LW', 'SW'].forEach(op => {
    const opt = document.createElement('option');
    opt.value = op;
    opt.textContent = op;
    if (op === selected) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}

// ────────────────────────────────────────────────
// Default preset instructions (for demonstration)
// ────────────────────────────────────────────────

const PRESETS = [
  { op: 'ADD', d: 'R1', s1: 'R2', s2: 'R3',  off: null, base: null },
  { op: 'SUB', d: 'R4', s1: 'R1', s2: 'R5',  off: null, base: null },
  { op: 'LW',  d: 'R6', s1: null, s2: null,  off: '0',  base: 'R0' },
  { op: 'ADD', d: 'R7', s1: 'R6', s2: 'R4',  off: null, base: null },
  { op: 'SW',  d: null, s1: 'R7', s2: null,  off: '4',  base: 'R0' },
  { op: 'ADD', d: 'R8', s1: 'R2', s2: 'R3',  off: null, base: null },
  { op: 'SUB', d: 'R9', s1: 'R8', s2: 'R1',  off: null, base: null },
  { op: 'LW',  d: 'R10',s1: null, s2: null,  off: '8',  base: 'R0' },
  { op: 'ADD', d: 'R11',s1:'R10', s2: 'R2',  off: null, base: null },
  { op: 'SW',  d: null, s1:'R11', s2: null,  off: '12', base: 'R0' },
];

// ────────────────────────────────────────────────
// Build a single instruction input row
// ────────────────────────────────────────────────

function buildInstrRow(i) {
  const preset = PRESETS[i] || PRESETS[0];

  const row = document.createElement('div');
  row.className = 'instr-row';
  row.dataset.index = i;

  // Label
  const label = document.createElement('span');
  label.className = 'instr-label';
  label.textContent = `I${i + 1}`;
  row.appendChild(label);

  // Op selector
  const opSel = buildOpSelect(preset.op);
  opSel.dataset.role = 'op';
  row.appendChild(opSel);

  // Fields container
  const fieldsDiv = document.createElement('div');
  fieldsDiv.className = 'instr-fields';
  fieldsDiv.style.cssText = 'display:flex;gap:0.3rem;align-items:center;flex:1;flex-wrap:nowrap;';
  row.appendChild(fieldsDiv);

  // Validity indicator
  const dot = document.createElement('div');
  dot.className = 'instr-valid-dot valid';
  row.appendChild(dot);

  // Rebuild fields based on op
  function rebuildFields(op) {
    fieldsDiv.innerHTML = '';
    const sep = txt => { const s = document.createElement('span'); s.className = 'instr-separator'; s.textContent = txt; return s; };

    if (op === 'ADD' || op === 'SUB') {
      const destSel = buildRegSelect('instr-dest', preset.d || 'R1');
      destSel.dataset.role = 'dest';
      const src1Sel = buildRegSelect('instr-src1', preset.s1 || 'R2');
      src1Sel.dataset.role = 'src1';
      const src2Sel = buildRegSelect('instr-src2', preset.s2 || 'R3');
      src2Sel.dataset.role = 'src2';
      fieldsDiv.append(destSel, sep(','), src1Sel, sep(','), src2Sel);

    } else if (op === 'LW') {
      const destSel = buildRegSelect('instr-dest', preset.d || 'R1');
      destSel.dataset.role = 'dest';
      const offIn = document.createElement('input');
      offIn.type = 'text'; offIn.className = 'instr-lw-offset';
      offIn.placeholder = 'offset'; offIn.value = preset.off || '0';
      offIn.dataset.role = 'offset';
      const baseSel = buildRegSelect('instr-lw-base', preset.base || 'R0');
      baseSel.dataset.role = 'base';
      fieldsDiv.append(destSel, sep(','), offIn, sep('('), baseSel, sep(')'));

    } else if (op === 'SW') {
      const src1Sel = buildRegSelect('instr-src1', preset.s1 || 'R1');
      src1Sel.dataset.role = 'src1';
      const offIn = document.createElement('input');
      offIn.type = 'text'; offIn.className = 'instr-lw-offset';
      offIn.placeholder = 'offset'; offIn.value = preset.off || '0';
      offIn.dataset.role = 'offset';
      const baseSel = buildRegSelect('instr-lw-base', preset.base || 'R0');
      baseSel.dataset.role = 'base';
      fieldsDiv.append(src1Sel, sep(','), offIn, sep('('), baseSel, sep(')'));
    }

    validateRow(row, dot);
  }

  rebuildFields(preset.op);

  opSel.addEventListener('change', () => {
    // Update preset reference for the new op type (use defaults)
    rebuildFields(opSel.value);
  });

  fieldsDiv.addEventListener('input', () => validateRow(row, dot));
  fieldsDiv.addEventListener('change', () => validateRow(row, dot));

  return row;
}

function validateRow(row, dot) {
  const offIn = row.querySelector('[data-role="offset"]');
  const isValid = !offIn || /^-?\d+$/.test((offIn.value || '').trim());
  offIn && offIn.classList.toggle('instr-error', !isValid);
  dot.classList.toggle('valid', isValid);
  dot.classList.toggle('invalid', !isValid);
}

// ────────────────────────────────────────────────
// Render Instruction Inputs
// ────────────────────────────────────────────────

function renderInstrInputs(count) {
  instrInputsDiv.innerHTML = '';
  for (let i = 0; i < count; i++) {
    instrInputsDiv.appendChild(buildInstrRow(i));
  }
}

function getCount() { return parseInt(instrCountInput.value, 10) || 1; }

function setCount(v) {
  v = Math.max(1, Math.min(10, v));
  instrCountInput.value = v;
  renderInstrInputs(v);
}

btnDecCount.addEventListener('click', () => setCount(getCount() - 1));
btnIncCount.addEventListener('click', () => setCount(getCount() + 1));
instrCountInput.addEventListener('change', () => {
  let v = parseInt(instrCountInput.value, 10);
  if (isNaN(v) || v < 1) v = 1;
  if (v > 10) v = 10;
  instrCountInput.value = v;
  renderInstrInputs(v);
});

// Highlight selected pipeline option card
document.querySelectorAll('input[name="pipelineType"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.pipeline-option').forEach(o => o.classList.remove('selected'));
    radio.closest('.pipeline-option').classList.add('selected');
  });
});

// ────────────────────────────────────────────────
// Parse instructions from UI
// ────────────────────────────────────────────────

function parseAllInstructions() {
  const rows = instrInputsDiv.querySelectorAll('.instr-row');
  const instrs = [];
  const errors = [];

  rows.forEach((row, i) => {
    const op = row.querySelector('[data-role="op"]').value;
    const getVal = role => { const el = row.querySelector(`[data-role="${role}"]`); return el ? el.value : ''; };

    let parsed;
    if (op === 'ADD' || op === 'SUB') {
      parsed = PipelineSim.parseInstruction(op, getVal('dest'), getVal('src1'), getVal('src2'));
    } else if (op === 'LW') {
      parsed = PipelineSim.parseInstruction(op, getVal('dest'), getVal('offset'), getVal('base'));
    } else if (op === 'SW') {
      parsed = PipelineSim.parseInstruction(op, getVal('src1'), getVal('offset'), getVal('base'));
    }

    if (!parsed) {
      errors.push(`I${i + 1}: Invalid instruction format`);
    } else {
      instrs.push(parsed);
    }
  });

  return { instrs, errors };
}

// ────────────────────────────────────────────────
// Table Rendering
// ────────────────────────────────────────────────

/**
 * Render the pipeline execution table.
 * If showUpToCycle is null, reveal all cycles.
 * If showUpToCycle is a number, only show cells up to (and including) that cycle,
 * and dim / hide future cells.
 */
function renderTable(result, showUpToCycle) {
  const { instructions, stagesCount, totalCycles, schedule } = result;
  const revealAll = showUpToCycle === null;
  const maxVisible = revealAll ? totalCycles : showUpToCycle;

  // Update pipeline badge
  pipelineBadge.textContent = stagesCount === 5 ? '5-Stage Pipeline' : '4-Stage Pipeline';

  const table = document.createElement('table');
  table.className = 'pipeline-table';

  // ── Header ──────────────────────────────────────
  const thead = document.createElement('thead');
  const hRow = document.createElement('tr');

  const instrTh = document.createElement('th');
  instrTh.className = 'instr-header';
  instrTh.textContent = 'Instruction';
  hRow.appendChild(instrTh);

  for (let c = 1; c <= totalCycles; c++) {
    const th = document.createElement('th');
    th.className = 'cycle-header';
    th.textContent = `C${c}`;
    if (!revealAll && c === maxVisible) th.style.fontWeight = '800';
    hRow.appendChild(th);
  }

  thead.appendChild(hRow);
  table.appendChild(thead);

  // ── Body ─────────────────────────────────────────
  const tbody = document.createElement('tbody');

  instructions.forEach((instr, rowIdx) => {
    const tr = document.createElement('tr');

    // Instruction name cell
    const instrTd = document.createElement('td');
    instrTd.className = 'instr-cell';
    instrTd.innerHTML = `<span class="instr-idx">I${rowIdx + 1}</span> ${escHtml(instr.raw)}`;
    tr.appendChild(instrTd);

    for (let c = 1; c <= totalCycles; c++) {
      const td = document.createElement('td');
      const entry = schedule[rowIdx][c]; // may be undefined

      if (!entry || (!revealAll && c > maxVisible)) {
        // Empty or not yet revealed
        td.className = 'cell-empty';
        td.textContent = '';
      } else {
        const { stage, type } = entry;

        if (type === 'stall') {
          td.className = 'cell-stall';
          td.textContent = 'STALL';
        } else if (type === 'fwd') {
          td.className = stageToCellClass(stage) + ' cell-fwd';
          td.textContent = stage + '▸';
          td.title = `Forwarded to this EX — data received from earlier stage`;
        } else {
          td.className = stageToCellClass(stage);
          td.textContent = stage;
        }

        // Highlight the current (most recent) cycle column in step mode
        if (!revealAll && c === maxVisible) {
          td.classList.add('cell-active-cycle');
        }
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableContainer.innerHTML = '';
  tableContainer.appendChild(table);
}

function stageToCellClass(stage) {
  const map = {
    'IF': 'cell-if', 'ID': 'cell-id', 'EX': 'cell-ex',
    'MEM': 'cell-mem', 'WB': 'cell-wb', 'MEM/WB': 'cell-memwb',
  };
  return map[stage] || '';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ────────────────────────────────────────────────
// Hazard Report
// ────────────────────────────────────────────────

function renderHazardReport(result) {
  const { hazards, instructions, forwarding } = result;

  if (hazards.length === 0) {
    hazardReport.style.display = 'none';
    return;
  }

  hazardReport.style.display = '';
  hazardList.innerHTML = '';

  hazards.forEach(h => {
    const prod = instructions[h.producerIdx];
    const cons = instructions[h.consumerIdx];
    const type = h.isLoad ? 'Load-Use RAW' : 'RAW';
    const stalls = forwarding ? h.stallsWith : h.stallsWithout;
    const fwdNote = forwarding && h.stallsWith < h.stallsWithout
      ? ` (reduced from ${h.stallsWithout} to ${h.stallsWith} via forwarding)`
      : '';

    const li = document.createElement('li');
    li.textContent = `${type} Hazard: I${h.producerIdx + 1} [${prod.raw}] writes ${h.register} → read by I${h.consumerIdx + 1} [${cons.raw}] → ${stalls} stall(s)${fwdNote}`;
    hazardList.appendChild(li);
  });
}

// ────────────────────────────────────────────────
// Forwarding Report
// ────────────────────────────────────────────────

function renderForwardingReport(result) {
  if (!result.forwarding || result.forwardingEvents.length === 0) {
    forwardingReport.style.display = 'none';
    return;
  }

  forwardingReport.style.display = '';
  forwardingList.innerHTML = '';

  result.forwardingEvents.forEach(f => {
    const prod = result.instructions[f.producerIdx];
    const cons = result.instructions[f.consumerIdx];
    const li = document.createElement('li');
    li.textContent = `${f.register}: I${f.producerIdx + 1} [${prod.raw}] → ${f.from}→${f.to} → I${f.consumerIdx + 1} [${cons.raw}] · saved ${f.stallsEliminated} stall(s)`;
    forwardingList.appendChild(li);
  });
}

// ────────────────────────────────────────────────
// Stats
// ────────────────────────────────────────────────

function renderStats(result) {
  const n = result.instructions.length;
  statCycles.textContent  = result.totalCycles;
  statInstrs.textContent  = n;
  statStalls.textContent  = result.totalStalls;
  statHazards.textContent = result.hazards.length;
  statCPI.textContent     = (result.totalCycles / n).toFixed(2);
  statsBar.style.display  = '';
}

// ────────────────────────────────────────────────
// Simulation Actions
// ────────────────────────────────────────────────

function buildSimResult() {
  const { instrs, errors } = parseAllInstructions();
  if (errors.length > 0) { showToast(errors[0]); return null; }
  if (instrs.length === 0) { showToast('Add at least 1 instruction.'); return null; }

  const stagesCount = parseInt(
    document.querySelector('input[name="pipelineType"]:checked').value, 10
  );
  const forwarding = document.getElementById('forwardingEnabled').checked;

  return PipelineSim.simulate(instrs, stagesCount, forwarding);
}

// Run full simulation (show all cycles at once)
function runSimulation() {
  const result = buildSimResult();
  if (!result) return;

  simResult    = result;
  stepMode     = false;
  currentCycle = result.totalCycles;

  renderTable(result, null);
  renderHazardReport(result);
  renderForwardingReport(result);
  renderStats(result);

  cycleInfo.style.display = 'none';
  btnStep.disabled = false;
}

// Step one cycle
function stepCycle() {
  if (!simResult) {
    // First step — build result
    const result = buildSimResult();
    if (!result) return;
    simResult    = result;
    stepMode     = true;
    currentCycle = 0;

    renderHazardReport(result);
    renderForwardingReport(result);
    renderStats(result);
  }

  if (currentCycle >= simResult.totalCycles) {
    // Already at end — show complete
    renderTable(simResult, null);
    cycleVal.textContent   = simResult.totalCycles;
    cycleTotal.textContent = `/ ${simResult.totalCycles} · Complete`;
    cycleInfo.style.display = '';
    btnStep.disabled = true;
    return;
  }

  currentCycle++;
  renderTable(simResult, currentCycle);
  cycleVal.textContent    = currentCycle;
  cycleTotal.textContent  = `/ ${simResult.totalCycles}`;
  cycleInfo.style.display = '';
  btnStep.disabled        = currentCycle >= simResult.totalCycles;
}

// Reset everything
function resetAll() {
  simResult    = null;
  currentCycle = 0;
  stepMode     = false;

  tableContainer.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚙</div>
      <p>Configure your instructions and run the simulation to see the pipeline execution.</p>
    </div>`;
  hazardReport.style.display     = 'none';
  forwardingReport.style.display = 'none';
  statsBar.style.display         = 'none';
  cycleInfo.style.display        = 'none';
  pipelineBadge.textContent      = '';
  btnStep.disabled               = false;
}

// ────────────────────────────────────────────────
// Toast
// ────────────────────────────────────────────────

function showToast(msg) {
  document.querySelector('.error-toast')?.remove();
  const t = document.createElement('div');
  t.className = 'error-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.cssText += 'opacity:0;transition:opacity .3s;';
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

// ────────────────────────────────────────────────
// Event Listeners
// ────────────────────────────────────────────────

btnRun.addEventListener('click', runSimulation);
btnStep.addEventListener('click', stepCycle);
btnReset.addEventListener('click', resetAll);

// ────────────────────────────────────────────────
// Init
// ────────────────────────────────────────────────

renderInstrInputs(4);
