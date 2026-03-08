import { installTextureMod } from "../patching/Orchestrator";

interface WorkerInput {
  modDir: string;
  gameDir: string;
  gameId?: string;
}

process.on("message", (msg: WorkerInput) => {
  try {
    const result = installTextureMod(msg.modDir, msg.gameDir, (info) => {
      process.send?.({ type: "progress", ...info });
    }, msg.gameId);
    process.send?.({ type: "result", result });
  } catch (err: any) {
    process.send?.({ type: "error", message: err.message ?? String(err) });
  }
  process.exit(0);
});
