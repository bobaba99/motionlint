#!/usr/bin/env node
import { loadEnv } from "./config/env.js";
import { buildProgram } from "./cli/commands.js";

loadEnv();

const program = buildProgram();
program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
