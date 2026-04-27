// scripts/release/lib/prompt.mjs
//
// Tiny stdin prompt helpers. Avoids pulling in inquirer/prompts dependencies.

import readline from "node:readline";

/**
 * Ask a single-line question. Returns the trimmed answer.
 * Blank answer returns the default (if provided) or "".
 */
export async function ask(question, defaultValue = "") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed || defaultValue);
    });
  });
}

/** Yes/No prompt. Accepts y/yes (case-insensitive). Default shown in brackets. */
export async function confirm(question, defaultYes = false) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} ${suffix} `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "") resolve(defaultYes);
      else resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

/**
 * Multi-line input — reads stdin until a line containing only "." or EOF.
 * Ctrl+D on unix, Ctrl+Z then enter on Windows, or a single "." line on either.
 */
export async function askMultiline(question) {
  console.log(question);
  console.log("(enter a single '.' on a line by itself to finish, or press Ctrl+D/Ctrl+Z)");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];
  return new Promise((resolve) => {
    rl.on("line", (line) => {
      if (line.trim() === ".") {
        rl.close();
        return;
      }
      lines.push(line);
    });
    rl.on("close", () => resolve(lines.join("\n").trim()));
  });
}

/** Pause until user presses enter. */
export async function pause(message = "Press enter to continue...") {
  await ask(message);
}
