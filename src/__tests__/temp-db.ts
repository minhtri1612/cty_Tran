// Import this FIRST in every test file. ES module imports are evaluated before
// the importing file's own code, so a temp database set up inside a test body
// would be too late for any statically imported module that loads
// src/config/database.ts.
import { useTempDatabase } from "./helpers.js";

export const dbPath = useTempDatabase();
