// main.js (update: fix space key to reliably register "unknown" and advance prompts/trial)
import { WIDTH, HEIGHT, WHITE, BLACK, POSITIONS, generateUUID, GREEN, BLUE } from "./utilities.js";
import { MovingObject } from "./objects.js";
import { Experiment } from "./experiment.js";

// Participant
const participant = JSON.parse(sessionStorage.getItem("participantInfo") || "{}");
window.participantId = window.participantId || generateUUID();
window.experimentResults = window.experimentResults || [];

// Conditions setup
const lags = [100, 300, 500, 700];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateBlockTrials() {
  const condConfigs = [
    { collision_type: "overtaking", which_changes: "o1_twice", burst: false },
    { collision_type: "fake_causal", which_changes: "o1_then_o2", burst: false },
    { collision_type: "true_causal", which_changes: "o1_then_o2", burst: false },
    { collision_type: "true_causal", which_changes: "o1_then_o2", burst: true }
  ];
  const trials = [];
  condConfigs.forEach(config => {
    for (let i = 0; i < 30; i++) { // 30 per condition, 120 total
      trials.push({ ...config, lag: pick(lags) });
    }
  });
  trials.sort(() => Math.random() - 0.5); // shuffle
  return trials;
}

function generateTrainingTrials() {
  const condConfigs = [
    { collision_type: "overtaking", which_changes: "o1_twice", burst: false },
    { collision_type: "fake_causal", which_changes: "o1_then_o2", burst: false },
    { collision_type: "true_causal", which_changes: "o1_then_o2", burst: false },
    { collision_type: "true_causal", which_changes: "o1_then_o2", burst: true }
  ];
  const trials = [];
  for (let i = 0; i < 20; i++) {
    const config = pick(condConfigs);
    trials.push({ ...config, lag: pick(lags) });
  }
  return trials;
}

const trainingTrials = generateTrainingTrials();
const mainBlocks = [
  { o1_color: GREEN, o2_color: BLUE, num_targets: 2, trials: generateBlockTrials() },
  { o1_color: BLUE, o2_color: GREEN, num_targets: 2, trials: generateBlockTrials() },
  { o1_color: GREEN, o2_color: BLUE, num_targets: 1, trials: generateBlockTrials() },
  { o1_color: BLUE, o2_color: GREEN, num_targets: 1, trials: generateBlockTrials() }
];

// Global state
let currentScreen = "instructions";
let currentPhase = "training"; // "training" or "main"
let currentBlock = 0;
let currentTrialIndex = 0;
let experiment = null;
let startTime = 0;
let responseTaken = false;

let promptText = "";
let userInput = "";
let inputActive = false;
let response1 = null; // T1 if num_targets=2, null initially
let response2 = null; // T2 always, null initially

// p5 bootstrap
function setup() {
  const canvas = window.createCanvas(WIDTH, HEIGHT);
  canvas.parent("sketch-holder");
  // UPDATED: Ensure canvas has focus to capture key events
  canvas.elt.focus();
  window.frameRate(32);
  window.textAlign(window.CENTER, window.CENTER);

  const welcome = document.getElementById("welcome");
  welcome.textContent = participant?.name
    ? `Welcome, ${participant.name}!`
    : "Welcome!";
  document.getElementById("trial-status").innerText = "Instructions";

  const dlBtn = document.getElementById("download-btn");
  if (dlBtn) {
    dlBtn.addEventListener("click", () => {
      const results = window.experimentResults || [];
      if (!results.length) {
        alert("No results to download.");
        return;
      }
      let csv = "data:text/csv;charset=utf-8,";
      csv += "ParticipantID,Trial,Block,CollisionType,WhichChanges,Lag,O1Start,O2Start,Score,T1Value,T2Value,T1Object,T2Object,T1Response,T2Response,AttentionPrompt,IsTraining,Burst,NumTargets\n";
      results.forEach((r, idx) => {
        csv += `${r.participant_id || ""},${r.trial || ""},${r.block || ""},${r.collision_type || ""},${r.which_changes || ""},${r.lag || ""},${r.o1_start || ""},${r.o2_start || ""},${r.score || ""},${r.t1_value || ""},${r.t2_value || ""},${r.t1_object || ""},${r.t2_object || ""},${r.T1_response || ""},${r.T2_response || ""},${r.attention_prompt || ""},${r.is_training || ""},${r.burst || ""},${r.num_targets || ""}\n`;
      });
      const link = document.createElement("a");
      link.href = encodeURI(csv);
      link.download = `experiment_results_${window.participantId || "unknown"}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }
}

function draw() {
  window.background(BLACK);

  if (currentScreen === "instructions") {
    displayTextScreen([
      "Hello! Thank you for participating.",
      "",
      "You will see two objects moving on a circular path.",
      "Each object displays a rapidly changing digit.",
      "",
      "One or two times in the trial, a letter will appear briefly on one or both objects.",
      "These are your target letters.",
      "",
      "Your task is to identify the letter(s) and type them in the order you saw them.",
      "",
      "If you are unsure, try your best. If you don't know, press SPACE.",
      "",
      "Let's start with 20 practice trials."
    ]);
    setStatus("Instructions");
    return;
  }

  if (currentScreen === "training_complete") {
    displayTextScreen(["Great job! Now, on to the actual experiment. Press SPACE to start."]);
    setStatus("Training Complete");
    return;
  }

  if (currentScreen === "block_complete") {
    displayTextScreen([`Block ${currentBlock} complete. Press SPACE to start next block.`]);
    setStatus("Block Complete");
    return;
  }

  if (currentScreen === "break") {
    displayTextScreen([
      "You have completed 50 trials in this block.",
      "Take a short break if needed. Press any key to resume."
    ]);
    setStatus("Break");
    return;
  }

  if (currentScreen === "end") {
    displayTextScreen([
      "The experiment is over. Thank you for participating!",
      "",
      "Your data will be anonymized and stored in compliance",
      "with the UK General Data Protection Regulation.",
      "",
      "Have a great day!"
    ]);
    setStatus("Experiment Complete");
    document.getElementById("download-section").style.display = "block";
  }

  if (currentScreen === "training" || currentScreen === "main") {
    let trials, o1_color, o2_color, num_targets, blockNum = null;
    if (currentPhase === "training") {
      trials = trainingTrials;
      o1_color = GREEN;
      o2_color = BLUE;
      num_targets = 2;
      blockNum = "Training";
    } else {
      const block = mainBlocks[currentBlock - 1];
      trials = block.trials;
      o1_color = block.o1_color;
      o2_color = block.o2_color;
      num_targets = block.num_targets;
      blockNum = currentBlock;
    }

    if (currentTrialIndex >= trials.length) {
      if (currentPhase === "training") {
        currentScreen = "training_complete";
      } else if (currentBlock < mainBlocks.length) {
        currentScreen = "block_complete";
      } else {
        currentScreen = "end";
        document.getElementById("download-section").style.display = "block";
      }
      return;
    }

    if (!experiment) {
      const condition = trials[currentTrialIndex];
      const o1 = new MovingObject(POSITIONS[0], POSITIONS, 40, o1_color, "X");
      const o2 = new MovingObject(POSITIONS[0], POSITIONS, 40, o2_color, "Y");
      try {
        experiment = new Experiment(
          o1, o2, condition.collision_type, condition.which_changes, condition.lag,
          window.participantId, currentPhase === "training", condition.burst, num_targets
        );
        startTime = window.millis();
        responseTaken = false;
        response1 = null;
        response2 = null;
        setStatus(`${blockNum} Trial ${currentTrialIndex + 1}/${trials.length}`);
      } catch (e) {
        console.error("Failed to initialize experiment:", e);
        currentScreen = "end";
        return;
      }
    }

    try {
      const currentTime = window.millis() - startTime;
      experiment.update(currentTime);
    } catch (e) {
      console.error("Error during experiment update:", e);
      currentScreen = "end";
      return;
    }

    // Draw objects - text only (no circles), larger text size
    window.fill(experiment.o1.color);
    window.textSize(30);
    window.text(experiment.o1.text, experiment.o1.x, experiment.o1.y);

    window.fill(experiment.o2.color);
    window.textSize(30);
    window.text(experiment.o2.text, experiment.o2.x, experiment.o2.y);

    // draw burst if active
    if (experiment.burst && experiment.burst_start && (window.millis() - startTime) - experiment.burst_start < experiment.burst_duration) {
      const pos_x = experiment.o1.x;
      const pos_y = experiment.o1.y;
      window.push();
      window.noFill();
      window.strokeWeight(2);

      // yellow sparks
      window.stroke(255, 255, 0);
      for (let i = 0; i < 8; i++) {
        let angle = Math.random() * window.TWO_PI;
        let len = Math.random() * 20 + 10;
        let endX = pos_x + Math.cos(angle) * len;
        let endY = pos_y + Math.sin(angle) * len;
        window.line(pos_x, pos_y, endX, endY);
      }

      // orange fire-like
      window.stroke(255, 165, 0);
      for (let i = 0; i < 5; i++) {
        let angle = Math.random() * window.TWO_PI;
        let len = Math.random() * 15 + 5;
        let endX = pos_x + Math.cos(angle) * len;
        let endY = pos_y + Math.sin(angle) * len;
        window.line(pos_x, pos_y, endX, endY);
      }

      window.pop();
    }

    // prompt - unchanged to avoid interference with larger object text
    if (experiment.state === "asking" && !responseTaken) {
      let isFirst = (experiment.num_targets > 1 && response1 === null);
      if (isFirst) {
        promptText = "What was the FIRST target letter? (SPACE = unknown)";
      } else {
        promptText = experiment.num_targets > 1 ? "What was the SECOND target letter? (SPACE = unknown)" : "What was the target letter? (SPACE = unknown)";
      }
      window.textSize(28);
      window.fill(WHITE);
      window.text(promptText, WIDTH / 2, HEIGHT - 100);
      if (inputActive && userInput) {
        window.textSize(36);
        window.text(userInput, WIDTH / 2, HEIGHT - 60);
      }
    }

    // break every 50 in main blocks
    if (currentPhase === "main" && (currentTrialIndex > 0 && currentTrialIndex % 50 === 0) &&
        experiment.state === "asking" && responseTaken) {
      currentScreen = "break";
    }
    return;
  }
}

// helpers
function displayTextScreen(lines) {
  const fontSize = 28;
  const padding = 20;
  const maxCharsPerLine = Math.floor((WIDTH - 2 * padding) / (fontSize / 1.5));
  const wrapped = [];
  for (const line of lines) {
    if (line.length > maxCharsPerLine) {
      const words = line.split(" ");
      let cur = "";
      for (const w of words) {
        if ((cur + w).length > maxCharsPerLine) {
          wrapped.push(cur.trim());
          cur = w + " ";
        } else {
          cur += w + " ";
        }
      }
      if (cur.trim()) wrapped.push(cur.trim());
    } else {
      wrapped.push(line);
    }
  }
  const lineHeight = fontSize * 1.2;
  const totalHeight = wrapped.length * lineHeight;
  const startY = (HEIGHT - totalHeight) / 2 + padding / 2;

  window.textAlign(window.CENTER, window.TOP);
  window.textSize(fontSize);
  window.fill(WHITE);
  wrapped.forEach((l, i) => {
    window.text(l, WIDTH / 2, startY + i * lineHeight);
  });
  window.textAlign(window.CENTER, window.CENTER);
}

function setStatus(t) {
  const el = document.getElementById("trial-status");
  if (el) el.innerText = t;
}

// key handling
function keyPressed() {
  console.log("Key pressed:", window.key, "Screen:", currentScreen, "State:", experiment?.state); // Debug
  if (currentScreen === "instructions") {
    if (window.key === ' ') {
      currentScreen = "training";
      currentPhase = "training";
      currentTrialIndex = 0;
      experiment = null;
      setStatus(`Training Trial 1/${trainingTrials.length}`);
      console.log("Starting training phase"); // Debug
    }
    return;
  }

  if (currentScreen === "training_complete") {
    if (window.key === ' ') {
      currentScreen = "main";
      currentPhase = "main";
      currentBlock = 1;
      currentTrialIndex = 0;
      experiment = null;
      setStatus(`Block 1 Trial 1/${mainBlocks[0].trials.length}`);
      console.log("Starting main phase"); // Debug
    }
    return;
  }

  if (currentScreen === "block_complete") {
    if (window.key === ' ') {
      currentBlock += 1;
      currentTrialIndex = 0;
      experiment = null;
      currentScreen = "main";
      setStatus(`Block ${currentBlock} Trial 1/${mainBlocks[currentBlock - 1].trials.length}`);
      console.log("Starting next block:", currentBlock); // Debug
    }
    return;
  }

  if (currentScreen === "break") {
    currentScreen = "main";
    console.log("Resuming from break"); // Debug
    return;
  }

  if (currentScreen === "training" || currentScreen === "main") {
    if (!experiment || experiment.state !== "asking" || responseTaken) {
      console.log("Ignoring key: invalid state", {
        experiment: !!experiment,
        state: experiment?.state,
        responseTaken
      }); // Debug
      return;
    }

    if (!inputActive) {
      inputActive = true;
      userInput = "";
      console.log("Input active for response"); // Debug
    }

    let inputChar = null;
    // UPDATED: Robust space key handling
    if (window.key === ' ') {
      console.log("Space key detected: registering unknown response"); // Debug
      inputChar = "";
      userInput = ""; // No display for space
    } else if (/[A-Za-z]/.test(window.key)) {
      inputChar = window.key.toUpperCase();
      console.log(`Letter key detected: ${inputChar}`); // Debug
      userInput = inputChar; // Show letter for feedback
    } else {
      console.log(`Ignored key: ${window.key}`); // Debug
      return;
    }

    // Assign response based on whether we're collecting first or second response
    if (experiment.num_targets > 1 && response1 === null) {
      response1 = inputChar;
      console.log(`Set response1: ${response1 || "empty"}`); // Debug
      userInput = ""; // Reset for second prompt
      inputActive = true; // Stay active for second response
      return; // Wait for second key press
    } else {
      response2 = inputChar;
      console.log(`Set response2: ${response2 || "empty"}`); // Debug
      responseTaken = true; // Mark as complete to prevent further input
    }

    // Submit only when all required responses are collected
    if ((experiment.num_targets > 1 && response1 !== null && response2 !== null) || (experiment.num_targets === 1 && response2 !== null)) {
      console.log("Submitting responses:", response1, response2); // Debug
      experiment.submit_response(response1, response2);
      const result = { ...experiment.get_results(), trial: currentTrialIndex + 1, block: currentPhase === "training" ? "Training" : currentBlock };
      window.experimentResults.push(result);
      responseTaken = true;
      inputActive = false;
      userInput = "";
      currentTrialIndex += 1;
      experiment = null;
      if (currentTrialIndex < (currentPhase === "training" ? trainingTrials.length : mainBlocks[currentBlock - 1].trials.length)) {
        setStatus(`${currentPhase === "training" ? "Training" : `Block ${currentBlock}`} Trial ${currentTrialIndex + 1}/${currentPhase === "training" ? trainingTrials.length : mainBlocks[currentBlock - 1].trials.length}`);
      }
      console.log("Trial advanced, new index:", currentTrialIndex); // Debug
    }
  }
}

// expose p5 entry points
window.setup = setup;
window.draw = draw;
window.keyPressed = keyPressed;