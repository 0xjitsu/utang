// Some NEAR packages (wallet selector, @near-js/*) expect Node's Buffer/process globals.
import { Buffer } from "buffer";

const g = globalThis as any;
if (!g.Buffer) g.Buffer = Buffer;
if (!g.process) g.process = { env: {} };
else if (!g.process.env) g.process.env = {};
