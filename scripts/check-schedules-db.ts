#!/usr/bin/env tsx
import { runCheckSchedulesDb } from "../tools/hook-runtime/src/check-schedules-db.js";

runCheckSchedulesDb().then((code) => process.exit(code));
